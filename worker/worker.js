/**
 * Shelf API: the Cloudflare Worker behind Shelfie's book search.
 *
 * The Google Books key lives here, as a Worker secret, and nowhere else: not in the page, not
 * in this repository. The browser only ever talks to this Worker.
 *
 * Routes (GET only):
 *   /api/health
 *   /api/search?q=dune
 *
 * Settings (Worker > Settings > Variables and Secrets):
 *   ALLOWED_ORIGINS    text    e.g. https://parth8.github.io   (comma separated, no path)
 *   GOOGLE_BOOKS_KEY   SECRET  Google Books API key. Add it with the "Secret" type, never "Text".
 *                              It is only ever sent to www.googleapis.com, and every response and
 *                              log line is checked so that no secret value can leave this Worker.
 *                              Without it, search answers from Open Library.
 *   REQUIRE_ORIGIN     text    optional, "false" lets you test in a browser tab
 *   LIMITER            optional Rate Limiting binding (otherwise a per-isolate limiter is used)
 */

const GOOGLE = "https://www.googleapis.com/books/v1/volumes";
const GOOGLE_FIELDS = "items(id,volumeInfo(title,subtitle,authors,pageCount,publishedDate,imageLinks/thumbnail,categories,description))";
const OPEN_LIBRARY = "https://openlibrary.org/search.json";
const OL_FIELDS = "key,title,author_name,cover_i,number_of_pages_median,first_publish_year,subject";
const LIMIT = 16;
const TTL = { search: 21600, stale: 604800 }; // 6 hours fresh, a week as a fallback
const RATE = { windowMs: 60_000, max: 30 };
const UPSTREAM_TIMEOUT_MS = 8000;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env, ctx) {
    logEnv = env;
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean);
    const cors = allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
    }

    try {
      if (request.method !== "GET") throw new ApiError(405, "method_not_allowed", "Only GET is supported.");
      if (url.pathname === "/api/health") return reply({ ok: true, google: !!env.GOOGLE_BOOKS_KEY }, 200, cors, 0, env);

      // Only our own site may use the key from a browser.
      const originOk = allowed.includes(origin) || (!origin && env.REQUIRE_ORIGIN === "false");
      if (!originOk) throw new ApiError(403, "forbidden", "This API only serves its own website.");

      await rateLimit(request, env);

      if (url.pathname === "/api/search") return reply(await searchRoute(url, env, ctx), 200, cors, 300, env);
      throw new ApiError(404, "not_found", "Unknown route.");
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      const code = err instanceof ApiError ? err.code : "internal_error";
      const message = err instanceof ApiError ? err.message : "Something went wrong on our side.";
      if (!(err instanceof ApiError)) log("error", "unhandled", String(err && err.stack));
      return reply({ error: code, message }, status, cors, 0, env);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Secrets never leave                                                 */
/* ------------------------------------------------------------------ */

/** Names of settings whose values must never appear in a response or a log. */
const isSecretName = (name) => /KEY|TOKEN|SECRET|PASS/i.test(name);

function secretValues(env) {
  return Object.entries(env || {})
    .filter(([k, v]) => isSecretName(k) && typeof v === "string" && v.length >= 6)
    .map(([, v]) => v);
}

function redact(text, env) {
  let out = String(text);
  for (const v of secretValues(env)) out = out.replace(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[redacted]");
  return out;
}

/** Every log line goes through here, so secrets never reach the logs either. */
let logEnv = {};
const log = (level, ...parts) => console[level](...parts.map((p) => redact(typeof p === "string" ? p : JSON.stringify(p), logEnv)));

/**
 * The only way a response leaves this Worker. Last line of defence: if a secret value ever
 * ended up in the body, the body is replaced with a generic error. Nothing about the secret is
 * revealed, not even its length.
 */
function reply(body, status, cors, maxAge, env) {
  let text = JSON.stringify(body);
  const lower = text.toLowerCase();
  if (secretValues(env).some((v) => lower.includes(v.toLowerCase()))) {
    log("error", "blocked a response that contained a secret value");
    text = JSON.stringify({ error: "internal_error", message: "Something went wrong on our side." });
    status = 500;
    maxAge = 0;
  }
  return new Response(text, {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `private, max-age=${maxAge}` : "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    },
  });
}

/* ------------------------------------------------------------------ */
/* Rate limiting: platform binding if configured, else per-isolate     */
/* ------------------------------------------------------------------ */

const buckets = new Map();
async function rateLimit(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (env.LIMITER && typeof env.LIMITER.limit === "function") {
    const { success } = await env.LIMITER.limit({ key: ip });
    if (!success) throw new ApiError(429, "rate_limited", "Too many searches. Try again in a minute.");
    return;
  }
  const now = Date.now();
  const b = buckets.get(ip) || { start: now, count: 0 };
  if (now - b.start > RATE.windowMs) {
    b.start = now;
    b.count = 0;
  }
  b.count += 1;
  buckets.set(ip, b);
  if (buckets.size > 5000) buckets.clear();
  if (b.count > RATE.max) throw new ApiError(429, "rate_limited", "Too many searches. Try again in a minute.");
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/** A query: printable text, 2 to 120 characters, whitespace squashed. */
export function cleanQuery(raw) {
  const q = String(raw || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (q.length < 2 || q.length > 120) throw new ApiError(400, "bad_query", "Search for 2 to 120 characters.");
  return q;
}

const cacheKey = (name) => new Request(`https://shelf-cache.internal/${encodeURIComponent(name)}`);

async function searchRoute(url, env, ctx) {
  const q = cleanQuery(url.searchParams.get("q"));
  const name = `search/${q.toLowerCase()}`;
  const cache = caches.default;
  const hit = await cache.match(cacheKey(name));
  if (hit) return hit.json();
  try {
    const data = await search(q, env);
    // Only cache real answers: an empty one may be a hiccup.
    if (data.results.length) {
      const put = (key, seconds) => cache.put(cacheKey(key), new Response(JSON.stringify(data), { headers: { "Cache-Control": `max-age=${seconds}` } }));
      ctx.waitUntil(Promise.all([put(name, TTL.search), put(`${name}/stale`, TTL.stale)]));
    }
    return data;
  } catch (err) {
    const stale = await cache.match(cacheKey(`${name}/stale`));
    if (stale) return stale.json();
    throw err;
  }
}

/** Google Books first, Open Library if Google can't answer. */
async function search(q, env) {
  if (env.GOOGLE_BOOKS_KEY) {
    try {
      const results = await google(q, env.GOOGLE_BOOKS_KEY);
      if (results.length) return { results, source: "google" };
    } catch (err) {
      log("warn", "google books failed, using open library", String(err && err.message));
    }
  }
  try {
    return { results: await openLibrary(q), source: "openlibrary" };
  } catch (err) {
    log("warn", "open library failed", String(err && err.message));
    throw new ApiError(502, "upstream_unavailable", "Book search is having a moment. Try again shortly.");
  }
}

async function getJson(href, init = {}) {
  const res = await fetch(href, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(href).hostname} answered ${res.status}`);
  return res.json();
}

async function google(q, key) {
  const params = new URLSearchParams({ q, maxResults: String(LIMIT), printType: "books", fields: GOOGLE_FIELDS, key });
  const href = `${GOOGLE}?${params}`;
  // The key only ever goes to Google.
  if (new URL(href).hostname !== "www.googleapis.com") throw new Error("refusing to send the key elsewhere");
  const data = await getJson(href, { headers: { Accept: "application/json" } });
  return (Array.isArray(data?.items) ? data.items : []).map(cleanGoogle).filter(Boolean);
}

async function openLibrary(q) {
  const data = await getJson(`${OPEN_LIBRARY}?${new URLSearchParams({ q, limit: String(LIMIT), fields: OL_FIELDS })}`, { headers: { Accept: "application/json" } });
  return (Array.isArray(data?.docs) ? data.docs : []).map(cleanOpenLibrary).filter(Boolean);
}

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** One Google volume, cut down to what the app shows. */
export function cleanGoogle(item) {
  const v = item?.volumeInfo;
  if (!v || typeof v.title !== "string" || typeof item.id !== "string" || !/^[\w-]{4,20}$/.test(item.id)) return null;
  const year = parseInt(str(v.publishedDate, 4), 10);
  return {
    key: `g:${item.id}`,
    title: str(v.title, 140),
    author: Array.isArray(v.authors) ? str(v.authors[0], 100) : "",
    pages: Number.isInteger(v.pageCount) && v.pageCount > 0 ? v.pageCount : null,
    year: Number.isInteger(year) && year > 0 ? year : null,
    // A sharper cover than the API's thumbnail, from the same place. Covers need no key.
    img: v.imageLinks?.thumbnail ? `https://books.google.com/books/content?id=${item.id}&printsec=frontcover&img=1&zoom=1&fife=w480-h720&source=gbs_api` : null,
    cats: Array.isArray(v.categories) ? str(v.categories[0], 40) || null : null,
    blurb: str(v.description, 600).replace(/<[^>]*>/g, "").slice(0, 280) || null,
  };
}

/** One Open Library work, cut down to what the app shows. */
export function cleanOpenLibrary(d) {
  if (!d || typeof d.title !== "string") return null;
  return {
    key: typeof d.key === "string" ? d.key.replace("/works/", "ol:").slice(0, 40) : null,
    title: d.title.slice(0, 140),
    author: Array.isArray(d.author_name) ? String(d.author_name[0] || "").slice(0, 100) : "",
    cover: Number.isInteger(d.cover_i) && d.cover_i > 0 ? d.cover_i : null,
    pages: Number.isInteger(d.number_of_pages_median) && d.number_of_pages_median > 0 ? d.number_of_pages_median : null,
    year: Number.isInteger(d.first_publish_year) ? d.first_publish_year : null,
    cats: Array.isArray(d.subject) ? str(d.subject[0], 40) || null : null,
  };
}

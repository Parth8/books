# Deployment

Publishing the site and setting up the Cloudflare Worker (search, covers, accounts, sync).

## Book search: Google Books, through our own Worker

Search uses the [Google Books API](https://developers.google.com/books/docs/overview), the same way Track uses its data sources: **the browser never sees a key.**

```
Browser (GitHub Pages: static HTML, CSS, ES modules)
   │  GET /api/search?q=dune
   ▼
Cloudflare Worker (worker/worker.js) ── checks origin, rate-limits, validates, caches
   ├── Google Books   (key held as a Worker secret, sent only to www.googleapis.com)
   └── Open Library   (fallback when Google can't answer)
```

- The key lives only in the Worker, as a **Secret**. It is never in the page or this repository, and a test fails the build if anything shaped like a key is ever committed.
- Every response and every log line from the Worker is checked: if a secret value ever ended up in one, it's blocked or redacted.
- Only Shelfie's own site may call the Worker (origin allowlist), each visitor is rate-limited (30 searches a minute), and queries are validated (2 to 120 characters) before anything is sent upstream.
- Answers are cached for 6 hours (a week as a fallback), so popular searches don't spend quota.
- Covers load straight from `books.google.com`, which needs no key.
- If the Worker can't be reached, the page searches Open Library directly (no key involved).

### Setting it up (Cloudflare dashboard, no CLI needed)

1. **Google**: in the [Google Cloud console](https://console.cloud.google.com/), enable the **Books API** and create an API key. Under the key's restrictions, set **API restrictions → Restrict key → Books API** only. (Leave application restrictions as "None": calls come from Cloudflare's servers, not a browser.) Optionally set a daily quota cap on the Books API.
2. **Worker**: Workers & Pages → Create → Hello World → name it **`shelf-api`** → Deploy. Then Edit code → paste `worker/worker.js` → Deploy.
3. Settings → Variables and Secrets:

| Name | Type | Value |
|---|---|---|
| `GOOGLE_BOOKS_KEY` | **Secret** | Your Google Books key |
| `ALLOWED_ORIGINS` | Text | `https://parth8.github.io` (the domain only, no path) |
| `REQUIRE_ORIGIN` | Text | `false` only while testing in a browser tab. Remove afterwards. |

4. Check `https://shelf-api.<your-subdomain>.workers.dev/api/health` shows `{"ok":true,"google":true}`.
5. If your Worker's address isn't `https://shelf-api.8parthaggarwal1999.workers.dev`, change it in **two** places at the top of `index.html`: the `api-base` meta tag and `connect-src` in the security policy.

Optionally add a Rate Limiting binding named `LIMITER` for platform-level limits.

## Accounts and sync on the Worker

Accounts and sync codes need a D1 database bound to the Worker. The steps are in [sync.md](sync.md#switching-accounts-on-in-cloudflare).

**Updating the Worker.** Whenever `worker/worker.js` changes, paste the new version into the Worker in the Cloudflare dashboard (Edit code → Deploy). The site on GitHub Pages updates by itself; the Worker doesn't.

## Running it locally

```sh
python3 -m http.server 8765   # then open http://localhost:8765
```

Search goes through the Worker; set it up as above. To publish the site, turn on GitHub Pages for `main` (Settings → Pages → Deploy from a branch → `main`, `/ (root)`).

Tests: see [testing.md](testing.md).

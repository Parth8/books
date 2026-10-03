// A pretend Face ID: makes real P-256 passkeys and signs real WebAuthn answers, so the Worker's
// checks run against genuine cryptography (only the hardware is imaginary).

const te = new TextEncoder();
export const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** A small CBOR writer: unsigned and negative integers, byte and text strings, maps. */
export function cborEncode(v) {
  const out = [];
  const head = (major, n) => {
    if (n < 24) out.push((major << 5) | n);
    else if (n < 256) out.push((major << 5) | 24, n);
    else out.push((major << 5) | 25, n >> 8, n & 255);
  };
  const item = (x) => {
    if (Number.isInteger(x)) return x >= 0 ? head(0, x) : head(1, -1 - x);
    if (x instanceof Uint8Array) return head(2, x.length), out.push(...x);
    if (typeof x === "string") {
      const b = te.encode(x);
      return head(3, b.length), out.push(...b);
    }
    if (x instanceof Map) {
      head(5, x.size);
      for (const [k, val] of x) item(k), item(val);
      return;
    }
    throw new Error(`can't encode ${x}`);
  };
  item(v);
  return new Uint8Array(out);
}

/** r‖s → DER, the way authenticators send ECDSA signatures. */
function rawToDer(raw) {
  const int = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = [...b.slice(i)];
    if (v[0] & 0x80) v = [0, ...v];
    return [0x02, v.length, ...v];
  };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

const sha256 = async (b) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));

export async function fakeAuthenticator({ rpId, origin }) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const credId = crypto.getRandomValues(new Uint8Array(32));
  const prf = crypto.getRandomValues(new Uint8Array(32)); // what PRF would hand back after Face ID
  let count = 0;
  const authData = async (flags, extra = []) => {
    const c = count++;
    return new Uint8Array([...(await sha256(te.encode(rpId))), flags, (c >> 24) & 255, (c >> 16) & 255, (c >> 8) & 255, c & 255, ...extra]);
  };
  return {
    id: b64url(credId),
    prf,
    /** navigator.credentials.create(), answered. */
    async create(challenge, { flags = 0x45, origin: o = origin, type = "webauthn.create" } = {}) {
      const cose = cborEncode(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))], [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))]]));
      const ad = await authData(flags, [...new Uint8Array(16), 0, credId.length, ...credId, ...cose]);
      const clientDataJSON = te.encode(JSON.stringify({ type, challenge, origin: o, crossOrigin: false }));
      const attestationObject = cborEncode(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", ad]]));
      return { id: b64url(credId), clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject) };
    },
    /** navigator.credentials.get(), answered. */
    async get(challenge, { flags = 0x05, origin: o = origin, type = "webauthn.get", tamper = false } = {}) {
      const ad = await authData(flags);
      const clientDataJSON = te.encode(JSON.stringify({ type, challenge, origin: o, crossOrigin: false }));
      const signed = new Uint8Array([...ad, ...(await sha256(clientDataJSON))]);
      const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, signed));
      if (tamper) raw[5] ^= 1;
      return { id: b64url(credId), clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(ad), signature: b64url(rawToDer(raw)) };
    },
  };
}

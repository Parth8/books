// Face ID / Touch ID login, with passkeys (WebAuthn).
//
// Apple never gives a web page (or any app) anything about your face. What it does give is a
// passkey: a key pair made in the phone's secure hardware. Face ID unlocks it; the server only
// ever gets the public half and signatures, so there's nothing on the server to steal and reuse.
// Passkeys sync through your own iCloud Keychain (or password manager), so they work on your
// other devices too.
//
// Your books are end-to-end encrypted with a key that comes from your password, so a signature
// alone can't open them. The PRF extension fixes that: each passkey can produce a secret of its
// own (only after Face ID), and that secret wraps a second copy of your books' key. Logging in
// with Face ID gets that copy back and opens it right here. Needs iOS 18 / macOS 15 or a recent
// Chrome or Edge; where PRF is missing, Face ID isn't offered and your password works as always.

const te = new TextEncoder();
const PRF_SALT = te.encode("shelfie passkey prf v1");

export const b64url = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Can this device do Face ID / Touch ID passkeys with PRF? (Answers false when unsure.) */
export async function passkeysAvailable() {
  try {
    const P = globalThis.PublicKeyCredential;
    if (!P || !globalThis.isSecureContext) return false;
    if (!(await P.isUserVerifyingPlatformAuthenticatorAvailable?.())) return false;
    // Browsers that can say so: is PRF there? Older ones can't say, and mostly don't have it.
    if (typeof P.getClientCapabilities === "function") {
      const caps = await P.getClientCapabilities();
      return caps?.["extension:prf"] !== false;
    }
    return false;
  } catch {
    return false;
  }
}

/** What to call it: Face ID on Apple devices, a passkey elsewhere. */
export const passkeyName = () => (/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) ? "FACE ID" : "PASSKEY");

const prfOf = (cred) => {
  const r = cred.getClientExtensionResults?.()?.prf?.results?.first;
  return r ? new Uint8Array(r) : null;
};

/** The key that wraps the books' key, from a passkey's PRF secret. */
export async function prfKey(secret) {
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: te.encode("shelfie passkey v1"), info: te.encode("shelfie passkey wrap") }, base, { name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]);
}

/** Make a passkey (Face ID prompt). Returns what the server checks, plus the PRF secret. */
export async function createPasskey({ challenge, rpId, user }) {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { id: rpId, name: "Shelfie" },
      user: { id: fromB64url(user.id), name: user.name, displayName: user.name },
      challenge: fromB64url(challenge),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", requireResidentKey: true, userVerification: "required" },
      attestation: "none",
      timeout: 120_000,
      extensions: { prf: { eval: { first: PRF_SALT } } },
    },
  });
  let prf = prfOf(cred);
  if (!prf) {
    // Some browsers only hand the secret out when the passkey is used, not when it's made: use
    // it once, here, for that (a second Face ID glance).
    const again = await navigator.credentials.get({
      publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId, allowCredentials: [{ type: "public-key", id: cred.rawId }], userVerification: "required", timeout: 120_000, extensions: { prf: { eval: { first: PRF_SALT } } } },
    });
    prf = prfOf(again);
  }
  return {
    id: b64url(cred.rawId),
    clientDataJSON: b64url(cred.response.clientDataJSON),
    attestationObject: b64url(cred.response.attestationObject),
    prf,
  };
}

/** Use a passkey (Face ID prompt): any of this site's passkeys on the device. */
export async function usePasskey({ challenge, rpId }) {
  const cred = await navigator.credentials.get({
    publicKey: { challenge: fromB64url(challenge), rpId, userVerification: "required", allowCredentials: [], timeout: 120_000, extensions: { prf: { eval: { first: PRF_SALT } } } },
  });
  return {
    id: b64url(cred.rawId),
    clientDataJSON: b64url(cred.response.clientDataJSON),
    authenticatorData: b64url(cred.response.authenticatorData),
    signature: b64url(cred.response.signature),
    prf: prfOf(cred),
  };
}

/** A cancelled or timed-out prompt: not worth an error message. */
export const cancelled = (err) => err?.name === "NotAllowedError" || err?.name === "AbortError";

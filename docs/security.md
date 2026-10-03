# Security and privacy

- **Strict Content Security Policy.** Scripts load only from this site. The page can connect only to its own Worker (and Open Library as the keyless fallback); images only from the two cover hosts.
- **No untrusted HTML.** Book data is written with `textContent`; only cover addresses from Google Books or Open Library are stored or shown, and the page re-checks everything the Worker sends.
- **Secrets stay server-side.** See above.
- **Nothing readable about you is stored.** No cookies or analytics. Your shelves live on your device. With an account or a sync code, the Worker keeps an encrypted copy it cannot read, and accounts store no username, email, password or IP address in readable form. The Worker keeps no logs of who searched.
- **No token leaks.** Session tokens travel only in an `Authorization` header to Shelfie's own Worker, over HTTPS. They're never put in URLs or cookies, and the server stores only their hashes. Every Worker answer is `no-store`, and anything matching a secret is blocked before it leaves.
- **No referrers to third parties.** Credentials are omitted from API calls.

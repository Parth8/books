# Accounts and sync

Keeping your books safe across devices: accounts (end-to-end encrypted) and the older sync codes.

## Accounts

Log in with a **username (or email) and a password**, and your shelves follow you to any device: phone, laptop, the home-screen app. You → **Sign up** (or straight from onboarding). There are no social features: an account is just your private, encrypted backup.

It's built like a password manager, so a breach of the server gives an attacker nothing readable:

- **Your password never leaves your phone.** The browser stretches it with PBKDF2-SHA256 (600,000 rounds) and splits the result in two:
  - One half is the proof of the password, sent to the server. The server stores it only as a keyed hash (HMAC with a server secret). Guessing a password from a stolen database would need that secret, plus 600,000 rounds per guess.
  - The other half never leaves the device. It unlocks the random key that encrypts your shelves.
- **The server can't read your books.** The shelves are compressed, then encrypted on your phone (AES-256-GCM). The key that encrypts them is stored on the server only in encrypted form. On your device it's a non-extractable key: page code can use it but can't read it out.
- **No personal data stored.** Your username or email is stored only as a keyed hash, never as text, and nobody is ever emailed. Rate-limit counters use hashes, not IP addresses.
- **Sessions.** Each login gets a random token. The server keeps only its SHA-256, and it expires after 30 days unused. Logging out ends it; **log out everywhere** ends them all. Changing your password signs out your other devices.
- **Forgot your password?** When you sign up you get a one-time **recovery code**: copy it, or save it as a file. To make sure you've seen it, you type its last four characters while it's still on screen, so there's nothing to memorise. The code sets a new password and keeps your books. We can't reset a password for you, because we can't read your account; that's the point.
- **Change your username.** You → **Change username** (needs your password). Your books, backup, password and this session stay the same; the old username stops working, and a name that's taken is refused.
- **Lost the recovery code?** While you're logged in on any device, You → Account → **New recovery code** makes a fresh one (it needs your password), and the old one stops working.
- **Lost both** (no password, no code, no logged-in device)? The backup can't be opened by anyone, including us. The books on your phone stay where they are, and you can start a new account from them.
- **Rate limits** on every account action. A quick per-location limit sits in front of durable limits stored in the database, which apply across all of Cloudflare:

  | Action | Limit |
  |---|---|
  | Logins | 20 per address and 10 per account, every 10 minutes |
  | Sign-ups | 5 per address per hour |
  | Recovery | 10 per address and 5 per account, per hour |
  | Backups | 120 per address per minute (in memory, so backups never write rate-limit rows) |

  Wrong passwords lock the account for 1 minute after 5 misses, then 2, 4… up to an hour. Answers carry `Retry-After`.
- **No user enumeration.** A wrong password and an unknown account get the same answer. Unknown accounts get a made-up salt that never changes.
- **Delete your account** (it needs your password): the account, its backup and its sessions are removed for good.

The phone stays the main copy, so the app is instant and works offline. The account is the backup and the bridge between devices. Your whole library takes a few hundred KB on the phone at most, so moving it off wouldn't free anything noticeable; it would only make the app wait on the network.

**How syncing works, and why it's cheap.**
- **Catching up.** When the app opens or comes back on screen (at most once a minute) or you're back online, it reads the backup and merges.
- **Saving.** After changes, it waits until things go quiet (12 seconds), then saves once, with no read first. A burst of page turns is one save, and leaving the app saves straight away. Nothing is sent when nothing changed.
- **Two devices at once.** If both save at the same moment, the second gets the first one's copy back, merges, and saves again. Nothing is overwritten.
- **Retries.** Every save carries an id, so a save retried after a lost answer can't apply twice.
- **Merging.** Each book keeps its newest version. Removals and resets are remembered, so an old copy can't bring them back. Counts take the higher value.

**What it costs.** Cloudflare's free plan allows 100,000 Worker requests, 5 million D1 rows read and 100,000 rows written a day, and 5 GB of storage.

| Action | D1 cost |
|---|---|
| Catching up | 2 rows read |
| Saving | 2 rows read + 1 row written |
| Logging in | 3 rows written: the session, its index, and a rate-limit counter |

A daily reader who opens the app a few times and reads in a few sessions makes about 10–20 requests and 5–10 writes a day. The first free limit to run out is Workers requests, at a few thousand daily readers including search and covers. The $5-a-month Workers plan covers about 300,000 requests a day, and D1 writes would only start costing past 50 million a month.

**Sync codes and their limit.** The older sync codes use Workers KV, whose free plan allows just 1,000 writes a day for everyone. They now save at most once per quiet spell, and new users get accounts instead.

**Why Cloudflare D1 and not DynamoDB.**
- **Credentials.** The Worker reaches D1 through a binding, so there's no access key to store, rotate or leak. DynamoDB would need an AWS key with request signing inside the Worker.
- **Free tier.** D1's (5 GB, 5 million reads and 100,000 writes a day) is far beyond what this needs: a compressed, encrypted library of 1,000 books, descriptions included, is about 120 KB, so 5 GB holds about 40,000 libraries that size.
- **One data blob, not a row per book.** Per-book rows would show the server how many books you have and when you read. They would also cost a write per change, and they can't be end-to-end encrypted.
- **No re-fetching book details.** Title, author and pages are kept with each book rather than fetched from a books API every time. With 300 books, that would be 300 API calls (and a burned quota) just to open the app. Covers are fetched on demand.

### Switching accounts on in Cloudflare

1. **Storage & Databases → D1 → Create database** → name it `shelfie` → Create.
2. **Workers & Pages → shelf-api → Settings → Bindings → Add → D1 database**: variable name **`DB`**, database `shelfie` → Deploy.
3. **Settings → Variables and Secrets → Add**: type **Secret**, name **`AUTH_SECRET`**, value: 32 or more random characters → Deploy. One way to make one is to paste this into any browser console: `crypto.randomUUID() + crypto.randomUUID()`. Never use the Text type for it. Changing it later signs everyone out and stops every password working.
4. **Edit code** → paste the new `worker/worker.js` → Deploy. The tables create themselves on first use.
5. `…/api/health` now shows `"accounts":true`, and the Account section appears in You.

When `worker.js` changes (this round: username changes and cover lookups by title), paste it again and deploy. Tables and new columns are added by themselves.

## Sync codes, and why data seemed to disappear

Your shelves are stored in the browser. Two things made them look lost:

1. **On iPhone, Safari and the home-screen app are different browsers** as far as storage goes. Each has its own, empty, copy. Data added in one never shows in the other.
2. **Phones clear website storage** on their own when space is low or a site hasn't been opened for a while.

On top of that, two copies open at once (two tabs, or Chrome and the installed app on Android) used to overwrite each other. That's fixed: every save now merges with what's already stored, and open copies pick up each other's changes live.

**Accounts** (above) fix the rest. Without an account, a **sync code** still works (shown in You while accounts aren't switched on, or if you already use one): **Turn on sync** creates a sync code on this device. In the other place (the home-screen app, another phone, a laptop) open You → **I have a code** and type it. Both copies merge, and from then on they stay in step: after every change, when the app comes back to the screen, and when you're back online.

- **End-to-end encrypted.** The shelves are encrypted in the browser (AES-256-GCM) with a key derived from the code. The Worker stores only ciphertext under a SHA-256 hash of the code. Neither the code nor anything readable ever reaches the server.
- **Nothing is lost in a merge.** Each book keeps its latest version, removals are remembered (so a removed book doesn't come back from another copy), the reading log keeps the higher count per day, and badges and eggs are pooled.
- **Two devices saving at the same moment** don't overwrite each other: the second one gets the first one's copy back, merges, and saves again.
- The code is the only key. Treat it like a password, and keep it somewhere safe: without it, the synced copy can't be read by anyone, including us.
- The browser is also asked to keep Shelfie's storage persistent, and a damaged saved copy is set aside rather than overwritten.

### Switching sync on in Cloudflare

Sync uses a Workers KV store:

1. Cloudflare dashboard → **Storage & Databases → KV → Create namespace** → name it `shelf-sync` → Create.
2. **Workers & Pages → shelf-api → Settings → Bindings → Add → KV namespace**: variable name **`SYNC`**, namespace `shelf-sync` → Deploy.
3. **Edit code** → paste the new `worker/worker.js` → Deploy.
4. `…/api/health` now shows `"sync":true`.

Synced copies expire after 400 days without a save.

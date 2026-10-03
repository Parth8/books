# Shelfie

**Read, swipe, level up.** A reading tracker you drive with your thumbs: books are postage stamps you flick through, drag up to turn pages and drop onto shelves. Every move is a spring that keeps your finger's speed.

No account, no ads, no build step. Everything lives on your own device.

**Live:** https://parth8.github.io/shelfie/

![Shelfie on a phone: turning pages, dropping a book on a shelf, rating a finished book, stats and search](screenshots/shelfie.jpg)

---

## Where things are

- **The stage and the macropad.** Your books and the keys for them. That's where reading happens.
- **Stats** (pull up the bar at the bottom, or tap the LCD): your level, goals, numbers and stickers. Nothing else.
- **You** (the round avatar, top right): everything about you and your data:
  - your profile animal: slide through the visitors (or use the arrows) and each one says hello in its own voice as it lands;
  - your name, and your **@username** when you're logged in;
  - whether your books are backed up, and your account;
  - your library tools (Goodreads, save a copy, restore a copy);
  - settings, how to use, add to home screen;
  - the danger zone;
  - the chai.

  While your library has no backup, a small orange dot on the avatar says so.

## Learning it

- **The tour.** The first time you open Shelfie, a short tour walks through the gestures and lets you practise each one on a demo stamp. It celebrates when you get it right. It only runs once: it's remembered on the device and in your synced data, so opening the app from the home screen won't show it again.
- **Your name.** After the tour, Shelfie asks what to call you (a first name or nickname, nothing else) so the greetings and jokes can use it. Skip it if you like. Change it any time in You.
- **Keep your books safe.** Then one screen explains where your books live:
  - on your phone (fast, offline);
  - how a free, encrypted account backs them up and moves them to a new phone;
  - what the recovery code is for.

  Sign up, log in, or later.
- **Bring your books.** Then it offers to import your Goodreads library.
- **Explainer pop-ups.** On your first visit, as you meet each part of the app (the pass, the macropad, the shelf tape, the LCD, the stats bar), the screen dims around it and a bright bubble says what it does. They come on that first visit only. A tip that couldn't show then is skipped, not saved for later.
- **Gesture hints.** A small chip with a ghost finger shows the next gesture you haven't tried yet. Tap it to dismiss it. Each hint shows on at most two app opens, and hints stop altogether after your first three opens. Finishing the tour counts as having learnt the gestures it practised.
- **Remembered everywhere.** What you've seen is kept in your data, so it syncs with your account: the home-screen app, another browser or a new phone won't explain it all again.
- **Replaying it.** You → **How to use** replays the tour or brings the pop-ups back.

## Import from Goodreads

Bring a whole Goodreads library across in about two minutes. Open the importer from the 🧳 **GOODREADS** key while your library is empty, from the onboarding offer, or any time from You → Library.

1. Open [goodreads.com/review/import](https://www.goodreads.com/review/import) in a browser (the export isn't in the Goodreads app).
2. Tap **Export Library** and wait for the download link (a few minutes for big libraries).
3. Pick `goodreads_library_export.csv` in Shelfie.

Before anything is added, you see how many books are on each shelf.

- **Shelves.** Read, Currently Reading and Want to Read map across. Custom shelves land on Want.
- **Dates and ratings.** Finish dates come with your books, so this year's count and your yearly goal are right straight away. Star ratings come across too, which you can switch off.
- **Duplicates.** Books already on your shelves (matched by ISBN, or title and author) are skipped, so importing twice is harmless.
- **Covers.** These come from Open Library by ISBN.
- **Privacy.** The file is read on your device and never uploaded.

Big libraries stay smooth: only the few stamps near the top of the pile exist on the page at any time.

## Reset, and the danger zone

You → Danger zone has **levers**, not buttons. Grab the red ball and pull it all the way down. Let go early and it springs back, with a ratchet click on the way. The lever is the "are you sure?".

- **Reset.** If your books are backed up, it asks what to reset:
  - **Just this phone.** Wipes this phone and logs you out here. Your account backup stays: log in again and it all comes back.
  - **Phone + backup.** Wipes this phone and your account backup, and your other devices empty too when they next sync. You stay logged in.

  Either way, a red warning says it can't be undone, and only unlocks once you type `reset`. Sound and haptics settings stay. Without a backup, it goes straight to that warning.
- **Delete account** (only while you're logged in): needs your password. The account, its backup and its sessions are removed. The books on this phone stay.

## Save a copy, restore a copy

You → Library:

- **Save a copy** downloads a file with everything. It's handy for safekeeping and works with no account.
- **Restore a copy** adds the books from such a file. Nothing on this phone is deleted, and the file's books come back even if this phone was reset or they were removed since.

## Gestures

| Where | Gesture | What happens |
|---|---|---|
| The pile | **swipe ← / →** | Flip to the next or previous book. The cards behind follow your finger, and a flick carries on. The **+ stamp is always last**. |
| A book you're reading | **drag ↑ / ↓** | Turn pages. The cover fills with liquid that splashes as you go, and a fast flick keeps turning for a moment. |
| Any book | **hold, then drag** | Lift it. Drop zones appear: WANT, READING, FINISHED, REMOVE. They pull the book in like magnets. A removal can be undone by tapping the island. |
| Any book | **tap** | Turn the stamp over to see the back: pages, dates, genre, blurb. |
| Any book | **double-tap** | Poke it for an easter egg. |
| The + stamp | **pull ↑** (or tap) | Open search. |
| The page dial | **spin** | Every notch is a page, with a tick. Let go mid-spin and it coasts. |
| The shelf name | **drag ← / →** | Switch shelves. The stage colour flows between them as you drag. |
| The bottom bar | **pull ↑** | Stats. Fling the panel back down to close it. |
| A search result | **swipe →** | Swipe further for a later shelf: WANT, then READING, then READ. Tap adds to Want. |
| A poster | **swipe away** | Big moments (finishing a book, levelling up, smashing your daily goal) take over the screen. |

New gestures are taught as you go: a small chip with a ghost finger shows the next one you haven't tried, and it disappears for good once you've done it.

Everything also works from a keyboard: arrows flip the pile and turn pages, the dial and the goal ring are sliders, Enter turns a stamp over, Escape closes panels.

## The look

Built from the moodboard: tactile neo-brutalism on near-black.

- **Arcade passes**: every book is a retro arcade ticket in fluorescent card stock, chosen per book and never the colour of the stage behind it.
  - **Front:** "★ ADMIT ONE ★", your progress shown like credits, a holographic foil strip, and ticket notches at a dashed tear line.
  - **Stub:** a serial number, a barcode, and NOW PLAYING / UP NEXT / HIGH SCORE.
  - **Finished books** get a hole punched through the stub and a red "READ ✓" rubber stamp.
  - **The back** is the fine print (pages, dates, genre, blurb), with a **Find on Amazon** button.
  - **The + pass** says INSERT COIN.
- **The macropad**: the dock is a cream keyboard with chunky keycaps, a green pixel LCD and a knob with a glowing ring.
- **Feeling keys**: rate finished books with glossy emoji keycaps (🫠 😐 🙂 😍 🤯).
- **Posters**: full-screen flat colour with giant condensed type that slams in line by line.
- **Bento stats**: level, streak, a watch-face goal ring (spin it to set your goal), the week, totals, and badges as stickers.
- **Generated covers**: books without a cover (and any cover still loading) get grainy gradient art with a bold shape (flower, cube, sun, rings, stripes, dots), picked from the title so it's always the same.

Fonts: Archivo (condensed, heavy), Space Mono and Silkscreen, all self-hosted.

## Goals

Three goals, set by spinning their rings in Stats (or with the arrow keys):

- **Today**: pages a day (default 20)
- **This month**: books finished (default 2)
- **This year**: books finished (default 24)

The LCD cycles through all three. Crossing one takes over the screen with a poster, and earns a badge for the month and year goals.

## Sound and haptics

Every interaction has a synthesised sound (no audio files) and a haptic: page ticks as you scrub, detents on the dial, keycap clicks, swooshes, a postmark thunk, coins for XP, fanfares for finishing and levelling up. Read in bursts and a **combo** builds up. Android vibrates; iPhone (which has no vibration API) gets the system tap through a hidden iOS 18 switch control. Both can be switched off in You → Settings.

- **Sound needs a tap first.** Browsers only allow sound after you touch the page, so the audio engine wakes on your first touch and re-wakes whenever the app comes back to the foreground.
- **iPhone silent switch.** On an iPhone with the silent switch on, web sounds are muted by iOS, but haptics still play.

## Gamification

- **XP**: 1 per page, 20 for adding a book, 10 for starting one, 100 for finishing, 15 per easter egg, 10 for rating. Only pages beyond your furthest point count, so scrubbing back and forth can't farm XP.
- **Levels**, from Fresh Spine to Literary Final Boss.
- **Daily goal**, **streaks**, and **20 badges**. Earned badges peel off the sheet as die-cut **stickers**.
- **Combos**: log pages in quick bursts for a ×2, ×3… combo sticker. ×5 is ON FIRE.
- **Quips**: greetings and reactions that change with the time of day, and use your name if you gave one.
- **The island**: a black capsule that stretches open from its middle to show XP counting up, badges and streaks.

## Visitors

Every few minutes, never while you're busy, an animal wanders across the bottom of the screen with its own sound and a terrible pun: a llama, a horse, a duck, a cat, a dino, a snail, a hedgehog, a penguin, a turtle, a flamingo, or (rarely) a unicorn. Tap one to pet it. Pet three different ones for the Zookeeper sticker. Turn them off in You → Settings → Visitors.

## Easter eggs

Double-tap a cover. Some books have their own trick (Harry Potter, Dune, The Hobbit, 1984, Gatsby, Alice, Hitchhiker's Guide, Moby-Dick, Sherlock, dragons, space, romance); everything else gets a party trick, and five fast pokes is a supernova. Each one pays XP once per book. Two more are hidden in the app itself: tap the LCD five times quickly, and the Konami code.

---

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

## Security and privacy

- **Strict Content Security Policy.** Scripts load only from this site. The page can connect only to its own Worker (and Open Library as the keyless fallback); images only from the two cover hosts.
- **No untrusted HTML.** Book data is written with `textContent`; only cover addresses from Google Books or Open Library are stored or shown, and the page re-checks everything the Worker sends.
- **Secrets stay server-side.** See above.
- **Nothing readable about you is stored.** No cookies or analytics. Your shelves live on your device. With an account or a sync code, the Worker keeps an encrypted copy it cannot read, and accounts store no username, email, password or IP address in readable form. The Worker keeps no logs of who searched.
- **No token leaks.** Session tokens travel only in an `Authorization` header to Shelfie's own Worker, over HTTPS. They're never put in URLs or cookies, and the server stores only their hashes. Every Worker answer is `no-store`, and anything matching a secret is blocked before it leaves.
- **No referrers to third parties.** Credentials are omitted from API calls.

---

## Find on Amazon

Every pass has a **Find on Amazon** button on its back (tap a pass to turn it over), and books on the Want shelf get a 🛒 **GET IT** key on the macropad. It searches Amazon India for the ISBN when the book has one, otherwise for the title and author. It opens in a new tab, with no referrer and nothing about you attached.

## Motion controls

Switch on You → Settings → **Motion controls** (iPhone asks for permission, which is why it's a switch). Then:

| Move | What it does |
|---|---|
| **Flick** the phone right / left | Next / previous book |
| **Twist** it like a steering wheel | Next / previous shelf |
| **Flick up** | Add a book |
| **Tilt** | The pile leans in 3D, the background shifts, the bulbs and fairy lights swing, and a hotspot of light slides across the cover |

- **Learning the moves.** A guide with little animated phones shows each move. The first couple of times you use a move, the island says what it did.
- **When moves are ignored.** While you're dragging, typing, or have a panel, pop-up or poster open. There's also a short cooldown after each one, so one flick is one book.
- **Level is relative.** "Level" is however you're holding the phone, learnt over a couple of seconds.
- **Privacy.** Nothing about how you move your phone is stored or sent.
- **Reduce Motion.** With Reduce Motion on, tilt effects are off; the moves still work.
- **Introducing it.** On a phone that supports it, Shelfie shows it off once, on a later visit.

## The arcade

- **Keycaps.** Sculpted and glossy, with a streak of light like translucent keycaps. They press down fast and bounce back up, with a coloured glow underneath that brightens while you hold.
- **Round arcade buttons** for adding pages (+1, +5, +10, +25), and a ▶ on START.
- **Fairy lights** strung over the macropad twinkle at their own pace. They chase on big moments: finishing a book, a goal, a level, a sticker, an import, a jackpot.
- **Neon.** The shelf you're on glows like a sign, hangs a little crooked, and flickers now and then.
- **Edison bulbs.** Warm filament bulbs hang on drooping wires behind the shelf name (backlighting it) and over every panel title, and one dangles off each section heading. Every second or two a random bulb stutters, as if the wiring's dodgy. Headings hang slightly crooked, like hand-hung signs.
- **Levers** in the danger zone.
- **Jackpot.** Now and then, reading pays out bonus XP with an arcade poster. It happens at most once every ten minutes, so it stays a surprise.

## Motion, and keeping the phone cool

Shelfie keeps moving while it's open, even when you're just looking:
- the liquid ripples;
- the cover on top drifts slowly;
- the LED blinks;
- the shelf name scrolls behind the pile;
- the + stamp breathes;
- the lights twinkle;
- the critters wander.

Every few seconds of quiet, something fidgets: the stamp wiggles, the dial ring glows, the keys hop, the liquid sloshes. Springs are tuned to glide (about half a second, with a little overshoot) rather than snap.

It's built so that motion stays cheap:

- **On the GPU.** Ambient animations move or fade whole layers (transform and opacity only), and glows are pre-blurred layers that only fade. The cover art's own shapes (SVG, which the CPU draws) dance for 12 seconds when a stamp lands on top. After that, the GPU drift takes over.
- **A gentle liquid.** At rest, the liquid redraws 25 times a second on a timer, so the browser idles in between.
- **Panels.** While a panel (Stats, You, search) is open, the stage behind it holds still, so the panel gets the whole frame budget. Panels don't blur what's behind them; they dim it. Stats is built in idle time ahead of use, so pulling it up does no heavy work.
- **Measured.** Pulling Stats up with the CPU slowed 4× now has 1–4 long frames instead of 11–19.
- **Reduced Motion.** With Reduce Motion switched on in your phone's settings, all of this stops.

## Sharp covers

- **No more softening.** Covers were going soft because the slow "drift" zoomed an image that was already drawn. It now slides instead, and the image is drawn a little larger than its window.
- **A sharper copy by title and author.** Any book without a Google cover (starter books, Open Library books, Goodreads imports) asks the Worker once for one, by ISBN or else by title and author. Only the same title counts (a subtitle is fine), so you never get a lookalike.
- **Sheen.** A glint sweeps across the cover on top every 5–10 seconds, each book on its own rhythm, and a soft hotspot follows the tilt of your phone.
- **Google Books covers** are requested at the size your screen needs, up to 1080 × 1620, so zooming in stays crisp.
- **Why the lookup exists.** Open Library's largest covers are only 325 × 500, too soft for a phone screen. Each lookup answer is remembered on your device and cached at Cloudflare's edge for a month, so a book is looked up once. Search results never trigger lookups.

## Home screen, and chai

- **Add to home screen.** You → **Add to home screen** shows a guide that matches your browser: pictures for iPhone and iPad Safari (including iOS 26's ••• menu) and Mac Safari, steps for Firefox, Edge and Chrome on iPhone, and the one-tap install button where Chrome or Edge offer one. Apps' built-in browsers get an "Open in Safari" link. It's offered once on a later visit (never the first), and once more at most two weeks later. After that it's only the **Add to home screen** row in You, and it disappears once Shelfie is installed.
- **Chip in for a chai.** A ticket at the very bottom of You, after everything else. It's never a pop-up and never in the way of reading.

---

## How it's built

Plain HTML, CSS and native ES modules, served as static files (GitHub Pages works).

```
index.html            Shell, security policy, panels
styles.css            The whole look, and every CSS animation
js/
  main.js             Wires gestures to state: HUD, shelf tape, pile, dock, stats, search, secrets
  store.js            All data and rules: books, reading log, XP, levels, streaks, badges (no DOM)
  physics.js          Springs, finger velocity, rubber bands: the motion engine
  deck.js             The pile and its gestures (swipe, scrub, hold-and-drop, tap, double-tap, pull)
  stamp.js            Stamps, postmarks, generated cover art
  liquid.js           The liquid that fills a cover: a spring surface that splashes and sloshes
  knob.js             The page dial
  panel.js            Pull-up panels
  poster.js           Full-screen celebrations
  island.js           The capsule at the top
  hints.js            Gesture hints with a ghost finger
  eggs.js             Easter eggs
  confetti.js         Confetti on one canvas
  search.js           Search through the Worker, Open Library if it can't be reached
  sync.js             End-to-end encrypted sync: codes, key derivation, AES-GCM, merge rounds
  sfx.js              Synthesised sounds, and haptics (Android vibration, iPhone's system tap)
  tutorial.js         The hands-on tour
  modal.js            Pop-ups (questions, the name, the two-step reset)
  tips.js             Spotlight explainer pop-ups, each shown once
  quips.js            Greetings and jokes, with your name
  critters.js         The animals that wander by
  goodreads.js        Reads a Goodreads export (CSV) into books
  account.js          Accounts: key derivation, wrapped keys, compressed + encrypted backups, sessions
  covers.js           Sharp covers: sizes for Google covers, HD lookups by ISBN or title
  install.js          How this browser adds a web app to the home screen (from the track app)
  guide.js            Picture guides for adding to the home screen on Apple devices
  home.js             The add-to-home-screen pop-up and the chai card
  lever.js            The arcade lever (pull all the way down to confirm)
  lights.js           Edison bulbs and their random stutters
  gyro.js             Motion controls: tilt, flick, twist, lift
  util.js             Safe DOM builder, seeded random
worker/worker.js      The Cloudflare Worker: holds the Google key, searches, covers, accounts (D1), encrypted backups
tests/
  store.test.mjs      Rules (node --test)
  search.test.mjs     Turning search answers into books
  worker.test.mjs     The Worker: key handling, redaction, origin, rate limits, fallback, sync store
  sync.test.mjs       Sync codes and encryption
  goodreads.test.mjs  Goodreads CSV parsing, importing, names, reset
  accounts.test.mjs   Accounts end to end: the browser's crypto against the real Worker and real SQL
  helpers/d1.mjs      A D1 stand-in on Node's built-in SQLite
  no-secrets.test.mjs Fails if anything shaped like a key is committed
  app.e2e.mjs         The whole app with real pointer gestures (Playwright, searches stubbed)
tools/build-icons.mjs App icons from one SVG mark
```

All page text goes through `textContent`, so a title from a search can never become HTML, and only cover addresses from Google Books or Open Library are stored or shown.

Data is saved in `localStorage` under `shelf.v1` (back it up or restore it from the stats panel).

---

## Running it

```sh
python3 -m http.server 8765   # then open http://localhost:8765
```

Search goes through the Worker; set it up as above. To publish the site, turn on GitHub Pages for `main` (Settings → Pages → Deploy from a branch → `main`, `/ (root)`).

### Tests

```sh
npm test                                         # unit tests, no install needed
python3 -m http.server 8765 &                    # browser tests need the site running
NODE_PATH=$(npm root -g) node tests/app.e2e.mjs  # and Playwright installed globally
```

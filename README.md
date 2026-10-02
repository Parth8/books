# Shelfie

**Read, swipe, level up.** A reading tracker you drive with your thumbs: books are postage stamps you flick through, drag up to turn pages and drop onto shelves. Every move is a spring that keeps your finger's speed.

No account, no ads, no build step. Everything lives on your own device.

**Live:** https://parth8.github.io/shelfie/

![Shelfie on a phone: turning pages, dropping a book on a shelf, rating a finished book, stats and search](screenshots/shelfie.jpg)

---

## Learning it

- **The tour.** The first time you open Shelfie, a short tour walks through the gestures and lets you practise each one on a demo stamp. It celebrates when you get it right. It only runs once: it's remembered on the device and in your synced data, so opening the app from the home screen won't show it again.
- **Your name.** After the tour, Shelfie asks what to call you (a first name or nickname, nothing else) so the greetings and jokes can use it. Skip it if you like. Change it in Stats → Settings.
- **Bring your books.** Then it offers to import your Goodreads library or link another device with a sync code.
- **Explainer pop-ups.** The first time you meet each part of the app (the stamp, the macropad, the shelf tape, the LCD, the stats bar), the screen dims around it and a bright bubble says what it does.
- **Gesture hints.** A small chip with a ghost finger shows the next gesture you haven't tried yet.
- **Replaying it.** The **?** button next to the LCD replays the tour or brings the pop-ups back.

## Import from Goodreads

Bring a whole Goodreads library across in about two minutes. Open the importer from the 🧳 **GOODREADS** key on an empty shelf, from search, or from Stats → Import.

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

## Reset

Stats → Settings → **⚠ RESET ALL** wipes every book, page, goal, XP, badge and sticker on the device. It asks twice:

1. A "are you sure?" pop-up, where **No** leaves everything alone.
2. A red warning that the data can't be recovered, which only unlocks once you type `reset`.

Sound and haptics preferences stay. If sync is on, it's switched off on this device, and the synced copy stays for your other devices.

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

- **Stamps**: every book is a perforated postage stamp with a big denomination (how far through you are) and its title in heavy condensed type. Finished books get **postmarked**.
- **The macropad**: the dock is a cream keyboard with chunky keycaps, a green pixel LCD and a knob with a glowing ring.
- **Feeling keys**: rate finished books with glossy emoji keycaps (🫠 😐 🙂 😍 🤯).
- **Posters**: full-screen flat colour with giant condensed type that slams in line by line.
- **Bento stats**: level, streak, a watch-face goal ring (spin it to set your goal), the week, totals, and badges as mini stamps.
- **Generated covers**: books without a cover (and any cover still loading) get grainy gradient art with a bold shape (flower, cube, sun, rings, stripes, dots), picked from the title so it's always the same.

Fonts: Archivo (condensed, heavy), Space Mono and Silkscreen, all self-hosted.

## Goals

Three goals, set by spinning their rings in Stats (or with the arrow keys):

- **Today**: pages a day (default 20)
- **This month**: books finished (default 2)
- **This year**: books finished (default 24)

The LCD cycles through all three. Crossing one takes over the screen with a poster, and earns a badge for the month and year goals.

## Sound and haptics

Every interaction has a synthesised sound (no audio files) and a haptic: page ticks as you scrub, detents on the dial, keycap clicks, swooshes, a postmark thunk, coins for XP, fanfares for finishing and levelling up. Read in bursts and a **combo** builds up. Android vibrates; iPhone (which has no vibration API) gets the system tap through a hidden iOS 18 switch control. Both can be switched off in Stats → Settings.

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

Every few minutes, never while you're busy, an animal wanders across the bottom of the screen with its own sound and a terrible pun: a llama, a horse, a duck, a cat, a dino, a snail, a hedgehog, a penguin, a turtle, a flamingo, or (rarely) a unicorn. Tap one to pet it. Pet three different ones for the Zookeeper sticker. Turn them off in Stats → Settings → Visitors.

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

## Sync, and why data seemed to disappear

Your shelves are stored in the browser. Two things made them look lost:

1. **On iPhone, Safari and the home-screen app are different browsers** as far as storage goes. Each has its own, empty, copy. Data added in one never shows in the other.
2. **Phones clear website storage** on their own when space is low or a site hasn't been opened for a while.

On top of that, two copies open at once (two tabs, or Chrome and the installed app on Android) used to overwrite each other. That's fixed: every save now merges with what's already stored, and open copies pick up each other's changes live.

**Sync** fixes the rest. Stats → Sync & backup → **Turn on sync** creates a sync code on this device. In the other place (the home-screen app, another phone, a laptop) open Stats → **I have a code** and type it. Both copies merge, and from then on they stay in step: after every change, when the app comes back to the screen, and when you're back online.

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
- **Nothing about visitors is stored.** No accounts, cookies or analytics. Your shelves live in `localStorage` on your device. If you turn on sync, the Worker keeps an encrypted copy it cannot read. The Worker keeps no logs of who searched.
- **No referrers to third parties.** Credentials are omitted from API calls.

---

## Performance

Shelfie does nothing at all when you aren't touching it, so it doesn't drain the battery or warm the phone:

- **No idle loops.** The liquid stops its animation loop once it's calm. A stamp's cover art animates for a few seconds after it reaches the top, then rests.
- **Cheap shadows and grain.** Shadows are pre-blurred layers instead of live filters, and the grain is a static background.
- **Blur only when needed.** The background blur only exists while a panel is open.
- **A windowed pile.** Only the stamps near the top of the pile exist on the page, whatever the size of your library.

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
  util.js             Safe DOM builder, seeded random
worker/worker.js      The Cloudflare Worker: holds the Google key, searches, caches, stores encrypted sync copies
tests/
  store.test.mjs      Rules (node --test)
  search.test.mjs     Turning search answers into books
  worker.test.mjs     The Worker: key handling, redaction, origin, rate limits, fallback, sync store
  sync.test.mjs       Sync codes and encryption
  goodreads.test.mjs  Goodreads CSV parsing, importing, names, reset
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

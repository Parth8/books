# Shelfie

**Read, swipe, level up.** A reading tracker you drive with your thumbs: books are postage stamps you flick through, drag up to turn pages and drop onto shelves. Every move is a spring that keeps your finger's speed.

No account, no ads, no build step. Everything lives on your own device.

![Shelfie on a phone: turning pages, dropping a book on a shelf, rating a finished book, stats and search](screenshots/shelfie.jpg)

---

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

## Gamification

- **XP**: 1 per page, 20 for adding a book, 10 for starting one, 100 for finishing, 15 per easter egg, 10 for rating. Only pages beyond your furthest point count, so scrubbing back and forth can't farm XP.
- **Levels**, from Fresh Spine to Literary Final Boss.
- **Daily goal**, **streaks**, and **13 badges**.
- **The island**: a black capsule that stretches open from its middle to show XP counting up, badges and streaks.

## Easter eggs

Double-tap a cover. Some books have their own trick (Harry Potter, Dune, The Hobbit, 1984, Gatsby, Alice, Hitchhiker's Guide, Moby-Dick, Sherlock, dragons, space, romance); everything else gets a party trick, and five fast pokes is a supernova. Each one pays XP once per book. Two more are hidden in the app itself: tap the LCD five times quickly, and the Konami code.

---

## Book search: Google Books

Search uses the [Google Books API](https://developers.google.com/books/docs/overview). Covers come from Google at 480×720.

**Add an API key.** Without one, Google refuses most requests (its shared anonymous quota is usually used up). It's free:

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Books API**.
2. Create an **API key** under Credentials, and restrict it to **HTTP referrers** (your site's address, for example `https://parth8.github.io/books/*`) and to the Books API.
3. Put it in `index.html`:
   ```html
   <meta name="google-books-key" content="YOUR_KEY">
   ```

A browser key is visible to anyone who opens the page; the referrer restriction is what keeps it yours.

If Google can't answer (no key, over quota, offline, nothing found), search **falls back to Open Library** automatically, and says which one answered under the results.

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
  search.js           Google Books, with Open Library as the fallback
  util.js             Safe DOM builder, seeded random
tests/
  store.test.mjs      Rules (node --test)
  search.test.mjs     Turning search answers into books
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

To publish, turn on GitHub Pages for `main` (Settings → Pages → Deploy from a branch → `main`, `/ (root)`).

### Tests

```sh
npm test                                         # unit tests, no install needed
python3 -m http.server 8765 &                    # browser tests need the site running
NODE_PATH=$(npm root -g) node tests/app.e2e.mjs  # and Playwright installed globally
```

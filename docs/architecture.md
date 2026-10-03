# Architecture

Plain HTML, CSS and native ES modules, served as static files (GitHub Pages works). There's no build step: what's in the repo is what runs.

```
index.html          The shell: security policy, panels, and the stylesheets in order
css/                The look, one file per part of the screen (order matters, see below)
app/                The screen: wires gestures and panels to your data
js/                 Building blocks: data rules, physics, components, each usable on its own
worker/worker.js    The Cloudflare Worker: holds the Google key, search, covers, accounts, sync
tests/              Unit tests (node --test) and browser tests (Playwright)
docs/               These docs
tools/              App icons from one SVG mark
```

## app/: the screen

`app/boot.js` is the entry point. It loads your shelves and builds what you see first, the LCD and shelf tape and the pile, then calls each module's start-up function.

| Module | What it does |
|---|---|
| `boot.js` | Entry point. HUD (LCD, shelf tape), the pile, drop zones, start-up |
| `state.js` | The live state, signed-in account and sync engine; the only place they're replaced |
| `celebrate.js` | `commit()`: every change goes through it to be saved, backed up and celebrated |
| `reading.js` | Turning pages: drag up on a book, with momentum; saves the page after you stop |
| `dock.js` | The macropad under the pile: page dial and keys, START / SHUFFLE, feeling keys |
| `stats.js` | The Stats panel: bento tiles, goals, the week, stickers |
| `adding.js` | The search panel and the starter stack |
| `settings.js` | The ME panel: profile, keeping your books safe, settings, danger zone |
| `accounts.js` | Sign up, log in, recovery codes, deleting an account |
| `backup.js` | Sync codes, and applying changes that arrive from another device |
| `import.js` | Goodreads import |
| `reset.js` | The two-step reset |
| `onboarding.js` | First run: the tour, your name, tips, the home-screen offer |
| `motion.js` | Motion controls: tilt and gestures |
| `ambient.js` | Idle fidgets and visitors |
| `secrets.js` | Party mode and the Konami code |
| `panels.js` | Which panels are up (the stage holds still behind them) |
| `api.js` | Where the Worker lives |

**How modules fit together.** Modules import each other freely; ES modules allow cycles. Because `boot.js` is the entry point, every other module is evaluated before boot's own body runs. So:

- A module's top level may declare functions and values, and wire up its own elements.
- Anything that reads the state or another module's values runs inside a function. Boot's start-up section (`startOnboarding()`, `startMotion()`, `listenForKeys()`) calls these once everything exists.
- The shared state is read through live bindings (`import { state } from "./state.js"` always sees the latest) and replaced only with `setState()`.

## js/: building blocks

| Module | What it does |
|---|---|
| `store.js` | All data and rules: books, reading log, XP, levels, streaks, badges (no DOM) |
| `physics.js` | Springs, finger velocity, rubber bands: the motion engine |
| `deck.js` | The pile and its gestures (swipe, scrub, hold-and-drop, tap, double-tap, pull) |
| `stamp.js` | Passes (tickets), generated cover art |
| `liquid.js` | The liquid that fills a cover: a spring surface that splashes, then rests |
| `knob.js` | The page dial |
| `panel.js` | Pull-up panels |
| `poster.js` | Full-screen celebrations |
| `island.js` | The capsule at the top |
| `hints.js` | Gesture hints with a ghost finger |
| `tips.js` | Spotlight explainer pop-ups, each shown once |
| `tutorial.js` | The hands-on tour |
| `modal.js` | Pop-ups (questions, the name, the two-step reset) |
| `confetti.js` | Confetti on one canvas: cached sprites, time-based physics |
| `grain.js` | The film-grain texture, drawn once |
| `lights.js` | Edison bulbs and their random stutters |
| `gyro.js` | Motion sensors: smoothed tilt, and the gesture reader |
| `sfx.js` | Synthesised sounds, and haptics |
| `search.js` | Search through the Worker, Open Library if it can't be reached |
| `covers.js` | Sharp covers: sizes for Google covers, HD lookups by ISBN or title |
| `sync.js` | End-to-end encrypted sync codes: key derivation, AES-GCM, merge rounds |
| `account.js` | Accounts: username, email and password; key derivation, wrapped keys, encrypted backups, sessions |
| `passkey.js` | Face ID / Touch ID login with passkeys (WebAuthn, with PRF to unlock the encrypted books) |
| `goodreads.js` | Reads a Goodreads export (CSV) into books |
| `eggs.js` | Easter eggs |
| `critters.js` | The animals that wander by |
| `quips.js` | Greetings and jokes, with your name |
| `install.js`, `guide.js`, `home.js` | Adding to the home screen, and the chai card |
| `lever.js` | The arcade lever |
| `util.js` | Safe DOM builder, seeded random |

## css/: the look

`index.html` links the stylesheets in a fixed order, and **the order matters**: later files refine rules in earlier ones. The order is the order of the original single stylesheet, so nothing changed when it was split. `tokens.css` comes first (fonts, colours, sizes as custom properties) and `layers.css` last (rendering-cost overrides).

They're separate `<link>` tags, not `@import`, so the browser fetches them all at once.

To restyle something, find its file by the part of the screen: `deck.css` for passes, `dock.css` for the macropad, `tickets.css` for the arcade-pass look, and so on. Then check the later files for anything that refines it (`grep -n "selector" css/*.css`).

## Data

- Saved in `localStorage` under `shelf.v1`. Back it up or restore it from the ME panel.
- All page text goes through `textContent`, so a title from a search can never become HTML.
- Only cover addresses from Google Books or Open Library are stored or shown.

See [sync.md](sync.md) for accounts and sync, and [security.md](security.md) for the security model.

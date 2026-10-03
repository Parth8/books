# Testing

```sh
npm test                                         # unit tests (node --test), no install needed
python3 -m http.server 8765 &                    # the browser tests need the site running
NODE_PATH=$(npm root -g) node tests/app.e2e.mjs  # and Playwright installed globally
```

Options for the browser tests:

| Variable | What it does |
|---|---|
| `SITE=http://localhost:8766/` | Test a server on another port |
| `ONLY="motion controls"` | Run only the tests whose name contains this |
| `SLOW=4` | Slow the CPU 4× (like a mid-range phone) to catch timing bugs and jank |

## What's covered

| File | What it checks |
|---|---|
| `tests/store.test.mjs` | The rules: books, reading log, XP, levels, streaks, badges, merging |
| `tests/search.test.mjs` | Turning search answers into books |
| `tests/gyro.test.mjs` | Reading motion gestures: replays a recording from a real iPhone (`tests/fixtures/motion-iphone.json`), so flicks and bounces must fire and walking, picking up or slow tilting must not |
| `tests/worker.test.mjs` | The Worker: key handling, redaction, origin checks, rate limits, fallback, the sync store |
| `tests/sync.test.mjs` | Sync codes and encryption |
| `tests/goodreads.test.mjs` | Goodreads CSV parsing, importing, names, reset |
| `tests/accounts.test.mjs` | Accounts end to end: the browser's crypto against the real Worker and real SQL |
| `tests/helpers/d1.mjs` | A D1 stand-in on Node's built-in SQLite |
| `tests/no-secrets.test.mjs` | Fails if anything shaped like a key is committed |
| `tests/app.e2e.mjs` | The whole app in Chromium with real pointer gestures, sensor events and stubbed searches |

CI runs the unit tests and the browser tests on every push.

## Recording real motion

`motion-lab.html` (not linked from the app, deleted before launch: see [launch.md](launch.md)) walks through each phone gesture and records what Safari's motion sensors report: orientation, rotation rate, acceleration with and without gravity, how often readings arrive, and the screen's rotation. Open `…/shelfie/motion-lab.html` on the phone, follow the steps, and share the file. Motion controls are tuned against these recordings, and they become test fixtures.

## Checking smoothness

Correctness tests can't tell you whether something stutters. When changing anything that moves:

- **Layers.** In Chrome DevTools → Layers (or the Rendering tab's "Layer borders"), the idle screen should have about 25 layers and well under 64 MB of layer memory. Full-screen layers that sit there unused are the usual culprit.
- **Paint.** Rendering → "Paint flashing": at rest, almost nothing should flash. Anything that flashes every frame is painting on the CPU.
- **Frames.** Performance tab with CPU 4× slowdown: swiping, scrubbing and pulling a panel should show no long frames.
- **On an iPhone.** Safari → Develop → (your phone) → Timelines, record while you use it. That's the ground truth: desktop Chrome hides most of what makes an iPhone stutter.

The rules these checks enforce are in [performance.md](performance.md).

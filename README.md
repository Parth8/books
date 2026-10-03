# Shelfie

**Read, swipe, level up.** A reading tracker you drive with your thumbs: books are arcade passes you flick through, drag up to turn pages and drop onto shelves. Every move is a spring that keeps your finger's speed.

No ads, no build step. Accounts are optional: without one, everything stays on your own device.

**Live:** https://parth8.github.io/shelfie/

![Shelfie on a phone: turning pages, dropping a book on a shelf, rating a finished book, stats and search](screenshots/shelfie.jpg)

## Docs

| | |
|---|---|
| [Interactions](docs/interactions.md) | Every gesture, screen and reward: the pile, turning pages, shelves, motion controls, goals, stickers, easter eggs |
| [Architecture](docs/architecture.md) | How the code is laid out (`app/`, `js/`, `css/`) and how the modules fit together |
| [Performance](docs/performance.md) | How it stays smooth: the rules every animation follows |
| [Accounts and sync](docs/sync.md) | Keeping your books safe across devices, end-to-end encrypted |
| [Security and privacy](docs/security.md) | Keys, encryption, what the Worker can and can't see |
| [Deployment](docs/deployment.md) | GitHub Pages, and setting up the Cloudflare Worker |
| [Testing](docs/testing.md) | Unit and browser tests, and checking smoothness |

## Quick start

```sh
python3 -m http.server 8765   # then open http://localhost:8765
npm test                      # unit tests
```

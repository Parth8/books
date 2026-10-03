# Interactions

How you use Shelfie: every gesture, screen and little reward.

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

## Motion controls

Switch on You → Settings → **Motion controls** (iPhone asks for permission, which is why it's a switch). Then:

| Move | What it does |
|---|---|
| **Flick** the phone right / left and straight back: turn it to face right, or snap it clockwise like a dial | Next book (the top pass flies off to the right) / previous book (it comes back from the right) |
| **Tip** the top edge away from you and back / towards you and back | Next / previous shelf |
| **Bounce** it: a quick bounce up and down | Add a book |
| **Tilt** | The pile leans in 3D, the background shifts the other way, the fairy lights lean, the bulbs swing like pendulums, and a hotspot of light slides across the cover |

- **Learning the moves.** A guide with little animated phones shows each move. The first couple of times you use a move, the island says what it did.
- **Every move is a snap and back.** Slow turns (tilting to play with the light, twisting slowly, turning round as you walk) are never moves.
- **Both kinds of flick.** Asked to flick right, people either turn the phone to face right or snap it clockwise; the recordings had one of each. Both work.
- **One move, one step.** After each move Shelfie waits for the phone to calm down for a moment, so the swing back or the bounce back never counts again. Moves about a second apart each count. Shelves change at most once every 0.9 s, because a tip's swing back can overshoot into what looks like a tip the other way.
- **When moves are ignored.** While you're dragging, typing, or have a panel, pop-up or poster open; while the phone is being picked up or put down; and for 1.5 s after it lay still face up (on a table).
- **Tuned on real moves.** Two recordings from an iPhone (`tests/fixtures/motion-iphone*.json`); the tests replay them. How moves are read: [performance.md](performance.md#motion-gestures).
- **Tilt follows the phone.** "Level" is how you've held the phone over the last few seconds, so the scene answers to its position and still settles when you change grip for good. Big tilts ease to the edge rather than stopping dead.

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

## Find on Amazon

Every pass has a **Find on Amazon** button on its back (tap a pass to turn it over), and books on the Want shelf get a 🛒 **GET IT** key on the macropad. It searches Amazon India for the ISBN when the book has one, otherwise for the title and author. It opens in a new tab, with no referrer and nothing about you attached.

## Home screen, and chai

- **Add to home screen.** You → **Add to home screen** shows a guide that matches your browser: pictures for iPhone and iPad Safari (including iOS 26's ••• menu) and Mac Safari, steps for Firefox, Edge and Chrome on iPhone, and the one-tap install button where Chrome or Edge offer one. Apps' built-in browsers get an "Open in Safari" link. It's offered once on a later visit (never the first), and once more at most two weeks later. After that it's only the **Add to home screen** row in You, and it disappears once Shelfie is installed.
- **Chip in for a chai.** A ticket at the very bottom of You, after everything else. It's never a pop-up and never in the way of reading.

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

## The arcade

- **Keycaps.** Sculpted and glossy, with a streak of light like translucent keycaps. They press down fast and bounce back up, with a coloured glow underneath that brightens while you hold.
- **Round arcade buttons** for adding pages (+1, +5, +10, +25), and a ▶ on START.
- **Fairy lights** strung over the macropad twinkle at their own pace. They chase on big moments: finishing a book, a goal, a level, a sticker, an import, a jackpot.
- **Neon.** The shelf you're on glows like a sign, hangs a little crooked, and flickers now and then.
- **Edison bulbs.** Warm filament bulbs hang on drooping wires behind the shelf name (backlighting it) and over every panel title, and one dangles off each section heading. Every second or two a random bulb stutters, as if the wiring's dodgy. Headings hang slightly crooked, like hand-hung signs.
- **Levers** in the danger zone.
- **Jackpot.** Now and then, reading pays out bonus XP with an arcade poster. It happens at most once every ten minutes, so it stays a surprise.

## Sharp covers

- **No more softening.** Covers were going soft because the slow "drift" zoomed an image that was already drawn. It now slides instead, and the image is drawn a little larger than its window.
- **A sharper copy by title and author.** Any book without a Google cover (starter books, Open Library books, Goodreads imports) asks the Worker once for one, by ISBN or else by title and author. Only the same title counts (a subtitle is fine), so you never get a lookalike.
- **Sheen.** A glint sweeps across the cover on top every 5–10 seconds, each book on its own rhythm, and a soft hotspot follows the tilt of your phone.
- **Google Books covers** are requested at the size your screen needs, up to 1080 × 1620, so zooming in stays crisp.
- **Why the lookup exists.** Open Library's largest covers are only 325 × 500, too soft for a phone screen. Each lookup answer is remembered on your device and cached at Cloudflare's edge for a month, so a book is looked up once. Search results never trigger lookups.

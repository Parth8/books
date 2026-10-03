# Performance: how Shelfie stays smooth

Apps that feel buttery aren't doing less animation. They do almost all of it in one cheap way, and almost none in the expensive ways. These are the rules Shelfie follows, and why.

## How a frame gets drawn

Every frame (16.7 ms at 60 Hz, 8.3 ms on a 120 Hz iPhone) the browser may have to:

1. **Style and layout:** work out what every element looks like and where it goes (CPU).
2. **Paint:** draw the pixels of anything that changed into layers (CPU, and slow).
3. **Composite:** stack the finished layers, each moved, scaled, rotated or faded (GPU, and nearly free).

Smooth apps keep the moving things in step 3 only. Native apps do the same thing with Core Animation: views are pre-drawn layers that the GPU slides around. A web page can hit the same speed if it plays by the same rules.

## The rules

| Rule | Why | In Shelfie |
|---|---|---|
| **Animate only `transform` and `opacity`** | Anything else (width, top, colours, shadows, filters) repaints every frame | Cards, panels, bulbs, the tilt, the ripple and confetti all move by transform |
| **No filters, blurs, blend modes or masks on anything that moves** | They're re-applied every frame on the CPU or as extra GPU passes; a blur's cost grows with its radius squared | Glows are pre-blurred gradients that only fade; ticket notches are overlay circles, not masks; card art uses gradients and one shared grain texture, not per-card SVG blur and noise filters |
| **Few, small GPU layers** | Every layer is a bitmap in memory: a full-screen layer on a 3× iPhone is ~14 MB. iOS Safari jams or reloads the page when it runs out | Shades, drop zones and popover backdrops only exist while in use; card backs only exist while a card is flipped. Layer memory went from 121 MB to 47 MB |
| **Event-driven, not always-on** | A loop that runs every frame "just in case" steals time from the frame that matters | At rest the liquid ripples at 25 frames a second on a timer (not every frame), and stops behind panels; bulb stutters come from one timer; tilt only paints when the phone actually moves |
| **Time-based, not frame-based** | Counting frames runs twice as fast at 120 Hz and slows down when frames drop, which makes it worse | Springs, confetti and tilt smoothing all step by real elapsed time |
| **Draw once, reuse** | Re-drawing the same emoji or text every frame is CPU work | Confetti draws each emoji once into a small sprite; the grain texture is one tiny canvas, tiled |
| **Batch reads, then writes** | Reading a size after changing a style forces an early layout ("layout thrashing") | Gestures read the pointer, update springs, then write transforms once per frame |
| **Hold the stage still behind panels** | A panel sliding over a moving scene composites both | `body.panel-up` pauses every ambient animation |
| **Respect Reduce Motion** | Some people need it, and it's a free off switch for testing | All ambient motion stops |

## Keeping the fun

The point of these rules is to keep every effect, not to cut them. Each effect is done the cheap way:

| Effect | How it stays cheap |
|---|---|
| The shelf name scrolling behind the pile | One layer, drawn once; the scroll only moves it |
| Cover art shapes dancing when a book lands on top | Transforms on the shapes, for 12 seconds, top card only |
| Grain on the art and the background | One small texture made at start-up, tiled |
| Fairy lights twinkling, neon flickering | Opacity fades on glows painted once |
| The pile leaning in 3D as you tilt | One transform on the pile |
| Spotlight while you hold a book | A pre-drawn vignette that fades in (no filter on the stage) |
| The liquid's ripple | 25 frames a second on a timer at rest, full speed only while it splashes |

## Motion gestures

The rules come from recordings of real moves on an iPhone, made with a hidden test page (`motion-lab.html`, removed before launch). The recording is kept as a test fixture, `tests/fixtures/motion-iphone.json`, and the tests replay it.

**Flick (next / previous book)** comes from the **gyroscope** (how fast the phone turns), which is clean and immediate.

1. Shelfie follows the turn about the phone's top-to-bottom axis.
2. A flick is at least 40° of turn, peaking above 280°/s. In the recording real flicks were 53–119° at 290–890°/s; normal handling stayed under 25°.
3. It fires as the swing back starts (about 15° into it), roughly a quarter of a second after the flick began.
4. The other axes are ignored: a flick to the left also tips the phone's top towards you by 60–80% as much.
5. Picking the phone up or putting it down turns it the same way. So a flick only counts if the phone was held fairly steady (within 40°) over the half second before.

**Bounce (add a book)** comes from the **accelerometer**, measured along gravity so it works however you hold the phone.

- A bounce is two strong pushes in opposite directions (each above 9 m/s² and long enough to really move the phone) within 0.45 s, while the phone hardly turns.
- Setting the phone down, or knocking it, is one short spike, so it doesn't count.

After any move, Shelfie waits until the phone is calm again, so the swing back never counts.

**Tilt** comes from which way gravity points, not from the orientation event's angles. Those angles are Euler angles: when you hold the phone upright they jump (one swings by 180°), which made the pile lurch.

The reader is a pure function (`gestureReader` in `js/gyro.js`). The tests replay the recording and check each step: every flick right gives "next", every flick left "previous", bouncing gives "add". Holding the phone still, slow tilting, walking, putting it down and picking it up, scrolling, and the dropped twist and tip moves give nothing.

## What can't be measured here

Desktop Chrome hides most of what makes an iPhone stutter: it has a big GPU, plenty of memory and no thermal limits. The checks in [testing.md](testing.md) catch the usual causes. The ground truth is still a Safari Web Inspector Timeline recorded on the phone itself.

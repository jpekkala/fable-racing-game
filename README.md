# Fable Racing Game

*Disclaimer: This repository was created almost entirely by AI.*

A browser-playable **Slicks 'n Slides** clone made with **Fable 5** in Claude Code.

## Purpose

This repository is an evaluation artifact for testing the capabilities and
quality of the Fable 5 model from Claude. The game and its original test
harness were created by Fable 5 in the
[`Initial implementation by Fable 5` commit (`4e133d9`)](https://github.com/jpekkala/fable-racing-game/commit/4e133d9a7b131dd5450e4952c0fbf4ad4fe4ced6).
Later commits added project documentation and GitHub Pages deployment.

## Play

**[Play Slicks 'n Slides in your browser](https://jpekkala.github.io/fable-racing-game/)**

Use the arrow keys to configure the race and press Enter to start.

- Player 1: arrow keys
- Player 2: W, A, S, D
- Return to the menu: Escape

## Prompt

> Let's create a Slicks 'n Slides clone that you can play in the browser

## Run details

| Field      | Value   |
| ---------- | ------- |
| Model      | Fable 5 |
| Effort     | High    |
| Time taken | 10m 33s |

## Token usage

| Token type         |     Count |
| ------------------ | --------: |
| Input              |     2,250 |
| Output             |    42,775 |
| Cache read         |   982,563 |
| Cache write        |    52,773 |
| Total token-events | 1,080,361 |

Estimated cost: **$4.10**

## Code review findings

The [`Initial implementation by Fable 5`
commit](https://github.com/jpekkala/fable-racing-game/commit/4e133d9a7b131dd5450e4952c0fbf4ad4fe4ced6)
was reviewed by GPT-5.5 in high reasoning mode as the Fable 5-generated
artifact. Severity reflects user impact and whether the issue would undermine
the evidence used to approve the code in a professional review.

1. **High: the committed test command can pass without testing `game.js`.**
   [`.test/combined.js`](.test/combined.js) is an exact concatenation of the
   browser stubs, a snapshot of the production source, and the smoke tests.
   Concatenation is a reasonable way to put a non-modular browser script and
   its tests into one scope, but the repository has no command that regenerates
   the file and no freshness check. Running `node .test/combined.js` never
   reads [`game.js`](game.js), so any later production change can be completely
   broken while the documented suite remains green. Because this creates
   false validation rather than merely reducing coverage, the test result
   should not be trusted as merge evidence.
2. **High: fractional device-pixel ratios can reallocate the canvas every
   frame.** [`render()`](game.js#L642-L650) compares integer canvas backing
   dimensions with potentially fractional viewport dimensions multiplied by
   `devicePixelRatio`. For example, a target width of `1001 * 1.25` is
   `1251.25`, while the canvas stores an integer width. The comparison therefore
   remains unequal and resets the canvas on every frame, causing repeated
   allocation and context-state resets on affected viewport sizes. The target
   dimensions should be rounded once before comparison and assignment.
3. **Medium: browser-facing behavior is effectively untested.** The headless
   harness discards registered event handlers and uses a proxy that turns any
   unknown canvas property into a no-op function. It therefore does not verify
   keyboard controls, real Canvas API usage, resizing, rendering output, or
   Web Audio behavior. The simulation smoke test has value, but a passing run
   says little about whether the browser game is actually playable.
4. **Low: race times can be formatted as an invalid `0:60.0`.**
   [`fmtTime()`](game.js#L58-L63) calculates the minute before rounding the
   seconds to one decimal place. Values from approximately 59.95 through 59.99
   seconds round up to `60.0` without carrying into the minute; the same defect
   occurs at every minute boundary.
5. **Low: the countdown initially displays `4`.** A race starts with
   `game.countdown = 3.6`, while the renderer displays
   `Math.ceil(game.countdown)`. The result is a brief `4, 3, 2, 1` sequence
   even though the audio and apparent intent implement a three-count start.
6. **Low: fixed-width UI elements are clipped on narrow viewports.** The
   results panel is always 560 pixels wide, and the menu and HUD use similar
   fixed dimensions. The track scales to the viewport, but these overlays do
   not reflow or clamp to it.
7. **Low: the smoke-test clock is not reset correctly between tracks.** Each
   test resets its local timestamp to zero but leaves `game.lastFrame` from the
   previous race. The next frame receives a large negative delta, which drives
   the accumulator below zero and delays simulation until the synthetic clock
   catches up. This explains the inflated reported durations for later tracks
   and could cause false timeouts as the suite grows.

### Code quality assessment

The production code is a credible small-game prototype. It uses a fixed-step
physics loop, caches static track rendering, bounds particle growth, performs a
local-first nearest-track search, and divides most operations into short,
locally understandable functions. The three committed tracks completed
successfully under repeated simulation, and no failure was reproduced in track
construction, checkpoint progression, collision state, or standings ordering.

#### Maintainability and code smells

These concerns are not all user-visible defects, but they are normal subjects
for a professional review because they increase the cost and risk of changing
the game. They are individually low-severity for a prototype; collectively,
they show that the implementation is difficult to tune, isolate, and verify.

- **Scattered magic numbers encode undocumented and coupled design rules.**
  Grid spacing, AI lookahead and target speed, acceleration, drag, grip,
  steering, braking, collision size, particle behavior, audio pitch, and UI
  geometry are expressed as literals at their points of use. Some represent
  the same concept without sharing a definition: `460` is the AI speed
  reference, while `470` independently controls steering attenuation and
  engine pitch; the car is drawn with a 22-by-12 body, while world bounds and
  collisions separately use `12` and `11`; and particle lifetime `0.6` is
  repeated in creation and rendering. This makes balancing changes easy to
  apply inconsistently. Named configuration groups for vehicle physics, AI,
  effects, and layout would make those relationships explicit.
- **Core concerns are tightly coupled through global mutable state.** The
  820-line [`game.js`](game.js) owns simulation, rendering, input, audio,
  menus, and lifecycle state in one browser-global scope. In particular,
  [`physicsStep()`](game.js#L525-L596) advances vehicle state, draws skid marks,
  creates visual particles, and updates engine audio. A physics test therefore
  requires canvas and audio substitutes even when it only wants to validate
  lap or movement logic. This coupling likely contributed to the copied-source
  test harness and makes focused unit tests and safe refactoring harder.
- **Object shape and lifecycle requirements are implicit.** `Car` instances
  gain `locked`, `slip`, and `fwdSpeed` outside the constructor, while the
  `game` object gains `skidCtx` and `lastBeep` after its initial declaration.
  State transitions are distributed across `startRace()`, `update()`, and
  keyboard handlers and depend on repeated string literals such as `MENU`,
  `COUNTDOWN`, and `RACE`. The unused `finishedAt` field adds another sign of
  an incomplete or stale lifecycle contract. Declaring complete state shapes
  and centralizing transitions would make valid states and invariants easier
  to understand.
- **Randomness and browser services are hard-wired dependencies.** AI skill,
  racing line, and particles call `Math.random()` directly; timing uses global
  browser clocks; and rendering and audio reach global DOM and Web Audio
  objects. Track decoration is commendably seeded, but race behavior is not.
  Injecting random, timing, rendering, and audio dependencies would permit
  deterministic tests without changing production behavior.

The compact, single-file design is understandable for a quickly generated
prototype, but it does not excuse these issues in a professional review. The
code is readable enough to follow locally, yet its tuning rules and lifecycle
assumptions are scattered and its architecture provides few boundaries for
testing or change.

### Review validation

- `node --check game.js` passed.
- A smoke run assembled at execution time from `.test/stub.js`, the live
  `game.js`, and `.test/test.js` passed all three tracks.
- The committed headless suite passed in 100 consecutive runs.
- The canvas-size, time-formatting, countdown, and test-clock findings were
  reproduced with focused checks.
- No browser executable was available in the review environment, so canvas,
  keyboard input, and audio behavior were not tested end to end.

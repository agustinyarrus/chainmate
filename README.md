# Chainmate — JavaScript + three.js edition

A native 3D chess roguelite, ported from its shipped Godot 4.7.2 build to the web: plain
JavaScript modules, three.js on WebGL2, no framework. The goal is not "a remake that looks close"
but **the same game**: the same runs from the same seeds, the same frames, the same interface and
the same sound — and every one of those claims is measured against the original executable.

```
 original build (Godot 4.7.2, Forward+, Vulkan)            this port (WebGL2, three.js 0.186)
 ─────────────────────────────────────────────            ─────────────────────────────────────
 GDScript game logic          ──── bit-exact ────▶         src/core          (runs replay 1:1)
 SceneTree, coroutines, RNG   ──── bit-exact ────▶         src/godot         (frame order, PCG32)
 TextServerAdvanced + glyphs  ──── bit-exact ────▶         src/godot/text    (FreeType + HarfBuzz → wasm)
 Forward+ renderer            ──── ≤ 0.02/255 ───▶         src/godot/render  (pass by pass)
 GUI (Control, themes, input) ──── ≤ 0.6 % px ───▶         src/godot/ui + src/presentation/ui
 audio_synth.gd + mixer       ──── bit-exact ────▶         src/audio         (AudioWorklet)
```

## Running it

```bash
npm install
npm run dev          # http://127.0.0.1:5190   (development server)
npm run build        # → dist/                 (static files, deployable anywhere)
npm run preview      # http://127.0.0.1:4190   (serves dist/)
```

Query flags (the URL stands in for Godot's `-- --user-args`):

| Flag | What it does |
|---|---|
| `?capture` | the original's own scripted capture tour (`--capture`), with `menu`, `arena`, `pieces`, `relics` for the narrower tours |
| `?seed=TEXT` | the run seed of the capture tour |
| `?rngseed=N` | the engine-wide random stream starts from N (banner waves, candle flames, piece idles) instead of the clock |
| `?fixed=60` | every frame simulates exactly 1/60 s |
| `?renderer=mobile` | the frame a phone gets (Godot's Mobile renderer defaults: no SSAO, SSIL, volumetric fog or subsurface scattering); `forward_plus` forces the desktop one |
| `?ephemeral` | settings and saves stay in memory |
| `?app` | behave like the desktop build inside a tab (shows *Quit*) |
| `?stats` | frame statistics in the corner |
| `?probe=stages` | the port's side of the render-stage oracle (used by `npm run stages`) |
| `?trace` | with `?capture`: the tour's state trace (`src/dev/trace.js`), compared line by line with the original's |

On phones (Android, iOS) the Mobile renderer is chosen automatically, as Godot's
`rendering_method.mobile` default does; the game itself then switches its Forward+-only effects off.

## Layout

```
src/
  core/           the game: chess rules, battles, AI, encounters, map, relics, upgrades, events, state
  godot/          the parts of the engine the game relies on, ported from the 4.7.2 sources
    scene.js        SceneTree: frame order, timers, deferred calls, unhandled input
    coroutine.js    GDScript `await` as generators
    rng.js          PCG32 (RandomPCG), the global Math:: functions and hash(), bit for bit
    particles.js    GPUParticles3D: the engine's compute shader, stepped on the CPU draw for draw
    gdscript.js     GDScript semantics: sort_custom, str(float), formatting, variant equality
    render/         the Forward+ frame: materials, PSSM shadows, SSAO/SSIL, volumetric fog,
                    subsurface scattering, sky radiance, glow, tone mapping
    text/           FreeType (WebAssembly, native/ftw) + HarfBuzz shaping, glyph atlas
    ui/             Control, containers, widgets, themes, canvas renderer, GUI input and focus
  presentation/   the game's scenes: arena, board, pieces, relics, camera, effects, HUD and screens
  audio/          audio_synth.gd and the engine's mixer (AudioWorklet, workers for synthesis)
  autoload/       Settings, Profile, Sfx
  dev/            development-only pages and probes (render stages, the tour's state trace)
_oracle/          GDScript probes that run INSIDE the original build, and what they answered
_ref/             reference captures of the original (regenerated, not committed)
e2e/              browser checks: capture tours, render stages, frame cost, audio
tools/            oracle runner, image comparison, CDP client, capture of the original, state-trace
                  comparison, Android packaging
native/ftw/       the C shim compiled with FreeType + HarfBuzz into src/godot/text/ftw.wasm
mobile/           the Android wrapper (Capacitor 6): native project, icons, splash
```

## How exactness is proved

**The oracle.** `_oracle/ChainmateOracle.exe` is the shipped game with one hook: given
`-- --oracle=<probe.gd>` it runs that GDScript inside the real engine and prints JSON.
`npm run oracle -- <name>` runs `_oracle/probe_<name>.gd` and stores `_oracle/<name>.json`; the
unit tests then compare the port against those answers.

```bash
npm test                      # 258 tests, about 30 s, no browser
```

| Suite | Against the original |
|---|---|
| `runs` | five whole runs (different seeds, armies, difficulties) replayed action by action: the complete game state, including the PCG state, after every step |
| `rng`, `gdscript`, `math` | PCG32 streams, `hash()`, sort stability, float formatting, float32 vector math |
| `global_random` | GDScript's global `randf()` (one word of the stream, `Math::randf`), `randf_range()` (three, in double), `randi_range()` — the word counts that keep every banner, flame, idle phase and particle seed in step |
| `particles` | the two global draws of every `GPUParticles3D`, one-shot bookkeeping, and 120 frames of three systems whose particle boxes must be the ones the engine read back from the GPU (worst 2·10⁻⁶) |
| `gradient_texture` | `GradientTexture2D` baked byte for byte: every fill (linear, radial, square, conic) × repeat mode |
| `frame_order` | the order and frame of every `_process`, timer, tween, deferred call and `await` |
| `text`, `glyphs` | font metrics at sizes 6–100, shaping glyph by glyph, 28 000+ glyph bitmaps bit for bit |
| `meshes`, `relics`, `arena` | every procedural piece, relic and arena mesh, prop and light |
| `audio` | every synthesised sample (float32 and PCM), the mixer from stream to limiter |
| `render` | the renderer's arithmetic: shader variants per pass, fog volume, kernels |
| `gui_input` | hover, focus, buttons and keyboard navigation as Godot 4.7 does them |

**The pictures.** The original captures itself with its own autopilot; the port runs the very same
autopilot, and every image is compared pixel by pixel. References are captured deterministically
(every frame 1/60 s, a seeded random stream), so what differs is the port, not the clock:

```bash
npm run capture-original      # the original's five tours → _ref/{tour,arena,pieces,relics,menu}
npm run tour                  # the full 3-act tour in a visible Chrome → _ref/port/tour/report.html
npm run tour -- arena         # or menu | pieces | relics
npm run stages                # the 3D frame taken apart: 88 images of views and single effects
npm run audio                 # the sound in a real browser, measured at the output (muted Chrome)
npm run perf                  # where the frame time goes, pass by pass (GPU timer queries)
```

**The state behind the pictures.** When a shot differs, the trace says why before anyone squints at
pixels. Both builds print the same lines — every holder of a draw of the global random stream (cloth
phases, flame seeds, particle seeds, piece idle phases), every change of the hovered control and of
the focus owner, every control the mouse enters with its rect at that instant, and the halos at each
shot — and `tools/trace-compare.mjs` places each random fingerprint at the word of the seeded stream
it came from, so the first draw either build makes differently is named, not guessed:

```bash
pwsh -File tools/capture-original.ps1 -Modes full -Acts 1 -Trace -RefRoot _ref/trace
npm run tour -- --acts 1 --trace
node tools/trace-compare.mjs --original _ref/trace/logs/full.out.txt --port _ref/port/tour/trace.txt
```

Last measurements (mean absolute difference over 255, share of pixels off by more than 8):

| Check | Result |
|---|---|
| Full tour, 3 acts, 39 screenshots | 34 *match* and 4 *close* (worst mean 0.03, worst share 0.12 %); 14/14 scripted checks pass. One *different*: the merchant, a hover left by the instant a screen enters the tree (see below) |
| Menu, arena, pieces and relics tours, 29 screenshots | 29/29: 11 *match*, 18 *close*; worst mean 0.25, worst share 0.50 % (a close-up of the ivory army, halos and sparks included) |
| Render stages, 6 camera stops × views and ablations | final frames 0.006–0.016; every effect alone (shadows, SSAO, SSIL, fog, volumetric fog, glow, grading, each light) ≤ 0.12 |
| Game logic | 5/5 runs identical to the original, state by state |
| Audio | every sample identical (unit tests); in a real Chrome (muted, real autoplay policy) 10/10: silent until a gesture, the music fades in, an effect is heard over it, the Master bus mutes and restores |
| Android, API 36 emulator | 7/7: installs, draws the menu over the 3D arena with the Mobile renderer, survives, logs no crash, Back and Quit behave |
| Frame time, 1600×900, Intel Iris Xe | outpost 39.5 ms · crypt 44 ms · court 39.5 ms — the original on the same machine: 38.6 · 44.1 · 38.1 ms |

## What is approximated, and why

- **Multisampled prepass.** WebGL2 cannot read single samples; the depth/normal prepass that feeds
  SSAO and SSIL is drawn without MSAA and aimed at the engine's sample 0, shading at the pixel
  centre as multisampling does. Normal buffer: 0.07 % of pixels off, on silhouettes.
- **Compute shaders.** The volumetric fog, SSAO, SSIL and sky filtering run as fragment passes over
  the engine's buffers (volumes as atlases of slices, filtered like 3D textures); results match the
  engine's within the numbers above.
- **Light culling for shadow casters** (`RenderingLightCuller`) is not ported: it only changes which
  casters reach the far cascades' atlas debug view, never the frame.
- **Sound starts on the first gesture**, as browsers require; a sound asked for in the gesture that
  unlocks the audio is kept a quarter of a second.
- **Mobile renderer.** On phones the port applies what the game itself does outside Forward+; it
  does not reproduce the look of Godot's Mobile renderer, which the original never shipped with.
- **GUI features the game never uses** (explicit focus-neighbour paths, drag and drop, scroll
  containers that follow the focus) are not ported.
- **The instant a screen enters the tree.** Godot lays a new screen out in stages — the theme
  reaches each control as it enters, `POST_ENTER_TREE` resizes them bottom-up, minimum sizes are
  cached and invalidated upward only while valid, wrapping labels reshape against whatever width
  they have at that moment — and sorts containers at the end of the frame. The port gets the
  sorted layout exactly, not that instant: a click whose press opens a screen and whose release
  lands in the same frame can hover a different control. The tour's merchant (`24_stop_merchant`)
  shows it: at the release the original's panel is 1236 px tall before sorting, the port's 1203,
  so the stacked cards differ and one card keeps its hover highlight in the original only
  (measured with the state trace; any mouse movement re-picks it).
- **The web export's shader warm-up** runs on every platform here (WebGL compiles on first draw),
  but outside the global random stream: the shipped desktop build never builds those props, so
  their draws are handed back and every later draw stays the original's.
- **Particles** are GPU-simulated in the original; here the same compute shader runs on the CPU in
  single precision, including the reference GPU's divider (a / b = a × rcp(b), 169 reciprocals that
  differ from the correctly rounded ones, measured), which decides the particle that restarts on a
  step boundary.

## Android

`mobile/` wraps the web build with Capacitor 6 (landscape, immersive, screen kept on; the system Back
button is the desktop game's Escape, and leaves the app from the bare main menu):

```bash
cd mobile && npm install && cd ..
node tools/android-assets.mjs       # icons and splash from public/icon.svg (adaptive safe zone)
node tools/apk.mjs                  # → dist-android/Chainmate-<version>-debug.apk
node tools/apk.mjs --aab            # → the signed bundle Google Play takes (mobile/android/keystore.properties)
node tools/android-smoke.mjs        # boots the emulator, installs, opens, checks it draws and survives
```

On phones the Mobile renderer is chosen automatically (see the flags above); targetSdk is 36, what
Google Play requires for new releases.

## Rebuilding the native parts

`src/godot/text/ftw.wasm` is committed. To rebuild it (FreeType 2.14.3 and HarfBuzz 14.2.0 exactly
as Godot 4.7.2 vendors them):

```bash
python tools/fetch-godot-src.py      # engine sources → _build/godot-src (not committed)
node tools/build-ftw.mjs             # Zig's clang → src/godot/text/ftw.wasm
```

## Licences

The game content (scripts, shaders, texts) comes from the original Chainmate build. The Credits
panel carries every notice: Godot Engine (MIT), FreeType (FTL), HarfBuzz (MIT), Cinzel and Cormorant
Garamond (SIL OFL 1.1, `public/fonts`), three.js (MIT), harfbuzzjs (MIT), FastNoiseLite (MIT) —
`tools/credits.mjs` collects the port's own libraries into `public/credits/port.json`.

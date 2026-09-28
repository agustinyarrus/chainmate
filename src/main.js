/**
 * Chainmate — the application shell: what the Godot runtime does around the Main scene.
 *
 *   boot     autoloads (Settings, Profile) → fonts, credits and theme icons (in parallel) → renderers,
 *            GUI viewport and input → the Main scene enters the tree
 *   frame    Main::iteration (physics frames + one idle frame, scene.js) → tooltips → render-time
 *            systems → 3D frame → 2D canvas on top → frame_post_draw
 *   window   content scale follows the window (canvas_items / expand, 1600×900 × interface scale);
 *            the run is saved whenever the page is hidden or closed; a lost WebGL context reloads
 *
 * Query flags: `?capture` (the original's --capture tour, see presentation/autopilot.js),
 * `?ephemeral`, `?app` (behave like the desktop build inside a browser tab), `?stats` (frame
 * statistics), `?fixed=60` (every frame simulates exactly 1/60 s — what the capture tour uses),
 * `?rngseed=N` (the global random stream starts from N, like the oracle's seeded tours), `?trace`
 * (with `?capture`: the tour's state trace, dev/trace.js).
 */
import * as THREE from 'three';
import { SceneTree } from './godot/scene.js';
import { Coroutine, go } from './godot/coroutine.js';
import { Camera3D } from './godot/node3d.js';
import { Vector2 } from './godot/math.js';
import { RenderPipeline } from './godot/render/pipeline.js';
import { SkyRenderer } from './godot/render/sky.js';
import { lighting, sharedUniforms } from './godot/render/lighting.js';
import { CanvasRenderer } from './godot/ui/renderer.js';
import { GuiViewport, TextInputBridge } from './godot/ui/viewport.js';
import { DomInput } from './godot/ui/dom_input.js';
import { FontRegistry, IconTexture, baseTheme } from './godot/ui/theme.js';
import { Settings } from './autoload/settings.js';
import { Profile } from './autoload/profile.js';
import { Sfx } from './autoload/sfx.js';
import { AudioEngine } from './audio/engine.js';
import { loadRasterizer } from './godot/text/ftw.js';
import { Glyphs } from './godot/text/glyphs.js';
import { Fonts, loadFonts } from './presentation/ui/fonts.js';
import { loadCredits } from './presentation/ui/screens.js';
import { Main, Screen } from './presentation/main_scene.js';
import { KEY } from './godot/input.js';
import { OS, Engine } from './godot/os.js';
import { globalRng } from './godot/rng.js';

/** A frame never simulates more than this (a hidden tab or a stall must not skip whole animations). */
const MAX_FRAME_DELTA = 0.1;
/** Godot's rendering/limits/time/time_rollover_secs: shader TIME wraps here. */
const TIME_ROLLOVER = 3600;
const STATS_INTERVAL_MS = 1000;
/**
 * Frames in a row that may throw before the loop stops: one bad frame (a module swapped mid-frame by
 * the dev server) is survivable; a frame that always throws would repeat its error sixty times a second.
 */
const MAX_FAILED_FRAMES = 3;
/** The capture tour runs at the original's window size and a steady 60 frames per simulated second. */
const TOUR_WINDOW = Object.freeze({ width: 1600, height: 900 });
const TOUR_FRAME_RATE = 60;

/** Boot and frame phases — one explicit state instead of loose flags. */
const AppState = Object.freeze({ BOOTING: 'booting', RUNNING: 'running', CONTEXT_LOST: 'context-lost', FAILED: 'failed' });

/** Every IconTexture of the base theme (check marks, radio dots, arrows…), to decode before first use. */
function themeIcons() {
  const icons = [];
  for (const byKind of baseTheme.items.values()) {
    for (const value of byKind.get('icon')?.values() ?? []) if (value instanceof IconTexture) icons.push(value);
  }
  return icons;
}

class App {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.state = AppState.BOOTING;
    this.params = new URLSearchParams(location.search);
    this.uiScale = 1;
    this.shaderTime = 0;
    this.lastFrame = 0;
    this.errors = [];
    /** Consecutive frames that threw (see MAX_FAILED_FRAMES). */
    this.failedFrames = 0;
    this.stats = { fps: 0, frames: 0, since: 0, element: null };
    /** Fixed simulation step in seconds, or 0 to follow the clock. */
    this.fixedDelta = this.params.has('fixed') ? 1 / Math.max(1, Number(this.params.get('fixed')) || TOUR_FRAME_RATE) : 0;
    /** Window size forced by the capture tour ({ width, height } in pixels), or null. */
    this.windowOverride = null;
    /** What the capture tour produced: read by e2e/tour.mjs. */
    this.tour = { shots: [], log: [], done: false, failures: 0 };
    /** The frame's camera as render-time systems see it (particles process only in view). */
    this.renderView = { frustum: new THREE.Frustum(), viewProjection: new THREE.Matrix4() };
    this._frame = (now) => this.frame(now);
  }

  /** The capture tour's host (Autopilot.host): frames are kept as PNG data URLs until collected. */
  tourHost() {
    return {
      capture: (name) => this.tour.shots.push({ name, width: this.pipeline.width, height: this.pipeline.height, url: this.canvas.toDataURL('image/png') }),
      setWindowSize: (width, height) => {
        this.windowOverride = { width, height };
      },
      finish: (failures) => {
        this.tour.failures = failures;
        this.tour.done = true;
      },
      log: (line) => {
        this.tour.log.push(line);
        console.info(line);
      },
      frameStats: () => ({ draws: this.pipeline.stats.drawCalls, triangles: this.pipeline.stats.triangles }),
    };
  }

  async boot() {
    this.tree = new SceneTree();
    Coroutine.onError = (error, coroutine) => this.errors.push({ where: coroutine.label, message: String(error?.message ?? error) });
    Settings.host = {
      setBusVolume: (bus, linear) => Sfx.set_bus_volume(bus, linear),
      setFullscreen: (on) => this.setFullscreen(on),
      setUiScale: (scale) => this.setUiScale(scale),
    };
    Settings._ready();
    // `?rngseed=N`: the engine-wide random stream (banner waves, candle flames, piece idle phases,
    // shard flights) starts from N instead of the clock, where the oracle's seeded tours seed it.
    if (this.params.has('rngseed')) globalRng.seed = Number(this.params.get('rngseed'));
    Profile._ready();
    // Audio: the third autoload. A browser lets it sound from the first user gesture on.
    this.audio = new AudioEngine({ tree: this.tree });
    Sfx.attach(this.audio);
    this.audio.followPage(window);
    if (OS.get_cmdline_user_args().includes('--capture')) {
      const { Autopilot } = await import('./presentation/autopilot.js');
      Autopilot.host = this.tourHost();
      Main.Autopilot = Autopilot;
      this.windowOverride = { ...TOUR_WINDOW };
      if (this.fixedDelta === 0) this.fixedDelta = 1 / TOUR_FRAME_RATE;
    }

    this.pipeline = new RenderPipeline(this.canvas);
    this.sky = new SkyRenderer(this.pipeline);
    this.canvasRenderer = new CanvasRenderer(this.pipeline.renderer);
    const [rasterizer] = await Promise.all([loadRasterizer(), loadFonts(), loadCredits(), this.canvasRenderer.preload(themeIcons())]);
    Glyphs.use(rasterizer);
    FontRegistry.fonts = Fonts;

    this.viewport = new GuiViewport(this.tree, { uiScale: () => this.uiScale });
    this.viewport.textInput = new TextInputBridge();
    this.input = new DomInput(this.canvas, this.viewport, { textInput: this.viewport.textInput });
    Camera3D.viewportSize = () => this.viewport.size;
    this.fit();

    this.main = new Main();
    this.pipeline.scene.add(this.main.object3d);
    this.tree.root.add_child(this.main);
    this.main.rig.viewportSize = () => new Vector2(this.viewport.size.x, this.viewport.size.y);
    lighting.environment = this.main.arena.environment;
    if (this.params.has('probe')) await this.startProbe();
    if (this.params.has('trace') && Main.Autopilot) {
      // `?trace`: the port's half of the tour's state trace (_oracle/probe_tour.gd --trace).
      const { installTrace } = await import('./dev/trace.js');
      installTrace(this.tree, this.main, this.viewport, (node) => node instanceof Main.Autopilot, (line) => this.tour.log.push(line));
    }

    this.watchWindow();
    if (this.params.has('stats')) this.stats.element = document.getElementById('chainmate-stats');
    this.state = AppState.RUNNING;
    this.lastFrame = performance.now();
    requestAnimationFrame(this._frame);
  }

  /**
   * `?probe=stages`: the port's side of the render-stage oracle (dev/stage_probe.js), at the
   * original's window size and a fixed step. What it produces is read by e2e/stages.mjs.
   */
  async startProbe() {
    const [{ StageProbe }, oracle] = await Promise.all([
      import('./dev/stage_probe.js'),
      fetch('/_oracle/stages.json')
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
    ]);
    this.windowOverride = { ...TOUR_WINDOW };
    this.fixedDelta = 1 / TOUR_FRAME_RATE;
    this.fit();
    this.probe = { entries: [], shots: [], done: false, oracle: oracle !== null };
    go(new StageProbe(this, oracle).run(), 'probe:stages');
  }

  /** The drawing buffer follows the window; the GUI canvas follows the drawing buffer. */
  fit() {
    if (this.windowOverride) this.pipeline.resize(this.windowOverride.width, this.windowOverride.height, 1);
    else this.pipeline.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    this.viewport.resize(this.pipeline.width, this.pipeline.height);
  }

  setUiScale(scale) {
    this.uiScale = scale;
    if (this.viewport) this.fit();
  }

  /**
   * Android's Back button (native/android MainActivity asks through evaluateJavascript): the desktop
   * game's Escape — close the open screen, drop the selection, pause — or 'exit' on the bare main
   * menu, where Escape does nothing and the player wants out. Returns 'handled' | 'exit'.
   */
  backButton() {
    if (this.state !== AppState.RUNNING || !this.main) return 'exit';
    if (this.main.screen === Screen.MENU && !this.main._modal_open()) return 'exit';
    this.input.tapKey(KEY.ESCAPE);
    return 'handled';
  }

  /** Fullscreen needs a user gesture in a browser: a refusal is reported, never fatal. */
  setFullscreen(on) {
    const active = document.fullscreenElement !== null;
    if (on === active) return;
    const request = on ? document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }) : document.exitFullscreen?.();
    request?.catch((error) => console.info(`fullscreen ${on ? 'request' : 'exit'} refused: ${error.message}`));
  }

  watchWindow() {
    const save = () => this.main.save_on_close();
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') save();
      // Coming back: do not simulate the time spent hidden.
      else this.lastFrame = performance.now();
    });
    // Leaving fullscreen with Esc or the system gesture keeps the setting truthful.
    document.addEventListener('fullscreenchange', () => {
      if (!Settings.ephemeral) Settings.set_value('fullscreen', document.fullscreenElement !== null);
    });
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      save();
      this.state = AppState.CONTEXT_LOST;
    });
    this.canvas.addEventListener('webglcontextrestored', () => location.reload());
  }

  frame(now) {
    if (this.state !== AppState.RUNNING) return;
    requestAnimationFrame(this._frame);
    try {
      this.runFrame(now);
      this.failedFrames = 0;
    } catch (error) {
      this.failedFrames += 1;
      this.errors.push({ where: 'frame', message: String(error?.message ?? error) });
      console.error(`frame ${this.pipeline?.stats.frame ?? '?'} failed:`, error);
      if (this.failedFrames >= MAX_FAILED_FRAMES) this.fail(error, 'frame');
    }
  }

  /** One frame: input, simulation, the 3D scene, the canvas. */
  runFrame(now) {
    const step = this.fixedDelta > 0 ? this.fixedDelta : Math.min(Math.max(now - this.lastFrame, 0) / 1000, MAX_FRAME_DELTA);
    this.lastFrame = now;
    // Engine.time_scale scales what the frame simulates and what shaders read as TIME.
    const delta = step * Engine.time_scale;
    this.shaderTime = (this.shaderTime + delta) % TIME_ROLLOVER;
    sharedUniforms.TIME.value = this.shaderTime;

    this.fit();
    this.input.poll();
    this.tree.iteration(step, Engine.time_scale);
    // Tooltip waits run on the unscaled clock (the engine's GUI timers ignore time_scale).
    this.viewport.process(step);

    const { main, pipeline } = this;
    const camera = main.rig.camera.camera;
    camera.aspect = pipeline.width / pipeline.height;
    camera.updateProjectionMatrix();
    main.object3d.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    // The engine's order: cull with the frame's camera, update the particle systems found in view
    // (and the 3D texts), then draw.
    this.renderView.frustum.setFromProjectionMatrix(this.renderView.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    this.tree.preRender(delta, this.renderView);
    pipeline.render(camera, main.arena.environment);
    this.canvasRenderer.render(this.tree.root, this.viewport.stretch, this.viewport.oversampling, pipeline.width, pipeline.height, pipeline.screenTarget);
    pipeline.present();
    this.tree.afterDraw();
    this.canvas.style.cursor = this.viewport.cursor;
    this.countFrame(now);
  }

  countFrame(now) {
    const stats = this.stats;
    stats.frames += 1;
    if (now - stats.since < STATS_INTERVAL_MS) return;
    stats.fps = Math.round((stats.frames * 1000) / (now - stats.since));
    stats.frames = 0;
    stats.since = now;
    if (!stats.element) return;
    const { drawCalls, triangles } = this.pipeline.stats;
    const ui = this.canvasRenderer.stats;
    stats.element.hidden = false;
    stats.element.textContent = `${stats.fps} fps · ${drawCalls} draws · ${(triangles / 1000).toFixed(0)}k tris · ui ${ui.batches} batches ${ui.vertices} verts · ${this.pipeline.width}×${this.pipeline.height}`;
  }

  /** Stops the app for good and says so on the page. `where`: 'boot', or 'frame' when frames kept failing. */
  fail(error, where = 'boot') {
    this.state = AppState.FAILED;
    if (where === 'boot') this.errors.push({ where, message: String(error?.message ?? error) });
    console.error(where === 'boot' ? 'Chainmate could not start:' : `Chainmate stopped after ${MAX_FAILED_FRAMES} failed frames:`, error);
    // The loading note leaves once the game runs; a failure after that brings it back.
    let note = document.getElementById('chainmate-loading');
    if (!note) {
      note = document.createElement('div');
      note.id = 'chainmate-loading';
      document.body.append(note);
    }
    note.textContent = where === 'boot' ? 'Chainmate could not start. Reload the page to try again.' : 'Chainmate stopped. Reload the page to try again.';
    note.dataset.state = 'failed';
  }
}

const app = new App(document.getElementById('view'));
/** Handle for tools (e2e drivers, the capture tour, the console). */
window.chainmate = app;
app.boot().catch((error) => app.fail(error));

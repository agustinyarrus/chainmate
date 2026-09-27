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
 * Query flags: `?capture` (the original's --capture tour), `?ephemeral`, `?app` (behave like the
 * desktop build inside a browser tab), `?stats` (frame statistics).
 */
import { SceneTree } from './godot/scene.js';
import { Coroutine } from './godot/coroutine.js';
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
import { Fonts, loadFonts } from './presentation/ui/fonts.js';
import { loadCredits } from './presentation/ui/screens.js';
import { Main } from './presentation/main_scene.js';

/** A frame never simulates more than this (a hidden tab or a stall must not skip whole animations). */
const MAX_FRAME_DELTA = 0.1;
/** Godot's rendering/limits/time/time_rollover_secs: shader TIME wraps here. */
const TIME_ROLLOVER = 3600;
const SHADOW_MAP_SIZE = 4096;
/** Half extent of the key light's shadow frustum: the arena platform plus its dressing. */
const SHADOW_EXTENT = 6.5;
const STATS_INTERVAL_MS = 1000;

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
    this.stats = { fps: 0, frames: 0, since: 0, element: null };
    this._frame = (now) => this.frame(now);
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
    Profile._ready();

    this.pipeline = new RenderPipeline(this.canvas);
    this.sky = new SkyRenderer(this.pipeline);
    this.canvasRenderer = new CanvasRenderer(this.pipeline.renderer);
    await Promise.all([loadFonts(), loadCredits(), this.canvasRenderer.preload(themeIcons())]);
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
    const caster = this.main.arena.key_light.enableShadowCaster(SHADOW_MAP_SIZE, SHADOW_EXTENT);
    this.pipeline.scene.add(caster, caster.target);
    lighting.environment = this.main.arena.environment;

    this.watchWindow();
    if (this.params.has('stats')) this.stats.element = document.getElementById('chainmate-stats');
    this.state = AppState.RUNNING;
    this.lastFrame = performance.now();
    requestAnimationFrame(this._frame);
  }

  /** The drawing buffer follows the window; the GUI canvas follows the drawing buffer. */
  fit() {
    this.pipeline.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    this.viewport.resize(this.pipeline.width, this.pipeline.height);
  }

  setUiScale(scale) {
    this.uiScale = scale;
    if (this.viewport) this.fit();
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
    const delta = Math.min(Math.max(now - this.lastFrame, 0) / 1000, MAX_FRAME_DELTA);
    this.lastFrame = now;
    this.shaderTime = (this.shaderTime + delta) % TIME_ROLLOVER;
    sharedUniforms.TIME.value = this.shaderTime;

    this.fit();
    this.input.poll();
    this.tree.iteration(delta);
    this.viewport.process(delta);
    this.tree.preRender(delta);

    const { main, pipeline } = this;
    const camera = main.rig.camera.camera;
    camera.aspect = pipeline.width / pipeline.height;
    camera.updateProjectionMatrix();
    main.object3d.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    lighting.update(camera);
    main.arena.key_light.syncShadowCaster();
    this.sky.update(main.arena.sky);
    pipeline.render(camera, main.arena.environment);
    this.canvasRenderer.render(this.tree.root, this.viewport.scale, pipeline.width, pipeline.height);
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

  fail(error) {
    this.state = AppState.FAILED;
    this.errors.push({ where: 'boot', message: String(error?.message ?? error) });
    console.error('Chainmate could not start:', error);
    const note = document.getElementById('chainmate-loading');
    if (note) {
      note.textContent = 'Chainmate could not start. Reload the page to try again.';
      note.dataset.state = 'failed';
    }
  }
}

const app = new App(document.getElementById('view'));
/** Handle for tools (e2e drivers, the capture tour, the console). */
window.chainmate = app;
app.boot().catch((error) => app.fail(error));

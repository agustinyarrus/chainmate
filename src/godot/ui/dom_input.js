/**
 * DOM → engine input: pointer (mouse, pen, touch), wheel, keyboard and gamepads become InputEvents in
 * canvas units and go through the GuiViewport (GUI first, then unhandled input), like Godot's
 * Viewport::push_input. Touch acts as the left mouse button (emulate_mouse_from_touch). Gamepads are
 * polled once per frame (standard mapping) and emit joy_button presses / releases.
 */
import { InputEvent } from '../input.js';

/** DOM MouseEvent.button → Godot MouseButton. */
const BUTTON = { 0: 1, 1: 3, 2: 2 };
/** Pixels of a standard wheel notch (deltaMode 0) — Godot's factor 1. */
const WHEEL_NOTCH = 100;

export class DomInput {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./viewport.js').GuiViewport} viewport
   * @param {{ textInput?: import('./viewport.js').TextInputBridge }} options
   */
  constructor(canvas, viewport, options = {}) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.textInput = options.textInput ?? null;
    this.last = null;
    this.buttonMask = 0;
    this.padState = new Map();
    this.enabled = true;
    canvas.addEventListener('pointerdown', (e) => this._pointer(e, true));
    window.addEventListener('pointerup', (e) => this._pointer(e, false));
    window.addEventListener('pointercancel', (e) => this._pointer(e, false));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => this._releaseAll());
  }

  /** Client (CSS) coordinates → canvas units. */
  _point(e) {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * this.viewport.pixelSize.x;
    const py = ((e.clientY - rect.top) / Math.max(rect.height, 1)) * this.viewport.pixelSize.y;
    return { x: px / this.viewport.stretch.x, y: py / this.viewport.stretch.y };
  }

  _pointer(e, pressed) {
    if (!this.enabled) return;
    const index = BUTTON[e.button];
    if (index === undefined) return;
    if (pressed) {
      this.canvas.setPointerCapture?.(e.pointerId);
      this.canvas.focus?.({ preventScroll: true });
    } else if (!(this.buttonMask & (1 << (index - 1)))) return;
    const position = this._point(e);
    if (pressed) this.buttonMask |= 1 << (index - 1);
    else this.buttonMask &= ~(1 << (index - 1));
    this.last = position;
    const event = new InputEvent('mouse_button', { button_index: index, pressed, position, echo: false, is_touch: e.pointerType === 'touch', button_mask: this.buttonMask, double_click: pressed && e.detail === 2 });
    this.viewport.push(event);
    if (pressed) e.preventDefault();
  }

  _move(e) {
    if (!this.enabled) return;
    const position = this._point(e);
    const relative = this.last ? { x: position.x - this.last.x, y: position.y - this.last.y } : { x: 0, y: 0 };
    this.last = position;
    this.viewport.push(new InputEvent('mouse_motion', { position, relative, button_mask: this.buttonMask, pressed: false, echo: false, is_touch: e.pointerType === 'touch' }));
    this.canvas.style.cursor = this.viewport.cursor;
  }

  _wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const position = this._point(e);
    const pixels = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
    if (pixels === 0) return;
    const index = pixels < 0 ? 4 : 5;
    const factor = Math.min(Math.abs(pixels) / WHEEL_NOTCH, 4);
    for (const pressed of [true, false]) this.viewport.push(new InputEvent('mouse_button', { button_index: index, pressed, position, factor, echo: false, button_mask: this.buttonMask }));
  }

  _key(e, pressed) {
    if (!this.enabled) return;
    if (this.textInput?.active && e.target === this.textInput.input) return;
    const event = new InputEvent('key', { code: e.code, keycode: e.code, physical_keycode: e.code, key: e.key, pressed, echo: e.repeat, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey });
    const handled = this.viewport.push(event);
    // Keys the game consumes must not scroll the page or move browser focus.
    if (handled || ['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1'].includes(e.code)) e.preventDefault();
  }

  /** A key pressed and released at once, from outside the page (Android's Back arrives as Escape). */
  tapKey(code) {
    for (const pressed of [true, false]) {
      this.viewport.push(new InputEvent('key', { code, keycode: code, physical_keycode: code, key: code, pressed, echo: false, shift: false, ctrl: false, alt: false }));
    }
  }

  _releaseAll() {
    for (let bit = 0; bit < 3; bit++) {
      if (!(this.buttonMask & (1 << bit))) continue;
      this.viewport.push(new InputEvent('mouse_button', { button_index: bit + 1, pressed: false, position: this.last ?? { x: 0, y: 0 }, echo: false, button_mask: 0 }));
    }
    this.buttonMask = 0;
  }

  /** Gamepad buttons (standard mapping), once per frame. */
  poll() {
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad || pad.mapping !== 'standard') continue;
      const previous = this.padState.get(pad.index) ?? [];
      const now = pad.buttons.map((b) => b.pressed);
      now.forEach((down, index) => {
        if (down !== Boolean(previous[index])) this.viewport.push(new InputEvent('joy_button', { button_index: index, pressed: down, echo: false, device: pad.index }));
      });
      this.padState.set(pad.index, now);
    }
  }
}

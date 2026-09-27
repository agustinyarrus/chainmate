/**
 * Input — Godot's InputMap and InputEvent model over DOM events.
 *
 * Actions map physical keys (KeyboardEvent.code) and gamepad buttons (standard mapping indices) to
 * names; events expose `is_action_pressed(name, allowEcho)` like GDScript. The built-in `ui_*` actions
 * mirror Godot's defaults (arrows, Enter/Space/KP Enter accept, Esc cancel, Tab focus).
 */

/** Godot key constants → KeyboardEvent.code. */
export const KEY = Object.freeze({
  UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight',
  W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD', Q: 'KeyQ', E: 'KeyE', C: 'KeyC', H: 'KeyH',
  SPACE: 'Space', ENTER: 'Enter', KP_ENTER: 'NumpadEnter', BACKSPACE: 'Backspace', TAB: 'Tab', ESCAPE: 'Escape', F1: 'F1',
});

/** Godot JoyButton → standard Gamepad API button index. */
export const JOY = Object.freeze({
  A: 0, B: 1, X: 2, Y: 3, LEFT_SHOULDER: 4, RIGHT_SHOULDER: 5, BACK: 8, START: 9, LEFT_STICK: 10, RIGHT_STICK: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
});

export const MOUSE_BUTTON = Object.freeze({ LEFT: 1, RIGHT: 2, MIDDLE: 3, WHEEL_UP: 4, WHEEL_DOWN: 5 });

class InputMapClass {
  constructor() {
    /** @type {Map<string, {keys: Set<string>, buttons: Set<number>, shift?: boolean}>} */
    this.actions = new Map();
    this._defaults();
  }
  has_action(name) {
    return this.actions.has(name);
  }
  add_action(name) {
    if (!this.actions.has(name)) this.actions.set(name, { keys: new Set(), buttons: new Set() });
  }
  action_add_key(name, code) {
    this.add_action(name);
    this.actions.get(name).keys.add(code);
  }
  action_add_button(name, button) {
    this.add_action(name);
    this.actions.get(name).buttons.add(button);
  }
  /** Godot's built-in UI actions. */
  _defaults() {
    const bind = (name, keys, buttons) => {
      for (const k of keys) this.action_add_key(name, k);
      for (const b of buttons) this.action_add_button(name, b);
    };
    bind('ui_accept', [KEY.ENTER, KEY.KP_ENTER, KEY.SPACE], [JOY.A]);
    bind('ui_select', [KEY.SPACE], [JOY.Y]);
    bind('ui_cancel', [KEY.ESCAPE], [JOY.B]);
    bind('ui_focus_next', [KEY.TAB], []);
    bind('ui_up', [KEY.UP], [JOY.DPAD_UP]);
    bind('ui_down', [KEY.DOWN], [JOY.DPAD_DOWN]);
    bind('ui_left', [KEY.LEFT], [JOY.DPAD_LEFT]);
    bind('ui_right', [KEY.RIGHT], [JOY.DPAD_RIGHT]);
  }
}

export const InputMap = new InputMapClass();

/** Base event. `kind`: 'key' | 'mouse_button' | 'mouse_motion' | 'joy_button'. */
export class InputEvent {
  constructor(kind, fields) {
    this.kind = kind;
    Object.assign(this, fields);
  }

  is_action(name) {
    const action = InputMap.actions.get(name);
    if (!action) return false;
    if (this.kind === 'key') {
      if (!action.keys.has(this.code)) return false;
      // Shift+Tab is Godot's ui_focus_prev, not ui_focus_next.
      if (name === 'ui_focus_next' && this.shift) return false;
      return true;
    }
    if (this.kind === 'joy_button') return action.buttons.has(this.button_index);
    return false;
  }

  is_action_pressed(name, allowEcho = false) {
    return this.pressed && (allowEcho || !this.echo) && this.is_action(name);
  }

  is_action_released(name) {
    return !this.pressed && this.is_action(name);
  }

  /** InputEventMouseButton.is_pressed() */
  is_pressed() {
    return Boolean(this.pressed);
  }
}

export const keyEvent = (domEvent, pressed) =>
  new InputEvent('key', { code: domEvent.code, keycode: domEvent.code, physical_keycode: domEvent.code, pressed, echo: domEvent.repeat, shift: domEvent.shiftKey });

export const mouseButtonEvent = (buttonIndex, pressed, position) => new InputEvent('mouse_button', { button_index: buttonIndex, pressed, position, echo: false });

export const mouseMotionEvent = (position, relative, buttonMask = 0) => new InputEvent('mouse_motion', { position, relative, button_mask: buttonMask, pressed: false, echo: false });

export const joyButtonEvent = (index, pressed) => new InputEvent('joy_button', { button_index: index, pressed, echo: false });

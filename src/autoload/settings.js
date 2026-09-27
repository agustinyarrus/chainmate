/**
 * Settings — port of scripts/autoload/settings.gd (autoload). Values persist in user storage
 * (`user://settings.cfg` → localStorage), except in ephemeral/capture runs. `apply()` pushes volumes to
 * the audio buses, fullscreen to the window and the interface scale to the UI root.
 */
import { Signal } from '../godot/signal.js';
import { InputMap, KEY, JOY } from '../godot/input.js';
import { OS, UserStore } from '../godot/os.js';

const PATH = 'chainmate:settings';
const DEFAULTS = Object.freeze({
  master_volume: 0.8,
  music_volume: 0.55,
  sfx_volume: 0.85,
  fullscreen: false,
  vsync: true,
  screen_shake: 1.0,
  animation_speed: 1.0,
  reduced_motion: false,
  high_contrast: false,
  ui_scale: 1.0,
});

class SettingsAutoload {
  constructor() {
    this.DEFAULTS = DEFAULTS;
    this.values = { ...DEFAULTS };
    this.ephemeral = false;
    this.changed = new Signal();
    /** Set by the app: { setBusVolume(bus, linear), setFullscreen(on), setUiScale(scale) } */
    this.host = null;
  }

  _ready() {
    const args = OS.get_cmdline_user_args();
    this.ephemeral = args.includes('--ephemeral') || args.includes('--capture');
    this._register_input();
    if (!this.ephemeral) this._load();
    queueMicrotask(() => this.apply());
  }

  get_value(key) {
    return this.values[key];
  }

  set_value(key, value) {
    if (!(key in DEFAULTS) || this.values[key] === value) return;
    this.values[key] = value;
    this.apply();
    this._save();
    this.changed.emit(key);
  }

  /** Scales an animation time by the chosen speed (reduced motion slows everything by 1.6). */
  duration(seconds) {
    let speed = Number(this.get_value('animation_speed'));
    if (this.get_value('reduced_motion')) speed *= 1.6;
    return seconds / Math.max(speed, 0.1);
  }

  shake_scale() {
    return this.get_value('reduced_motion') ? 0.0 : Number(this.get_value('screen_shake'));
  }

  apply() {
    const host = this.host;
    if (!host) return;
    host.setBusVolume?.('Master', Number(this.get_value('master_volume')));
    host.setBusVolume?.('Music', Number(this.get_value('music_volume')));
    host.setBusVolume?.('SFX', Number(this.get_value('sfx_volume')));
    if (!this.ephemeral) host.setFullscreen?.(Boolean(this.get_value('fullscreen')));
    host.setUiScale?.(Math.min(Math.max(Number(this.get_value('ui_scale')), 0.75), 1.5));
  }

  _load() {
    const text = UserStore.read(PATH);
    if (!text) return;
    let stored;
    try {
      stored = JSON.parse(text);
    } catch (error) {
      console.warn('settings file unreadable, using defaults:', error);
      return;
    }
    for (const key of Object.keys(DEFAULTS)) {
      if (!(key in stored)) continue;
      const value = stored[key];
      if (typeof value === typeof DEFAULTS[key]) this.values[key] = value;
    }
  }

  _save() {
    if (this.ephemeral) return;
    UserStore.write(PATH, JSON.stringify(this.values));
  }

  _register_input() {
    this._bind('cursor_up', [KEY.UP, KEY.W], [JOY.DPAD_UP]);
    this._bind('cursor_down', [KEY.DOWN, KEY.S], [JOY.DPAD_DOWN]);
    this._bind('cursor_left', [KEY.LEFT, KEY.A], [JOY.DPAD_LEFT]);
    this._bind('cursor_right', [KEY.RIGHT, KEY.D], [JOY.DPAD_RIGHT]);
    this._bind('cursor_act', [KEY.SPACE], [JOY.A]);
    this._bind('confirm', [KEY.ENTER, KEY.KP_ENTER], [JOY.X]);
    this._bind('undo', [KEY.BACKSPACE], [JOY.B]);
    this._bind('cycle_piece', [KEY.TAB], [JOY.RIGHT_STICK]);
    this._bind('pause', [KEY.ESCAPE], [JOY.START]);
    this._bind('hint', [KEY.H], [JOY.Y]);
    this._bind('help', [KEY.F1], [JOY.BACK]);
    this._bind('camera_left', [KEY.Q], [JOY.LEFT_SHOULDER]);
    this._bind('camera_right', [KEY.E], [JOY.RIGHT_SHOULDER]);
    this._bind('camera_reset', [KEY.C], [JOY.LEFT_STICK]);
  }

  _bind(action, keys, buttons) {
    if (InputMap.has_action(action)) return;
    InputMap.add_action(action);
    for (const key of keys) InputMap.action_add_key(action, key);
    for (const button of buttons) InputMap.action_add_button(action, button);
  }
}

export const Settings = new SettingsAutoload();

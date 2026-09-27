/**
 * Signal — Godot's signal semantics: `connect(fn, flags)`, `emit(...args)`, one-shot and deferred
 * connections. Listeners run in connection order; disconnecting during an emit is safe.
 */
import { SceneTree } from './scene.js';

export const CONNECT_DEFERRED = 1;
export const CONNECT_ONE_SHOT = 4;

export class Signal {
  constructor() {
    this._listeners = [];
  }

  connect(callback, flags = 0) {
    if (this._listeners.some((l) => l.callback === callback)) return;
    this._listeners.push({ callback, flags });
  }

  disconnect(callback) {
    this._listeners = this._listeners.filter((l) => l.callback !== callback);
  }

  is_connected(callback) {
    return this._listeners.some((l) => l.callback === callback);
  }

  emit(...args) {
    for (const listener of this._listeners.slice()) {
      if (listener.flags & CONNECT_ONE_SHOT) this.disconnect(listener.callback);
      if (listener.flags & CONNECT_DEFERRED) SceneTree.current?.callDeferred(() => listener.callback(...args));
      else listener.callback(...args);
    }
  }

  /** `await signal` */
  wait() {
    return new Promise((resolve) => this.connect((...args) => resolve(args), CONNECT_ONE_SHOT));
  }
}

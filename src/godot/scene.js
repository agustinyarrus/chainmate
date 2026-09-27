/**
 * Scene tree — the slice of Godot's SceneTree the game uses.
 *
 * Order of operations per frame (as in Godot): node `_process` in tree order → timers → tweens →
 * deferred calls and queued frees → render. `_enter_tree` runs parent-first, `_ready` child-first,
 * once per node. `_unhandled_input` goes to nodes in REVERSE tree order until one marks it handled
 * (so an open modal sees Esc before the board does).
 */
import { Tween } from './tween.js';

let nextNodeId = 1;

export class Node {
  constructor(name = '') {
    this.name = name;
    this.id = nextNodeId++;
    /** @type {Node|null} */
    this.parent = null;
    /** @type {Node[]} */
    this.children = [];
    this._inside = false;
    this._readyDone = false;
    this._freed = false;
    this._queued = false;
    this.processMode = 'inherit';
  }

  get tree() {
    return SceneTree.current;
  }
  get_tree() {
    return SceneTree.current;
  }

  add_child(child) {
    if (child.parent) child.parent.remove_child(child);
    child.parent = this;
    this.children.push(child);
    this._childAdded(child);
    if (this._inside) {
      child._propagateEnter();
      child._propagateReady();
    }
    return child;
  }

  /** Hook for subclasses that mirror children into a render graph (Node3D, Control). */
  _childAdded(_child) {}
  _childRemoved(_child) {}

  remove_child(child) {
    const index = this.children.indexOf(child);
    if (index < 0) return;
    this.children.splice(index, 1);
    this._childRemoved(child);
    if (child._inside) child._propagateExit();
    child.parent = null;
  }

  move_child(child, toIndex) {
    const index = this.children.indexOf(child);
    if (index < 0) return;
    this.children.splice(index, 1);
    this.children.splice(toIndex, 0, child);
    this._childMoved?.(child, toIndex);
  }

  get_children() {
    return this.children.slice();
  }

  get_index() {
    return this.parent ? this.parent.children.indexOf(this) : 0;
  }

  is_inside_tree() {
    return this._inside;
  }

  is_queued_for_deletion() {
    return this._queued || this._freed;
  }

  _propagateEnter() {
    this._inside = true;
    this._enter_tree?.();
    for (const child of this.children.slice()) child._propagateEnter();
  }

  _propagateReady() {
    for (const child of this.children.slice()) child._propagateReady();
    if (!this._readyDone) {
      this._readyDone = true;
      this._ready?.();
    }
  }

  _propagateExit() {
    for (const child of this.children.slice()) child._propagateExit();
    this._exit_tree?.();
    this._inside = false;
  }

  /** Deferred free (end of frame), like Godot. */
  queue_free() {
    if (this._queued || this._freed) return;
    this._queued = true;
    SceneTree.current?.queueFree(this);
  }

  /** Immediate free of the whole subtree. */
  free() {
    if (this._freed) return;
    if (this.parent) this.parent.remove_child(this);
    this._freeRecursive();
  }

  _freeRecursive() {
    for (const child of this.children.slice()) child._freeRecursive();
    this._freed = true;
    this._dispose?.();
  }

  create_tween() {
    return new Tween(this, SceneTree.current.tweens);
  }

  /** Depth-first search by class (Godot's find_children(pattern, type)). */
  find_children_of(type) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child instanceof type) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

export const isInstanceValid = (node) => node != null && !node._freed;

/**
 * The frame driver. `timer(seconds)` / `processFrame()` return promises so ported coroutines can
 * `await` them exactly where GDScript awaited `create_timer(...).timeout` / `process_frame`.
 */
export class SceneTree {
  /** @type {SceneTree} */
  static current = null;

  constructor() {
    SceneTree.current = this;
    this.root = new Node('root');
    this.root._inside = true;
    this.root._readyDone = true;
    this.tweens = new Set();
    this._timers = [];
    this._frameWaiters = [];
    this._postDrawWaiters = [];
    this._deferred = [];
    this._freeQueue = [];
    this.time = 0;
    this.frame = 0;
    this._handled = false;
  }

  /** `get_tree().create_timer(seconds).timeout` */
  timer(seconds) {
    return new Promise((resolve) => this._timers.push({ at: this.time + Math.max(0, seconds), resolve }));
  }

  /** `await get_tree().process_frame` */
  processFrame() {
    return new Promise((resolve) => this._frameWaiters.push(resolve));
  }

  /** `await RenderingServer.frame_post_draw` */
  framePostDraw() {
    return new Promise((resolve) => this._postDrawWaiters.push(resolve));
  }

  /** `callable.call_deferred()` — runs at the end of this frame. */
  callDeferred(fn) {
    this._deferred.push(fn);
  }

  queueFree(node) {
    this._freeQueue.push(node);
  }

  /** One frame of simulation. O(nodes + timers + tweens). */
  step(delta) {
    this.frame += 1;
    this.time += delta;
    for (const resolve of this._frameWaiters.splice(0)) resolve();
    this._processTree(this.root, delta);
    if (this._timers.length) {
      const due = [];
      this._timers = this._timers.filter((timer) => {
        if (timer.at <= this.time) {
          due.push(timer);
          return false;
        }
        return true;
      });
      due.sort((a, b) => a.at - b.at);
      for (const timer of due) timer.resolve();
    }
    for (const tween of Array.from(this.tweens)) tween.step(delta);
    this.flush();
  }

  /** Deferred calls, then queued frees (repeats while deferred calls queue more). */
  flush() {
    let guard = 0;
    while ((this._deferred.length || this._freeQueue.length) && guard++ < 16) {
      for (const fn of this._deferred.splice(0)) fn();
      for (const node of this._freeQueue.splice(0)) if (!node._freed) node.free();
    }
  }

  afterDraw() {
    for (const resolve of this._postDrawWaiters.splice(0)) resolve();
  }

  _processTree(node, delta) {
    if (node._freed) return;
    if (node._process && node._processEnabled !== false && node._readyDone) node._process(delta);
    for (const child of node.children.slice()) if (child._inside) this._processTree(child, delta);
  }

  /** Unhandled input: reverse tree order, stops once handled. */
  dispatchUnhandledInput(event) {
    this._handled = false;
    const order = [];
    const walk = (node) => {
      order.push(node);
      for (const child of node.children) walk(child);
    };
    walk(this.root);
    for (let i = order.length - 1; i >= 0 && !this._handled; i--) {
      const node = order[i];
      if (node._unhandled_input && node._inside && !node._freed) node._unhandled_input(event);
    }
    return this._handled;
  }

  /** `get_viewport().set_input_as_handled()` */
  setInputAsHandled() {
    this._handled = true;
  }
}

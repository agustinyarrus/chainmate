/**
 * Scene tree — the slice of Godot's SceneTree the game uses, running frames in the shipped engine's
 * order, as measured inside the original build (_oracle/probe_frame_order.gd):
 *
 *   physics frames due (60/s): physics_frame → deferred calls → queued frees
 *   idle frame:  process_frame → deferred calls → _process (tree order) → deferred calls
 *                → timers → tweens → queued frees → deferred calls
 *   render:      render hooks (GPU particles, Label3D) → draw → frame_post_draw
 *
 * Timers run in creation order, tweens in list order; one created while its own phase runs waits for
 * the next frame, while a tween created by a timer still runs in the same frame. Coroutines resume
 * synchronously inside the emission that wakes them (coroutine.js), so their code lands in the same
 * phase as in Godot. `_enter_tree` runs parent-first, `_ready` child-first, once per node.
 * `_unhandled_input` goes to nodes in REVERSE tree order until one marks it handled (an open modal
 * sees Esc before the board does).
 */
import { Tween } from './tween.js';
import { Signal } from './signal.js';

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

  /** Deferred free: the node stays in the tree (and keeps getting input) until the next flush point. */
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

/** Godot's project defaults (physics/common/physics_ticks_per_second, max_physics_steps_per_frame). */
const PHYSICS_TICKS_PER_SECOND = 60;
const MAX_PHYSICS_STEPS_PER_FRAME = 8;
/** A deferred call that keeps queuing itself would hang Godot; here it fails loudly instead. */
const MESSAGE_QUEUE_ROUND_LIMIT = 4096;

/** `get_tree().create_timer(seconds)` — counts down by each idle frame's delta; `timeout` fires at <= 0. */
export class SceneTreeTimer {
  constructor(seconds) {
    this.time_left = seconds;
    this.timeout = new Signal();
  }
}

/** The frame driver. */
export class SceneTree {
  /** @type {SceneTree} */
  static current = null;

  constructor() {
    SceneTree.current = this;
    this.root = new Node('root');
    this.root._inside = true;
    this.root._readyDone = true;
    /** Live tweens in creation order (a Set iterates in insertion order). */
    this.tweens = new Set();
    /** @type {SceneTreeTimer[]} */
    this._timers = [];
    /** @type {Function[]} MessageQueue: call_deferred and CONNECT_DEFERRED emissions. */
    this._messageQueue = [];
    /** @type {Node[]} queue_free()d nodes, deleted at the flush points above. */
    this._deleteQueue = [];
    /** Callbacks that run at render time, after the frame's logic (GPU particles, Label3D). */
    this.renderHooks = new Set();
    this.process_frame = new Signal();
    this.physics_frame = new Signal();
    /** RenderingServer.frame_post_draw */
    this.frame_post_draw = new Signal();
    this.time = 0;
    this.frame = 0;
    this._physicsTime = 0;
    this._handled = false;
  }

  /** `get_tree().create_timer(seconds)` */
  create_timer(seconds) {
    const timer = new SceneTreeTimer(seconds);
    this._timers.push(timer);
    return timer;
  }

  /** `callable.call_deferred()` */
  callDeferred(fn) {
    this._messageQueue.push(fn);
  }

  queueFree(node) {
    this._deleteQueue.push(node);
  }

  /**
   * Main::iteration — the physics frames due by now, then one idle frame; the caller renders next.
   * Physics time accumulates at a fixed 1/60 s; a stalled frame runs at most 8 physics frames and
   * drops the rest (Godot slows down instead of spiralling). O(nodes + timers + tweens).
   */
  iteration(delta) {
    const tick = 1 / PHYSICS_TICKS_PER_SECOND;
    this._physicsTime += delta;
    let steps = Math.floor(this._physicsTime / tick + 1e-9);
    if (steps > MAX_PHYSICS_STEPS_PER_FRAME) {
      steps = MAX_PHYSICS_STEPS_PER_FRAME;
      this._physicsTime = steps * tick;
    }
    this._physicsTime = Math.max(0, this._physicsTime - steps * tick);
    for (let i = 0; i < steps; i++) this._physicsStep();
    this.step(delta);
  }

  /** SceneTree::physics_process for a game without physics processing: the signal and the flushes. */
  _physicsStep() {
    this.physics_frame.emit();
    this.flushMessageQueue();
    this.flushDeleteQueue();
  }

  /** SceneTree::process — one idle frame in the measured order. */
  step(delta) {
    this.frame += 1;
    this.time += delta;
    this.process_frame.emit();
    this.flushMessageQueue();
    this._processTree(this.root, delta);
    this.flushMessageQueue();
    this._processTimers(delta);
    this._processTweens(delta);
    this.flushDeleteQueue();
    this.flushMessageQueue();
  }

  /** Runs deferred calls until none are left, including ones queued meanwhile (CallQueue::flush). */
  flushMessageQueue() {
    let rounds = 0;
    while (this._messageQueue.length) {
      if (++rounds > MESSAGE_QUEUE_ROUND_LIMIT) {
        const stuck = this._messageQueue.splice(0);
        throw new Error(`deferred calls keep re-queuing themselves (${stuck.length} pending after ${MESSAGE_QUEUE_ROUND_LIMIT} rounds)`);
      }
      for (const fn of this._messageQueue.splice(0)) fn();
    }
  }

  /** Deletes queued nodes, including ones queued while deleting (SceneTree::_flush_delete_queue). */
  flushDeleteQueue() {
    while (this._deleteQueue.length) {
      for (const node of this._deleteQueue.splice(0)) if (!node._freed) node.free();
    }
  }

  /**
   * SceneTree::process_timers — creation order; a timer created while this runs (by a timeout or by a
   * coroutine it resumed) starts counting next frame. O(timers).
   */
  _processTimers(delta) {
    const timers = this._timers;
    const count = timers.length;
    if (count === 0) return;
    const kept = [];
    for (let i = 0; i < count; i++) {
      const timer = timers[i];
      timer.time_left -= delta;
      if (timer.time_left <= 0) timer.timeout.emit();
      else kept.push(timer);
    }
    for (let i = count; i < timers.length; i++) kept.push(timers[i]);
    this._timers = kept;
  }

  /** SceneTree::process_tweens — a tween created while this runs starts next frame. O(tweens). */
  _processTweens(delta) {
    if (this.tweens.size === 0) return;
    for (const tween of Array.from(this.tweens)) tween.step(delta);
  }

  /** Render-time systems (Godot updates particles in the rendering step, after the frame's logic). */
  preRender(delta) {
    for (const hook of Array.from(this.renderHooks)) hook(delta);
  }

  /** After the frame is drawn: RenderingServer.frame_post_draw. */
  afterDraw() {
    this.frame_post_draw.emit();
  }

  _processTree(node, delta) {
    if (node._freed) return;
    if (node._process && node._processEnabled !== false && node._readyDone) node._process(delta);
    for (const child of node.children.slice()) if (child._inside) this._processTree(child, delta);
  }

  /** Unhandled input: reverse tree order, stops once handled. O(nodes). */
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

  /** `get_viewport().is_input_handled()` */
  isInputHandled() {
    return this._handled;
  }
}

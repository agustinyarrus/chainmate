/**
 * Coroutines — GDScript's `await`, on JavaScript generators.
 *
 * GDScript resumes a suspended function synchronously, inside the emission of the signal it awaits
 * (GDScriptFunctionState): a coroutine waiting on a timer runs its next stretch during the timers
 * phase, before that frame's tweens and render. `async`/`await` cannot do that — a promise continuation
 * always waits for the microtask checkpoint, after the whole frame. So every ported function that
 * awaited is a generator, driven here:
 *
 *   GDScript                               JavaScript
 *   ─────────────────────────────────────  ────────────────────────────────────────────────
 *   func f() -> void: ... await x ...      *f() { ... yield x; ... }
 *   await f()        (inside a coroutine)  yield* this.f()
 *   f()              (fire and forget)     go(this.f(), 'f')
 *   var v = await sig                      const v = yield sig      (0 args → null, 1 → it, n → array)
 *
 * `x` may be a Signal, a SceneTreeTimer (its `timeout`), a Tween (its `finished`) or a Coroutine
 * (its `completed`). `go` runs the generator up to its first `yield` and parks it on the awaited signal
 * with a one-shot connection, so the emission itself resumes it — the same instant as in Godot.
 * The measured order lives in _oracle/probe_frame_order.gd and test/frame_order.test.mjs.
 */
import { Signal, CONNECT_ONE_SHOT } from './signal.js';

/** Lifecycle of one coroutine — an explicit state machine instead of loose flags. */
export const CoroutineState = Object.freeze({
  RUNNING: 'running',
  SUSPENDED: 'suspended',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

/** Marker for "the awaited value is already settled: continue without suspending". */
const SETTLED = Symbol('settled');

/** Signal arguments → the value an `await` evaluates to (GDScript: none → null, one → it, more → array). */
const awaitResult = (args) => (args.length === 0 ? null : args.length === 1 ? args[0] : args);

export class Coroutine {
  /** Hook for tooling (the e2e HUD): called with (error, coroutine) when a coroutine dies. */
  static onError = null;
  /** Live (suspended) coroutines, for leak checks in tests. */
  static live = new Set();

  /**
   * @param {Generator} generator
   * @param {string} label shown in errors
   */
  constructor(generator, label) {
    if (!generator || typeof generator.next !== 'function') throw new TypeError(`go(${label}): expected a generator — was the function declared with *?`);
    this.generator = generator;
    this.label = label;
    this.state = CoroutineState.RUNNING;
    this.result = undefined;
    /** Emitted with the return value when the generator finishes (awaiting a Coroutine waits on this). */
    this.completed = new Signal();
  }

  get done() {
    return this.state === CoroutineState.COMPLETED || this.state === CoroutineState.FAILED;
  }

  /**
   * Runs until the next suspension. A trampoline: values that are already settled feed straight back
   * into the generator without recursion, so long chains of instant awaits cannot grow the stack.
   */
  _resume(input, mode = 'next') {
    let value = input;
    let how = mode;
    for (;;) {
      this.state = CoroutineState.RUNNING;
      let step;
      try {
        step = how === 'throw' ? this.generator.throw(value) : this.generator.next(value);
      } catch (error) {
        this._fail(error);
        return;
      }
      if (step.done) {
        this._complete(step.value);
        return;
      }
      const wait = this._park(step.value);
      if (wait.kind === SETTLED) {
        value = wait.value;
        how = wait.how;
        continue;
      }
      this.state = CoroutineState.SUSPENDED;
      Coroutine.live.add(this);
      return;
    }
  }

  /** Connects the resumption to whatever was yielded; O(1). */
  _park(awaited) {
    const signal = Coroutine.signalOf(awaited);
    if (signal === null) {
      if (awaited instanceof Coroutine && awaited.done) return { kind: SETTLED, value: awaited.result, how: 'next' };
      return { kind: SETTLED, value: new TypeError(`coroutine ${this.label}: yielded ${Object.prototype.toString.call(awaited)}, which is not awaitable (use yield* for a sub-coroutine)`), how: 'throw' };
    }
    signal.connect((...args) => {
      Coroutine.live.delete(this);
      this._resume(awaitResult(args));
    }, CONNECT_ONE_SHOT);
    return { kind: 'suspended' };
  }

  /** The signal an awaitable completes with, or null. */
  static signalOf(awaited) {
    if (awaited instanceof Signal) return awaited;
    if (awaited instanceof Coroutine) return awaited.done ? null : awaited.completed;
    if (awaited && awaited.timeout instanceof Signal) return awaited.timeout;
    if (awaited && awaited.finished instanceof Signal) return awaited.finished;
    return null;
  }

  _complete(value) {
    this.state = CoroutineState.COMPLETED;
    this.result = value;
    Coroutine.live.delete(this);
    this.completed.emit(value);
  }

  _fail(error) {
    this.state = CoroutineState.FAILED;
    Coroutine.live.delete(this);
    // Loud inside: the error surfaces with the coroutine's name; the frame loop keeps running, as
    // Godot keeps running after a script error in a coroutine.
    console.error(`coroutine "${this.label}" failed:`, error);
    Coroutine.onError?.(error, this);
  }
}

/**
 * Starts a coroutine the way GDScript calls a function that awaits without awaiting it: it runs
 * synchronously up to its first suspension and returns its state object. O(work until first yield).
 * @param {Generator} generator
 * @param {string} [label]
 */
export function go(generator, label = 'coroutine') {
  const coroutine = new Coroutine(generator, label);
  coroutine._resume(undefined);
  return coroutine;
}

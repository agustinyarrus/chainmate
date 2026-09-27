/**
 * Frame order — the port's SceneTree + coroutines replay _oracle/probe_frame_order.gd and must log
 * the same callbacks, in the same frames and the same order, as the shipped engine did.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadOracle, ofKind } from './oracle.mjs';
import { Node, SceneTree } from '../src/godot/scene.js';
import { Coroutine, CoroutineState, go } from '../src/godot/coroutine.js';
import { Signal } from '../src/godot/signal.js';

const FRAME = 1 / 60;

/** Oracle notes → [relativeFrame, text], frames counted from the first logged one. */
function normalize(entries) {
  const first = entries[0].f;
  return entries.map((e) => [e.f - first, e.what]);
}

/** Replays the probe scenario frame by frame; returns the notes. */
function replay() {
  const tree = new SceneTree();
  const notes = [];
  let frameIndex = -1;
  const note = (what) => notes.push([frameIndex, what]);

  class Victim extends Node {
    constructor(label) {
      super('Victim');
      this.label = label;
    }
    _exit_tree() {
      note(`victim freed (queued in ${this.label})`);
    }
  }

  class Worker extends Node {
    constructor() {
      super('Worker');
      this.ticks = 0;
    }
    _process() {
      this.ticks += 1;
      note(`process ${this.ticks}`);
      if (this.ticks === 1) startFromProcess(this);
    }
  }

  const host = tree.root;

  function startFromProcess(worker) {
    tree.callDeferred(() => note('deferred from process'));
    const victim = new Victim('process');
    worker.add_child(victim);
    victim.queue_free();
    tree.create_timer(0.0).timeout.connect(() => onTimerFromProcess(worker));
    tree.create_timer(0.0).timeout.connect(() => note('second timer from process'));
    const tween = worker.create_tween();
    tween.tween_callback(() => onTweenFromProcess(worker));
    tween.finished.connect(() => note('tween from process finished'));
    go(coroutineTimer(), 'timer');
    go(coroutineFrame(), 'frame');
    go(coroutineNested(), 'nested');
    note('process tick 1 done');
  }

  function onTimerFromProcess(worker) {
    note('timer from process');
    tree.create_timer(0.0).timeout.connect(() => note('timer from timer'));
    const tween = worker.create_tween();
    tween.tween_callback(() => note('tween from timer'));
    const victim = new Victim('timer');
    worker.add_child(victim);
    victim.queue_free();
    tree.callDeferred(() => note('deferred from timer'));
  }

  function onTweenFromProcess(worker) {
    note('tween from process');
    const tween = worker.create_tween();
    tween.tween_callback(() => note('tween from tween'));
    tree.create_timer(0.0).timeout.connect(() => note('timer from tween'));
    tree.callDeferred(() => note('deferred from tween'));
  }

  function* coroutineTimer() {
    note('coroutine timer: start');
    yield tree.create_timer(0.0).timeout;
    note('coroutine timer: resumed');
    yield tree.create_timer(0.0);
    note('coroutine timer: resumed again');
  }

  function* coroutineFrame() {
    note('coroutine frame: start');
    yield tree.process_frame;
    note('coroutine frame: resumed');
  }

  function* coroutineNested() {
    note('coroutine nested: start');
    yield* inner();
    note('coroutine nested: after inner');
    const tween = host.create_tween();
    tween.tween_interval(0.0);
    yield tween;
    note('coroutine nested: after tween');
  }

  function* inner() {
    note('inner: start');
    yield tree.create_timer(0.0).timeout;
    note('inner: resumed');
  }

  let finished = false;
  function* run() {
    const worker = new Worker();
    host.add_child(worker);
    for (let i = 0; i < 6; i++) yield tree.process_frame;
    worker.queue_free();
    for (let i = 0; i < 2; i++) yield tree.process_frame;
    finished = true;
  }

  tree.process_frame.connect(() => note('process_frame'));
  go(run(), 'probe');
  for (let guard = 0; !finished && guard < 32; guard++) {
    frameIndex += 1;
    tree.iteration(FRAME);
  }
  return notes;
}

test('one frame runs its phases in the shipped engine order', () => {
  const expected = normalize(ofKind(loadOracle('frame_order'), 'note'));
  const actual = replay();
  assert.equal(actual.length, expected.length, 'same number of callbacks');
  expected.forEach((entry, i) => assert.deepEqual(actual[i], entry, `callback #${i}`));
});

test('coroutines: return values, awaiting a coroutine, settled awaits and loud failures', () => {
  const tree = new SceneTree();
  const signal = new Signal();
  const log = [];

  function* producer() {
    const value = yield signal;
    return value * 2;
  }
  function* consumer() {
    const child = go(producer(), 'producer');
    const doubled = yield child;
    log.push(['doubled', doubled]);
    const again = yield child;
    log.push(['settled', again]);
    const pair = yield signal;
    log.push(['pair', pair]);
    const none = yield signal;
    log.push(['none', none]);
  }
  const co = go(consumer(), 'consumer');
  assert.equal(co.state, CoroutineState.SUSPENDED);
  signal.emit(21);
  assert.deepEqual(log, [['doubled', 42], ['settled', 42]]);
  signal.emit(1, 2);
  signal.emit();
  assert.deepEqual(log.slice(2), [['pair', [1, 2]], ['none', null]]);
  assert.equal(co.state, CoroutineState.COMPLETED);

  const errors = [];
  const previous = Coroutine.onError;
  const consoleError = console.error;
  Coroutine.onError = (error, failed) => errors.push([failed.label, error.message]);
  console.error = () => {};
  try {
    function* broken() {
      yield tree.create_timer(0.0);
      throw new Error('boom');
    }
    function* misuse() {
      yield 42;
    }
    const b = go(broken(), 'broken');
    const m = go(misuse(), 'misuse');
    assert.equal(m.state, CoroutineState.FAILED);
    tree.iteration(FRAME);
    assert.equal(b.state, CoroutineState.FAILED);
    assert.deepEqual(errors.map((e) => e[0]), ['misuse', 'broken']);
    assert.match(errors[0][1], /not awaitable/);
  } finally {
    Coroutine.onError = previous;
    console.error = consoleError;
  }
  assert.throws(() => go(() => {}, 'not a generator'), /expected a generator/);
});

test('coroutines: ten thousand instant awaits do not grow the stack', () => {
  new SceneTree();
  const done = new Coroutine((function* () {})(), 'done');
  done._resume(undefined);
  function* spin() {
    let total = 0;
    for (let i = 0; i < 10000; i++) total += (yield done) === undefined ? 1 : 0;
    return total;
  }
  const co = go(spin(), 'spin');
  assert.equal(co.state, CoroutineState.COMPLETED);
  assert.equal(co.result, 10000);
});

test('timers: created in process count this frame, created by a timeout count from the next', () => {
  const tree = new SceneTree();
  const fired = [];
  class Clock extends Node {
    _process() {
      if (tree.frame === 1) tree.create_timer(2 * FRAME - 1e-12).timeout.connect(() => {
        fired.push(['process timer', tree.frame]);
        tree.create_timer(FRAME).timeout.connect(() => fired.push(['chained', tree.frame]));
      });
    }
  }
  tree.root.add_child(new Clock());
  for (let i = 0; i < 5; i++) tree.iteration(FRAME);
  assert.deepEqual(fired, [['process timer', 2], ['chained', 3]]);
});

test('physics frames flush frees queued by input before the idle frame runs', () => {
  const tree = new SceneTree();
  const freed = [];
  class Doomed extends Node {
    _exit_tree() {
      freed.push(tree.frame);
    }
  }
  const node = tree.root.add_child(new Doomed());
  node.queue_free();
  tree.iteration(FRAME);
  assert.deepEqual(freed, [0], 'freed by the physics frame, before the idle frame counted');
  const stalled = new SceneTree();
  let physics = 0;
  stalled.physics_frame.connect(() => physics++);
  stalled.iteration(1.0);
  assert.equal(physics, 8, 'a one-second stall runs at most 8 physics frames');
  stalled.iteration(FRAME);
  assert.equal(physics, 9, 'and does not spiral afterwards');
});

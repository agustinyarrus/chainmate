/**
 * SoundBuilder — gets every stream of the game synthesised without stalling the page.
 *
 * The original builds its effects on a pool of threads and its music on one more (Sfx._build_effects,
 * Sfx._build_music). Here the two tasks run in Web Workers: side by side when the machine has cores to
 * spare, one after the other (effects first) when it has not. A task whose worker cannot be created,
 * or fails, is run on the main thread instead, a slice at a time with the page breathing in between —
 * slower, never silent.
 *
 * Per task: PENDING → IN_WORKER → DONE, or → ON_MAIN_THREAD → DONE | FAILED.
 */
import { Task, Progress } from './protocol.js';

export const TaskState = Object.freeze({
  PENDING: 'pending',
  IN_WORKER: 'in-worker',
  ON_MAIN_THREAD: 'on-main-thread',
  DONE: 'done',
  FAILED: 'failed',
});

/** Effects first: they are needed from the first click, the music can come a moment later. */
const TASK_ORDER = Object.freeze([Task.EFFECTS, Task.MUSIC]);
/** Logical cores from which the two tasks get a worker each. */
const PARALLEL_FROM_CORES = 3;
/** Main-thread synthesis works this long, then lets the page have a frame. */
const SLICE_MSEC = 8;

const defaultWorker = () => new Worker(new URL('./synth_worker.js', import.meta.url), { type: 'module', name: 'chainmate-synth' });
const defaultSynth = () => import('./synth.js');
const defaultClock = () => performance.now();
const defaultSchedule = (callback) => setTimeout(callback, 0);

export class SoundBuilder {
  /**
   * @param {{
   *   onStream: (stream: { name: string, pcm: Int16Array, rate: number, stereo: boolean, loop: object | null }) => void,
   *   onDone?: (task: string, msec: number) => void,
   *   onFailed?: (task: string, message: string) => void,
   *   createWorker?: (() => Worker) | null,
   *   loadSynth?: () => Promise<{ buildEffects: Function, buildMusic: Function }>,
   *   cores?: number, now?: () => number, schedule?: (callback: () => void) => void,
   * }} options `createWorker: null` forces the main thread
   */
  constructor({
    onStream,
    onDone = () => {},
    onFailed = () => {},
    createWorker = typeof Worker === 'function' ? defaultWorker : null,
    loadSynth = defaultSynth,
    cores = globalThis.navigator?.hardwareConcurrency ?? 1,
    now = defaultClock,
    schedule = defaultSchedule,
  }) {
    this.onStream = onStream;
    this.onDone = onDone;
    this.onFailed = onFailed;
    this.createWorker = createWorker;
    this.loadSynth = loadSynth;
    this.parallel = cores >= PARALLEL_FROM_CORES;
    this.now = now;
    this.schedule = schedule;
    /** @type {Map<string, string>} task → TaskState */
    this.states = new Map(TASK_ORDER.map((task) => [task, TaskState.PENDING]));
    /** @type {Set<Worker>} */
    this.workers = new Set();
    /** Tasks waiting for the main thread, which runs one at a time. */
    this.mainQueue = [];
    this.mainBusy = false;
    this.started = false;
    this.disposed = false;
  }

  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    if (this.createWorker === null) {
      for (const task of TASK_ORDER) this.runOnMainThread(task);
    } else if (this.parallel) {
      for (const task of TASK_ORDER) this.runInWorker([task]);
    } else {
      this.runInWorker([...TASK_ORDER]);
    }
  }

  state(task) {
    return this.states.get(task);
  }

  /** Stops everything that is still running; nothing is reported afterwards. */
  dispose() {
    this.disposed = true;
    for (const worker of this.workers) worker.terminate();
    this.workers.clear();
    this.mainQueue.length = 0;
  }

  /** One worker runs `tasks` in order. Whatever it cannot do moves to the main thread. */
  runInWorker(tasks) {
    const queue = [...tasks];
    let worker;
    const abandon = (reason) => {
      if (worker !== undefined) {
        this.workers.delete(worker);
        worker.terminate();
      }
      if (this.disposed) return;
      console.warn(`audio: synthesis worker unavailable (${reason}); building on the main thread`);
      for (const task of queue) this.runOnMainThread(task);
      queue.length = 0;
    };
    try {
      worker = this.createWorker();
    } catch (error) {
      abandon(error?.message ?? error);
      return;
    }
    this.workers.add(worker);
    const next = () => {
      if (queue.length === 0) {
        this.workers.delete(worker);
        worker.terminate();
        return;
      }
      this.states.set(queue[0], TaskState.IN_WORKER);
      worker.postMessage({ task: queue[0] });
    };
    worker.onmessage = ({ data }) => {
      if (this.disposed || data?.task !== queue[0]) return;
      if (data.type === Progress.STREAM) this.onStream(data.stream);
      else if (data.type === Progress.DONE) {
        this.finish(queue.shift(), data.msec);
        next();
      } else if (data.type === Progress.FAILED) abandon(data.message);
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      abandon(event.message ?? 'error');
    };
    worker.onmessageerror = () => abandon('message could not be read');
    next();
  }

  runOnMainThread(task) {
    this.states.set(task, TaskState.ON_MAIN_THREAD);
    this.mainQueue.push(task);
    if (!this.mainBusy) this.drainMainQueue();
  }

  /** Runs the queued tasks one after the other, each in slices of SLICE_MSEC. O(total samples). */
  async drainMainQueue() {
    this.mainBusy = true;
    while (this.mainQueue.length > 0 && !this.disposed) {
      const task = this.mainQueue.shift();
      const started = this.now();
      try {
        const synth = await this.loadSynth();
        const steps = (task === Task.EFFECTS ? synth.buildEffects : synth.buildMusic)();
        await this.runSliced(steps);
        if (!this.disposed) this.finish(task, this.now() - started);
      } catch (error) {
        this.states.set(task, TaskState.FAILED);
        if (!this.disposed) this.onFailed(task, String(error?.stack ?? error));
      }
    }
    this.mainBusy = false;
  }

  /** Steps through a build generator, giving the page a turn whenever a slice is used up. */
  runSliced(steps) {
    return new Promise((resolve, reject) => {
      const slice = () => {
        if (this.disposed) {
          resolve();
          return;
        }
        try {
          const until = this.now() + SLICE_MSEC;
          do {
            const step = steps.next();
            if (step.done) {
              resolve();
              return;
            }
            if (step.value !== null) this.onStream(step.value);
          } while (this.now() < until);
        } catch (error) {
          reject(error);
          return;
        }
        this.schedule(slice);
      };
      this.schedule(slice);
    });
  }

  finish(task, msec) {
    this.states.set(task, TaskState.DONE);
    this.onDone(task, msec);
  }
}

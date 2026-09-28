/**
 * Synthesis off the main thread: a Web Worker that runs one build task of src/audio/synth.js and posts
 * every finished stream as soon as it exists (its samples are transferred, not copied). The original
 * does the same with its worker threads: the effects in one place, the music in another.
 */
import { buildEffects, buildMusic } from './synth.js';
import { Task, Progress } from './protocol.js';

const BUILDERS = { [Task.EFFECTS]: buildEffects, [Task.MUSIC]: buildMusic };

self.onmessage = ({ data }) => {
  const task = data?.task;
  const started = performance.now();
  try {
    const build = BUILDERS[task];
    if (build === undefined) throw new Error(`unknown task '${task}'`);
    for (const stream of build()) {
      if (stream !== null) self.postMessage({ type: Progress.STREAM, task, stream }, [stream.pcm.buffer]);
    }
    self.postMessage({ type: Progress.DONE, task, msec: performance.now() - started });
  } catch (error) {
    self.postMessage({ type: Progress.FAILED, task, message: String(error?.stack ?? error) });
  }
};

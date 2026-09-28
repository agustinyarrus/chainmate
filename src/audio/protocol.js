/**
 * The messages between the audio engine (main thread) and the mixer (audio thread), and between the
 * engine and the synthesis workers. Plain objects with a `type`; buffers travel as typed arrays.
 */

/** Name the mixer's processor is registered under. */
export const PROCESSOR_NAME = 'chainmate-mixer';

/** Which backend plays: the ported mixer on the audio thread, Web Audio's own nodes, or the best there is. */
export const Backend = Object.freeze({ AUTO: 'auto', WORKLET: 'worklet', NATIVE: 'native' });

/** Engine → mixer. */
export const Command = Object.freeze({
  /** { name, stream: { pcm, rate, stereo, loop } } */
  STREAM: 'stream',
  /** { id, request: { stream, bus, volume, pitchScale, from } } */
  START: 'start',
  /** { id } */
  STOP: 'stop',
  /** { id, volume } */
  VOLUME: 'volume',
  /** { name, settings: { volumeDb, mute } } */
  BUS: 'bus',
});

/** Mixer → engine. */
export const Report = Object.freeze({
  /** { id } — the playback has left the mixer */
  ENDED: 'ended',
  /** { message } — a command could not be applied */
  FAILED: 'failed',
});

/** Engine → synthesis worker: { task }. */
export const Task = Object.freeze({ EFFECTS: 'effects', MUSIC: 'music' });

/** Synthesis worker → engine. */
export const Progress = Object.freeze({
  /** { task, stream: { name, pcm, rate, stereo, loop } } */
  STREAM: 'stream',
  /** { task, msec } */
  DONE: 'done',
  /** { task, message } */
  FAILED: 'failed',
});

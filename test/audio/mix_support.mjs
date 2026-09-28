/**
 * Shared by the mixer and engine tests: the mixer oracle (_oracle/probe_audio_mix.gd), a tap at the
 * place where the oracle's tap sits, and the replay of a recorded case on a mixer.
 */
import { loadOracle, ofKind } from '../oracle.mjs';
import { blobReader, asFloat32, originalStreams } from './support.mjs';
import { Mixer, Stream, Tap, BLOCK_FRAMES } from '../../src/audio/mixer.js';
import { dbToLinearF } from '../../src/audio/decibels.js';

export const MUSIC_BUS = 'Music';
export const SFX_BUS = 'SFX';

/** The mixer oracle, loaded once per process. */
export const mixOracle = (() => {
  let loaded = null;
  return () => {
    if (loaded === null) {
      const entries = loadOracle('audio_mix');
      const blob = blobReader(entries);
      loaded = { entries, cases: ofKind(entries, 'mix'), timing: ofKind(entries, 'timing')[0], frames: (entry) => asFloat32(blob(entry.f32)) };
    }
    return loaded;
  };
})();

/** The original's streams, decoded once: a Stream is read-only, every mixer can share them. */
const sharedStreams = (() => {
  let streams = null;
  return () => (streams ??= originalStreams().map((record) => [record.name, new Stream(record)]));
})();

export function addOriginalStreams(mixer) {
  for (const [name, stream] of sharedStreams()) mixer.addStream(name, stream);
}

/**
 * Records what passes the end of the Master bus effects, like the oracle's capture effect.
 * @returns {{ frames: Float32Array, written: () => number }}
 */
export function tapMaster(mixer, frameCount) {
  const frames = new Float32Array(frameCount * 2);
  let written = 0;
  mixer.buses[0].effects.push(new Tap((block, count) => {
    const take = Math.min(count * 2, frames.length - written);
    frames.set(block.subarray(0, take), written);
    written += take;
  }));
  return { frames, written: () => written };
}

/**
 * Replays the events of an oracle case on a mixer, step by step. An event recorded at frame `at`
 * belongs to the mix step that produces that frame. O(frames × playbacks).
 * @param {object} entry a "mix" entry of the oracle
 * @param {{ mixer?: Mixer, apply?: (row: object, mixer: Mixer) => void, streams?: boolean }} [options]
 *   `apply` replaces the default handling of an event (the engine tests send them through the
 *   engine); `streams: false` leaves the mixer with the streams it already has
 */
export function replayCase(entry, { mixer = new Mixer({ mixRate: entry.mix_rate }), apply = null, streams = true } = {}) {
  if (streams) addOriginalStreams(mixer);
  const tap = tapMaster(mixer, entry.frames);
  const handler = apply ?? directEvents();
  let next = 0;
  for (let at = 0; at < entry.frames; at += BLOCK_FRAMES) {
    while (next < entry.events.length && entry.events[next].at <= at) handler(entry.events[next++], mixer);
    mixer.mixStep();
  }
  return tap.frames;
}

/** The events applied straight to the mixer, the way Sfx._start_voice and the players do. */
export function directEvents() {
  /** voice index → playback id */
  const voices = new Map();
  let nextId = 1;
  let musicId = 0;
  return (row, mixer) => {
    const [, kind, first] = row.event;
    switch (kind) {
      case 'play': {
        // voice.stop() then voice.play(): the old playback fades out while the new one starts.
        if (voices.has(row.voice)) mixer.stop(voices.get(row.voice));
        const id = nextId++;
        mixer.start(id, { stream: first, bus: SFX_BUS, volume: dbToLinearF(row.volume_db), pitchScale: row.pitch_scale });
        voices.set(row.voice, id);
        break;
      }
      case 'stop':
        mixer.stop(voices.get(row.voice));
        break;
      case 'music':
        musicId = nextId++;
        mixer.start(musicId, { stream: 'music', bus: MUSIC_BUS, volume: dbToLinearF(row.volume_db), from: first });
        break;
      case 'music_db':
        mixer.setVolume(musicId, dbToLinearF(row.volume_db));
        break;
      case 'music_stop':
        mixer.stop(musicId);
        break;
      case 'bus':
        mixer.setBus(first, { volumeDb: row.volume_db, mute: row.mute });
        break;
      default:
        throw new Error(`unknown event '${kind}'`);
    }
  };
}

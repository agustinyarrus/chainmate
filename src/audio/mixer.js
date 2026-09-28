/**
 * Mixer — port of the engine's audio mixing path, from a stored 16-bit stream to the samples handed to
 * the audio driver: the WAV stream playback (decode, loop), the cubic resampler, the mix step of the
 * audio server (512-frame blocks, 64 frames of lookahead, volume ramps, fade-outs), the buses with
 * their effects (reverb, hard limiter), their volumes, their sends, and the sleep of silent buses.
 *
 * Why a port instead of Web Audio nodes: the game's sound is this mixer. Its resampler, its reverb and
 * above all its limiter (which engages whenever two loud effects overlap) have no equivalent node, and
 * a port is the same arithmetic — so what reaches the speakers is what the original computes. It runs
 * inside an AudioWorklet (src/audio/worklet.js) and, unchanged, in Node, where test/audio.test.mjs
 * compares its output with frames captured from the original's Master bus (_oracle/probe_audio_mix.gd).
 *
 * Arithmetic: the engine mixes in single precision. Every operation that the C++ does on `float` is
 * rounded with Math.fround here, in the same order; where the C++ mixes a `double` literal into an
 * expression, the expression is evaluated in double and rounded once, exactly as the compiler does.
 *
 * Not ported, because the game never uses it: solo, per-playback filters (3D audio), paused
 * playbacks, surround channels, streams that are not 16-bit PCM, backward and ping-pong loops.
 *
 * Buffers are interleaved stereo Float32Arrays (frame i at 2i and 2i + 1). Nothing is allocated while
 * mixing: playbacks are pooled and every scratch buffer is created once.
 */

import { dbToLinearF } from './decibels.js';

const F = Math.fround;

/** AudioServer::buffer_size — frames mixed per step. */
export const BLOCK_FRAMES = 512;
/** AudioServer::LOOKAHEAD_BUFFER_SIZE — frames mixed ahead, so that a stream can be faded out. */
export const LOOKAHEAD_FRAMES = 64;
/** Per-frame factor of the fade applied to a stream that ran out (0.94⁶⁴ ≈ 0.019). */
const FADEOUT_BASE = F(0.94);
/** AudioStreamPlaybackResampled: frames decoded at a time, and the interpolator's history. */
const RESAMPLER_FRAMES = 128;
const RESAMPLER_HISTORY = 4;
const FRACTION_BITS = 16;
const FRACTION_ONE = 1 << FRACTION_BITS;
const FRACTION_MASK = FRACTION_ONE - 1;
/** `internal_buffer_end` while the decoded block holds no end of stream (unsigned −1). */
const NO_END = 0xffffffff;
/** The decoder divides by this, not by 32768: full scale negative is a hair over −1. */
const PCM_SCALE = 32767.0;
/** audio/buses/channel_disable_threshold_db and channel_disable_time (project defaults). */
const SLEEP_THRESHOLD_DB = -60.0;
const SLEEP_SECONDS = 2.0;
/** The driver receives 21-bit samples: (1 << 20) − 1 is full scale. */
const DRIVER_FULL_SCALE = (1 << 20) - 1;
const DRIVER_STEPS = 1 << 20;

export const PlaybackState = Object.freeze({ PLAYING: 'playing', FADE_OUT: 'fade-out', ENDED: 'ended' });

/** Math::lerp(float, float, float). */
const lerpF = (from, to, weight) => F(from + F(F(to - from) * weight));

/** std::rint in the default rounding mode: halves go to the even neighbour. */
function rint(x) {
  const floor = Math.floor(x);
  const rest = x - floor;
  if (rest < 0.5) return floor;
  if (rest > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

const scratchFloat = new Float32Array(1);
const scratchBits = new Uint32Array(scratchFloat.buffer);

/** Flushes values too small to matter (they would turn into slow denormals in a feedback loop). */
function undenormalize(value) {
  scratchFloat[0] = value;
  return (scratchBits[0] & 0x7f800000) < 0x08000000 ? 0 : scratchFloat[0];
}

// ─────────────────────────────────────────────────────────────── streams ───────────────────────

/** AudioStreamWAV, 16 bits: the samples, their rate and an optional forward loop. */
export class Stream {
  /**
   * @param {{ pcm: Int16Array, rate: number, stereo?: boolean, loop?: { begin: number, end: number } | null }} data
   *   `pcm` is interleaved when stereo; `loop` is in frames
   */
  constructor({ pcm, rate, stereo = false, loop = null }) {
    if (!(pcm instanceof Int16Array)) throw new TypeError('Stream: pcm must be an Int16Array');
    if (!(rate > 0)) throw new RangeError(`Stream: invalid rate ${rate}`);
    this.pcm = pcm;
    this.rate = rate;
    this.stereo = stereo;
    this.loop = loop;
    this.frames = stereo ? pcm.length >> 1 : pcm.length;
    /** AudioStreamWAV::get_length, seconds. */
    this.length = this.frames / rate;
  }
}

/**
 * AudioStreamPlaybackWAV over AudioStreamPlaybackResampled: decodes the stream 128 frames at a time
 * and interpolates them (Catmull-Rom, 16-bit fixed-point position) to the mix rate.
 */
class StreamPlayback {
  constructor() {
    this.internal = new Float32Array((RESAMPLER_FRAMES + RESAMPLER_HISTORY) * 2);
    this.reset(null);
  }

  reset(stream) {
    this.stream = stream;
    /** Next frame to decode. */
    this.offset = 0;
    this.active = false;
    this.internalEnd = NO_END;
    /** Position inside the decoded block, 16.16 fixed point. */
    this.mixOffset = 0;
  }

  /** start(): seek, then prime the resampler with silence as history and one decoded block. */
  start(fromSeconds) {
    const stream = this.stream;
    let time = fromSeconds;
    if (time < 0) time = 0;
    else if (time >= stream.length) time = stream.length - 0.001;
    this.offset = Math.trunc(time * stream.rate);
    this.active = true;
    this.internal.fill(0, 0, RESAMPLER_HISTORY * 2);
    this.decode(this.internal, RESAMPLER_HISTORY, RESAMPLER_FRAMES);
    this.mixOffset = 0;
  }

  /**
   * _mix_internal: decodes `frames` frames into `dst` from frame `at`, following the loop; what lies
   * past the end of the stream is silence. Returns the frames decoded. O(frames).
   */
  decode(dst, at, frames) {
    const stream = this.stream;
    if (stream.frames === 0 || !this.active) {
      dst.fill(0, at * 2, (at + frames) * 2);
      return 0;
    }
    const { pcm, stereo, loop } = stream;
    const length = stream.frames;
    const endLimit = loop !== null ? loop.end : length - 1;
    let todo = frames;
    let write = at * 2;
    while (todo > 0) {
      if (loop !== null && this.offset >= loop.end) {
        this.offset = loop.begin + (this.offset - loop.end);
      } else if (this.offset >= length) {
        this.active = false;
        break;
      }
      const untilLimit = endLimit - this.offset + 1;
      const target = untilLimit < todo ? untilLimit : todo;
      if (target <= 0) {
        this.active = false;
        break;
      }
      todo -= target;
      let offset = this.offset;
      if (stereo) {
        for (let n = 0; n < target; n++) {
          dst[write] = pcm[2 * offset] / PCM_SCALE;
          dst[write + 1] = pcm[2 * offset + 1] / PCM_SCALE;
          write += 2;
          offset += 1;
        }
      } else {
        for (let n = 0; n < target; n++) {
          const value = pcm[offset] / PCM_SCALE;
          dst[write] = value;
          dst[write + 1] = value;
          write += 2;
          offset += 1;
        }
      }
      this.offset = offset;
    }
    if (todo > 0) {
      dst.fill(0, (at + frames - todo) * 2, (at + frames) * 2);
      return frames - todo;
    }
    return frames;
  }

  /**
   * mix(): `frames` frames at the mix rate into `dst` from frame `at`. Returns the index of the first
   * frame that lies past the end of the stream, or `frames` when the stream goes on. O(frames).
   */
  mix(dst, at, rateScale, frames, mixRate, speedScale) {
    const increment = Math.trunc((F(F(this.stream.rate * rateScale) * speedScale) / mixRate) * FRACTION_ONE);
    const buf = this.internal;
    let mixedTotal = -1;
    let mixOffset = this.mixOffset;
    let write = at * 2;
    for (let i = 0; i < frames; i++) {
      const idx = RESAMPLER_HISTORY + (mixOffset >>> FRACTION_BITS);
      const mu = (mixOffset & FRACTION_MASK) / FRACTION_ONE;
      if (idx >= this.internalEnd && mixedTotal === -1) mixedTotal = i;

      const mu2 = F(mu * mu);
      const h11 = F(mu2 * F(mu - 1));
      const z = F(mu2 - h11);
      const h01 = F(z - h11);
      const h10 = F(mu - z);
      const base = (idx - 3) * 2;
      for (let c = 0; c < 2; c++) {
        const y0 = buf[base + c];
        const y1 = buf[base + 2 + c];
        const y2 = buf[base + 4 + c];
        const y3 = buf[base + 6 + c];
        const linear = F(y1 + F(F(y2 - y1) * h01));
        const curve = F(F(F(F(y2 - y0) * h10) + F(F(y3 - y1) * h11)) * 0.5);
        dst[write + c] = linear + curve;
      }
      write += 2;

      mixOffset += increment;
      while (mixOffset >>> FRACTION_BITS >= RESAMPLER_FRAMES) {
        buf.copyWithin(0, RESAMPLER_FRAMES * 2, (RESAMPLER_FRAMES + RESAMPLER_HISTORY) * 2);
        const decoded = this.decode(buf, RESAMPLER_HISTORY, RESAMPLER_FRAMES);
        this.internalEnd = decoded !== RESAMPLER_FRAMES ? decoded : NO_END;
        mixOffset -= RESAMPLER_FRAMES << FRACTION_BITS;
      }
    }
    this.mixOffset = mixOffset;
    return mixedTotal === -1 ? frames : mixedTotal;
  }
}

// ─────────────────────────────────────────────────────────────── effects ───────────────────────

const COMB_TUNINGS = [
  0.025306122448979593, 0.026938775510204082, 0.028956916099773241, 0.03074829931972789,
  0.032244897959183672, 0.03380952380952381, 0.035306122448979592, 0.036666666666666667,
].map(F);
const ALLPASS_TUNINGS = [0.0051020408163265302, 0.007732426303854875, 0.01, 0.012607709750566893].map(F);
const ALLPASS_FEEDBACK = F(0.7);
const WET_SCALE = F(0.6);
const ROOM_SCALE = F(0.28);
const ROOM_OFFSET = F(0.7);
const MAX_ECHO_MS = 500;
const MIN_PREDELAY_FRAMES = 10;
const MIN_LINE_FRAMES = 5;
/** Seconds added to every delay line of the right channel: what makes the reverb stereo. */
const STEREO_SPREAD_SECONDS = 0.000521;

/** One channel of the reverb (reverb_filter.cpp): predelay with feedback, high-pass, 8 combs, 4 all-passes. */
class ReverbChannel {
  constructor(mixRate, extraSpreadBase) {
    this.mixRate = F(mixRate);
    const spreadFrames = rint(F(F(extraSpreadBase) * this.mixRate));
    const line = (tuning) => new Float32Array(Math.max(MIN_LINE_FRAMES, rint(F(tuning * this.mixRate)) + spreadFrames));
    this.spreadFrames = spreadFrames;
    this.combs = COMB_TUNINGS.map((tuning) => ({ buffer: line(tuning), pos: 0, dampHistory: 0 }));
    this.allpasses = ALLPASS_TUNINGS.map((tuning) => ({ buffer: line(tuning), pos: 0 }));
    this.echo = new Float32Array(Math.trunc((MAX_ECHO_MS / 1000.0) * this.mixRate + 1.0));
    this.echoPos = 0;
    this.input = new Float32Array(BLOCK_FRAMES);
    this.highpassIn = 0;
    this.highpassOut = 0;
  }

  /**
   * `src` and `dst` are interleaved stereo; this channel reads and writes every second value from
   * `channel`. O(frames × 14): one pass per delay line.
   */
  process(src, dst, channel, frames, p) {
    const { echo, input } = this;
    const echoSize = echo.length;
    let predelayFrames = rint((p.predelay / 1000.0) * this.mixRate);
    if (predelayFrames < MIN_PREDELAY_FRAMES) predelayFrames = MIN_PREDELAY_FRAMES;
    if (predelayFrames >= echoSize) predelayFrames = echoSize - 1;

    let echoPos = this.echoPos;
    for (let i = 0; i < frames; i++) {
      if (echoPos >= echoSize) echoPos = 0;
      let readPos = echoPos - predelayFrames;
      while (readPos < 0) readPos += echoSize;
      const value = undenormalize(F(F(echo[readPos] * p.predelayFeedback) + src[2 * i + channel]));
      echo[echoPos] = value;
      input[i] = value;
      dst[2 * i + channel] = 0;
      echoPos += 1;
    }
    this.echoPos = echoPos;

    if (p.highpass > 0) {
      const aux = F(Math.exp((-Math.PI * 2 * p.highpass * 6000) / this.mixRate));
      const a1 = F((1.0 + aux) / 2.0);
      const a2 = F(-(1.0 + aux) / 2.0);
      let h1 = this.highpassIn;
      let h2 = this.highpassOut;
      for (let i = 0; i < frames; i++) {
        const value = input[i];
        const out = F(F(F(value * a1) + F(h1 * a2)) + F(h2 * aux));
        input[i] = out;
        h2 = out;
        h1 = value;
      }
      this.highpassIn = h1;
      this.highpassOut = h2;
    }

    const trimmed = rint(this.spreadFrames * (1.0 - p.spread));
    const dampKeep = 1.0 - p.damp;
    for (const comb of this.combs) {
      const buffer = comb.buffer;
      const sizeLimit = buffer.length - trimmed;
      let pos = comb.pos;
      let history = comb.dampHistory;
      for (let j = 0; j < frames; j++) {
        if (pos >= sizeLimit) pos = 0;
        let out = undenormalize(F(buffer[pos] * p.feedback));
        out = F(out * dampKeep + F(history * p.damp));
        history = out;
        buffer[pos] = input[j] + out;
        dst[2 * j + channel] += out;
        pos += 1;
      }
      comb.pos = pos;
      comb.dampHistory = history;
    }

    for (const allpass of this.allpasses) {
      const buffer = allpass.buffer;
      const sizeLimit = buffer.length - trimmed;
      let pos = allpass.pos;
      for (let j = 0; j < frames; j++) {
        if (pos >= sizeLimit) pos = 0;
        const at = 2 * j + channel;
        const aux = buffer[pos];
        const stored = undenormalize(F(F(ALLPASS_FEEDBACK * aux) + dst[at]));
        buffer[pos] = stored;
        dst[at] = aux - F(ALLPASS_FEEDBACK * stored);
        pos += 1;
      }
      allpass.pos = pos;
    }

    for (let i = 0; i < frames; i++) {
      const at = 2 * i + channel;
      dst[at] = F(F(F(dst[at] * p.wet) * WET_SCALE) + F(src[at] * p.dry));
    }
  }
}

/** AudioEffectReverb: two independent channels, the right one with slightly longer delay lines. */
export class Reverb {
  /**
   * @param {{ roomSize: number, damping: number, spread: number, hipass: number, predelayMsec: number,
   *   predelayFeedback: number, dry: number, wet: number }} settings the effect's properties
   */
  constructor(settings, mixRate) {
    this.processSilence = false;
    this.channels = [new ReverbChannel(mixRate, 0), new ReverbChannel(mixRate, STEREO_SPREAD_SECONDS)];
    this.parameters = Reverb.parameters(settings, mixRate);
  }

  /** The properties as the filter uses them (Reverb::update_parameters and the setters). */
  static parameters(settings, mixRate) {
    const roomSize = F(settings.roomSize);
    let feedback = F(ROOM_OFFSET + F(roomSize * ROOM_SCALE));
    const ceiling = F(ROOM_OFFSET + ROOM_SCALE);
    if (feedback < ROOM_OFFSET) feedback = ROOM_OFFSET;
    else if (feedback > ceiling) feedback = ceiling;
    let aux = F(F(settings.damping) / 2.0 + 0.5);
    aux = F(aux * aux);
    return {
      feedback,
      damp: F(Math.exp((-Math.PI * 2 * aux * 10000) / F(mixRate))),
      spread: F(settings.spread),
      highpass: Math.min(Math.max(F(settings.hipass), 0), 1),
      predelay: F(settings.predelayMsec),
      predelayFeedback: Math.min(Math.max(F(settings.predelayFeedback), 0), F(0.98)),
      dry: F(settings.dry),
      wet: F(settings.wet),
    };
  }

  process(src, dst, frames) {
    this.channels[0].process(src, dst, 0, frames, this.parameters);
    this.channels[1].process(src, dst, 1, frames, this.parameters);
  }
}

const LIMITER_ATTACK = F(0.002);
const LIMITER_SUSTAIN = F(0.02);

/**
 * AudioEffectHardLimiter: a look-ahead limiter. The signal is delayed by the attack time; the gain
 * that keeps it under the ceiling is held as the minimum over the last attack + sustain, tracked in
 * buckets of one attack each, and released afterwards. O(frames × buckets).
 */
export class HardLimiter {
  /** @param {{ ceilingDb: number, preGainDb: number, release: number }} settings */
  constructor(settings, mixRate) {
    this.processSilence = false;
    this.mixRate = F(mixRate);
    this.ceiling = dbToLinearF(settings.ceilingDb);
    this.preGain = dbToLinearF(settings.preGainDb);
    this.release = F(settings.release);
    const delay = Math.ceil(F(this.mixRate * LIMITER_ATTACK)) + 1;
    this.delayed = new Float32Array(delay * 2);
    this.delayFrames = delay;
    this.cursor = 0;
    this.gainFramesStored = Math.ceil(F(F(this.mixRate * F(LIMITER_ATTACK + LIMITER_SUSTAIN)) + 1));
    this.bucketFrames = Math.trunc(F(this.mixRate * LIMITER_ATTACK));
    this.buckets = new Float32Array(Math.ceil(this.gainFramesStored / this.bucketFrames)).fill(1);
    this.bucketCursor = 0;
    this.releaseFactor = 0;
    this.attackFactor = 0;
    this.gain = 1;
    this.gainTarget = 1;
    /** Seconds per frame, as the release (double) and the attack (float) count it down. */
    this.frameSeconds = 1.0 / this.mixRate;
    this.frameSecondsF = F(1 / this.mixRate);
  }

  process(src, dst, frames) {
    const { ceiling, preGain, release, delayed, buckets, bucketFrames } = this;
    let { releaseFactor, attackFactor, gain, gainTarget, cursor, bucketCursor } = this;
    for (let i = 0; i < frames; i++) {
      const left = F(src[2 * i] * preGain);
      const right = F(src[2 * i + 1] * preGain);
      const largest = Math.max(Math.abs(left), Math.abs(right));

      releaseFactor = F(Math.max(0.0, releaseFactor - this.frameSeconds));
      releaseFactor = Math.min(releaseFactor, release);
      if (releaseFactor > 0.0) gain = lerpF(gainTarget, 1, F(1 - F(releaseFactor / release)));

      if (F(largest * gain) > ceiling) {
        gainTarget = F(ceiling / largest);
        releaseFactor = release;
        attackFactor = LIMITER_ATTACK;
      }

      // The gain closes in over the attack time, so that it never jumps.
      attackFactor = Math.max(0, F(attackFactor - this.frameSecondsF));
      if (attackFactor > 0.0) gain = lerpF(gainTarget, gain, F(1 - F(attackFactor / LIMITER_ATTACK)));

      const bucket = Math.trunc(bucketCursor / bucketFrames);
      if (bucketCursor % bucketFrames === 0) buckets[bucket] = 1;
      if (gain < buckets[bucket]) buckets[bucket] = gain;
      bucketCursor = (bucketCursor + 1) % this.gainFramesStored;
      for (let j = 0; j < buckets.length; j++) if (buckets[j] < gain) gain = buckets[j];

      const delayedLeft = delayed[2 * cursor];
      const delayedRight = delayed[2 * cursor + 1];
      delayed[2 * cursor] = left;
      delayed[2 * cursor + 1] = right;
      cursor = (cursor + 1) % this.delayFrames;
      dst[2 * i] = delayedLeft * gain;
      dst[2 * i + 1] = delayedRight * gain;
    }
    Object.assign(this, { releaseFactor, attackFactor, gain, gainTarget, cursor, bucketCursor });
  }
}

/**
 * What a capture effect sees: every block that passes, including the stale ones of a sleeping bus.
 * Tests append it to the Master bus, where the oracle's tap sits.
 */
export class Tap {
  /** @param {(block: Float32Array, frames: number) => void} receive called with the bus buffer (not a copy) */
  constructor(receive) {
    this.processSilence = true;
    this.receive = receive;
  }

  process(src, dst, frames) {
    dst.set(src.subarray(0, frames * 2));
    this.receive(src, frames);
  }
}

// ─────────────────────────────────────────────────────────────── buses ─────────────────────────

/** The game's bus layout (scripts/autoload/sfx.gd, _setup_buses), first bus is the output. */
export const GAME_BUSES = Object.freeze([
  { name: 'Master', send: null, effects: [{ type: 'limiter', ceilingDb: -0.5, preGainDb: 0.0, release: 0.12 }] },
  {
    name: 'Music',
    send: 'Master',
    effects: [{ type: 'reverb', roomSize: 0.85, damping: 0.6, spread: 1.0, hipass: 0.1, predelayMsec: 60.0, predelayFeedback: 0.3, dry: 0.85, wet: 0.3 }],
  },
  {
    name: 'SFX',
    send: 'Master',
    effects: [{ type: 'reverb', roomSize: 0.78, damping: 0.55, spread: 0.7, hipass: 0.25, predelayMsec: 45.0, predelayFeedback: 0.2, dry: 1.0, wet: 0.12 }],
  },
]);

function createEffect(settings, mixRate) {
  if (settings.type === 'reverb') return new Reverb(settings, mixRate);
  if (settings.type === 'limiter') return new HardLimiter(settings, mixRate);
  throw new Error(`Mixer: unknown effect type '${settings.type}'`);
}

class Bus {
  constructor(layout, index, mixRate) {
    this.name = layout.name;
    this.index = index;
    this.sendName = layout.send;
    /** @type {Bus | null} resolved by the mixer */
    this.send = null;
    this.volumeDb = 0;
    /** db_to_linear(volumeDb), kept up to date by Mixer.setBus. */
    this.volume = 1;
    this.mute = false;
    this.bypass = false;
    this.effects = layout.effects.map((settings) => createEffect(settings, mixRate));
    this.buffer = new Float32Array(BLOCK_FRAMES * 2);
    /** Something was mixed into the bus during this step. */
    this.used = false;
    /** Awake: a bus that carried nothing audible for two seconds goes to sleep, effects and all. */
    this.active = false;
    this.lastMixWithAudio = 0;
  }
}

class Playback {
  constructor() {
    this.source = new StreamPlayback();
    this.lookahead = new Float32Array(LOOKAHEAD_FRAMES * 2);
    this.clear();
  }

  clear() {
    this.id = 0;
    this.state = PlaybackState.ENDED;
    /** @type {Bus | null} */
    this.bus = null;
    this.pitchScale = 1;
    /** Linear volume asked for, and the one the previous step ended on. */
    this.volume = 1;
    this.previousVolume = 0;
    this.mixedBefore = false;
    this.lookahead.fill(0);
    this.source.reset(null);
  }
}

export class Mixer {
  /**
   * @param {{ mixRate?: number, buses?: ReadonlyArray<object>, speedScale?: number,
   *   onEnded?: (id: number) => void }} [options] `onEnded` is called from inside the mix step when a
   *   playback leaves the mixer (its stream ran out, or its stop has been faded)
   */
  constructor({ mixRate = 44100, buses = GAME_BUSES, speedScale = 1, onEnded = () => {} } = {}) {
    this.mixRate = mixRate;
    this.speedScale = F(speedScale);
    this.onEnded = onEnded;
    this.buses = buses.map((layout, index) => new Bus(layout, index, mixRate));
    /** @type {Map<string, Bus>} */
    this.busByName = new Map(this.buses.map((bus) => [bus.name, bus]));
    for (const bus of this.buses) bus.send = this.resolveSend(bus);
    /** @type {Map<string | number, Stream>} */
    this.streams = new Map();
    /** Newest first, the order the engine mixes them in. */
    this.playbacks = [];
    /** @type {Map<number, Playback>} */
    this.playbackById = new Map();
    this.pool = [];
    this.mixBuffer = new Float32Array((BLOCK_FRAMES + LOOKAHEAD_FRAMES) * 2);
    this.scratch = new Float32Array(BLOCK_FRAMES * 2);
    this.sleepThreshold = dbToLinearF(SLEEP_THRESHOLD_DB);
    this.sleepFrames = Math.trunc(F(F(SLEEP_SECONDS) * F(mixRate)));
    /** Frames mixed so far, and how many of the current block are still to be handed out. */
    this.mixFrames = 0;
    this.toMix = 0;
    this.ramp = new Float32Array(BLOCK_FRAMES);
    this.rampBack = new Float32Array(BLOCK_FRAMES);
    for (let i = 0; i < BLOCK_FRAMES; i++) {
      this.ramp[i] = i / BLOCK_FRAMES;
      this.rampBack[i] = 1 - this.ramp[i];
    }
  }

  /** A bus sends to the named bus if that one comes earlier in the layout, else to the first bus. */
  resolveSend(bus) {
    if (bus.index === 0) return null;
    const target = this.busByName.get(bus.sendName);
    return target !== undefined && target.index < bus.index ? target : this.buses[0];
  }

  // ───────────────────────────────────────────────────────────── control ───────────────────────

  addStream(name, stream) {
    this.streams.set(name, stream);
  }

  hasStream(name) {
    return this.streams.has(name);
  }

  /**
   * AudioServer::start_playback_stream. The playback joins the next mix step at full volume.
   * @param {number} id caller's handle, unique among live playbacks
   * @param {{ stream: string | number, bus: string, volume: number, pitchScale?: number, from?: number }} request
   *   `volume` is linear; `from` is in seconds
   */
  start(id, { stream: streamName, bus: busName, volume, pitchScale = 1, from = 0 }) {
    const stream = this.streams.get(streamName);
    if (stream === undefined) throw new Error(`Mixer: unknown stream '${streamName}'`);
    if (this.playbackById.has(id)) throw new Error(`Mixer: playback ${id} is already live`);
    const playback = this.pool.pop() ?? new Playback();
    playback.id = id;
    playback.state = PlaybackState.PLAYING;
    playback.bus = this.busByName.get(busName) ?? this.buses[0];
    playback.pitchScale = F(pitchScale);
    playback.volume = F(volume);
    playback.source.reset(stream);
    playback.source.start(F(from));
    this.playbacks.unshift(playback);
    this.playbackById.set(id, playback);
  }

  /** AudioServer::stop_playback_stream: the playback fades to silence over its next step, then leaves. */
  stop(id) {
    const playback = this.playbackById.get(id);
    if (playback !== undefined && playback.state === PlaybackState.PLAYING) playback.state = PlaybackState.FADE_OUT;
  }

  /** Linear volume, reached by a ramp over the next step. */
  setVolume(id, volume) {
    const playback = this.playbackById.get(id);
    if (playback !== undefined) playback.volume = F(volume);
  }

  /** AudioServer::set_bus_volume_db and set_bus_mute; unknown buses are reported to the caller. */
  setBus(name, { volumeDb, mute }) {
    const bus = this.busByName.get(name);
    if (bus === undefined) return false;
    if (volumeDb !== undefined) {
      bus.volumeDb = F(volumeDb);
      bus.volume = dbToLinearF(bus.volumeDb);
    }
    if (mute !== undefined) bus.mute = Boolean(mute);
    return true;
  }

  isPlaying(id) {
    return this.playbackById.get(id)?.state === PlaybackState.PLAYING;
  }

  // ───────────────────────────────────────────────────────────── mixing ────────────────────────

  /** The bus buffer a source mixes into; the first use in a step wakes the bus and clears it. */
  busBuffer(bus) {
    if (!bus.used) {
      bus.used = true;
      bus.active = true;
      bus.lastMixWithAudio = this.mixFrames;
      bus.buffer.fill(0);
    }
    return bus.buffer;
  }

  /** AudioServer::_mix_step: one block of every bus. O(playbacks × block + effects). */
  mixStep() {
    for (const bus of this.buses) bus.used = false;

    const buf = this.mixBuffer;
    let ended = 0;
    for (const playback of this.playbacks) {
      const fadingOut = playback.state === PlaybackState.FADE_OUT;
      buf.set(playback.lookahead, 0);
      const mixed = playback.source.mix(buf, LOOKAHEAD_FRAMES, playback.pitchScale, BLOCK_FRAMES, this.mixRate, this.speedScale);
      if (mixed !== BLOCK_FRAMES) {
        // The stream ran out: what is left in the block dies away quickly instead of clicking.
        let coefficient = 1;
        for (let idx = mixed; idx < BLOCK_FRAMES; idx++) {
          coefficient = F(coefficient * FADEOUT_BASE);
          buf[2 * idx] *= coefficient;
          buf[2 * idx + 1] *= coefficient;
        }
        playback.state = PlaybackState.ENDED;
      } else {
        playback.lookahead.set(buf.subarray(BLOCK_FRAMES * 2, (BLOCK_FRAMES + LOOKAHEAD_FRAMES) * 2));
      }

      const volume = fadingOut ? 0 : playback.volume;
      // A playback that was not sounding starts at its volume: a ramp would soften its attack.
      const startVolume = playback.mixedBefore ? playback.previousVolume : volume;
      this.mixInto(this.busBuffer(playback.bus), buf, startVolume, volume);
      playback.previousVolume = volume;
      playback.mixedBefore = true;

      if (fadingOut) playback.state = PlaybackState.ENDED;
      if (playback.state === PlaybackState.ENDED) ended += 1;
    }
    if (ended > 0) this.removeEnded();

    for (let i = this.buses.length - 1; i >= 0; i--) this.processBus(this.buses[i]);
    this.mixFrames += BLOCK_FRAMES;
  }

  /** _mix_step_for_channel: `src` into `dst` under a volume that moves linearly across the block. */
  mixInto(dst, src, startVolume, endVolume) {
    const { ramp, rampBack } = this;
    for (let i = 0; i < BLOCK_FRAMES; i++) {
      const volume = F(F(endVolume * ramp[i]) + F(rampBack[i] * startVolume));
      dst[2 * i] += F(volume * src[2 * i]);
      dst[2 * i + 1] += F(volume * src[2 * i + 1]);
    }
  }

  removeEnded() {
    const playbacks = this.playbacks;
    let kept = 0;
    for (let i = 0; i < playbacks.length; i++) {
      const playback = playbacks[i];
      if (playback.state !== PlaybackState.ENDED) {
        playbacks[kept++] = playback;
        continue;
      }
      const id = playback.id;
      this.playbackById.delete(id);
      playback.clear();
      this.pool.push(playback);
      this.onEnded(id);
    }
    playbacks.length = kept;
  }

  /** Effects, volume, sleep check and send of one bus. */
  processBus(bus) {
    // Awake but unused: the buffer still holds the previous block.
    if (bus.active && !bus.used) bus.buffer.fill(0);

    if (!bus.bypass) {
      for (const effect of bus.effects) {
        if (!(bus.active || effect.processSilence)) continue;
        effect.process(bus.buffer, this.scratch, BLOCK_FRAMES);
        const output = this.scratch;
        this.scratch = bus.buffer;
        bus.buffer = output;
      }
    }
    if (!bus.active) return;

    const buffer = bus.buffer;
    const volume = bus.mute ? 0 : bus.volume;
    let peak = 0;
    for (let j = 0; j < BLOCK_FRAMES * 2; j++) {
      const value = F(buffer[j] * volume);
      buffer[j] = value;
      const level = Math.abs(value);
      if (level > peak) peak = level;
    }

    if (!bus.used) {
      if (peak > this.sleepThreshold) bus.lastMixWithAudio = this.mixFrames;
      else if (this.mixFrames - bus.lastMixWithAudio > this.sleepFrames) {
        bus.active = false;
        return;
      }
    }

    if (bus.send !== null) {
      const target = this.busBuffer(bus.send);
      for (let j = 0; j < BLOCK_FRAMES * 2; j++) target[j] += buffer[j];
    }
  }

  /**
   * AudioServer::_driver_process: hands out `frames` frames of the first bus, mixing a new block
   * whenever the current one is used up. The driver's samples are clamped and cut to 21 bits.
   * @param {Float32Array} left
   * @param {Float32Array} right
   */
  render(left, right, frames = left.length) {
    let done = 0;
    while (done < frames) {
      if (this.toMix === 0) {
        this.mixStep();
        this.toMix = BLOCK_FRAMES;
      }
      const count = Math.min(this.toMix, frames - done);
      const master = this.buses[0];
      if (master.active) {
        const buffer = master.buffer;
        let read = (BLOCK_FRAMES - this.toMix) * 2;
        for (let j = 0; j < count; j++) {
          left[done + j] = toDriver(buffer[read]);
          right[done + j] = toDriver(buffer[read + 1]);
          read += 2;
        }
      } else {
        left.fill(0, done, done + count);
        right.fill(0, done, done + count);
      }
      done += count;
      this.toMix -= count;
    }
  }
}

/** One sample as the driver gets it: clamped to ±1, truncated to 21 bits. */
function toDriver(value) {
  const clamped = value < -1 ? -1 : value > 1 ? 1 : value;
  return Math.trunc(F(clamped * DRIVER_FULL_SCALE)) / DRIVER_STEPS;
}

/**
 * AudioSynth — port of scripts/presentation/audio_synth.gd: every sound of the game and its music,
 * synthesised in code. Nothing is sampled: struck objects are sums of decaying resonators ("modes"),
 * breath and impact are filtered noise, pads and horns are wavetable voices.
 *
 * The port keeps the original's arithmetic operation for operation, so the buffers come out the same:
 *   - GDScript floats are doubles → plain JavaScript numbers;
 *   - PackedFloat32Array stores round to float32 → Float32Array (`buf[i] += y` reads a float32, adds
 *     in double, rounds the sum back — in both languages);
 *   - the random streams are Godot's PCG32, reseeded with hash(name) before every sound;
 *   - integer conversions use Godot's rules (roundi rounds half away from zero, int() truncates);
 *   - sin, cos, exp, log and pow are the original C library's, reproduced by ./libm.js (a browser's
 *     own would differ in the last bit of a double, and visibly where a sine crosses zero).
 * test/audio.test.mjs compares every buffer with the original's: they are identical, as float32 and
 * as the 16-bit PCM the engine plays.
 *
 * Pure computation: no Web Audio, no DOM — runs in Node, in a worker or on the main thread.
 * Cost: O(samples × layers); the whole set is about 0.9 M effect samples and 1.4 M music samples.
 */
import { RandomNumberGenerator, hashString } from '../godot/rng.js';
import { sortCustom } from '../godot/gdscript.js';
import { sin, cos, tan, tanh, exp, log, pow } from './libm.js';

export const SFX_RATE = 44100;
export const MID_RATE = 22050;
export const LOW_RATE = 11025;
export const MUSIC_RATE = 22050;
export const MUSIC_LOOP_SECONDS = 32.0;
/** Pad releases and bell tails run past the loop point and are folded back onto its start. */
const MUSIC_TAIL_SECONDS = 10.0;
const MUSIC_PEAK = 0.25;
/** Frames repeated after the loop end, for the player's interpolation across the seam. */
export const MUSIC_GUARD = 8;

const NOISE_SIZE = 65536;
const NOISE_MASK = NOISE_SIZE - 1;
const TABLE_SIZE = 2048;
const TABLE_MASK = TABLE_SIZE - 1;
const LN_1000 = 6.907755278982137;
/** A resonator is dropped once it has decayed to this level (−80 dB). */
const SILENCE = 0.0001;
const NOISE_SEED = 24301;
const TAU = Math.PI * 2;
const PI = Math.PI;

const Filter = Object.freeze({ LOW: 0, BAND: 1, HIGH: 2 });

export const SOUND_NAMES = Object.freeze([
  'ui_hover', 'ui_click', 'ui_back', 'select', 'deselect', 'move', 'enemy_move', 'land',
  'capture', 'shatter', 'chain_step', 'check', 'coin', 'relic_trigger', 'encounter_start',
  'encounter_won', 'lost', 'victory', 'purchase', 'train', 'level_up', 'promote',
  'map_step', 'error',
]);

/** Relative synthesis cost of each sound: what the build batches are balanced with. */
export const BUILD_COST = Object.freeze({
  ui_hover: 1, ui_click: 1, ui_back: 1, select: 2, deselect: 1, move: 2,
  enemy_move: 2, land: 1, capture: 3, shatter: 6, chain_step: 7, check: 12,
  coin: 3, relic_trigger: 7, encounter_start: 20, encounter_won: 17, lost: 10,
  victory: 36, purchase: 9, train: 6, level_up: 10, promote: 10, map_step: 3,
  error: 3,
});

// Pitches (Hz), D-centred.
const D5 = 587.33;
const D2 = D5 * 0.125;
const A2 = 110.0;
const D3 = D5 * 0.25;
const E3 = 164.814;
const F3 = 174.614;
const G3 = 195.998;
const A3 = 220.0;
const BB3 = 233.082;
const B3 = 246.942;
const D4 = D5 * 0.5;
const E4 = 329.628;
const F4 = 349.228;
const FS4 = 369.994;
const G4 = 391.995;
const A4 = 440.0;
const B4 = 493.883;
const C5 = 523.251;
const F5 = 698.456;
const FS5 = 739.989;
const A5 = 880.0;
const D6 = D5 * 2.0;
const E6 = 1318.51;
const FS6 = 1479.978;
const A6 = 1760.0;
const B6 = 1975.533;
const D7 = D5 * 4.0;

// Mode tables: (frequency ratio, amplitude, decay seconds to −60 dB) per mode.
const WOOD_KNOCK = [1.0, 1.0, 0.07, 1.58, 0.5, 0.045, 2.45, 0.32, 0.028, 3.93, 0.14, 0.012];
const STONE_KNOCK = [1.0, 1.0, 0.05, 1.71, 0.55, 0.034, 3.07, 0.3, 0.014];
const CHIME_BASE = D5;
const CHIME_MODES = [
  1.0, 1.0, 1.4,
  1.0028, 0.45, 1.2,
  2.0, 0.22, 0.8,
  2.756, 0.42, 0.6,
  4.07, 0.13, 0.38,
  5.404, 0.16, 0.28,
  8.933, 0.05, 0.12,
];
const GLASS_BASE = D6;
const GLASS_MODES = [1.0, 1.0, 0.75, 1.0024, 0.8, 0.7, 2.0, 0.07, 0.35, 2.94, 0.05, 0.2];
const PING_BASE = B6;
const PING_MODES = [1.0, 1.0, 0.42, 1.0042, 0.6, 0.4, 2.405, 0.42, 0.22, 3.87, 0.2, 0.12, 5.52, 0.1, 0.06];
const WARM_BASE = D3;
const WARM_MODES = [1.0, 1.0, 1.8, 2.0, 0.5, 1.2, 3.0, 0.3, 0.8, 4.0, 0.16, 0.55, 5.0, 0.08, 0.4, 6.0, 0.04, 0.3];
const ANVIL_MODES = [
  1.0, 1.0, 0.9, 1.006, 0.6, 0.8, 1.47, 0.6, 0.6, 2.09, 0.55, 0.5,
  2.56, 0.4, 0.4, 3.14, 0.3, 0.3, 3.88, 0.2, 0.2, 4.53, 0.1, 0.12,
];
const DULL_BELL_MODES = [0.5, 0.6, 1.8, 1.0, 0.5, 1.2, 1.189, 0.4, 1.0, 1.5, 0.2, 0.7, 2.0, 0.3, 0.6, 2.51, 0.1, 0.35];
const GONG_STRIKE = [1.0, 0.8, 1.9, 1.52, 0.55, 1.6];
const GONG_BLOOM = [2.03, 0.35, 1.3, 2.48, 0.4, 1.2, 2.93, 0.3, 1.0, 3.46, 0.25, 0.9, 4.12, 0.2, 0.8, 4.63, 0.15, 0.7];
const GONG_SHIMMER = [7.1, 1.0, 1.1, 9.3, 1.0, 1.1, 12.4, 1.0, 1.1, 15.8, 1.0, 1.1];
const MUSIC_BELL_MODES = [1.0, 1.0, 3.2, 1.0021, 0.45, 2.9, 2.0, 0.16, 1.8, 2.756, 0.2, 1.1, 4.07, 0.05, 0.6, 5.404, 0.06, 0.45];

const TABLE_HARMONICS = Object.freeze({
  pad: [1.0, 0.5, 0.3, 0.18, 0.1, 0.06, 0.03],
  horn: [1.0, 0.6, 0.35, 0.2, 0.1, 0.05],
  soft: [1.0, 0.25, 0.08],
  buzz: [1.0, 0.0, 0.4, 0.0, 0.25, 0.0, 0.15, 0.0, 0.08],
});

// Music.
const DRONE_PERIOD = 600;
const DRONE_LEVEL = 0.15;
const DRONE_HARMONICS = 37;
const PAD_LEVEL = 0.105;
const PAD_TILE_SECONDS = 2.0;
const BELL_LEVEL = 0.65;
const BELL_ECHO_DELAY = 0.55;
const BELL_ECHO_LEVEL = 0.28;
const AIR_LEVEL = 0.45;
const AIR_PERIOD_SECONDS = 8.0;
/** Slow controls (brightness, swell, grit) are refreshed every 256 samples. */
const CONTROL_MASK = 255;
/** Filter coefficients and glides are refreshed every 16 samples. */
const BLOCK_MASK = 15;
const MUSIC_CHORD_SIZE = 4;
const MUSIC_CHORDS = [
  F3, A3, D4, E4,
  F3, BB3, D4, F4,
  G3, BB3, D4, F4,
  E3, A3, D4, E4,
];
/** (time s, frequency, level, pan) per bell. */
const MUSIC_BELLS = [
  2.0, A4, 0.7, -0.35,
  5.5, D5, 0.5, 0.3,
  7.25, C5, 0.4, 0.1,
  11.0, F4, 0.6, -0.2,
  14.5, G4, 0.45, 0.4,
  18.0, A4, 0.6, -0.4,
  19.75, C5, 0.42, 0.25,
  25.0, F5, 0.35, 0.45,
  26.5, D5, 0.5, -0.1,
  30.0, A4, 0.3, 0.2,
];

// ─────────────────────────────────────────────────────────────── GDScript numerics ─────────────

/** roundi / roundf: halves away from zero. */
const round = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
/** fposmod */
function fposmod(x, y) {
  let value = x % y;
  if ((value < 0 && y > 0) || (value > 0 && y < 0)) value += y;
  return value + 0.0;
}

class Layer {
  /**
   * @param {number} seconds
   * @param {number} rate samples per second
   */
  constructor(seconds, rate) {
    this.rate = rate;
    this.data = new Float32Array(Math.max(1, Math.ceil(seconds * rate)));
  }
}

function peak(buf) {
  let top = 0.0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    if (v > top) top = v;
    else if (-v > top) top = -v;
  }
  return top;
}

function scale(buf, gain) {
  for (let i = 0; i < buf.length; i++) buf[i] *= gain;
}

/** Samples until a mode of `amp` decaying 60 dB in `decay` seconds falls under SILENCE. */
function ringSamples(amp, decay, rate) {
  const level = Math.abs(amp);
  if (level <= SILENCE || decay <= 0.0) return 0;
  return Math.ceil(((decay * log(level / SILENCE)) / LN_1000) * rate);
}

function fadeEnd(layer, seconds) {
  const buf = layer.data;
  const n = buf.length;
  const fade = Math.min(n, round(seconds * layer.rate));
  for (let i = 0; i < fade; i++) buf[n - 1 - i] *= i / fade;
}

/** Adds what lies past the loop point back onto the loop's start and cuts the layer there. */
function foldTail(layer, loopN) {
  const buf = layer.data;
  for (let i = loopN; i < buf.length; i++) buf[i - loopN] += buf[i];
  layer.data = buf.slice(0, loopN);
}

/** Two-pole low-pass run twice around a circular buffer, so the result loops without a seam. */
function lowpassCircular(buf, cutoff, rate) {
  const a = 1.0 - exp((-TAU * cutoff) / rate);
  let s1 = 0.0;
  let s2 = 0.0;
  for (let i = 0; i < buf.length; i++) {
    s1 += a * (buf[i] - s1);
    s2 += a * (s1 - s2);
  }
  for (let i = 0; i < buf.length; i++) {
    s1 += a * (buf[i] - s1);
    s2 += a * (s1 - s2);
    buf[i] = s2;
  }
}

export class AudioSynth {
  /**
   * @param {AudioSynth|null} source a prepared synthesiser whose tables and templates are shared
   *   (the original builds effects on several threads from one prepared instance)
   */
  constructor(source = null) {
    this._rng = new RandomNumberGenerator();
    /** @type {Map<string, Float32Array>} */
    this._tables = new Map();
    /** @type {Map<string, Layer>} */
    this._templates = new Map();
    if (source !== null) {
      this._noise_table = source._noise_table;
      this._tables = new Map(source._tables);
      this._templates = new Map(source._templates);
      return;
    }
    this._rng.seed = NOISE_SEED;
    this._noise_table = new Float32Array(NOISE_SIZE);
    for (let i = 0; i < NOISE_SIZE; i++) this._noise_table[i] = this._rng.randf_range(-1.0, 1.0);
  }

  /** Builds every cached template and table (their clicks draw from the stream left by the noise table). */
  prepare() {
    this._chime();
    this._glass();
    this._ping();
    this._warm();
    for (const table of ['pad', 'horn', 'soft', 'buzz']) this._table(table);
  }

  /** One effect as float samples at SFX_RATE. Deterministic: the stream is reseeded per sound. */
  render(sound) {
    const builder = AudioSynth.BUILDERS[sound];
    if (builder === undefined) throw new Error(`AudioSynth: unknown sound '${sound}'`);
    this._rng.seed = hashString(sound);
    return builder.call(this);
  }

  /** The music loop: [left, right] at MUSIC_RATE, MUSIC_LOOP_SECONDS long, seamless. */
  render_music() {
    const steps = this.musicSteps();
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
  }

  /**
   * render_music in steps: yields the name of each part as it is finished and returns the two
   * channels. The arithmetic and its order are those of render_music.
   */
  *musicSteps() {
    this._rng.seed = hashString('music');
    const loopN = round(MUSIC_LOOP_SECONDS * MUSIC_RATE);
    const left = new Layer(MUSIC_LOOP_SECONDS + MUSIC_TAIL_SECONDS, MUSIC_RATE);
    const right = new Layer(MUSIC_LOOP_SECONDS + MUSIC_TAIL_SECONDS, MUSIC_RATE);
    this._music_pad(left, right);
    yield 'pad';
    this._music_bells(left, right);
    foldTail(left, loopN);
    foldTail(right, loopN);
    yield 'bells';
    this._music_drone(left, right);
    yield 'drone';
    this._music_air(left, right);
    const top = Math.max(peak(left.data), peak(right.data));
    if (top > 0.0) {
      scale(left.data, MUSIC_PEAK / top);
      scale(right.data, MUSIC_PEAK / top);
    }
    return [left.data, right.data];
  }

  /**
   * Splits the sounds into `count` groups of similar cost (greedy: costliest first, to the lightest
   * group). O(sounds × (log sounds + groups)). Sounds of equal cost keep the order the engine's
   * sort leaves them in — an introsort, not a stable sort — so the groups are the original's.
   */
  static batches(count) {
    const groups = [];
    const loads = [];
    for (let i = 0; i < Math.max(1, count); i++) {
      groups.push([]);
      loads.push(0);
    }
    const order = sortCustom(SOUND_NAMES.slice(), (a, b) => (BUILD_COST[a] ?? 1) > (BUILD_COST[b] ?? 1));
    for (const sound of order) {
      let lightest = 0;
      for (let i = 0; i < groups.length; i++) if (loads[i] < loads[lightest]) lightest = i;
      groups[lightest].push(sound);
      loads[lightest] += BUILD_COST[sound] ?? 1;
    }
    return groups;
  }

  /**
   * What AudioStreamWAV.load_from_buffer stores for float data with compress/mode 0: 16-bit samples,
   * `CLAMP(sample · 32768, −32768, 32767)` truncated toward zero.
   */
  static toPcm16(samples) {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const v = Math.fround(samples[i] * 32768);
      out[i] = v < -32768 ? -32768 : v > 32767 ? 32767 : Math.trunc(v);
    }
    return out;
  }

  /** to_looping_wav: interleaved stereo frames followed by MUSIC_GUARD frames of the loop's start. */
  static loopingFrames(left, right) {
    const n = left.length;
    const frames = new Float32Array((n + MUSIC_GUARD) * 2);
    for (let i = 0; i < n; i++) {
      frames[2 * i] = left[i];
      frames[2 * i + 1] = right[i];
    }
    for (let k = 0; k < MUSIC_GUARD; k++) {
      frames[2 * (n + k)] = left[k];
      frames[2 * (n + k) + 1] = right[k];
    }
    return { frames, loopBegin: 0, loopEnd: n };
  }

  // ─────────────────────────────────────────────────────────────── interface sounds ────────────

  _ui_hover() {
    const s = new Layer(0.022, SFX_RATE);
    this._strike(s, 0.0, 3350.0, 1.0, [1.0, 1.0, 0.01, 1.561, 0.4, 0.005]);
    this._click(s, 0.0, 0.35, 2500.0, Filter.HIGH, 0.0012);
    return this._finish(s, 0.22);
  }

  _ui_click() {
    const s = new Layer(0.07, SFX_RATE);
    this._strike(s, 0.0, 1180.0, 1.0, [1.0, 1.0, 0.045, 1.64, 0.5, 0.028, 2.73, 0.28, 0.014, 4.18, 0.1, 0.007]);
    this._click(s, 0.0, 0.45, 3200.0, Filter.BAND, 0.002);
    return this._finish(s, 0.4);
  }

  _ui_back() {
    const s = new Layer(0.08, SFX_RATE);
    this._strike(s, 0.0, 760.0, 1.0, [1.0, 1.0, 0.05, 1.58, 0.42, 0.03, 2.61, 0.18, 0.014]);
    this._click(s, 0.0, 0.3, 1800.0, Filter.LOW, 0.002);
    return this._finish(s, 0.34);
  }

  _error() {
    const s = new Layer(0.22, SFX_RATE);
    this._thump(s, 0.0, 150.0, 95.0, 0.03, 0.8, 0.14);
    this._voice(s, this._table('buzz'), 0.0, 0.17, 98.0, 0.3, 0.005, 0.08);
    this._click(s, 0.0, 0.2, 900.0, Filter.LOW, 0.003);
    return this._finish(s, 0.21);
  }

  // ─────────────────────────────────────────────────────────────── board sounds ────────────────

  _select() {
    const s = new Layer(0.22, SFX_RATE);
    this._strike(s, 0.0, 640.0, 1.0, WOOD_KNOCK);
    this._thump(s, 0.0, 300.0, 210.0, 0.015, 0.35, 0.05);
    this._click(s, 0.0, 0.4, 2800.0, Filter.BAND, 0.0025);
    this._noise(s, 0.015, 0.19, 0.05, 0.06, 0.16, Filter.BAND, 1300.0, 1.1, 4200.0);
    return this._finish(s, 0.7);
  }

  _deselect() {
    const s = new Layer(0.2, SFX_RATE);
    this._noise(s, 0.0, 0.07, 0.1, 0.065, 0.2, Filter.BAND, 3600.0, 1.0, 1300.0);
    this._strike(s, 0.06, 540.0, 0.8, [1.0, 1.0, 0.06, 1.58, 0.38, 0.04, 2.45, 0.18, 0.022]);
    this._thump(s, 0.06, 240.0, 170.0, 0.015, 0.25, 0.05);
    this._click(s, 0.06, 0.18, 1800.0, Filter.LOW, 0.002);
    return this._finish(s, 0.57);
  }

  _move() {
    const s = new Layer(0.3, SFX_RATE);
    this._noise(s, 0.0, 0.12, 0.2, 0.035, 0.3, Filter.BAND, 1500.0, 0.9, 2300.0, 0.7);
    this._thock(s, 0.105, 1.0);
    return this._finish(s, 0.88);
  }

  _enemy_move() {
    const s = new Layer(0.34, SFX_RATE);
    this._noise(s, 0.0, 0.14, 0.24, 0.04, 0.3, Filter.BAND, 900.0, 0.8, 1400.0, 0.9);
    this._thump(s, 0.12, 150.0, 90.0, 0.025, 0.6, 0.12);
    this._strike(s, 0.12, 420.0, 0.9, STONE_KNOCK);
    this._strike(s, 0.12, 1260.0, 0.18, [1.0, 1.0, 0.09, 2.31, 0.4, 0.05]);
    this._click(s, 0.12, 0.5, 2400.0, Filter.BAND, 0.003);
    return this._finish(s, 0.88);
  }

  _land() {
    const s = new Layer(0.2, SFX_RATE);
    this._thock(s, 0.0, 1.0);
    return this._finish(s, 0.87);
  }

  _capture() {
    const s = new Layer(0.36, SFX_RATE);
    this._click(s, 0.0, 1.0, 2500.0, Filter.HIGH, 0.003);
    this._thump(s, 0.0, 170.0, 85.0, 0.03, 0.55, 0.18);
    this._strike(s, 0.0, 450.0, 0.85, [1.0, 1.0, 0.08, 1.62, 0.55, 0.05, 2.57, 0.35, 0.03, 7.44, 0.4, 0.012]);
    this._noise(s, 0.002, 0.1, 0.9, 0.001, 0.08, Filter.BAND, 2700.0, 1.3, 1700.0);
    const rng = this._rng;
    for (let i = 0; i < 12; i++) {
      const t = rng.randf_range(0.0, 0.045);
      const freq = rng.randf_range(1400.0, 4600.0);
      const amp = rng.randf_range(0.1, 0.3);
      const decay = rng.randf_range(0.004, 0.012);
      this._mode(s, t, freq, amp, decay);
    }
    this._saturate(s, 2.0);
    return this._finish(s, 0.95);
  }

  _shatter() {
    const s = new Layer(0.6, SFX_RATE);
    const mid = new Layer(0.6, MID_RATE);
    this._noise(s, 0.0, 0.14, 0.7, 0.0005, 0.08, Filter.BAND, 3200.0, 0.6);
    this._noise(mid, 0.0, 0.4, 0.2, 0.004, 0.28, Filter.BAND, 5000.0, 0.8);
    this._mix(s, mid, 0.0, 1.0, 1.0);
    this._thump(s, 0.0, 260.0, 150.0, 0.02, 0.35, 0.06);
    const rng = this._rng;
    for (let i = 0; i < 36; i++) {
      const t = Math.min(-log(1.0 - rng.randf() * 0.995) * 0.08, 0.5);
      const freq = 1500.0 * pow(4.0, rng.randf());
      const amp = 0.35 * rng.randf_range(0.25, 1.0) * exp(-t / 0.22);
      const decay = rng.randf_range(0.006, 0.03);
      const ring = rng.randf() < 0.4 ? 2.37 : 0.0;
      this._mode_pair(s, t, freq, amp, decay, freq * ring, amp * 0.5, decay * 0.6);
      const late = t + rng.randf_range(0.0, 0.03);
      const detuned = freq * rng.randf_range(0.6, 1.4);
      this._mode(s, late, detuned, amp * 0.7, decay);
    }
    return this._finish(s, 0.65);
  }

  _thock(s, t, amp) {
    this._thump(s, t, 190.0, 125.0, 0.02, amp * 0.5, 0.09);
    this._strike(s, t, 560.0, amp, STONE_KNOCK);
    this._click(s, t, amp * 0.6, 3000.0, Filter.BAND, 0.003);
  }

  // ─────────────────────────────────────────────────────────────── signals ─────────────────────

  _chain_step() {
    const s = new Layer(1.3, SFX_RATE);
    this._strike(s, 0.0, CHIME_BASE, 1.0, CHIME_MODES);
    this._click(s, 0.0, 0.1, 4500.0, Filter.BAND, 0.002);
    this._strike(s, 0.0, 2350.0, 0.35, [1.0, 1.0, 0.02, 1.49, 0.5, 0.012]);
    this._click(s, 0.0, 0.3, 4200.0, Filter.BAND, 0.0025);
    return this._finish(s, 0.54);
  }

  _check() {
    const s = new Layer(1.6, SFX_RATE);
    const low = new Layer(1.6, LOW_RATE);
    this._thump(low, 0.0, 110.0, 55.0, 0.05, 0.7, 0.6);
    this._strike(low, 0.0, A3, 0.6, DULL_BELL_MODES);
    this._strike(low, 0.0, BB3, 0.32, DULL_BELL_MODES);
    this._mix(s, low, 0.0, 1.0, 1.0);
    this._click(s, 0.0, 0.4, 1400.0, Filter.BAND, 0.004);
    this._hiss(s, 0.0, 0.5, 0.03, 0.05, 0.4);
    return this._finish(s, 0.8);
  }

  _relic_trigger() {
    const s = new Layer(0.8, SFX_RATE);
    const mid = new Layer(0.8, MID_RATE);
    const notes = [D6, E6, FS6, A6, B6, D7];
    for (let k = 0; k < notes.length; k++) this._mix(mid, this._glass(), 0.035 * k, notes[k] / GLASS_BASE, 0.5 + 0.06 * k);
    this._mix(s, mid, 0.0, 1.0, 1.0);
    this._hiss(s, 0.0, 0.45, 0.045, 0.12, 0.3);
    return this._finish(s, 0.43);
  }

  // ─────────────────────────────────────────────────────────────── economy ─────────────────────

  _coin() {
    const s = new Layer(0.55, SFX_RATE);
    this._mix(s, this._ping(), 0.0, 1.0, 0.8);
    this._mix(s, this._ping(), 0.07, 1.335, 1.0);
    return this._finish(s, 0.45);
  }

  _purchase() {
    const s = new Layer(0.95, SFX_RATE);
    this._anvil(s, 0.0, 1.0);
    this._mix(s, this._ping(), 0.16, 1.0, 0.35);
    this._mix(s, this._ping(), 0.23, 1.335, 0.42);
    return this._finish(s, 0.85);
  }

  _train() {
    const s = new Layer(0.85, SFX_RATE);
    this._click(s, 0.0, 0.8, 2200.0, Filter.HIGH, 0.003);
    this._strike(s, 0.0, 640.0, 0.5, [1.0, 1.0, 0.35, 1.51, 0.6, 0.28, 2.12, 0.45, 0.2, 2.83, 0.25, 0.12]);
    this._thump(s, 0.0, 180.0, 110.0, 0.02, 0.5, 0.1);
    const mid = new Layer(0.85, MID_RATE);
    this._noise(mid, 0.05, 0.78, 0.3, 0.03, 0.7, Filter.HIGH, 2500.0, 0.7, 4000.0, 0.9);
    this._mix(s, mid, 0.0, 1.0, 1.0);
    const rng = this._rng;
    for (let i = 0; i < 26; i++) {
      const first = rng.randf();
      const second = rng.randf();
      const t = 0.06 + first * second * 0.6;
      const amp = rng.randf_range(0.1, 0.35) * exp(-t / 0.4);
      const cutoff = rng.randf_range(3000.0, 7000.0);
      this._click(s, t, amp, cutoff, Filter.BAND, 0.001);
    }
    return this._finish(s, 0.95);
  }

  _anvil(s, t, amp) {
    this._click(s, t, amp * 0.9, 3000.0, Filter.HIGH, 0.003);
    this._strike(s, t, 920.0, amp * 0.5, ANVIL_MODES);
    this._thump(s, t, 220.0, 150.0, 0.02, amp * 0.3, 0.08);
  }

  // ─────────────────────────────────────────────────────────────── fanfares ────────────────────

  _encounter_start() {
    const s = new Layer(2.2, SFX_RATE);
    const mid = new Layer(2.2, MID_RATE);
    const low = new Layer(2.2, LOW_RATE);
    this._thump(low, 0.0, 92.0, 52.0, 0.06, 1.0, 0.9);
    this._strike(low, 0.0, A2, 0.7, GONG_STRIKE);
    this._bloom(low, 0.0, A2, 0.7, GONG_BLOOM, 0.32);
    this._mix(mid, low, 0.0, 1.0, 1.0);
    this._bloom(mid, 0.0, A2, 0.05, GONG_SHIMMER, 0.35);
    this._noise(mid, 0.0, 1.3, 0.05, 0.45, 1.0, Filter.BAND, 2600.0, 0.8);
    this._mix(s, mid, 0.0, 1.0, 1.0);
    this._click(s, 0.0, 0.25, 900.0, Filter.LOW, 0.006);
    return this._finish(s, 0.73);
  }

  _encounter_won() {
    const s = new Layer(1.8, SFX_RATE);
    const mid = new Layer(1.8, MID_RATE);
    const low = new Layer(1.8, LOW_RATE);
    this._pad_chord(low, 0.0, 1.8, [D3, A3, D4, FS4], 0.13, 0.3, 1.1);
    this._thump(low, 0.0, 120.0, 73.4, 0.04, 0.35, 0.45);
    this._mix(mid, low, 0.0, 1.0, 1.0);
    const arpeggio = [D5, FS5, A5, D6];
    for (let k = 0; k < arpeggio.length; k++) this._mix(mid, this._chime(), 0.11 * k, arpeggio[k] / CHIME_BASE, 0.55 + 0.1 * k);
    this._mix(s, mid, 0.0, 1.0, 1.0);
    return this._finish(s, 0.54);
  }

  _lost() {
    const s = new Layer(1.8, SFX_RATE);
    const low = new Layer(1.8, LOW_RATE);
    this._melody(low, this._table('horn'), 0.0, 1.78, [0.0, A3, 0.45, F3, 0.9, D3], 0.35, 0.12, 0.7);
    this._voice(low, this._table('pad'), 0.0, 1.78, D2, 0.18, 0.3, 1.1);
    this._strike(low, 0.0, D4, 0.5, DULL_BELL_MODES);
    this._mix(s, low, 0.0, 1.0, 1.0);
    this._click(s, 0.0, 0.15, 1200.0, Filter.LOW, 0.004);
    return this._finish(s, 0.54);
  }

  _victory() {
    const s = new Layer(3.0, SFX_RATE);
    const mid = new Layer(3.0, MID_RATE);
    const low = new Layer(3.0, LOW_RATE);
    this._thump(low, 0.0, 100.0, 50.0, 0.06, 0.8, 0.9);
    this._pad_chord(low, 0.0, 1.35, [D3, G3, B3], 0.14, 0.35, 0.35);
    this._pad_chord(low, 1.1, 1.9, [D3, A3, D4, FS4], 0.14, 0.3, 1.2);
    this._mix(mid, low, 0.0, 1.0, 1.0);
    const rise = [G4, B4, D5];
    for (let k = 0; k < rise.length; k++) this._mix(mid, this._chime(), 0.12 * k, rise[k] / CHIME_BASE, 0.38 + 0.05 * k);
    const crown = [D5, FS5, A5, D6];
    for (let k = 0; k < crown.length; k++) this._mix(mid, this._chime(), 1.15 + 0.085 * k, crown[k] / CHIME_BASE, 0.45 + 0.06 * k);
    this._mix(s, mid, 0.0, 1.0, 1.0);
    this._mix(s, this._chime(), 1.15 + 0.085 * 4, FS6 / CHIME_BASE, 0.69);
    this._mix(s, this._glass(), 1.55, A6 / GLASS_BASE, 0.25);
    this._mix(s, this._glass(), 1.62, D7 / GLASS_BASE, 0.2);
    this._hiss(s, 1.15, 0.9, 0.03, 0.3, 0.8);
    return this._finish(s, 0.71);
  }

  _level_up() {
    const s = new Layer(1.4, SFX_RATE);
    const mid = new Layer(1.4, MID_RATE);
    this._noise(mid, 0.0, 0.5, 0.22, 0.4, 0.25, Filter.BAND, 600.0, 1.8, 6000.0);
    this._voice(mid, this._table('soft'), 0.0, 0.5, A4, 0.14, 0.35, 0.1, A5);
    this._mix(s, mid, 0.0, 1.0, 1.0);
    const chord = [A5, D6, E6, A6];
    for (let k = 0; k < chord.length; k++) this._mix(s, this._glass(), 0.42 + 0.05 * k, chord[k] / GLASS_BASE, 0.5 - 0.05 * k);
    this._mix(s, this._chime(), 0.45, D6 / CHIME_BASE, 0.4);
    return this._finish(s, 0.62);
  }

  _map_step() {
    const s = new Layer(0.45, SFX_RATE);
    const mid = new Layer(0.45, MID_RATE);
    this._noise(mid, 0.0, 0.28, 0.35, 0.05, 0.22, Filter.BAND, 1800.0, 0.7, 3200.0, 0.8);
    this._mix(s, mid, 0.0, 1.0, 1.0);
    this._strike(s, 0.2, 700.0, 0.7, WOOD_KNOCK);
    this._click(s, 0.2, 0.4, 2600.0, Filter.BAND, 0.002);
    return this._finish(s, 0.6);
  }

  _promote() {
    const s = new Layer(1.25, SFX_RATE);
    const mid = new Layer(1.25, MID_RATE);
    this._noise(mid, 0.0, 0.4, 0.3, 0.34, 0.2, Filter.BAND, 350.0, 2.0, 5200.0);
    this._voice(mid, this._table('soft'), 0.0, 0.4, D4, 0.18, 0.3, 0.06, D6);
    this._mix(s, mid, 0.0, 1.0, 1.0);
    const chord = [D6, FS6, A6];
    for (let k = 0; k < chord.length; k++) this._mix(s, this._chime(), 0.36 + 0.012 * k, chord[k] / CHIME_BASE, 0.55);
    this._mix(s, this._glass(), 0.4, D7 / GLASS_BASE, 0.25);
    return this._finish(s, 0.7);
  }

  // ─────────────────────────────────────────────────────────────── cached instruments ──────────

  /** A template is synthesised once and then mixed at any pitch. */
  _template(name, seconds, rate, build, fade) {
    let layer = this._templates.get(name);
    if (layer === undefined) {
      layer = new Layer(seconds, rate);
      build(layer);
      fadeEnd(layer, fade);
      this._templates.set(name, layer);
    }
    return layer;
  }

  _chime() {
    return this._template('chime', 1.6, MID_RATE, (t) => {
      this._strike(t, 0.0, CHIME_BASE, 1.0, CHIME_MODES);
      this._click(t, 0.0, 0.1, 4500.0, Filter.BAND, 0.002);
    }, 0.05);
  }

  _glass() {
    return this._template('glass', 0.8, MID_RATE, (t) => {
      this._strike(t, 0.0, GLASS_BASE, 1.0, GLASS_MODES);
      this._click(t, 0.0, 0.05, 6000.0, Filter.HIGH, 0.0015);
    }, 0.05);
  }

  _ping() {
    return this._template('ping', 0.5, SFX_RATE, (t) => {
      this._strike(t, 0.0, PING_BASE, 1.0, PING_MODES);
      this._click(t, 0.0, 0.25, 4000.0, Filter.HIGH, 0.0015);
    }, 0.05);
  }

  _warm() {
    return this._template('warm', 1.8, LOW_RATE, (t) => {
      this._strike(t, 0.0, WARM_BASE, 1.0, WARM_MODES);
    }, 0.1);
  }

  /** One period of a harmonic series, peak-normalised. O(TABLE_SIZE × harmonics), cached. */
  _table(name) {
    let table = this._tables.get(name);
    if (table === undefined) {
      const harmonics = TABLE_HARMONICS[name] ?? [];
      table = new Float32Array(TABLE_SIZE);
      for (let i = 0; i < TABLE_SIZE; i++) {
        const x = (TAU * i) / TABLE_SIZE;
        let v = 0.0;
        for (let h = 0; h < harmonics.length; h++) v += harmonics[h] * sin(x * (h + 1));
        table[i] = v;
      }
      scale(table, 1.0 / Math.max(peak(table), 1e-6));
      this._tables.set(name, table);
    }
    return table;
  }

  // ─────────────────────────────────────────────────────────────── music ───────────────────────

  /** Two-note drone whose brightness breathes twice per loop; one tile of 600 samples, no seam. */
  _music_drone(left, right) {
    const period = DRONE_PERIOD;
    const dark = new Float32Array(DRONE_HARMONICS);
    const bright = new Float32Array(DRONE_HARMONICS);
    dark[1] = 0.12;
    bright[1] = 0.1;
    for (let k = 1; k < 17; k++) {
      if (k <= 6) dark[2 * k] += 1.0 / pow(k, 1.8);
      bright[2 * k] += (1.0 - k / 18.0) / pow(k, 1.25);
    }
    for (let k = 1; k < 13; k++) {
      if (k <= 5) dark[3 * k] += 0.6 / pow(k, 1.8);
      bright[3 * k] += (0.6 * (1.0 - k / 14.0)) / pow(k, 1.3);
    }
    const tileDark = new Float32Array(period + 1);
    const tileDiff = new Float32Array(period + 1);
    const phases = new Float32Array(DRONE_HARMONICS);
    for (let h = 0; h < DRONE_HARMONICS; h++) phases[h] = this._rng.randf() * TAU;
    for (let i = 0; i < period; i++) {
      const x = (TAU * i) / period;
      let d = 0.0;
      let b = 0.0;
      for (let h = 1; h < DRONE_HARMONICS; h++) {
        const v = sin(x * h + phases[h]);
        d += dark[h] * v;
        b += bright[h] * v;
      }
      tileDark[i] = d;
      tileDiff[i] = b - d;
    }
    tileDark[period] = tileDark[0];
    tileDiff[period] = tileDiff[0];

    const lbuf = left.data;
    const rbuf = right.data;
    const loopN = round(MUSIC_LOOP_SECONDS * left.rate);
    // The side voices run one tile more and one tile less per loop: a slow, seamless beating.
    const tiles = Math.floor(loopN / period);
    const stepL = (tiles + 1) / tiles;
    const stepR = (tiles - 1) / tiles;
    const p = period;
    let posL = 0.0;
    let posR = p * 0.5;
    let j = 0;
    let brightness = 0.0;
    let gain = 0.0;
    for (let i = 0; i < loopN; i++) {
      if ((i & CONTROL_MASK) === 0) {
        const t = i / loopN;
        brightness = 0.12 + 0.55 * (0.5 - 0.5 * cos(TAU * 2.0 * t));
        gain = DRONE_LEVEL * (1.0 + 0.12 * sin(TAU * 3.0 * t));
      }
      const centre = (tileDark[j] + brightness * tileDiff[j]) * gain;
      const il = Math.trunc(posL);
      const a = tileDark[il];
      const vl = a + (tileDark[il + 1] - a) * (posL - il);
      const ir = Math.trunc(posR);
      const c = tileDark[ir];
      const vr = c + (tileDark[ir + 1] - c) * (posR - ir);
      lbuf[i] += centre + vl * gain * 0.5;
      rbuf[i] += centre + vr * gain * 0.5;
      j += 1;
      if (j === period) j = 0;
      posL += stepL;
      if (posL >= p) posL -= p;
      posR += stepR;
      if (posR >= p) posR -= p;
    }
  }

  /** Four slow chords, each entering 1.5 s before its bar and overlapping the next. */
  _music_pad(left, right) {
    const table = this._table('pad');
    const chordCount = Math.floor(MUSIC_CHORDS.length / MUSIC_CHORD_SIZE);
    const span = MUSIC_LOOP_SECONDS / chordCount;
    for (let k = 0; k < chordCount; k++) {
      const notes = MUSIC_CHORDS.slice(k * MUSIC_CHORD_SIZE, (k + 1) * MUSIC_CHORD_SIZE);
      const start = fposmod(span * k - 1.5, MUSIC_LOOP_SECONDS);
      this._pad_tile_chord(left, right, table, notes, start, span + 3.0, 3.0, 3.5);
    }
  }

  /**
   * A chord as a 2-second stereo tile repeated under an envelope. Frequencies snap to half hertz, so
   * every voice closes its cycle inside the tile; each note sounds twice, half a hertz apart.
   */
  _pad_tile_chord(left, right, table, notes, start, length, attack, release) {
    const rate = left.rate;
    const tileN = round(PAD_TILE_SECONDS * rate);
    const tileL = new Float32Array(tileN);
    const tileR = new Float32Array(tileN);
    for (const f of notes) {
      const base = round(f * 2.0) * 0.5;
      this._tile_voice(tileL, tileR, table, rate, base, 0.85, 0.45);
      this._tile_voice(tileL, tileR, table, rate, base + 0.5, 0.45, 0.85);
    }
    const lbuf = left.data;
    const rbuf = right.data;
    const from = round(start * rate);
    const count = Math.min(round(length * rate), lbuf.length - from);
    const attackN = round(attack * rate);
    const releaseN = round(release * rate);
    const releaseFrom = count - releaseN;
    let j = 0;
    for (let n = 0; n < count; n++) {
      let e = PAD_LEVEL;
      if (n < attackN) e *= n / attackN;
      else if (n > releaseFrom) e *= (count - n) / releaseN;
      lbuf[from + n] += tileL[j] * e;
      rbuf[from + n] += tileR[j] * e;
      j += 1;
      if (j === tileN) j = 0;
    }
  }

  _tile_voice(tileL, tileR, table, rate, freq, gainL, gainR) {
    const inc = (freq * TABLE_SIZE) / rate;
    const offset = this._rng.randi() & TABLE_MASK;
    for (let i = 0; i < tileL.length; i++) {
      const v = table[(Math.trunc(i * inc) + offset) & TABLE_MASK];
      tileL[i] += v * gainL;
      tileR[i] += v * gainR;
    }
  }

  /** Sparse bells, each answered by a quieter echo on the opposite side. One layer per pitch. */
  _music_bells(left, right) {
    const cache = new Map();
    for (let e = 0; e < MUSIC_BELLS.length; e += 4) {
      const time = MUSIC_BELLS[e];
      const freq = MUSIC_BELLS[e + 1];
      const level = MUSIC_BELLS[e + 2] * BELL_LEVEL;
      const pan = MUSIC_BELLS[e + 3];
      let bell = cache.get(freq);
      if (bell === undefined) {
        bell = new Layer(3.6, MUSIC_RATE);
        this._strike(bell, 0.0, freq, 1.0, MUSIC_BELL_MODES);
        this._click(bell, 0.0, 0.05, 2500.0, Filter.LOW, 0.003);
        fadeEnd(bell, 0.3);
        cache.set(freq, bell);
      }
      this._mix_pan(left, right, bell, time, level, pan);
      this._mix_pan(left, right, bell, time + BELL_ECHO_DELAY, level * BELL_ECHO_LEVEL, -pan);
    }
  }

  /** Band of circular noise (150–900 Hz) swelling once per loop; the right channel reads half a period later. */
  _music_air(left, right) {
    const rate = left.rate;
    const period = round(AIR_PERIOD_SECONDS * rate);
    const air = new Float32Array(period);
    for (let i = 0; i < period; i++) air[i] = this._rng.randf_range(-1.0, 1.0);
    const rumble = air.slice();
    lowpassCircular(rumble, 150.0, rate);
    lowpassCircular(air, 900.0, rate);
    for (let i = 0; i < period; i++) air[i] -= rumble[i];
    const lbuf = left.data;
    const rbuf = right.data;
    const loopN = round(MUSIC_LOOP_SECONDS * rate);
    let jl = 0;
    let jr = period >> 1;
    let gain = 0.0;
    for (let i = 0; i < loopN; i++) {
      if ((i & CONTROL_MASK) === 0) gain = AIR_LEVEL * (0.55 + 0.45 * sin((TAU * i) / loopN + 1.0));
      lbuf[i] += air[jl] * gain;
      rbuf[i] += air[jr] * gain;
      jl += 1;
      if (jl === period) jl = 0;
      jr += 1;
      if (jr === period) jr = 0;
    }
  }

  // ─────────────────────────────────────────────────────────────── generators ──────────────────

  /**
   * One decaying sinusoid as a two-pole resonator (two multiplications per sample): y[n] =
   * 2r·cos(w)·y[n−1] − r²·y[n−2], primed so the first output is amp·sin(0).
   */
  _mode(layer, start, freq, amp, decay) {
    const rate = layer.rate;
    if (freq <= 0.0 || freq >= rate * 0.45) return;
    const buf = layer.data;
    const from = Math.max(0, round(start * rate));
    const to = Math.min(from + ringSamples(amp, decay, rate), buf.length);
    const w = (TAU * freq) / rate;
    const r = exp(-LN_1000 / (decay * rate));
    const c1 = 2.0 * r * cos(w);
    const c2 = r * r;
    let y1 = (-amp * sin(w)) / r;
    let y2 = (-amp * sin(2.0 * w)) / c2;
    for (let i = from; i < to; i++) {
      const y = c1 * y1 - c2 * y2;
      buf[i] += y;
      y2 = y1;
      y1 = y;
    }
  }

  /** Two modes in one pass over the buffer (their sum is stored once per sample, as in the original). */
  _mode_pair(layer, start, f1, a1, d1, f2, a2, d2) {
    const rate = layer.rate;
    const limit = rate * 0.45;
    const ok1 = f1 > 0.0 && f1 < limit && a1 !== 0.0 && d1 > 0.0;
    const ok2 = f2 > 0.0 && f2 < limit && a2 !== 0.0 && d2 > 0.0;
    if (!(ok1 && ok2)) {
      if (ok1) this._mode(layer, start, f1, a1, d1);
      else if (ok2) this._mode(layer, start, f2, a2, d2);
      return;
    }
    const buf = layer.data;
    const from = Math.max(0, round(start * rate));
    const end1 = Math.min(from + ringSamples(a1, d1, rate), buf.length);
    const end2 = Math.min(from + ringSamples(a2, d2, rate), buf.length);
    const w1 = (TAU * f1) / rate;
    const r1 = exp(-LN_1000 / (d1 * rate));
    const c11 = 2.0 * r1 * cos(w1);
    const c12 = r1 * r1;
    let p1 = (-a1 * sin(w1)) / r1;
    let q1 = (-a1 * sin(2.0 * w1)) / c12;
    const w2 = (TAU * f2) / rate;
    const r2 = exp(-LN_1000 / (d2 * rate));
    const c21 = 2.0 * r2 * cos(w2);
    const c22 = r2 * r2;
    let p2 = (-a2 * sin(w2)) / r2;
    let q2 = (-a2 * sin(2.0 * w2)) / c22;
    const shared = Math.min(end1, end2);
    for (let i = from; i < shared; i++) {
      const y = c11 * p1 - c12 * q1;
      const z = c21 * p2 - c22 * q2;
      buf[i] += y + z;
      q1 = p1;
      p1 = y;
      q2 = p2;
      p2 = z;
    }
    for (let i = shared; i < end1; i++) {
      const y = c11 * p1 - c12 * q1;
      buf[i] += y;
      q1 = p1;
      p1 = y;
    }
    for (let i = shared; i < end2; i++) {
      const z = c21 * p2 - c22 * q2;
      buf[i] += z;
      q2 = p2;
      p2 = z;
    }
  }

  /** A struck object: all modes of a table, scaled to a base frequency and amplitude. */
  _strike(layer, start, base, amp, modes) {
    let m = 0;
    while (m + 5 < modes.length) {
      this._mode_pair(layer, start, base * modes[m], amp * modes[m + 1], modes[m + 2], base * modes[m + 3], amp * modes[m + 4], modes[m + 5]);
      m += 6;
    }
    if (m + 2 < modes.length) this._mode(layer, start, base * modes[m], amp * modes[m + 1], modes[m + 2]);
  }

  /** A strike that swells in instead of starting at full level (the body of a gong). */
  _bloom(layer, start, base, amp, modes, attack) {
    const rate = layer.rate;
    const from = Math.max(0, round(start * rate));
    const remaining = layer.data.length - from;
    if (remaining <= 0) return;
    const temp = new Layer(remaining / rate, rate);
    this._strike(temp, 0.0, base, amp, modes);
    const out = layer.data;
    const src = temp.data;
    let env = 0.0;
    const envK = 1.0 - exp(-3.0 / (Math.max(attack, 0.0005) * rate));
    const count = Math.min(src.length, remaining);
    for (let n = 0; n < count; n++) {
      env += (1.0 - env) * envK;
      out[from + n] += src[n] * env;
    }
  }

  /** A sine gliding down from f_start to f_end — the weight of an impact. Rotation oscillator. */
  _thump(layer, start, fStart, fEnd, glide, amp, decay) {
    const rate = layer.rate;
    const buf = layer.data;
    const from = Math.max(0, round(start * rate));
    const count = Math.min(ringSamples(amp, decay, rate), buf.length - from);
    let sweep = fStart - fEnd;
    const sweepMul = exp(-16.0 / (glide * rate));
    let env = amp;
    const envMul = exp(-LN_1000 / (decay * rate));
    const attackN = Math.max(1, round(0.0015 * rate));
    let x = 0.0;
    let y = 1.0;
    let c = 1.0;
    let s = 0.0;
    for (let n = 0; n < count; n++) {
      if ((n & BLOCK_MASK) === 0) {
        const w = (TAU * (fEnd + sweep)) / rate;
        c = cos(w);
        s = sin(w);
        sweep *= sweepMul;
      }
      let e = env;
      if (n < attackN) e *= n / attackN;
      buf[from + n] += x * e;
      const nx = x * c + y * s;
      y = y * c - x * s;
      x = nx;
      env *= envMul;
    }
  }

  /**
   * Noise from the shared table through a state-variable filter (trapezoidal integrators) whose
   * cutoff may glide; linear attack, exponential decay, 3 ms release; optional "grit" flutter.
   */
  _noise(layer, start, length, amp, attack, decay, filter, cutoff, q = 0.707, cutoffEnd = 0.0, grit = 0.0) {
    const rate = layer.rate;
    const buf = layer.data;
    const noise = this._noise_table;
    const from = Math.max(0, round(start * rate));
    const count = Math.min(round(length * rate), buf.length - from);
    if (count <= 0) return;
    const target = cutoffEnd <= 0.0 ? cutoff : cutoffEnd;
    const blockGlide = pow(target / cutoff, 16.0 / count);
    const nyquistGuard = rate * 0.45;
    const k = 1.0 / q;
    let m0 = 0.0;
    let m1 = 0.0;
    let m2 = 0.0;
    if (filter === Filter.LOW) m2 = 1.0;
    else if (filter === Filter.BAND) m1 = k;
    else {
      m0 = 1.0;
      m1 = -k;
      m2 = -1.0;
    }
    const attackN = Math.max(1, round(attack * rate));
    const fadeFrom = count - Math.min(count, round(0.003 * rate));
    const attackStep = amp / attackN;
    const envMul = exp(-LN_1000 / (Math.max(decay, 0.0005) * rate));
    const fadeMul = exp(-LN_1000 / Math.max(1.0, count - fadeFrom));
    let env = 0.0;
    let fc = cutoff;
    let a1 = 0.0;
    let a2 = 0.0;
    let a3 = 0.0;
    let ic1 = 0.0;
    let ic2 = 0.0;
    const offset = this._rng.randi() & NOISE_MASK;
    const gritOffset = this._rng.randi() & NOISE_MASK;
    let level = 1.0;
    let levelStep = 0.0;
    for (let n = 0; n < count; n++) {
      if ((n & BLOCK_MASK) === 0) {
        const g = tan((PI * Math.min(fc, nyquistGuard)) / rate);
        a1 = 1.0 / (1.0 + g * (g + k));
        a2 = g * a1;
        a3 = g * a2;
        fc *= blockGlide;
        if (grit > 0.0) {
          const next = 1.0 - grit * Math.abs(noise[(gritOffset + (n >> 4)) & NOISE_MASK]);
          levelStep = (next - level) / 16.0;
        }
      }
      if (n < attackN) env += attackStep;
      else if (n < fadeFrom) env *= envMul;
      else env *= fadeMul;
      const v0 = noise[(offset + n) & NOISE_MASK];
      const v3 = v0 - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2.0 * v1 - ic1;
      ic2 = 2.0 * v2 - ic2;
      level += levelStep;
      buf[from + n] += (m0 * v0 + m1 * v1 + m2 * v2) * env * level;
    }
  }

  /** Bright air: differenced noise (a first-order high-pass), same envelope as _noise. */
  _hiss(layer, start, length, amp, attack, decay, grit = 0.0) {
    const rate = layer.rate;
    const buf = layer.data;
    const noise = this._noise_table;
    const from = Math.max(0, round(start * rate));
    const count = Math.min(round(length * rate), buf.length - from);
    if (count <= 0) return;
    const attackN = Math.max(1, round(attack * rate));
    const fadeFrom = count - Math.min(count, round(0.003 * rate));
    const attackStep = amp / attackN;
    const envMul = exp(-LN_1000 / (Math.max(decay, 0.0005) * rate));
    const fadeMul = exp(-LN_1000 / Math.max(1.0, count - fadeFrom));
    let env = 0.0;
    const offset = this._rng.randi() & NOISE_MASK;
    const gritOffset = this._rng.randi() & NOISE_MASK;
    let previous = noise[offset];
    let level = 1.0;
    let levelStep = 0.0;
    for (let n = 0; n < count; n++) {
      if (grit > 0.0 && (n & BLOCK_MASK) === 0) {
        const next = 1.0 - grit * Math.abs(noise[(gritOffset + (n >> 4)) & NOISE_MASK]);
        levelStep = (next * next - level) / 16.0;
      }
      if (n < attackN) env += attackStep;
      else if (n < fadeFrom) env *= envMul;
      else env *= fadeMul;
      const v = noise[(offset + n + 1) & NOISE_MASK];
      level += levelStep;
      buf[from + n] += (v - previous) * env * level;
      previous = v;
    }
  }

  /** The contact transient of a strike: a few milliseconds of filtered noise. */
  _click(layer, start, amp, cutoff, filter = Filter.HIGH, length = 0.002) {
    this._noise(layer, start, length, amp, 0.0002, length, filter, cutoff, 0.8);
  }

  /** A wavetable voice with linear attack and release; `freqEnd` > 0 glides the pitch exponentially. */
  _voice(layer, table, start, length, freq, amp, attack, release, freqEnd = 0.0) {
    const rate = layer.rate;
    const buf = layer.data;
    const from = Math.max(0, round(start * rate));
    const count = Math.min(round(length * rate), buf.length - from);
    if (count <= 0) return;
    let inc = (freq * TABLE_SIZE) / rate;
    const incMul = freqEnd <= 0.0 ? 1.0 : pow(freqEnd / freq, 1.0 / count);
    const attackN = Math.max(1, round(attack * rate));
    const releaseN = Math.max(1, round(release * rate));
    const releaseFrom = count - releaseN;
    let phase = this._rng.randf() * TABLE_SIZE;
    for (let n = 0; n < count; n++) {
      let e = amp;
      if (n < attackN) e *= n / attackN;
      else if (n > releaseFrom) e *= (count - n) / releaseN;
      buf[from + n] += table[Math.trunc(phase) & TABLE_MASK] * e;
      phase += inc;
      inc *= incMul;
    }
  }

  /** Two voices detuned by `spread` around a frequency — one chorused note. */
  _voice_pair(layer, table, start, length, freq, spread, amp, attack, release) {
    const rate = layer.rate;
    const buf = layer.data;
    const from = Math.max(0, round(start * rate));
    const count = Math.min(round(length * rate), buf.length - from);
    if (count <= 0) return;
    const inc1 = ((freq / spread) * TABLE_SIZE) / rate;
    const inc2 = (freq * spread * TABLE_SIZE) / rate;
    const attackN = Math.max(1, round(attack * rate));
    const releaseN = Math.max(1, round(release * rate));
    const releaseFrom = count - releaseN;
    let phase1 = this._rng.randf() * TABLE_SIZE;
    let phase2 = this._rng.randf() * TABLE_SIZE;
    for (let n = 0; n < count; n++) {
      let e = amp;
      if (n < attackN) e *= n / attackN;
      else if (n > releaseFrom) e *= (count - n) / releaseN;
      buf[from + n] += (table[Math.trunc(phase1) & TABLE_MASK] + table[Math.trunc(phase2) & TABLE_MASK]) * e;
      phase1 += inc1;
      phase2 += inc2;
    }
  }

  /** A legato line: `notes` is (time, frequency) pairs; the pitch glides to each new note in 50 ms. */
  _melody(layer, table, start, length, notes, amp, attack, release) {
    const rate = layer.rate;
    const buf = layer.data;
    const from = Math.max(0, round(start * rate));
    const count = Math.min(round(length * rate), buf.length - from);
    const attackN = Math.max(1, round(attack * rate));
    const releaseN = Math.max(1, round(release * rate));
    const releaseFrom = count - releaseN;
    const glideK = 1.0 - exp(-1.0 / (0.05 * rate));
    const tableScale = TABLE_SIZE / rate;
    let freq = notes[1];
    let target = freq;
    let next = 2;
    let nextN = next < notes.length ? round(notes[next] * rate) : count;
    let phase = 0.0;
    for (let n = 0; n < count; n++) {
      if (n >= nextN) {
        target = notes[next + 1];
        next += 2;
        nextN = next < notes.length ? round(notes[next] * rate) : count;
      }
      freq += (target - freq) * glideK;
      let e = amp;
      if (n < attackN) e *= n / attackN;
      else if (n > releaseFrom) e *= (count - n) / releaseN;
      buf[from + n] += table[Math.trunc(phase) & TABLE_MASK] * e;
      phase += freq * tableScale;
    }
  }

  _pad_chord(layer, start, length, notes, amp, attack, release) {
    const table = this._table('pad');
    for (const f of notes) this._voice_pair(layer, table, start, length, f, 1.003, amp, attack, release);
  }

  // ─────────────────────────────────────────────────────────────── mixing ──────────────────────

  /**
   * Adds `src` into `dst` from `start`, resampled by `ratio` (pitch) and by the two layers' rates:
   * exact upsampling when only the rates differ, plain decimation for whole steps, linear
   * interpolation otherwise.
   */
  _mix(dst, src, start, ratio, gain) {
    if (ratio === 1.0 && dst.rate % src.rate === 0) {
      this._mix_up(dst, src, start, round(dst.rate / src.rate), gain);
      return;
    }
    const out = dst.data;
    const inp = src.data;
    const step = (ratio * src.rate) / dst.rate;
    const from = Math.max(0, round(start * dst.rate));
    const count = Math.min(Math.trunc((inp.length - 1) / step), out.length - from);
    if (step === Math.floor(step)) {
      const stride = Math.trunc(step);
      let j = 0;
      for (let n = from; n < from + count; n++) {
        out[n] += inp[j] * gain;
        j += stride;
      }
      return;
    }
    let pos = 0.0;
    for (let n = from; n < from + count; n++) {
      const i = Math.trunc(pos);
      const a = inp[i];
      out[n] += (a + (inp[i + 1] - a) * (pos - i)) * gain;
      pos += step;
    }
  }

  /** Upsampling by 1, 2 or 4 with linear interpolation between source samples. */
  _mix_up(dst, src, start, factor, gain) {
    const out = dst.data;
    const inp = src.data;
    const from = Math.max(0, round(start * dst.rate));
    let k = from;
    if (factor === 1) {
      const count = Math.min(inp.length, out.length - from);
      for (let j = 0; j < count; j++) {
        out[k] += inp[j] * gain;
        k += 1;
      }
    } else if (factor === 2) {
      let a = inp[0] * gain;
      const count = Math.min(inp.length - 1, Math.floor((out.length - from) / 2.0));
      for (let j = 0; j < count; j++) {
        const b = inp[j + 1] * gain;
        out[k] += a;
        out[k + 1] += (a + b) * 0.5;
        a = b;
        k += 2;
      }
    } else if (factor === 4) {
      let a = inp[0] * gain;
      const count = Math.min(inp.length - 1, Math.floor((out.length - from) / 4.0));
      for (let j = 0; j < count; j++) {
        const b = inp[j + 1] * gain;
        const d = (b - a) * 0.25;
        out[k] += a;
        out[k + 1] += a + d;
        out[k + 2] += a + d + d;
        out[k + 3] += b - d;
        a = b;
        k += 4;
      }
    } else {
      throw new Error(`AudioSynth: unsupported upsampling factor ${factor}`);
    }
  }

  /** Constant-power pan: −1 left, +1 right. */
  _mix_pan(left, right, src, start, gain, pan) {
    const angle = (Math.min(Math.max(pan, -1.0), 1.0) + 1.0) * PI * 0.25;
    const gainL = gain * cos(angle);
    const gainR = gain * sin(angle);
    const lbuf = left.data;
    const rbuf = right.data;
    const sbuf = src.data;
    const from = Math.max(0, round(start * left.rate));
    const count = Math.min(sbuf.length, lbuf.length - from);
    for (let n = 0; n < count; n++) {
      const v = sbuf[n];
      lbuf[from + n] += v * gainL;
      rbuf[from + n] += v * gainR;
    }
  }

  /** tanh soft clipping, driven relative to the layer's peak and scaled back to ±1. */
  _saturate(layer, drive) {
    const buf = layer.data;
    const top = peak(buf);
    if (top <= 0.0) return;
    const pre = drive / top;
    const post = 1.0 / tanh(drive);
    for (let i = 0; i < buf.length; i++) buf[i] = tanh(buf[i] * pre) * post;
  }

  /** 4 ms fade at the end, then normalisation to `peak`. */
  _finish(layer, level) {
    fadeEnd(layer, 0.004);
    const buf = layer.data;
    const top = peak(buf);
    if (top > 0.0) scale(buf, level / top);
    return buf;
  }
}

/** Sound name → builder method. */
AudioSynth.BUILDERS = Object.freeze({
  ui_hover: AudioSynth.prototype._ui_hover,
  ui_click: AudioSynth.prototype._ui_click,
  ui_back: AudioSynth.prototype._ui_back,
  select: AudioSynth.prototype._select,
  deselect: AudioSynth.prototype._deselect,
  move: AudioSynth.prototype._move,
  enemy_move: AudioSynth.prototype._enemy_move,
  land: AudioSynth.prototype._land,
  capture: AudioSynth.prototype._capture,
  shatter: AudioSynth.prototype._shatter,
  chain_step: AudioSynth.prototype._chain_step,
  check: AudioSynth.prototype._check,
  coin: AudioSynth.prototype._coin,
  relic_trigger: AudioSynth.prototype._relic_trigger,
  encounter_start: AudioSynth.prototype._encounter_start,
  encounter_won: AudioSynth.prototype._encounter_won,
  lost: AudioSynth.prototype._lost,
  victory: AudioSynth.prototype._victory,
  purchase: AudioSynth.prototype._purchase,
  train: AudioSynth.prototype._train,
  level_up: AudioSynth.prototype._level_up,
  promote: AudioSynth.prototype._promote,
  map_step: AudioSynth.prototype._map_step,
  error: AudioSynth.prototype._error,
});

/** The name the music stream goes by. */
export const MUSIC_NAME = 'music';

/**
 * The order the effects are built in: cheapest first, so that the sounds of the interface exist a few
 * milliseconds after the instruments do and the long fanfares come last. O(n log n), stable.
 */
export const BUILD_ORDER = Object.freeze(SOUND_NAMES.slice().sort((a, b) => BUILD_COST[a] - BUILD_COST[b]));

/**
 * Builds every effect the way Sfx._build_effects does (one prepared synthesiser, shared tables) and
 * yields each one as the stream the engine plays: 16-bit mono PCM at SFX_RATE. Steps without a stream
 * (the noise table, the instruments) yield null, so that a caller on the main thread can let a frame
 * pass. About 0.9 M samples in all.
 * @returns {Generator<null | { name: string, pcm: Int16Array, rate: number, stereo: boolean, loop: null }>}
 */
export function* buildEffects() {
  const base = new AudioSynth();
  yield null;
  base.prepare();
  yield null;
  const synth = new AudioSynth(base);
  for (const name of BUILD_ORDER) {
    yield { name, pcm: AudioSynth.toPcm16(synth.render(name)), rate: SFX_RATE, stereo: false, loop: null };
  }
}

/**
 * Builds the music the way Sfx._build_music does (a synthesiser of its own) and yields it, last, as
 * the looping stereo stream the engine plays; the steps before it yield null. About 1.4 M samples.
 * @returns {Generator<null | { name: string, pcm: Int16Array, rate: number, stereo: boolean, loop: { begin: number, end: number } }>}
 */
export function* buildMusic() {
  const synth = new AudioSynth();
  yield null;
  const steps = synth.musicSteps();
  let step = steps.next();
  while (!step.done) {
    yield null;
    step = steps.next();
  }
  const [left, right] = step.value;
  const { frames, loopBegin, loopEnd } = AudioSynth.loopingFrames(left, right);
  yield { name: MUSIC_NAME, pcm: AudioSynth.toPcm16(frames), rate: MUSIC_RATE, stereo: true, loop: { begin: loopBegin, end: loopEnd } };
}

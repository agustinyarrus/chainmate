/**
 * The engine's fallback backend, for a browser without AudioWorklet: the game's buses built from Web
 * Audio's own nodes. It sounds like the original; unlike the worklet backend it is not the same
 * arithmetic. What stands in for what:
 *
 *   stream playback   AudioBufferSourceNode → GainNode. The samples are the original's (16-bit PCM
 *                     over 32767); the browser resamples them with its own interpolation instead of
 *                     the engine's cubic one, and `pitch_scale` is the node's playbackRate.
 *   volume ramps      the engine moves a volume over one mix block (512 frames): a linear ramp of
 *                     that length here, sample-accurate instead of block-aligned.
 *   reverb            ConvolverNode holding the impulse response of the ported reverb (mixer.js) with
 *                     the bus's settings, dry part included. The reverb is a linear filter, so its
 *                     response is the filter — except for the tail past IR_SECONDS, faded out.
 *   limiter           DynamicsCompressorNode at the original's ceiling, attack and release, its
 *                     built-in make-up gain cancelled. A compressor with a hard knee, not the
 *                     original's look-ahead limiter: loud overlaps are held a little differently.
 *   bus sleep         none: nodes always run. (A sleeping bus only freezes a tail under −60 dB.)
 *
 * Every source is stopped and disconnected, with its gain node, as soon as it has ended.
 */
import { Reverb, GAME_BUSES, BLOCK_FRAMES } from './mixer.js';
import { dbToLinearF } from './decibels.js';
import { Backend } from './protocol.js';

const PCM_SCALE = 32767.0;
/** Length of the reverb's impulse response, and of the fade that ends it. */
const IR_SECONDS = 4.0;
const IR_FADE_SECONDS = 0.25;
/** A seek past the end lands this far before it (AudioStreamPlaybackWAV::seek). */
const SEEK_MARGIN_SECONDS = 0.001;
const LIMITER_ATTACK_SECONDS = 0.002;
const COMPRESSOR_RATIO = 20;
/** Exponent of the make-up gain in the Web Audio specification. */
const MAKEUP_EXPONENT = 0.6;

/**
 * The impulse response of the ported reverb: one frame of full scale in, IR_SECONDS out.
 * O(frames × 14 delay lines × 2 channels), about 20 ms of work.
 * @returns {[Float32Array, Float32Array]} left and right
 */
export function reverbResponse(settings, sampleRate) {
  const reverb = new Reverb(settings, sampleRate);
  const frames = Math.ceil((IR_SECONDS * sampleRate) / BLOCK_FRAMES) * BLOCK_FRAMES;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const input = new Float32Array(BLOCK_FRAMES * 2);
  const output = new Float32Array(BLOCK_FRAMES * 2);
  input[0] = 1;
  input[1] = 1;
  for (let at = 0; at < frames; at += BLOCK_FRAMES) {
    reverb.process(input, output, BLOCK_FRAMES);
    for (let i = 0; i < BLOCK_FRAMES; i++) {
      left[at + i] = output[2 * i];
      right[at + i] = output[2 * i + 1];
    }
    if (at === 0) input.fill(0);
  }
  const fade = Math.round(IR_FADE_SECONDS * sampleRate);
  for (let i = 0; i < fade; i++) {
    const gain = i / fade;
    left[frames - 1 - i] *= gain;
    right[frames - 1 - i] *= gain;
  }
  return [left, right];
}

/** What cancels the compressor's make-up gain: (curve(1))^0.6, hard knee. */
export function makeupCompensation(thresholdDb, ratio) {
  const threshold = Math.pow(10, thresholdDb / 20);
  return Math.pow(threshold, MAKEUP_EXPONENT * (1 - 1 / ratio));
}

export class NativeBackend {
  /**
   * @param {BaseAudioContext} context
   * @param {{ onEnded: (id: number) => void, buses?: ReadonlyArray<object> }} options
   */
  constructor(context, { onEnded, buses = GAME_BUSES }) {
    this.kind = Backend.NATIVE;
    this.context = context;
    this.onEnded = onEnded;
    this.blockSeconds = BLOCK_FRAMES / context.sampleRate;
    /** @type {Map<string, { buffer: AudioBuffer, rate: number, loop: object | null }>} */
    this.streams = new Map();
    /** @type {Map<number, { source: AudioBufferSourceNode, gain: GainNode, stopping: boolean }>} */
    this.voices = new Map();
    /** @type {Map<string, { input: GainNode, output: GainNode, nodes: AudioNode[], volume: number, mute: boolean }>} */
    this.buses = new Map();
    for (const layout of buses) this.buses.set(layout.name, this.createBus(layout));
    // Sends are connected once every bus exists; the first bus is the output.
    buses.forEach((layout, index) => {
      const target = index === 0 ? context.destination : (this.buses.get(layout.send) ?? this.buses.get(buses[0].name)).input;
      this.buses.get(layout.name).output.connect(target);
    });
  }

  /** input → effects → output (the bus volume). */
  createBus(layout) {
    const context = this.context;
    const input = context.createGain();
    const output = context.createGain();
    const nodes = [input];
    for (const settings of layout.effects) nodes.push(...this.createEffect(settings));
    nodes.push(output);
    for (let i = 0; i + 1 < nodes.length; i++) nodes[i].connect(nodes[i + 1]);
    return { input, output, nodes, volume: 1, mute: false };
  }

  createEffect(settings) {
    const context = this.context;
    if (settings.type === 'reverb') {
      const [left, right] = reverbResponse(settings, context.sampleRate);
      const response = context.createBuffer(2, left.length, context.sampleRate);
      response.copyToChannel(left, 0);
      response.copyToChannel(right, 1);
      const convolver = context.createConvolver();
      // Before the buffer is set: the response carries its own level.
      convolver.normalize = false;
      convolver.buffer = response;
      return [convolver];
    }
    if (settings.type === 'limiter') {
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = settings.ceilingDb;
      compressor.knee.value = 0;
      compressor.ratio.value = COMPRESSOR_RATIO;
      compressor.attack.value = LIMITER_ATTACK_SECONDS;
      compressor.release.value = settings.release;
      const preGain = context.createGain();
      preGain.gain.value = dbToLinearF(settings.preGainDb);
      const compensation = context.createGain();
      compensation.gain.value = makeupCompensation(settings.ceilingDb, COMPRESSOR_RATIO);
      return [preGain, compressor, compensation];
    }
    throw new Error(`NativeBackend: unknown effect type '${settings.type}'`);
  }

  addStream(name, { pcm, rate, stereo = false, loop = null }) {
    const channels = stereo ? 2 : 1;
    const frames = pcm.length / channels;
    const buffer = this.context.createBuffer(channels, frames, rate);
    for (let channel = 0; channel < channels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < frames; i++) data[i] = pcm[i * channels + channel] / PCM_SCALE;
    }
    this.streams.set(name, { buffer, rate, loop });
  }

  start(id, { stream: name, bus: busName, volume, pitchScale = 1, from = 0 }) {
    const stream = this.streams.get(name);
    if (stream === undefined) throw new Error(`NativeBackend: unknown stream '${name}'`);
    if (this.voices.has(id)) throw new Error(`NativeBackend: playback ${id} is already live`);
    const context = this.context;
    const bus = this.buses.get(busName) ?? this.buses.values().next().value;
    const source = context.createBufferSource();
    source.buffer = stream.buffer;
    source.playbackRate.value = pitchScale;
    if (stream.loop !== null) {
      source.loop = true;
      source.loopStart = stream.loop.begin / stream.rate;
      source.loopEnd = stream.loop.end / stream.rate;
    }
    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(bus.input);
    source.onended = () => this.release(id);
    this.voices.set(id, { source, gain, stopping: false });
    const length = stream.buffer.duration;
    source.start(0, from < 0 ? 0 : from >= length ? length - SEEK_MARGIN_SECONDS : from);
  }

  /** The playback fades over one block and stops; its nodes are released when it has ended. */
  stop(id) {
    const voice = this.voices.get(id);
    if (voice === undefined || voice.stopping) return;
    voice.stopping = true;
    const end = this.rampTo(voice.gain.gain, 0, this.blockSeconds);
    voice.source.stop(end);
  }

  setVolume(id, volume) {
    const voice = this.voices.get(id);
    if (voice === undefined || voice.stopping) return;
    this.rampTo(voice.gain.gain, volume, this.blockSeconds);
  }

  setBus(name, { volumeDb, mute }) {
    const bus = this.buses.get(name);
    if (bus === undefined) return;
    if (volumeDb !== undefined) bus.volume = dbToLinearF(volumeDb);
    if (mute !== undefined) bus.mute = Boolean(mute);
    this.rampTo(bus.output.gain, bus.mute ? 0 : bus.volume, this.blockSeconds);
  }

  /** Moves a parameter to `value` over `seconds`, from wherever it is; returns the time it arrives. */
  rampTo(param, value, seconds) {
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + seconds);
    return now + seconds;
  }

  /** A source has ended: its nodes leave the graph and the engine gets the voice back. */
  release(id) {
    const voice = this.voices.get(id);
    if (voice === undefined) return;
    this.voices.delete(id);
    this.disconnect(voice);
    this.onEnded(id);
  }

  disconnect(voice) {
    voice.source.onended = null;
    voice.source.disconnect();
    voice.gain.disconnect();
  }

  dispose() {
    for (const voice of this.voices.values()) {
      this.disconnect(voice);
      voice.source.stop();
    }
    this.voices.clear();
    for (const bus of this.buses.values()) for (const node of bus.nodes) node.disconnect();
    this.buses.clear();
    this.streams.clear();
  }
}

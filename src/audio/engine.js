/**
 * AudioEngine — port of scripts/autoload/sfx.gd: twelve voices on the SFX bus, the music player on the
 * Music bus, both into a limited Master; pitch variance, retrigger guard, voice stealing, step
 * pitches, music fades, bus volumes. `Sfx` (src/autoload/sfx.js) is the game-facing name of it.
 *
 * IDENTICAL TO THE ORIGINAL (proved against the original build by test/audio.test.mjs)
 *   - every sample of every effect and of the music loop, as float32 and as the 16-bit PCM that is
 *     played (src/audio/synth.js, src/audio/libm.js);
 *   - the mixer, from stream to driver: decode, cubic resampler (`pitch_scale`), 512-frame mix steps
 *     with 64 frames of lookahead, volume ramps, fade-out of stopped and finished streams, both
 *     reverbs, bus volumes and mute, the hard limiter, the sleep of silent buses (src/audio/mixer.js,
 *     on the audio thread through an AudioWorklet, at the original's mix rate of 44 100 Hz);
 *   - the rules of Sfx: VOICE_COUNT, PITCH_VARIANCE on the varied sounds, the 30 ms retrigger guard
 *     per sound (per sound and step for play_step), the pitch clamp 0.1‥4, round-robin voices and
 *     stealing of the oldest, STEP_SEMITONES, volume_db → linear, the 0.001 gain floor, bus volumes
 *     as linear_to_db(max(value, 0.001)) with mute at zero;
 *   - the music's fades: tweens of the scene tree (2.5 s in, from wherever the gain is; 1 s out, then
 *     stop), one volume per rendered frame, which the mixer reaches by a ramp over its next step.
 *
 * TIME. The engine has no clock of its own. The fades advance with the delta the scene tree hands to
 * its tweens (scaled by Engine.time_scale, like every tween of the game); the retrigger guard reads
 * Time.get_ticks_usec(), as the original does.
 *
 * APPROXIMATED, AND WHY
 *   - Start of playback. A browser gives no sound before a user gesture: until then calls are
 *     dropped, as on a muted device. The context is created inside the first gesture; a sound asked
 *     for while the mixer is still loading (the first click) is kept for a quarter of a second.
 *   - Availability. The original blocks its first frame until the effects exist (about 0.4 s) and
 *     gets the music 3 s later. Here both are synthesised in workers while the game runs: a sound is
 *     playable as soon as it is built (interface sounds first), the music when it is ready and wanted.
 *   - `playing`. The original asks the audio server; here the mixer reports the end of a playback by
 *     message, a few milliseconds later. It only matters for which voice is picked.
 *   - The oldest voice. The original compares start times in microseconds, which no two starts
 *     share; a browser's clock is coarser, so the order of the starts is compared instead.
 *   - Output. The mixer's samples go to the browser, which resamples them for the device, as the
 *     operating system does for the original. The platform driver's own sample format is not copied.
 *   - Hidden page. The context is suspended while the page is hidden (what the engine does on a
 *     phone when the app goes to the background); `suspendWhenHidden: false` keeps it playing.
 *   - Without AudioWorklet the buses are built from Web Audio's own nodes: see backend_native.js.
 */
import { RandomNumberGenerator } from '../godot/rng.js';
import { SceneTree } from '../godot/scene.js';
import { Tween } from '../godot/tween.js';
import { Time } from '../godot/os.js';
import { dbToLinear, dbToLinearF, gainToVolume, linearToDb } from './decibels.js';
import { SoundBuilder } from './builder.js';
import { Backend, Task } from './protocol.js';

export const MASTER_BUS = 'Master';
export const MUSIC_BUS = 'Music';
export const SFX_BUS = 'SFX';
export const VOICE_COUNT = 12;
/** Random pitch spread of the everyday sounds, so that repeats never sound stamped. */
export const PITCH_VARIANCE = 0.025;
/** The same sound is not started twice within this many microseconds. */
export const RETRIGGER_USEC = 30000;
export const MUSIC_FADE_IN_SECONDS = 2.5;
export const MUSIC_FADE_OUT_SECONDS = 1.0;
/** Gains under this are played at this level (−60 dB), never at zero. */
export const MIN_GAIN = 0.001;
export const MIN_PITCH = 0.1;
export const MAX_PITCH = 4.0;
/** Pentatonic steps, in semitones: a chain climbs them. */
export const STEP_SEMITONES = Object.freeze([0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]);
export const VARIED_SOUNDS = Object.freeze(new Set([
  'ui_hover', 'ui_click', 'ui_back', 'select', 'deselect', 'move', 'enemy_move', 'land',
  'capture', 'shatter', 'coin', 'purchase', 'train', 'map_step', 'error',
]));
/** How many effects the game has: `is_ready()` turns true when all of them exist. */
export const EFFECT_COUNT = 24;
const MUSIC_STREAM = 'music';
const BUS_NAMES = Object.freeze([MASTER_BUS, MUSIC_BUS, SFX_BUS]);
/** The original's mix rate; the mixer runs at the rate the context was given. */
const MIX_RATE = 44100;
/** A sound asked for while the mixer is coming up is still played if it is no older than this. */
const PENDING_MAX_AGE_USEC = 250000;
/** Events that count as a user gesture for audio, in every browser. */
const GESTURES = Object.freeze(['pointerdown', 'pointerup', 'mousedown', 'touchend', 'keydown', 'click']);

export const EngineState = Object.freeze({
  /** No context yet: the browser wants a user gesture first. */
  LOCKED: 'locked',
  /** The context exists, the backend is being built. */
  STARTING: 'starting',
  RUNNING: 'running',
  /** The context is not running: page hidden, interruption, or waiting for the browser's permission. */
  SUSPENDED: 'suspended',
  /** No backend could be built: the game goes on in silence. */
  FAILED: 'failed',
  DISPOSED: 'disposed',
});

/** What the music is doing; derived from the player and its tween, never stored. */
export const MusicState = Object.freeze({ SILENT: 'silent', FADING_IN: 'fading-in', PLAYING: 'playing', FADING_OUT: 'fading-out' });

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);

function defaultContext() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (Context === undefined) throw new Error('this browser has no Web Audio');
  try {
    return new Context({ sampleRate: MIX_RATE, latencyHint: 'interactive' });
  } catch (error) {
    console.info(`audio: no context at ${MIX_RATE} Hz (${error?.message ?? error}); using the device's rate`);
    return new Context({ latencyHint: 'interactive' });
  }
}

/** The worklet backend's code and the address of the mixer's module: asked for once, kept. */
let mixerModules = null;

function loadMixerModules() {
  mixerModules ??= Promise.all([import('./backend_worklet.js'), import('./worklet.js?worker&url')]).then(
    ([backend, address]) => ({ createWorkletBackend: backend.createWorkletBackend, moduleUrl: address.default }),
    (error) => {
      // Not kept: the next attempt asks again.
      mixerModules = null;
      throw error;
    },
  );
  return mixerModules;
}

/** The mixer worklet when the browser has it, Web Audio nodes otherwise. */
async function defaultBackend(context, listeners, preference) {
  if (preference !== Backend.NATIVE && context.audioWorklet !== undefined) {
    try {
      const { createWorkletBackend, moduleUrl } = await loadMixerModules();
      return await createWorkletBackend(context, { moduleUrl, ...listeners });
    } catch (error) {
      if (preference === Backend.WORKLET) throw error;
      console.warn('audio: the mixer worklet is unavailable, using Web Audio nodes instead:', error);
    }
  } else if (preference === Backend.WORKLET) {
    throw new Error('this browser has no AudioWorklet');
  }
  const { NativeBackend } = await import('./backend_native.js');
  return new NativeBackend(context, listeners);
}

/**
 * Before any gesture: everything the mixer needs is fetched, so that the first click only has to
 * start it. A failure here costs nothing — the start asks again and reports what it finds.
 */
defaultBackend.warmUp = (page, preference) => {
  if (preference === Backend.NATIVE || typeof page.fetch !== 'function') return Promise.resolve();
  return loadMixerModules()
    .then(({ moduleUrl }) => page.fetch(moduleUrl))
    .then((response) => response.arrayBuffer())
    .catch((error) => console.info(`audio: the mixer could not be fetched ahead of time (${error?.message ?? error})`));
};

export class AudioEngine {
  /**
   * Synthesis starts at once (it needs no audio device); sound starts with `unlock()`.
   * @param {{
   *   tree?: SceneTree | null,
   *   backend?: 'auto' | 'worklet' | 'native',
   *   suspendWhenHidden?: boolean,
   *   createContext?: () => BaseAudioContext,
   *   createBackend?: (context: BaseAudioContext, listeners: object, preference: string) => Promise<object>,
   *   createBuilder?: (listeners: object) => { start(): void, dispose(): void },
   *   clock?: () => number, rng?: { randf_range(from: number, to: number): number },
   * }} [options] `tree` runs the music's tweens (default: the current scene tree, looked up when a
   *   fade starts); `backend` is one of Backend (protocol.js); `clock` returns microseconds
   *   (default: Time.get_ticks_usec); the factories exist for tests
   */
  constructor({
    tree = null,
    backend = Backend.AUTO,
    suspendWhenHidden = true,
    createContext = defaultContext,
    createBackend = defaultBackend,
    createBuilder = (listeners) => new SoundBuilder(listeners),
    clock = Time.get_ticks_usec,
    rng = new RandomNumberGenerator(),
  } = {}) {
    this.tree = tree;
    this.backendPreference = backend;
    this.suspendWhenHidden = suspendWhenHidden;
    this.createContext = createContext;
    this.createBackend = createBackend;
    this.clock = clock;
    this.rng = rng;

    this.state = EngineState.LOCKED;
    /** @type {BaseAudioContext | null} */
    this.context = null;
    this.backend = null;
    this.hidden = false;

    /** @type {Map<string, object>} effect name → stream */
    this.effects = new Map();
    this.musicStream = null;
    /** Milliseconds each build task took, once it is done. */
    this.buildMsec = { [Task.EFFECTS]: null, [Task.MUSIC]: null };

    /** The playback each voice is busy with (0: free). Handles grow with every start. */
    this.voices = new Int32Array(VOICE_COUNT);
    /** @type {Map<number, number>} playback → voice index */
    this.voiceOfPlayback = new Map();
    this.nextVoice = 0;
    /** Last handle given out: every playback, voice or music, has its own. */
    this.serial = 0;
    /** @type {Map<string, number>} retrigger key → microseconds of the last start */
    this.lastPlayed = new Map();
    this.warned = new Set();
    /** Sounds asked for while the backend was coming up. */
    this.pending = [];

    this.musicWanted = false;
    /** The music player: its playback (0: not playing), its gain, the tween that moves the gain. */
    this.musicPlayback = 0;
    this.musicGain = 0.0;
    /** @type {Tween | null} */
    this.musicTween = null;
    this.musicTarget = 0.0;

    /** @type {Map<string, { volumeDb: number, mute: boolean }>} */
    this.buses = new Map(BUS_NAMES.map((name) => [name, { volumeDb: 0, mute: false }]));
    this.unfollow = null;

    this.builder = createBuilder({
      onStream: (stream) => this.onStream(stream),
      onDone: (task, msec) => this.onBuilt(task, msec),
      onFailed: (task, message) => console.error(`audio: the ${task} could not be synthesised: ${message}`),
    });
    this.builder.start();
  }

  // ───────────────────────────────────────────────────────────── the Sfx API ───────────────────

  /** Plays a sound on a free voice (or steals the oldest). `volumeDb` is relative to full scale. */
  play(sound, pitchScale = 1.0, volumeDb = 0.0) {
    const name = String(sound);
    if (!this.hasEffect(name)) return;
    let pitch = pitchScale;
    if (VARIED_SOUNDS.has(name)) pitch *= 1.0 + this.rng.randf_range(-PITCH_VARIANCE, PITCH_VARIANCE);
    this.startVoice(name, name, pitch, volumeDb);
  }

  /** Plays a sound at a step of the pentatonic ladder, without pitch variance. */
  playStep(sound, step, volumeDb = 0.0) {
    const name = String(sound);
    if (!this.hasEffect(name)) return;
    this.startVoice(`${name}:${Math.trunc(step)}`, name, AudioEngine.stepPitch(step), volumeDb);
  }

  /** Pitch scale of a step: 2^(semitones / 12), steps outside the ladder clamp to its ends. */
  static stepPitch(step) {
    const index = clamp(Math.trunc(step), 0, STEP_SEMITONES.length - 1);
    return Math.pow(2.0, STEP_SEMITONES[index] / 12.0);
  }

  /** Fades the music in (from wherever its gain is) as soon as it exists and sound is possible. */
  playMusic() {
    this.musicWanted = true;
    if (this.canSound() && this.musicStream !== null) this.fadeMusicIn();
  }

  /** Fades the music out and stops it; `fadeSeconds` ≤ 0 stops it at once. */
  stopMusic(fadeSeconds = MUSIC_FADE_OUT_SECONDS) {
    this.musicWanted = false;
    if (this.musicPlayback === 0) return;
    this.killMusicTween();
    if (fadeSeconds <= 0.0) {
      this.stopMusicPlayer();
      this.setMusicGain(0.0);
      return;
    }
    this.musicTarget = 0.0;
    this.musicTween = this.createTween();
    this.musicTween.tween_method((gain) => this.setMusicGain(gain), this.musicGain, 0.0, fadeSeconds);
    this.musicTween.tween_callback(() => this.stopMusicPlayer());
  }

  /** Volume of a bus, 0‥1 linear; zero mutes it. Unknown buses are reported and ignored. */
  setBusVolume(bus, linear) {
    const settings = this.buses.get(String(bus));
    if (settings === undefined) {
      console.warn(`Sfx: unknown audio bus '${bus}'`);
      return;
    }
    const value = clamp(Number(linear), 0.0, 1.0);
    settings.mute = value <= 0.0;
    settings.volumeDb = Math.fround(linearToDb(Math.max(value, MIN_GAIN)));
    this.backend?.setBus(String(bus), settings);
  }

  /** Volume of a bus as set by setBusVolume (a muted or unknown bus reads 0). */
  getBusVolume(bus) {
    const settings = this.buses.get(String(bus));
    if (settings === undefined || settings.mute) return 0.0;
    return clamp(dbToLinear(settings.volumeDb), 0.0, 1.0);
  }

  /** True once every effect exists. */
  isReady() {
    return this.effects.size >= EFFECT_COUNT;
  }

  isMusicReady() {
    return this.musicStream !== null;
  }

  // ───────────────────────────────────────────────────────────── voices ────────────────────────

  /** A sound that does not exist is reported once — after the build, before it nothing is known. */
  hasEffect(name) {
    if (this.effects.has(name)) return true;
    if (this.isReady() && !this.warned.has(name)) {
      this.warned.add(name);
      console.error(`Sfx: unknown sound '${name}'`);
    }
    return false;
  }

  startVoice(key, sound, pitch, volumeDb) {
    const now = this.clock();
    const last = this.lastPlayed.get(key) ?? -RETRIGGER_USEC;
    if (now - last < RETRIGGER_USEC) return;
    this.lastPlayed.set(key, now);
    if (this.canSound()) this.startNow(sound, pitch, volumeDb);
    else if (this.isComingUp()) this.keepForLater({ sound, pitch, volumeDb, at: now });
  }

  /** Queues a sound for the moment the mixer is there; what has grown too old by now leaves the queue. */
  keepForLater(request) {
    const pending = this.pending;
    let stale = 0;
    while (stale < pending.length && request.at - pending[stale].at > PENDING_MAX_AGE_USEC) stale += 1;
    if (stale > 0) pending.splice(0, stale);
    pending.push(request);
  }

  /** voice.stop(), then voice.play() with the new stream: what the voice was playing fades out. */
  startNow(sound, pitch, volumeDb) {
    const index = this.pickVoice();
    const busyWith = this.voices[index];
    if (busyWith !== 0) {
      this.backend.stop(busyWith);
      this.voiceOfPlayback.delete(busyWith);
    }
    const id = ++this.serial;
    this.voices[index] = id;
    this.voiceOfPlayback.set(id, index);
    this.backend.start(id, {
      stream: sound,
      bus: SFX_BUS,
      volume: dbToLinearF(volumeDb),
      pitchScale: Math.fround(clamp(pitch, MIN_PITCH, MAX_PITCH)),
      from: 0.0,
    });
  }

  /**
   * The next free voice, round-robin; when all twelve are busy, the one that started first — the
   * smallest handle, since handles are given out in the order of the starts. O(voices).
   */
  pickVoice() {
    const voices = this.voices;
    for (let offset = 0; offset < VOICE_COUNT; offset++) {
      const index = (this.nextVoice + offset) % VOICE_COUNT;
      if (voices[index] === 0) {
        this.nextVoice = (index + 1) % VOICE_COUNT;
        return index;
      }
    }
    let oldest = 0;
    for (let index = 1; index < VOICE_COUNT; index++) {
      if (voices[index] < voices[oldest]) oldest = index;
    }
    this.nextVoice = (oldest + 1) % VOICE_COUNT;
    return oldest;
  }

  /**
   * The backend reports that a playback has left it. Only a voice that still holds this playback
   * becomes free: a stolen voice, or the stopped music, has been given up already.
   */
  onEnded(id) {
    const index = this.voiceOfPlayback.get(id);
    if (index === undefined) return;
    this.voiceOfPlayback.delete(id);
    this.voices[index] = 0;
  }

  // ───────────────────────────────────────────────────────────── music ─────────────────────────

  /** A tween of the scene tree, bound to nothing: it runs as long as the tree does. */
  createTween() {
    const tree = this.tree ?? SceneTree.current;
    if (tree === null) throw new Error('AudioEngine: the music fades need a scene tree to run on');
    return new Tween(null, tree.tweens);
  }

  fadeMusicIn() {
    this.killMusicTween();
    if (this.musicPlayback === 0) {
      this.musicPlayback = ++this.serial;
      this.musicGain = 0.0;
      this.backend.start(this.musicPlayback, {
        stream: MUSIC_STREAM,
        bus: MUSIC_BUS,
        volume: gainToVolume(0.0, MIN_GAIN),
        pitchScale: 1.0,
        from: 0.0,
      });
    }
    const remaining = MUSIC_FADE_IN_SECONDS * (1.0 - this.musicGain);
    if (remaining <= 0.0) return;
    this.musicTarget = 1.0;
    this.musicTween = this.createTween();
    this.musicTween.tween_method((gain) => this.setMusicGain(gain), this.musicGain, 1.0, remaining);
  }

  /** The player's volume_db = linear_to_db(max(gain, MIN_GAIN)), as the player turns it into a volume. */
  setMusicGain(gain) {
    this.musicGain = gain;
    if (this.musicPlayback !== 0) this.backend?.setVolume(this.musicPlayback, gainToVolume(gain, MIN_GAIN));
  }

  /** _music_player.stop(): the mixer fades what is left over its next step. */
  stopMusicPlayer() {
    if (this.musicPlayback === 0) return;
    this.backend?.stop(this.musicPlayback);
    this.musicPlayback = 0;
  }

  killMusicTween() {
    if (this.musicTween !== null && this.musicTween.is_valid()) this.musicTween.kill();
    this.musicTween = null;
  }

  musicState() {
    if (this.musicPlayback === 0) return MusicState.SILENT;
    if (this.musicTween === null || !this.musicTween.is_valid()) return MusicState.PLAYING;
    return this.musicTarget > 0.0 ? MusicState.FADING_IN : MusicState.FADING_OUT;
  }

  // ───────────────────────────────────────────────────────────── synthesis ─────────────────────

  onStream(stream) {
    if (this.state === EngineState.DISPOSED) return;
    if (stream.name === MUSIC_STREAM) this.musicStream = stream;
    else this.effects.set(stream.name, stream);
    if (this.backend === null) return;
    this.backend.addStream(stream.name, stream);
    if (stream.name === MUSIC_STREAM && this.musicWanted && this.canSound()) this.fadeMusicIn();
  }

  onBuilt(task, msec) {
    this.buildMsec[task] = msec;
  }

  // ───────────────────────────────────────────────────────────── context ───────────────────────

  /** Playbacks only start while the context runs: queued behind a suspended one they would burst out later. */
  canSound() {
    return this.state === EngineState.RUNNING;
  }

  /** Between the first gesture and the first sound: what is asked for now is worth keeping a moment. */
  isComingUp() {
    return this.state === EngineState.STARTING || (this.state === EngineState.SUSPENDED && !this.hidden);
  }

  /**
   * To be called from inside a user gesture: the first call creates the context and the backend,
   * later ones wake a context that the browser has suspended. Never throws.
   * @returns {Promise<void>} settled when the attempt is over
   */
  unlock() {
    if (this.state === EngineState.LOCKED) return this.startUp();
    if (this.state === EngineState.SUSPENDED && !this.hidden) this.wake();
    return Promise.resolve();
  }

  async startUp() {
    this.state = EngineState.STARTING;
    try {
      const context = this.createContext();
      this.context = context;
      context.onstatechange = () => this.onContextState();
      if (context.state !== 'running') this.wake();
      const listeners = { onEnded: (id) => this.onEnded(id), onFailure: (message) => console.error(`audio: ${message}`) };
      const backend = await this.createBackend(context, listeners, this.backendPreference);
      if (this.state === EngineState.DISPOSED) {
        backend.dispose();
        return;
      }
      this.backend = backend;
      for (const [name, stream] of this.effects) backend.addStream(name, stream);
      if (this.musicStream !== null) backend.addStream(MUSIC_STREAM, this.musicStream);
      for (const [name, settings] of this.buses) backend.setBus(name, settings);
      console.info(`audio: ${backend.kind} backend at ${context.sampleRate} Hz`);
      this.state = EngineState.SUSPENDED;
      this.onContextState();
    } catch (error) {
      this.state = EngineState.FAILED;
      this.pending.length = 0;
      console.error('audio: no sound in this session:', error);
    }
  }

  /** Asks the browser to run the context; whether it does is told by its state change. */
  wake() {
    this.context.resume()?.catch((error) => console.info(`audio: the context stays suspended (${error?.message ?? error})`));
  }

  onContextState() {
    if (this.backend === null) return;
    const running = this.context.state === 'running';
    if (this.state === EngineState.SUSPENDED && running) {
      this.state = EngineState.RUNNING;
      this.onRunning();
    } else if (this.state === EngineState.RUNNING && !running) {
      this.state = EngineState.SUSPENDED;
    }
  }

  /** Sound is possible (again): what was asked for a moment ago is played, the music comes in. */
  onRunning() {
    const now = this.clock();
    const waiting = this.pending.splice(0);
    for (const { sound, pitch, volumeDb, at } of waiting) {
      if (now - at <= PENDING_MAX_AGE_USEC) this.startNow(sound, pitch, volumeDb);
    }
    if (this.musicWanted && this.musicStream !== null && this.musicPlayback === 0) this.fadeMusicIn();
  }

  /** The page went out of sight or came back. */
  setHidden(hidden) {
    this.hidden = hidden;
    if (this.context === null || !this.suspendWhenHidden) return;
    if (hidden) this.context.suspend()?.catch((error) => console.info(`audio: the context keeps running (${error?.message ?? error})`));
    else if (this.state === EngineState.SUSPENDED) this.wake();
  }

  /**
   * Ties the engine to a page: any user gesture unlocks the sound, and the page's visibility
   * suspends and resumes it. Listeners run in the capture phase, so the sound is unlocked before
   * the game handles the very click that asked for it; the mixer is fetched right away, so that
   * the click finds it at hand.
   * @param {Window} page
   */
  followPage(page = globalThis) {
    this.unfollow?.();
    const document = page.document;
    const onGesture = () => {
      this.unlock();
    };
    const onVisibility = () => this.setHidden(document.visibilityState === 'hidden');
    const options = { capture: true, passive: true };
    this.hidden = document.visibilityState === 'hidden';
    this.createBackend.warmUp?.(page, this.backendPreference);
    for (const type of GESTURES) page.addEventListener(type, onGesture, options);
    document.addEventListener('visibilitychange', onVisibility);
    this.unfollow = () => {
      for (const type of GESTURES) page.removeEventListener(type, onGesture, options);
      document.removeEventListener('visibilitychange', onVisibility);
      this.unfollow = null;
    };
  }

  /** What the engine is doing, for tools and tests. */
  snapshot() {
    return {
      state: this.state,
      backend: this.backend?.kind ?? null,
      sampleRate: this.context?.sampleRate ?? null,
      effects: this.effects.size,
      ready: this.isReady(),
      musicReady: this.isMusicReady(),
      musicWanted: this.musicWanted,
      music: this.musicState(),
      musicGain: this.musicGain,
      voices: this.voiceOfPlayback.size,
      buses: Object.fromEntries([...this.buses].map(([name, bus]) => [name, { ...bus, linear: this.getBusVolume(name) }])),
      buildMsec: { ...this.buildMsec },
    };
  }

  /** Stops everything and gives the device back. */
  dispose() {
    if (this.state === EngineState.DISPOSED) return;
    this.state = EngineState.DISPOSED;
    this.unfollow?.();
    this.killMusicTween();
    this.builder.dispose();
    this.pending.length = 0;
    this.backend?.dispose();
    this.backend = null;
    if (this.context !== null) {
      this.context.onstatechange = null;
      this.context.close?.()?.catch((error) => console.info(`audio: the context did not close (${error?.message ?? error})`));
    }
  }
}

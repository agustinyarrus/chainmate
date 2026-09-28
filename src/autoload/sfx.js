/**
 * Sfx — the game's audio autoload (scripts/autoload/sfx.gd), under the names the game calls:
 * `play(sound, pitch, db)`, `play_step(sound, step, db)`, `play_music()`, `stop_music(fade)`,
 * `set_bus_volume(bus, linear)`, `get_bus_volume(bus)`, `is_ready()`, `is_music_ready()`,
 * `step_pitch(step)`, `build_msec`, `music_msec`.
 *
 * The work is done by the audio engine (src/audio/engine.js), attached with `Sfx.attach(engine)`.
 * Without an engine the game runs in silence: sounds are dropped, while what describes a state —
 * the bus volumes, whether the music is wanted — is kept and handed over when an engine arrives.
 */

/** Pentatonic steps in semitones (Sfx.STEP_SEMITONES): what step_pitch reads without an engine. */
const STEP_SEMITONES = Object.freeze([0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]);
const BUS_NAMES = Object.freeze(['Master', 'Music', 'SFX']);

class SfxAutoload {
  constructor() {
    /**
     * @type {null | {
     *   play(name: string, pitch: number, db: number): void,
     *   playStep(name: string, step: number, db: number): void,
     *   playMusic(): void, stopMusic(fadeSeconds: number): void,
     *   setBusVolume(bus: string, linear: number): void, getBusVolume(bus: string): number,
     *   isReady(): boolean, isMusicReady(): boolean,
     * }}
     */
    this.engine = null;
    /** @type {Map<string, number>} bus → linear volume set before an engine was attached */
    this._pendingVolumes = new Map();
    this._musicWanted = false;
  }

  /** Hands the kept state to the engine; from here on every call goes straight to it. */
  attach(engine) {
    this.engine = engine;
    for (const [bus, value] of this._pendingVolumes) engine.setBusVolume(bus, value);
    this._pendingVolumes.clear();
    if (this._musicWanted) engine.playMusic();
  }

  play(sound, pitchScale = 1.0, volumeDb = 0.0) {
    this.engine?.play(String(sound), pitchScale, volumeDb);
  }

  play_step(sound, step, volumeDb = 0.0) {
    this.engine?.playStep(String(sound), step, volumeDb);
  }

  /** Pitch scale of a step of the ladder: 2^(semitones / 12). */
  step_pitch(step) {
    const index = Math.min(Math.max(Math.trunc(step), 0), STEP_SEMITONES.length - 1);
    return Math.pow(2.0, STEP_SEMITONES[index] / 12.0);
  }

  play_music() {
    this._musicWanted = true;
    this.engine?.playMusic();
  }

  stop_music(fadeSeconds = 1.0) {
    this._musicWanted = false;
    this.engine?.stopMusic(fadeSeconds);
  }

  set_bus_volume(bus, linear) {
    if (this.engine) this.engine.setBusVolume(bus, linear);
    else if (BUS_NAMES.includes(String(bus))) this._pendingVolumes.set(String(bus), linear);
    else console.warn(`Sfx: unknown audio bus '${bus}'`);
  }

  get_bus_volume(bus) {
    if (this.engine) return this.engine.getBusVolume(bus);
    const pending = this._pendingVolumes.get(String(bus));
    return pending === undefined ? (BUS_NAMES.includes(String(bus)) ? 1.0 : 0.0) : Math.min(Math.max(Number(pending), 0.0), 1.0);
  }

  is_ready() {
    return this.engine?.isReady() ?? false;
  }

  is_music_ready() {
    return this.engine?.isMusicReady() ?? false;
  }

  /** Milliseconds the synthesis of the effects took (0 until it is done). */
  get build_msec() {
    return this.engine?.buildMsec?.effects ?? 0.0;
  }

  /** Milliseconds the synthesis of the music took (0 until it is done). */
  get music_msec() {
    return this.engine?.buildMsec?.music ?? 0.0;
  }
}

export const Sfx = new SfxAutoload();

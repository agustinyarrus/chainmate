/**
 * Sfx — the game's audio autoload API (port of scripts/autoload/sfx.gd): `play(sound, pitch, db)`,
 * `play_step(sound, step)`, `play_music()`, `set_bus_volume(bus, linear)`. The synthesis and the
 * Web Audio graph are attached by `Sfx.attach(engine)` once the audio engine exists; calls made
 * before that (or with audio blocked by the browser) are dropped, like a muted bus.
 */
class SfxAutoload {
  constructor() {
    /** @type {null | { play(name: string, pitch: number, db: number): void, playStep(name: string, step: number): void, playMusic(): void, setBusVolume(bus: string, linear: number): void }} */
    this.engine = null;
    this._pendingVolumes = new Map();
    this._musicWanted = false;
  }

  attach(engine) {
    this.engine = engine;
    for (const [bus, value] of this._pendingVolumes) engine.setBusVolume(bus, value);
    this._pendingVolumes.clear();
    if (this._musicWanted) engine.playMusic();
  }

  play(sound, pitchScale = 1.0, volumeDb = 0.0) {
    this.engine?.play(String(sound), pitchScale, volumeDb);
  }

  play_step(sound, step) {
    this.engine?.playStep(String(sound), step);
  }

  play_music() {
    this._musicWanted = true;
    this.engine?.playMusic();
  }

  set_bus_volume(bus, linear) {
    if (this.engine) this.engine.setBusVolume(bus, linear);
    else this._pendingVolumes.set(bus, linear);
  }
}

export const Sfx = new SfxAutoload();

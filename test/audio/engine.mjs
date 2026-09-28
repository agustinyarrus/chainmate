/**
 * Engine — src/audio/engine.js and src/autoload/sfx.js: the rules of the original's Sfx autoload
 * (constants from the oracle, _oracle/probe_audio.gd), the life of the audio context, the music's
 * fades on the scene tree's tweens, and — through the real backend, port and mixer — the same recorded
 * cases the mixer is tested with, this time asked for the way the game asks: Sfx.play(…).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { audioOracle, originalStreams, compareFloat32, reportCard, captureConsole, ulpsApart, count } from './support.mjs';
import { mixOracle, replayCase } from './mix_support.mjs';
import { FakeContext, FakeWorkletNode, settle } from './fake_web_audio.mjs';
import {
  AudioEngine, EngineState, MusicState, VOICE_COUNT, PITCH_VARIANCE, RETRIGGER_USEC, MUSIC_FADE_IN_SECONDS, MUSIC_FADE_OUT_SECONDS,
  MIN_GAIN, STEP_SEMITONES, VARIED_SOUNDS, EFFECT_COUNT, MASTER_BUS, MUSIC_BUS, SFX_BUS,
} from '../../src/audio/engine.js';
import { createWorkletBackend } from '../../src/audio/backend_worklet.js';
import { MixerHost } from '../../src/audio/worklet.js';
import { Backend, PROCESSOR_NAME } from '../../src/audio/protocol.js';
import { dbToLinear, dbToLinearF, gainToVolume, linearToDb } from '../../src/audio/decibels.js';
import { RandomNumberGenerator } from '../../src/godot/rng.js';
import { SceneTree } from '../../src/godot/scene.js';
import { SOUND_NAMES } from '../../src/audio/synth.js';

const F = Math.fround;
const { one } = audioOracle();
const sfx = one('sfx');
const USEC = 1e6;
const FRAME = 1 / 60;

const tinyStream = (name) => ({ name, pcm: new Int16Array(64), rate: 44100, stereo: false, loop: null });
const musicStream = () => ({ name: 'music', pcm: new Int16Array(256), rate: 22050, stereo: true, loop: { begin: 0, end: 120 } });
const noVariance = { randf_range: () => 0 };
/** What a linear tween gives after `time` of `duration` (tween.js, TRANS_LINEAR). */
const linear = (from, to, time, duration) => ((to - from) * time) / duration + from;

/**
 * An engine on stand-ins: a context that never sounds, a backend that writes down what it is told, a
 * builder that builds when the test says so, a clock the test sets — and a real scene tree.
 */
function harness({ context = new FakeContext({ state: 'running' }), backendError = null, contextError = null, rng = noVariance, options = {} } = {}) {
  const commands = [];
  const state = { usec: 0, listeners: null, builder: null, builderDisposed: false, backendDisposed: false, contexts: 0, preference: null };
  const tree = new SceneTree();
  const backend = {
    kind: 'recorded',
    addStream: (name, stream) => commands.push(['stream', name, stream]),
    start: (id, request) => commands.push(['start', id, request]),
    stop: (id) => commands.push(['stop', id]),
    setVolume: (id, volume) => commands.push(['volume', id, volume]),
    setBus: (name, settings) => commands.push(['bus', name, { ...settings }]),
    dispose: () => {
      state.backendDisposed = true;
    },
  };
  const engine = new AudioEngine({
    tree,
    ...options,
    createContext: () => {
      state.contexts += 1;
      if (contextError !== null) throw contextError;
      return context;
    },
    createBackend: async (_context, listeners, preference) => {
      state.listeners = listeners;
      state.preference = preference;
      if (backendError !== null) throw backendError;
      return backend;
    },
    createBuilder: (listeners) => {
      state.builder = listeners;
      return {
        start() {},
        dispose() {
          state.builderDisposed = true;
        },
      };
    },
    clock: () => state.usec,
    rng,
  });
  return {
    engine,
    tree,
    context,
    commands,
    state,
    of: (kind) => commands.filter((command) => command[0] === kind),
    clear: () => commands.splice(0),
    at: (seconds) => {
      state.usec = seconds * USEC;
    },
    /** Runs `frames` frames of the scene tree, the way the application does. */
    frames: (frames, timeScale = 1, step = FRAME) => {
      for (let i = 0; i < frames; i++) tree.iteration(step, timeScale);
    },
    buildEffects: (names = SOUND_NAMES) => names.forEach((name) => state.builder.onStream(tinyStream(name))),
    buildMusic: () => state.builder.onStream(musicStream()),
    ended: (id) => state.listeners.onEnded(id),
    /** What the engine wrote to the console while it came up. */
    lines: [],
    async unlocked() {
      this.lines = await captureConsole(async () => {
        await engine.unlock();
        await settle();
      });
      return this;
    },
  };
}

/** A ready, running engine. */
async function running(settings) {
  const h = harness(settings);
  h.buildEffects();
  await h.unlocked();
  assert.equal(h.engine.state, EngineState.RUNNING);
  h.clear();
  return h;
}

// ─────────────────────────────────────────────────────────────── the original's numbers ────────

test("Sfx constants are the original's", () => {
  assert.equal(VOICE_COUNT, sfx.voice_count);
  assert.equal(PITCH_VARIANCE, sfx.pitch_variance);
  assert.equal(RETRIGGER_USEC, sfx.retrigger_usec);
  assert.equal(MUSIC_FADE_IN_SECONDS, sfx.music_fade_in_seconds);
  assert.equal(MIN_GAIN, sfx.min_gain);
  assert.deepEqual([...STEP_SEMITONES], sfx.step_semitones);
  assert.deepEqual([...VARIED_SOUNDS], sfx.varied_sounds);
  assert.deepEqual([...sfx.streams].sort(), [...SOUND_NAMES].sort());
  assert.equal(EFFECT_COUNT, sfx.streams.length);
  assert.deepEqual([sfx.voice_bus, sfx.music_bus], [SFX_BUS, MUSIC_BUS]);
});

test('step pitches: the ladder of the original, clamped at both ends', async () => {
  const { Sfx } = await import('../../src/autoload/sfx.js');
  assert.deepEqual(sfx.step_pitch.map(([step]) => step), [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  for (const [step, pitch] of sfx.step_pitch) {
    const own = AudioEngine.stepPitch(step);
    // A player keeps its pitch in single precision: that is what must agree, to the bit.
    assert.equal(F(own), F(pitch), `step ${step}`);
    assert.ok(ulpsApart(own, pitch) <= 1, `step ${step}: ${own} against ${pitch}`);
    assert.equal(Sfx.step_pitch(step), own);
  }
  assert.equal(AudioEngine.stepPitch(5), 2);
  assert.equal(AudioEngine.stepPitch(10), 4);
  assert.equal(AudioEngine.stepPitch(2.9), AudioEngine.stepPitch(2), 'a step is an integer');
});

// ─────────────────────────────────────────────────────────────── locked, starting, running ─────

test('before the first gesture nothing sounds and nothing is kept', async () => {
  const h = harness();
  assert.equal(h.engine.state, EngineState.LOCKED);
  assert.equal(h.engine.isReady(), false);
  h.buildEffects(SOUND_NAMES.slice(0, 23));
  assert.equal(h.engine.isReady(), false, '23 of 24 effects');
  h.buildEffects(SOUND_NAMES.slice(23));
  assert.equal(h.engine.isReady(), true);
  assert.equal(h.engine.isMusicReady(), false);

  h.engine.play('ui_click');
  h.engine.playStep('chain_step', 3);
  assert.equal(h.state.contexts, 0, 'no context without a gesture');
  assert.equal(h.engine.pending.length, 0);

  h.at(10);
  await h.unlocked();
  assert.deepEqual(h.of('start'), [], 'what was asked for while locked stays unplayed');
});

test('unlock: one context, the backend gets every stream and every bus, then sound is possible', async () => {
  const h = harness({ context: new FakeContext({ state: 'suspended' }) });
  h.buildEffects();
  h.buildMusic();
  h.engine.setBusVolume(SFX_BUS, 0.85);
  const lines = await captureConsole(async () => {
    const first = h.engine.unlock();
    assert.equal(h.engine.state, EngineState.STARTING);
    h.engine.unlock();
    await first;
    await settle();
  });
  assert.equal(h.state.contexts, 1, 'a second gesture does not create a second context');
  assert.equal(h.state.preference, Backend.AUTO);
  assert.deepEqual(h.context.calls, ['resume']);
  assert.equal(h.engine.state, EngineState.RUNNING);
  assert.deepEqual(h.of('stream').map((command) => command[1]), [...SOUND_NAMES, 'music']);
  assert.deepEqual(h.of('bus').map((command) => command[1]), [MASTER_BUS, MUSIC_BUS, SFX_BUS]);
  assert.equal(h.of('bus')[2][2].volumeDb, F(linearToDb(0.85)));
  assert.deepEqual(lines, [{ level: 'info', text: 'audio: recorded backend at 44100 Hz' }]);

  // Built after the start: handed over at once.
  h.clear();
  h.state.builder.onStream(tinyStream('extra'));
  assert.deepEqual(h.of('stream').map((command) => command[1]), ['extra']);
});

test('the first click: a sound asked for while the mixer is coming up is played when it is there', async () => {
  const h = harness({ context: new FakeContext({ state: 'suspended' }) });
  h.buildEffects();
  h.at(1.0);
  let coming;
  const lines = await captureConsole(async () => {
    coming = h.engine.unlock();
    h.engine.play('ui_click');
    h.at(1.1);
    h.engine.play('select', 1.0, -3.0);
    assert.equal(h.engine.pending.length, 2);
    h.at(1.2);
    await coming;
    await settle();
  });
  assert.equal(lines.length, 1);
  const started = h.of('start');
  assert.deepEqual(started.map((command) => command[2].stream), ['ui_click', 'select']);
  assert.equal(started[1][2].volume, dbToLinearF(-3));
  assert.equal(h.engine.pending.length, 0);
});

test('what waits for the mixer stays a short list, however long the wait', async () => {
  const h = harness({ context: new FakeContext({ state: 'suspended', resumes: false }) });
  h.buildEffects();
  await h.unlocked();
  assert.equal(h.engine.state, EngineState.SUSPENDED);
  // A minute of play behind a context that does not run: a sound every 40 ms.
  for (let i = 0; i < 1500; i++) {
    h.at(i * 0.04);
    h.engine.play(SOUND_NAMES[i % SOUND_NAMES.length]);
    assert.ok(h.engine.pending.length <= 8, `${h.engine.pending.length} waiting`);
  }
  h.context.setState('running');
  const played = h.of('start').map((command) => command[2].stream);
  assert.ok(played.length >= 6 && played.length <= 8, `${played.length} played`);
  assert.equal(played.at(-1), SOUND_NAMES[1499 % SOUND_NAMES.length]);
});

test('a sound that waited too long is dropped instead of played late', async () => {
  const h = harness({ context: new FakeContext({ state: 'suspended', resumes: false }) });
  h.buildEffects();
  h.at(1.0);
  await captureConsole(async () => {
    await h.engine.unlock();
    await settle();
  });
  assert.equal(h.engine.state, EngineState.SUSPENDED, 'the browser has not let the context run yet');
  h.engine.play('ui_click');
  h.at(1.2);
  h.engine.play('ui_back');
  h.at(1.3);
  h.context.setState('running');
  assert.equal(h.engine.state, EngineState.RUNNING);
  assert.deepEqual(h.of('start').map((command) => command[2].stream), ['ui_back'], 'ui_click was 300 ms old');
});

test('no audio at all: the game goes on in silence', async () => {
  for (const settings of [{ backendError: new Error('no worklet, no nodes') }, { contextError: new Error('no Web Audio') }]) {
    const h = harness(settings);
    h.buildEffects();
    h.buildMusic();
    const lines = await captureConsole(async () => {
      await h.engine.unlock();
      await settle();
    });
    assert.equal(h.engine.state, EngineState.FAILED);
    assert.deepEqual(lines.map((line) => line.level), ['error']);
    h.engine.play('ui_click');
    h.engine.playMusic();
    h.frames(30);
    h.engine.stopMusic();
    h.engine.setBusVolume(MASTER_BUS, 0.5);
    await h.engine.unlock();
    assert.equal(h.engine.getBusVolume(MASTER_BUS), dbToLinear(F(linearToDb(0.5))), 'settings are kept all the same');
    assert.deepEqual(h.of('start'), []);
    assert.equal(h.tree.tweens.size, 0);
    assert.equal(h.state.contexts, 1, 'no second attempt');
  }
});

// ─────────────────────────────────────────────────────────────── voices ────────────────────────

test('play: bus, volume, pitch — variance on the everyday sounds only', async () => {
  const seed = 4242;
  const rng = new RandomNumberGenerator();
  rng.seed = seed;
  const h = await running({ rng });
  const twin = new RandomNumberGenerator();
  twin.seed = seed;

  h.engine.play('ui_click');
  h.engine.play('check', 1.0, 6.0);
  h.engine.play('capture', 1.25, -6.0);
  h.engine.play('victory', 0.5);
  const [click, check, capture, victory] = h.of('start').map((command) => command[2]);
  const expectPitch = (base) => F(base * (1.0 + twin.randf_range(-PITCH_VARIANCE, PITCH_VARIANCE)));
  assert.deepEqual(click, { stream: 'ui_click', bus: SFX_BUS, volume: 1, pitchScale: expectPitch(1.0), from: 0 });
  assert.deepEqual(check, { stream: 'check', bus: SFX_BUS, volume: dbToLinearF(6), pitchScale: 1, from: 0 }, 'a signal keeps its pitch');
  assert.deepEqual(capture, { stream: 'capture', bus: SFX_BUS, volume: dbToLinearF(-6), pitchScale: expectPitch(1.25), from: 0 });
  assert.equal(victory.pitchScale, 0.5);
  assert.ok(Math.abs(click.pitchScale - 1) <= PITCH_VARIANCE && click.pitchScale !== 1);
  assert.deepEqual(h.of('start').map((command) => command[1]), [1, 2, 3, 4], 'every playback has its own handle');
});

test('play: the pitch is kept between 0.1 and 4', async () => {
  const h = await running();
  const pitches = [0.0001, 0.1, 4, 9, -1];
  pitches.forEach((pitch, index) => {
    h.at(index);
    h.engine.play('check', pitch);
  });
  assert.deepEqual(h.of('start').map((command) => command[2].pitchScale), [F(0.1), F(0.1), 4, 4, F(0.1)]);
});

test('retrigger guard: the same sound does not start twice within 30 ms', async () => {
  const h = await running();
  const tries = [[0, 'move'], [0.010, 'move'], [0.0299, 'move'], [0.030, 'move'], [0.031, 'land'], [0.059, 'move'], [0.0601, 'move']];
  for (const [seconds, sound] of tries) {
    h.at(seconds);
    h.engine.play(sound);
  }
  assert.deepEqual(h.of('start').map((command) => command[2].stream), ['move', 'move', 'land', 'move']);

  // Steps are guarded one by one, and apart from the plain sound.
  h.clear();
  h.at(5);
  h.engine.playStep('chain_step', 0);
  h.engine.playStep('chain_step', 1);
  h.engine.playStep('chain_step', 1);
  h.engine.play('chain_step');
  h.engine.play('chain_step');
  h.at(5.04);
  h.engine.playStep('chain_step', 1, -4.0);
  const steps = h.of('start').map((command) => command[2]);
  assert.deepEqual(steps.map((request) => request.pitchScale), [1, F(AudioEngine.stepPitch(1)), 1, F(AudioEngine.stepPitch(1))]);
  assert.equal(steps[3].volume, dbToLinearF(-4));
});

test('the guard reads the clock of the port when none is given', () => {
  const engine = new AudioEngine({ createBuilder: () => ({ start() {}, dispose() {} }) });
  const before = Math.round(performance.now() * 1000);
  const now = engine.clock();
  assert.ok(Number.isInteger(now) && now >= before && now - before < USEC, `${now} microseconds`);
  engine.dispose();
});

test('voices: round-robin while some are free, then the oldest is stolen', async () => {
  const h = await running();
  const voiceOf = (id) => h.engine.voiceOfPlayback.get(id);
  // Twelve different sounds in the same instant: the clock does not tell them apart.
  SOUND_NAMES.slice(0, 12).forEach((name) => h.engine.play(name));
  assert.deepEqual(h.of('start').map((command) => voiceOf(command[1])), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(h.engine.snapshot().voices, 12);

  // Voices 3 and 7 finish: they are the next two, in round-robin order from the last one taken.
  h.ended(4);
  h.ended(8);
  assert.equal(h.engine.snapshot().voices, 10);
  h.clear();
  h.at(1);
  h.engine.play(SOUND_NAMES[12]);
  h.engine.play(SOUND_NAMES[13]);
  assert.deepEqual(h.commands.map((command) => [command[0], voiceOf(command[1])]), [['start', 3], ['start', 7]]);

  // All busy: the one that started first gives way — stopped (it fades in the mixer), then replaced.
  h.clear();
  h.engine.play(SOUND_NAMES[14]);
  assert.deepEqual(h.commands.map((command) => command[0]), ['stop', 'start']);
  assert.equal(h.commands[0][1], 1, 'voice 0 held the oldest playback');
  assert.equal(voiceOf(h.commands[1][1]), 0);
  assert.equal(voiceOf(1), undefined);
  h.engine.play(SOUND_NAMES[15]);
  assert.deepEqual([h.commands[2][0], h.commands[2][1]], ['stop', 2], 'then voice 1');
  // Voices 3 and 7 were taken later than their neighbours: they are passed over.
  for (const name of SOUND_NAMES.slice(16, 20)) h.engine.play(name);
  assert.deepEqual(h.of('stop').map((command) => command[1]), [1, 2, 3, 5, 6, 7]);

  // The end of a stolen playback arrives late: it must not free the voice that was taken over.
  h.ended(1);
  assert.equal(h.engine.snapshot().voices, 12);
});

test('an unknown sound is reported once, and only when the build is over', async () => {
  const h = harness();
  h.buildEffects(SOUND_NAMES.slice(0, 5));
  await captureConsole(() => h.unlocked());
  const early = await captureConsole(() => h.engine.play('no_such_sound'));
  assert.deepEqual(early, [], 'it may simply not be built yet');
  h.buildEffects(SOUND_NAMES.slice(5));
  const late = await captureConsole(() => {
    h.engine.play('no_such_sound');
    h.engine.play('no_such_sound');
    h.engine.playStep('no_such_sound', 2);
    h.engine.play('music');
  });
  assert.deepEqual(late, [{ level: 'error', text: "Sfx: unknown sound 'no_such_sound'" }, { level: 'error', text: "Sfx: unknown sound 'music'" }]);
  assert.deepEqual(h.of('start'), []);
});

test('a sound is playable as soon as it is built', async () => {
  const h = harness();
  h.buildEffects(['ui_hover', 'ui_click']);
  await captureConsole(() => h.unlocked());
  h.engine.play('ui_click');
  h.engine.play('victory');
  assert.deepEqual(h.of('start').map((command) => command[2].stream), ['ui_click']);
});

// ─────────────────────────────────────────────────────────────── music ─────────────────────────

test('music: wanted first, played when it exists and sound is possible', async () => {
  const h = harness();
  h.buildEffects();
  h.engine.playMusic();
  assert.equal(h.engine.snapshot().musicWanted, true);
  await captureConsole(() => h.unlocked());
  assert.deepEqual(h.of('start'), [], 'not built yet');
  assert.equal(h.engine.musicState(), MusicState.SILENT);
  h.buildMusic();
  assert.equal(h.engine.isMusicReady(), true);
  const [start] = h.of('start');
  assert.deepEqual(start[2], { stream: 'music', bus: MUSIC_BUS, volume: gainToVolume(0, MIN_GAIN), pitchScale: 1, from: 0 });
  assert.equal(start[2].volume, dbToLinearF(-60), 'it starts at the floor, not at zero');
  assert.equal(h.engine.musicState(), MusicState.FADING_IN);
  assert.equal(h.tree.tweens.size, 1, 'the fade is a tween of the scene tree');

  // The other order: built, then unlocked.
  const other = harness();
  other.buildMusic();
  other.engine.playMusic();
  await captureConsole(() => other.unlocked());
  assert.equal(other.of('start').length, 1);
  assert.equal(other.of('stream').length, 1);
});

test('music: the fade-in is one volume per frame, linear over 2.5 s, floored at −60 dB', async () => {
  const h = await running();
  h.buildMusic();
  h.engine.playMusic();
  const id = h.of('start')[0][1];
  h.clear();

  const frames = Math.round(MUSIC_FADE_IN_SECONDS / FRAME);
  let elapsed = 0;
  for (let frame = 1; frame <= frames + 5; frame++) {
    h.frames(1);
    elapsed += FRAME;
    if (elapsed >= MUSIC_FADE_IN_SECONDS && h.commands.length < frame) break;
    const gain = elapsed >= MUSIC_FADE_IN_SECONDS ? 1 : linear(0, 1, elapsed, MUSIC_FADE_IN_SECONDS);
    assert.deepEqual(h.commands.at(-1), ['volume', id, gainToVolume(gain, MIN_GAIN)], `frame ${frame}`);
    assert.ok(Math.abs(h.engine.musicGain - gain) < 1e-12);
  }
  assert.equal(h.of('volume').length, h.commands.length, 'nothing but volumes');
  assert.ok(Math.abs(h.commands.length - frames) <= 1, `${h.commands.length} volumes for ${frames} frames`);
  assert.equal(h.commands[0][2], gainToVolume(FRAME / MUSIC_FADE_IN_SECONDS, MIN_GAIN), 'one frame in: over the floor already');
  assert.equal(h.commands.at(-1)[2], 1);
  assert.equal(h.engine.musicGain, 1);
  assert.equal(h.engine.musicState(), MusicState.PLAYING);
  assert.equal(h.tree.tweens.size, 0, 'the tween is over');

  // At full gain there is nothing to fade.
  h.clear();
  h.engine.playMusic();
  h.frames(10);
  assert.deepEqual(h.commands, []);
});

test('music: fades follow the time the scene tree simulates', async () => {
  const h = await running();
  h.buildMusic();
  h.engine.playMusic();
  // Half speed: a second of frames moves the fade by half a second.
  h.frames(60, 0.5);
  assert.ok(Math.abs(h.engine.musicGain - 0.5 / MUSIC_FADE_IN_SECONDS) < 1e-9, `${h.engine.musicGain}`);
  // Time stands still: so does the fade.
  const held = h.engine.musicGain;
  h.frames(60, 0);
  assert.equal(h.engine.musicGain, held);
  // A long frame is a long step.
  h.frames(1, 1, 0.1);
  assert.ok(Math.abs(h.engine.musicGain - 0.6 / MUSIC_FADE_IN_SECONDS) < 1e-9);
});

test('music: fades start from where the gain is', async () => {
  const h = await running();
  h.buildMusic();
  h.engine.playMusic();
  const id = h.of('start')[0][1];
  h.frames(60);
  assert.ok(Math.abs(h.engine.musicGain - 0.4) < 1e-9);

  // Wanted again while fading in: the rest of the way takes the rest of the time.
  h.engine.playMusic();
  assert.equal(h.of('start').length, 1, 'it is playing already');
  assert.equal(h.tree.tweens.size, 1, 'the old tween is gone');
  h.frames(45);
  assert.ok(Math.abs(h.engine.musicGain - 0.7) < 1e-9, `${h.engine.musicGain}`);

  // Out, one second from wherever it is.
  h.engine.stopMusic();
  assert.equal(h.engine.snapshot().musicWanted, false);
  assert.equal(h.engine.musicState(), MusicState.FADING_OUT);
  h.frames(30);
  assert.ok(Math.abs(h.engine.musicGain - 0.35) < 1e-9, `${h.engine.musicGain}`);
  assert.deepEqual(h.of('stop'), []);

  // Wanted again half-way out: back in, and the stop that waited at the end of the fade-out is off.
  h.engine.playMusic();
  assert.equal(h.engine.musicState(), MusicState.FADING_IN);
  h.frames(Math.round((MUSIC_FADE_IN_SECONDS * 0.65) / FRAME) + 2);
  assert.equal(h.engine.musicGain, 1);
  assert.deepEqual([h.of('stop'), h.of('start').length], [[], 1]);

  // Out to the end: the last volume is the floor, then the player stops.
  h.clear();
  h.engine.stopMusic(0.5);
  h.frames(40);
  assert.deepEqual(h.commands.at(-1), ['stop', id]);
  assert.deepEqual(h.commands.at(-2), ['volume', id, gainToVolume(0, MIN_GAIN)]);
  assert.equal(h.of('stop').length, 1);
  assert.deepEqual([h.engine.musicState(), h.engine.musicGain, h.engine.musicPlayback], [MusicState.SILENT, 0, 0]);
  assert.equal(h.tree.tweens.size, 0);
  // The mixer reports the end of the stopped playback a moment later: nothing changes.
  h.ended(id);
  assert.equal(h.engine.musicState(), MusicState.SILENT);
});

test('music: stopping at once, stopping what does not play, playing again', async () => {
  const h = await running();
  h.buildMusic();
  h.engine.stopMusic();
  h.frames(10);
  assert.deepEqual(h.commands.filter((command) => command[0] !== 'stream'), [], 'nothing plays');

  h.engine.playMusic();
  const first = h.of('start')[0][1];
  h.frames(60);
  h.clear();
  h.engine.stopMusic(0);
  assert.deepEqual(h.commands, [['stop', first]]);
  assert.deepEqual([h.engine.musicState(), h.engine.musicGain], [MusicState.SILENT, 0]);
  h.frames(10);
  assert.deepEqual(h.commands, [['stop', first]], 'no tween is left behind');

  // A new playback while the old one still fades in the mixer; the old one's end changes nothing.
  h.clear();
  h.engine.playMusic();
  const second = h.of('start')[0][1];
  assert.notEqual(second, first);
  assert.equal(h.of('start')[0][2].volume, gainToVolume(0, MIN_GAIN), 'from silence again');
  h.ended(first);
  assert.equal(h.engine.musicState(), MusicState.FADING_IN);
  assert.equal(MUSIC_FADE_OUT_SECONDS, 1);
});

test('music: while the context is suspended nothing starts; it comes in when sound is back', async () => {
  const h = harness({ context: new FakeContext({ state: 'suspended', resumes: false }) });
  h.buildMusic();
  await captureConsole(() => h.unlocked());
  assert.equal(h.engine.state, EngineState.SUSPENDED);
  h.engine.playMusic();
  h.frames(30);
  assert.deepEqual(h.of('start'), []);
  h.context.setState('running');
  assert.equal(h.of('start').length, 1);
  assert.equal(h.engine.musicGain, 0, 'the frames that passed in silence did not use up the fade');
});

test('music: without a scene tree a fade is refused loudly', async () => {
  const h = await running({ options: { tree: null } });
  const current = SceneTree.current;
  SceneTree.current = null;
  try {
    h.buildMusic();
    assert.throws(() => h.engine.playMusic(), /need a scene tree/);
    // The default is the current tree, looked up when the fade starts.
    const tree = new SceneTree();
    h.engine.stopMusic(0);
    h.engine.playMusic();
    assert.equal(tree.tweens.size, 1);
  } finally {
    SceneTree.current = current;
  }
});

// ─────────────────────────────────────────────────────────────── buses ─────────────────────────

test("bus volumes: the original's decibels, mute at zero, read back as set", async () => {
  const h = await running();
  const rows = mixOracle().cases.flatMap((entry) => entry.events).filter((row) => row.event[1] === 'bus');
  assert.ok(rows.length >= 4);
  for (const row of rows) {
    const [, , bus, value] = row.event;
    h.clear();
    h.engine.setBusVolume(bus, value);
    assert.deepEqual(h.commands, [['bus', bus, { volumeDb: row.volume_db, mute: row.mute }]], `${bus} at ${value}`);
    assert.equal(h.engine.getBusVolume(bus), row.read_back);
  }
  h.engine.setBusVolume(SFX_BUS, 7);
  assert.equal(h.engine.getBusVolume(SFX_BUS), 1);
  h.engine.setBusVolume(SFX_BUS, -3);
  assert.deepEqual(h.commands.at(-1), ['bus', SFX_BUS, { volumeDb: -60, mute: true }]);
  assert.equal(h.engine.getBusVolume(SFX_BUS), 0);
  h.engine.setBusVolume(SFX_BUS, 1e-9);
  assert.deepEqual(h.commands.at(-1)[2], { volumeDb: -60, mute: false }, 'audible at the floor');

  h.clear();
  const lines = await captureConsole(() => h.engine.setBusVolume('Voice', 0.5));
  assert.deepEqual(lines, [{ level: 'warn', text: "Sfx: unknown audio bus 'Voice'" }]);
  assert.deepEqual(h.commands, []);
  assert.equal(h.engine.getBusVolume('Voice'), 0);
});

test('Sfx: what is set before an engine exists reaches the engine', async () => {
  const { Sfx } = await import('../../src/autoload/sfx.js');
  assert.equal(Sfx.engine, null);
  assert.deepEqual([Sfx.is_ready(), Sfx.is_music_ready()], [false, false]);
  Sfx.play('ui_click');
  Sfx.play_step('chain_step', 2);
  Sfx.stop_music();
  assert.equal(Sfx.get_bus_volume('Master'), 1, 'a bus nobody has set is at full volume');
  Sfx.set_bus_volume('Master', 0.8);
  Sfx.set_bus_volume('Music', 0.55);
  Sfx.set_bus_volume('SFX', 0.85);
  assert.deepEqual([Sfx.get_bus_volume('Music'), Sfx.get_bus_volume('SFX')], [0.55, 0.85]);
  const lines = await captureConsole(() => Sfx.set_bus_volume('Voice', 1));
  assert.deepEqual(lines, [{ level: 'warn', text: "Sfx: unknown audio bus 'Voice'" }]);
  assert.equal(Sfx.get_bus_volume('Voice'), 0);
  Sfx.play_music();

  const h = harness();
  h.buildEffects();
  h.buildMusic();
  try {
    Sfx.attach(h.engine);
    const names = [MASTER_BUS, MUSIC_BUS, SFX_BUS];
    assert.deepEqual(names.map((bus) => Sfx.get_bus_volume(bus)), names.map((bus) => h.engine.getBusVolume(bus)));
    assert.ok(Math.abs(Sfx.get_bus_volume('Music') - 0.55) < 1e-7);
    assert.deepEqual([Sfx.is_ready(), Sfx.is_music_ready()], [true, true]);
    await captureConsole(() => h.unlocked());
    assert.equal(h.of('start')[0][2].stream, 'music', 'the music was wanted');
    h.clear();
    h.at(3);
    Sfx.play('check', 1.5, -2);
    Sfx.play_step('chain_step', 4, -1);
    Sfx.stop_music(0);
    assert.deepEqual(h.commands.map((command) => command[0]), ['start', 'start', 'stop']);
    assert.deepEqual(h.commands[0][2], { stream: 'check', bus: SFX_BUS, volume: dbToLinearF(-2), pitchScale: 1.5, from: 0 });
    assert.deepEqual([h.commands[1][2].pitchScale, h.commands[1][2].volume], [F(AudioEngine.stepPitch(4)), dbToLinearF(-1)]);
  } finally {
    // The autoload is one object for the whole process: leave it as it was found.
    Sfx.engine = null;
    Sfx._musicWanted = false;
  }
});

// ─────────────────────────────────────────────────────────────── the page ──────────────────────

/** A window with a document: only what followPage touches. */
function fakePage(visibility = 'visible') {
  const target = () => {
    const listeners = new Map();
    return {
      listeners,
      addEventListener: (type, listener, options) => listeners.set(type, { listener, options }),
      removeEventListener: (type, listener) => {
        if (listeners.get(type)?.listener === listener) listeners.delete(type);
      },
      fire: (type) => listeners.get(type)?.listener({ type }),
    };
  };
  const page = target();
  page.document = Object.assign(target(), { visibilityState: visibility });
  return page;
}

test("followPage: a gesture unlocks, the page's visibility suspends and resumes", async () => {
  const h = harness({ context: new FakeContext({ state: 'suspended' }) });
  h.buildEffects();
  const page = fakePage();
  h.engine.followPage(page);
  assert.deepEqual([...page.listeners.keys()], ['pointerdown', 'pointerup', 'mousedown', 'touchend', 'keydown', 'click']);
  for (const { options } of page.listeners.values()) assert.deepEqual(options, { capture: true, passive: true });
  assert.deepEqual([...page.document.listeners.keys()], ['visibilitychange']);

  await captureConsole(async () => {
    page.fire('pointerdown');
    page.fire('click');
    await settle();
  });
  assert.equal(h.state.contexts, 1);
  assert.equal(h.engine.state, EngineState.RUNNING);

  page.document.visibilityState = 'hidden';
  page.document.fire('visibilitychange');
  await settle();
  assert.equal(h.engine.state, EngineState.SUSPENDED);
  h.engine.play('ui_click');
  page.fire('keydown');
  await settle();
  assert.equal(h.engine.state, EngineState.SUSPENDED, 'a key pressed on a hidden page wakes nothing');
  assert.deepEqual([h.of('start'), h.engine.pending], [[], []], 'and nothing is kept for later');

  page.document.visibilityState = 'visible';
  page.document.fire('visibilitychange');
  await settle();
  assert.equal(h.engine.state, EngineState.RUNNING);
  assert.deepEqual(h.context.calls, ['resume', 'suspend', 'resume']);

  // Suspended by the browser, not by the page: the next gesture wakes it.
  h.context.setState('suspended');
  assert.equal(h.engine.state, EngineState.SUSPENDED);
  page.fire('touchend');
  await settle();
  assert.equal(h.engine.state, EngineState.RUNNING);

  h.engine.unfollow();
  assert.deepEqual([page.listeners.size, page.document.listeners.size], [0, 0]);
});

test('followPage: the mixer is fetched before any gesture', async () => {
  const warmed = [];
  const h = harness();
  h.engine.createBackend.warmUp = (page, preference) => warmed.push([page, preference]);
  const page = fakePage();
  h.engine.followPage(page);
  assert.deepEqual(warmed, [[page, Backend.AUTO]]);
  assert.equal(h.state.contexts, 0, 'fetched, not started');
});

test('followPage on a page that is hidden from the start; an engine that keeps playing when hidden', async () => {
  const h = harness({ context: new FakeContext({ state: 'suspended' }) });
  const page = fakePage('hidden');
  h.engine.followPage(page);
  assert.equal(h.engine.hidden, true);

  const loud = harness({ options: { suspendWhenHidden: false, backend: Backend.NATIVE } });
  await captureConsole(() => loud.unlocked());
  assert.equal(loud.state.preference, Backend.NATIVE);
  loud.engine.setHidden(true);
  await settle();
  assert.deepEqual(loud.context.calls, []);
  assert.equal(loud.engine.state, EngineState.RUNNING);
});

test('dispose: builder, backend, context, tween and listeners are let go, once', async () => {
  const h = await running();
  h.buildMusic();
  h.engine.playMusic();
  assert.equal(h.tree.tweens.size, 1);
  const page = fakePage();
  h.engine.followPage(page);
  h.clear();
  h.engine.dispose();
  h.engine.dispose();
  await settle();
  assert.deepEqual([h.state.builderDisposed, h.state.backendDisposed, h.context.state, page.listeners.size, h.tree.tweens.size], [true, true, 'closed', 0, 0]);
  assert.equal(h.engine.state, EngineState.DISPOSED);
  h.engine.play('ui_click');
  h.state.builder.onStream(tinyStream('late'));
  h.frames(10);
  await h.engine.unlock();
  assert.deepEqual(h.commands, []);
  assert.equal(h.engine.effects.has('late'), false);

  // Disposed while the backend was still being built: the backend is disposed on arrival.
  const early = harness();
  const coming = early.engine.unlock();
  early.engine.dispose();
  await coming;
  assert.equal(early.state.backendDisposed, true);
});

// ─────────────────────────────────────────────────────────────── the whole way ─────────────────

const report = [];
after(() => reportCard('audio · Sfx → engine → port → mixer vs the original', report, 'asked for the way the game asks'));

/** Cases made of nothing but Sfx.play and Sfx.set_bus_volume. */
const PLAYABLE = ['check', 'coin_pitched', 'hover_until_quiet', 'capture_burst', 'sfx_volume', 'pitch_extremes', 'late_start', 'steal', 'sfx_asleep_restart', 'all_asleep_restart', 'bus_mute'];

/** An engine on the real worklet backend, whose port leads straight into a real mixer host. */
async function wholeWay(entry) {
  const context = new FakeContext({ state: 'running', sampleRate: entry.mix_rate });
  let host = null;
  let usec = 0;
  let builder = null;
  const engine = new AudioEngine({
    tree: new SceneTree(),
    createContext: () => context,
    createBackend: (ctx, listeners) =>
      createWorkletBackend(ctx, {
        moduleUrl: 'worklet.js',
        ...listeners,
        createNode: (owner, name, options) => {
          const node = new FakeWorkletNode(owner, name, options);
          host = new MixerHost(owner.sampleRate, (message) => node.port.receive(message));
          node.port.deliver = (message) => host.handle(message);
          return node;
        },
      }),
    createBuilder: (listeners) => {
      builder = listeners;
      return { start() {}, dispose() {} };
    },
    clock: () => usec,
    rng: noVariance,
  });
  for (const stream of originalStreams()) builder.onStream(stream);
  await captureConsole(async () => {
    await engine.unlock();
    await settle();
  });
  assert.equal(engine.state, EngineState.RUNNING);
  engine.nextVoice = entry.next_voice;
  return { engine, host, context, setClock: (value) => (usec = value) };
}

for (const id of PLAYABLE) {
  test(`the whole way, case "${id}"`, async () => {
    const entry = mixOracle().cases.find((row) => row.id === id);
    const { engine, host, context, setClock } = await wholeWay(entry);
    assert.deepEqual(context.modules, ['worklet.js']);
    const voices = [];
    let frames = null;
    const lines = await captureConsole(() => {
      frames = replayCase(entry, {
        mixer: host.mixer,
        // The mixer plays what the engine has sent it through the port.
        streams: false,
        apply: (row) => {
          setClock((row.at / entry.mix_rate) * USEC);
          const [, kind, first, second, third] = row.event;
          if (kind === 'bus') engine.setBusVolume(first, second);
          else {
            engine.play(first, second, third);
            voices.push([first, engine.voiceOfPlayback.get(engine.serial), row.voice]);
          }
        },
      });
    });
    assert.deepEqual(lines, [], 'nothing to report');
    for (const [sound, own, original] of voices) assert.equal(own, original, `${sound}: the voice the original picked`);
    const result = compareFloat32(frames, mixOracle().frames(entry));
    report.push({ name: id, ...result, note: `${entry.events.length} events` });
    assert.equal(result.differing, 0, `${count(result.differing)} samples differ (first at frame ${result.first >> 1})`);
    engine.dispose();
  });
}

test("the whole way: the backend is the worklet, its node is the mixer's", async () => {
  const entry = mixOracle().cases[0];
  const { engine, context } = await wholeWay(entry);
  const node = context.nodes.find((candidate) => candidate.kind === 'worklet');
  assert.equal(engine.snapshot().backend, Backend.WORKLET);
  assert.equal(node.name, PROCESSOR_NAME);
  assert.deepEqual(node.options, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  assert.ok(node.reachesDestination());
  assert.equal(node.port.sent.filter((message) => message.type === 'stream').length, 25);
  engine.dispose();
  assert.ok(node.port.closed && !node.reachesDestination());
});

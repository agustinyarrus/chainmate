/**
 * Mixer — src/audio/mixer.js against the original's audio server (_oracle/probe_audio_mix.gd →
 * _oracle/audio_mix.json): sixteen scripted cases, each a list of events with the exact frame they
 * took effect at, and the frames captured at the end of the original's Master bus. The port's frames
 * must be the same float32 values: resampler, mix steps, fades, reverbs, bus volumes, limiter, sleep.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { audioOracle, compareFloat32, reportCard, count } from './support.mjs';
import { mixOracle, replayCase, addOriginalStreams, tapMaster, SFX_BUS, MUSIC_BUS } from './mix_support.mjs';
import { Mixer, Stream, Reverb, HardLimiter, GAME_BUSES, BLOCK_FRAMES, LOOKAHEAD_FRAMES } from '../../src/audio/mixer.js';
import { dbToLinear, dbToLinearF, linearToDb, gainToVolume } from '../../src/audio/decibels.js';

const F = Math.fround;
const { cases } = mixOracle();
const { one } = audioOracle();
const MIX_RATE = 44100;
const DRIVER_STEPS = 1 << 20;

const report = [];
after(() => reportCard('audio · mixer vs the original\'s Master bus', report, 'frames tapped after the limiter, stereo'));

test('the oracle holds the sixteen cases', () => {
  assert.deepEqual(cases.map((entry) => entry.id), [
    'check', 'coin_pitched', 'hover_until_quiet', 'capture_burst', 'sfx_volume', 'pitch_extremes', 'late_start', 'stop_fade',
    'steal', 'sfx_asleep_restart', 'all_asleep_restart', 'bus_mute', 'music', 'music_seam', 'music_gain', 'music_and_sfx',
  ]);
  for (const entry of cases) {
    assert.equal(entry.complete, true, `${entry.id}: every event was placed`);
    assert.equal(entry.mix_rate, MIX_RATE);
    for (const row of entry.events) assert.equal(row.at % BLOCK_FRAMES, 0, `${entry.id}: events sit on mix steps`);
  }
});

for (const entry of cases) {
  test(`case "${entry.id}": ${entry.events.length} event${entry.events.length === 1 ? '' : 's'}, ${(entry.frames / entry.mix_rate).toFixed(2)} s`, () => {
    const expected = mixOracle().frames(entry);
    assert.equal(expected.length, entry.frames * 2);
    const result = compareFloat32(replayCase(entry), expected);
    let peak = 0;
    for (const value of expected) peak = Math.max(peak, Math.abs(value));
    report.push({ name: entry.id, ...result, note: `${entry.events.length} events · peak ${peak.toFixed(3)}` });
    assert.equal(result.differing, 0, `${count(result.differing)} of ${count(result.length)} samples differ (largest ${result.largest}, first at frame ${result.first >> 1})`);
  });
}

test('the cases exercise what they are meant to', () => {
  const peakOf = (id) => mixOracle().frames(cases.find((entry) => entry.id === id)).reduce((top, value) => Math.max(top, Math.abs(value)), 0);
  // The limiter holds the burst at its ceiling; a muted bus gives silence.
  assert.ok(Math.abs(peakOf('capture_burst') - dbToLinearF(-0.5)) < 1e-3);
  assert.equal(peakOf('bus_mute'), 0);
  // A sleeping bus is restarted: the second event comes long after the first.
  for (const id of ['sfx_asleep_restart', 'all_asleep_restart']) assert.ok(cases.find((entry) => entry.id === id).events[1].at > 2 * MIX_RATE, id);
  // All twelve voices taken, then two more sounds: the first two voices are stolen.
  const steal = cases.find((entry) => entry.id === 'steal').events;
  assert.deepEqual(steal.slice(0, 12).map((row) => row.voice).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual([steal[12].voice, steal[13].voice], [steal[0].voice, steal[1].voice]);
});

test('bus layout and effect settings are the original\'s', () => {
  const buses = one('buses');
  assert.equal(buses.mix_rate, MIX_RATE);
  assert.equal(buses.playback_speed_scale, 1);
  assert.deepEqual(buses.rows.map((row) => [row.name, row.send || null]), GAME_BUSES.map((bus) => [bus.name, bus.send]));
  const PROPERTIES = {
    AudioEffectReverb: { room_size: 'roomSize', damping: 'damping', spread: 'spread', hipass: 'hipass', predelay_msec: 'predelayMsec', predelay_feedback: 'predelayFeedback', dry: 'dry', wet: 'wet' },
    AudioEffectHardLimiter: { ceiling_db: 'ceilingDb', pre_gain_db: 'preGainDb', release: 'release' },
  };
  const CLASS_OF = { reverb: 'AudioEffectReverb', limiter: 'AudioEffectHardLimiter' };
  buses.rows.forEach((row, index) => {
    assert.deepEqual([row.volume_db, row.mute, row.solo, row.bypass, row.channels], [0, false, false, false, 1], row.name);
    const layout = GAME_BUSES[index].effects;
    assert.deepEqual(row.effects.map((effect) => effect.class), layout.map((settings) => CLASS_OF[settings.type]));
    row.effects.forEach((effect, at) => {
      assert.equal(effect.enabled, true);
      const names = PROPERTIES[effect.class];
      assert.deepEqual(Object.keys(effect.values).sort(), Object.keys(names).sort(), `${row.name}: properties of ${effect.class}`);
      // The engine stores properties in single precision.
      for (const [property, key] of Object.entries(names)) assert.equal(F(layout[at][key]), effect.values[property], `${row.name}.${property}`);
    });
  });
});

test('decibels: the conversions of the original', () => {
  for (const [linear, db] of one('sfx').db) assert.equal(linearToDb(linear), db, `linear_to_db(${linear})`);
  for (const entry of cases) {
    for (const row of entry.events.filter((event) => event.event[1] === 'bus')) {
      const value = Math.min(Math.max(row.event[3], 0), 1);
      assert.equal(F(linearToDb(Math.max(value, 0.001))), row.volume_db, `volume_db of ${row.event[3]}`);
      assert.equal(row.mute, value <= 0);
      assert.equal(row.mute ? 0 : Math.min(Math.max(dbToLinear(row.volume_db), 0), 1), row.read_back, `get_bus_volume of ${row.event[3]}`);
    }
  }
  assert.equal(dbToLinearF(0), 1);
  // Single precision all the way: −60 dB is a hair under a thousandth.
  assert.equal(dbToLinearF(-60), F(Math.exp(F(-60 * F(0.11512925464970228)))));
  assert.ok(Math.abs(dbToLinearF(-60) - 0.001) < 1e-9);
  assert.equal(gainToVolume(1, 0.001), 1);
  assert.equal(gainToVolume(0, 0.001), gainToVolume(0.001, 0.001), 'a gain under the floor plays at the floor');
  assert.ok(Math.abs(gainToVolume(0.5, 0.001) - 0.5) < 1e-7);
});

test('the driver gets 21-bit samples, whatever the size of the requests', () => {
  const entry = cases.find((row) => row.id === 'capture_burst');
  const frames = 40 * BLOCK_FRAMES;
  const build = () => {
    const mixer = new Mixer({ mixRate: MIX_RATE });
    addOriginalStreams(mixer);
    mixer.setBus('Master', { volumeDb: F(linearToDb(0.8)), mute: false });
    entry.events.forEach((row, id) => mixer.start(id + 1, { stream: row.event[2], bus: SFX_BUS, volume: dbToLinearF(row.volume_db), pitchScale: row.pitch_scale }));
    return mixer;
  };

  // One request for everything, with a tap to know what the Master bus held.
  const whole = build();
  const tap = tapMaster(whole, frames);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  whole.render(left, right);
  const volume = dbToLinearF(F(linearToDb(0.8)));
  for (let i = 0; i < frames; i++) {
    for (const [channel, out] of [[0, left], [1, right]]) {
      const value = F(tap.frames[2 * i + channel] * volume);
      const clamped = Math.min(Math.max(value, -1), 1);
      assert.equal(out[i], Math.trunc(F(clamped * (DRIVER_STEPS - 1))) / DRIVER_STEPS, `frame ${i}`);
    }
  }

  // The same in the browser's quanta of 128 frames, and in awkward sizes.
  for (const quantum of [128, 1, 333, 512, 1000]) {
    const mixer = build();
    const l = new Float32Array(frames);
    const r = new Float32Array(frames);
    for (let at = 0; at < frames; at += quantum) {
      const size = Math.min(quantum, frames - at);
      mixer.render(l.subarray(at, at + size), r.subarray(at, at + size), size);
    }
    assert.equal(compareFloat32(l, left).differing + compareFloat32(r, right).differing, 0, `requests of ${quantum} frames`);
  }
});

test('a mixer with nothing to play is silent and asleep', () => {
  const mixer = new Mixer();
  const left = new Float32Array(2048).fill(1);
  const right = new Float32Array(2048).fill(1);
  mixer.render(left, right);
  assert.ok(left.every((value) => value === 0) && right.every((value) => value === 0));
  assert.deepEqual(mixer.buses.map((bus) => bus.active), [false, false, false]);
});

test('buses fall asleep two seconds after the last audible block, and wake on the next sound', () => {
  const mixer = new Mixer();
  addOriginalStreams(mixer);
  const [master, music, sfx] = mixer.buses;
  mixer.start(1, { stream: 'ui_hover', bus: SFX_BUS, volume: 1 });
  let steps = 0;
  let lastSend = 0;
  while (master.active || steps === 0) {
    mixer.mixStep();
    steps += 1;
    if (sfx.active) lastSend = steps;
    assert.ok(steps < 2000, 'the buses never slept');
  }
  assert.equal(music.active, false, 'the music bus was never used');
  assert.ok(lastSend > Math.ceil((2 * MIX_RATE) / BLOCK_FRAMES), 'the reverb tail kept the bus awake, then two seconds more');
  // Master sleeps with the first step that lies more than the disable time after the last send.
  assert.equal(steps - lastSend, Math.floor((2 * MIX_RATE) / BLOCK_FRAMES) + 1);
  mixer.start(2, { stream: 'ui_click', bus: SFX_BUS, volume: 1 });
  mixer.mixStep();
  assert.deepEqual([master.active, sfx.active], [true, true]);
});

test('playbacks: ends are reported once, handles are recycled, mistakes are refused', () => {
  const ended = [];
  const mixer = new Mixer({ onEnded: (id) => ended.push(id) });
  addOriginalStreams(mixer);
  assert.throws(() => mixer.start(1, { stream: 'nothing', bus: SFX_BUS, volume: 1 }), /unknown stream/);
  mixer.start(1, { stream: 'ui_hover', bus: SFX_BUS, volume: 1 });
  assert.throws(() => mixer.start(1, { stream: 'ui_click', bus: SFX_BUS, volume: 1 }), /already live/);
  assert.equal(mixer.isPlaying(1), true);
  // 971 samples at 44 100 Hz: over within three steps.
  for (let i = 0; i < 3; i++) mixer.mixStep();
  assert.deepEqual(ended, [1]);
  assert.equal(mixer.isPlaying(1), false);
  // What is over can be stopped and set without harm.
  mixer.stop(1);
  mixer.setVolume(1, 0.5);
  assert.equal(mixer.setBus('Nowhere', { volumeDb: 0 }), false);

  // A stopped playback takes one more step (its fade) and is reported then.
  mixer.start(2, { stream: 'victory', bus: SFX_BUS, volume: 1 });
  mixer.mixStep();
  mixer.stop(2);
  assert.equal(mixer.isPlaying(2), false);
  mixer.mixStep();
  assert.deepEqual(ended, [1, 2]);

  // Hundreds of sounds, never more than twelve at once: the pool stays that small.
  let id = 100;
  for (let step = 0; step < 400; step++) {
    if (mixer.playbacks.length < 12) mixer.start(id++, { stream: 'ui_click', bus: SFX_BUS, volume: 0.5, pitchScale: 1 + (step % 7) * 0.1 });
    mixer.mixStep();
  }
  assert.ok(id > 200, `${id - 100} sounds played`);
  assert.ok(mixer.playbacks.length + mixer.pool.length <= 12, `${mixer.playbacks.length + mixer.pool.length} playbacks exist`);
  assert.equal(new Set(ended).size, ended.length, 'no end reported twice');
});

test('a volume is reached by a ramp over the next step, from the volume of the step before', () => {
  // A stream of constant level makes the volume visible: what the SFX bus holds is level × volume.
  const LEVEL = 16384;
  const mixer = new Mixer();
  mixer.addStream('level', new Stream({ pcm: new Int16Array(44100).fill(LEVEL), rate: MIX_RATE }));
  const sfx = mixer.buses[2];
  // Without its reverb the bus holds the mixed playbacks and nothing else.
  sfx.effects.length = 0;
  const level = F(LEVEL / 32767);
  const expectRamp = (from, to, label) => {
    const held = sfx.buffer;
    for (const i of [0, 1, 255, 256, 511]) {
      const weight = i / BLOCK_FRAMES;
      const volume = F(F(to * F(weight)) + F(F(1 - weight) * from));
      assert.equal(held[2 * i], F(volume * level), `${label}, frame ${i}`);
      assert.equal(held[2 * i + 1], held[2 * i], 'both channels');
    }
  };
  mixer.start(1, { stream: 'level', bus: SFX_BUS, volume: 0.25 });
  // The resampler's history starts empty: the level is reached after two frames. Skip the first step.
  mixer.mixStep();
  mixer.mixStep();
  expectRamp(F(0.25), F(0.25), 'steady');
  mixer.setVolume(1, 1);
  mixer.mixStep();
  expectRamp(F(0.25), 1, 'up');
  mixer.mixStep();
  expectRamp(1, 1, 'arrived');
  // Two changes between steps: only the last one counts.
  mixer.setVolume(1, 0.9);
  mixer.setVolume(1, gainToVolume(0.5, 0.001));
  mixer.mixStep();
  expectRamp(1, gainToVolume(0.5, 0.001), 'down');
  mixer.stop(1);
  mixer.mixStep();
  expectRamp(gainToVolume(0.5, 0.001), 0, 'stopped: out over one step');
  assert.equal(mixer.playbacks.length, 0);
});

test('streams: what is not 16-bit PCM is refused; an empty one ends at once', () => {
  assert.throws(() => new Stream({ pcm: new Float32Array(4), rate: 44100 }), TypeError);
  assert.throws(() => new Stream({ pcm: new Int16Array(4), rate: 0 }), RangeError);
  const stereo = new Stream({ pcm: new Int16Array(10), rate: 22050, stereo: true });
  assert.deepEqual([stereo.frames, stereo.length], [5, 5 / 22050]);

  const ended = [];
  const mixer = new Mixer({ onEnded: (id) => ended.push(id) });
  mixer.addStream('empty', new Stream({ pcm: new Int16Array(0), rate: 44100 }));
  mixer.addStream('one', new Stream({ pcm: Int16Array.of(32767), rate: 44100 }));
  mixer.start(1, { stream: 'empty', bus: SFX_BUS, volume: 1 });
  mixer.start(2, { stream: 'one', bus: SFX_BUS, volume: 1 });
  const tap = tapMaster(mixer, BLOCK_FRAMES);
  mixer.mixStep();
  assert.deepEqual(ended.sort(), [1, 2]);
  assert.ok(tap.frames.every((value) => Number.isFinite(value) && Math.abs(value) <= 1));
});

test('effects at another mix rate keep their proportions', () => {
  for (const rate of [22050, 48000, 96000]) {
    const limiter = new HardLimiter({ ceilingDb: -0.5, preGainDb: 0, release: 0.12 }, rate);
    assert.equal(limiter.delayFrames, Math.ceil(F(rate * F(0.002))) + 1);
    assert.equal(limiter.buckets.length, Math.ceil(limiter.gainFramesStored / limiter.bucketFrames));
    const reverb = new Reverb(GAME_BUSES[2].effects[0], rate);
    assert.equal(reverb.channels[0].echo.length, Math.trunc(0.5 * rate + 1));
    assert.ok(reverb.channels[1].combs[0].buffer.length > reverb.channels[0].combs[0].buffer.length, 'the right channel is spread');
    // Over full scale in, the ceiling out — from the first frame, thanks to the look-ahead. (The gain
    // closes in through single-precision steps: a few millionths over is the original's behaviour.)
    const loud = new Float32Array(BLOCK_FRAMES * 2).fill(1.5);
    const out = new Float32Array(BLOCK_FRAMES * 2);
    let top = 0;
    for (let i = 0; i < 8; i++) {
      limiter.process(loud, out, BLOCK_FRAMES);
      top = out.reduce((most, value) => Math.max(most, value), top);
    }
    assert.ok(Math.abs(top - dbToLinearF(-0.5)) < 1e-5, `limited at ${rate} Hz: ${top}`);
  }
  assert.equal(LOOKAHEAD_FRAMES, 64);
});

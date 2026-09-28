/**
 * Synthesis — src/audio/synth.js against what the original's own code produced
 * (_oracle/probe_audio.gd → _oracle/audio.json): the seeds, the noise table, the wavetables, the cached
 * instruments, the 24 effects and the music loop, as float32 samples and as the 16-bit PCM the engine
 * plays. Every comparison reports how many samples differ and by how much; none may.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { audioOracle, compareFloat32, comparePcm16, asFloat32, asInt16, reportCard } from './support.mjs';
import {
  AudioSynth, SOUND_NAMES, BUILD_COST, BUILD_ORDER, MUSIC_NAME, SFX_RATE, MUSIC_RATE, MUSIC_GUARD, buildEffects, buildMusic,
} from '../../src/audio/synth.js';
import { hashString } from '../../src/godot/rng.js';

const { blob, one, all } = audioOracle();

/** One prepared synthesiser for the whole file, like the original's build. */
const base = new AudioSynth();
base.prepare();
const synth = new AudioSynth(base);

const report = [];
after(() => reportCard('audio · synthesis vs the original', report));

test('seeds: hash(name) of every sound and of the music', () => {
  const rows = one('hash').rows;
  assert.deepEqual(Object.keys(rows), [...SOUND_NAMES, MUSIC_NAME]);
  for (const [name, expected] of Object.entries(rows)) assert.equal(hashString(name), expected, name);
});

test('noise table: 65536 draws of the seeded generator', () => {
  const entry = one('noise');
  const result = compareFloat32(base._noise_table, asFloat32(blob(entry.f32)));
  report.push({ name: 'noise table', ...result });
  assert.equal(result.differing, 0);
});

for (const entry of all('table')) {
  test(`wavetable "${entry.name}"`, () => {
    const result = compareFloat32(base._table(entry.name), asFloat32(blob(entry.f32)));
    report.push({ name: `table ${entry.name}`, ...result });
    assert.equal(result.length, entry.samples);
    assert.equal(result.differing, 0, `${result.differing} samples differ (largest ${result.largest})`);
  });
}

for (const entry of all('template')) {
  test(`instrument "${entry.name}"`, () => {
    const layer = base._templates.get(entry.name);
    assert.equal(layer.rate, entry.rate);
    const result = compareFloat32(layer.data, asFloat32(blob(entry.f32)));
    report.push({ name: `instrument ${entry.name}`, ...result });
    assert.equal(result.length, entry.samples);
    assert.equal(result.differing, 0, `${result.differing} samples differ (largest ${result.largest})`);
  });
}

test('the oracle covers every sound', () => {
  assert.deepEqual(all('sound').map((entry) => entry.name), [...SOUND_NAMES]);
});

for (const entry of all('sound')) {
  test(`sound "${entry.name}"`, () => {
    const samples = synth.render(entry.name);
    assert.equal(samples.length, entry.samples, 'sample count');
    assert.equal(entry.rate, SFX_RATE);
    const float = compareFloat32(samples, asFloat32(blob(entry.f32)));
    // The stream the engine keeps: 16-bit, mono, no loop.
    assert.deepEqual([entry.wav.format, entry.wav.mix_rate, entry.wav.stereo, entry.wav.loop_mode], [1, SFX_RATE, false, 0]);
    const pcm = comparePcm16(AudioSynth.toPcm16(samples), asInt16(blob(entry.wav.blob)));
    report.push({ name: entry.name, ...float, pcm });
    assert.equal(pcm.differing, 0, `${pcm.differing} of ${pcm.length} PCM samples differ (largest ${pcm.largest})`);
    assert.equal(float.differing, 0, `${float.differing} of ${float.length} float samples differ (largest ${float.largest})`);
  });
}

test('rendering is repeatable: a sound rendered twice, and out of order, is the same sound', () => {
  const other = new AudioSynth(base);
  for (const name of ['victory', 'ui_hover', 'shatter', 'ui_hover']) {
    const entry = all('sound').find((row) => row.name === name);
    assert.equal(compareFloat32(other.render(name), asFloat32(blob(entry.f32))).differing, 0, name);
  }
});

test('an unknown sound is refused', () => {
  assert.throws(() => synth.render('no_such_sound'), /unknown sound/);
});

test("the conversion to 16 bits is the engine's, sample for sample", () => {
  // Independent of the synthesiser: the oracle's own float samples through the port's conversion.
  for (const entry of all('sound')) {
    const pcm = comparePcm16(AudioSynth.toPcm16(asFloat32(blob(entry.f32))), asInt16(blob(entry.wav.blob)));
    assert.equal(pcm.differing, 0, `${entry.name}: ${pcm.differing} samples differ`);
  }
  // Edges: full scale clamps, halves truncate toward zero.
  const edges = Float32Array.of(0, 1, -1, 2, -2, 0.999985, -0.999985, 1.5 / 32768, -1.5 / 32768, 1e-9, -1e-9);
  assert.deepEqual([...AudioSynth.toPcm16(edges)], [0, 32767, -32768, 32767, -32768, 32767, -32767, 1, -1, 0, 0]);
  assert.equal(AudioSynth.toPcm16(new Float32Array(0)).length, 0);
});

test('music loop: both channels and the looping stream', () => {
  const entry = one('music');
  const [left, right] = new AudioSynth().render_music();
  assert.equal(left.length, entry.samples);
  assert.equal(entry.rate, MUSIC_RATE);
  const leftResult = compareFloat32(left, asFloat32(blob(entry.left)));
  const rightResult = compareFloat32(right, asFloat32(blob(entry.right)));
  const { frames, loopBegin, loopEnd } = AudioSynth.loopingFrames(left, right);
  assert.deepEqual([entry.wav.format, entry.wav.mix_rate, entry.wav.stereo, entry.wav.loop_mode], [1, MUSIC_RATE, true, 1]);
  assert.deepEqual([loopBegin, loopEnd], [entry.wav.loop_begin, entry.wav.loop_end]);
  assert.equal(frames.length, (entry.samples + MUSIC_GUARD) * 2);
  const pcm = comparePcm16(AudioSynth.toPcm16(frames), asInt16(blob(entry.wav.blob)));
  report.push({ name: 'music left', ...leftResult });
  report.push({ name: 'music right', ...rightResult });
  report.push({ name: 'music stream', length: pcm.length, differing: 0, largest: 0, pcm, floatless: true });
  assert.equal(pcm.differing, 0, `${pcm.differing} of ${pcm.length} PCM samples differ (largest ${pcm.largest})`);
  assert.equal(leftResult.differing + rightResult.differing, 0, 'float samples differ');
});

test('build batches: the same split of the sounds for 1 to 6 threads', () => {
  const expected = one('batches').threads;
  for (let threads = 1; threads <= expected.length; threads++) assert.deepEqual(AudioSynth.batches(threads), expected[threads - 1], `${threads} threads`);
  assert.deepEqual(AudioSynth.batches(0), expected[0], 'no threads means one');
  assert.deepEqual(Object.keys(BUILD_COST), [...SOUND_NAMES]);
});

test('the build tasks yield the streams the original plays, cheapest sound first', () => {
  const costs = BUILD_ORDER.map((name) => BUILD_COST[name]);
  assert.deepEqual(costs, [...costs].sort((a, b) => a - b), 'order by cost');
  assert.deepEqual([...BUILD_ORDER].sort(), [...SOUND_NAMES].sort(), 'every sound once');

  const built = [...buildEffects()].filter((stream) => stream !== null);
  assert.deepEqual(built.map((stream) => stream.name), [...BUILD_ORDER]);
  for (const stream of built) {
    const entry = all('sound').find((row) => row.name === stream.name);
    assert.deepEqual([stream.rate, stream.stereo, stream.loop], [SFX_RATE, false, null]);
    assert.equal(comparePcm16(stream.pcm, asInt16(blob(entry.wav.blob))).differing, 0, stream.name);
  }

  const music = [...buildMusic()].filter((stream) => stream !== null);
  assert.equal(music.length, 1);
  const entry = one('music');
  assert.deepEqual([music[0].name, music[0].rate, music[0].stereo, music[0].loop], [MUSIC_NAME, MUSIC_RATE, true, { begin: entry.wav.loop_begin, end: entry.wav.loop_end }]);
  assert.equal(comparePcm16(music[0].pcm, asInt16(blob(entry.wav.blob))).differing, 0);
});

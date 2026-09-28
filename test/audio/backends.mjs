/**
 * Backends and builders — what stands between the engine and the browser:
 *   - the mixer's processor on the audio thread (src/audio/worklet.js), with the globals of that thread;
 *   - the fallback made of Web Audio's own nodes (src/audio/backend_native.js), on a stand-in graph:
 *     what is connected, what is scheduled, and that every source leaves the graph when it is over;
 *   - the synthesis tasks (src/audio/builder.js, src/audio/synth_worker.js): in workers, one or two,
 *     and on the main thread in slices when workers are not to be had.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originalStreams, audioOracle, comparePcm16, compareFloat32, asInt16, captureConsole } from './support.mjs';
import { addOriginalStreams } from './mix_support.mjs';
import { FakeContext, FakePort, FakeWorkletNode, settle } from './fake_web_audio.mjs';
import { NativeBackend, reverbResponse, makeupCompensation } from '../../src/audio/backend_native.js';
import { createWorkletBackend } from '../../src/audio/backend_worklet.js';
import { MixerHost } from '../../src/audio/worklet.js';
import { SoundBuilder, TaskState } from '../../src/audio/builder.js';
import { Mixer, Reverb, GAME_BUSES, BLOCK_FRAMES } from '../../src/audio/mixer.js';
import { Backend, Command, Report, Task, Progress, PROCESSOR_NAME } from '../../src/audio/protocol.js';
import { dbToLinearF } from '../../src/audio/decibels.js';
import { BUILD_ORDER, MUSIC_NAME } from '../../src/audio/synth.js';
import { AudioEngine, EngineState } from '../../src/audio/engine.js';
import { SceneTree } from '../../src/godot/scene.js';

const F = Math.fround;
const RATE = 44100;
const BLOCK_SECONDS = BLOCK_FRAMES / RATE;
const SFX_REVERB = GAME_BUSES[2].effects[0];
const MUSIC_REVERB = GAME_BUSES[1].effects[0];

// ─────────────────────────────────────────────────────────────── the processor ─────────────────

/** Loads src/audio/worklet.js the way the audio thread does: with its globals in place. */
async function loadProcessor(rate) {
  const registered = new Map();
  const globals = {
    sampleRate: rate,
    registerProcessor: (name, processor) => registered.set(name, processor),
    AudioWorkletProcessor: class {
      constructor() {
        this.port = new FakePort();
      }
    },
  };
  Object.assign(globalThis, globals);
  try {
    // A query of its own: the module is evaluated again, this time on "the audio thread".
    await import(`../../src/audio/worklet.js?thread=${rate}`);
  } finally {
    for (const name of Object.keys(globals)) delete globalThis[name];
  }
  return registered;
}

test('the processor registers under its name and renders what the mixer renders, 128 frames at a time', async () => {
  const registered = await loadProcessor(RATE);
  assert.deepEqual([...registered.keys()], [PROCESSOR_NAME]);
  Object.assign(globalThis, { sampleRate: RATE });
  let processor;
  try {
    processor = new (registered.get(PROCESSOR_NAME))();
  } finally {
    delete globalThis.sampleRate;
  }
  const reports = [];
  processor.port.deliver = (message) => reports.push(message);

  const streams = originalStreams();
  for (const stream of streams) processor.port.receive({ type: Command.STREAM, name: stream.name, stream });
  processor.port.receive({ type: Command.BUS, name: 'Master', settings: { volumeDb: -2, mute: false } });
  processor.port.receive({ type: Command.START, id: 1, request: { stream: 'coin', bus: 'SFX', volume: 1, pitchScale: 1.25, from: 0 } });
  processor.port.receive({ type: Command.START, id: 2, request: { stream: 'music', bus: 'Music', volume: 0.5, pitchScale: 1, from: 3 } });

  const mixer = new Mixer({ mixRate: RATE });
  addOriginalStreams(mixer);
  mixer.setBus('Master', { volumeDb: -2, mute: false });
  mixer.start(1, { stream: 'coin', bus: 'SFX', volume: 1, pitchScale: 1.25, from: 0 });
  mixer.start(2, { stream: 'music', bus: 'Music', volume: 0.5, pitchScale: 1, from: 3 });

  const QUANTUM = 128;
  const quanta = 400;
  const expectedLeft = new Float32Array(QUANTUM * quanta);
  const expectedRight = new Float32Array(QUANTUM * quanta);
  mixer.render(expectedLeft, expectedRight);
  const left = new Float32Array(QUANTUM);
  const right = new Float32Array(QUANTUM);
  let loudest = 0;
  for (let q = 0; q < quanta; q++) {
    assert.equal(processor.process([], [[left, right]], {}), true, 'the processor stays alive');
    const at = q * QUANTUM;
    assert.equal(compareFloat32(left, expectedLeft.subarray(at, at + QUANTUM)).differing, 0, `left, quantum ${q}`);
    assert.equal(compareFloat32(right, expectedRight.subarray(at, at + QUANTUM)).differing, 0, `right, quantum ${q}`);
    for (const value of left) loudest = Math.max(loudest, Math.abs(value));
  }
  assert.ok(loudest > 0.1, 'it did sound');
  // The coin (24 256 samples at 1.25) is over after half a second: reported once.
  assert.deepEqual(reports, [{ type: Report.ENDED, id: 1 }]);

  // An output with one channel, and one with none, are served all the same.
  const mono = new Float32Array(QUANTUM);
  assert.equal(processor.process([], [[mono]], {}), true);
  assert.ok(mono.some((value) => value !== 0));
  assert.equal(processor.process([], [[]], {}), true);
  assert.equal(processor.process([], [[new Float32Array(256), new Float32Array(256)]], {}), true, 'a larger quantum');
});

test('outside the audio thread the module only offers the host', async () => {
  const registered = new Map();
  assert.equal(typeof globalThis.registerProcessor, 'undefined');
  await import('../../src/audio/worklet.js');
  assert.equal(registered.size, 0);
  assert.equal(typeof MixerHost, 'function');
});

test('the host reports what it cannot do and gives the voice back', () => {
  const reports = [];
  const host = new MixerHost(RATE, (message) => reports.push(message));
  host.handle({ type: Command.START, id: 9, request: { stream: 'nothing', bus: 'SFX', volume: 1 } });
  host.handle({ type: Command.BUS, name: 'Voice', settings: { volumeDb: 0 } });
  host.handle({ type: 'dance' });
  host.handle(null);
  host.handle({ type: Command.STREAM, name: 'bad', stream: { pcm: [1, 2, 3], rate: RATE } });
  host.handle({ type: Command.STOP, id: 404 });
  host.handle({ type: Command.VOLUME, id: 404, volume: 1 });
  assert.deepEqual(reports.map((report) => report.type), [Report.FAILED, Report.ENDED, Report.FAILED, Report.FAILED, Report.FAILED, Report.FAILED]);
  assert.deepEqual(reports[1], { type: Report.ENDED, id: 9 });
  assert.match(reports[0].message, /^start: .*unknown stream 'nothing'/);
  assert.match(reports[2].message, /unknown bus 'Voice'/);
  assert.match(reports[3].message, /^dance: unknown command/);
  // Still rendering.
  const left = new Float32Array(BLOCK_FRAMES);
  host.render(left, new Float32Array(BLOCK_FRAMES), BLOCK_FRAMES);
  assert.ok(left.every((value) => value === 0));
});

test('the worklet backend: module, node, commands, reports, failures', async () => {
  const context = new FakeContext();
  const ended = [];
  const failures = [];
  const createNode = (owner, name, options) => new FakeWorkletNode(owner, name, options);
  const backend = await createWorkletBackend(context, {
    moduleUrl: '/assets/worklet.js',
    onEnded: (id) => ended.push(id),
    onFailure: (message) => failures.push(message),
    createNode,
  });
  assert.equal(backend.kind, Backend.WORKLET);
  assert.deepEqual(context.modules, ['/assets/worklet.js']);
  const node = context.nodes.find((candidate) => candidate.kind === 'worklet');
  assert.ok(node.reachesDestination());

  const pcm = Int16Array.of(1, 2, 3);
  backend.addStream('a', { name: 'a', pcm, rate: RATE, stereo: false, loop: null });
  backend.start(1, { stream: 'a', bus: 'SFX', volume: 1, pitchScale: 1, from: 0 });
  backend.setVolume(1, 0.5);
  backend.setBus('SFX', { volumeDb: -3, mute: false });
  backend.stop(1);
  assert.deepEqual(node.port.sent.map((message) => message.type), [Command.STREAM, Command.START, Command.VOLUME, Command.BUS, Command.STOP]);
  assert.deepEqual([...node.port.sent[0].stream.pcm], [1, 2, 3]);
  assert.deepEqual([...pcm], [1, 2, 3], 'the engine keeps its samples');

  node.port.receive({ type: Report.ENDED, id: 1 });
  node.port.receive({ type: Report.FAILED, message: 'start: nope' });
  node.port.receive({ type: 'gossip' });
  node.onprocessorerror();
  assert.deepEqual(ended, [1]);
  assert.deepEqual(failures, ['start: nope', 'the mixer stopped on an error']);

  backend.dispose();
  assert.ok(node.port.closed && !node.reachesDestination());
  node.port.receive({ type: Report.ENDED, id: 2 });
  assert.deepEqual(ended, [1], 'nothing is heard after the end');

  await assert.rejects(createWorkletBackend(new FakeContext({ worklet: false }), { moduleUrl: 'x', onEnded() {}, createNode }), /no AudioWorklet/);
  const missing = new FakeContext({ moduleError: new Error('404') });
  await assert.rejects(createWorkletBackend(missing, { moduleUrl: 'x', onEnded() {}, createNode }), /404/);
  assert.equal(missing.nodes.filter((candidate) => candidate.kind === 'worklet').length, 0, 'no node without its module');
});

// ─────────────────────────────────────────────────────────────── Web Audio's own nodes ─────────

function nativeBackend(context = new FakeContext({ state: 'running' })) {
  const ended = [];
  const backend = new NativeBackend(context, { onEnded: (id) => ended.push(id) });
  return { backend, context, ended };
}

const kindsFrom = (node) => {
  const kinds = [];
  for (let at = node; at !== undefined; at = [...at.outputs][0]) kinds.push(at.kind);
  return kinds;
};

test('native: the three buses, their effects and their sends', () => {
  const { backend, context } = nativeBackend();
  assert.equal(backend.kind, Backend.NATIVE);
  assert.deepEqual([...backend.buses.keys()], ['Master', 'Music', 'SFX']);
  const { Master, Music, SFX } = Object.fromEntries(backend.buses);
  assert.deepEqual(kindsFrom(SFX.input), ['gain', 'convolver', 'gain', 'gain', 'gain', 'compressor', 'gain', 'gain', 'destination']);
  assert.deepEqual(kindsFrom(Master.input), ['gain', 'gain', 'compressor', 'gain', 'gain', 'destination']);
  assert.ok(Music.output.outputs.has(Master.input) && SFX.output.outputs.has(Master.input));
  assert.ok(Master.output.outputs.has(context.destination));

  const compressor = Master.nodes.find((node) => node.kind === 'compressor');
  assert.deepEqual(
    [compressor.threshold.value, compressor.knee.value, compressor.ratio.value, compressor.attack.value, compressor.release.value],
    [-0.5, 0, 20, 0.002, 0.12],
  );
  const [, preGain, , compensation] = Master.nodes;
  assert.equal(preGain.gain.value, 1);
  // Under the threshold the compressor is a gain of its make-up: the node after it takes it back.
  const makeup = Math.pow(1 / Math.pow(dbToLinearF(-0.5), 1 - 1 / 20), 0.6);
  assert.ok(Math.abs(compensation.gain.value * makeup - 1) < 1e-7, `${compensation.gain.value} × ${makeup}`);
  assert.equal(makeupCompensation(0, 20), 1, 'a ceiling at full scale needs none');

  for (const [bus, settings] of [[SFX, SFX_REVERB], [Music, MUSIC_REVERB]]) {
    const convolver = bus.nodes.find((node) => node.kind === 'convolver');
    assert.equal(convolver.normalizedAtAssignment, false, 'the response carries its own level');
    assert.deepEqual([convolver.buffer.numberOfChannels, convolver.buffer.sampleRate], [2, RATE]);
    assert.equal(convolver.buffer.length % BLOCK_FRAMES, 0);
    assert.ok(convolver.buffer.duration >= 4 && convolver.buffer.duration < 4.02);
    // Frame 0 is the dry signal: the reverb proper arrives after its predelay.
    assert.equal(convolver.buffer.getChannelData(0)[0], F(settings.dry));
    assert.equal(convolver.buffer.getChannelData(1)[0], F(settings.dry));
  }
});

test('native: the response in the convolver is the ported reverb', () => {
  const [left, right] = reverbResponse(SFX_REVERB, RATE);
  // After the dry impulse: silence until the shortest comb line has come round, on either side. The
  // right channel's lines are 23 frames longer, of which a spread of 0.7 uses 16.
  const lines = new Reverb(SFX_REVERB, RATE).channels.map((channel) => {
    const shortest = Math.min(...channel.combs.map((comb) => comb.buffer.length));
    return shortest - Math.round(channel.spreadFrames * (1 - F(SFX_REVERB.spread)));
  });
  assert.deepEqual(lines, [1116, 1132]);
  [left, right].forEach((response, channel) => {
    assert.ok(response.subarray(1, lines[channel]).every((value) => value === 0), 'silence before the first reflection');
    assert.notEqual(response[lines[channel]], 0, 'the first reflection');
  });
  assert.notDeepEqual([...left.subarray(1000, 5000)], [...right.subarray(1000, 5000)], 'the channels are spread');
  // It decays: the last quarter of a second is the fade to nothing.
  const energy = (from, to) => left.subarray(from, to).reduce((sum, value) => sum + value * value, 0);
  assert.ok(energy(0, RATE) > 100 * energy(2 * RATE, 3 * RATE));
  assert.equal(left.at(-1), 0);
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));

  // Linear and time-invariant: two impulses give the sum of two responses, wherever the blocks fall.
  const mixer = new Mixer({ mixRate: RATE });
  const reverb = mixer.buses[2].effects[0];
  const frames = 8 * BLOCK_FRAMES;
  const input = new Float32Array(frames * 2);
  const at = 700;
  input[0] = 1;
  input[2 * at] = 0.5;
  const output = new Float32Array(frames * 2);
  for (let block = 0; block < frames; block += BLOCK_FRAMES) {
    const out = new Float32Array(BLOCK_FRAMES * 2);
    reverb.process(input.subarray(block * 2, (block + BLOCK_FRAMES) * 2), out, BLOCK_FRAMES);
    output.set(out, block * 2);
  }
  let worst = 0;
  for (let i = 0; i < frames; i++) worst = Math.max(worst, Math.abs(output[2 * i] - (left[i] + (i >= at ? 0.5 * left[i - at] : 0))));
  assert.ok(worst < 1e-6, `largest deviation ${worst}`);
});

test('native: streams become buffers at their own rate, samples over 32767', () => {
  const { backend } = nativeBackend();
  const { one, blob } = audioOracle();
  for (const stream of originalStreams()) backend.addStream(stream.name, stream);
  assert.equal(backend.streams.size, 25);
  const coin = backend.streams.get('coin').buffer;
  assert.deepEqual([coin.numberOfChannels, coin.sampleRate, coin.length], [1, 44100, 24256]);
  const music = backend.streams.get(MUSIC_NAME);
  assert.deepEqual([music.buffer.numberOfChannels, music.buffer.sampleRate, music.buffer.length], [2, 22050, 705608]);
  assert.deepEqual(music.loop, { begin: 0, end: 705600 });
  const pcm = asInt16(blob(one('music').wav.blob));
  for (const frame of [0, 1, 1000, 705599, 705607]) {
    assert.equal(music.buffer.getChannelData(0)[frame], F(pcm[2 * frame] / 32767));
    assert.equal(music.buffer.getChannelData(1)[frame], F(pcm[2 * frame + 1] / 32767));
  }
});

test('native: a sound plays, ends and leaves the graph', () => {
  const { backend, context, ended } = nativeBackend();
  for (const stream of originalStreams()) backend.addStream(stream.name, stream);
  const resting = context.wired('gain').length;

  backend.start(1, { stream: 'coin', bus: 'SFX', volume: dbToLinearF(-3), pitchScale: 1.25, from: 0 });
  const [source] = context.wired('source');
  const [gain] = [...source.outputs];
  assert.deepEqual([source.playbackRate.value, source.loop, source.startedAt, source.offset], [1.25, false, 0, 0]);
  assert.equal(gain.gain.value, dbToLinearF(-3));
  assert.ok(gain.outputs.has(backend.buses.get('SFX').input) && source.reachesDestination());
  assert.throws(() => backend.start(1, { stream: 'coin', bus: 'SFX', volume: 1 }), /already live/);
  assert.throws(() => backend.start(2, { stream: 'nothing', bus: 'SFX', volume: 1 }), /unknown stream/);

  const length = 24256 / 44100 / 1.25;
  context.advance(length - 0.001);
  assert.deepEqual(ended, []);
  context.advance(0.002);
  assert.deepEqual(ended, [1]);
  assert.deepEqual([context.wired('source').length, context.wired('gain').length, backend.voices.size], [0, resting, 0]);
  assert.equal(source.onended, null);
  // What is over can be stopped and set without harm.
  backend.stop(1);
  backend.setVolume(1, 0.2);
});

test('native: a stop fades over one block, then the source stops and leaves', () => {
  const { backend, context, ended } = nativeBackend();
  for (const stream of originalStreams()) backend.addStream(stream.name, stream);
  backend.start(5, { stream: 'victory', bus: 'SFX', volume: 0.8, pitchScale: 1, from: 0 });
  const [source] = context.wired('source');
  const [gain] = [...source.outputs];
  context.advance(0.5);
  backend.stop(5);
  backend.stop(5);
  assert.ok(Math.abs(source.stopAt - (0.5 + BLOCK_SECONDS)) < 1e-12);
  assert.deepEqual(gain.gain.calls.slice(-3), [['cancelScheduledValues', 0.5], ['setValueAtTime', 0.8, 0.5], ['linearRampToValueAtTime', 0, 0.5 + BLOCK_SECONDS]]);
  context.advance(BLOCK_SECONDS / 2);
  assert.ok(Math.abs(gain.gain.value - 0.4) < 1e-9, 'half-way down');
  backend.setVolume(5, 1);
  assert.ok(Math.abs(gain.gain.value - 0.4) < 1e-9, 'a stopping sound takes no more volumes');
  context.advance(BLOCK_SECONDS);
  assert.deepEqual(ended, [5]);
  assert.equal(context.wired('source').length, 0);
});

test('native: volumes move over one block, from wherever they are', () => {
  const { backend, context } = nativeBackend();
  for (const stream of originalStreams()) backend.addStream(stream.name, stream);
  backend.start(3, { stream: MUSIC_NAME, bus: 'Music', volume: dbToLinearF(-60), pitchScale: 1, from: 0 });
  const [source] = context.wired('source');
  const [gain] = [...source.outputs];
  assert.deepEqual([source.loop, source.loopStart, source.loopEnd], [true, 0, 32]);
  assert.ok(gain.outputs.has(backend.buses.get('Music').input));

  // One volume per frame, the way the music's fade sends them.
  let expected = dbToLinearF(-60);
  for (let frame = 1; frame <= 30; frame++) {
    context.advance(1 / 60);
    assert.ok(Math.abs(gain.gain.value - expected) < 1e-9, `frame ${frame}: the last volume was reached`);
    expected = frame / 30;
    backend.setVolume(3, expected);
  }
  context.advance(BLOCK_SECONDS / 4);
  backend.setVolume(3, 0.5);
  const from = gain.gain.calls.at(-2)[1];
  assert.ok(from < 1 && from > 0.96, `the new ramp starts where the old one was: ${from}`);

  // It loops for good: nothing ends by itself.
  context.advance(100);
  assert.equal(context.wired('source').length, 1);

  // Starts past the end land just before it; negative ones at the start.
  backend.start(4, { stream: 'coin', bus: 'SFX', volume: 1, pitchScale: 1, from: 99 });
  backend.start(6, { stream: 'coin', bus: 'Nowhere', volume: 1, pitchScale: 1, from: -5 });
  const [, late, early] = context.wired('source');
  assert.ok(Math.abs(late.offset - (24256 / 44100 - 0.001)) < 1e-12);
  assert.equal(early.offset, 0);
  assert.ok([...[...early.outputs][0].outputs][0] === backend.buses.get('Master').input, 'an unknown bus is the first bus');
});

test('native: bus volumes and mute', () => {
  const { backend, context } = nativeBackend();
  const sfx = backend.buses.get('SFX').output.gain;
  assert.equal(sfx.value, 1);
  backend.setBus('SFX', { volumeDb: F(-6), mute: false });
  context.advance(BLOCK_SECONDS);
  assert.ok(Math.abs(sfx.value - dbToLinearF(-6)) < 1e-9);
  backend.setBus('SFX', { mute: true });
  context.advance(BLOCK_SECONDS);
  assert.ok(Math.abs(sfx.value) < 1e-12);
  backend.setBus('SFX', { mute: false });
  context.advance(BLOCK_SECONDS);
  assert.ok(Math.abs(sfx.value - dbToLinearF(-6)) < 1e-9, 'the volume outlives the mute');
  backend.setBus('Voice', { volumeDb: 0, mute: false });
});

test('native: a thousand sounds leave nothing behind', () => {
  const { backend, context, ended } = nativeBackend();
  for (const stream of originalStreams()) backend.addStream(stream.name, stream);
  const resting = context.wired('gain').length;
  const names = BUILD_ORDER;
  let live = 0;
  for (let id = 1; id <= 1000; id++) {
    backend.start(id, { stream: names[id % names.length], bus: 'SFX', volume: 0.5, pitchScale: 0.5 + (id % 7) * 0.5, from: 0 });
    if (id % 3 === 0) backend.stop(id - 1);
    context.advance(0.05);
    live = Math.max(live, context.wired('source').length);
  }
  context.advance(10);
  assert.equal(ended.length, 1000);
  assert.equal(new Set(ended).size, 1000, 'every end once');
  assert.deepEqual([context.wired('source').length, context.wired('gain').length, backend.voices.size], [0, resting, 0]);
  assert.ok(live > 5, `${live} at once`);
});

test('native: dispose stops what plays and takes the graph apart', () => {
  const { backend, context, ended } = nativeBackend();
  for (const stream of originalStreams()) backend.addStream(stream.name, stream);
  backend.start(1, { stream: 'victory', bus: 'SFX', volume: 1, pitchScale: 1, from: 0 });
  backend.start(2, { stream: MUSIC_NAME, bus: 'Music', volume: 1, pitchScale: 1, from: 0 });
  const sources = context.wired('source');
  backend.dispose();
  assert.ok(sources.every((source) => source.stopAt === 0 && source.onended === null));
  assert.deepEqual(['source', 'gain', 'convolver', 'compressor'].map((kind) => context.wired(kind).length), [0, 0, 0, 0]);
  context.advance(10);
  assert.deepEqual(ended, [], 'and says nothing afterwards');
});

// ─────────────────────────────────────────────────────────────── the engine's choice ───────────

/** An engine with its own way of choosing a backend, on a stand-in context. */
async function engineOn(context, backend) {
  const engine = new AudioEngine({ backend, tree: new SceneTree(), createContext: () => context, createBuilder: () => ({ start() {}, dispose() {} }) });
  const lines = await captureConsole(async () => {
    await engine.unlock();
    await settle();
  });
  return { engine, lines, levels: lines.map((line) => line.level) };
}

test('the engine takes the mixer worklet when it can, Web Audio nodes when it cannot', async () => {
  const running = () => new FakeContext({ state: 'running' });
  assert.equal(typeof globalThis.AudioWorkletNode, 'undefined', 'this runtime has no worklet nodes');

  // Asked for the best: the worklet fails, the nodes take over, and it is said.
  const fallen = await engineOn(running(), Backend.AUTO);
  assert.deepEqual([fallen.engine.state, fallen.engine.snapshot().backend], [EngineState.RUNNING, Backend.NATIVE]);
  assert.deepEqual(fallen.levels, ['warn', 'info']);
  assert.match(fallen.lines[0].text, /mixer worklet is unavailable/);

  // A browser without worklets: nothing to try, nothing to say.
  const plain = await engineOn(new FakeContext({ state: 'running', worklet: false }), Backend.AUTO);
  assert.deepEqual([plain.engine.snapshot().backend, plain.levels], [Backend.NATIVE, ['info']]);

  // Asked for the nodes.
  const native = await engineOn(running(), Backend.NATIVE);
  assert.deepEqual([native.engine.snapshot().backend, native.levels], [Backend.NATIVE, ['info']]);
  assert.equal(native.engine.context.modules.length, 0, 'the mixer was not even loaded');

  // Asked for the worklet and nothing else: no sound rather than another sound.
  for (const context of [running(), new FakeContext({ state: 'running', worklet: false })]) {
    const strict = await engineOn(context, Backend.WORKLET);
    assert.deepEqual([strict.engine.state, strict.levels], [EngineState.FAILED, ['error']]);
  }

  // With worklet nodes at hand.
  globalThis.AudioWorkletNode = FakeWorkletNode;
  try {
    const best = await engineOn(running(), Backend.AUTO);
    assert.deepEqual([best.engine.state, best.engine.snapshot().backend, best.levels], [EngineState.RUNNING, Backend.WORKLET, ['info']]);
    assert.equal(best.lines[0].text, 'audio: worklet backend at 44100 Hz');
    assert.equal(best.engine.context.modules.length, 1);
    best.engine.dispose();
  } finally {
    delete globalThis.AudioWorkletNode;
  }
  for (const { engine } of [fallen, plain, native]) engine.dispose();
});

test('the engine fetches the mixer ahead of the first gesture, and shrugs when it cannot', async () => {
  const page = (fetch) => ({ fetch, addEventListener() {}, removeEventListener() {}, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } });
  const build = (backend) => new AudioEngine({ backend, tree: new SceneTree(), createContext: () => new FakeContext(), createBuilder: () => ({ start() {}, dispose() {} }) });

  const fetched = [];
  const engine = build(Backend.AUTO);
  const quiet = await captureConsole(async () => {
    engine.followPage(page(async (address) => (fetched.push(address), { arrayBuffer: async () => new ArrayBuffer(0) })));
    await settle();
    await settle();
  });
  assert.equal(fetched.length, 1);
  assert.deepEqual(quiet, []);
  assert.equal(engine.state, EngineState.LOCKED, 'fetched, not started');

  const offline = build(Backend.AUTO);
  const lines = await captureConsole(async () => {
    offline.followPage(page(async () => {
      throw new Error('offline');
    }));
    await settle();
    await settle();
  });
  assert.deepEqual(lines, [{ level: 'info', text: 'audio: the mixer could not be fetched ahead of time (offline)' }]);

  // Nothing to fetch for the nodes, nothing to fetch with on a page without fetch.
  const calls = [];
  build(Backend.NATIVE).followPage(page(async () => calls.push('native')));
  build(Backend.AUTO).followPage(page(undefined));
  await settle();
  assert.deepEqual(calls, []);
});

// ─────────────────────────────────────────────────────────────── synthesis tasks ───────────────

/** Workers that answer when the test lets them. */
function fakeWorkers({ failOnCreate = false } = {}) {
  const workers = [];
  class FakeWorker {
    constructor() {
      if (failOnCreate) throw new Error('workers are blocked');
      this.tasks = [];
      this.terminated = false;
      this.onmessage = null;
      this.onerror = null;
      workers.push(this);
    }

    postMessage(message) {
      this.tasks.push(message.task);
    }

    terminate() {
      this.terminated = true;
    }

    /** The worker speaks. */
    say(message) {
      this.onmessage?.({ data: message });
    }
  }
  return { workers, createWorker: () => new FakeWorker() };
}

const stream = (name) => ({ name, pcm: new Int16Array(8), rate: RATE, stereo: false, loop: null });

function builder(options) {
  const log = { streams: [], done: [], failed: [] };
  const made = new SoundBuilder({
    onStream: (built) => log.streams.push(built.name),
    onDone: (task, msec) => log.done.push([task, msec]),
    onFailed: (task, message) => log.failed.push([task, message]),
    ...options,
  });
  return { builder: made, log };
}

test('builder: with cores to spare, effects and music are built side by side', () => {
  const { workers, createWorker } = fakeWorkers();
  const { builder: made, log } = builder({ createWorker, cores: 8 });
  assert.deepEqual([made.state(Task.EFFECTS), made.state(Task.MUSIC)], [TaskState.PENDING, TaskState.PENDING]);
  made.start();
  made.start();
  assert.deepEqual(workers.map((worker) => worker.tasks), [[Task.EFFECTS], [Task.MUSIC]]);
  assert.deepEqual([made.state(Task.EFFECTS), made.state(Task.MUSIC)], [TaskState.IN_WORKER, TaskState.IN_WORKER]);

  workers[1].say({ type: Progress.STREAM, task: Task.MUSIC, stream: stream('music') });
  workers[0].say({ type: Progress.STREAM, task: Task.EFFECTS, stream: stream('ui_hover') });
  workers[0].say({ type: Progress.STREAM, task: Task.MUSIC, stream: stream('stray') });
  workers[1].say({ type: Progress.DONE, task: Task.MUSIC, msec: 900 });
  assert.deepEqual([workers[0].terminated, workers[1].terminated], [false, true]);
  workers[0].say({ type: Progress.DONE, task: Task.EFFECTS, msec: 400 });
  assert.deepEqual(log, { streams: ['music', 'ui_hover'], done: [[Task.MUSIC, 900], [Task.EFFECTS, 400]], failed: [] });
  assert.deepEqual([made.state(Task.EFFECTS), made.state(Task.MUSIC)], [TaskState.DONE, TaskState.DONE]);
  assert.ok(workers.every((worker) => worker.terminated));
  assert.equal(made.workers.size, 0);
});

test('builder: on a small machine one worker does both, effects first', () => {
  const { workers, createWorker } = fakeWorkers();
  const { builder: made, log } = builder({ createWorker, cores: 2 });
  made.start();
  assert.deepEqual(workers.map((worker) => worker.tasks), [[Task.EFFECTS]]);
  assert.equal(made.state(Task.MUSIC), TaskState.PENDING);
  workers[0].say({ type: Progress.DONE, task: Task.EFFECTS, msec: 1 });
  assert.deepEqual(workers[0].tasks, [Task.EFFECTS, Task.MUSIC]);
  assert.equal(workers[0].terminated, false);
  workers[0].say({ type: Progress.DONE, task: Task.MUSIC, msec: 2 });
  assert.deepEqual(log.done, [[Task.EFFECTS, 1], [Task.MUSIC, 2]]);
  assert.equal(workers[0].terminated, true);
});

/** A main thread whose clock moves by `cost` with every step of a build. */
function mainThread(cost) {
  const thread = { now: 0, turns: 0, queue: [] };
  const steps = (names) =>
    function* build() {
      yield null;
      for (const name of names) {
        thread.now += cost;
        yield stream(name);
      }
    };
  return {
    thread,
    options: {
      now: () => thread.now,
      schedule: (callback) => thread.queue.push(callback),
      loadSynth: async () => ({ buildEffects: steps(['a', 'b', 'c', 'd', 'e', 'f']), buildMusic: steps(['music']) }),
    },
    /** Lets the page take its turns until the builder is idle. */
    async run() {
      for (let guard = 0; guard < 1000; guard++) {
        await settle();
        if (thread.queue.length === 0) return;
        thread.turns += 1;
        thread.queue.shift()();
      }
      throw new Error('the builder never finished');
    },
  };
}

test('builder: without workers the main thread builds in slices', async () => {
  const main = mainThread(5);
  const { builder: made, log } = builder({ createWorker: null, ...main.options });
  made.start();
  assert.deepEqual([made.state(Task.EFFECTS), made.state(Task.MUSIC)], [TaskState.ON_MAIN_THREAD, TaskState.ON_MAIN_THREAD]);
  await main.run();
  assert.deepEqual(log.streams, ['a', 'b', 'c', 'd', 'e', 'f', 'music'], 'one task after the other');
  assert.deepEqual(log.done.map(([task]) => task), [Task.EFFECTS, Task.MUSIC]);
  assert.deepEqual(log.done.map(([, msec]) => msec), [30, 5]);
  // 5 ms a sound, 8 ms a slice: two sounds per turn, and the page in between.
  assert.ok(main.thread.turns >= 5, `${main.thread.turns} turns`);
});

test('builder: a worker that cannot be created, fails or dies hands its work to the main thread', async () => {
  // Cannot be created.
  const blocked = mainThread(1);
  const first = builder({ ...fakeWorkers({ failOnCreate: true }), cores: 8, ...blocked.options });
  const lines = await captureConsole(async () => {
    first.builder.start();
    await blocked.run();
  });
  assert.deepEqual(first.log.done.map(([task]) => task), [Task.EFFECTS, Task.MUSIC]);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => line.level === 'warn' && line.text.includes('workers are blocked')));

  // Reports a failure in the middle of the effects: both of its tasks move.
  const failing = mainThread(1);
  const pool = fakeWorkers();
  const second = builder({ createWorker: pool.createWorker, cores: 1, ...failing.options });
  await captureConsole(async () => {
    second.builder.start();
    pool.workers[0].say({ type: Progress.STREAM, task: Task.EFFECTS, stream: stream('a') });
    pool.workers[0].say({ type: Progress.FAILED, task: Task.EFFECTS, message: 'out of memory' });
    await failing.run();
  });
  assert.equal(pool.workers[0].terminated, true);
  assert.deepEqual(second.log.done.map(([task]) => task), [Task.EFFECTS, Task.MUSIC]);
  assert.deepEqual(second.log.streams, ['a', 'a', 'b', 'c', 'd', 'e', 'f', 'music'], 'a sound built twice is the same sound');

  // Dies without a word (a script that does not load).
  const dying = mainThread(1);
  const other = fakeWorkers();
  const third = builder({ createWorker: other.createWorker, cores: 4, ...dying.options });
  await captureConsole(async () => {
    third.builder.start();
    other.workers[1].onerror({ message: 'script not found', preventDefault() {} });
    other.workers[0].say({ type: Progress.DONE, task: Task.EFFECTS, msec: 3 });
    await dying.run();
  });
  assert.deepEqual(third.log.done.map(([task]) => task), [Task.EFFECTS, Task.MUSIC]);
  assert.deepEqual(third.log.streams, ['music']);
});

test('builder: what cannot be built at all is reported, the rest goes on', async () => {
  const main = mainThread(1);
  const { builder: made, log } = builder({
    createWorker: null,
    ...main.options,
    loadSynth: async () => ({
      *buildEffects() {
        yield stream('a');
        throw new Error('broken table');
      },
      *buildMusic() {
        yield stream('music');
      },
    }),
  });
  made.start();
  await main.run();
  assert.deepEqual(log.streams, ['a', 'music']);
  assert.deepEqual(log.done.map(([task]) => task), [Task.MUSIC]);
  assert.equal(log.failed.length, 1);
  assert.equal(log.failed[0][0], Task.EFFECTS);
  assert.match(log.failed[0][1], /broken table/);
  assert.deepEqual([made.state(Task.EFFECTS), made.state(Task.MUSIC)], [TaskState.FAILED, TaskState.DONE]);
});

test('builder: dispose ends the workers and the slices; nothing is reported afterwards', async () => {
  const pool = fakeWorkers();
  const inWorkers = builder({ createWorker: pool.createWorker, cores: 8 });
  inWorkers.builder.start();
  inWorkers.builder.dispose();
  assert.ok(pool.workers.every((worker) => worker.terminated));
  pool.workers[0].say({ type: Progress.STREAM, task: Task.EFFECTS, stream: stream('late') });
  pool.workers[0].say({ type: Progress.DONE, task: Task.EFFECTS, msec: 1 });
  assert.deepEqual(inWorkers.log, { streams: [], done: [], failed: [] });
  inWorkers.builder.start();
  assert.equal(pool.workers.length, 2, 'a disposed builder does not start again');

  const main = mainThread(5);
  const sliced = builder({ createWorker: null, ...main.options });
  sliced.builder.start();
  await settle();
  main.thread.queue.shift()();
  sliced.builder.dispose();
  await main.run();
  assert.ok(sliced.log.streams.length <= 2, `${sliced.log.streams.length} sounds before the end`);
  assert.deepEqual(sliced.log.done, []);
});

test('the worker script builds what the original plays and hands the samples over', async () => {
  const { all, one, blob } = audioOracle();
  const posted = [];
  globalThis.self = { postMessage: (message, transfer) => posted.push({ message, transfer }) };
  try {
    await import('../../src/audio/synth_worker.js');
    self.onmessage({ data: { task: Task.EFFECTS } });
    self.onmessage({ data: { task: Task.MUSIC } });
    self.onmessage({ data: { task: 'dance' } });
    self.onmessage({ data: null });
  } finally {
    delete globalThis.self;
  }
  const streams = posted.filter(({ message }) => message.type === Progress.STREAM);
  assert.deepEqual(streams.map(({ message }) => message.stream.name), [...BUILD_ORDER, MUSIC_NAME]);
  for (const { message, transfer } of streams) {
    assert.deepEqual(transfer, [message.stream.pcm.buffer], 'moved, not copied');
    const entry = message.stream.name === MUSIC_NAME ? one('music') : all('sound').find((row) => row.name === message.stream.name);
    assert.equal(comparePcm16(message.stream.pcm, asInt16(blob(entry.wav.blob))).differing, 0, message.stream.name);
  }
  const rest = posted.filter(({ message }) => message.type !== Progress.STREAM).map(({ message }) => [message.type, message.task]);
  assert.deepEqual(rest, [[Progress.DONE, Task.EFFECTS], [Progress.DONE, Task.MUSIC], [Progress.FAILED, 'dance'], [Progress.FAILED, undefined]]);
  assert.ok(posted.filter(({ message }) => message.type === Progress.DONE).every(({ message }) => message.msec > 0));
});

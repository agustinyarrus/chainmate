/**
 * A stand-in for the part of Web Audio the engine uses, for tests in Node. It keeps no sound: it
 * records the graph (who is connected to whom), evaluates parameter automation on a clock the test
 * moves by hand, ends sources when their time has come, and refuses what a browser would refuse
 * (starting a source twice, stopping one that never started, normalising a convolver after the fact).
 */

class InvalidStateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidStateError';
  }
}

/** An AudioParam: a value, or a schedule of set points and linear ramps read at the context's time. */
export class FakeParam {
  constructor(context, value) {
    this.context = context;
    this.base = value;
    /** @type {Array<{ kind: 'set' | 'ramp', value: number, time: number }>} sorted by time */
    this.events = [];
    /** Every call made, in order: what tests assert on. */
    this.calls = [];
  }

  get value() {
    const now = this.context.currentTime;
    let value = this.base;
    let time = -Infinity;
    for (const event of this.events) {
      if (event.kind === 'set') {
        if (event.time > now) break;
        value = event.value;
        time = event.time;
      } else {
        if (event.time <= now) {
          value = event.value;
          time = event.time;
        } else {
          const from = Math.max(time, 0);
          return value + (event.value - value) * ((now - from) / (event.time - from));
        }
      }
    }
    return value;
  }

  set value(value) {
    this.calls.push(['value', value]);
    this.base = value;
    this.events.length = 0;
  }

  setValueAtTime(value, time) {
    this.calls.push(['setValueAtTime', value, time]);
    this.insert({ kind: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value, time) {
    this.calls.push(['linearRampToValueAtTime', value, time]);
    this.insert({ kind: 'ramp', value, time });
    return this;
  }

  cancelScheduledValues(time) {
    this.calls.push(['cancelScheduledValues', time]);
    // What was reached so far stays: the schedule is cut, not rewound.
    const held = this.value;
    this.events = this.events.filter((event) => event.time < time);
    if (this.events.length === 0) this.base = held;
    return this;
  }

  insert(event) {
    this.events.push(event);
    this.events.sort((a, b) => a.time - b.time);
  }
}

export class FakeNode {
  constructor(context, kind) {
    this.context = context;
    this.kind = kind;
    /** @type {Set<FakeNode>} */
    this.outputs = new Set();
    /** @type {Set<FakeNode>} */
    this.inputs = new Set();
    context.nodes.push(this);
  }

  connect(target) {
    this.outputs.add(target);
    target.inputs.add(this);
    return target;
  }

  disconnect() {
    for (const target of this.outputs) target.inputs.delete(this);
    this.outputs.clear();
  }

  /** True when a path of connections leads from this node to the destination. */
  reachesDestination(seen = new Set()) {
    if (this === this.context.destination) return true;
    if (seen.has(this)) return false;
    seen.add(this);
    for (const target of this.outputs) if (target.reachesDestination(seen)) return true;
    return false;
  }
}

export class FakeBuffer {
  constructor(channels, length, sampleRate) {
    if (!(channels >= 1) || !(length >= 1) || !(sampleRate >= 8000 && sampleRate <= 96000)) throw new RangeError('createBuffer: not supported');
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(channel) {
    return this.channels[channel];
  }

  copyToChannel(source, channel) {
    this.channels[channel].set(source);
  }
}

class FakeSource extends FakeNode {
  constructor(context) {
    super(context, 'source');
    this.buffer = null;
    this.playbackRate = new FakeParam(context, 1);
    this.loop = false;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.onended = null;
    this.startedAt = null;
    this.offset = 0;
    this.stopAt = Infinity;
    this.ended = false;
  }

  start(when = 0, offset = 0) {
    if (this.startedAt !== null) throw new InvalidStateError('start: already started');
    if (offset < 0 || when < 0) throw new RangeError('start: negative time');
    this.startedAt = Math.max(when, this.context.currentTime);
    this.offset = offset;
  }

  stop(when = 0) {
    if (this.startedAt === null) throw new InvalidStateError('stop: never started');
    if (when < 0) throw new RangeError('stop: negative time');
    this.stopAt = Math.max(when, this.context.currentTime);
  }

  /** The time this source ends by itself or by its stop. */
  get endsAt() {
    if (this.startedAt === null) return Infinity;
    const natural = this.loop ? Infinity : this.startedAt + (this.buffer.duration - this.offset) / this.playbackRate.value;
    return Math.min(natural, this.stopAt);
  }
}

class FakeConvolver extends FakeNode {
  constructor(context) {
    super(context, 'convolver');
    this.normalize = true;
    this.assigned = null;
    /** What `normalize` was when the buffer was set: a browser scales the response at that moment. */
    this.normalizedAtAssignment = null;
  }

  get buffer() {
    return this.assigned;
  }

  set buffer(buffer) {
    this.assigned = buffer;
    this.normalizedAtAssignment = this.normalize;
  }
}

class FakeCompressor extends FakeNode {
  constructor(context) {
    super(context, 'compressor');
    this.threshold = new FakeParam(context, -24);
    this.knee = new FakeParam(context, 30);
    this.ratio = new FakeParam(context, 12);
    this.attack = new FakeParam(context, 0.003);
    this.release = new FakeParam(context, 0.25);
  }
}

class FakeGain extends FakeNode {
  constructor(context) {
    super(context, 'gain');
    this.gain = new FakeParam(context, 1);
  }
}

/** A MessagePort whose other end is a function. */
export class FakePort {
  constructor() {
    this.onmessage = null;
    this.sent = [];
    this.closed = false;
    /** Set by the test: receives what the engine posts. */
    this.deliver = () => {};
  }

  postMessage(message) {
    if (this.closed) return;
    // A port copies what it carries.
    const copy = structuredClone(message);
    this.sent.push(copy);
    this.deliver(copy);
  }

  /** The other end speaks. */
  receive(message) {
    this.onmessage?.({ data: structuredClone(message) });
  }

  close() {
    this.closed = true;
  }
}

export class FakeWorkletNode extends FakeNode {
  constructor(context, name, options) {
    super(context, 'worklet');
    this.name = name;
    this.options = options;
    this.port = new FakePort();
    this.onprocessorerror = null;
  }
}

export class FakeContext {
  /**
   * @param {{ sampleRate?: number, state?: 'suspended' | 'running', worklet?: boolean,
   *   moduleError?: Error | null, resumes?: boolean }} [options] `resumes: false` makes resume() hang
   *   (a browser that still wants a gesture)
   */
  constructor({ sampleRate = 44100, state = 'suspended', worklet = true, moduleError = null, resumes = true } = {}) {
    this.sampleRate = sampleRate;
    this.state = state;
    this.currentTime = 0;
    this.nodes = [];
    this.destination = new FakeNode(this, 'destination');
    this.onstatechange = null;
    this.resumes = resumes;
    this.calls = [];
    this.modules = [];
    if (worklet) {
      this.audioWorklet = {
        addModule: async (url) => {
          this.modules.push(url);
          if (moduleError !== null) throw moduleError;
        },
      };
    }
  }

  createGain() {
    return new FakeGain(this);
  }

  createBufferSource() {
    return new FakeSource(this);
  }

  createBuffer(channels, length, sampleRate) {
    return new FakeBuffer(channels, length, sampleRate);
  }

  createConvolver() {
    return new FakeConvolver(this);
  }

  createDynamicsCompressor() {
    return new FakeCompressor(this);
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.onstatechange?.();
  }

  resume() {
    this.calls.push('resume');
    if (!this.resumes) return new Promise(() => {});
    return Promise.resolve().then(() => this.setState('running'));
  }

  suspend() {
    this.calls.push('suspend');
    return Promise.resolve().then(() => this.setState('suspended'));
  }

  close() {
    this.calls.push('close');
    return Promise.resolve().then(() => this.setState('closed'));
  }

  /** Moves the clock; sources whose time has come end, in the order of their ends. */
  advance(seconds) {
    const until = this.currentTime + seconds;
    for (;;) {
      const due = this.nodes
        .filter((node) => node.kind === 'source' && !node.ended && node.endsAt <= until)
        .sort((a, b) => a.endsAt - b.endsAt)[0];
      if (due === undefined) break;
      this.currentTime = Math.max(this.currentTime, due.endsAt);
      due.ended = true;
      due.onended?.();
    }
    this.currentTime = until;
  }

  /** Sources and gains that are still wired to something. */
  wired(kind) {
    return this.nodes.filter((node) => node.kind === kind && (node.outputs.size > 0 || node.inputs.size > 0));
  }
}

/** Lets promise callbacks and statechange handlers run. */
export const settle = () => new Promise((resolve) => setImmediate(resolve));

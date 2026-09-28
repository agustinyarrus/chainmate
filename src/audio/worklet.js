/**
 * The mixer on the audio thread: an AudioWorkletProcessor around src/audio/mixer.js. The engine sends
 * commands through the node's port (src/audio/protocol.js); the processor answers when a playback has
 * left the mixer, which is how the engine knows that a voice is free again.
 *
 * The mixer works in blocks of 512 frames, the browser asks for 128 at a time: a block is mixed when
 * the previous one has been handed out, exactly like the original's audio driver does it.
 *
 * MixerHost is the part without any browser API, so that Node can test the message handling.
 */
import { Mixer, Stream } from './mixer.js';
import { PROCESSOR_NAME, Command, Report } from './protocol.js';

export class MixerHost {
  /**
   * @param {number} mixRate frames per second of the context
   * @param {(message: object) => void} post sends a report to the engine
   */
  constructor(mixRate, post) {
    this.post = post;
    this.mixer = new Mixer({ mixRate, onEnded: (id) => post({ type: Report.ENDED, id }) });
  }

  /** Applies one command. A command that cannot be applied is reported, never thrown: the audio goes on. */
  handle(message) {
    try {
      this.apply(message);
    } catch (error) {
      this.post({ type: Report.FAILED, message: `${message?.type}: ${error?.message ?? error}` });
      // A start that failed will never end by itself: the engine must get its voice back.
      if (message?.type === Command.START) this.post({ type: Report.ENDED, id: message.id });
    }
  }

  apply(message) {
    const mixer = this.mixer;
    switch (message.type) {
      case Command.STREAM:
        mixer.addStream(message.name, new Stream(message.stream));
        break;
      case Command.START:
        mixer.start(message.id, message.request);
        break;
      case Command.STOP:
        mixer.stop(message.id);
        break;
      case Command.VOLUME:
        mixer.setVolume(message.id, message.volume);
        break;
      case Command.BUS:
        if (!mixer.setBus(message.name, message.settings)) throw new Error(`unknown bus '${message.name}'`);
        break;
      default:
        throw new Error('unknown command');
    }
  }

  render(left, right, frames) {
    this.mixer.render(left, right, frames);
  }
}

// Only the audio thread knows these globals.
if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor === 'function') {
  class MixerProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      // `sampleRate` is a global of the audio thread: the rate of the context.
      this.host = new MixerHost(sampleRate, (message) => this.port.postMessage(message));
      this.port.onmessage = (event) => this.host.handle(event.data);
      /** Stands in for a channel the output does not have. */
      this.spare = new Float32Array(128);
    }

    process(_inputs, outputs) {
      const output = outputs[0];
      const left = output[0];
      if (left === undefined) return true;
      if (this.spare.length < left.length) this.spare = new Float32Array(left.length);
      this.host.render(left, output[1] ?? this.spare, left.length);
      return true;
    }
  }

  registerProcessor(PROCESSOR_NAME, MixerProcessor);
}

/**
 * The engine's first choice of backend: the ported mixer, running on the audio thread. One
 * AudioWorkletNode, no inputs, stereo out, connected straight to the destination; every voice, bus
 * and effect lives inside it (src/audio/mixer.js), so there is no node per voice to stop or
 * disconnect. Commands go through the node's port; "ended" reports come back the same way.
 */
import { PROCESSOR_NAME, Backend, Command, Report } from './protocol.js';

export class WorkletBackend {
  /**
   * @param {BaseAudioContext} context
   * @param {AudioWorkletNode} node the mixer's node, already constructed
   * @param {{ onEnded: (id: number) => void, onFailure?: (message: string) => void }} listeners
   */
  constructor(context, node, { onEnded, onFailure = () => {} }) {
    this.kind = Backend.WORKLET;
    this.context = context;
    this.node = node;
    node.port.onmessage = ({ data }) => {
      if (data?.type === Report.ENDED) onEnded(data.id);
      else if (data?.type === Report.FAILED) onFailure(data.message);
    };
    node.onprocessorerror = () => onFailure('the mixer stopped on an error');
    node.connect(context.destination);
  }

  /** The samples are copied: the engine keeps its own for a backend it may have to create again. */
  addStream(name, stream) {
    this.send({ type: Command.STREAM, name, stream });
  }

  start(id, request) {
    this.send({ type: Command.START, id, request });
  }

  stop(id) {
    this.send({ type: Command.STOP, id });
  }

  setVolume(id, volume) {
    this.send({ type: Command.VOLUME, id, volume });
  }

  setBus(name, settings) {
    this.send({ type: Command.BUS, name, settings });
  }

  send(message) {
    this.node.port.postMessage(message);
  }

  dispose() {
    this.node.port.onmessage = null;
    this.node.onprocessorerror = null;
    this.node.port.close();
    this.node.disconnect();
  }
}

/**
 * Loads the processor into the context and builds the backend around its node.
 * @param {BaseAudioContext} context
 * @param {{ moduleUrl: string, onEnded: (id: number) => void, onFailure?: (message: string) => void,
 *   createNode?: (context: BaseAudioContext, name: string, options: object) => AudioWorkletNode }} options
 */
export async function createWorkletBackend(context, { moduleUrl, onEnded, onFailure, createNode }) {
  if (context.audioWorklet === undefined) throw new Error('this browser has no AudioWorklet');
  await context.audioWorklet.addModule(moduleUrl);
  const options = { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] };
  const node = createNode ? createNode(context, PROCESSOR_NAME, options) : new AudioWorkletNode(context, PROCESSOR_NAME, options);
  return new WorkletBackend(context, node, { onEnded, onFailure });
}

/**
 * Audio — the port of the game's sound, proved against the original build.
 *
 *   synthesis   every buffer of src/audio/synth.js, float32 and 16-bit PCM   (_oracle/audio.json)
 *   libm        the C library's functions the synthesis depends on            (_oracle/audio.json)
 *   mixer       the audio server: sixteen recorded cases, frame for frame     (_oracle/audio_mix.json)
 *   engine      Sfx's rules, the backends, the synthesis workers, the wiring  (no oracle: behaviour)
 *
 * The oracles are produced by `node tools/oracle.mjs audio audio_mix` (probes _oracle/probe_audio.gd
 * and _oracle/probe_audio_mix.gd, run inside the original). The parts live in test/audio/.
 */
import './audio/synthesis.mjs';
import './audio/libm.mjs';
import './audio/mixer.mjs';
import './audio/engine.mjs';
import './audio/backends.mjs';

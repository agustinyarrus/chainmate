/**
 * FastNoiseLite with Godot's resource API, backed by the official JS port of the same library
 * (Auburn/FastNoiseLite, MIT) that Godot vendors in C++. Godot's defaults: OpenSimplex2S ("simplex
 * smooth"), FBM, 5 octaves, lacunarity 2, gain 0.5, frequency 0.01.
 * The C++ build computes in float32, this port in double: values agree to ~1e-7 near the origin.
 */
import FastNoise from 'fastnoise-lite';

export const NOISE_TYPE = Object.freeze({ SIMPLEX: 0, SIMPLEX_SMOOTH: 1, CELLULAR: 2, PERLIN: 3, VALUE_CUBIC: 4, VALUE: 5 });
export const FRACTAL_TYPE = Object.freeze({ NONE: 0, FBM: 1, RIDGED: 2, PING_PONG: 3 });

const TYPE_MAP = {
  [NOISE_TYPE.SIMPLEX]: FastNoise.NoiseType.OpenSimplex2,
  [NOISE_TYPE.SIMPLEX_SMOOTH]: FastNoise.NoiseType.OpenSimplex2S,
  [NOISE_TYPE.CELLULAR]: FastNoise.NoiseType.Cellular,
  [NOISE_TYPE.PERLIN]: FastNoise.NoiseType.Perlin,
  [NOISE_TYPE.VALUE_CUBIC]: FastNoise.NoiseType.ValueCubic,
  [NOISE_TYPE.VALUE]: FastNoise.NoiseType.Value,
};
const FRACTAL_MAP = {
  [FRACTAL_TYPE.NONE]: FastNoise.FractalType.None,
  [FRACTAL_TYPE.FBM]: FastNoise.FractalType.FBm,
  [FRACTAL_TYPE.RIDGED]: FastNoise.FractalType.Ridged,
  [FRACTAL_TYPE.PING_PONG]: FastNoise.FractalType.PingPong,
};

export class FastNoiseLite {
  constructor() {
    this._noise = new FastNoise(0);
    this._seed = 0;
    this.noise_type = NOISE_TYPE.SIMPLEX_SMOOTH;
    this.fractal_type = FRACTAL_TYPE.FBM;
    this.frequency = 0.01;
    this.fractal_octaves = 5;
    this.fractal_lacunarity = 2.0;
    this.fractal_gain = 0.5;
  }
  set seed(value) {
    this._seed = value | 0;
    this._noise.SetSeed(this._seed);
  }
  get seed() {
    return this._seed;
  }
  set noise_type(type) {
    this._type = type;
    this._noise.SetNoiseType(TYPE_MAP[type]);
  }
  get noise_type() {
    return this._type;
  }
  set fractal_type(type) {
    this._fractal = type;
    this._noise.SetFractalType(FRACTAL_MAP[type]);
  }
  get fractal_type() {
    return this._fractal;
  }
  set frequency(value) {
    this._frequency = value;
    this._noise.SetFrequency(value);
  }
  get frequency() {
    return this._frequency;
  }
  set fractal_octaves(value) {
    this._octaves = value;
    this._noise.SetFractalOctaves(value);
  }
  set fractal_lacunarity(value) {
    this._noise.SetFractalLacunarity(value);
  }
  set fractal_gain(value) {
    this._noise.SetFractalGain(value);
  }
  get_noise_2d(x, y) {
    return this._noise.GetNoise(x, y);
  }
  get_noise_3d(x, y, z) {
    return this._noise.GetNoise(x, y, z);
  }
  get_noise_3dv(v) {
    return this._noise.GetNoise(v.x, v.y, v.z);
  }
}

/**
 * GPU profiler — how long each pass of the pipeline takes, on the GPU (timer queries,
 * EXT_disjoint_timer_query_webgl2) and on the CPU (the JavaScript that issues it). A development
 * tool: the pipeline marks its passes with `profiler?.section(name)` when one is attached, and pays
 * nothing when none is.
 *
 *   const { GpuProfiler } = await import('/src/dev/gpu_profiler.js');
 *   const profiler = GpuProfiler.attach(window.chainmate.pipeline);  // null when the browser hides the timers
 *   // … some frames later …
 *   profiler.report();  // { frames, gpuMs, cpuMs, sections: [{ name, gpu: {mean, p50, p95}, cpu: {…}, share }] }
 *
 * The queries are asynchronous: a frame's times arrive a few frames later and are polled, never
 * waited for (waiting would stall the pipeline and change what is measured). Only one query of this
 * kind may be open at a time, so sections follow one another: opening a section closes the one
 * before. A frame the GPU reports as disjoint (a power-state change, a context switch) is dropped
 * whole. Samples live in fixed-size rings: O(sections) per frame, O(window · log window) per report.
 */

/** Frames of samples each section keeps (a few seconds at 60 frames per second). */
const WINDOW = 240;
/** Query objects the pool may hold before it stops creating more (results that never come are dropped). */
const MAX_QUERIES = 512;
const NANOSECONDS_PER_MILLISECOND = 1e6;

/** A fixed-size ring of numbers. */
class Ring {
  constructor(size) {
    this.values = new Float64Array(size);
    this.count = 0;
    this.next = 0;
  }

  push(value) {
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
  }

  /** Mean and percentiles of what the ring holds. O(n log n). */
  summary() {
    if (this.count === 0) return { mean: 0, p50: 0, p95: 0, max: 0 };
    const sorted = Array.from(this.values.subarray(0, this.count)).sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
    return { mean, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
  }
}

export class GpuProfiler {
  /**
   * Attaches a profiler to the pipeline (it starts measuring from the next frame).
   * @returns {GpuProfiler|null} null when the browser offers no GPU timers
   */
  static attach(pipeline) {
    const gl = pipeline.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return null;
    const profiler = new GpuProfiler(gl, ext);
    pipeline.profiler = profiler;
    return profiler;
  }

  /** Stops measuring. */
  static detach(pipeline) {
    pipeline.profiler?.dispose();
    pipeline.profiler = null;
  }

  constructor(gl, ext) {
    this.gl = gl;
    this.ext = ext;
    this.pool = [];
    this.created = 0;
    /** Frames whose queries are still in flight: [{ entries: [{name, query}], cpu: Map }]. */
    this.inFlight = [];
    this.current = null;
    this.open = null;
    this.cpuStart = 0;
    /** name → { gpu: Ring, cpu: Ring } */
    this.sections = new Map();
    this.order = [];
    this.frames = 0;
    this.dropped = 0;
    this.gpuTotal = new Ring(WINDOW);
    this.cpuTotal = new Ring(WINDOW);
  }

  _query() {
    if (this.pool.length > 0) return this.pool.pop();
    if (this.created >= MAX_QUERIES) return null;
    this.created += 1;
    return this.gl.createQuery();
  }

  _section(name) {
    let section = this.sections.get(name);
    if (!section) {
      section = { gpu: new Ring(WINDOW), cpu: new Ring(WINDOW) };
      this.sections.set(name, section);
      this.order.push(name);
    }
    return section;
  }

  /** Opens section `name` (closing the one before). The first section of a frame opens the frame. */
  section(name) {
    this.close();
    if (!this.current) this.current = { entries: [], cpu: new Map() };
    const query = this._query();
    if (query) this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.open = { name, query };
    this.cpuStart = performance.now();
  }

  /** Closes the open section, if any. */
  close() {
    if (!this.open) return;
    if (this.open.query) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    const cpu = performance.now() - this.cpuStart;
    this.current.cpu.set(this.open.name, (this.current.cpu.get(this.open.name) ?? 0) + cpu);
    this.current.entries.push(this.open);
    this.open = null;
  }

  /** At the end of a frame: closes it and collects every finished frame. O(sections in flight). */
  endFrame() {
    this.close();
    if (this.current) {
      this.inFlight.push(this.current);
      this.current = null;
    }
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.inFlight.length > 0) {
      const frame = this.inFlight[0];
      const ready = frame.entries.every(({ query }) => !query || gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE));
      if (!ready && !disjoint) break;
      this.inFlight.shift();
      if (disjoint || frame.entries.some(({ query }) => !query)) {
        this.dropped += 1;
      } else {
        const gpu = new Map();
        for (const { name, query } of frame.entries) gpu.set(name, (gpu.get(name) ?? 0) + gl.getQueryParameter(query, gl.QUERY_RESULT) / NANOSECONDS_PER_MILLISECOND);
        let gpuSum = 0;
        let cpuSum = 0;
        for (const [name, ms] of gpu) {
          this._section(name).gpu.push(ms);
          gpuSum += ms;
        }
        for (const [name, ms] of frame.cpu) {
          this._section(name).cpu.push(ms);
          cpuSum += ms;
        }
        this.gpuTotal.push(gpuSum);
        this.cpuTotal.push(cpuSum);
        this.frames += 1;
      }
      for (const { query } of frame.entries) if (query) this.pool.push(query);
    }
  }

  /** Forgets every sample (after changing what is drawn, to measure the new state alone). */
  reset() {
    this.sections.clear();
    this.order.length = 0;
    this.frames = 0;
    this.dropped = 0;
    this.gpuTotal = new Ring(WINDOW);
    this.cpuTotal = new Ring(WINDOW);
  }

  /** What was measured, section by section in pipeline order, with each section's share of the GPU. */
  report() {
    const gpuMs = this.gpuTotal.summary();
    const cpuMs = this.cpuTotal.summary();
    const sections = this.order.map((name) => {
      const section = this.sections.get(name);
      const gpu = section.gpu.summary();
      return { name, gpu, cpu: section.cpu.summary(), share: gpuMs.mean > 0 ? gpu.mean / gpuMs.mean : 0 };
    });
    return { frames: this.frames, dropped: this.dropped, gpuMs, cpuMs, sections };
  }

  dispose() {
    this.close();
    for (const frame of this.inFlight) for (const { query } of frame.entries) if (query) this.gl.deleteQuery(query);
    for (const query of this.pool) this.gl.deleteQuery(query);
    this.inFlight.length = 0;
    this.pool.length = 0;
  }
}

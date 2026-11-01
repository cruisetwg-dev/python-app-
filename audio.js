// Web Audio engine:
//   source -> 3-band EQ -> saturation (parallel) -> stereo spread (M/S) -> compressor -> makeup
//          -> limiter -> master -> analyser -> speakers
// Each fader writes straight to its BiquadFilterNode gain AudioParam, so changes are heard immediately.
// Mastering presets (see eq.js) drive everything after the EQ via applyMaster().

const DEFAULT_MASTER = {
  masterGain: 0.8,
  comp: { threshold: -24, knee: 0, ratio: 1, attack: 0.003, release: 0.25, makeup: 1.0 },
  limiter: { threshold: 0, knee: 0, ratio: 1, attack: 0.001, release: 0.05 },
  saturation: 0,
  spread: 1,
  analyzeOnly: false,   // defaults are already neutral; presets that omit this must not silently bypass processing
};

// Recursively merge plain objects into a fresh copy; `override` wins, undefined/null fields keep the base value.
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function deepMerge(base, override) {
  const out = {};
  for (const k of new Set([...Object.keys(base ?? {}), ...Object.keys(override ?? {})])) {
    const b = base?.[k], o = override?.[k];
    out[k] = isObj(b) || isObj(o) ? deepMerge(isObj(b) ? b : {}, isObj(o) ? o : {}) : (o ?? b);
  }
  return out;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const toDb = x => (x > 1e-10 ? 10 * Math.log10(x) : -Infinity);

export class AudioEngine {
  constructor(bands) {
    this.bands = bands;
    this.ctx = null;
    this.playing = false;
    this.stopSource = null;
    this.pending = bands.map(() => 0);        // gains set before the context exists
    this.master_ = DEFAULT_MASTER;            // mastering settings set before the context exists
  }

  _init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const stereo = n => { n.channelCount = 2; n.channelCountMode = 'explicit'; n.channelInterpretation = 'speakers'; return n; };

    this.filters = this.bands.map((b, i) => {
      const f = ctx.createBiquadFilter();
      f.type = b.type; f.frequency.value = b.freq; f.Q.value = b.q; f.gain.value = this.pending[i];
      return f;
    });
    this.input = stereo(ctx.createGain());    // mono sources are upmixed to both channels

    // saturation: dry + tanh-shaped wet in parallel
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(2.5 * x) / Math.tanh(2.5); }
    this.shaper = ctx.createWaveShaper(); this.shaper.curve = curve; this.shaper.oversample = '2x';
    this.dry = ctx.createGain(); this.wet = ctx.createGain();
    const satSum = stereo(ctx.createGain());

    // stereo spread: mid/side matrix, side scaled by `spread`
    const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
    const g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const mL = g(0.5), mR = g(0.5), sL = g(0.5), sR = g(-0.5);
    const midSum = g(1); this.sideSum = g(1); const sideInv = g(-1);

    this.comp = ctx.createDynamicsCompressor();
    this.makeup = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0.8;

    const chain = [this.input, ...this.filters];
    chain.reduce((a, b) => (a.connect(b), b));
    const eqOut = chain[chain.length - 1];
    eqOut.connect(this.dry); this.dry.connect(satSum);
    eqOut.connect(this.shaper); this.shaper.connect(this.wet); this.wet.connect(satSum);
    satSum.connect(split);
    split.connect(mL, 0); split.connect(mR, 1); split.connect(sL, 0); split.connect(sR, 1);
    mL.connect(midSum); mR.connect(midSum); sL.connect(this.sideSum); sR.connect(this.sideSum);
    midSum.connect(merge, 0, 0); this.sideSum.connect(merge, 0, 0);          // L = M + S
    midSum.connect(merge, 0, 1); this.sideSum.connect(sideInv); sideInv.connect(merge, 0, 1);  // R = M - S
    [merge, this.comp, this.makeup, this.limiter, this.master, this.analyser].reduce((a, b) => (a.connect(b), b));
    this.analyser.connect(ctx.destination);

    // meters tap the master output: sample peak per channel, and K-weighted power per channel (BS.1770-style)
    const mSplit = ctx.createChannelSplitter(2);
    this.master.connect(mSplit);
    const tap = (from, out, fft) => { const a = ctx.createAnalyser(); a.fftSize = fft; from.connect(a, out); return a; };
    this.peakAn = [tap(mSplit, 0, 2048), tap(mSplit, 1, 2048)];
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
    const hs = ctx.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 1681; hs.gain.value = 4;
    stereo(hp); this.master.connect(hp); hp.connect(hs);
    const kSplit = ctx.createChannelSplitter(2); hs.connect(kSplit);
    this.kAn = [tap(kSplit, 0, 32768), tap(kSplit, 1, 32768)];
    this._peakBuf = new Float32Array(2048); this._kBuf = new Float32Array(32768);

    this._applyMaster(true);
  }

  resume() { this._init(); if (this.ctx.state !== 'running') this.ctx.resume(); }

  setGain(i, db) {
    this.pending[i] = db;
    if (!this.filters) return;
    // short ramp avoids zipper noise while still tracking the finger in real time
    this.filters[i].gain.setTargetAtTime(db, this.ctx.currentTime, 0.015);
  }

  // Apply a mastering preset (from eq.js) to everything after the EQ. Pass null for transparent defaults.
  // Missing fields (including inside comp/limiter) fall back to DEFAULT_MASTER.
  // Fader (EQ) values are set separately through setGain().
  applyMaster(preset) {
    this.master_ = deepMerge(DEFAULT_MASTER, preset);
    if (this.ctx) this._applyMaster(false);
  }

  _applyMaster(immediate) {
    const p = this.master_, t = this.ctx.currentTime, tc = immediate ? 0.001 : 0.02;
    const set = (param, v) => param.setTargetAtTime(v, t, tc);
    const dyn = (node, d) => {
      set(node.threshold, clamp(d.threshold, -100, 0)); set(node.knee, clamp(d.knee, 0, 40));
      set(node.ratio, clamp(d.ratio, 1, 20)); set(node.attack, clamp(d.attack, 0, 1)); set(node.release, clamp(d.release, 0, 1));
    };
    const meterOnly = !!p.analyzeOnly;
    dyn(this.comp, p.comp); dyn(this.limiter, p.limiter);
    set(this.makeup.gain, meterOnly ? 1 : (p.comp.makeup ?? 1));
    // `saturation` is an amount: parallel wet mix = 5x amount (0.06 -> 30% wet)
    const wet = meterOnly ? 0 : clamp(p.saturation * 5, 0, 1);
    set(this.wet.gain, wet); set(this.dry.gain, 1 - wet);
    set(this.sideSum.gain, meterOnly ? 1 : p.spread);
    set(this.master.gain, p.masterGain);
  }

  spectrum(out) {
    if (!this.analyser || !this.playing) return 0;
    this.analyser.getByteFrequencyData(out);
    return Math.min(out.length, this.analyser.frequencyBinCount);
  }

  // Approximate meters at the output. lufs: momentary (400 ms) K-weighted loudness.
  // peak: sample peak in dBFS (no oversampling, so it can under-read true peak by a fraction of a dB).
  meter() {
    if (!this.kAn || !this.playing) return null;
    const buf = this._kBuf, n = Math.min(Math.ceil(0.4 * this.ctx.sampleRate), buf.length);
    let power = 0;
    for (const a of this.kAn) {
      a.getFloatTimeDomainData(buf);
      let s = 0; for (let i = buf.length - n; i < buf.length; i++) s += buf[i] * buf[i];
      power += s / n;
    }
    let pk = 0;
    for (const a of this.peakAn) {
      a.getFloatTimeDomainData(this._peakBuf);
      for (let i = 0; i < this._peakBuf.length; i++) pk = Math.max(pk, Math.abs(this._peakBuf[i]));
    }
    return { lufs: toDb(power) - 0.691, peak: 20 * Math.log10(Math.max(pk, 1e-6)) };
  }

  async start(kind, file) {
    this.resume();
    this.stop();
    if (kind === 'synth') this._synth();
    else if (kind === 'noise') this._noise();
    else if (kind === 'mic') await this._mic();
    else if (kind === 'file') {
      if (!file) throw new Error('Choose an audio file first.');
      await this._file(file);
    }
    this.playing = true;
  }

  stop() {
    if (this.stopSource) this.stopSource();
    this.stopSource = null;
    this.playing = false;
  }

  // Looping demo with energy in every band: sub kick, saw bass/chords, hats.
  _synth() {
    const ctx = this.ctx, bpm = 110, beat = 60 / bpm, bars = 2, len = beat * 4 * bars;
    const buf = ctx.createBuffer(1, Math.ceil(len * ctx.sampleRate), ctx.sampleRate);
    const d = buf.getChannelData(0), sr = ctx.sampleRate;
    const add = (t, dur, fn) => {
      const s = Math.floor(t * sr), n = Math.floor(dur * sr);
      for (let k = 0; k < n && s + k < d.length; k++) d[s + k] += fn(k / sr, k / n);
    };
    for (let b = 0; b < 4 * bars; b++) {
      const t = b * beat;
      add(t, 0.3, (x, p) => Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-x * 30)) * x) * Math.exp(-p * 5) * 0.9); // kick
      const root = [55, 55, 65.4, 49][Math.floor(b / 2) % 4];
      add(t, beat * 0.9, (x, p) => ((x * root * 2 % 1) * 2 - 1) * 0.25 * (1 - p));                              // bass
      const ch = [220, 277.2, 329.6];
      if (b % 2 === 0) ch.forEach(f => add(t, beat * 1.8, (x, p) => ((x * f % 1) * 2 - 1) * 0.07 * Math.exp(-p * 2))); // chord
      for (const o of [0, 0.5]) add(t + o * beat, 0.05, (x, p) => (Math.random() * 2 - 1) * 0.25 * Math.exp(-p * 8));  // hats
      if (b % 2 === 1) add(t, 0.15, (x, p) => (Math.random() * 2 - 1) * 0.4 * Math.exp(-p * 6));                       // snare
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    src.connect(this.input); src.start();
    this.stopSource = () => { try { src.stop(); } catch {} src.disconnect(); };
  }

  _noise() {
    const ctx = this.ctx, n = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;          // Paul Kellet pink-noise filter
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    src.connect(this.input); src.start();
    this.stopSource = () => { try { src.stop(); } catch {} src.disconnect(); };
  }

  async _file(file) {
    const audioBuf = await this.ctx.decodeAudioData(await file.arrayBuffer());
    const src = this.ctx.createBufferSource(); src.buffer = audioBuf; src.loop = true;
    src.connect(this.input); src.start();
    this.stopSource = () => { try { src.stop(); } catch {} src.disconnect(); };
  }

  async _mic() {
    // Mic into speakers can feed back; EQ boosts make it worse. Use headphones.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false } });
    const src = this.ctx.createMediaStreamSource(stream);
    src.connect(this.input);
    this.stopSource = () => { src.disconnect(); stream.getTracks().forEach(t => t.stop()); };
  }
}

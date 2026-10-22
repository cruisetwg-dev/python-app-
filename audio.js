// Web Audio engine: source -> low shelf -> mid peak -> high shelf -> master -> analyser -> speakers.
// Each fader writes straight to its BiquadFilterNode gain AudioParam, so changes are heard immediately.
export class AudioEngine {
  constructor(bands) {
    this.bands = bands;
    this.ctx = null;
    this.playing = false;
    this.source = null;
    this.stopSource = null;
    this.pending = bands.map(() => 0);        // gains set before the context exists
  }

  _init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.filters = this.bands.map((b, i) => {
      const f = ctx.createBiquadFilter();
      f.type = b.type; f.frequency.value = b.freq; f.Q.value = b.q; f.gain.value = this.pending[i];
      return f;
    });
    this.input = ctx.createGain();
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0.8;
    [this.input, ...this.filters, this.master, this.analyser].reduce((a, b) => (a.connect(b), b));
    this.analyser.connect(ctx.destination);
  }

  resume() { this._init(); if (this.ctx.state !== 'running') this.ctx.resume(); }

  setGain(i, db) {
    this.pending[i] = db;
    if (!this.filters) return;
    // short ramp avoids zipper noise while still tracking the finger in real time
    this.filters[i].gain.setTargetAtTime(db, this.ctx.currentTime, 0.015);
  }

  spectrum(out) {
    if (!this.analyser || !this.playing) return 0;
    this.analyser.getByteFrequencyData(out);
    return Math.min(out.length, this.analyser.frequencyBinCount);
  }

  async start(kind, file) {
    this.resume();
    this.stop();
    const ctx = this.ctx;
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

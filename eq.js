// eq.js
// Shared EQ config + mastering target presets.
// This is the source of truth used by both UI and engine.

export const EQ = {
  rangeDb: 15,
  bands: [
    { name: 'LOW',  type: 'lowshelf',  freq: 200,  q: 0.7, freqLabel: '200 Hz', color: '#ff6b6b' },
    { name: 'MID',  type: 'peaking',   freq: 1000, q: 0.9, freqLabel: '1 kHz',  color: '#ffd166' },
    { name: 'HIGH', type: 'highshelf', freq: 5000, q: 0.7, freqLabel: '5 kHz',  color: '#5ee1ff' },
  ],
};

export const MASTER_PRESETS = {
  A: {
    id: 'A',
    label: 'Apple / iTunes',
    description: 'Clean, slightly less aggressive than Spotify',
    lufsTarget: -16,
    truePeakLimit: -1.0,
    masterGain: 0.90,
    eq: { low: 1.0, mid: 0.3, high: 0.0 },
    comp: {
      threshold: -18,
      knee: 25,
      ratio: 2.5,
      attack: 0.02,
      release: 0.18,
      makeup: 1.0
    },
    limiter: {
      threshold: -1.0,
      knee: 0.5,
      ratio: 20,
      attack: 0.001,
      release: 0.05
    },
    saturation: 0.06,
    spread: 1.02,
    analyzeOnly: false
  },

  B: {
    id: 'B',
    label: 'Spotify',
    description: 'Streaming-safe loudness target',
    lufsTarget: -14,
    truePeakLimit: -1.0,
    masterGain: 0.95,
    eq: { low: 1.5, mid: 0.5, high: -0.5 },
    comp: {
      threshold: -16,
      knee: 20,
      ratio: 3.0,
      attack: 0.015,
      release: 0.15,
      makeup: 1.0
    },
    limiter: {
      threshold: -1.0,
      knee: 0.5,
      ratio: 20,
      attack: 0.001,
      release: 0.04
    },
    saturation: 0.08,
    spread: 1.06,
    analyzeOnly: false
  },

  C: {
    id: 'C',
    label: 'Custom',
    description: 'User-defined streaming target',
    lufsTarget: -15,
    truePeakLimit: -1.2,
    masterGain: 0.92,
    eq: { low: 1.2, mid: 0.6, high: -0.2 },
    comp: {
      threshold: -17,
      knee: 22,
      ratio: 2.8,
      attack: 0.018,
      release: 0.16,
      makeup: 1.0
    },
    limiter: {
      threshold: -1.2,
      knee: 0.6,
      ratio: 20,
      attack: 0.001,
      release: 0.04
    },
    saturation: 0.07,
    spread: 1.04,
    analyzeOnly: false
  },

  T: {
    id: 'T',
    label: 'Test',
    description: 'Meter-only mode, no final processing',
    lufsTarget: null,
    truePeakLimit: null,
    masterGain: 1.0,
    eq: { low: 0, mid: 0, high: 0 },
    comp: { threshold: -100, knee: 0, ratio: 1, attack: 0.001, release: 0.02, makeup: 1.0 },
    limiter: { threshold: -2.0, knee: 0.0, ratio: 1.0, attack: 0.001, release: 0.02 },
    saturation: 0,
    spread: 1,
    analyzeOnly: true
  },
};

export function applyPresetToFaders(preset, engine) {
  if (!engine || !engine.filters) return;

  const bandMap = {
    low: 0,
    mid: 1,
    high: 2,
  };

  Object.entries(preset.eq).forEach(([bandName, gainDb]) => {
    const idx = bandMap[bandName];
    if (idx !== undefined && engine.filters[idx]) {
      engine.setGain(idx, gainDb);
    }
  });
}

export function getPresetById(id) {
  return MASTER_PRESETS[id] || MASTER_PRESETS.B;
}

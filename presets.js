export const TARGET_PRESETS = {
  A: { label: 'Apple/iTunes', lufs: -16, truePeak: -1.0, low: 1.0, mid: 0.3, high: 0.0, master: 0.9 },
  B: { label: 'Spotify', lufs: -14, truePeak: -1.0, low: 1.5, mid: 0.5, high: -0.5, master: 0.95 },
  C: { label: 'Custom', lufs: -15, truePeak: -1.2, low: 1.2, mid: 0.6, high: -0.2, master: 0.92 },
  T: { label: 'Test', lufs: null, truePeak: null, passiveOnly: true }
};

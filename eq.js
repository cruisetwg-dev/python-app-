// 3-band EQ definition shared by the UI and the audio engine.
export const EQ = {
  rangeDb: 15,
  bands: [
    { name: 'LOW',  type: 'lowshelf',  freq: 200,  q: 0.7, freqLabel: '200 Hz', color: '#ff6b6b' },
    { name: 'MID',  type: 'peaking',   freq: 1000, q: 0.9, freqLabel: '1 kHz',  color: '#ffd166' },
    { name: 'HIGH', type: 'highshelf', freq: 5000, q: 0.7, freqLabel: '5 kHz',  color: '#5ee1ff' },
  ],
};

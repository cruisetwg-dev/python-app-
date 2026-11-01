# 3D Touch EQ

A touch-friendly 3D mixer: three faders (Low / Mid / High) each control one band of a
real-time 3-band EQ built from Web Audio `BiquadFilterNode`s. A 3D spectrum analyser
shows the effect of every move live.

| Fader | Filter      | Frequency | Range     |
|-------|-------------|-----------|-----------|
| LOW   | low shelf   | 200 Hz    | ±15 dB    |
| MID   | peaking     | 1 kHz     | ±15 dB    |
| HIGH  | high shelf  | 5 kHz     | ±15 dB    |

## Run
```
python3 -m http.server 8000   # then open http://localhost:8000
```
(Any static server works; ES modules need http, not file://.) Three.js is vendored in `vendor/`.

## Use
- **Start**, then pick a source: demo loop, pink noise, your own audio file, or microphone (use headphones to avoid feedback).
- Drag a fader (touch, mouse or pen; multi-touch lets you move several at once). Audio changes as you drag.
- Drag the background to orbit, pinch/scroll to zoom, double-tap a fader to reset it.

Files: `index.html` (3D UI), `audio.js` (audio graph/sources), `eq.js` (band definitions).

## Mastering presets
The **Preset** dropdown (A Apple/iTunes, B Spotify, C Custom, T Test) is defined in `eq.js`. Picking one moves the
three faders to the preset's EQ values and configures saturation, stereo spread, compressor, limiter and master gain.
`T` is meter-only (EQ flat, no processing). **Reset EQ** returns the faders and the mastering chain to neutral.

The meter (bottom right) shows approximate momentary loudness (K-weighted, 400 ms) and sample peak. Presets do not
auto-normalise to their LUFS target; the target is shown so you can ride the faders/source level toward it.

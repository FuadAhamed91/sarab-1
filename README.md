# SARAB-1 · Gulf GNSS Interference Watch

**SARAB-1** (سراب, "mirage") is a 1U CubeSat concept that listens to GPS signals over the Arabian Gulf and the Strait of Hormuz and flags where they are being jammed or faked. This repository holds the ground station dashboard, the 3D model of the tabletop prototype, and the build files.

Team CodeBusters · Al Ain University · SatForge UAE 2026

## What's here

| Path | What it is |
| --- | --- |
| `index.html` | Ground station dashboard: 3D Earth view, detection status, receiver health, signal strength per satellite, sky plot, spoofing checks, housekeeping, event log, raw telemetry |
| `model.html` | Interactive 3D model of the prototype with exploded view, part callouts and the foam cut list |
| `src/` | Dashboard code (plain ES modules, no build step) |
| `hardware/build_model.py` | Single source of truth for the mechanical design; writes the part list and the Tinkercad STL files |
| `hardware/stl/` | STL files for Tinkercad, one per colour group, plus a merged assembly |

## How the live link works

1. The prototype's ESP32 reads the u-blox receiver (signal strength per satellite, noise level, jamming indicator, gain), the INA219 power sensor and the MPU6050 motion sensor.
2. It runs the detection on board and publishes one JSON packet per second over MQTT to a public relay (`broker.hivemq.com`, with `broker.emqx.io` as the fallback) on topic `sarab1/cb-7f3a91/tm`.
3. The dashboard subscribes over a secure WebSocket and updates every panel as each packet lands.

When the cube is not transmitting, the dashboard shows a clearly labelled simulated pass in the same packet format. It switches to live data on its own as soon as packets arrive.

## Telemetry packet

```json
{
  "sat": "SARAB-1", "seq": 4821, "utc": "2026-10-23T08:20:31Z", "src": "HW",
  "gnss": { "fix": "3D", "lat": 24.2075, "lon": 55.7447, "nsat": 9, "agc_pct": 57.6, "noise": 101, "jam_ind": 9,
            "sats": [ { "prn": 2, "el": 62, "az": 40, "cn0": 44, "b": 44.1 } ] },
  "det":  { "index": 4, "state": "NOMINAL", "drop_db": 0.2, "cn0_mean": 40.3, "cn0_sd": 4.4, "cn0_el_r": 0.93, "pos_dev_km": 0.1 },
  "eps":  { "solar_w": 0.81, "vbat": 4.03, "soc_pct": 78, "load_w": 1.06 },
  "adcs": { "roll_deg": 0.4, "pitch_deg": -1.1, "vib_g": 0.019 },
  "therm": { "board_c": 31.4 }
}
```

`src` is `HW` from the cube, `TEST` from the test transmitter (`index.html?transmit`), and `SIM` for the built-in simulation.

## Detection

The Interference Index (0–100) fuses four symptoms: how far signal strength has dropped below each satellite's clean baseline, how much the noise level has risen, the receiver's jamming indicator, and how far it has cut its gain. Above 30 the cube reports interference suspected; above 60, jamming. Spoofing is flagged when every satellite arrives at nearly the same strength regardless of its elevation and the position fix moves away from where it should be.

No jammer is ever used. Tests use signal blocking, local electronic noise and replayed spoofed tracks; jamming equipment is illegal in the UAE.

## Credits

Earth imagery: NASA Blue Marble and Black Marble, via the three-globe example set. 3D rendering: three.js. Coastlines are simplified and schematic.

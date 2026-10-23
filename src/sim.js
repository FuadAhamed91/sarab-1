/* Telemetry simulator. Produces packets in exactly the JSON format the SARAB-1
   prototype sends, so the dashboard treats simulated and live data the same way. */

export const PASS = 120;          // seconds per simulated pass over the Gulf
export const NSAT = 10;
export const ALT_KM = 525;
export const BASE = { noise: 100, jam: 8, agc: 58 };

const rad = d => d * Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* Ground track of the simulated descending pass: enters over southern Iran,
   crosses the Strait of Hormuz, passes Khor Fakkan and Al Ain, exits over the Rub' al Khali. */
export const trackAt = tl => { const f = tl / PASS; return { lat: 31 - 8.4 * f, lon: 57.94 - 2.54 * f }; };
const script = tl => (tl >= 58 && tl < 78) ? { j: 1, s: 0 } : (tl >= 82 && tl < 98) ? { j: 0, s: 1 } : { j: 0, s: 0 };

export function corr(a, b) {
  const n = a.length; if (n < 3) return 0;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  return (saa > 0 && sbb > 0) ? sab / Math.sqrt(saa * sbb) : 0;
}

/* Detection, identical to the flight computer's: fuse signal drop, noise rise,
   jamming indicator and gain cut into a 0-100 Interference Index; flag spoofing
   when every satellite arrives at the same strength and the fix leaves the predicted track. */
export function detect({ drop, noise, jam, agc, sd, dev }, base = BASE) {
  const jamScore = 0.35 * clamp(drop / 12, 0, 1) + 0.25 * clamp((noise - base.noise) / 60, 0, 1)
    + 0.2 * clamp((jam - base.jam) / 120, 0, 1) + 0.2 * clamp((base.agc - agc) / 30, 0, 1);
  const spoofScore = clamp((3 - sd) / 2, 0, 1) * clamp((dev - 2) / 12, 0, 1);
  return { jamScore, spoofScore, index: Math.round(clamp(100 * Math.max(jamScore, 0.9 * spoofScore), 0, 100)) };
}
export function classify(index, spoofScore, prev) {
  if (spoofScore > (prev === 'SPOOFING' ? 0.35 : 0.5)) return 'SPOOFING';
  if (index >= (prev === 'JAMMING' ? 55 : 60)) return 'JAMMING';
  if (index >= ((prev === 'SUSPECT' || prev === 'JAMMING') ? 25 : 30)) return 'SUSPECT';
  return 'NOMINAL';
}

export class Simulator {
  constructor(seed = 20261023) {
    this.seed = seed >>> 0;
    this.t = -121; this.seq = 4700; this.J = 0; this.Sp = 0; this.soc = 0.78;
    this.mode = 'auto'; this.state = 'NOMINAL';
    this.sats = [[2, 40, 62], [5, 115, 48], [7, 300, 35], [9, 200, 71], [13, 250, 22], [15, 15, 18], [18, 150, 30], [21, 330, 55], [26, 85, 12], [29, 265, 44]]
      .map(([prn, az, el]) => ({ prn, az, el, off: (this.rnd() - 0.5) * 3, base: 0, cn0: 0 }));
    this.sats.forEach(s => { s.base = 30 + 16 * Math.sin(rad(s.el)) + s.off; });
  }
  rnd() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  gauss() { return (this.rnd() + this.rnd() + this.rnd() + this.rnd() - 2) * 1.732; }
  get tl() { return ((this.t % PASS) + PASS) % PASS; }

  /* Advance one second and return the packet for that second. */
  step(now) {
    this.t++; this.seq++;
    const tl = this.tl;
    const tg = this.mode === 'auto' ? script(tl) : this.mode === 'jam' ? { j: 1, s: 0 } : this.mode === 'spoof' ? { j: 0, s: 1 } : { j: 0, s: 0 };
    this.J += (tg.j - this.J) * 0.3; if (this.J < 0.003) this.J = 0;
    this.Sp += (tg.s - this.Sp) * 0.5; if (this.Sp < 0.003) this.Sp = 0;
    const J = this.J, Sp = this.Sp;
    let drop = 0;
    for (const s of this.sats) {
      s.az = (s.az + 0.04) % 360;
      let v = s.base + this.gauss() * 0.6 - J * (14 + Math.abs(s.off) * 1.5);
      if (Sp > 0) v = v * (1 - Sp) + (43.6 + this.gauss() * 0.3) * Sp;
      s.cn0 = clamp(v, 0, 55);
      drop += Math.max(0, s.base - Math.max(s.cn0, 15));
    }
    drop /= NSAT;
    const tr = this.sats.filter(s => s.cn0 >= 22), n = tr.length;
    const mean = n ? tr.reduce((a, s) => a + s.cn0, 0) / n : 0;
    const sd = n > 1 ? Math.sqrt(tr.reduce((a, s) => a + (s.cn0 - mean) ** 2, 0) / (n - 1)) : 0;
    const r = corr(tr.map(s => Math.sin(rad(s.el))), tr.map(s => s.cn0));
    const noise = BASE.noise + J * 72 + this.gauss() * 2.5;
    const jam = Math.round(clamp(BASE.jam + J * 150 + this.gauss() * 3, 0, 255));
    const agc = clamp(BASE.agc - J * 28 + Sp * 3 + this.gauss() * 0.6, 0, 100);
    const dev = Sp * 38 + Math.abs(this.gauss()) * 0.2;
    const d = detect({ drop, noise, jam, agc, sd, dev });
    const index = Math.round(clamp(d.index + 2 + this.rnd() * 3, 0, 100));
    this.state = classify(index, d.spoofScore, this.state);
    const pos = trackAt(tl);
    const solar = clamp(0.80 + this.gauss() * 0.02, 0, 1.1);
    const load = 1.06 + (this.state !== 'NOMINAL' ? 0.05 : 0) + this.gauss() * 0.012;
    this.soc = clamp(this.soc - (load - solar) / 3.7 / 3600, 0, 1);
    const fixLat = pos.lat - dev / 111 * 0.55, fixLon = pos.lon - dev / (111 * Math.cos(rad(pos.lat))) * 0.8;
    return {
      sat: 'SARAB-1', seq: this.seq, utc: new Date(now).toISOString().slice(0, 19) + 'Z', src: 'SIM',
      orbit: { tl: +tl.toFixed(0), alt_km: ALT_KM, lat: +pos.lat.toFixed(3), lon: +pos.lon.toFixed(3) },
      gnss: {
        fix: '3D', lat: +fixLat.toFixed(4), lon: +fixLon.toFixed(4), nsat: n,
        agc_pct: +agc.toFixed(1), noise: Math.round(noise), jam_ind: jam,
        sats: this.sats.map(s => ({ prn: s.prn, el: s.el, az: Math.round(s.az), cn0: s.cn0 >= 22 ? Math.round(s.cn0) : 0, b: +s.base.toFixed(1) }))
      },
      det: { index, state: this.state, drop_db: +drop.toFixed(1), cn0_mean: +mean.toFixed(1), cn0_sd: +sd.toFixed(2), cn0_el_r: +r.toFixed(2), pos_dev_km: +dev.toFixed(1) },
      eps: { solar_w: +solar.toFixed(2), vbat: +(3.45 + 0.75 * this.soc).toFixed(2), soc_pct: Math.round(this.soc * 100), load_w: +load.toFixed(2) },
      adcs: { roll_deg: +(1.4 * Math.sin(this.t / 9) + this.gauss() * 0.15).toFixed(1), pitch_deg: +(1.0 * Math.cos(this.t / 11) + this.gauss() * 0.15).toFixed(1), vib_g: +(0.018 + Math.abs(this.gauss()) * 0.004).toFixed(3) },
      therm: { board_c: +(31.2 + 0.6 * Math.sin(this.t / 40) + this.gauss() * 0.05).toFixed(1) }
    };
  }
}

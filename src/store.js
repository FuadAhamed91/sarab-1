/* Telemetry store: ingests packets (simulated or live, same format), keeps the
   last two minutes of history and turns state changes into events and map zones. */
import { BASE, corr, detect, classify } from './sim.js';
import { placeOf, GROUND_STATION } from './gulf.js';
import { parseAck, COMMANDS, REJECT } from './command.js';

export const HIST = 120;
export const VERDICT = { NOMINAL: 'Clean signal', SUSPECT: 'Interference suspected', JAMMING: 'Jamming detected', SPOOFING: 'Spoofing detected' };
export const EVENTS = {
  jam: { name: 'Jamming detected', cls: 'crit', mean: 'Ships and aircraft here may lose GPS. Cross-check with radar and inertial navigation.' },
  spoof: { name: 'Spoofing detected', cls: 'spoof', mean: 'GPS positions here can’t be trusted, even when they look normal.' },
  suspect: { name: 'Interference suspected', cls: 'warn', mean: 'Signals are weakening. Watching for jamming.' },
  clear: { name: 'Signals back to normal', cls: 'good', mean: 'GPS is safe to use here again.' },
  cmd: { name: 'Command accepted', cls: 'info', mean: 'The cube checked the signature and ran the command.' },
  cmdbad: { name: 'Command rejected', cls: 'warn', mean: 'The cube ignored a command that failed its checks.' }
};

const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v)) ? v : (v != null && isFinite(+v) ? +v : d);

export class Store {
  constructor() { this.reset(); }
  reset() {
    this.hist = { index: [], cn0: [], nsat: [], noise: [], jam: [], agc: [], dev: [], spoof: [] };
    this.events = []; this.evVer = 0; this.marks = []; this.state = 'NOMINAL'; this.since = 0; this.snaps = 0;
    this.cur = null; this.pkt = null; this.learned = new Map(); this.count = 0; this.ackRaw = null;
  }

  ingest(pkt, now, quiet = false) {
    const g = pkt.gnss || {}, det = pkt.det || {}, base = Object.assign({}, BASE, det.base || {});
    const sats = (Array.isArray(g.sats) ? g.sats : []).map(s => ({ prn: num(s.prn), el: num(s.el), az: num(s.az), cn0: num(s.cn0), b: s.b == null ? null : num(s.b) }));
    for (const s of sats) {
      s.trk = s.cn0 >= 22;
      if (s.b == null) {           // no baseline from the cube: learn one while the signal is clean
        const k = this.learned.get(s.prn);
        if (this.state === 'NOMINAL' && s.trk) this.learned.set(s.prn, k == null ? s.cn0 : k * 0.95 + s.cn0 * 0.05);
        s.b = this.learned.get(s.prn) ?? Math.max(s.cn0, 30);
      }
    }
    const tr = sats.filter(s => s.trk);
    const mean = det.cn0_mean != null ? num(det.cn0_mean) : avg(tr.map(s => s.cn0));
    const sd = det.cn0_sd != null ? num(det.cn0_sd) : (tr.length > 1 ? Math.sqrt(tr.reduce((a, s) => a + (s.cn0 - mean) ** 2, 0) / (tr.length - 1)) : 0);
    const r = det.cn0_el_r != null ? num(det.cn0_el_r) : corr(tr.map(s => Math.sin(s.el * Math.PI / 180)), tr.map(s => s.cn0));
    const drop = det.drop_db != null ? num(det.drop_db) : avg(sats.map(s => Math.max(0, s.b - Math.max(s.cn0, 15))));
    const noise = num(g.noise, base.noise), jam = num(g.jam_ind, 0), agc = num(g.agc_pct, base.agc), dev = num(det.pos_dev_km, 0);
    let index = det.index, state = det.state;
    if (index == null || !VERDICT[state]) {
      const d = detect({ drop, noise, jam, agc, sd, dev }, base);
      index = d.index; state = classify(index, d.spoofScore, this.state);
    }
    index = Math.round(num(index));
    const orbit = pkt.orbit || null, hasFix = !!g.fix && g.fix !== 'none' && (num(g.lat) !== 0 || num(g.lon) !== 0);
    const pos = orbit ? { lat: num(orbit.lat), lon: num(orbit.lon) } : hasFix ? { lat: num(g.lat), lon: num(g.lon) } : { lat: GROUND_STATION.lat, lon: GROUND_STATION.lon };
    const pl = orbit ? placeOf(pos.lat, pos.lon) : ['Test bench', 'at the test bench', pos.lat, pos.lon];
    const ack = parseAck(det.ack);
    const e = pkt.eps || {}, a = pkt.adcs || {}, th = pkt.therm || {};
    const prev = this.state;
    this.cur = {
      src: pkt.src || 'HW', seq: num(pkt.seq), orbit, pos, pl, sats, n: g.nsat != null ? num(g.nsat) : tr.length, total: sats.length || 10,
      mean, sd, r, drop, noise, jam, agc, dev, index, state, base, baseMean: avg(sats.map(s => s.b)),
      vbat: num(e.vbat), ibat: num(e.ibat_ma), net: e.net_w != null ? num(e.net_w) : num(e.vbat) * num(e.ibat_ma) / 1000, soc: num(e.soc_pct),
      solar: e.solar_w != null ? num(e.solar_w) : null, load: e.load_w != null ? num(e.load_w) : null,
      roll: num(a.roll_deg), pitch: num(a.pitch_deg), vib: num(a.vib_g), temp: num(th.board_c),
      fix: { lat: num(g.lat), lon: num(g.lon), q: hasFix ? g.fix : 'none' }, hw: g.noise != null, cal: !!det.cal, test: det.test || null, ack
    };
    if (state !== prev) { this.state = state; this.since = now; if (!this.cur.cal) this.transition(prev, state, index, pos, pl, now, quiet); }   // calibrating forces NOMINAL; that isn't "back to normal"
    if (ack && ack.raw !== this.ackRaw) {       // the cube repeats its last answer in every packet; log each new one once
      const first = this.ackRaw === null;      // already there when we tuned in: log it only if accepted and recent, since the cube checked its time
      this.ackRaw = ack.raw;
      if (!first || (ack.ok && ack.ts && Math.abs(now / 1000 - ack.ts) < 300)) {
        const what = COMMANDS[ack.cmd] ? COMMANDS[ack.cmd].name : 'Unknown command';
        this.log({ t: first ? ack.ts * 1000 : now, kind: ack.ok ? 'cmd' : 'cmdbad', index, area: pl[0], mean: `${what}: ` + (ack.ok ? COMMANDS[ack.cmd].done : REJECT[ack.why] || EVENTS.cmdbad.mean) });
      }
    }
    if (!this.since) this.since = now;
    const H = this.hist;
    H.index.push(index); H.cn0.push(mean); H.nsat.push(this.cur.n); H.noise.push(noise); H.jam.push(jam); H.agc.push(agc); H.dev.push(dev); H.spoof.push(state === 'SPOOFING');
    for (const k in H) if (H[k].length > HIST) H[k].shift();
    this.pkt = pkt; this.count++; this.lastAt = now;
    return state !== prev ? { prev, state } : null;
  }

  transition(prev, state, index, pos, pl, now) {
    let kind = null;
    if (state === 'JAMMING') kind = 'jam';
    else if (state === 'SPOOFING') kind = 'spoof';
    else if (state === 'SUSPECT' && prev === 'NOMINAL') kind = 'suspect';
    else if (state === 'NOMINAL') kind = 'clear';
    if (!kind) return;
    this.log({ t: now, kind, index, area: pl[0] });
    if (kind === 'jam' || kind === 'spoof') {
      this.marks.push({ lat: pos.lat, lon: pos.lon, kind, t: now });
      if (this.marks.length > 6) this.marks.shift();
      this.snaps++;
    }
  }

  log(ev) {
    this.events.unshift(ev);
    this.events.sort((a, b) => b.t - a.t);
    if (this.events.length > 60) this.events.length = 60;
    this.evVer++;
  }
}

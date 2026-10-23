/* Data panels: everything below the mission view. Each function reads the current
   telemetry and redraws one panel; nothing here keeps its own state. */
import { VERDICT, EVENTS, HIST } from './store.js';
import { GROUND_STATION } from './gulf.js';
import { trackAt, PASS } from './sim.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = n => String(n).padStart(2, '0');
export const hms = ms => { const d = new Date(ms); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()); };
const f1 = v => (+v).toFixed(1);
const sgn = (v, d = 1) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const rad = d => d * Math.PI / 180;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function dur(s) { s = Math.max(0, Math.round(s)); return s < 60 ? s + ' s' : s < 3600 ? Math.floor(s / 60) + ' min ' + (s % 60) + ' s' : Math.floor(s / 3600) + ' h ' + Math.floor(s % 3600 / 60) + ' min'; }

/* ---------- Detection status (hero overlay) ---------- */
function gauge(v) {
  const cx = 70, cy = 70, P = (a, r) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  const arc = (v0, v1, r) => { const p0 = P(Math.PI * (1 - v0 / 100), r), p1 = P(Math.PI * (1 - v1 / 100), r); return `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)}A${r} ${r} 0 0 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`; };
  return `<path d="${arc(0, 29.4, 62)}" class="z z-good"/><path d="${arc(30.6, 59.4, 62)}" class="z z-warn"/><path d="${arc(60.6, 100, 62)}" class="z z-crit"/>`
    + `<path d="${arc(0, 100, 52)}" class="g-track"/><path d="${arc(0, Math.max(v, 1), 52)}" class="g-val"/>`
    + `<text x="${cx}" y="${cy - 8}" text-anchor="middle" class="g-num">${v}</text><text x="${cx}" y="${cy + 10}" text-anchor="middle" class="g-lab">INDEX</text>`;
}
export function renderStatus(c, store, live) {
  const st = c.state, ph = c.pl[1], lost = c.total - c.n, noisePct = Math.round((c.noise - c.base.noise) / c.base.noise * 100);
  document.documentElement.dataset.state = st;
  $('verdict').textContent = VERDICT[st];
  $('since').textContent = 'for ' + dur((Date.now() - store.since) / 1000);
  $('gauge').innerHTML = gauge(c.index);
  $('gauge').setAttribute('aria-label', `Interference Index ${c.index} out of 100`);
  let txt, adv;
  if (st === 'JAMMING') { txt = `Signal strength fell ${f1(c.drop)} dB on average, ${lost} of ${c.total} satellites dropped out and noise rose ${noisePct}%. A jammer is drowning out GPS ${ph}.`; adv = 'Alert: ships and aircraft here should cross-check GPS with radar and inertial navigation.'; }
  else if (st === 'SPOOFING') { txt = `All ${c.n} satellites arrive at almost the same strength (spread ${f1(c.sd)} dB) and the position is ${f1(c.dev)} km off where it should be. Fake GPS signals are being broadcast ${ph}.`; adv = 'Alert: GPS positions in this area can’t be trusted, even when they look normal.'; }
  else if (st === 'SUSPECT') { txt = `Signals are ${f1(c.drop)} dB weaker than the clean baseline and noise is up ${noisePct}%. Watching for jamming ${ph}.`; adv = 'Early warning only. No action needed yet.'; }
  else { txt = `${c.n} of ${c.total} satellites tracked at healthy strength, averaging ${f1(c.mean)} dB-Hz. No interference ${ph}.`; adv = 'GPS is safe to use in this area.'; }
  if (c.cal) { $('verdict').textContent = 'Calibrating'; txt = 'Learning the clean baseline for each satellite. Keep the antenna clear of covers and electronics for about a minute.'; adv = 'Detection starts automatically when calibration finishes.'; }
  if (c.test === 'replay') adv = 'Replay test running: the cube is replaying a recorded spoofed signal to prove detection works.';
  $('statusReading').textContent = txt;
  $('statusAdvice').textContent = adv;
  $('pmode').textContent = st === 'NOMINAL' ? 'Survey · 1 Hz' : 'Event · alert raised';
  $('snaps').textContent = String(store.snaps);
}

/* ---------- Pass / position readout (hero overlay) ---------- */
export function renderPass(c, live) {
  const rows = [];
  if (!live && c.orbit) {
    const tl = +c.orbit.tl, nextGs = (() => { for (let k = 1; k <= PASS; k++) { const q = trackAt((tl + k) % PASS); if (Math.hypot(q.lat - GROUND_STATION.lat, (q.lon - GROUND_STATION.lon) * Math.cos(rad(GROUND_STATION.lat))) < 9) return k; } return null; })();
    const inView = Math.hypot(c.pos.lat - GROUND_STATION.lat, (c.pos.lon - GROUND_STATION.lon) * Math.cos(rad(GROUND_STATION.lat))) < 9;
    rows.push(['Over', cap(c.pl[0])], ['Position', `${f1(c.pos.lat)}°N ${f1(c.pos.lon)}°E`], ['Altitude', '525 km'], ['Speed', '7.60 km/s'],
      ['Ground contact', inView ? 'In contact · Al Ain' : nextGs ? `Al Ain in ${nextGs} s` : 'Next pass']);
  } else {
    rows.push(['Location', 'Test bench'], ['GPS fix', `${c.fix.q} · ${c.fix.lat.toFixed(4)}°, ${c.fix.lon.toFixed(4)}°`], ['Satellites', `${c.n} tracked`], ['Packet', '#' + c.seq]);
  }
  $('passInfo').innerHTML = rows.map(r => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd></div>`).join('');
}

/* ---------- Receiver health tiles ---------- */
export const TILES = [
  { id: 'cn0', lab: 'Mean signal strength', unit: 'dB-Hz', lo: 15, hi: 50, key: 'cn0' },
  { id: 'nsat', lab: 'Satellites tracked', unit: 'of 10', lo: 0, hi: 12, key: 'nsat' },
  { id: 'noise', lab: 'Noise level', unit: 'counts', lo: 80, hi: 200, key: 'noise' },
  { id: 'jam', lab: 'Jamming indicator', unit: 'of 255', lo: 0, hi: 255, key: 'jam' },
  { id: 'agc', lab: 'Receiver gain (AGC)', unit: '%', lo: 20, hi: 80, key: 'agc' },
  { id: 'dev', lab: 'Position offset', unit: 'km', lo: 0, hi: 40, key: 'dev' }
];
export function buildTiles() {
  $('tiles').innerHTML = TILES.map(t => `<div class="tile" id="t-${t.id}"><span class="lab">${t.lab}</span><span class="val"><span id="v-${t.id}">—</span><small id="u-${t.id}">${t.unit}</small></span><span class="delta" id="d-${t.id}"></span><svg id="s-${t.id}" aria-hidden="true"></svg></div>`).join('');
}
function spark(el, arr, lo, hi) {
  const W = Math.max(100, Math.round(el.getBoundingClientRect().width)), H = 38, n = arr.length; if (!n) return;
  const x = i => 2 + (W - 6) * (i + (HIST - n)) / (HIST - 1), y = v => 4 + (H - 8) * (1 - clamp((v - lo) / (hi - lo), 0, 1));
  let d = ''; for (let i = 0; i < n; i++) d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(arr[i]).toFixed(1);
  el.setAttribute('viewBox', `0 0 ${W} ${H}`);
  el.innerHTML = `<path d="${d}L${x(n - 1).toFixed(1)} ${H}L${x(0).toFixed(1)} ${H}Z" class="sp-area"/><path d="${d}" class="sp-line"/><circle cx="${x(n - 1).toFixed(1)}" cy="${y(arr[n - 1]).toFixed(1)}" r="2.6" class="sp-dot"/>`;
}
function setTile(id, val, delta, sev) { $('v-' + id).textContent = val; $('d-' + id).textContent = delta; $('t-' + id).dataset.sev = sev; }
export function renderTiles(c, H) {
  const lost = c.total - c.n, dMean = c.mean - c.baseMean, pct = Math.round((c.noise - c.base.noise) / c.base.noise * 100), spoof = c.state === 'SPOOFING';
  $('u-nsat').textContent = 'of ' + c.total;
  setTile('cn0', f1(c.mean), sgn(dMean) + ' dB vs clean baseline', spoof ? 'spoof' : dMean < -6 ? 'crit' : dMean < -2.5 ? 'warn' : 'ok');
  setTile('nsat', String(c.n), lost ? lost + ' lost to interference' : 'All satellites in view tracked', lost >= 3 ? 'crit' : lost >= 1 ? 'warn' : 'ok');
  if (c.src !== 'HW' || c.hw) {
    setTile('noise', String(Math.round(c.noise)), sgn(pct, 0) + '% vs baseline', pct > 40 ? 'crit' : pct > 15 ? 'warn' : 'ok');
    setTile('jam', String(c.jam), c.jam < 20 ? 'Under 20 means clean' : c.jam < 80 ? 'Rising: possible interference' : 'Strong interference', c.jam >= 80 ? 'crit' : c.jam >= 20 ? 'warn' : 'ok');
    setTile('agc', f1(c.agc), sgn(c.agc - c.base.agc) + ' pts vs baseline', c.agc < c.base.agc - 12 ? 'crit' : c.agc < c.base.agc - 5 ? 'warn' : 'ok');
  } else for (const id of ['noise', 'jam', 'agc']) setTile(id, '—', 'Not reported by this receiver', 'ok');
  setTile('dev', f1(c.dev), c.dev < 5 ? 'Fix matches where it should be' : 'Fix has jumped away', c.dev >= 5 ? 'spoof' : 'ok');
  for (const t of TILES) spark($('s-' + t.id), H[t.key], t.lo, t.hi);
}

/* ---------- Signal strength per satellite ---------- */
const strength = s => !s.trk ? 'lost' : s.cn0 >= 35 ? 'strong' : 'weak';
export function renderBars(c) {
  const box = $('bars'), W = Math.max(300, Math.round(box.getBoundingClientRect().width)), H = 236;
  const m = { l: 34, r: 8, t: 16, b: 28 }, pw = W - m.l - m.r, ph = H - m.t - m.b, y = v => m.t + ph * (1 - clamp(v, 0, 50) / 50);
  const sats = c.sats.slice(0, 12), n = Math.max(1, sats.length);
  let g = '';
  for (const v of [0, 10, 20, 30, 40, 50]) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="c-grid"/><text x="${m.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="c-tick">${v}</text>`;
  g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(22).toFixed(1)}" y2="${y(22).toFixed(1)}" class="c-lock"/><text x="${W - m.r}" y="${(y(22) - 5).toFixed(1)}" text-anchor="end" class="c-lockl">loss of lock · 22</text>`;
  const band = pw / n, bw = Math.min(30, band * 0.58);
  sats.forEach((s, i) => {
    const cx = m.l + band * (i + 0.5), x0 = cx - bw / 2, k = strength(s);
    if (s.trk) g += `<rect x="${x0.toFixed(1)}" y="${y(s.cn0).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(0) - y(s.cn0)).toFixed(1)}" rx="2" class="bar-${k}"/>`;
    else g += `<rect x="${x0.toFixed(1)}" y="${(y(0) - 3).toFixed(1)}" width="${bw.toFixed(1)}" height="3" class="bar-lost"/><text x="${cx.toFixed(1)}" y="${(y(0) - 8).toFixed(1)}" text-anchor="middle" class="c-lost">lost</text>`;
    g += `<line x1="${(x0 - 4).toFixed(1)}" x2="${(x0 + bw + 4).toFixed(1)}" y1="${y(s.b).toFixed(1)}" y2="${y(s.b).toFixed(1)}" class="c-base"/>`;
    g += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" class="c-tick">G${pad(s.prn)}</text>`;
  });
  box.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Signal strength of each GPS satellite against its clean baseline">${g}</svg>`;
  const lost = c.total - c.n;
  $('barsReading').textContent = c.state === 'JAMMING' ? `Every bar fell below its baseline mark at the same moment and ${lost} dropped under the loss-of-lock line. Satellites don’t fail together; a jammer does that.`
    : c.state === 'SPOOFING' ? 'Every bar is the same height, whatever the satellite’s position in the sky. Real signals never line up like this.'
    : c.state === 'SUSPECT' ? 'Bars are slipping below their baseline marks across the board.'
    : 'Each bar sits on its clean baseline mark, so the receiver hears every satellite normally.';
}

/* ---------- Sky plot ---------- */
export function renderSky(c) {
  const cx = 150, cy = 152, R = 122; let g = '';
  for (const el of [0, 30, 60]) { const r = R * (90 - el) / 90; g += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" class="sk-ring"/>`; if (el > 0) g += `<text x="${cx + 4}" y="${(cy - r + 12).toFixed(1)}" class="sk-el">${el}°</text>`; }
  g += `<line x1="${cx - R}" x2="${cx + R}" y1="${cy}" y2="${cy}" class="sk-ring"/><line x1="${cx}" x2="${cx}" y1="${cy - R}" y2="${cy + R}" class="sk-ring"/>`;
  g += `<text x="${cx}" y="${cy - R - 9}" text-anchor="middle" class="sk-dir">N</text><text x="${cx + R + 11}" y="${cy + 4}" text-anchor="middle" class="sk-dir">E</text><text x="${cx}" y="${cy + R + 19}" text-anchor="middle" class="sk-dir">S</text><text x="${cx - R - 11}" y="${cy + 4}" text-anchor="middle" class="sk-dir">W</text>`;
  for (const s of c.sats) { const r = R * (90 - clamp(s.el, 0, 90)) / 90, a = rad(s.az), x = cx + r * Math.sin(a), y = cy - r * Math.cos(a); g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7.5" class="sv-${strength(s)}"/><text x="${(x + 10).toFixed(1)}" y="${(y + 4).toFixed(1)}" class="sk-prn">G${pad(s.prn)}</text>`; }
  $('sky').innerHTML = g;
  const lost = c.total - c.n;
  $('skyReading').textContent = c.state === 'SPOOFING' ? 'Positions look normal, but every satellite reports the same strength, high or low.'
    : lost ? `${lost} of ${c.total} satellites have dropped out (dashed rings). Higher satellites hold on longest.`
    : `All ${c.total} satellites in view are tracked, spread across the sky. Higher satellites come in stronger.`;
}

/* ---------- Index over time ---------- */
export function renderTimeline(H) {
  const box = $('timeline'), W = Math.max(300, Math.round(box.getBoundingClientRect().width)), Hh = 214;
  const m = { l: 30, r: 10, t: 12, b: 40 }, pw = W - m.l - m.r, ph = Hh - m.t - m.b, h = H.index, n = h.length;
  const x = i => m.l + pw * (i + (HIST - n)) / (HIST - 1), y = v => m.t + ph * (1 - v / 100);
  let g = `<rect x="${m.l}" y="${y(100).toFixed(1)}" width="${pw}" height="${(y(60) - y(100)).toFixed(1)}" class="zb zb-crit"/><rect x="${m.l}" y="${y(60).toFixed(1)}" width="${pw}" height="${(y(30) - y(60)).toFixed(1)}" class="zb zb-warn"/><rect x="${m.l}" y="${y(30).toFixed(1)}" width="${pw}" height="${(y(0) - y(30)).toFixed(1)}" class="zb zb-good"/>`;
  g += `<text x="${m.l + 6}" y="${(y(100) + 14).toFixed(1)}" class="zl">JAMMING</text><text x="${m.l + 6}" y="${(y(60) + 14).toFixed(1)}" class="zl">SUSPECTED</text><text x="${m.l + 6}" y="${(y(30) + 14).toFixed(1)}" class="zl">CLEAN</text>`;
  for (const v of [0, 30, 60, 100]) g += `<text x="${m.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="c-tick">${v}</text>`;
  if (n) {
    let d = ''; for (let i = 0; i < n; i++) d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(h[i]).toFixed(1);
    g += `<path d="${d}L${x(n - 1).toFixed(1)} ${y(0).toFixed(1)}L${x(0).toFixed(1)} ${y(0).toFixed(1)}Z" class="tl-area"/><path d="${d}" class="tl-line"/>`;
    const sw = pw / (HIST - 1) + 0.6;
    for (let i = 0; i < n; i++) if (H.spoof[i]) g += `<rect x="${(x(i) - sw / 2).toFixed(1)}" y="${m.t + ph + 6}" width="${sw.toFixed(1)}" height="6" class="tl-sp"/>`;
    const ex = x(n - 1), ey = y(h[n - 1]), ly = ey < m.t + 22 ? ey + 18 : ey - 9;
    g += `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="3.5" class="tl-dot"/><text x="${(ex - 7).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="end" class="tl-val">${h[n - 1]}</text>`;
  }
  g += `<text x="${m.l}" y="${Hh - 6}" class="c-tick">−2 min</text><text x="${(m.l + pw / 2).toFixed(1)}" y="${Hh - 6}" text-anchor="middle" class="c-tick">−1 min</text><text x="${W - m.r}" y="${Hh - 6}" text-anchor="end" class="c-tick">now</text>`;
  box.innerHTML = `<svg width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Interference Index over the last two minutes">${g}</svg>`;
  const peak = n ? Math.max(...h) : 0, spoofSecs = H.spoof.filter(Boolean).length;
  $('tlReading').textContent = n ? `Index ${h[n - 1]} now, peak ${peak} in the last 2 minutes.` + (spoofSecs ? ` ${spoofSecs} seconds were flagged as spoofing.` : '') : 'Waiting for telemetry.';
}

/* ---------- Spoofing checks ---------- */
export function renderChecks(c) {
  const few = c.n < 3;
  const items = [
    { name: 'Strengths differ between satellites', num: few ? 'Too few satellites to test' : `Spread ${f1(c.sd)} dB · passes at 2.5 dB or more`, ok: few ? null : c.sd >= 2.5, why: 'Real satellites sit at different heights, so their signals arrive at different strengths. One spoofing transmitter makes them all look the same.' },
    { name: 'Higher satellites are stronger', num: few ? 'Too few satellites to test' : `Correlation ${c.r.toFixed(2)} · passes at 0.50 or more`, ok: few ? null : c.r >= 0.5, why: 'Satellites overhead give stronger signals than ones near the horizon. A fake signal ignores elevation.' },
    { name: 'Position matches where it should be', num: `Offset ${f1(c.dev)} km · passes under 5 km`, ok: c.dev < 5, why: 'The receiver’s fix is compared with the predicted orbit, or with the surveyed bench position during ground tests.' }
  ];
  let passing = 0;
  $('checks').innerHTML = items.map(it => { if (it.ok) passing++; const p = it.ok === null ? '<span class="pill pill-wait">Wait</span>' : it.ok ? '<span class="pill pill-pass">Pass</span>' : '<span class="pill pill-fail">Fail</span>'; return `<li class="check"><span class="name">${it.name}</span>${p}<span class="num">${it.num}</span><span class="why">${it.why}</span></li>`; }).join('');
  $('checksMeta').textContent = passing + ' of 3 passing';
}

/* ---------- Housekeeping ---------- */
export function renderHK(c) {
  const set = (id, t) => { $(id).textContent = t; };
  set('hk-roll', sgn(c.roll) + '°'); set('hk-pitch', sgn(c.pitch) + '°'); set('hk-point', Math.hypot(c.roll, c.pitch).toFixed(1) + '°'); set('hk-vib', c.vib.toFixed(3) + ' g');
  set('hk-batt', c.vbat.toFixed(2) + ' V · ' + Math.round(c.soc) + '%');
  set('hk-ibat', (c.ibat >= 0 ? '+' : '\u2212') + Math.abs(Math.round(c.ibat)) + ' mA ' + (c.ibat >= 0 ? 'charging' : 'draining'));
  set('hk-net', sgn(c.net, 2) + ' W');
  set('hk-solar', c.solar != null ? c.solar.toFixed(2) + ' W' : (c.ibat > 20 ? 'Charging' : 'Not charging'));
  set('hk-temp', c.temp.toFixed(1) + ' °C');
  const tempOk = c.temp > 0 && c.temp < 45, battOk = c.vbat === 0 || c.vbat > 3.4, tiltOk = Math.hypot(c.roll, c.pitch) < 15;
  const sunlit = c.solar != null ? c.solar > 0.2 : c.ibat > 20;
  const pill = (id, ok, good, bad) => { const el = $(id); el.textContent = ok ? good : bad; el.className = 'pill ' + (ok ? 'pill-good' : 'pill-fail'); };
  pill('hk-att-pill', tiltOk, 'Stable', 'Tilted'); pill('hk-pow-pill', battOk, sunlit ? 'Sunlit' : 'On battery', 'Low battery'); pill('hk-th-pill', tempOk, 'In range', 'Out of range');
}

/* ---------- Event log ---------- */
let drawnVer = -1;
export function renderLog(store, force = false) {
  if (!force && drawnVer === store.evVer) return; drawnVer = store.evVer;
  const rows = store.events.slice(0, 8).map(e => { const ev = EVENTS[e.kind]; return `<tr><td class="mono">${hms(e.t)}</td><td><span class="ev ev-${ev.cls}">${ev.name}</span></td><td class="mono">${e.index}</td><td>${esc(e.area)}</td><td class="mean">${ev.mean}</td></tr>`; }).join('');
  $('log').innerHTML = rows || '<tr><td colspan="5" class="empty">No events yet. Alerts appear here when the index crosses a threshold.</td></tr>';
  $('logMeta').textContent = store.events.length + ' events · newest first';
}

/* ---------- Raw packet ---------- */
export function renderPacket(pkt) {
  const p = JSON.parse(JSON.stringify(pkt)), sats = (p.gnss && p.gnss.sats) || [];
  if (p.gnss) p.gnss.sats = '__SATS__';
  const text = JSON.stringify(p, null, 2).replace('"__SATS__"', '[\n' + sats.map(s => '      ' + JSON.stringify(s)).join(',\n') + '\n    ]');
  $('packet').textContent = text;
  $('pktMeta').textContent = `#${pkt.seq} · ${JSON.stringify(pkt).length} bytes · ${pkt.src === 'SIM' ? 'simulated' : pkt.src === 'TEST' ? 'test transmitter' : 'from the cube'}`;
}

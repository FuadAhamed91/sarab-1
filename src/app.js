/* Ground station: wires the simulator, the live MQTT downlink, the 3D views and the panels. */
import { Simulator, PASS } from './sim.js';
import { Store, VERDICT } from './store.js';
import { createLink, BROKERS } from './link.js';
import * as P from './panels.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TRANSMIT = params.has('transmit');        // test transmitter: publishes simulated packets as the cube would
const LIVE_TIMEOUT = 12000;

const sim = new Simulator();
const store = new Store();
let source = 'sim', pref = params.get('source') || 'auto', paused = false, lastTick = performance.now();
let liveTimes = [], lastLive = null, lastLiveAt = 0, pktCount = 0, linkInfo = { state: 'connecting', broker: null };
let globe = null, attitude = null;

function warmSim() {          // replay the last ~3 minutes so the page opens mid-pass with history
  store.reset();
  const n = 187, start = Date.now() - n * 1000;
  for (let i = 0; i < n; i++) store.ingest(sim.step(start + i * 1000), start + i * 1000, true);
  lastTick = performance.now();
}
warmSim();

/* ---------- Rendering ---------- */
function renderAll() {
  const c = store.cur; if (!c) return;
  const live = source === 'live';
  P.renderStatus(c, store, live); P.renderPass(c, live); P.renderTiles(c, store.hist); P.renderBars(c); P.renderSky(c);
  P.renderTimeline(store.hist); P.renderChecks(c); P.renderHK(c); P.renderLog(store); P.renderPacket(store.pkt);
  if (attitude) { attitude.update(c); attitude.setScreen(['SARAB-1', `GPS ${c.fix.q}  ${c.n} SATS`, `INTERF ${c.index}%`, `BATT ${c.vbat.toFixed(2)}V`]); }
  $('pkts').textContent = String(source === 'live' ? pktCount : store.count);
}
function renderChrome() {
  $('utc').textContent = P.hms(Date.now());
  const chip = $('linkChip'), stale = source === 'live' && Date.now() - lastLiveAt > LIVE_TIMEOUT;
  const isTest = lastLive && lastLive.src === 'TEST';
  if (source === 'live') { chip.dataset.mode = stale ? 'stale' : isTest ? 'test' : 'live'; chip.textContent = stale ? 'Cube offline' : isTest ? 'Live · test transmitter' : 'Live · cube'; }
  else { chip.dataset.mode = 'sim'; chip.textContent = TRANSMIT ? 'Test transmitter' : 'Simulation'; }
  $('downlink').textContent = linkInfo.state === 'connected' ? `${linkInfo.broker} · connected` : linkInfo.state === 'connecting' ? 'Connecting…' : linkInfo.state === 'unavailable' ? 'Unavailable' : 'Reconnecting…';
  const b = $('banner');
  if (source === 'sim' && !TRANSMIT) {
    b.hidden = false;
    b.innerHTML = lastLiveAt
      ? `<strong>Showing a simulated pass.</strong> The cube was last heard at ${P.hms(lastLiveAt)} UTC. Live data returns here automatically when it transmits again.`
      : `<strong>Showing a simulated pass over the Gulf.</strong> When the SARAB-1 prototype is powered on, this page switches to its live data automatically.`;
  } else if (TRANSMIT) {
    b.hidden = false; b.innerHTML = '<strong>Test transmitter.</strong> This tab publishes simulated packets marked TEST, exactly as the cube would, so the live link can be checked end to end.';
  } else if (stale) {
    b.hidden = false; b.innerHTML = `<strong>No signal from the cube for ${P.dur((Date.now() - lastLiveAt) / 1000)}.</strong> Showing its last packet. Check its power and Wi-Fi hotspot.`;
  } else b.hidden = true;
  document.querySelectorAll('[data-src]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.src === pref)));
  const simOn = source === 'sim';
  $('scenarios').hidden = $('scenLabel').hidden = $('b-pause').hidden = !simOn;
}

/* ---------- Source selection ---------- */
function liveActive() { const now = Date.now(); return liveTimes.filter(t => now - t < 6000).length >= 2 && now - lastLiveAt < LIVE_TIMEOUT; }
function chooseSource() {
  const want = pref === 'sim' ? 'sim' : pref === 'live' ? (lastLive ? 'live' : 'sim') : (liveActive() ? 'live' : 'sim');
  if (TRANSMIT) { if (source !== 'sim') { source = 'sim'; warmSim(); renderAll(); } return; }
  if (want === source) return;
  source = want;
  if (source === 'live') { store.reset(); if (lastLive) store.ingest(lastLive, lastLiveAt); }
  else warmSim();
  P.renderLog(store, true); renderAll();
  $('live').textContent = source === 'live' ? 'Receiving live data from the cube.' : 'Showing simulated data.';
}

/* ---------- Live downlink ---------- */
const link = createLink({
  onPacket(pkt) {
    if (pkt.src === 'SIM') return;                 // ignore anything not from the cube or the test transmitter
    if (TRANSMIT && pkt.src === 'TEST') return;     // our own echo
    const now = Date.now();
    lastLive = pkt; lastLiveAt = now; pktCount++;
    liveTimes.push(now); if (liveTimes.length > 20) liveTimes.shift();
    chooseSource();
    if (source === 'live') {
      const ch = store.ingest(pkt, now);
      if (ch) $('live').textContent = VERDICT[ch.state];
      renderAll();
    }
    renderChrome();
  },
  onStatus(s) { linkInfo = s; renderChrome(); }
});

/* ---------- Clock: one simulated packet per second ---------- */
setInterval(() => {
  if (source === 'sim' && !paused) {
    const now = Date.now(), pkt = sim.step(now);
    const ch = store.ingest(pkt, now);
    if (ch) $('live').textContent = VERDICT[ch.state] + ' ' + store.cur.pl[1] + '.';
    lastTick = performance.now();
    if (TRANSMIT) link.publish(Object.assign({}, pkt, { src: 'TEST', orbit: undefined }), false);
    renderAll();
  }
  chooseSource(); renderChrome();
}, 1000);

/* ---------- Controls ---------- */
document.querySelectorAll('[data-src]').forEach(btn => btn.addEventListener('click', () => { pref = btn.dataset.src; chooseSource(); renderChrome(); }));
document.querySelectorAll('[data-scn]').forEach(btn => btn.addEventListener('click', () => {
  sim.mode = btn.dataset.scn;
  document.querySelectorAll('[data-scn]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
}));
$('b-pause').addEventListener('click', function () { paused = !paused; this.setAttribute('aria-pressed', String(paused)); this.textContent = paused ? 'Resume' : 'Pause'; });
$('b-view').addEventListener('click', () => globe && globe.resetView());

/* ---------- Boot ---------- */
P.buildTiles();
renderAll(); renderChrome();
new ResizeObserver(() => { if (store.cur) { P.renderTiles(store.cur, store.hist); P.renderBars(store.cur); P.renderTimeline(store.hist); } }).observe($('grid'));

(async function boot3D() {
  await Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise(r => setTimeout(r, 1800))]);
  try {
    const { createGlobe } = await import('./globe.js');
    globe = createGlobe($('globe'), $('glabels'), { reducedMotion });
    const tickGlobe = () => {
      const frac = (source === 'sim' && !paused) ? Math.min(1, (performance.now() - lastTick) / 1000) : 0;
      const c = store.cur;
      globe.update({
        mode: source === 'sim' ? 'sim' : 'live',
        tl: c && c.orbit ? ((+c.orbit.tl + frac) % PASS) : 0,
        live: source === 'live' && c ? { lat: c.fix.lat || c.pos.lat, lon: c.fix.lon || c.pos.lon } : null,
        marks: store.marks, status: store.state, clock: Date.now()
      });
      requestAnimationFrame(tickGlobe);
    };
    requestAnimationFrame(tickGlobe);
  } catch (e) {
    console.error(e);
    $('globe').insertAdjacentHTML('beforeend', '<div class="globe-note">The 3D mission view needs WebGL, which this browser has turned off. All the data panels below still work.</div>');
  }
  try {
    const { createAttitude } = await import('./attitude.js');
    attitude = createAttitude($('att'), { reducedMotion });
    if (store.cur) attitude.update(store.cur);
  } catch (e) { console.error(e); $('att').hidden = true; }
})();

window.SARAB = { store, sim, link, brokers: BROKERS };   // handy for debugging from the browser console

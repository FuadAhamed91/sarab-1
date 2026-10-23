/* 3D model page: the SARAB-1 prototype with an exploded view, part callouts and a parts index. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildSatellite, loadSatellite, SUBS } from './sat-model.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ORDER = ['Payload', 'Flight computer', 'Attitude', 'Power', 'Structure'];
const LABELS = ['antenna', 'solar', 'gps', 'esp32', 'ina219', 'mpu6050', 'battery', 'charger', 'oled', 'deck1', 'deck2'];

await Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise(r => setTimeout(r, 1800))]);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  if (!renderer.getContext()) throw new Error('webgl');
} catch (e) {
  stage.insertAdjacentHTML('beforeend', '<div class="globe-note">The 3D model needs WebGL, which this browser has turned off.</div>');
  throw e;
}
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', 'Interactive 3D model of the SARAB-1 CubeSat prototype');
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(30, 1, 1, 8000);
const HOME = { pos: new THREE.Vector3(300, 215, 345), target: new THREE.Vector3(0, 62, 0) };
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME.target); controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 150; controls.maxDistance = 1200; controls.maxPolarAngle = Math.PI * 0.9;
controls.autoRotate = !reduced; controls.autoRotateSpeed = 0.6;
controls.addEventListener('start', () => { controls.autoRotate = false; });
const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(220, 380, 260); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -220, right: 220, top: 260, bottom: -120, near: 10, far: 1400 });
scene.add(key, new THREE.HemisphereLight(0xdbe9f4, 0x1b2731, 0.35));
const ground = new THREE.Mesh(new THREE.CircleGeometry(420, 80), new THREE.ShadowMaterial({ opacity: 0.32 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.5; ground.receiveShadow = true; scene.add(ground);

const hint = stage.querySelector('.hint'), hintText = hint.textContent;
hint.textContent = 'Loading the detailed 3D model…';
let sat;
try { sat = await loadSatellite({ uniqueMaterials: true, oled: true }); }
catch (e) { console.warn('Detailed model unavailable, showing the simple one:', e); sat = buildSatellite({ detail: 'high', uniqueMaterials: true, oled: true }); }
hint.textContent = hintText;
sat.setOled(['SARAB-1', 'GPS 3D  9 SATS', 'INTERF 4%', 'BATT 3.92V']);
scene.add(sat.group);
const meshes = sat.meshes, bySub = sat.bySub;
const isShell = m => (m.userData.sub === 'panels' && m.userData.p.id !== 'base' && m.userData.p.id !== 'top_plate') || m.userData.sub === 'rails';
const shell = meshes.filter(isShell);

/* ---------- State and controls ---------- */
const st = { ex: 0, exT: 0, panels: true, labels: true, sel: null, hover: null };
const setExplode = v => { st.exT = v; $('explode').value = String(Math.round(v * 100)); };
$('explode').addEventListener('input', e => { st.exT = +e.target.value / 100; controls.autoRotate = false; });
$('b-panels').addEventListener('click', function () { st.panels = !st.panels; this.setAttribute('aria-pressed', String(st.panels)); });
$('b-labels').addEventListener('click', function () { st.labels = !st.labels; this.setAttribute('aria-pressed', String(st.labels)); });
$('b-reset').addEventListener('click', () => { camera.position.copy(HOME.pos); controls.target.copy(HOME.target); setExplode(0); st.panels = true; $('b-panels').setAttribute('aria-pressed', 'true'); select(null); });

const forMats = (m, fn) => (Array.isArray(m.material) ? m.material : [m.material]).forEach(fn);
const SEL = new THREE.Color(0x1f6fa8), HOV = new THREE.Color(0x15384e), ZERO = new THREE.Color(0x000000);
function paint() {
  for (const m of meshes) {
    if (m.userData.kind === 'screen') continue;      // the lit OLED keeps its own glow
    const s = m.userData.sub, on = s === st.sel, hv = s === st.hover && !on;
    forMats(m, mt => { if (!mt.userData.e0) mt.userData.e0 = mt.emissive ? mt.emissive.clone() : ZERO; if (mt.emissive) mt.emissive.copy(on ? SEL : hv ? HOV : mt.userData.e0); });
  }
}
function select(sub) {
  st.sel = sub && st.sel !== sub ? sub : null;
  if (st.sel && SUBS[st.sel].inside && st.panels && st.exT < 0.5) setExplode(1);
  document.querySelectorAll('#index button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sub === st.sel)));
  renderInfo(); paint();
}
function renderInfo() {
  const s = st.sel && SUBS[st.sel];
  $('info').innerHTML = s
    ? `<span class="sys">${s.sys}</span><h3>${s.name}</h3><p>${s.info || ''}</p><dl><dt>Size</dt><dd>${s.size} mm</dd><dt>Mounted</dt><dd>${s.where}</dd></dl>`
    : '<span class="sys">Overview</span><h3>Everything inside one 1U cube</h3><p>The GPS receiver and its antenna are the payload. The ESP32 runs detection, the solar panel, battery and INA219 cover power, and the MPU6050 knows where the antenna points. Tap any part to see what it does and where it mounts.</p><dl><dt>Decks</dt><dd>2, at 38 and 75 mm</dd><dt>Openings</dt><dd>USB −X · charge +X · screen −Y</dd></dl>';
}
(function buildIndex() {
  let h = '';
  for (const sys of ORDER) {
    const items = Object.keys(SUBS).filter(k => SUBS[k].sys === sys);
    h += `<div><h4>${sys}</h4><ul>${items.map(k => `<li><button type="button" data-sub="${k}" aria-pressed="false"><span>${SUBS[k].name}</span><span>${SUBS[k].where}</span></button></li>`).join('')}</ul></div>`;
  }
  $('index').innerHTML = h;
  $('index').addEventListener('click', e => { const b = e.target.closest('button[data-sub]'); if (b) select(b.dataset.sub); });
  $('index').addEventListener('mouseover', e => { const b = e.target.closest('button[data-sub]'); st.hover = b ? b.dataset.sub : null; paint(); });
  $('index').addEventListener('mouseleave', () => { st.hover = null; paint(); });
})();
renderInfo();

/* ---------- Picking ---------- */
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let downAt = null;
function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObjects(meshes.filter(m => m.visible), false)[0];
  return hit ? hit.object.userData.sub : null;
}
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => { if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) { const s = pick(e); select(s || (st.sel ? st.sel : null)); } downAt = null; });
renderer.domElement.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || e.buttons) return;
  const s = pick(e); if (s !== st.hover) { st.hover = s; paint(); renderer.domElement.style.cursor = s ? 'pointer' : 'grab'; }
});

/* ---------- Callouts ---------- */
const tagBox = $('tags'), leads = $('leads'), tags = {};
for (const k of LABELS) { const d = document.createElement('div'); d.className = 'tag'; d.textContent = SUBS[k].name; tagBox.append(d); tags[k] = d; }
const AX = [['+X', [90, 0, 0]], ['−X', [-90, 0, 0]], ['+Y', [0, 90, 0]], ['−Y front', [0, -96, 0]]].map(([t, v]) => { const d = document.createElement('div'); d.className = 'tag axis'; d.textContent = t; tagBox.append(d); const p = new THREE.Vector3(v[0], v[2], -v[1]); return { el: d, v: p, n: p.clone().normalize() }; });
const toCam = new THREE.Vector3();
const tmp = new THREE.Vector3(), box3 = new THREE.Box3();
const centerOf = sub => { box3.makeEmpty(); for (const m of bySub[sub] || []) box3.expandByObject(m); return box3.getCenter(new THREE.Vector3()); };
function placeTags(W, H) {
  const cx = W / 2, items = []; let lines = '';
  for (const k of LABELS) {
    const el = tags[k], show = st.labels && (!SUBS[k].inside || !st.panels || st.ex > 0.35);
    if (!show) { el.style.transform = 'translate(-9999px,0)'; continue; }
    tmp.copy(centerOf(k)).project(camera);
    if (tmp.z > 1) { el.style.transform = 'translate(-9999px,0)'; continue; }
    items.push({ k, el, x: (tmp.x + 1) / 2 * W, y: (1 - tmp.y) / 2 * H });
  }
  for (const side of ['L', 'R']) {
    const list = items.filter(it => side === 'R' ? it.x >= cx : it.x < cx).sort((a, b) => a.y - b.y);
    let last = -1e9;
    for (const it of list) { let ty = Math.max(it.y, last + 26); ty = Math.min(ty, H - 70); last = ty; it.ty = ty; it.side = side; }
  }
  for (const it of items) {
    const w = it.el.offsetWidth;
    const lx = it.side === 'R' ? Math.min(W - w - 10, Math.max(it.x + 40, cx + 90)) : Math.max(10, Math.min(it.x - 40 - w, cx - 90 - w));
    it.el.style.transform = `translate(${lx.toFixed(0)}px,${(it.ty - 11).toFixed(0)}px)`;
    it.el.classList.toggle('sel', it.k === st.sel);
    const ex = it.side === 'R' ? lx : lx + w;
    lines += `<line x1="${it.x.toFixed(1)}" y1="${it.y.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${it.ty.toFixed(1)}"/><circle cx="${it.x.toFixed(1)}" cy="${it.y.toFixed(1)}" r="2.5"/>`;
  }
  for (const a of AX) {      // only label the faces turned towards the camera
    const facing = toCam.copy(camera.position).sub(a.v).dot(a.n) > 0;
    tmp.copy(a.v).project(camera);
    a.el.style.transform = !facing || tmp.z > 1 ? 'translate(-9999px,0)' : `translate(${((tmp.x + 1) / 2 * W - 12).toFixed(0)}px,${((1 - tmp.y) / 2 * H - 8).toFixed(0)}px)`;
  }
  leads.innerHTML = lines;
}

/* ---------- Loop ---------- */
let W = 1, H = 1;
function size() {
  const r = stage.getBoundingClientRect(); W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
  renderer.setSize(W, H, false); camera.aspect = W / H; camera.fov = W < 520 ? 42 : 30; camera.updateProjectionMatrix();
  leads.setAttribute('viewBox', `0 0 ${W} ${H}`);
}
size(); new ResizeObserver(size).observe(stage);
function frame() {
  requestAnimationFrame(frame);
  st.ex += reduced ? (st.exT - st.ex) : (st.exT - st.ex) * 0.12;
  const e = st.ex * st.ex * (3 - 2 * st.ex);
  sat.setExplode(e);
  for (const m of shell) m.visible = st.panels;
  // the side walls fly towards the camera, so fade them as the cube opens unless they are what's selected
  const op = st.sel === 'panels' || st.sel === 'rails' ? 1 : 1 - 0.8 * e;
  for (const m of shell) {
    m.castShadow = op > 0.6;
    forMats(m, mt => { const see = op < 0.99; if (mt.transparent !== see) { mt.transparent = see; mt.depthWrite = !see; mt.needsUpdate = true; } mt.opacity = op; });
  }
  controls.target.y = HOME.target.y + e * 72;      // follow the middle of the stack so the top panel stays in view
  controls.update(); renderer.render(scene, camera); placeTags(W, H);
}
requestAnimationFrame(frame);

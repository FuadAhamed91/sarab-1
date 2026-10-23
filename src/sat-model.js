/* 3D model of the SARAB-1 prototype. loadSatellite() brings in the detailed model built in Blender
   (hardware/blender/build_sarab1.py); buildSatellite() is the quick procedural one, used for the small
   globe marker and as a fallback. Both come from the same part list as the Tinkercad STLs and the
   cut list (hardware/build_model.py), so every view matches. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PARTS } from './parts-data.js';

export { PARTS };
export const PANEL_IDS = ['base', 'top_plate', 'wall_xp', 'wall_xn', 'wall_yp', 'wall_yn', 'port_usb', 'port_chg'];
export const subOf = p => PANEL_IDS.includes(p.id) ? 'panels' : p.sub;
export const SUBS = {
  antenna: { name: 'GPS patch antenna', sys: 'Payload', size: '25 × 25 × 6', where: 'Top face', inside: false },
  gps: { name: 'NEO-6M GPS receiver', sys: 'Payload', size: '36 × 25 board', where: 'Deck 2', inside: true },
  esp32: { name: 'ESP32 flight computer', sys: 'Flight computer', size: '51.5 × 28.3 board', where: 'Deck 1', inside: true },
  oled: { name: 'OLED status screen', sys: 'Flight computer', size: '27 × 27.5 board', where: 'Front panel (−Y)', inside: false },
  mpu6050: { name: 'MPU6050 motion sensor', sys: 'Attitude', size: '21 × 16 board', where: 'Deck 1, centre', inside: true },
  solar: { name: 'Solar panel', sys: 'Power', size: '99 × 69 × 3', where: 'Top face', inside: false },
  ina219: { name: 'INA219 power sensor', sys: 'Power', size: '25.5 × 22.3 board', where: 'Deck 1', inside: true },
  battery: { name: 'LiPo battery', sys: 'Power', size: '50 × 34 × 10', where: 'Base', inside: true },
  charger: { name: 'Charger + 5 V boost', sys: 'Power', size: '33 × 23 board', where: 'Base', inside: true },
  deck1: { name: 'Avionics deck 1', sys: 'Structure', size: '83 × 83 × 5', where: '38 mm up', inside: true },
  deck2: { name: 'Payload deck 2', sys: 'Structure', size: '83 × 83 × 5', where: '75 mm up', inside: true },
  pillars: { name: 'Deck pillars', sys: 'Structure', size: '6 × 6, 8 pieces', where: 'Under each deck', inside: true },
  rails: { name: 'Corner rails', sys: 'Structure', size: '8.5 × 8.5 × 113.5', where: 'Vertical edges', inside: false },
  panels: { name: 'Foam panels', sys: 'Structure', size: '5 mm board', where: 'Outer shell', inside: false,
    info: 'Base, top and four side panels cut from black 5 mm foam board, with openings for USB, charging and the screen.' },
  wiring: { name: 'Wiring', sys: 'Structure', size: 'Jumper wires', where: 'Between the decks', inside: true,
    info: 'Follows the firmware pin table: GPS to RX2/TX2 and VIN, the three I²C boards to D21/D22 and 3V3, and the battery through the INA219 to the charger.' }
};
PARTS.forEach(p => { const s = SUBS[subOf(p)]; if (s && !s.info && p.info) s.info = p.info; });

/* exploded-view offsets in mm, model axes (x, y, z up) */
export const OFF = {
  base: [0, 0, 0], deck1: [0, 0, 52], deck2: [0, 0, 98], top: [0, 0, 150],
  wall_xp: [85, 0, 48], wall_xn: [-85, 0, 48], wall_yp: [0, 85, 48], wall_yn: [0, -85, 48],
  rail_pp: [72, 72, 48], rail_pn: [72, -72, 48], rail_np: [-72, 72, 48], rail_nn: [-72, -72, 48]
};
export const toV = (x, y, z) => new THREE.Vector3(x, z, -y);   // model (z up) to three.js (y up)

/* ---------- Canvas textures ---------- */
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function srgb(tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; return tex; }
function seeded(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

function foamTex(hex) {
  const [c, g] = canvas(256, 256), r = seeded(7);
  g.fillStyle = hex; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { const a = r() * 0.05; g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.4})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2); }
  const t = srgb(new THREE.CanvasTexture(c)); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function pcbTex(base, label, sub, seed) {
  const W = 512, H = 512, [c, g] = canvas(W, H), r = seeded(seed);
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 5; g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    let x = r() * W, y = r() * H; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { if (r() > 0.5) x += (r() - 0.5) * 260; else y += (r() - 0.5) * 260; g.lineTo(x, y); }
    g.stroke();
  }
  g.fillStyle = 'rgba(214,176,92,0.85)';
  for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(r() * W, r() * H, 5 + r() * 4, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(235,240,244,0.92)'; g.textAlign = 'center';
  g.font = '600 46px "IBM Plex Mono", monospace'; g.fillText(label, W / 2, H * 0.52);
  if (sub) { g.font = '400 28px "IBM Plex Mono", monospace'; g.fillText(sub, W / 2, H * 0.62); }
  g.strokeStyle = 'rgba(235,240,244,0.55)'; g.lineWidth = 3; g.strokeRect(16, 16, W - 32, H - 32);
  return srgb(new THREE.CanvasTexture(c));
}
function shieldTex(line1, line2) {
  const [c, g] = canvas(512, 512);
  const gr = g.createLinearGradient(0, 0, 512, 512); gr.addColorStop(0, '#d7dce0'); gr.addColorStop(1, '#aeb5bb');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  g.fillStyle = 'rgba(40,46,52,0.75)'; g.textAlign = 'center';
  g.font = '600 50px "IBM Plex Mono", monospace'; g.fillText(line1, 256, 240);
  g.font = '400 32px "IBM Plex Mono", monospace'; g.fillText(line2, 256, 300);
  return srgb(new THREE.CanvasTexture(c));
}
function solarTex() {
  const [c, g] = canvas(1024, 704);
  g.fillStyle = '#0d2448'; g.fillRect(0, 0, 1024, 704);
  const cols = 5, rows = 3, gap = 12, cw = (1024 - gap * (cols + 1)) / cols, ch = (704 - gap * (rows + 1)) / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = gap + i * (cw + gap), y = gap + j * (ch + gap), gr = g.createLinearGradient(x, y, x + cw, y + ch);
    gr.addColorStop(0, '#244f8f'); gr.addColorStop(0.5, '#173a70'); gr.addColorStop(1, '#10284f');
    g.fillStyle = gr; g.fillRect(x, y, cw, ch);
    g.strokeStyle = 'rgba(206,214,224,.55)'; g.lineWidth = 2;
    for (let k = 1; k < 8; k++) { g.beginPath(); g.moveTo(x + cw * k / 8, y); g.lineTo(x + cw * k / 8, y + ch); g.stroke(); }
    g.lineWidth = 4; g.beginPath(); g.moveTo(x, y + ch / 2); g.lineTo(x + cw, y + ch / 2); g.stroke();
  }
  return srgb(new THREE.CanvasTexture(c));
}
function decalTex() {
  const [c, g] = canvas(830, 1035);
  g.fillStyle = '#1c2024'; g.fillRect(0, 0, 830, 1035);
  g.strokeStyle = 'rgba(230,236,239,.22)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(215, 330); g.lineTo(615, 330); g.moveTo(215, 745); g.lineTo(615, 745); g.stroke();
  g.textAlign = 'center';
  g.fillStyle = '#E6ECEF'; g.font = '700 120px "Saira Semi Condensed", "Arial Narrow", sans-serif'; g.fillText('SARAB-1', 415, 470);
  g.fillStyle = '#5EB3E8'; g.font = '600 96px "IBM Plex Sans Arabic", sans-serif'; g.fillText('سراب', 415, 605);
  g.fillStyle = 'rgba(230,236,239,.62)'; g.font = '500 32px "Saira Semi Condensed", sans-serif'; g.fillText('TEAM CODEBUSTERS · SATFORGE UAE 2026', 415, 705);
  return srgb(new THREE.CanvasTexture(c));
}
function batteryTex() {
  const [c, g] = canvas(512, 352);
  const gr = g.createLinearGradient(0, 0, 0, 352); gr.addColorStop(0, '#b9c3cc'); gr.addColorStop(1, '#8e9aa5');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 352);
  g.fillStyle = '#25313b'; g.fillRect(40, 90, 432, 170);
  g.fillStyle = '#e8edf1'; g.textAlign = 'center';
  g.font = '600 52px "IBM Plex Mono", monospace'; g.fillText('3.7V 1000mAh', 256, 168);
  g.font = '400 34px "IBM Plex Mono", monospace'; g.fillText('Li-Po 103450', 256, 222);
  return srgb(new THREE.CanvasTexture(c));
}
function oledCanvas(h = 316) { const [c, g] = canvas(512, h); return { c, g, tex: srgb(new THREE.CanvasTexture(c)) }; }
function drawOled(o, lines) {
  const g = o.g, H = o.c.height, k = H / 316;
  g.fillStyle = '#030405'; g.fillRect(0, 0, 512, H);
  g.fillStyle = '#8fd8ff'; g.font = `500 ${Math.round(44 * Math.min(1, k * 1.05))}px "IBM Plex Mono", monospace`; g.fillText(lines[0] || 'SARAB-1', 26, 66 * k);
  g.fillStyle = '#7fc9f0'; g.font = `400 ${Math.round(36 * Math.min(1, k * 1.05))}px "IBM Plex Mono", monospace`;
  (lines.slice(1)).forEach((l, i) => g.fillText(l, 26, (140 + i * 62) * k));
  o.tex.needsUpdate = true;
}

/* ---------- Materials ---------- */
const PCB_LABEL = { gps: ['GY-NEO6MV2', 'GPS'], ina219: ['INA219', 'I2C 0x40'], mpu6050: ['GY-521', 'MPU-6050'], charger: ['TP4056', '5V BOOST'], esp32: ['ESP32 DEVKIT', 'V1 · 30 PIN'], oled: ['', ''] };
function matFactory() {
  const cache = new Map();
  const get = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
  return {
    std: (key, o) => get(key, () => new THREE.MeshStandardMaterial(o)),
    phys: (key, o) => get(key, () => new THREE.MeshPhysicalMaterial(o)),
    foam: hex => get('foam' + hex, () => new THREE.MeshStandardMaterial({ map: foamTex(hex), roughness: 0.9, metalness: 0 })),
    tex: (key, fn) => get('tex' + key, fn)
  };
}

function partMaterial(p, M, oled) {
  const c = p.color;
  if (p.group === 'structure' || p.color === '#3A4048') {
    const foam = M.foam(c);
    if (p.tex === 'label') { const m = [foam, foam, foam, foam, foam, foam]; m[0] = M.tex('decal', () => new THREE.MeshStandardMaterial({ map: decalTex(), roughness: 0.85 })); return m; }
    return foam;
  }
  if (c === '#B8C0C6') return M.std('alu', { color: 0xc6cdd3, metalness: 0.9, roughness: 0.34 });
  if (c === '#C7CCD1') {
    const metal = M.std('metal', { color: 0xc9ced3, metalness: 0.85, roughness: 0.3 });
    if (p.id === 'esp_mod' || p.id === 'gps_mod') {
      const top = M.tex('shield-' + p.id, () => new THREE.MeshStandardMaterial({ map: p.id === 'esp_mod' ? shieldTex('ESP32-WROOM-32', 'Wi-Fi · BT') : shieldTex('u-blox', 'NEO-6M-0-001'), metalness: 0.75, roughness: 0.32 }));
      return [metal, metal, top, metal, metal, metal];
    }
    return metal;
  }
  if (c === '#2459A6' || c === '#1D1F24') {
    const isBlack = c === '#1D1F24', base = isBlack ? '#15171b' : '#1f4f99';
    const side = M.std('pcb' + base, { color: new THREE.Color(base), roughness: 0.5, metalness: 0.1 });
    const lab = PCB_LABEL[p.sub];
    if (!lab || !lab[0]) return side;
    const top = M.tex('pcbtop-' + p.sub, () => new THREE.MeshStandardMaterial({ map: pcbTex(base, lab[0], lab[1], p.id.length * 97 + 13), roughness: 0.48, metalness: 0.12 }));
    return [side, side, top, side, side, side];
  }
  if (p.id === 'battery') {
    const wrap = M.std('batt', { color: 0x9aa7b2, metalness: 0.55, roughness: 0.38 });
    const top = M.tex('battop', () => new THREE.MeshStandardMaterial({ map: batteryTex(), metalness: 0.4, roughness: 0.42 }));
    return [wrap, wrap, top, wrap, wrap, wrap];
  }
  if (p.tex === 'solar') {
    const edge = M.std('solar-edge', { color: 0x10284f, roughness: 0.4, metalness: 0.3 });
    const top = M.tex('solartop', () => new THREE.MeshPhysicalMaterial({ map: solarTex(), roughness: 0.22, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 }));
    return [edge, edge, top, edge, edge, edge];
  }
  if (p.id === 'solar_back') return M.std('solar-back', { color: 0x182436, roughness: 0.6, metalness: 0.2 });
  if (p.color === '#D8CBA8') return M.std('ceramic', { color: 0xd9cca8, roughness: 0.62, metalness: 0 });
  if (p.color === '#2E7D5B') return M.std('term', { color: 0x2e8a62, roughness: 0.5 });
  if (p.color === '#08090B') {
    const glass = M.std('glass', { color: 0x050607, roughness: 0.15, metalness: 0.2 });
    if (!oled) return glass;
    const screen = new THREE.MeshStandardMaterial({ map: oled.tex, emissive: 0xffffff, emissiveMap: oled.tex, emissiveIntensity: 0.9, roughness: 0.18, metalness: 0.1 });
    return [glass, glass, glass, glass, screen, glass];
  }
  return M.std('plastic', { color: 0x15171a, roughness: 0.55 });   // headers, ports
}

/* ---------- Pins and cables (detail) ---------- */
function pinRows() {
  const rows = [];
  for (const y of [1.45, 26.55]) for (let i = 0; i < 15; i++) rows.push([-14 - 17.78 + i * 2.54, y, 53.7]);
  for (let i = 0; i < 6; i++) rows.push([25 - 6.35 + i * 2.54, 4, 51.7]);
  for (let i = 0; i < 8; i++) rows.push([-8.89 + i * 2.54, -28.75, 51.7]);
  for (let i = 0; i < 4; i++) rows.push([-26, -3.81 + i * 2.54, 89.7]);
  return rows;
}
const CABLES = [
  { c: 0x111316, r: 0.8, pts: [[0, 34.5, 113.4], [0, 34.5, 106], [-6, 24, 99], [-16, 12, 92], [-22, 8, 89.4]] },
  { c: 0xd23b33, r: 0.45, pts: [[-26, -3.8, 90.2], [-33, -5, 87], [-39, 6, 72], [-36, 22, 61], [-31.8, 26.55, 54.9]] },
  { c: 0x16181b, r: 0.45, pts: [[-26, -1.3, 90.2], [-34, -2, 87], [-40, 8, 72], [-37, 23, 61], [-29.3, 26.55, 54.9]] },
  { c: 0xe0b52c, r: 0.45, pts: [[-26, 1.3, 90.2], [-35, 1, 87], [-41, 10, 72], [-38, 24, 61], [-26.7, 26.55, 54.9]] },
  { c: 0xe9edf0, r: 0.45, pts: [[-26, 3.8, 90.2], [-36, 4, 87], [-42, 12, 72], [-39, 25, 61], [-24.2, 26.55, 54.9]] },
  { c: 0x2f6fd0, r: 0.45, pts: [[1.5, 26.55, 54.9], [8, 26, 61], [17, 14, 58], [22.4, 4, 52.6]] },
  { c: 0xe0b52c, r: 0.45, pts: [[4, 26.55, 54.9], [11, 25, 60], [19, 12, 57], [24.9, 4, 52.6]] },
  { c: 0x2f6fd0, r: 0.45, pts: [[-6.6, 1.45, 54.9], [-4, -8, 58], [-2.5, -20, 55], [-1.3, -28.75, 52.6]] },
  { c: 0xe0b52c, r: 0.45, pts: [[-4, 1.45, 54.9], [-1, -8, 58], [0.5, -20, 55], [1.3, -28.75, 52.6]] },
  { c: 0x8a5cd6, r: 0.6, pts: [[-16, 1.45, 54.9], [-14, -12, 63], [-6, -34, 70], [0, -49.6, 72]] },
  { c: 0xd23b33, r: 0.7, pts: [[-37, 14, 12], [-36, -6, 10], [-12, -20, 9], [2, -21, 7.2]] },
  { c: 0x16181b, r: 0.7, pts: [[-37, 2, 12], [-34, -12, 10], [-12, -24, 9], [2, -23, 7.2]] },
  { c: 0xd23b33, r: 0.7, pts: [[30, -16, 8.5], [38, -4, 22], [36, 18, 34], [-6, 26.55, 54.9]] },
  { c: 0x2a2f36, r: 0.7, pts: [[40, -40, 113], [42, -38, 80], [40, -30, 30], [31, -24, 8.5]] }
];

/* ---------- Build ---------- */
export function buildSatellite({ detail = 'high', uniqueMaterials = false, oled = false } = {}) {
  const M = matFactory(), group = new THREE.Group(), meshes = [], bySub = {}, layers = {};
  const oledC = oled ? oledCanvas() : null;
  if (oledC) drawOled(oledC, ['SARAB-1', 'GPS --  SATS --', 'INTERF --', 'BATT --']);
  const hi = detail === 'high';
  for (const p of PARTS) {
    const min = Math.min(...p.s);
    const geo = hi && min >= 0.9 ? new RoundedBoxGeometry(p.s[0], p.s[2], p.s[1], 2, Math.min(0.7, min / 4)) : new THREE.BoxGeometry(p.s[0], p.s[2], p.s[1]);
    let mat = partMaterial(p, M, oledC);
    if (uniqueMaterials) mat = Array.isArray(mat) ? mat.map(m => m.clone()) : mat.clone();
    const m = new THREE.Mesh(geo, mat);
    const sub = subOf(p);
    m.position.copy(toV(p.c[0], p.c[1], p.c[2]));
    m.userData = { p, sub, layer: p.layer, base: m.position.clone(), off: toV(...(OFF[p.layer] || [0, 0, 0])) };
    m.castShadow = m.receiveShadow = hi;
    group.add(m); meshes.push(m); (bySub[sub] = bySub[sub] || []).push(m);
  }
  const details = new THREE.Group();
  if (hi) {
    const pins = pinRows(), pinMat = new THREE.MeshStandardMaterial({ color: 0xd6ad52, metalness: 1, roughness: 0.28 });
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.64, 2.4, 0.64), pinMat, pins.length), dummy = new THREE.Object3D();
    pins.forEach((q, i) => { dummy.position.copy(toV(q[0], q[1], q[2])); dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix); });
    details.add(inst);
    for (const cb of CABLES) {
      const curve = new THREE.CatmullRomCurve3(cb.pts.map(q => toV(q[0], q[1], q[2])));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, cb.r, 6, false), M.std('wire' + cb.c, { color: cb.c, roughness: 0.55, metalness: 0.05 }));
      tube.castShadow = true; details.add(tube);
    }
  }
  group.add(details);
  return {
    group, meshes, bySub, details,
    setExplode(e) {
      for (const m of meshes) m.position.copy(m.userData.base).addScaledVector(m.userData.off, e);
      details.visible = e < 0.02;
    },
    setOled(lines) { if (oledC) drawOled(oledC, lines); },
    redrawText() {   /* call once web fonts have loaded */
      meshes.forEach(m => (Array.isArray(m.material) ? m.material : [m.material]).forEach(mt => { if (mt.map && mt.map.image instanceof HTMLCanvasElement) mt.map.needsUpdate = true; }));
    }
  };
}

/* ---------- Detailed model from Blender ---------- */
const GLB = new URL('../assets/sarab1.glb', import.meta.url).href;
let gltfLoad = null;

/* Same interface as buildSatellite. Every node carries {part, sub, layer, kind} from the Blender script;
   the exploded view moves one group per layer, and cables hide while the cube is apart. */
export async function loadSatellite({ uniqueMaterials = false, oled = false } = {}) {
  const gltf = await (gltfLoad = gltfLoad || new GLTFLoader().loadAsync(GLB));
  const group = gltf.scene.clone(true), meshes = [], bySub = {}, layers = [], cables = [];
  const oledC = oled ? oledCanvas(256) : null;
  if (oledC) drawOled(oledC, ['SARAB-1', 'GPS --  SATS --', 'INTERF --', 'BATT --']);
  group.traverse(o => {
    if (!o.isMesh) { if (o.name.startsWith('L_') && OFF[o.userData.layer]) layers.push({ o, off: toV(...OFF[o.userData.layer]) }); return; }
    const u = o.userData.sub ? o.userData : o.parent.userData;     // a node with several materials arrives as a group of meshes
    o.userData = { p: { id: u.part }, sub: u.sub, layer: u.layer, kind: u.kind };
    if (uniqueMaterials) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
    if (u.kind === 'screen' && oledC) o.material = new THREE.MeshStandardMaterial({ map: oledC.tex, emissive: 0xffffff, emissiveMap: oledC.tex, emissiveIntensity: 1.1, roughness: 0.25 });
    if (u.kind === 'cable') cables.push(o);
    o.castShadow = o.receiveShadow = true;
    meshes.push(o); (bySub[u.sub] = bySub[u.sub] || []).push(o);
  });
  return {
    group, meshes, bySub, detailed: true,
    setExplode(e) {
      for (const l of layers) l.o.position.copy(l.off).multiplyScalar(e);
      for (const c of cables) c.visible = e < 0.02;
    },
    setOled(lines) { if (oledC) drawOled(oledC, lines); },
    redrawText() {}
  };
}

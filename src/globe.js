/* Mission view: the real Earth (NASA Blue Marble by day, Black Marble city lights by night,
   lit by the real Sun for the current time), SARAB-1 on its pass over the Gulf, its listening
   footprint, flagged interference zones and the downlink to the Al Ain ground station. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WATER, COAST_SEGMENTS, BAHRAIN, QESHM, MAP_LABELS, GROUND_STATION } from './gulf.js';
import { trackAt, PASS } from './sim.js';
import { buildSatellite } from './sat-model.js';

const R = 1000, ALT = 82;   // 1 unit = 6.37 km, so 82 units is the real 525 km altitude
const TEX = 'https://cdn.jsdelivr.net/npm/three-globe@2.45.6/example/img/';
const STATE_HEX = { NOMINAL: 0x5eb3e8, SUSPECT: 0xe6ab47, JAMMING: 0xf26c60, SPOOFING: 0xf065bb };
const rad = d => d * Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function ll(lat, lon, r) {
  const a = rad(lat), o = rad(lon);
  return new THREE.Vector3(r * Math.cos(a) * Math.cos(o), r * Math.sin(a), -r * Math.cos(a) * Math.sin(o));
}
function sunDirection(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0), day = (date - start) / 864e5;
  const decl = -23.44 * Math.cos(2 * Math.PI / 365 * (day + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  return ll(decl, -15 * (hours - 12), 1).normalize();
}
function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.2, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
function solidTex(hex) {
  const c = document.createElement('canvas'); c.width = c.height = 2;
  const g = c.getContext('2d'); g.fillStyle = hex; g.fillRect(0, 0, 2, 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const EARTH_VS = `varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main(){ vUv=uv; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.0); vP=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;
const EARTH_FS = `uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D waterMap; uniform vec3 sunDir; uniform float hasTex;
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main(){
  vec3 n=normalize(vN); vec3 v=normalize(cameraPosition-vP);
  float d=dot(n,sunDir); float day=smoothstep(-0.10,0.22,d);
  vec3 dayC=texture2D(dayMap,vUv).rgb; vec3 nightC=texture2D(nightMap,vUv).rgb;
  float water=texture2D(waterMap,vUv).r;
  vec3 col=dayC*(0.14+0.8*max(d,0.0))*day;
  col+=pow(nightC,vec3(1.35))*vec3(1.0,0.78,0.48)*2.2*(1.0-day);
  col+=vec3(0.006,0.014,0.024)*(1.0-day);
  vec3 h=normalize(sunDir+v); col+=pow(max(dot(n,h),0.0),70.0)*water*day*vec3(0.55,0.65,0.8)*0.7;
  float rim=pow(1.0-max(dot(n,v),0.0),3.0); col+=vec3(0.25,0.55,0.95)*rim*(0.12+0.5*day);
  col=mix(vec3(0.03,0.06,0.09),col,hasTex);
  gl_FragColor=vec4(col,1.0);
  #include <colorspace_fragment>
}`;
const ATMO_VS = `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`;
const ATMO_FS = `varying vec3 vN; varying vec3 vV; void main(){ float f=pow(1.0-abs(dot(vN,vV)),2.4); gl_FragColor=vec4(0.30,0.62,1.0,1.0)*f*1.15; }`;

export function createGlobe(box, labelBox, { reducedMotion = false, onReady } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  if (!renderer.getContext()) throw new Error('webgl');
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x02070a, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', '3D view of SARAB-1 orbiting over the Arabian Gulf, with flagged interference zones');
  box.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 1, 60000);
  const LA = 25.0, LO = 55.8, T = ll(LA, LO, R), n = T.clone().normalize();
  const north = new THREE.Vector3(-Math.sin(rad(LA)) * Math.cos(rad(LO)), Math.cos(rad(LA)), Math.sin(rad(LA)) * Math.sin(rad(LO))).normalize();
  camera.up.copy(n);
  const HOME = T.clone().addScaledVector(north, -262).addScaledVector(n, 246);
  camera.position.copy(HOME);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(T); controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.minDistance = 130; controls.maxDistance = 3200; controls.maxPolarAngle = rad(80); controls.rotateSpeed = 0.5; controls.zoomSpeed = 0.8;

  /* lights for the satellite model */
  const sunVec = sunDirection(new Date());
  scene.add(new THREE.AmbientLight(0x8fa7bb, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.copy(sunVec).multiplyScalar(5000); scene.add(sun);

  /* Earth */
  const uniforms = { dayMap: { value: solidTex('#0d1a22') }, nightMap: { value: solidTex('#000000') }, waterMap: { value: solidTex('#000000') }, sunDir: { value: sunVec.clone() }, hasTex: { value: 0 } };
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 192, 128), new THREE.ShaderMaterial({ uniforms, vertexShader: EARTH_VS, fragmentShader: EARTH_FS }));
  scene.add(earth);
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  let settled = 0;
  const done = () => { if (++settled === 3 && onReady) onReady(); };
  const load = (file, key, color) => loader.load(TEX + file, t => {
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, maxAniso); uniforms[key].value = t;
    if (key === 'dayMap') uniforms.hasTex.value = 1;
    done();
  }, undefined, done);   // on failure the plain fallback colours stay
  load('earth-blue-marble.jpg', 'dayMap', true);
  load('earth-night.jpg', 'nightMap', true);
  load('earth-water.png', 'waterMap', false);

  /* crisp coastlines for the region, so the zoomed view stays sharp */
  const coastMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0x5eb3e8).multiplyScalar(0.9), transparent: true, opacity: 0.75 });
  for (const seg of [...COAST_SEGMENTS, BAHRAIN.concat([BAHRAIN[0]]), QESHM.concat([QESHM[0]])]) {
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(seg.map(p => ll(p[1], p[0], R + 0.6))), coastMat));
  }
  const grid = [];
  for (let la = -80; la <= 80; la += 10) for (let lo = 0; lo < 360; lo += 2) grid.push(ll(la, lo, R + 0.4), ll(la, lo + 2, R + 0.4));
  for (let lo = 0; lo < 360; lo += 10) for (let la = -88; la < 88; la += 2) grid.push(ll(la, lo, R + 0.4), ll(la + 2, lo, R + 0.4));
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(grid), new THREE.LineBasicMaterial({ color: 0x5eb3e8, transparent: true, opacity: 0.05 })));

  /* atmosphere and stars */
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.03, 128, 96), new THREE.ShaderMaterial({ vertexShader: ATMO_VS, fragmentShader: ATMO_FS, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })));
  const stars = [];
  for (let i = 0; i < 1400; i++) { const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u); stars.push(new THREE.Vector3(s * Math.cos(t), u, s * Math.sin(t)).multiplyScalar(30000)); }
  scene.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(stars), new THREE.PointsMaterial({ color: 0xc8d6e2, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.75 })));

  /* orbit, ground trace, and the part of this pass already flown */
  const orbitPts = [], tracePts = [];
  for (let k = -300; k <= 420; k += 3) { const q = trackAt(k); orbitPts.push(ll(q.lat, q.lon, R + ALT)); tracePts.push(ll(q.lat, q.lon, R + 0.9)); }
  const orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(orbitPts), new THREE.LineBasicMaterial({ color: 0x5eb3e8, transparent: true, opacity: 0.32 }));
  const traceLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(tracePts), new THREE.LineDashedMaterial({ color: 0x5eb3e8, dashSize: 5, gapSize: 6, transparent: true, opacity: 0.4 }));
  traceLine.computeLineDistances();
  const trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(orbitLine, traceLine, trail);

  /* satellite */
  const satRoot = new THREE.Group(), satModel = buildSatellite({ detail: 'low' });
  satModel.group.scale.setScalar(0.11);                       // 100 mm cube shown about 11 units (exaggerated)
  satModel.group.position.set(0, -6.2, 0);
  const satPivot = new THREE.Group(); satPivot.add(satModel.group); satPivot.rotation.x = -Math.PI / 2; // top face away from Earth
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0x5eb3e8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(58, 58, 1);
  const coneMat = new THREE.MeshBasicMaterial({ color: 0x5eb3e8, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(64, ALT, 64, 1, true), coneMat);
  cone.rotation.x = -Math.PI / 2; cone.position.z = ALT / 2;
  satRoot.add(satPivot, halo, cone); scene.add(satRoot);
  const footDisk = new THREE.Mesh(new THREE.CircleGeometry(64, 96), new THREE.MeshBasicMaterial({ color: 0x5eb3e8, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
  const footRing = new THREE.Mesh(new THREE.RingGeometry(62.5, 64.5, 128), new THREE.MeshBasicMaterial({ color: 0x5eb3e8, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  scene.add(footDisk, footRing);

  /* bench marker for live data from the prototype on the ground */
  const bench = new THREE.Group();
  const benchRing = new THREE.Mesh(new THREE.RingGeometry(7, 9, 64), new THREE.MeshBasicMaterial({ color: 0x5eb3e8, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
  const benchPulse = new THREE.Mesh(new THREE.RingGeometry(8, 9, 64), new THREE.MeshBasicMaterial({ color: 0x5eb3e8, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  bench.add(benchRing, benchPulse); bench.visible = false; scene.add(bench);

  /* ground station and downlink */
  const gsN = ll(GROUND_STATION.lat, GROUND_STATION.lon, 1).normalize();
  const gs = new THREE.Mesh(new THREE.ConeGeometry(3.4, 10, 4), new THREE.MeshStandardMaterial({ color: 0xe1eaef, roughness: 0.5 }));
  gs.position.copy(ll(GROUND_STATION.lat, GROUND_STATION.lon, R + 5)); gs.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), gsN); scene.add(gs);
  const gsTop = ll(GROUND_STATION.lat, GROUND_STATION.lon, R + 10);
  const link = new THREE.Line(new THREE.BufferGeometry().setFromPoints([gsTop, gsTop.clone()]), new THREE.LineDashedMaterial({ color: new THREE.Color(0x4fc283).multiplyScalar(1.6), dashSize: 4, gapSize: 4, transparent: true }));
  link.visible = false; scene.add(link);

  /* interference zones */
  const zones = new THREE.Group(); scene.add(zones);
  const zoneGlow = glowTex();
  let zoneKey = '';
  function rebuildZones(marks) {
    while (zones.children.length) { const z = zones.children.pop(); z.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    for (const mk of marks) {
      const hex = mk.kind === 'spoof' ? 0xf065bb : 0xf26c60, g = new THREE.Group();
      const mat = (o, add) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(add ? 1.8 : 1), transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
      const glow = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshBasicMaterial({ map: zoneGlow, color: hex, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(14, 15.8, 96), mat(0.95, true));
      const pulse = new THREE.Mesh(new THREE.RingGeometry(14, 15, 96), mat(0.8, true));
      g.add(glow, ring, pulse); g.position.copy(ll(mk.lat, mk.lon, R + 1.6)); g.lookAt(0, 0, 0);
      g.userData = { t: mk.t, ring, pulse, glow };
      zones.add(g);
    }
  }

  /* HTML labels, placed in priority order; one that would overlap a label already placed waits until there is room */
  const RANK = { gs: 0, 'sea-s': 1, city: 2, sea: 3, 'cty-s': 4, cty: 4 };
  const labels = MAP_LABELS.map(l => { const d = document.createElement('div'); d.className = 'gl gl-' + l[3]; d.textContent = l[0]; labelBox.append(d); return { el: d, v: ll(l[1], l[2], R + 1), centred: l[3] !== 'city', rank: RANK[l[3]], dx: 8, dy: -9 }; });
  const gsLab = document.createElement('div'); gsLab.className = 'gl gl-gs'; gsLab.textContent = GROUND_STATION.name; labelBox.append(gsLab);
  labels.push({ el: gsLab, v: ll(GROUND_STATION.lat, GROUND_STATION.lon, R + 1), centred: false, rank: RANK.gs, dx: 10, dy: 2 });
  labels.sort((a, b) => a.rank - b.rank);
  const satLab = document.createElement('div'); satLab.className = 'gl gl-sat'; satLab.textContent = 'SARAB-1'; labelBox.append(satLab);
  const tmp = new THREE.Vector3(), toCam = new THREE.Vector3();
  let W = 1, H = 1;
  function place(el, v, centred, dx, dy, face, taken) {
    const hide = () => { el.style.transform = 'translate(-9999px,0)'; };
    if (face) { toCam.copy(camera.position).sub(v); if (toCam.dot(v) < 0) return hide(); }
    tmp.copy(v).project(camera);
    if (tmp.z > 1 || Math.abs(tmp.x) > 1.15 || Math.abs(tmp.y) > 1.15) return hide();
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = (tmp.x + 1) / 2 * W + dx, y = (1 - tmp.y) / 2 * H + dy;
    if (centred) { x -= w / 2; y -= h / 2; }
    if (taken.some(b => x < b.x + b.w + 4 && b.x < x + w + 4 && y < b.y + b.h + 2 && b.y < y + h + 2)) return hide();
    taken.push({ x, y, w, h });
    el.style.transform = `translate(${x.toFixed(0)}px,${y.toFixed(0)}px)`;
  }

  /* post-processing: a soft bloom on the orbit, halo, zones and city lights */
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.55, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function size() {
    const r = box.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    renderer.setSize(W, H, false); composer.setSize(W, H); bloom.setSize(W, H);
    camera.aspect = W / H; camera.fov = W < 560 ? 48 : 36; camera.updateProjectionMatrix();
  }
  size();
  new ResizeObserver(size).observe(box);

  let state = { mode: 'sim', tl: 0, live: null, marks: [], status: 'NOMINAL', clock: Date.now() };
  let running = true, last = 0;
  function frame(ms) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const hex = STATE_HEX[state.status] || 0x5eb3e8, sim = state.mode === 'sim', taken = [];
    satRoot.visible = footDisk.visible = footRing.visible = trail.visible = sim;
    orbitLine.material.opacity = sim ? 0.32 : 0.12; traceLine.visible = sim;
    const ph = (ms % 1800) / 1800;
    if (sim) {
      const p = trackAt(state.tl), sp = ll(p.lat, p.lon, R + ALT);
      satRoot.position.copy(sp); satRoot.lookAt(0, 0, 0);
      footDisk.position.copy(ll(p.lat, p.lon, R + 1.2)); footDisk.lookAt(0, 0, 0);
      footRing.position.copy(ll(p.lat, p.lon, R + 1.3)); footRing.lookAt(0, 0, 0);
      [halo.material, coneMat, footDisk.material, footRing.material].forEach(m => m.color.setHex(hex));
      halo.material.color.multiplyScalar(1.6);
      const pts = [], cols = [], head = new THREE.Color(0x8fd3ff).multiplyScalar(1.7);
      const start = Math.max(0, state.tl - 70);
      for (let k = start; k < state.tl; k += 1.5) { const q = trackAt(k); pts.push(ll(q.lat, q.lon, R + ALT)); const f = (k - start) / Math.max(1, state.tl - start); cols.push(head.r * f * f, head.g * f * f, head.b * f * f); }
      pts.push(sp.clone()); cols.push(head.r, head.g, head.b);
      if (pts.length < 2) { pts.unshift(sp.clone()); cols.unshift(0, 0, 0); }
      trail.geometry.dispose();
      trail.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      trail.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const dGs = Math.hypot(p.lat - GROUND_STATION.lat, (p.lon - GROUND_STATION.lon) * Math.cos(rad(GROUND_STATION.lat)));
      link.visible = dGs < 9;
      if (link.visible) { link.geometry.setFromPoints([gsTop, sp]); link.computeLineDistances(); }
      satLab.style.display = '';
      place(satLab, sp, false, 16, -30, false, taken);
    } else {
      link.visible = false; satLab.style.display = 'none';
    }
    bench.visible = !sim && !!state.live;
    if (bench.visible) {
      bench.position.copy(ll(state.live.lat, state.live.lon, R + 1.4)); bench.lookAt(0, 0, 0);
      benchRing.material.color.setHex(hex).multiplyScalar(1.6); benchPulse.material.color.setHex(hex).multiplyScalar(1.6);
      const s = 1 + ph * 2.2; benchPulse.scale.set(s, s, 1); benchPulse.material.opacity = (1 - ph) * 0.8;
    }
    const key = state.marks.map(m => m.t).join(',');
    if (key !== zoneKey) { zoneKey = key; rebuildZones(state.marks); }
    for (const z of zones.children) {
      const age = (state.clock - z.userData.t) / 1000, fade = clamp(1 - age / 900, 0.35, 1);
      z.userData.ring.material.opacity = 0.95 * fade; z.userData.glow.material.opacity = 0.55 * fade;
      const recent = age < 150 && !reducedMotion; z.userData.pulse.visible = recent;
      if (recent) { const s = 1 + ph * 1.9; z.userData.pulse.scale.set(s, s, 1); z.userData.pulse.material.opacity = (1 - ph) * 0.85; }
    }
    if (ms - last > 60000) { last = ms; uniforms.sunDir.value.copy(sunDirection(new Date())); sun.position.copy(uniforms.sunDir.value).multiplyScalar(5000); }
    controls.update();
    composer.render();
    for (const l of labels) place(l.el, l.v, l.centred, l.centred ? 0 : l.dx, l.centred ? 0 : l.dy, true, taken);
  }
  requestAnimationFrame(frame);

  return {
    update(s) { state = Object.assign(state, s); },
    resetView() { camera.position.copy(HOME); controls.target.copy(T); },
    destroy() { running = false; renderer.dispose(); }
  };
}

export { PASS };

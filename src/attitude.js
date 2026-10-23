/* Housekeeping view: the SARAB-1 model tilted to match the motion sensor, with the antenna
   boresight (blue arrow) against straight up (dashed). The front screen mirrors live status. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildSatellite, loadSatellite } from './sat-model.js';

const rad = d => d * Math.PI / 180;

export function createAttitude(box, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  if (!renderer.getContext()) throw new Error('webgl');
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', '3D model of SARAB-1 tilted to match the motion sensor');
  box.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const cam = new THREE.PerspectiveCamera(28, 1, 1, 6000);
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(180, 320, 220); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 900 });
  scene.add(key, new THREE.HemisphereLight(0xcfe3f2, 0x1a2630, 0.35));

  let sat = buildSatellite({ detail: 'high', oled: true }), screen = null;
  const tilt = new THREE.Group(); sat.group.position.y = -57; tilt.add(sat.group); scene.add(tilt);
  loadSatellite({ oled: true }).then(s => {         // swap in the detailed Blender model once it has loaded
    tilt.remove(sat.group); s.group.position.y = -57; tilt.add(s.group); sat = s;
    if (screen) sat.setOled(screen);
  }).catch(e => console.warn('Detailed model unavailable:', e));
  tilt.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 63, 0), 92, 0x1d6fb3, 16, 9));
  const zen = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 63, 0), new THREE.Vector3(0, 178, 0)]),
    new THREE.LineDashedMaterial({ color: 0x5f6b75, dashSize: 6, gapSize: 5, transparent: true, opacity: 0.75 }));
  zen.computeLineDistances(); scene.add(zen);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(150, 64), new THREE.ShadowMaterial({ opacity: 0.35 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -58; ground.receiveShadow = true; scene.add(ground);

  function size() {
    const r = box.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  size(); new ResizeObserver(size).observe(box);

  let roll = 0, pitch = 0, ang = 0.75, running = true;
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    if (document.hidden) return;
    if (!reducedMotion) ang += 0.0028;
    cam.position.set(Math.sin(ang) * 520, 190, Math.cos(ang) * 520); cam.lookAt(0, 40, 0);
    tilt.rotation.set(rad(pitch), 0, -rad(roll));
    renderer.render(scene, cam);
  }
  requestAnimationFrame(frame);
  return {
    update(c) { roll = c.roll || 0; pitch = c.pitch || 0; },
    setScreen(lines) { screen = lines; sat.setOled(lines); },
    destroy() { running = false; renderer.dispose(); }
  };
}

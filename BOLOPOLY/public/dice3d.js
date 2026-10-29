/* BOLOPOLY — dés 3D (Three.js + cannon-es). Chargé en module ; expose window.Dice3D.play({ interactive }) → Promise<[a, b]>.
   Le résultat est lu sur la face supérieure des dés une fois immobiles : c'est la physique qui décide. */
import * as THREE from './vendor/three.module.min.js';
import * as CANNON from './vendor/cannon-es.js';

let R = null;               // rendu persistant (créé au premier lancer)
let busy = false;
const FACE_VALUES = [3, 4, 1, 6, 2, 5];   // +x −x +y −y +z −z (faces opposées = 7)
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function pipTexture(n) {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, s, s); grad.addColorStop(0, '#fffaf0'); grad.addColorStop(1, '#efe3c8');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = 10; g.strokeRect(5, 5, s - 10, s - 10);
  const P = { 1: [[.5, .5]], 2: [[.27, .27], [.73, .73]], 3: [[.27, .27], [.5, .5], [.73, .73]], 4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]],
    5: [[.27, .27], [.73, .27], [.5, .5], [.27, .73], [.73, .73]], 6: [[.27, .25], [.73, .25], [.27, .5], [.73, .5], [.27, .75], [.73, .75]] };
  P[n].forEach(([x, y]) => {
    g.beginPath(); g.arc(x * s, y * s, n === 1 ? 34 : 24, 0, Math.PI * 2);
    g.fillStyle = n === 1 ? '#d9462b' : '#103d2b'; g.fill();
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/* ---- Sons : synthèse par défaut ; si public/sounds/dice-throw.mp3 / dice-hit.mp3 existent, ils sont utilisés à la place ---- */
const SND = { ac: null, files: {}, tried: false };
function audio() {
  try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; SND.ac = SND.ac || new AC(); if (SND.ac.state === 'suspended') SND.ac.resume(); return SND.ac; } catch (e) { return null; }
}
function loadFiles() {
  if (SND.tried) return; SND.tried = true; const ac = audio(); if (!ac) return;
  ['dice-throw', 'dice-hit'].forEach((n) => {
    ['mp3', 'ogg', 'wav'].forEach((ext) => {
      if (SND.files[n]) return;
      fetch(`sounds/${n}.${ext}`).then((r) => (r.ok && /audio|octet/.test(r.headers.get('content-type') || '') ? r.arrayBuffer() : Promise.reject())).then((ab) => ac.decodeAudioData(ab)).then((buf) => { SND.files[n] = buf; }).catch(() => {});
    });
  });
}
function playBuf(buf, gain, rate) {
  const ac = audio(); if (!ac) return; const src = ac.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate || 1;
  const g = ac.createGain(); g.gain.value = gain; src.connect(g); g.connect(ac.destination); src.start();
}
function knock(at, strength) {   // « toc » sec d'un dé sur du bois : transitoire bruité + corps résonant
  const ac = audio(); if (!ac) return; const t = ac.currentTime + at, vol = Math.min(0.55, 0.06 + strength * 0.035);
  const len = 0.045, buf = ac.createBuffer(1, Math.floor(ac.sampleRate * len), ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.5);
  const n = ac.createBufferSource(); n.buffer = buf; const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400 + Math.random() * 1400; f.Q.value = 1.2;
  const gn = ac.createGain(); gn.gain.value = vol; n.connect(f); f.connect(gn); gn.connect(ac.destination); n.start(t);
  const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(240 + Math.random() * 120, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.07);
  const go = ac.createGain(); go.gain.setValueAtTime(vol * 0.9, t); go.gain.exponentialRampToValueAtTime(0.001, t + 0.09); o.connect(go); go.connect(ac.destination); o.start(t); o.stop(t + 0.1);
}
function blip(strength) { loadFiles(); if (SND.files['dice-hit']) playBuf(SND.files['dice-hit'], Math.min(1, 0.15 + strength * 0.06), 0.9 + Math.random() * 0.2); else knock(0, strength); }
function rattle() {   // dés secoués dans la main avant le jet
  loadFiles(); if (SND.files['dice-throw']) { playBuf(SND.files['dice-throw'], 0.8, 1); return; }
  for (let i = 0; i < 9; i++) knock(i * 0.045 + Math.random() * 0.02, 1.5 + Math.random() * 2.5);
}
const netSend = (m) => { try { if (window.DiceNetSend) window.DiceNetSend(m); } catch (e) { /* hors ligne */ } };

function build() {
  const root = document.createElement('div'); root.id = 'diceStage'; root.className = 'dice-stage hidden';
  root.innerHTML = '<canvas></canvas><div class="ds-top"><b>Glisse, puis relâche</b><span>Plus tu lances fort, plus ça roule</span></div>'
    + '<button type="button" class="ds-btn">🎲 Lancer</button><div class="ds-res"></div>';
  document.body.appendChild(root);
  const canvas = root.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 15, 8); camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2b5a45, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(-4, 12, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
  scene.add(sun);
  const mats = FACE_VALUES.map((v) => new THREE.MeshStandardMaterial({ map: pipTexture(v), roughness: 0.35, metalness: 0.02 }));
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const dice = [0, 1].map(() => { const m = new THREE.Mesh(geo, mats); m.castShadow = true; scene.add(m); return m; });
  const felt = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.32 }));
  felt.rotation.x = -Math.PI / 2; felt.receiveShadow = true; scene.add(felt);
  const rim = new THREE.Object3D();

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -32, 0) });
  world.allowSleep = true; world.defaultContactMaterial.friction = 0.35; world.defaultContactMaterial.restitution = 0.38;
  const bodies = dice.map(() => {
    const b = new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)), linearDamping: 0.08, angularDamping: 0.2, allowSleep: true, sleepSpeedLimit: 0.15, sleepTimeLimit: 0.3 });
    b.addEventListener('collide', (e) => { const v = Math.abs(e.contact.getImpactVelocityAlongNormal()); if (v > 1.2) { blip(v); netSend({ k: 'b', s: +v.toFixed(1) }); } });
    world.addBody(b); return b;
  });
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() }); ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0); world.addBody(ground);
  R = { root, canvas, renderer, scene, camera, dice, bodies, world, felt, rim, walls: [], ac: null };
  window.addEventListener('resize', () => { if (!root.classList.contains('hidden')) fit(); });
  window.addEventListener('scroll', () => { if (!root.classList.contains('hidden')) fit(); }, true);
}

function boardRect() {
  const el = document.getElementById('board') || document.querySelector('.board');
  const r = el && el.getBoundingClientRect();
  if (r && r.width > 120 && r.height > 120) return r;
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}
function fit() {
  const r = boardRect(), st = R.root.style;
  st.left = r.left + 'px'; st.top = r.top + 'px'; st.width = r.width + 'px'; st.height = r.height + 'px';
  const w = r.width, h = r.height;
  R.renderer.setSize(w, h, false); R.camera.aspect = w / h;
  R.camera.position.set(0, 17, 2.2); R.camera.lookAt(0, 0, 0); R.camera.updateProjectionMatrix(); R.camera.updateMatrixWorld(true);
  // cadrage : la table de jeu est le centre du plateau
  const c = (document.querySelector('.board-center') || R.canvas).getBoundingClientRect();
  const ray = (px, py) => { const v = new THREE.Vector3(((px - r.left) / w) * 2 - 1, -(((py - r.top) / h) * 2 - 1), 0.5).unproject(R.camera); const d = v.sub(R.camera.position).normalize(); const t = -R.camera.position.y / d.y; return R.camera.position.clone().addScaledVector(d, t); };
  const tl = ray(c.left + 4, c.top + 4), br = ray(c.right - 4, c.bottom - 4);
  R.cx = (tl.x + br.x) / 2; R.cz = (tl.z + br.z) / 2; R.hx = Math.abs(br.x - tl.x) / 2; R.hz = Math.abs(br.z - tl.z) / 2;
  R.walls.forEach((w2) => R.world.removeBody(w2)); R.walls = [];
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([sx, sz]) => {
    const w2 = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(sx ? 0.5 : R.hx + 1, 6, sz ? 0.5 : R.hz + 1)) });
    w2.position.set(R.cx + sx * (R.hx + 0.5), 5, R.cz + sz * (R.hz + 0.5)); R.world.addBody(w2); R.walls.push(w2);
  });
}

function planePoint(clientX, clientY, y) {
  const r = R.canvas.getBoundingClientRect();
  const v = new THREE.Vector3(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1), 0.5).unproject(R.camera);
  const d = v.sub(R.camera.position).normalize(); const t = (y - R.camera.position.y) / d.y;
  return R.camera.position.clone().addScaledVector(d, t);
}
function readTop(i) {
  const q = R.bodies[i].quaternion; let best = -2, val = 1;
  AXES.forEach((ax, k) => { const v = new CANNON.Vec3(ax[0], ax[1], ax[2]); const w = q.vmult(v); if (w.y > best) { best = w.y; val = FACE_VALUES[k]; } });
  return { val, flat: best };
}
function sync() { R.dice.forEach((m, i) => { m.position.copy(R.bodies[i].position); m.quaternion.copy(R.bodies[i].quaternion); }); }

function play({ interactive = true, fast = false } = {}) {
  if (busy) return Promise.reject(new Error('busy'));
  busy = true;
  if (!R) build();
  const { root, canvas, bodies, world } = R;
  root.classList.remove('hidden'); root.classList.toggle('auto', !interactive);
  root.querySelector('.ds-res').textContent = ''; root.querySelector('.ds-res').classList.remove('on');
  fit();
  return new Promise((resolve) => {
    netSend({ k: 's' });
    let netT = 0, phase = 'hold', raf = 0, last = performance.now(), calm = 0, t0 = 0, idleT = 0;
    const samples = [], home = [new THREE.Vector3(R.cx, 2.4, R.cz + R.hz * 0.35)];
    const place = (c) => bodies.forEach((b, i) => {
      b.type = CANNON.Body.KINEMATIC; b.velocity.setZero(); b.angularVelocity.setZero();
      b.position.set(c.x + (i ? 0.6 : -0.6), c.y, c.z + (i ? 0.1 : -0.1));
      b.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, Math.random() * 6); b.wakeUp();
    });
    place(home[0]);
    const hold = { x: R.cx, z: R.cz + R.hz * 0.35 };

    function launch(vx, vz) {
      rattle(); netSend({ k: 'r' });
      phase = 'fly'; t0 = performance.now(); root.classList.add('flying');
      bodies.forEach((b, i) => {
        b.type = CANNON.Body.DYNAMIC; b.mass = 1; b.updateMassProperties(); b.wakeUp();
        const s = 1 + (Math.random() - 0.5) * 0.25;
        b.velocity.set(vx * s + (Math.random() - 0.5) * 2, 3 + Math.random() * 3, vz * s + (Math.random() - 0.5) * 2);
        b.angularVelocity.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);
      });
    }
    const autoThrow = () => launch((Math.random() - 0.5) * 6, -(8 + Math.random() * 6) * Math.max(0.7, Math.min(1.4, R.hz / 4)));

    function finish() {
      const a = readTop(0).val, b = readTop(1).val;
      const res = root.querySelector('.ds-res'); res.textContent = `${a} + ${b} = ${a + b}`; res.classList.add('on');
      cleanupInput(); phase = 'done'; netSend({ k: 'e', v: [a, b] });
      setTimeout(() => { root.classList.add('hidden'); root.classList.remove('flying'); cancelAnimationFrame(raf); busy = false; resolve([a, b]); }, fast ? 650 : 1100);
    }

    const down = (e) => { if (phase !== 'hold' || e.target.closest('.ds-btn')) return; phase = 'drag'; canvas.setPointerCapture?.(e.pointerId); samples.length = 0; move(e); root.classList.add('dragging'); };
    const move = (e) => {
      if (phase !== 'drag') return;
      const now = performance.now(); samples.push({ x: e.clientX, y: e.clientY, t: now }); while (samples.length > 2 && now - samples[0].t > 120) samples.shift();
      const p = planePoint(e.clientX, e.clientY, 2.6);
      hold.x = Math.max(R.cx - R.hx + 1.2, Math.min(R.cx + R.hx - 1.2, p.x)); hold.z = Math.max(R.cz - R.hz + 1, Math.min(R.cz + R.hz - 1, p.z));
      bodies.forEach((b, i) => { b.position.set(hold.x + (i ? 0.6 : -0.6), 2.6, hold.z + (i ? 0.1 : -0.1)); b.quaternion.setFromEuler(now / 160 + i, now / 210, now / 260); });
    };
    const up = () => {
      if (phase !== 'drag') return;
      const a = samples[0], b = samples[samples.length - 1], dt = Math.max(16, (b?.t ?? 0) - (a?.t ?? 0));
      let dx = b && a ? b.x - a.x : 0, dy = b && a ? b.y - a.y : 0; const dist = Math.hypot(dx, dy);
      if (dist < 12) { autoThrow(); return; }                         // simple relâchement sans geste : lancer vers le centre
      const sp = Math.min(2.4, dist / dt) / 2.4;                       // 0..1
      const pw = (6 + sp * 12) * Math.max(0.7, Math.min(1.4, R.hz / 4)); const nx = dx / dist, ny = dy / dist;
      launch(nx * pw * 0.9, ny * pw);
    };
    const onBtn = (e) => { e.stopPropagation(); if (phase === 'hold' || phase === 'drag') autoThrow(); };
    const btn = root.querySelector('.ds-btn');
    function cleanupInput() { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); btn.removeEventListener('click', onBtn); root.classList.remove('dragging'); }
    if (interactive) {
      canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); btn.addEventListener('click', onBtn);
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (phase === 'hold') {
        const f = now / 500; bodies.forEach((b, i) => { b.position.set(R.cx + (i ? 1 : -1) * 0.7, 2.4 + Math.sin(f + i) * 0.12, R.cz + R.hz * 0.35); b.quaternion.setFromEuler(f * 0.7 + i, f * 0.5, f * 0.3); });
        idleT += dt; if (!interactive ? idleT > 0.12 : idleT > 9) autoThrow();
      }
      if (phase === 'fly') {
        world.step(1 / 60, dt, 4);
        const still = bodies.every((b) => b.velocity.length() < 0.12 && b.angularVelocity.length() < 0.2);
        calm = still ? calm + dt : 0;
        const timeout = (now - t0) > 7000;
        if (calm > 0.45 || timeout) {
          const ok = [readTop(0), readTop(1)].every((r) => r.flat > 0.93);
          if (ok || timeout) finish();
          else { bodies.forEach((b) => { b.applyImpulse(new CANNON.Vec3((Math.random() - 0.5) * 3, 4, (Math.random() - 0.5) * 3), new CANNON.Vec3(0.3, 0, 0.3)); b.wakeUp(); }); calm = 0; }
        }
      }
      if (now - netT > 33 && (phase === 'hold' || phase === 'fly' || phase === 'drag')) {
        netT = now; const q = (v) => +v.toFixed(3);
        netSend({ k: 'f', p: bodies.flatMap((b) => [q((b.position.x - R.cx) / R.hx), q(b.position.y), q((b.position.z - R.cz) / R.hz), q(b.quaternion.x), q(b.quaternion.y), q(b.quaternion.z), q(b.quaternion.w)]) });
      }
      sync(); R.renderer.render(R.scene, R.camera);
    }
    raf = requestAnimationFrame(frame);
  });
}

/* ---- Côté invité / spectateur : rejoue les images envoyées par l'hôte ---- */
let mir = { raf: 0, off: 0 };
function mirror(m) {
  if (busy) return;                       // on est en train de lancer nous-mêmes
  if (!R) build();
  const { root } = R;
  if (m.k === 's') {
    root.classList.remove('hidden'); root.classList.add('auto', 'flying'); root.querySelector('.ds-res').classList.remove('on');
    clearTimeout(mir.off); fit();
    cancelAnimationFrame(mir.raf); const loop = () => { R.renderer.render(R.scene, R.camera); mir.raf = requestAnimationFrame(loop); }; loop();
  } else if (m.k === 'f' && !root.classList.contains('hidden')) {
    R.dice.forEach((d, i) => { const o = i * 7, a = m.p; d.position.set(R.cx + a[o] * R.hx, a[o + 1], R.cz + a[o + 2] * R.hz); d.quaternion.set(a[o + 3], a[o + 4], a[o + 5], a[o + 6]); });
  } else if (m.k === 'b') {
    blip(m.s);
  } else if (m.k === 'r') {
    rattle();
  } else if (m.k === 'e') {
    const res = root.querySelector('.ds-res'); res.textContent = `${m.v[0]} + ${m.v[1]} = ${m.v[0] + m.v[1]}`; res.classList.add('on');
    mir.off = setTimeout(() => { root.classList.add('hidden'); root.classList.remove('flying'); cancelAnimationFrame(mir.raf); }, 1100);
  }
}

window.Dice3D = { play, mirror, supported: (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })() };

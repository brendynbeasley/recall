// Cinematic 3D intro built with Three.js: a galaxy of flashcards converges into the Recall mark.
import * as THREE from 'three';
import { h } from './utils.js';
import { sfx } from './audio.js';

const WORDS = ['Recall', 'Hola', 'Bonjour', '記憶', 'Ciao', 'Mémoire', 'Learn', 'ATP', 'Paris', 'Olá', '学习', 'Hallo', 'Σοφία', 'Знание', 'مرحبا', 'Aloha', 'Tokyo', 'π ≈ 3.14', 'E = mc²', 'DNA', 'Merci', 'Danke', 'Grazie', '감사', 'Study', 'Master', 'Review', 'Flow'];

function cardTexture(word, hue, light) {
  const w = 512, hgt = 320; const c = document.createElement('canvas'); c.width = w; c.height = hgt; const ctx = c.getContext('2d');
  const r = 36; ctx.beginPath(); ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, hgt, r); ctx.arcTo(w, hgt, 0, hgt, r); ctx.arcTo(0, hgt, 0, 0, r); ctx.arcTo(0, 0, w, 0, r); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, w, hgt);
  if (light) { g.addColorStop(0, '#ffffff'); g.addColorStop(1, `hsl(${hue} 60% 94%)`); } else { g.addColorStop(0, `hsl(${hue} 55% 22%)`); g.addColorStop(1, `hsl(${hue + 30} 60% 12%)`); }
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = light ? `hsl(${hue} 50% 85%)` : `hsl(${hue} 70% 55% / .6)`; ctx.stroke();
  ctx.fillStyle = light ? `hsl(${hue} 70% 45%)` : '#fff'; ctx.font = `700 ${word.length > 7 ? 54 : 72}px "Segoe UI", Inter, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = light ? 'transparent' : `hsl(${hue} 90% 70% / .8)`; ctx.shadowBlur = light ? 0 : 24;
  ctx.fillText(word, w / 2, hgt / 2 + 4);
  ctx.shadowBlur = 0; ctx.fillStyle = light ? `hsl(${hue} 40% 70%)` : 'rgba(255,255,255,.35)'; ctx.fillRect(w / 2 - 40, hgt - 46, 80, 5);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function playIntro({ accentHue = 252, onDone, skipable = true, fast = false } = {}) {
  const root = document.getElementById('intro-root');
  root.innerHTML = '';
  const wrap = h('div', { class: 'intro' });
  const canvas = h('canvas', { class: 'intro-canvas' });
  const overlay = h('div', { class: 'intro-overlay' },
    h('div', { class: 'intro-mark' }, h('div', { class: 'intro-logo' }), h('div', { class: 'intro-title' }, ...'Recall'.split('').map((ch, i) => h('span', { style: { animationDelay: `${1.9 + i * 0.07}s` } }, ch)))),
    h('div', { class: 'intro-tag' }, 'Remember everything.'),
    h('div', { class: 'intro-progress' }, h('div', {})),
    skipable ? h('button', { class: 'intro-skip' }, 'Skip', h('kbd', {}, 'Esc')) : null);
  wrap.append(canvas, overlay); root.append(wrap);
  document.body.classList.add('intro-playing');

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { finish(); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x070812, 0.045);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(0, 0, 26);

  const resize = () => { const w = window.innerWidth, hh = window.innerHeight; renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.updateProjectionMatrix(); };
  resize(); window.addEventListener('resize', resize);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.PointLight(new THREE.Color().setHSL(accentHue / 360, 0.9, 0.65), 320, 80); key.position.set(8, 10, 14); scene.add(key);
  const fill = new THREE.PointLight(new THREE.Color().setHSL(((accentHue + 60) % 360) / 360, 0.9, 0.6), 200, 80); fill.position.set(-12, -6, 10); scene.add(fill);

  // Particles (star field) with additive glow sprites
  const N = 2200; const pos = new Float32Array(N * 3); const col = new Float32Array(N * 3); const sz = new Float32Array(N);
  const c1 = new THREE.Color().setHSL(accentHue / 360, 0.9, 0.7), c2 = new THREE.Color().setHSL(((accentHue + 50) % 360) / 360, 0.9, 0.7), c3 = new THREE.Color(0xffffff);
  for (let i = 0; i < N; i++) { const r = 14 + Math.random() * 60; const th = Math.random() * Math.PI * 2; const ph = Math.acos(2 * Math.random() - 1); pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.7; pos[i * 3 + 2] = r * Math.cos(ph) - 10; const c = Math.random() < 0.6 ? c3 : (Math.random() < 0.5 ? c1 : c2); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; sz[i] = 0.6 + Math.random() * 1.6; }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setAttribute('color', new THREE.BufferAttribute(col, 3)); pg.setAttribute('size', new THREE.BufferAttribute(sz, 1));
  const spriteCanvas = document.createElement('canvas'); spriteCanvas.width = spriteCanvas.height = 64; const sctx = spriteCanvas.getContext('2d'); const grd = sctx.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); sctx.fillStyle = grd; sctx.fillRect(0, 0, 64, 64);
  const sprite = new THREE.CanvasTexture(spriteCanvas);
  const pm = new THREE.PointsMaterial({ size: 0.35, map: sprite, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9, sizeAttenuation: true });
  const points = new THREE.Points(pg, pm); scene.add(points);

  // Cards
  const CARDS = fast ? 18 : 30; const cards = []; const geo = new THREE.PlaneGeometry(3.2, 2); const isLightTheme = document.documentElement.getAttribute('data-theme') && ['light', 'solarized-light', 'sepia'].includes(document.documentElement.getAttribute('data-theme'));
  for (let i = 0; i < CARDS; i++) {
    const hue = (accentHue + (i * 37) % 120 - 40 + 360) % 360; const word = WORDS[i % WORDS.length];
    const mat = new THREE.MeshStandardMaterial({ map: cardTexture(word, hue, isLightTheme ? i % 3 === 0 : i % 4 === 0), transparent: true, opacity: 0, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide, emissive: new THREE.Color().setHSL(hue / 360, 0.8, 0.5), emissiveIntensity: 0.12 });
    const m = new THREE.Mesh(geo, mat);
    // start: far scattered sphere; mid: orbit ring; end: fanned stack
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), r = 40 + Math.random() * 30;
    m.userData.start = new THREE.Vector3(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph) - 30);
    const a = (i / CARDS) * Math.PI * 2; const ring = 9 + (i % 3) * 2.2;
    m.userData.orbit = { a, ring, y: ((i % 5) - 2) * 1.4, speed: 0.35 + (i % 3) * 0.1 };
    m.userData.end = new THREE.Vector3((i - CARDS / 2) * 0.06, -0.9 + (i % 4) * 0.02, -i * 0.16);
    m.userData.endRot = new THREE.Euler(-0.9, 0.02 * (i - CARDS / 2), (i - CARDS / 2) * 0.012);
    m.userData.startRot = new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    m.position.copy(m.userData.start); m.rotation.copy(m.userData.startRot);
    scene.add(m); cards.push(m);
  }
  // Soft ambient glow behind the title (wide, low-contrast gradient so it reads as light, not a solid orb)
  const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 256; const gctx = glowCanvas.getContext('2d'); const ggrd = gctx.createRadialGradient(128, 128, 0, 128, 128, 128); ggrd.addColorStop(0, 'rgba(255,255,255,.55)'); ggrd.addColorStop(0.25, 'rgba(255,255,255,.28)'); ggrd.addColorStop(0.6, 'rgba(255,255,255,.07)'); ggrd.addColorStop(1, 'rgba(255,255,255,0)'); gctx.fillStyle = ggrd; gctx.fillRect(0, 0, 256, 256);
  const haloMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCanvas), color: new THREE.Color().setHSL(accentHue / 360, 0.8, 0.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const halo = new THREE.Sprite(haloMat); halo.scale.set(26, 26, 1); scene.add(halo);
  // Orbit rings
  const ringGroup = new THREE.Group(); scene.add(ringGroup);
  for (let i = 0; i < 3; i++) { const rg = new THREE.TorusGeometry(5 + i * 1.6, 0.015, 8, 160); const rm = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(((accentHue + i * 30) % 360) / 360, 0.9, 0.7), transparent: true, opacity: 0, blending: THREE.AdditiveBlending }); const ring = new THREE.Mesh(rg, rm); ring.rotation.x = Math.PI / 2 + (i - 1) * 0.5; ring.rotation.y = i * 0.7; ringGroup.add(ring); }

  // Timeline (seconds)
  const T_TOTAL = fast ? 3.4 : 5.4; const T_GATHER = fast ? 1.0 : 1.5, T_ORBIT_END = fast ? 2.1 : 3.3, T_STACK = fast ? 2.8 : 4.3;
  const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; const easeOut = t => 1 - Math.pow(1 - t, 3);
  const mouse = { x: 0, y: 0 }; const onMove = (e) => { mouse.x = (e.clientX / window.innerWidth - 0.5) * 2; mouse.y = (e.clientY / window.innerHeight - 0.5) * 2; }; window.addEventListener('mousemove', onMove);
  let done = false, raf = 0; const t0 = performance.now(); const progressEl = overlay.querySelector('.intro-progress > div');
  const tmpV = new THREE.Vector3(); const tmpQ = new THREE.Quaternion(); const endQ = new THREE.Quaternion(); const startQ = new THREE.Quaternion();
  sfx.intro();

  function frame() {
    if (done) return;
    const t = (performance.now() - t0) / 1000; const p = Math.min(1, t / T_TOTAL); progressEl.style.width = `${p * 100}%`;
    points.rotation.y = t * 0.03; points.rotation.x = Math.sin(t * 0.1) * 0.05;
    pm.opacity = Math.min(0.9, t * 0.8) * (t > T_TOTAL - 0.6 ? Math.max(0, (T_TOTAL - t) / 0.6) : 1);
    const gather = ease(Math.min(1, t / T_GATHER));
    const stack = t > T_ORBIT_END ? ease(Math.min(1, (t - T_ORBIT_END) / (T_STACK - T_ORBIT_END))) : 0;
    cards.forEach((m, i) => {
      const o = m.userData.orbit; const ang = o.a + t * o.speed;
      tmpV.set(Math.cos(ang) * o.ring, o.y + Math.sin(t * 1.3 + i) * 0.3, Math.sin(ang) * o.ring);
      m.position.lerpVectors(m.userData.start, tmpV, gather);
      m.lookAt(0, 0, 0); m.rotation.z += Math.sin(t + i) * 0.1; m.rotateY(Math.PI);
      if (gather < 1) { startQ.setFromEuler(m.userData.startRot); m.quaternion.slerp(startQ, 1 - gather); }
      if (stack > 0) { m.position.lerp(m.userData.end, stack); endQ.setFromEuler(m.userData.endRot); m.quaternion.slerp(endQ, stack); }
      m.material.opacity = Math.min(1, t / 0.9 + i * 0.01) * (t > T_TOTAL - 0.5 ? Math.max(0, (T_TOTAL - t) / 0.5) : 1);
    });
    const fadeIn = Math.min(1, Math.max(0, (t - 0.4) / 0.8)), fadeOut = t > T_TOTAL - 0.5 ? Math.max(0, (T_TOTAL - t) / 0.5) : 1;
    haloMat.opacity = fadeIn * fadeOut * (0.45 + Math.sin(t * 2.5) * 0.05) * (1 - stack * 0.6);
    ringGroup.rotation.y = t * 0.2; ringGroup.rotation.z = Math.sin(t * 0.3) * 0.2; ringGroup.children.forEach((r, i) => { r.material.opacity = fadeIn * fadeOut * (0.35 - stack * 0.3); r.rotation.z += 0.002 * (i + 1); });
    // Camera: slow dolly in, then push through at the end
    const camZ = 26 - easeOut(Math.min(1, t / T_STACK)) * 10 - (t > T_STACK ? ease(Math.min(1, (t - T_STACK) / (T_TOTAL - T_STACK))) * 14 : 0);
    camera.position.x += (mouse.x * 1.6 - camera.position.x) * 0.04; camera.position.y += (-mouse.y * 1.0 - camera.position.y) * 0.04; camera.position.z = camZ; camera.lookAt(0, 0, 0);
    key.position.x = Math.sin(t * 0.8) * 10; key.position.y = Math.cos(t * 0.6) * 8;
    renderer.render(scene, camera);
    if (t >= T_TOTAL) finish(); else raf = requestAnimationFrame(frame);
  }
  function finish() {
    if (done) return; done = true; cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize); window.removeEventListener('mousemove', onMove); window.removeEventListener('keydown', onKey);
    wrap.classList.add('out');
    setTimeout(() => { try { renderer && renderer.dispose(); } catch (e) { /* */ } root.innerHTML = ''; document.body.classList.remove('intro-playing'); onDone && onDone(); }, 650);
  }
  const onKey = (e) => { if (skipable && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) finish(); };
  window.addEventListener('keydown', onKey);
  if (skipable) { overlay.querySelector('.intro-skip').addEventListener('click', finish); canvas.addEventListener('click', finish); }
  requestAnimationFrame(() => { wrap.classList.add('in'); frame(); });
  return { finish };
}

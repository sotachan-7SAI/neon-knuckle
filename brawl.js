// ネオンナックル ― デスクトップVRMキャラと「共闘／対戦」するベルトスクロールアクション
// 1P = そうたさん（キーボード／ゲームパッド）、2P = Claude（AI が操る。声はデスクトップの読み上げ装置へ）
// 敵・ステージ・音はすべてこのゲーム用のオリジナル。
// 動きは格闘モーション（VRMA）で付ける: 主人公 = 女性格闘パック、敵 = 空手パック（＋ボスだけカンフー）。ファイルが無い技は手づくりポーズで代用する
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';

const API = window.kart || null;   // preload-kart.js の窓口（ブラウザ単体で開いたときは無い）
const $ = (id) => document.getElementById(id);
const log = (m) => { console.log('[brawl] ' + m); try { API && API.log('[brawl] ' + m); } catch (e) {} };
const Q = new URLSearchParams(location.search);
const fileURL = (p) => {
  p = String(p).replace(/\\/g, '/');
  if (/^(https?:|file:|blob:|data:|\.\/|\.\.\/|\/)/.test(p)) return p;
  if (!/^[A-Za-z]:\//.test(p)) return p;   // ドライブ名が無い＝brawl.html からの相対パス
  if (window.kart?.fileURL) return window.kart.fileURL(p);   // Chrome（VR）で開いたときは PC 内サーバー経由
  return 'file:///' + p.split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// =========================================================================================
// 描画の土台
// =========================================================================================
const canvas = $('view');
const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.outputColorSpace = T.SRGBColorSpace;
const scene = new T.Scene();
scene.background = new T.Color(0x0a0e22);
scene.fog = new T.Fog(0x0a0e22, 16, 46);
const camera = new T.PerspectiveCamera(36, 16 / 9, 0.1, 200);
// VR: 自分の体（rig）を大きくして、商店街を机の上のジオラマのように上から見下ろす（サードパーソン俯瞰）
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
const rig = new T.Group(); scene.add(rig); rig.add(camera);
let vrScale = 5;                 // 1m ＝ 5 ゲーム単位（キャラが約 34cm に見える）
const VR_TABLE = .8, VR_BACK = 7;   // 地面を床から 80cm の高さに、立ち位置は手前 7 単位
const xrOn = () => renderer.xr.isPresenting;
const CAM_Z = 9.2, CAM_Y = 3.7, LOOK_Y = .82;
const hemi = new T.HemisphereLight(0xc8d8ff, 0x3a2440, 1.25); scene.add(hemi);
const sun = new T.DirectionalLight(0xffffff, 1.7); sun.position.set(3, 8, 7); scene.add(sun);
const rim = new T.DirectionalLight(0xff4f8a, 1.1); rim.position.set(-5, 3, -6); scene.add(rim);
const rim2 = new T.DirectionalLight(0x2be8c8, 0.7); rim2.position.set(6, 2, -5); scene.add(rim2);
let halfW = 6;
let composer = null, bloomOn = Q.get('bloom') !== '0';
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  if (composer) composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const dist = Math.hypot(CAM_Z, CAM_Y - LOOK_Y);
  halfW = Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * dist * camera.aspect;
}
addEventListener('resize', resize); resize();
// 光のにじみ（ブルーム）: 火花やネオンがふわっと光る。VR 中は使わない。B キーで入り切り。部品が読めなければ無しで動く
(async () => {
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js')]);
    const sz = renderer.getDrawingBufferSize(new T.Vector2());
    const c = new EffectComposer(renderer, new T.WebGLRenderTarget(sz.x, sz.y, { type: T.HalfFloatType, samples: 4 }));
    c.addPass(new RenderPass(scene, camera));
    c.addPass(new UnrealBloomPass(new T.Vector2(innerWidth / 2, innerHeight / 2), .36, .5, .9));
    c.addPass(new OutputPass());
    c.setPixelRatio(renderer.getPixelRatio()); c.setSize(innerWidth, innerHeight);
    composer = c;
  } catch (e) { log('光のにじみ無しで動きます ' + (e?.message || e)); }
})();
const vigEl = document.createElement('div');
vigEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0;background:radial-gradient(ellipse at center,rgba(255,20,50,0) 50%,rgba(255,20,50,.62) 100%)';
document.body.appendChild(vigEl);
const whiteEl = document.createElement('div');
whiteEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0;background:#fff';
document.body.appendChild(whiteEl);

// ---- テクスチャを canvas で描く小道具 ----
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const radialTex = canvasTex(128, 128, (x, w, h) => {
  const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
});
const shadowTex = canvasTex(128, 128, (x, w, h) => {
  const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(.6, 'rgba(0,0,0,.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
});
const sparkTex = canvasTex(128, 128, (x, w, h) => {
  x.translate(w / 2, h / 2);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 60); g.addColorStop(0, '#fff'); g.addColorStop(.25, 'rgba(255,230,140,.9)'); g.addColorStop(1, 'rgba(255,120,60,0)');
  x.fillStyle = g;
  for (let i = 0; i < 8; i++) { x.rotate(Math.PI / 4); x.beginPath(); x.moveTo(-7, 0); x.lineTo(0, i % 2 ? -40 : -62); x.lineTo(7, 0); x.fill(); }
  x.beginPath(); x.arc(0, 0, 18, 0, 7); x.fill();
});

// =========================================================================================
// ステージ: ネオンの商店街（すべて手続き生成）
// =========================================================================================
const STAGE_END = 92;         // 共闘の終点
const VS_X = 88;              // 対戦の会場（工場の門の前）
const Z_MIN = -2.15, Z_MAX = 1.9;
const SIGNS = ['5億年ラーメン', 'スネリン喫茶', '鼓膜破り LIVE', '井上発明研究所', 'トニオ玩具店', 'ボタン銀行', 'BAR 5分前', 'ネオン湯', '24H ゲーセン', 'まぼろし質屋', 'ぱっつん美容室', 'はかせの本屋'];
const NEON = ['#FF3D6E', '#2BE8C8', '#FFCE4A', '#8F6BFF', '#4FA8FF', '#FF8A1F'];
const stage = new T.Group(); scene.add(stage);
// 面ごとの空気（背景の色・霧・光）
const THEME_ENV = {
  street:  { bg: 0x0a0e22, hemi: [0xc8d8ff, 0x3a2440], rim: 0xff4f8a, rim2: 0x2be8c8, edge: 0x2be8c8 },
  factory: { bg: 0x170b08, hemi: [0xffdcb8, 0x2c1a14], rim: 0xff7a1f, rim2: 0xff3040, edge: 0xff8a1f },
};
let stageDoors = [];   // 敵が出てくる扉（背景を作るときに登録する）
let stageTheme = '', stageAnim = [];   // stageAnim = 背景の中で動くもの（ベルト・プレス機・回転灯）を毎フレーム動かす関数
function stageWipe(theme) {
  for (const o of [...stage.children]) {
    stage.remove(o);
    o.traverse((m) => { if (m.geometry) m.geometry.dispose(); for (const mt of [].concat(m.material || [])) { if (mt.map && mt.map !== radialTex && mt.map !== shadowTex) mt.map.dispose(); mt.dispose(); } });
  }
  stageAnim = []; stageTheme = theme; stageDoors = [];
  const env = THEME_ENV[theme] || THEME_ENV.street;
  scene.background.set(env.bg); scene.fog.color.set(env.bg); scene.fog.near = (env.fog || [16, 46])[0]; scene.fog.far = (env.fog || [16, 46])[1];
  hemi.color.set(env.hemi[0]); hemi.groundColor.set(env.hemi[1]); rim.color.set(env.rim); rim2.color.set(env.rim2);
  return env;
}
// VR で見下ろしたときの「机」（ジオラマの台）と右端の柵。普段の画面では地面の下なので見えない
function stageBase(env) {
  const ped = new T.Mesh(new T.BoxGeometry(186, 60, 10.2), new T.MeshLambertMaterial({ color: 0x151a30 }));
  ped.position.set(STAGE_END / 2, -30.02, 0); stage.add(ped);
  const edge = new T.Mesh(new T.BoxGeometry(186, .12, .12), new T.MeshBasicMaterial({ color: env.edge }));
  edge.position.set(STAGE_END / 2, -.05, 5.1); stage.add(edge);
  const fence = new T.Mesh(new T.BoxGeometry(0.3, 2.2, 7), new T.MeshLambertMaterial({ color: 0xffce4a }));
  fence.position.set(STAGE_END + 6.2, 1.1, -0.2); stage.add(fence);
}
// 黄色と黒のしま（工場の注意の帯）
function hazard(c, x, y, w, h, step = 28) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.fillStyle = '#FFCE4A'; c.fillRect(x, y, w, h); c.fillStyle = '#16161c';
  for (let i = -h - step; i < w + h; i += step) { c.beginPath(); c.moveTo(x + i, y + h); c.lineTo(x + i + step / 2, y + h); c.lineTo(x + i + step / 2 + h, y); c.lineTo(x + i + h, y); c.fill(); }
  c.restore();
}
function neonSign(name, col, vert) {
  const sw = vert ? 128 : 512, sh = vert ? 512 : 128;
  return canvasTex(sw, sh, (c) => {
    c.fillStyle = 'rgba(8,10,22,.92)'; c.fillRect(0, 0, sw, sh);
    c.strokeStyle = col; c.lineWidth = 8; c.shadowColor = col; c.shadowBlur = 20; c.strokeRect(10, 10, sw - 20, sh - 20);
    c.fillStyle = '#fff'; c.shadowBlur = 26; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (vert) { const chars = [...name.replace(/\s/g, '')].slice(0, 6); c.font = `bold ${Math.min(74, 420 / chars.length)}px "Noto Sans JP", sans-serif`; chars.forEach((ch, i) => c.fillText(ch, sw / 2, 44 + (i + 0.5) * (sh - 88) / chars.length)); }
    else { c.font = `bold ${Math.min(68, 900 / name.length)}px "Noto Sans JP", sans-serif`; c.fillText(name, sw / 2, sh / 2 + 4); }
  });
}
// =========================================================================================
// 2 面: 5億年ボタン工場（ベルトコンベアを赤いボタンが流れ、プレス機が動き、回転灯が光る。奥に巨大ボタン）
// =========================================================================================
const F_SIGNS = ['安全第一', '押すな危険', '5億年ボタン 製造ライン', '本日の生産 5億個', '検品室', 'PUSH', '休憩は5億年後', 'ボタン倉庫', '指差し確認', '第3プレス', '出荷口', '立入禁止'];
const F_NEON = ['#FFCE4A', '#FF4A3D', '#FF8A1F', '#2BE8C8'];
function buildFactory(env) {
  const L = STAGE_END, BELT_END = 76, BELT_Z = -3.35;
  // 床: 鉄板（手前のふちに注意の帯）
  const floor = canvasTex(512, 256, (x, w, h) => {
    x.fillStyle = '#2b2d36'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) { const v = 34 + Math.random() * 26; x.fillStyle = `rgba(${v + 8},${v},${v},.5)`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 128, 0); x.lineTo(i * 128, h); x.stroke(); }
    x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
    x.fillStyle = 'rgba(190,196,210,.35)';
    for (let i = 0; i < 4; i++) for (const yy of [12, h / 2 - 12, h / 2 + 12, h - 34]) for (const xx of [12, 116]) { x.beginPath(); x.arc(i * 128 + xx, yy, 3, 0, 7); x.fill(); }
    hazard(x, 0, h - 18, w, 13, 24);
  }, [30, 1]);
  const ground = new T.Mesh(new T.PlaneGeometry(180, 4.5), new T.MeshLambertMaterial({ map: floor }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(L / 2, 0, -0.1); stage.add(ground);
  // 手前の通路（すべり止めの鉄板）と、奥の床
  const grate = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#3b3a40'; x.fillRect(0, 0, w, h); x.strokeStyle = '#26252b'; x.lineWidth = 5;
    for (let i = -h; i < w; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + h, h); x.stroke(); x.beginPath(); x.moveTo(i + h, 0); x.lineTo(i, h); x.stroke(); }
  }, [90, 1]);
  const walkF = new T.Mesh(new T.BoxGeometry(180, 0.1, 2.5), new T.MeshLambertMaterial({ map: grate })); walkF.position.set(L / 2, 0.02, 3.4); stage.add(walkF);
  const walkB = new T.Mesh(new T.BoxGeometry(180, 0.14, 2.2), new T.MeshLambertMaterial({ color: 0x24242b })); walkB.position.set(L / 2, 0.07, -3.45); stage.add(walkB);
  // ベルトコンベア（模様が流れ、赤いボタンが運ばれていく）
  const beltLen = BELT_END + 24, beltX = (BELT_END - 24) / 2;
  const beltTex = canvasTex(256, 128, (x, w, h) => {
    x.fillStyle = '#1b1b21'; x.fillRect(0, 0, w, h); x.strokeStyle = '#3d3d48'; x.lineWidth = 8;
    for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(i * 64 + 44, 14); x.lineTo(i * 64 + 14, h / 2); x.lineTo(i * 64 + 44, h - 14); x.stroke(); }
  }, [beltLen / 2, 1]);
  const sideTex = canvasTex(256, 64, (x, w, h) => {
    x.fillStyle = '#4a3a36'; x.fillRect(0, 0, w, h); hazard(x, 0, 0, w, 14, 22);
    x.fillStyle = '#17171c'; for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(i * 64 + 32, 42, 13, 0, 7); x.fill(); }
    x.fillStyle = '#6a6f7c'; for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(i * 64 + 32, 42, 5, 0, 7); x.fill(); }
  }, [beltLen / 2, 1]);
  const plain = new T.MeshLambertMaterial({ color: 0x33282a });
  const belt = new T.Mesh(new T.BoxGeometry(beltLen, .62, 1.5), [plain, plain, new T.MeshBasicMaterial({ map: beltTex }), plain, new T.MeshLambertMaterial({ map: sideTex }), plain]);
  belt.position.set(beltX, .14 + .31, BELT_Z); stage.add(belt);
  const btnBase = new T.MeshLambertMaterial({ color: 0xffce4a }), btnRed = new T.MeshLambertMaterial({ color: 0xff2d3d, emissive: 0x7a0a10 });
  const riders = [];
  for (let bx = -22; bx < BELT_END - 1; bx += 3.2) {
    const g = new T.Group(), a = new T.Mesh(new T.BoxGeometry(.8, .18, .8), btnBase), b = new T.Mesh(new T.CylinderGeometry(.27, .31, .2, 18), btnRed);
    a.position.y = .09; b.position.y = .27; g.add(a, b); g.position.set(bx, .76, BELT_Z); stage.add(g); riders.push(g);
  }
  stageAnim.push((dt) => { beltTex.offset.x += dt * .6; for (const g of riders) { g.position.x -= dt * 1.2; if (g.position.x < -24) g.position.x += beltLen - 1; } });
  // プレス機（すばやく落ちて、ゆっくり上がる。落ちた瞬間に火花）
  const steel = new T.MeshLambertMaterial({ color: 0x55525c }), rodM = new T.MeshLambertMaterial({ color: 0xb8bcc8 });
  const headM = new T.MeshLambertMaterial({ map: canvasTex(128, 64, (x, w, h) => hazard(x, 0, 0, w, h, 26)) });
  const presses = [];
  for (let px = 5; px < BELT_END - 4; px += 12.8) {
    for (const s of [-1, 1]) { const p = new T.Mesh(new T.BoxGeometry(.28, 3.5, .28), steel); p.position.set(px + s * 1.2, 1.75 + .14, BELT_Z); stage.add(p); }
    const beam = new T.Mesh(new T.BoxGeometry(3.0, .5, 1.3), steel); beam.position.set(px, 3.6, BELT_Z); stage.add(beam);
    const rod = new T.Mesh(new T.CylinderGeometry(.12, .12, 3, 10), rodM); stage.add(rod);
    const head = new T.Mesh(new T.BoxGeometry(1.7, .5, 1.2), headM); stage.add(head);
    presses.push({ x: px, head, rod, ph: (px * .37) % 1, hit: false });
  }
  const pressMove = (dt) => {
    for (const p of presses) {
      p.ph = (p.ph + dt / 2.6) % 1;
      const k = p.ph < .12 ? p.ph / .12 : p.ph < .22 ? 1 : p.ph < .7 ? 1 - (p.ph - .22) / .48 : 0;
      const y = 2.95 - k * k * 1.45;
      p.head.position.set(p.x, y, BELT_Z); p.rod.position.set(p.x, y + 1.7, BELT_Z);
      if (k >= 1 && !p.hit) { p.hit = true; if (Math.abs(p.x - G.camX) < halfW + 2) for (let i = 0; i < 12; i++) glow.add(p.x + rnd(-.8, .8), 1.3, BELT_Z + .5, rnd(-3, 3), rnd(1, 4), rnd(0, 2), rnd(.25, .5), .08, .02, 1.6, .9, .3, 1, 9, 1); }
      if (k < 1) p.hit = false;
    }
  };
  pressMove(0); stageAnim.push(pressMove);
  // 奥の壁（鉄のパネルと、オレンジに光る炉の丸窓）
  let x = -22, si = 0;
  while (x < L + 26) {
    const w = rnd(6, 9), h = rnd(8.5, 12), sign = Math.random() < .45 && Math.abs(x + w / 2 - 84) > 5;   // 看板のある壁（巨大ボタンのあたりは空けておく）
    const tex = canvasTex(256, 512, (c, cw, ch) => {
      c.fillStyle = pick(['#3a3036', '#33303a', '#3d342e']); c.fillRect(0, 0, cw, ch);
      c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 3;
      for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, ch); c.stroke(); }
      for (let j = 0; j < ch; j += 85) { c.beginPath(); c.moveTo(0, j); c.lineTo(cw, j); c.stroke(); }
      c.fillStyle = 'rgba(200,190,180,.25)'; for (let i = 0; i < 4; i++) for (let j = 0; j < ch; j += 85) { c.fillRect(i * 64 + 6, j + 6, 4, 4); c.fillRect(i * 64 + 54, j + 6, 4, 4); }
      const n = sign ? 0 : 2 + ((Math.random() * 2) | 0), wy = ch * (1 - 2.05 / h), ry = ch * .56 / h, rx = ry * (h / ch) / (w / cw);   // 貼ったときに丸く見えるように横幅を合わせる
      for (let i = 0; i < n; i++) {
        const cx = cw * (i + .5) / n;
        c.save(); c.translate(cx, wy); c.scale(rx / ry, 1);
        const g = c.createRadialGradient(0, 0, 2, 0, 0, ry); g.addColorStop(0, '#fff3c4'); g.addColorStop(.5, '#ff9a2e'); g.addColorStop(1, '#a5320c');
        c.fillStyle = '#17120f'; c.beginPath(); c.arc(0, 0, ry + 6, 0, 7); c.fill(); c.fillStyle = g; c.beginPath(); c.arc(0, 0, ry, 0, 7); c.fill();
        c.strokeStyle = '#17120f'; c.lineWidth = 4; c.beginPath(); c.moveTo(-ry, 0); c.lineTo(ry, 0); c.moveTo(0, -ry); c.lineTo(0, ry); c.stroke(); c.restore();
      }
      hazard(c, 0, ch * (1 - 3.42 / h), cw, ch * .2 / h, 30);
      c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(0, ch * (1 - 1.15 / h), cw, ch);
    });
    const sideC = new T.MeshBasicMaterial({ color: 0x221c20 });
    const b = new T.Mesh(new T.BoxGeometry(w - .06, h, 3), [sideC, sideC, new T.MeshBasicMaterial({ color: 0x120e10 }), sideC, new T.MeshBasicMaterial({ map: tex }), sideC]);
    b.position.set(x + w / 2, h / 2, -6.1); stage.add(b);
    if (sign) {
      const name = F_SIGNS[si++ % F_SIGNS.length], col = pick(F_NEON), vert = false;
      const sm = new T.Mesh(new T.PlaneGeometry(vert ? 0.75 : 3, vert ? 3 : 0.75), new T.MeshBasicMaterial({ map: neonSign(name, col, vert), transparent: true, fog: false }));
      sm.position.set(x + w / 2 + rnd(-w / 6, w / 6), rnd(1.95, 2.45), -4.55); stage.add(sm);
      const gl = new T.Mesh(new T.PlaneGeometry(vert ? 2.4 : 5, vert ? 4.4 : 2.2), new T.MeshBasicMaterial({ map: radialTex, color: col, transparent: true, opacity: .26, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
      gl.position.copy(sm.position); gl.position.z -= 0.02; stage.add(gl);
    }
    x += w;
  }
  // 配管
  const pipe = (r, col, y, z) => { const m = new T.Mesh(new T.CylinderGeometry(r, r, 180, 10), new T.MeshLambertMaterial({ color: col })); m.rotation.z = Math.PI / 2; m.position.set(L / 2, y, z); stage.add(m); };
  pipe(.2, 0x9a4f2a, 3.05, -4.35); pipe(.11, 0x2f7f7a, 2.74, -4.42); pipe(.08, 0xc9b14a, 1.22, -4.46);
  const vpM = new T.MeshLambertMaterial({ color: 0x7a7f8c }), ringM = new T.MeshLambertMaterial({ color: 0xffce4a });
  for (let vx = -6; vx < L + 12; vx += 9) {
    const vp = new T.Mesh(new T.CylinderGeometry(.15, .15, 3.05, 10), vpM); vp.position.set(vx, 1.52, -4.42); stage.add(vp);
    for (const ry of [1.45, 2.4]) { const rg = new T.Mesh(new T.CylinderGeometry(.21, .21, .12, 10), ringM); rg.position.set(vx, ry, -4.42); stage.add(rg); }
  }
  // 回転灯（赤く明滅）
  const beacons = [];
  for (let lx = -1.5; lx < L + 10; lx += 9) {
    const lamp = new T.Mesh(new T.SphereGeometry(.2, 12, 8), new T.MeshBasicMaterial({ color: 0xff4a3a })); lamp.position.set(lx, 2.74, -4.28); stage.add(lamp);
    const halo = new T.Mesh(new T.PlaneGeometry(2.6, 2.6), new T.MeshBasicMaterial({ map: radialTex, color: 0xff3a2a, transparent: true, opacity: .4, depthWrite: false, blending: T.AdditiveBlending, fog: false })); halo.position.set(lx, 2.74, -4.24); stage.add(halo);
    const pool = new T.Mesh(new T.PlaneGeometry(4.6, 3.4), new T.MeshBasicMaterial({ map: radialTex, color: 0xff5a2a, transparent: true, opacity: .2, depthWrite: false, blending: T.AdditiveBlending })); pool.rotation.x = -Math.PI / 2; pool.position.set(lx, .02, -1.2); stage.add(pool);
    beacons.push({ halo, pool, ph: lx * .7 });
  }
  stageAnim.push(() => { for (const b of beacons) { const k = .5 + .5 * Math.sin(gameTime * 4 + b.ph); b.halo.material.opacity = .1 + k * .42; b.halo.scale.setScalar(.8 + k * .4); b.pool.material.opacity = .07 + k * .2; } });
  // 配管から吹き出す蒸気
  let steamT = 0;
  stageAnim.push((dt) => {
    steamT -= dt; if (steamT > 0) return; steamT = rnd(.5, 1.1);
    const sx = G.camX + rnd(-halfW, halfW);
    for (let i = 0; i < 5; i++) smoke.add(sx + rnd(-.1, .1), 2.95, -4.15, rnd(-.3, .3), rnd(-1.2, -.5), rnd(.2, .6), rnd(.8, 1.4), .25, 1.1, .8, .78, .76, .22, 0, 1.5);
  });
  // 遠く: 工場の奥（天井の梁・タンクと煙突の影・棚に並ぶ無数の赤いボタン）
  const sky = canvasTex(2048, 512, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#0b0606'); g.addColorStop(.6, '#2a0f0a'); g.addColorStop(1, '#7a2a10');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 10; for (let i = 0; i < w; i += 150) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 75, 120); c.lineTo(i + 150, 0); c.stroke(); }
    c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(0, 116, w, 12);
    c.fillStyle = '#120807'; let xx = 0;
    while (xx < w) { const bw = rnd(50, 130), bh = rnd(120, 300); if (Math.random() < .5) { c.fillRect(xx, h - bh, bw, bh); c.beginPath(); c.ellipse(xx + bw / 2, h - bh, bw / 2, 18, 0, 0, 7); c.fill(); } else c.fillRect(xx + bw * .3, h - bh - 60, bw * .4, bh + 60); xx += bw + rnd(10, 40); }
    for (let i = 0; i < 700; i++) { c.fillStyle = `rgba(255,${(40 + Math.random() * 60) | 0},50,${.25 + Math.random() * .6})`; c.beginPath(); c.arc(Math.random() * w, h - Math.random() * 300, 2.2, 0, 7); c.fill(); }
  });
  const skyM = new T.Mesh(new T.PlaneGeometry(260, 60), new T.MeshBasicMaterial({ map: sky, fog: false }));
  skyM.position.set(L / 2, 22, -40); stage.add(skyM);
  // いちばん奥: 巨大な 5億年ボタン（ゆっくり明滅する）
  const GX = 84, GZ = -3.9;
  const gb = new T.Group(); gb.position.set(GX, .14, GZ); stage.add(gb);
  const base = new T.Mesh(new T.CylinderGeometry(1.7, 1.82, .7, 40), [new T.MeshLambertMaterial({ map: canvasTex(512, 64, (c, w, h) => hazard(c, 0, 0, w, h, 40)) }), new T.MeshLambertMaterial({ color: 0xffce4a }), plain]);
  base.position.y = .35; gb.add(base);
  const domeM = new T.MeshLambertMaterial({ color: 0xff2030, emissive: 0x8a0a12 });
  const dome = new T.Mesh(new T.SphereGeometry(1.45, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeM); dome.scale.y = .7; dome.position.y = .7; gb.add(dome);
  const halo = new T.Mesh(new T.PlaneGeometry(9, 7), new T.MeshBasicMaterial({ map: radialTex, color: 0xff2a2a, transparent: true, opacity: .35, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
  halo.position.set(GX, 1.5, -4.5); stage.add(halo);
  const plate = new T.Mesh(new T.PlaneGeometry(4.4, 1.1), new T.MeshBasicMaterial({ fog: false, map: canvasTex(1024, 256, (c, w, h) => {
    hazard(c, 0, 0, w, h, 60); c.fillStyle = '#12131c'; c.fillRect(22, 22, w - 44, h - 44);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#FFCE4A'; c.font = 'bold 96px "Noto Sans JP", sans-serif'; c.fillText('5億年ボタン', w * .36, h / 2 + 6);
    c.fillStyle = '#FF3D3D'; c.font = '96px "Bungee", sans-serif'; c.fillText('PUSH', w * .78, h / 2 + 8);
  }) }));
  plate.position.set(GX, 2.55, -4.56); stage.add(plate);
  stageAnim.push(() => { const k = .5 + .5 * Math.sin(gameTime * 2.2); domeM.emissive.setRGB(.3 + k * .4, .03, .06); halo.material.opacity = .18 + k * .28; });
  factoryDress();
  stageBase(env);
}
// =========================================================================================
// 1 面: ネオンの商店街
// =========================================================================================
// =========================================================================================
// 1 面の背景の作り込み: 店を 1 軒ずつ描く・店先の小物・敵が出てくるシャッター・野次馬・手前の歩道
// =========================================================================================
const SP = 144, SHOP_H = 3.9;   // 店の絵: 1 メートル = 144 ドット、高さ 3.9 メートル（画面に映る壁の高さ）
const FJ = '"Noto Sans JP", sans-serif', FD = '"Dela Gothic One", "Noto Sans JP", sans-serif';
function fitText(c, text, x, y, maxW, size, font = FJ, weight = 'bold') {
  c.font = `${weight} ${size}px ${font}`; const tw = c.measureText(text).width;
  if (tw > maxW) c.font = `${weight} ${Math.floor(size * maxW / tw)}px ${font}`;
  c.fillText(text, x, y);
}
function pWall(c, x, y, w, h, col, kind) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.fillStyle = col; c.fillRect(x, y, w, h);
  c.strokeStyle = 'rgba(0,0,0,.26)'; c.lineWidth = 2;
  if (kind === 'brick') for (let yy = y, r = 0; yy < y + h; yy += 17, r++) { c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); for (let xx = x + (r % 2) * 21; xx < x + w; xx += 42) { c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx, yy + 17); c.stroke(); } }
  else if (kind === 'tile') { for (let xx = x; xx < x + w; xx += 24) { c.beginPath(); c.moveTo(xx, y); c.lineTo(xx, y + h); c.stroke(); } for (let yy = y; yy < y + h; yy += 24) { c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); } }
  else if (kind === 'wood') for (let xx = x; xx < x + w; xx += 30) { c.fillStyle = `rgba(0,0,0,${rnd(0, .12)})`; c.fillRect(xx, y, 30, h); c.beginPath(); c.moveTo(xx, y); c.lineTo(xx, y + h); c.stroke(); }
  else if (kind === 'metal') for (let yy = y; yy < y + h; yy += 14) { c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); }
  for (let i = 0; i < w * h / 1400; i++) { c.fillStyle = `rgba(0,0,0,${rnd(0, .09)})`; c.fillRect(x + Math.random() * w, y + Math.random() * h, rnd(2, 9), rnd(2, 9)); }
  c.restore();
}
function pSign(c, x, y, w, h, text, o = {}) {
  c.save(); c.fillStyle = o.bg || '#12131c'; c.fillRect(x, y, w, h);
  if (o.neon) { c.strokeStyle = o.neon; c.lineWidth = 6; c.shadowColor = o.neon; c.shadowBlur = 18; c.strokeRect(x + 8, y + 8, w - 16, h - 16); }
  else { c.strokeStyle = o.border || 'rgba(0,0,0,.4)'; c.lineWidth = 5; c.strokeRect(x + 3, y + 3, w - 6, h - 6); }
  c.fillStyle = o.fg || '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; if (o.neon) { c.shadowColor = o.neon; c.shadowBlur = 20; } else c.shadowBlur = 0;
  fitText(c, text, x + w / 2, y + h / 2 + h * .05, w - 34, h * (o.k || .6), o.font || FD, o.font ? 'bold' : '400');
  c.restore();
}
function pGlass(c, x, y, w, h, lit, div = 1, frame = '#1a1c28') {
  const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, lit); g.addColorStop(1, 'rgba(20,16,30,.9)');
  c.fillStyle = '#0a0b12'; c.fillRect(x, y, w, h); c.globalAlpha = .92; c.fillStyle = g; c.fillRect(x, y, w, h); c.globalAlpha = 1;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.fillStyle = 'rgba(255,255,255,.1)';
  for (let i = 0; i < w; i += 150) { c.beginPath(); c.moveTo(x + i + 30, y); c.lineTo(x + i + 70, y); c.lineTo(x + i + 20, y + h); c.lineTo(x + i - 20, y + h); c.fill(); }
  c.restore(); c.strokeStyle = frame; c.lineWidth = 7; c.strokeRect(x, y, w, h);
  for (let i = 1; i < div; i++) { c.beginPath(); c.moveTo(x + w * i / div, y); c.lineTo(x + w * i / div, y + h); c.stroke(); }
}
function pShutter(c, x, y, w, h, col = '#565b6c') {
  c.fillStyle = col; c.fillRect(x, y, w, h);
  for (let yy = y; yy < y + h; yy += 11) { c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(x, yy + 8, w, 3); c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(x, yy, w, 2); }
  c.strokeStyle = '#1a1c28'; c.lineWidth = 6; c.strokeRect(x, y, w, h);
}
function pDoor(c, x, y, w, h, col, lit) {
  c.fillStyle = col; c.fillRect(x, y, w, h); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 5; c.strokeRect(x, y, w, h);
  if (lit) pGlass(c, x + w * .16, y + h * .1, w * .68, h * .5, lit, 1, 'rgba(0,0,0,.5)');
  c.fillStyle = '#FFCE4A'; c.fillRect(x + w * .8, y + h * .56, w * .08, h * .09);
}
function pPaper(c, x, y, w, h, lines, o = {}) {   // 貼り紙
  c.save(); c.translate(x + w / 2, y + h / 2); c.rotate(o.rot != null ? o.rot : rnd(-.05, .05));
  c.fillStyle = o.bg || '#f4f0e2'; c.fillRect(-w / 2, -h / 2, w, h); c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 2; c.strokeRect(-w / 2, -h / 2, w, h);
  c.fillStyle = o.fg || '#1a1410'; c.textAlign = 'center'; c.textBaseline = 'middle';
  const lh = (h - 10) / lines.length;
  lines.forEach((t, i) => { c.fillStyle = (o.red || []).includes(i) ? '#c8102a' : (o.fg || '#1a1410'); fitText(c, t, 0, -h / 2 + 5 + lh * (i + .5), w - 14, lh * .78); });
  c.restore();
}
function pNoren(c, x, y, w, h, col, text, fg = '#fff') {   // のれん
  const chars = [...text], n = chars.length, pw = w / n;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  chars.forEach((ch, i) => { c.fillStyle = col; c.fillRect(x + i * pw + 2, y, pw - 4, h - (i % 2) * 6); c.fillStyle = fg; fitText(c, ch, x + (i + .5) * pw, y + h * .52, pw - 12, h * .62, FD, '400'); });
  c.fillStyle = '#2a1a10'; c.fillRect(x - 6, y - 5, w + 12, 7);
}
function pSil(c, x, y, s, col = 'rgba(12,10,22,.88)') {   // 人影（ロボ）: 足もとが (x, y)
  c.fillStyle = col; c.fillRect(x - .2 * s, y - .95 * s, .4 * s, .95 * s); c.fillRect(x - .17 * s, y - 1.3 * s, .34 * s, .3 * s); c.fillRect(x - .02 * s, y - 1.42 * s, .04 * s, .13 * s);
}
function pShelf(c, x, y, w, h, rows, pal, round) {
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(x, y + (r + 1) * rh - 5, w, 5);
    for (let xx = x + 5; xx < x + w - 12;) { const iw = round ? rh * .5 : rnd(8, 20), ih = rh * rnd(.5, .8); c.fillStyle = pick(pal); if (round) { c.beginPath(); c.arc(xx + iw / 2, y + (r + 1) * rh - 5 - iw / 2, iw / 2, 0, 7); c.fill(); } else c.fillRect(xx, y + (r + 1) * rh - 5 - ih, iw, ih); xx += iw + (round ? 5 : 3); }
  }
}
function p2F(c, w, Y, lit = '255,214,140') {   // 2 階の窓（看板の上）
  c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(0, 0, w, Y(3.04));
  const n = Math.max(2, Math.round(w / 170)), ww = w / n;
  for (let i = 0; i < n; i++) { c.fillStyle = Math.random() < .55 ? `rgba(${lit},${rnd(.6, .95)})` : 'rgba(10,14,30,.92)'; c.fillRect(i * ww + ww * .2, Y(3.74), ww * .6, SP * .56); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 4; c.strokeRect(i * ww + ww * .2, Y(3.74), ww * .6, SP * .56); }
  c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(0, Y(3.08), w, 6);
}
// 店ごとの絵。w = 幅（ドット）、Y(m) = 地面から m メートルの高さの座標
const SHOP_DRAW = {
  ramen(c, w, Y) {
    pWall(c, 0, 0, w, Y(0), '#3b2417', 'wood'); p2F(c, w, Y);
    pSign(c, 30, Y(2.98), w - 60, SP * .6, '5億年ラーメン', { bg: '#c8102a', fg: '#fff6d8', border: '#FFCE4A' });
    const cw = w * .64; pGlass(c, 40, Y(2.2), cw, SP * 1.35, '#ffcf7a', 1, '#2a1a10');
    c.fillStyle = '#5a3a22'; c.fillRect(40, Y(.85), cw, SP * .85); c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(40, Y(.85), cw, 8);
    for (let i = 0; i < 4; i++) pSil(c, 40 + cw * (.14 + i * .24), Y(.86), SP * .92, i === 2 ? 'rgba(60,20,20,.85)' : undefined);
    pNoren(c, 40, Y(2.2), cw, SP * .46, '#c8102a', 'ラーメン');
    pDoor(c, w * .74, Y(2.1), w * .2, SP * 2.1, '#4a2c1a', '#ffd89a');
    pPaper(c, w * .745, Y(1.3), w * .2, SP * .5, ['ラーメン 5億円', '替え玉 無料（5億年待ち）', '水 時価'], { red: [0] });
  },
  yaoya(c, w, Y) {
    pWall(c, 0, 0, w, Y(0), '#26382a', 'wood'); p2F(c, w, Y, '140,230,255');
    pSign(c, 24, Y(2.98), w - 48, SP * .6, '八百屋 だいたい新鮮', { bg: '#1f7a3a', fg: '#fff', border: '#e8ffd0' });
    c.fillStyle = '#0c120e'; c.fillRect(30, Y(2.3), w - 60, SP * 2.3);
    pShelf(c, 44, Y(2.2), w - 88, SP * 1.25, 3, ['#ff5a3a', '#ffb02a', '#6ad04a', '#ffe14a', '#b84ad0', '#f2f2e8'], true);
    c.fillStyle = '#6a4a2a'; c.fillRect(30, Y(.9), w - 60, SP * .9); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 3; for (let xx = 30; xx < w - 30; xx += 60) c.strokeRect(xx, Y(.9), 60, SP * .9);
    pPaper(c, 50, Y(.78), 150, 62, ['バナナ（皮のみ）', '50円'], { red: [1], bg: '#fff7a8' });
    pPaper(c, w - 210, Y(.8), 160, 62, ['大根 5億年もの', '時価'], { red: [1], bg: '#fff7a8' });
  },
  kissa(c, w, Y) {
    pWall(c, 0, 0, w, Y(0), '#5c3427', 'brick'); p2F(c, w, Y);
    pSign(c, 60, Y(2.98), w - 120, SP * .6, 'スネリン喫茶', { neon: '#FFCE4A' });
    const gx = 50, gw = w * .56; pGlass(c, gx, Y(2.2), gw, SP * 1.5, '#ffb86a', 3, '#2c1810');
    c.fillStyle = 'rgba(20,10,16,.85)'; for (let i = 0; i < 3; i++) { c.fillRect(gx + gw * (.12 + i * .3), Y(1.12), gw * .16, 8); c.fillRect(gx + gw * (.19 + i * .3), Y(1.12), 8, SP * .42); }
    pSil(c, gx + gw * .1, Y(.72), SP * .8); pSil(c, gx + gw * .66, Y(.72), SP * .8);
    c.fillStyle = '#3a2018'; c.fillRect(gx - 8, Y(.7), gw + 16, SP * .7);
    pDoor(c, w * .72, Y(2.15), w * .19, SP * 2.15, '#1f5a3f', '#ffd89a');
    pPaper(c, w * .725, Y(.95), w * .18, SP * .42, ['コーヒー おかわり', '5億杯まで'], {});
    c.fillStyle = '#FFCE4A'; c.font = `bold 26px ${FJ}`; c.textAlign = 'center'; c.fillText('OPEN（気分しだい）', gx + gw / 2, Y(2.27));
  },
  game(c, w, Y) {
    pWall(c, 0, 0, w, Y(0), '#15152c', 'metal'); p2F(c, w, Y, '255,160,200');
    pSign(c, 20, Y(2.98), w - 40, SP * .6, '24Hゲーセン（23時閉店）', { neon: '#FF3D9E' });
    for (const [i, col] of ['#2BE8C8', '#FF3D9E', '#FFCE4A'].entries()) { c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 14; c.fillRect(20, Y(2.33) + i * 11, w - 40, 5); } c.shadowBlur = 0;
    const n = Math.max(2, Math.round(w / 190));
    for (let i = 0; i < n; i++) {
      const mx = 30 + i * (w - 60) / n, mw = (w - 60) / n - 16, col = NEON[(i * 2 + 1) % NEON.length];
      c.fillStyle = col; c.fillRect(mx, Y(2.1), mw, SP * 2.1); pGlass(c, mx + 10, Y(1.95), mw - 20, SP * 1.0, '#e8fbff', 1, '#12131c');
      for (let k = 0; k < 7; k++) { c.fillStyle = pick(NEON); c.beginPath(); c.arc(mx + 22 + Math.random() * (mw - 44), Y(1.04) - Math.random() * 30, 11, 0, 7); c.fill(); }
      c.strokeStyle = '#c9ced8'; c.lineWidth = 4; c.beginPath(); c.moveTo(mx + mw * .5, Y(1.95)); c.lineTo(mx + mw * .5, Y(1.6)); c.stroke();
      c.fillStyle = '#12131c'; c.fillRect(mx + mw * .25, Y(.55), mw * .5, 34); c.fillStyle = '#ff3d3d'; c.beginPath(); c.arc(mx + mw * .5, Y(.75), 11, 0, 7); c.fill();
    }
    pPaper(c, w * .5 - 110, Y(.42), 220, 50, ['新作「押すだけ」入荷'], { bg: '#ffe14a', rot: -.04 });
  },
  sento(c, w, Y) {
    pWall(c, 0, 0, w, Y(0), '#2c4f60', 'tile');
    // 富士山のタイル絵
    c.fillStyle = '#7fc8f0'; c.fillRect(40, Y(3.8), w - 80, SP * .7); c.fillStyle = '#3a6fb0'; c.beginPath(); c.moveTo(w * .22, Y(3.1)); c.lineTo(w * .5, Y(3.76)); c.lineTo(w * .78, Y(3.1)); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(w * .44, Y(3.62)); c.lineTo(w * .5, Y(3.76)); c.lineTo(w * .56, Y(3.62)); c.fill();
    pSign(c, w * .26, Y(3.0), w * .48, SP * .62, 'ネオン湯', { neon: '#2BE8C8' });
    const ents = [['男', '#1f4fa8'], ['女', '#c8203a'], ['ロボ', '#6a6f7c']], ew = (w - 80) / 3;
    ents.forEach(([t, col], i) => { const ex = 40 + i * ew; c.fillStyle = '#0c1014'; c.fillRect(ex + 14, Y(2.2), ew - 28, SP * 2.2); pNoren(c, ex + 14, Y(2.2), ew - 28, SP * .85, col, t); });
    pPaper(c, w * .5 - 105, Y(1.1), 210, 70, ['入浴料 5億円', '（タオル別）'], { red: [0] });
  },
  toy(c, w, Y) {
    pWall(c, 0, 0, w, Y(0), '#3b2a58', 'plaster'); p2F(c, w, Y);
    pSign(c, 24, Y(2.98), w - 48, SP * .6, 'トニオ玩具店', { bg: '#FFCE4A', fg: '#2a1648', border: '#ff3d6e' });
    const gw = w * .6; pGlass(c, 34, Y(2.25), gw, SP * 1.6, '#cfe8ff', 2, '#2a1648');
    for (let i = 0; i < 4; i++) { const tx = 34 + gw * (.14 + i * .24), col = NEON[i % NEON.length]; c.fillStyle = col; c.fillRect(tx - 22, Y(1.25), 44, 46); c.fillRect(tx - 16, Y(1.52), 32, 30); c.fillStyle = '#12131c'; c.fillRect(tx - 10, Y(1.44), 20, 7); c.fillStyle = col; c.fillRect(tx - 34, Y(1.2), 10, 30); c.fillRect(tx + 24, Y(1.2), 10, 30); }
    c.fillStyle = '#2a1648'; c.fillRect(34, Y(.92), gw, 8);
    pShelf(c, 40, Y(2.2), gw - 12, SP * .5, 1, NEON, true);
    pDoor(c, w * .72, Y(2.15), w * .2, SP * 2.15, '#ff3d6e', '#ffe9b0');
    pPaper(c, 60, Y(.62), 220, 56, ['対象年齢 5億才以上'], { bg: '#fff' });
  },
  bank(c, w, Y) {
    pWall(c, 0, 0, w, Y(0), '#3e4354', 'plaster'); p2F(c, w, Y, '190,220,255');
    for (let i = 0; i < 5; i++) { const px = 26 + i * (w - 52 - 46) / 4; c.fillStyle = '#6a7088'; c.fillRect(px, Y(2.3), 46, SP * 2.3); c.fillStyle = 'rgba(255,255,255,.1)'; c.fillRect(px + 6, Y(2.3), 8, SP * 2.3); c.fillStyle = '#7d849e'; c.fillRect(px - 8, Y(2.38), 62, 14); }
    pSign(c, 20, Y(3.0), w - 40, SP * .6, 'ボタン銀行', { bg: '#141a3a', fg: '#FFCE4A', border: '#FFCE4A' });
    const s = (w - 52 - 46) / 4;
    pGlass(c, 26 + 60, Y(2.1), s - 74, SP * 2.1, '#bfe0ff', 2, '#141a3a');
    c.fillStyle = '#0c1020'; c.fillRect(26 + s + 60, Y(1.9), s - 74, SP * 1.2); c.fillStyle = '#2BE8C8'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, 'ATM', 26 + s * 1.5 + 23, Y(1.55), s - 100, 46, FD, '400'); c.fillStyle = '#fff'; fitText(c, '硬貨のみ（1枚ずつ）', 26 + s * 1.5 + 23, Y(1.05), s - 90, 20);
    c.fillStyle = '#050608'; c.fillRect(26 + s * 2 + 60, Y(2.0), s * 2 - 74, SP * .46); c.fillStyle = '#ff3a2a'; c.shadowColor = '#ff3a2a'; c.shadowBlur = 10; fitText(c, '本日の金利 5億%', 26 + s * 3 + 23, Y(1.76), s * 2 - 100, 40, FD, '400'); c.shadowBlur = 0;
    pPaper(c, 26 + s * 2 + 80, Y(1.3), 190, 76, ['ご融資は', '5億年ローンで'], {});
    pPaper(c, 26 + s * 3 + 70, Y(1.2), 170, 60, ['強盗はご遠慮ください'], { red: [0] });
  },
  salon(c, w, Y) {
    pWall(c, 0, 0, w, Y(0), '#57324c', 'plaster'); p2F(c, w, Y);
    pSign(c, 24, Y(2.98), w - 48, SP * .6, 'ぱっつん美容室', { neon: '#FF8AE0' });
    const gw = w * .62; pGlass(c, 30, Y(2.25), gw, SP * 1.75, '#ffe0f4', 2, '#2a1424');
    for (let i = 0; i < 2; i++) { const cx = 30 + gw * (.27 + i * .46); c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.ellipse(cx, Y(1.7), 34, 46, 0, 0, 7); c.fill(); pSil(c, cx, Y(.52), SP * .78); c.fillStyle = 'rgba(12,10,22,.88)'; c.fillRect(cx - 34, Y(.9), 68, 12); }
    pDoor(c, w * .73, Y(2.15), w * .2, SP * 2.15, '#2a1424', '#ffd0ec');
    pPaper(c, 44, Y(.46), 230, 58, ['前髪、切りすぎます'], { bg: '#fff', rot: -.03 });
    pPaper(c, w * .735, Y(.95), w * .19, SP * .4, ['カット', '5億年待ち'], { red: [1] });
  },
  live(c, w, Y) {
    pWall(c, 0, 0, w, Y(0), '#0f0f18', 'brick'); p2F(c, w, Y, '255,90,90');
    pSign(c, 30, Y(2.98), w - 60, SP * .6, '鼓膜破り LIVE', { neon: '#FF3D3D' });
    const names = ['騒音', '無音', '隣の住人', '苦情', '耳栓', 'アンコール拒否'];
    const pw = 118, n = Math.floor((w * .62) / (pw + 14));
    for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) { const px = 36 + i * (pw + 14), py = Y(2.25) + r * 150, col = NEON[(i + r * 2) % NEON.length]; c.save(); c.translate(px + pw / 2, py + 68); c.rotate(rnd(-.05, .05)); c.fillStyle = col; c.fillRect(-pw / 2, -68, pw, 136); c.fillStyle = '#0a0a10'; c.fillRect(-pw / 2 + 8, -60, pw - 16, 70); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, names[(i + r * n) % names.length], 0, 38, pw - 14, 30, FD, '400'); c.restore(); }
    pDoor(c, w * .7, Y(2.2), w * .22, SP * 2.2, '#22222e', null);
    pSign(c, w * .69, Y(1.85), w * .24, SP * .42, '本日の出演：騒音', { bg: '#f4f0e2', fg: '#12131c', font: FJ, k: .5 });
    pPaper(c, w * .72, Y(1.15), w * .18, 70, ['耳栓', '5億円'], { red: [1] });
  },
  lab(c, w, Y) {
    pWall(c, 0, 0, w, Y(0), '#2a3542', 'metal'); p2F(c, w, Y, '140,255,220');
    pSign(c, 24, Y(2.98), w - 48, SP * .6, '井上発明研究所', { neon: '#2BE8C8' });
    const gw = w * .5; pGlass(c, 36, Y(2.2), gw, SP * 1.3, '#b8ffe8', 3, '#10161c');
    for (let i = 0; i < 6; i++) { const fx = 36 + gw * (.08 + i * .16), col = NEON[i % NEON.length]; c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 12; c.beginPath(); c.arc(fx, Y(1.14), 16, 0, 7); c.fill(); c.fillRect(fx - 5, Y(1.5), 10, 40); } c.shadowBlur = 0;
    hazard(c, 36, Y(.86), gw, 22, 26);
    pPaper(c, 50, Y(.66), 250, 60, ['実験中（だいたい失敗）'], { bg: '#FFCE4A', rot: 0 });
    pDoor(c, w * .66, Y(2.2), w * .24, SP * 2.2, '#4a5868', null);
    c.fillStyle = '#0c1014'; c.fillRect(w * .585, Y(1.4), 30, 46); c.fillStyle = '#2BE8C8'; c.fillRect(w * .585 + 5, Y(1.36), 20, 12);
    pPaper(c, w * .675, Y(1.9), w * .2, 84, ['ノックは', '5億回まで'], {});
  },
  conbini(c, w, Y) {
    pWall(c, 0, 0, w, Y(0), '#e8ecf2', 'plaster');
    c.fillStyle = '#1f9a5a'; c.fillRect(0, Y(3.06), w, 30); c.fillStyle = '#ff7a1a'; c.fillRect(0, Y(3.06) + 30, w, 16); c.fillStyle = '#2a6fd6'; c.fillRect(0, Y(3.06) + 46, w, 30);
    pSign(c, w * .2, Y(3.06), w * .6, SP * .52, 'コンビニ 5億', { bg: '#fff', fg: '#1f9a5a', border: '#1f9a5a' });
    pGlass(c, 30, Y(2.4), w - 60, SP * 2.4, '#f4fbff', 4, '#c8ccd4');
    pShelf(c, 44, Y(2.2), w - 88, SP * 1.4, 3, ['#ff5a3a', '#ffb02a', '#6ad04a', '#4fa8ff', '#f2f2e8', '#ff8ae0']);
    pPaper(c, w * .5 - 130, Y(1.0), 260, 70, ['24時間 準備中'], { red: [0], rot: .02 });
  },
  welcome(c, w, Y) {
    pWall(c, 0, 0, w, Y(0), '#1e2238', 'plaster');
    pSign(c, 20, Y(3.0), w - 40, SP * .62, 'ようこそ 5億年商店街', { neon: '#FFCE4A' });
    c.fillStyle = '#2f5a3a'; c.fillRect(40, Y(2.28), w - 80, SP * 1.48); c.strokeStyle = '#8a6a3a'; c.lineWidth = 10; c.strokeRect(40, Y(2.28), w - 80, SP * 1.48);
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 5; c.beginPath(); c.moveTo(70, Y(1.6)); c.lineTo(w - 70, Y(1.6)); c.stroke();
    for (let i = 0; i < 6; i++) { c.fillStyle = NEON[i % NEON.length]; c.fillRect(80 + i * (w - 190) / 5, Y(1.6) - 34, 30, 26); c.fillRect(80 + i * (w - 190) / 5, Y(1.6) + 10, 30, 26); }
    c.fillStyle = '#ff3d3d'; c.beginPath(); c.arc(96, Y(1.6), 12, 0, 7); c.fill(); c.fillStyle = '#fff'; c.font = `bold 24px ${FJ}`; c.textAlign = 'left'; c.fillText('現在地：ここ', 60, Y(2.06)); c.textAlign = 'right'; c.fillText('出口：ない', w - 60, Y(1.02));
    pPaper(c, 50, Y(.7), 230, 76, ['夏祭りのお知らせ', '延期（5億年）'], { red: [1] });
    pPaper(c, w - 280, Y(.72), 230, 76, ['迷子のお知らせ', '全員'], { red: [1] });
  },
  alley(c, w, Y) {   // 路地
    const g = c.createLinearGradient(0, 0, 0, Y(0)); g.addColorStop(0, '#0a0c1c'); g.addColorStop(1, '#03040a'); c.fillStyle = g; c.fillRect(0, 0, w, Y(0));
    c.fillStyle = '#161a30'; c.fillRect(0, 0, 28, Y(0)); c.fillRect(w - 28, 0, 28, Y(0));
    for (let i = 0; i < 9; i++) { c.fillStyle = pick(NEON); c.globalAlpha = rnd(.25, .7); c.fillRect(rnd(40, w - 70), rnd(Y(3.7), Y(1.6)), rnd(14, 40), rnd(6, 12)); } c.globalAlpha = 1;
    c.strokeStyle = '#3a4060'; c.lineWidth = 7; c.beginPath(); c.moveTo(w - 46, 0); c.lineTo(w - 46, Y(0)); c.stroke();
    c.fillStyle = '#20243a'; c.fillRect(w * .52, Y(.75), 70, SP * .75); c.fillStyle = '#05060c'; c.beginPath(); c.ellipse(w * .52 + 35, Y(.86), 20, 14, 0, 0, 7); c.fill(); c.beginPath(); c.moveTo(w * .52 + 20, Y(.92)); c.lineTo(w * .52 + 24, Y(1.06)); c.lineTo(w * .52 + 32, Y(.94)); c.fill(); c.beginPath(); c.moveTo(w * .52 + 40, Y(.94)); c.lineTo(w * .52 + 48, Y(1.06)); c.lineTo(w * .52 + 52, Y(.92)); c.fill();
    c.fillStyle = '#FFCE4A'; c.fillRect(w * .52 + 26, Y(.88), 5, 3); c.fillRect(w * .52 + 40, Y(.88), 5, 3);
  },
  fence(c, w, Y) {   // 工事の囲い
    pWall(c, 0, 0, w, Y(0), '#12162a', 'plaster');
    c.fillStyle = '#d8dce8'; c.fillRect(0, Y(2.3), w, SP * 2.3); c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 3; for (let xx = 0; xx < w; xx += 130) c.strokeRect(xx, Y(2.3), 130, SP * 2.3);
    hazard(c, 0, Y(2.3), w, 26, 30); hazard(c, 0, Y(.3), w, 26, 30);
    pPaper(c, w * .5 - 190, Y(1.85), 380, 150, ['工事中', 'ごめいわくを', 'おかけしたい'], { bg: '#FFCE4A', red: [0], rot: 0 });
    pPaper(c, 40, Y(1.2), 210, 70, ['完成予定', '5億年後'], { red: [1] });
  },
  door(c, w, Y, o) {   // 敵が出てくるシャッターのある壁（シャッター本体は立体で重ねる）
    pWall(c, 0, 0, w, Y(0), o.wall || '#2a2d42', o.kind || 'brick');
    for (let i = 0; i < 3; i++) { c.fillStyle = Math.random() < .5 ? 'rgba(255,214,140,.8)' : 'rgba(10,14,30,.9)'; c.fillRect(40 + i * (w - 80) / 3 + 14, Y(3.72), (w - 80) / 3 - 28, 60); }
    const dw = 2.1 * SP, dx = (w - dw) / 2;
    c.fillStyle = '#05060a'; c.fillRect(dx, Y(2.4), dw, SP * 2.4); c.strokeStyle = '#8a90a8'; c.lineWidth = 10; c.strokeRect(dx, Y(2.4), dw, SP * 2.4);
    hazard(c, dx - 5, Y(2.62), dw + 10, 24, 26);
    pSign(c, dx - 20, Y(3.04), dw + 40, SP * .38, o.label, { bg: '#f4f0e2', fg: '#1a1410', font: FJ, k: .56, border: '#1a1410' });
  },
};
const DOOR_LABELS = ['準備中（敵が）', '定休日：毎日', '貸店舗（事故物件）', '搬入口', '関係者以外も立入禁止', '倉庫（からっぽ）', '非常口ではない', '裏口（表）', '開けるな危険', '店じまいセール 37年目'];
// 店の並び [種類, 幅（メートル）]。左端は x = -14.5
const STREET_ROW = [['conbini', 6], ['welcome', 4.5], ['ramen', 7], ['door', 3], ['yaoya', 4], ['door', 3], ['alley', 2.5], ['kissa', 6.5], ['door', 3], ['game', 4], ['door', 3],
  ['sento', 6], ['alley', 3], ['door', 3], ['toy', 4], ['door', 3], ['bank', 7], ['door', 3], ['salon', 4], ['door', 3], ['live', 7], ['door', 3], ['lab', 5.5], ['gate', 10], ['fence', 6]];
function streetDress() {
  const add = (m) => { stage.add(m); return m; };
  const box = (w, h, d, mat, x, y, z, par = stage) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); par.add(m); return m; };
  const lam = (col, em = 0) => new T.MeshLambertMaterial({ color: col, emissive: em });
  const WZ = -4.5, SW = .14;   // 壁の位置、歩道の高さ
  const flick = [];
  const lantern = (x, y, z, col = 0xff3b2a, s = 1) => {
    const m = add(new T.Mesh(new T.SphereGeometry(.16 * s, 12, 10), new T.MeshBasicMaterial({ color: col }))); m.scale.y = 1.25; m.position.set(x, y, z);
    for (const dy of [-.2, .2]) box(.14 * s, .04, .14 * s, lam(0x15161c), x, y + dy * s, z);
    const hl = add(new T.Mesh(new T.PlaneGeometry(1.5 * s, 1.5 * s), new T.MeshBasicMaterial({ map: radialTex, color: col, transparent: true, opacity: .45, depthWrite: false, blending: T.AdditiveBlending, fog: false }))); hl.position.set(x, y, z + .02);
    flick.push({ m: hl, ph: x * 1.7, b: .45 });
  };
  const awning = (x, w, c1, c2, y = 2.32) => {
    const tex = canvasTex(256, 64, (c, cw, ch) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? c1 : c2; c.fillRect(i * 32, 0, 32, ch); } }, [Math.max(1, Math.round(w / 1.6)), 1]);
    const m = box(w, .05, .95, new T.MeshLambertMaterial({ map: tex }), x, y, WZ + .46); m.rotation.x = .42;
    const v = add(new T.Mesh(new T.PlaneGeometry(w, .2), new T.MeshLambertMaterial({ map: tex, side: T.DoubleSide }))); v.position.set(x, y - .29, WZ + .89);
  };
  const aSign = (x, z, lines, bg = '#1c1f30', fg = '#fff') => {
    const tex = canvasTex(160, 256, (c, w, h) => { c.fillStyle = '#6a4a2a'; c.fillRect(0, 0, w, h); c.fillStyle = bg; c.fillRect(10, 10, w - 20, h - 20); c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; const lh = (h - 40) / lines.length; lines.forEach((t, i) => fitText(c, t, w / 2, 20 + lh * (i + .5), w - 34, Math.min(40, lh * .7))); });
    const sd = lam(0x6a4a2a);
    const m = box(.52, .84, .05, [sd, sd, sd, sd, new T.MeshBasicMaterial({ map: tex }), sd], x, SW + .41, z); m.rotation.x = -.2;
  };
  const plant = (x, z, s = 1) => { const p = add(new T.Mesh(new T.CylinderGeometry(.16 * s, .12 * s, .26 * s, 10), lam(0x8a4a2a))); p.position.set(x, SW + .13 * s, z); const l = add(new T.Mesh(new T.SphereGeometry(.24 * s, 8, 6), lam(0x2f8f4f, 0x0a2a14))); l.position.set(x, SW + .45 * s, z); l.scale.y = 1.2; };
  // ---- 店の並び ----
  let x = -14.5, di = 0;
  for (const [type, W] of STREET_ROW) {
    const cx = x + W / 2;
    if (type !== 'gate') {
      const cw = Math.round(W * SP), chh = Math.round(SHOP_H * SP), o = { label: DOOR_LABELS[di % DOOR_LABELS.length], wall: ['#2a2d42', '#33283a', '#263440', '#3a2e2a'][di % 4], kind: ['brick', 'metal', 'plaster', 'brick'][di % 4] };
      const tex = canvasTex(cw, chh, (c) => { const Y = (m) => chh - m * SP; SHOP_DRAW[type](c, cw, Y, o); c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(0, 0, 5, chh); c.fillRect(cw - 5, 0, 5, chh); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, chh - SW * SP - 10, cw, 10); });
      const wall = add(new T.Mesh(new T.PlaneGeometry(W, SHOP_H), new T.MeshBasicMaterial({ map: tex, fog: false }))); wall.position.set(cx, SHOP_H / 2, WZ);
    }
    if (type === 'door') {   // 立体のシャッター（敵が出るときに上がる）
      const lab = DOOR_LABELS[di % DOOR_LABELS.length];
      const geo = new T.PlaneGeometry(2.0, 2.3); geo.translate(0, -1.15, 0);
      const sh = add(new T.Mesh(geo, new T.MeshBasicMaterial({ fog: false, map: canvasTex(288, 330, (c, w, h) => { pShutter(c, 0, 0, w, h, ['#5a6074', '#6a5a52', '#4f6a66', '#66607a'][di % 4]); c.fillStyle = 'rgba(255,255,255,.75)'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, ['5億年', 'CLOSED', '閉', 'シャッター'][di % 4], w / 2, h * .42, w - 60, 54, FD, '400'); }) })));
      sh.position.set(cx, SW + 2.3, WZ + .03);
      const lit = add(new T.Mesh(new T.PlaneGeometry(2.8, 2.4), new T.MeshBasicMaterial({ map: radialTex, color: 0xffb060, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }))); lit.rotation.x = -Math.PI / 2; lit.position.set(cx, SW + .01, WZ + 1.1);
      stageDoors.push({ x: cx, sh, lit, open: 0, hold: 0, n: 0, label: lab }); di++;
    }
    // 店先の小物
    if (type === 'ramen') { for (let i = 0; i < 4; i++) lantern(x + .8 + i * 1.25, 2.12, WZ + .35); aSign(x + 5.6, -3.7, ['営業中', '（たぶん）'], '#c8102a'); box(.5, .5, .5, lam(0x7a5a3a), x + 6.4, SW + .25, -4.0); box(.5, .5, .5, lam(0x8a6a4a), x + 6.4, SW + .75, -4.05); }
    if (type === 'yaoya') {
      awning(cx, W - .3, '#1f7a3a', '#f4f6ee');
      for (let i = 0; i < 3; i++) { const bx = x + .75 + i * 1.25, cr = box(1.0, .34, .6, lam(0x9a6a3a), bx, SW + .42, -3.95); cr.rotation.x = .35; const col = [0xff5a3a, 0xffe14a, 0x6ad04a][i]; for (let k = 0; k < 6; k++) { const f = add(new T.Mesh(i === 1 ? new T.CapsuleGeometry(.05, .16, 3, 6) : new T.SphereGeometry(.1, 8, 6), lam(col, 0x221100))); f.position.set(bx - .35 + (k % 3) * .35, SW + .66 + (k > 2 ? .08 : 0), -3.9 + (k > 2 ? -.16 : .12)); f.rotation.z = rnd(-1, 1); } }
    }
    if (type === 'kissa') { awning(x + 2.2, 4.0, '#7a1f2a', '#f4e6c8'); aSign(x + 4.3, -3.7, ['本日の', 'おすすめ', '水'], '#2a4a34'); plant(x + .5, -4.05, 1.1); plant(x + 6.0, -4.05, .9); }
    if (type === 'game') { const cab = box(.8, 1.7, .7, lam(0xff3d9e, 0x3a0a24), x + W - .7, SW + .85, -3.95); box(.64, .7, .04, new T.MeshBasicMaterial({ color: 0xbff4ff }), 0, .25, .36, cab); const bl = box(.3, .08, .04, new T.MeshBasicMaterial({ color: 0xffe14a }), 0, .78, .36, cab); stageAnim.push(() => { bl.material.color.setHex(Math.floor(gameTime * 4) % 2 ? 0xffe14a : 0x2be8c8); }); }
    if (type === 'sento') { plant(x + .45, -4.05); plant(x + W - .45, -4.05); const bn = box(1.5, .08, .4, lam(0x7a5a3a), cx, SW + .42, -3.75); box(.08, .42, .36, lam(0x4a3a2a), -.6, -.22, 0, bn); box(.08, .42, .36, lam(0x4a3a2a), .6, -.22, 0, bn); }
    if (type === 'toy') { for (let i = 0; i < 2; i++) { const gx = x + .5 + i * .6, b = box(.42, .7, .42, lam([0xff3d6e, 0x2be8c8][i]), gx, SW + .35, -4.0); const dm = add(new T.Mesh(new T.SphereGeometry(.2, 12, 8), new T.MeshBasicMaterial({ color: 0xe8fbff, transparent: true, opacity: .75 }))); dm.position.set(gx, SW + .82, -4.0); } awning(x + 1.6, 2.6, '#ff3d6e', '#FFCE4A'); }
    if (type === 'bank') { for (const sx of [x + .5, x + W - .5]) { const pl = add(new T.Mesh(new T.CylinderGeometry(.22, .26, .5, 12), lam(0x6a7088))); pl.position.set(sx, SW + .25, -4.0); const gb = add(new T.Mesh(new T.SphereGeometry(.24, 14, 10), lam(0xffce4a, 0x4a3000))); gb.position.set(sx, SW + .72, -4.0); } }
    if (type === 'salon') {   // くるくる回る看板
      const tex = canvasTex(64, 128, (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); for (let i = -2; i < 6; i++) { c.fillStyle = i % 2 ? '#e0203a' : '#2050d0'; c.beginPath(); c.moveTo(0, i * 32); c.lineTo(w, i * 32 + 32); c.lineTo(w, i * 32 + 48); c.lineTo(0, i * 32 + 16); c.fill(); } }, [1, 1]);
      const pole = add(new T.Mesh(new T.CylinderGeometry(.11, .11, .9, 14), new T.MeshBasicMaterial({ map: tex }))); pole.position.set(x + W - .35, 1.75, WZ + .3);
      for (const dy of [-.5, .5]) box(.3, .1, .3, lam(0xc9ced8), x + W - .35, 1.75 + dy, WZ + .3);
      stageAnim.push((dt) => { tex.offset.y += dt * .7; });
      aSign(x + .7, -3.7, ['前髪', '切りすぎ', '注意'], '#ff8ae0', '#2a1424');
    }
    if (type === 'live') {   // 重低音でふるえるスピーカー
      const sps = [];
      for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) { const s = box(.66, .66, .5, lam(0x15161c), x + 5.2 + i * .72, SW + .33 + k * .68, -4.0); const cn = add(new T.Mesh(new T.CircleGeometry(.24, 18), new T.MeshBasicMaterial({ color: 0x3a3d4a }))); cn.position.set(s.position.x, s.position.y, -3.74); sps.push(cn); }
      stageAnim.push(() => { const k = 1 + .14 * Math.max(0, Math.sin(gameTime * 9.5)); for (const s of sps) s.scale.setScalar(k); });
      lantern(x + .6, 2.15, WZ + .3, 0xff3d3d, .8); lantern(x + 4.4, 2.15, WZ + .3, 0xff3d3d, .8);
    }
    if (type === 'lab') { let pt = 0; const lx = x + 1.2; stageAnim.push((dt) => { pt -= dt; if (pt > 0 || Math.abs(lx - G.camX) > halfW + 2) return; pt = rnd(1.6, 3.2); const c = pick([COL.teal, COL.pink, COL.green]); for (let i = 0; i < 8; i++) smoke.add(lx + rnd(-.2, .2), 2.3, -4.2, rnd(-.3, .3), rnd(.5, 1.2), rnd(.1, .4), rnd(.9, 1.5), .2, .8, c[0], c[1], c[2], .4, 0, 1.2); }); aSign(x + 3.2, -3.7, ['爆発', 'しません', '（願望）'], '#FFCE4A', '#1a1410'); }
    if (type === 'welcome') { plant(x + .5, -4.05, 1.2); plant(x + 4.0, -4.05, 1.2); }
    if (type === 'conbini') { const pool = add(new T.Mesh(new T.PlaneGeometry(6.5, 3.2), new T.MeshBasicMaterial({ map: radialTex, color: 0xeaf6ff, transparent: true, opacity: .3, depthWrite: false, blending: T.AdditiveBlending }))); pool.rotation.x = -Math.PI / 2; pool.position.set(cx, SW + .01, -3.3); }
    if (type === 'alley') { box(.5, .7, .45, lam(0x3d5f8a), x + .7, SW + .35, -4.05); box(.54, .05, .5, lam(0x2a4468), x + .7, SW + .73, -4.05); }
    if (type === 'fence') { for (let i = 0; i < 3; i++) { const cn = add(new T.Mesh(new T.ConeGeometry(.17, .5, 10), lam(0xff7a1a, 0x4a1a00))); cn.position.set(x + 1 + i * 1.6, SW + .25, -3.6); } }
    x += W;
  }
  // ラーメン屋の湯気
  let st = 0;
  stageAnim.push((dt) => {
    st -= dt; if (st > 0 || G.camX > 12) return; st = .25;
    smoke.add(-2.4 + rnd(-.3, .3), 2.2, -4.3, rnd(-.1, .3), rnd(.5, 1), .1, rnd(1.2, 1.8), .18, .7, .9, .9, .92, .22, 0, 1.2);
  });
  stageAnim.push(() => { for (const f of flick) f.m.material.opacity = f.b * (.8 + .2 * Math.sin(gameTime * 7 + f.ph) * Math.sin(gameTime * 2.3 + f.ph)); });
  // ---- 野次馬ロボ（奥の歩道で見物している。連続ヒットが伸びると飛びはねる）----
  const crowd = [];
  for (const sx of [-6.5, 8.3, 19.5, 27, 36, 46, 53.4, 63, 69.3, 80.5]) {
    const n = 2 + ((sx * 7) & 1);
    for (let i = 0; i < n; i++) {
      const g = new T.Group(), col = pick([0x8a90a8, 0x3fb8d8, 0xd8a03f, 0xa86ad8, 0x5fc88a]), s = rnd(.75, 1.0);
      box(.34, .42, .24, lam(col), 0, .5, 0, g); box(.3, .26, .24, lam(col), 0, .88, 0, g); box(.22, .06, .02, new T.MeshBasicMaterial({ color: 0x2be8c8 }), 0, .9, .125, g);
      box(.1, .3, .12, lam(0x30344a), -.09, .15, 0, g); box(.1, .3, .12, lam(0x30344a), .09, .15, 0, g);
      g.scale.setScalar(s); g.position.set(sx + i * .55 + rnd(-.1, .1), SW, -3.75 + rnd(-.25, .2)); stage.add(g);
      crowd.push({ g, ph: Math.random() * 6.28, hop: 0 });
    }
  }
  stageAnim.push((dt) => {
    const hot = G.phase === 'play' && G.combo >= 6;
    for (const c of crowd) {
      if (Math.abs(c.g.position.x - G.camX) > halfW + 2) continue;
      if (hot && c.hop <= 0 && Math.random() < dt * 3) c.hop = .36;
      c.hop = Math.max(0, c.hop - dt);
      c.g.position.y = SW + Math.sin(Math.max(0, c.hop) / .36 * Math.PI) * .3; c.g.rotation.y = Math.sin(gameTime * 1.3 + c.ph) * .25; c.g.rotation.z = Math.sin(gameTime * 2 + c.ph) * .04;
    }
  });
  // ---- 道路の模様: 横断歩道・マンホールのふた・水たまり ----
  const zebra = canvasTex(256, 256, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = 'rgba(235,238,245,.8)'; for (let i = 0; i < 6; i++) c.fillRect(0, 12 + i * 42, w, 24); });
  for (const zx of [-9, 36.5, 71]) { const m = add(new T.Mesh(new T.PlaneGeometry(2.6, 4.3), new T.MeshBasicMaterial({ map: zebra, transparent: true, depthWrite: false }))); m.rotation.x = -Math.PI / 2; m.position.set(zx, .012, -.12); }
  for (let i = 0; i < 9; i++) { const pd = add(new T.Mesh(new T.PlaneGeometry(rnd(1.6, 2.8), rnd(.7, 1.1)), new T.MeshBasicMaterial({ map: radialTex, color: pick([0xff3d6e, 0x2be8c8, 0xffce4a, 0x8f6bff]), transparent: true, opacity: .16, depthWrite: false, blending: T.AdditiveBlending }))); pd.rotation.x = -Math.PI / 2; pd.position.set(-8 + i * 11.3 + rnd(-2, 2), .013, rnd(-1.6, 1.6)); }
  // ---- 手前の歩道: ガードレール・自転車・植え込み・消火栓（主人公より低い物だけ）----
  const railM = lam(0xaab0c4), postM = lam(0x6a7088), FZ = 3.3;
  for (let rx = -12; rx < STAGE_END + 8; rx += 8.5) {
    const len = 6;
    for (const ry of [.34, .6]) { const r = add(new T.Mesh(new T.CylinderGeometry(.035, .035, len, 6), railM)); r.rotation.z = Math.PI / 2; r.position.set(rx + len / 2, ry, FZ); }
    for (let k = 0; k <= 4; k++) box(.07, .68, .07, postM, rx + k * len / 4, .34, FZ);
  }
  const bike = (bx, bz, col) => {
    const g = new T.Group(), fm = lam(col), tm = lam(0x15161c);
    for (const wx of [-.5, .5]) { const t = new T.Mesh(new T.TorusGeometry(.3, .03, 6, 18), tm); t.position.set(wx, .33, 0); g.add(t); }
    box(.7, .04, .04, fm, -.05, .62, 0, g).rotation.z = .12; box(.6, .04, .04, fm, -.2, .46, 0, g).rotation.z = -.5; box(.04, .5, .04, fm, .42, .58, 0, g).rotation.z = -.3; box(.04, .36, .04, fm, -.36, .7, 0, g);
    box(.24, .05, .1, tm, -.38, .9, 0, g); box(.05, .05, .44, tm, .5, .86, 0, g); box(.3, .2, .26, lam(0x8a7a5a), .64, .72, 0, g);
    g.position.set(bx, .05, bz); g.rotation.y = rnd(-.25, .25); g.rotation.z = .1; stage.add(g);
  };
  [[5.5, 0xd8354a], [6.4, 0x2a6fd6], [33, 0x1fa37c], [51, 0xe8a020], [52, 0xd8354a], [74.5, 0x8f6bff]].forEach(([bx, col]) => bike(bx, 3.85, col));
  for (const hx of [-2, 22.5, 44, 65, 86]) { const hy = add(new T.Mesh(new T.CylinderGeometry(.13, .15, .5, 10), lam(0xd8253a, 0x3a0808))); hy.position.set(hx, .3, 2.75); const cp = add(new T.Mesh(new T.SphereGeometry(.14, 10, 8), lam(0xd8253a, 0x3a0808))); cp.position.set(hx, .56, 2.75); }
  for (const px of [12, 13, 28.5, 40, 41, 58, 79, 80]) { box(.8, .34, .5, lam(0x4a4f68), px, .22, 3.75); const l = add(new T.Mesh(new T.SphereGeometry(.34, 8, 6), lam(0x2f8f4f, 0x0a2a14))); l.position.set(px, .55, 3.75); l.scale.set(1.15, .7, .8); }
  for (const bx of [17.5, 47.5, 68]) { const bn = box(1.6, .07, .42, lam(0x7a5a3a), bx, .48, 3.8); box(.08, .44, .38, postM, -.65, -.24, 0, bn); box(.08, .44, .38, postM, .65, -.24, 0, bn); box(1.6, .3, .06, lam(0x7a5a3a), 0, .28, .2, bn); }
}
// ---- 2 面の背景の作り込み: 歯車・ロボットアーム・生産数のモニター・天井クレーン・ふざけた標語・手前の柵 ----
function factoryDress() {
  const add = (m) => { stage.add(m); return m; };
  const box = (w, h, d, mat, x, y, z, par = stage) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); par.add(m); return m; };
  const lam = (col, em = 0) => new T.MeshLambertMaterial({ color: col, emissive: em });
  const WZ = -4.5;
  // 歯車（大小がかみ合って回る）
  const gearTex = (teeth, col, rim) => canvasTex(256, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.translate(w / 2, h / 2); c.fillStyle = col;
    for (let i = 0; i < teeth; i++) { c.save(); c.rotate(i / teeth * 6.2832); c.fillRect(-13, -126, 26, 34); c.restore(); }
    c.beginPath(); c.arc(0, 0, 100, 0, 7); c.fill(); c.strokeStyle = rim; c.lineWidth = 8; c.beginPath(); c.arc(0, 0, 92, 0, 7); c.stroke();
    c.fillStyle = 'rgba(0,0,0,.55)'; for (let i = 0; i < 5; i++) { c.beginPath(); c.arc(Math.cos(i * 1.2566) * 56, Math.sin(i * 1.2566) * 56, 18, 0, 7); c.fill(); }
    c.fillStyle = rim; c.beginPath(); c.arc(0, 0, 20, 0, 7); c.fill();
  });
  const gears = [];
  for (const gx of [-3.5, 21.5, 47, 71.5]) {
    const a = add(new T.Mesh(new T.PlaneGeometry(2.3, 2.3), new T.MeshBasicMaterial({ map: gearTex(12, '#4a4650', '#ff8a1f'), transparent: true, fog: false }))); a.position.set(gx, 1.55, WZ + .04);
    const b = add(new T.Mesh(new T.PlaneGeometry(1.4, 1.4), new T.MeshBasicMaterial({ map: gearTex(8, '#5a5560', '#ffce4a'), transparent: true, fog: false }))); b.position.set(gx + 1.62, 2.25, WZ + .05);
    gears.push([a, .5], [b, -.75]);
  }
  stageAnim.push((dt) => { for (const [g, v] of gears) g.rotation.z += dt * v; });
  // ロボットアーム（奥のベルトの上で、流れてくるボタンをつついている）
  const yel = lam(0xffb81f, 0x3a2400), dk = lam(0x25252c), arms = [];
  for (const ax of [11.4, 24.2, 37, 49.8, 62.6]) {
    box(.5, .3, .5, dk, ax, 3.05, -3.5);
    const sh = new T.Group(); sh.position.set(ax, 2.9, -3.45); stage.add(sh);
    box(.17, 1.0, .17, yel, 0, -.5, 0, sh); box(.2, .12, .2, dk, 0, -.5, 0, sh);
    const el = new T.Group(); el.position.set(0, -1.0, 0); sh.add(el);
    box(.13, .85, .13, yel, 0, -.42, 0, el); box(.22, .22, .22, dk, 0, 0, 0, el);
    const tip = new T.Mesh(new T.SphereGeometry(.09, 10, 8), new T.MeshBasicMaterial({ color: 0x7fe9ff })); tip.position.y = -.9; el.add(tip);
    arms.push({ sh, el, ph: ax * .7 });
  }
  stageAnim.push(() => { for (const a of arms) { const t = gameTime * 2.2 + a.ph, k = Math.max(0, Math.sin(t)); a.sh.rotation.z = .55 - k * .5 + Math.sin(t * .5) * .1; a.el.rotation.z = -1.25 + k * .75; } });
  // 生産数のモニター（数字が増え続ける）
  const mons = [];
  for (const [mx, title, unit] of [[15.2, '本日の生産', '個'], [53.5, '押された回数', '回']]) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192;
    const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace;
    box(2.5, 1.0, .12, dk, mx, 1.5, WZ + .1); const scr = add(new T.Mesh(new T.PlaneGeometry(2.3, .86), new T.MeshBasicMaterial({ map: tex, fog: false }))); scr.position.set(mx, 1.5, WZ + .17);
    mons.push({ cv, tex, title, unit, n: 499999000 + ((mx * 37) | 0), t: 0, mx });
  }
  stageAnim.push((dt) => {
    for (const m of mons) {
      m.t -= dt; if (m.t > 0 || Math.abs(m.mx - G.camX) > halfW + 2) continue; m.t = .2; m.n += 1 + ((Math.random() * 3) | 0); if (m.n > 499999999) m.n = 499999000;
      const c = m.cv.getContext('2d'); c.fillStyle = '#04120c'; c.fillRect(0, 0, 512, 192); c.fillStyle = '#3cff9a'; c.textBaseline = 'middle';
      c.textAlign = 'left'; c.font = `bold 40px ${FJ}`; c.fillText(m.title, 22, 44); c.textAlign = 'right'; c.font = `400 76px "Bungee", ${FJ}`; c.fillText(m.n.toLocaleString('en-US'), 440, 126); c.font = `bold 40px ${FJ}`; c.fillText(m.unit, 496, 134);
      c.fillStyle = '#ffce4a'; c.font = `bold 26px ${FJ}`; c.fillText('目標 5億', 496, 44);
      m.tex.needsUpdate = true;
    }
  });
  // ふざけた標語
  const plate = (px, py, lines, bg = '#e8ecf2', fg = '#12131c', w = 1.9) => {
    const tex = canvasTex(384, 128, (c, cw, ch) => { c.fillStyle = bg; c.fillRect(0, 0, cw, ch); c.strokeStyle = '#1c7a3a'; c.lineWidth = 8; c.strokeRect(6, 6, cw - 12, ch - 12); c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; const lh = (ch - 24) / lines.length; lines.forEach((t, i) => fitText(c, t, cw / 2, 12 + lh * (i + .5) + 2, cw - 40, lh * .76)); });
    const m = add(new T.Mesh(new T.PlaneGeometry(w, w / 3), new T.MeshBasicMaterial({ map: tex, fog: false }))); m.position.set(px, py, WZ + .06);
  };
  plate(6.5, 1.55, ['無災害記録 5億日', '（自己申告）']); plate(29.5, 1.5, ['廊下は走るな', '走ると楽しい']); plate(41, 1.55, ['定時 5億年後']); plate(57.5, 1.5, ['不良品 0', '（見ていないので）']); plate(66.5, 1.55, ['指差し確認', 'ヨシ！（何が？）']); plate(78.5, 2.2, ['休憩所', '休めるとは言ってない'], '#FFCE4A');
  // 天井クレーン（木箱をぶら下げて、行ったり来たり）
  const railM = lam(0x55525c);
  const rail = add(new T.Mesh(new T.BoxGeometry(190, .14, .2), railM)); rail.position.set(STAGE_END / 2, 3.72, -2.65);
  const cr = new T.Group(); stage.add(cr);
  box(.7, .26, .5, lam(0xffb81f, 0x3a2400), 0, 3.55, -2.65, cr);
  const sw = new T.Group(); sw.position.set(0, 3.45, -2.65); cr.add(sw);
  box(.04, 1.1, .04, lam(0x9aa0b0), 0, -.55, 0, sw); box(.7, .6, .6, lam(0x8a6a3a), 0, -1.4, 0, sw); box(.72, .08, .62, lam(0x5a4424), 0, -1.4, 0, sw);
  const lbl = new T.Mesh(new T.PlaneGeometry(.6, .3), new T.MeshBasicMaterial({ map: canvasTex(192, 96, (c, w, h) => { c.fillStyle = '#f4f0e2'; c.fillRect(0, 0, w, h); c.fillStyle = '#c8102a'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, 'ボタン 5億個', w / 2, h / 2 + 3, w - 16, 40); }) })); lbl.position.set(0, -1.4, .31); sw.add(lbl);
  stageAnim.push(() => { const t = gameTime * .32; cr.position.x = G.camX + Math.sin(t) * (halfW + 1.5); sw.rotation.z = Math.cos(t) * .22; });
  // 溶接の火花（奥でときどき光る）
  let wt = 0;
  stageAnim.push((dt) => {
    wt -= dt; if (wt > 0) return; wt = rnd(.5, 1.6);
    const wx = G.camX + rnd(-halfW, halfW), wy = rnd(.9, 1.3);
    for (let i = 0; i < 14; i++) glow.add(wx, wy, -3.9, rnd(-3, 3), rnd(1, 5), rnd(.3, 1.6), rnd(.3, .6), .07, .02, .8, 1.3, 1.7, 1, 9, 1);
  });
  // 手前: 黄色い柵・ドラム缶・木箱
  const FZ = 3.3, hz = new T.MeshLambertMaterial({ map: canvasTex(64, 128, (c, w, h) => hazard(c, 0, 0, w, h, 20)) }), yr = lam(0xe8b81f, 0x2a2000);
  for (let rx = -12; rx < STAGE_END + 8; rx += 8.5) {
    const len = 6;
    for (const ry of [.34, .62]) { const r = add(new T.Mesh(new T.CylinderGeometry(.04, .04, len, 6), yr)); r.rotation.z = Math.PI / 2; r.position.set(rx + len / 2, ry, FZ); }
    for (let k = 0; k <= 4; k++) box(.09, .7, .09, hz, rx + k * len / 4, .35, FZ);
  }
  for (const dx of [-5.2, 15.5, 16.2, 34, 55, 55.7, 73.2, 87]) { const d = add(new T.Mesh(new T.CylinderGeometry(.28, .28, .78, 14), lam(pick([0x2f6f9f, 0x9a3a2a, 0x3a7a4a])))); d.position.set(dx, .44, 3.85); const b = add(new T.Mesh(new T.CylinderGeometry(.29, .29, .07, 14), lam(0xd8dce8))); b.position.set(dx, .58, 3.85); }
  for (const bx of [3, 26, 27, 44.5, 64, 81.5]) { box(.62, .62, .62, lam(0x8a6a3a), bx, .36, 3.8).rotation.y = rnd(-.3, .3); }
  for (const px of [.08, .14]) { const p = add(new T.Mesh(new T.CylinderGeometry(px, px, 190, 8), lam(px > .1 ? 0x9a4f2a : 0x2f7f7a))); p.rotation.z = Math.PI / 2; p.position.set(STAGE_END / 2, px, 2.55 + (px > .1 ? .25 : 0)); }
}
// =========================================================================================
// 3〜5 面の背景（2026-10-07）: 共通の部品 と 3 面「5億年駅」
// =========================================================================================
Object.assign(THEME_ENV, {
  station: { bg: 0x0b1018, hemi: [0xdfe8ff, 0x2a3040], rim: 0x4fa8ff, rim2: 0xffd23a, edge: 0xffd23a },
  park:    { bg: 0x1a0f2e, hemi: [0xffd8f0, 0x3a2050], rim: 0xff5aa8, rim2: 0x7fe9ff, edge: 0xff5aa8 },
  void:    { bg: 0x030305, hemi: [0xffffff, 0x50586a], rim: 0x9d7bff, rim2: 0xffffff, edge: 0xffffff, fog: [9, 30] },
});
function kit345() {
  const add = (m) => { stage.add(m); return m; };
  const lam = (col, em = 0) => new T.MeshLambertMaterial({ color: col, emissive: em });
  const bas = (col, o) => new T.MeshBasicMaterial(Object.assign({ color: col, fog: false }, o || {}));
  const box = (w, h, d, mat, x, y, z, par = stage) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); par.add(m); return m; };
  const plane = (w, h, mat, x, y, z, par = stage) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), mat); m.position.set(x, y, z); par.add(m); return m; };
  const floor = (w, d, mat, x, y, z, par = stage) => { const m = plane(w, d, mat, x, y, z, par); m.rotation.x = -Math.PI / 2; return m; };
  const glowP = (w, h, col, o, x, y, z, par = stage) => plane(w, h, new T.MeshBasicMaterial({ map: radialTex, color: col, transparent: true, opacity: o, depthWrite: false, blending: T.AdditiveBlending, fog: false }), x, y, z, par);
  const tex = (W, H, draw, px = SP, rep) => canvasTex(Math.round(W * px), Math.round(H * px), (c, w, h) => draw(c, w, h, (m) => h - m * px, px), rep);
  return { add, lam, bas, box, plane, floor, glowP, tex };
}
// 敵が出てくる立体のシャッター（1 面の店のシャッターと同じ仕組み）
function addDoor345(cx, z, y0, K, o = {}) {
  const w = o.w || 2.0, h = o.h || 2.3;
  const geo = new T.PlaneGeometry(w, h); geo.translate(0, -h / 2, 0);
  const sh = K.add(new T.Mesh(geo, new T.MeshBasicMaterial({ fog: false, map: canvasTex(288, 330, (c, cw, ch) => {
    if (o.draw) o.draw(c, cw, ch); else { pShutter(c, 0, 0, cw, ch, o.col || '#5a6074'); c.fillStyle = 'rgba(255,255,255,.78)'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, o.text || '閉', cw / 2, ch * .42, cw - 60, 54, FD, '400'); }
  }) })));
  sh.position.set(cx, y0 + h, z + .03);
  const lit = K.floor(w + .8, 2.4, new T.MeshBasicMaterial({ map: radialTex, color: o.lit || 0xffb060, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }), cx, y0 + .01, z + 1.1);
  const d = { x: cx, sh, lit, open: 0, hold: 0, n: 0, label: o.label || '' }; stageDoors.push(d); return d;
}
// 壁を 1 枚ずつ描いて並べる。ROW = [種類, 幅（メートル）, 追加の値]。種類 'door' は立体のシャッター付き
function wallRow345(ROW, DRAW, x0, K, o = {}) {
  const z = o.z != null ? o.z : -4.5, H = o.H || SHOP_H, y0 = o.y0 || 0, labels = o.labels || DOOR_LABELS, px = o.px || SP;
  let x = x0, di = 0, pi = 0;
  for (const [type, W, arg] of ROW) {
    const cx = x + W / 2, fn = DRAW[type] || SHOP_DRAW[type];
    if (fn) {
      const od = { label: labels[di % labels.length], wall: (o.walls || ['#2a2d42', '#33283a', '#263440', '#3a2e2a'])[di % 4], kind: (o.kinds || ['brick', 'metal', 'plaster', 'brick'])[di % 4], arg, i: pi++, W };
      const t = K.tex(W, H, (c, cw, ch, Y) => { fn(c, cw, Y, od); if (!fn.alpha) { c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(0, 0, 4, ch); c.fillRect(cw - 4, 0, 4, ch); } }, px);
      K.plane(W, H, new T.MeshBasicMaterial(fn.alpha ? { map: t, fog: false, alphaTest: .5 } : { map: t, fog: false }), cx, y0 + H / 2, z);
    }
    if (type === 'door') { addDoor345(cx, z, y0, K, { label: labels[di % labels.length], text: (o.doorText || ['5億年', 'CLOSED', '閉', 'シャッター'])[di % (o.doorText || [0, 0, 0, 0]).length], col: (o.doorCol || ['#5a6074', '#6a5a52', '#4f6a66', '#66607a'])[di % 4], lit: o.lit }); di++; }
    if (o.each) o.each(type, x, W, cx, arg);
    x += W;
  }
  return x;
}
// 夜空（星と、遠くの影絵）
function sky345(K, top, mid, bot, draw) {
  const t = canvasTex(2048, 512, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, top); g.addColorStop(.65, mid); g.addColorStop(1, bot); c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * .7})`; c.fillRect(Math.random() * w, Math.random() * h * .55, 2, 2); }
    if (draw) draw(c, w, h);
  });
  return K.plane(260, 60, new T.MeshBasicMaterial({ map: t, fog: false }), STAGE_END / 2, 22, -40);
}

// =========================================================================================
// 3 面: 5億年駅（ホームで戦う。電車が着くと、ドアから敵が降りてくる）
// =========================================================================================
const ST_ADS = [['5億年ボタン', '押すだけで 100万円', '#c8102a'], ['英会話 5億年', 'それでも話せない', '#1f6fd0'], ['脱毛 5億年保証', '生えてきたら返金', '#d04a8a'], ['週刊 5億年', '創刊号は 5億円', '#1c7a3a'], ['転職するなら', '5億年後がチャンス', '#e8a020'], ['マンション 5億年ローン', '頭金 0 円', '#5a3fd0'], ['5億年に1度の逸材', 'オーディション開催', '#2a2c3a'], ['のどごし 5億年', 'まだ のんでる', '#d8a020']];
const ST_DRAW = {
  tile(c, w, Y) { pWall(c, 0, 0, w, Y(0), '#b8b4a6', 'tile'); c.fillStyle = '#2f6a4a'; c.fillRect(0, Y(1.15), w, 16); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, Y(4.3), w, Y(0) - Y(.9)); c.fillStyle = '#3a3d48'; c.fillRect(0, Y(.5), w, 10); },
  ekimei(c, w, Y) {   // 駅名の看板
    ST_DRAW.tile(c, w, Y);
    const bw = Math.min(w - 120, 620), bx = (w - bw) / 2, by = Y(3.0), bh = SP * 1.5;
    c.fillStyle = '#20222c'; c.fillRect(bx + 40, by + bh, 14, Y(.5) - by - bh); c.fillRect(bx + bw - 54, by + bh, 14, Y(.5) - by - bh);
    c.fillStyle = '#f6f4ec'; c.fillRect(bx, by, bw, bh); c.strokeStyle = '#20222c'; c.lineWidth = 6; c.strokeRect(bx, by, bw, bh);
    c.fillStyle = '#1c7a3a'; c.fillRect(bx, by + bh * .62, bw, bh * .1);
    c.fillStyle = '#12131c'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, 'ごおくねん', w / 2, by + bh * .34, bw - 60, bh * .42, FD, '400'); fitText(c, '5億年　GOOKUNEN', w / 2, by + bh * .14, bw - 200, bh * .13);
    c.textAlign = 'left'; fitText(c, '◀ 4億9999万年', bx + 16, by + bh * .86, bw * .44, bh * .15); c.textAlign = 'right'; fitText(c, '5億1年 ▶', bx + bw - 16, by + bh * .86, bw * .4, bh * .15);
    for (let i = 0; i < 3; i++) { c.fillStyle = ['#2f6fd0', '#d04a4a', '#2f9f6a'][i]; c.fillRect(w / 2 - 190 + i * 130, Y(.95), 110, 38); c.fillStyle = '#20222c'; c.fillRect(w / 2 - 180 + i * 130, Y(.68), 8, 30); c.fillRect(w / 2 - 98 + i * 130, Y(.68), 8, 30); }   // ベンチ
  },
  ad(c, w, Y, o) {   // 広告 2 枚
    ST_DRAW.tile(c, w, Y);
    const n = Math.max(1, Math.round(w / 430)), pw = Math.min(360, (w - 60) / n - 30), gap = (w - n * pw) / (n + 1);
    for (let i = 0; i < n; i++) {
      const a = ST_ADS[(o.i * 2 + i) % ST_ADS.length], x = gap + i * (pw + gap), y = Y(3.05), h = SP * 1.75;
      c.fillStyle = '#8a8f9c'; c.fillRect(x - 8, y - 8, pw + 16, h + 16); c.fillStyle = a[2]; c.fillRect(x, y, pw, h);
      const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(255,255,255,.28)'); g.addColorStop(1, 'rgba(0,0,0,.25)'); c.fillStyle = g; c.fillRect(x, y, pw, h);
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, a[0], x + pw / 2, y + h * .38, pw - 30, h * .26, FD, '400');
      c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(x, y + h * .66, pw, h * .22); c.fillStyle = '#FFE14A'; fitText(c, a[1], x + pw / 2, y + h * .775, pw - 30, h * .13);
    }
  },
  jikoku(c, w, Y) {   // 時刻表と路線図
    ST_DRAW.tile(c, w, Y);
    const x = 60, y = Y(3.1), bw = w * .42, bh = SP * 2.0;
    c.fillStyle = '#f6f4ec'; c.fillRect(x, y, bw, bh); c.fillStyle = '#1f4f8a'; c.fillRect(x, y, bw, 44); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, '時刻表（平日・休日・永遠）', x + bw / 2, y + 23, bw - 20, 26);
    const rows = ['5時　来ない', '6時　来ない', '7時　遅れて来ない', '8時　5億年後', '9時　調整中', '以降　おさっしください'];
    c.textAlign = 'left'; rows.forEach((t, i) => { c.fillStyle = i % 2 ? '#e4e0d2' : '#f6f4ec'; c.fillRect(x, y + 44 + i * (bh - 44) / 6, bw, (bh - 44) / 6); c.fillStyle = i === 3 ? '#c8102a' : '#1a1410'; fitText(c, t, x + 14, y + 44 + (i + .5) * (bh - 44) / 6 + 2, bw - 24, 26); });
    const mx = w * .52, mw = w * .42; c.fillStyle = '#f6f4ec'; c.fillRect(mx, y, mw, bh * .62); c.strokeStyle = '#1c7a3a'; c.lineWidth = 9; c.beginPath(); c.moveTo(mx + 30, y + bh * .36); c.lineTo(mx + mw - 30, y + bh * .36); c.stroke();
    const st = ['現在', '1億年', '2億年', '3億年', '4億年', '5億年']; c.textAlign = 'center';
    st.forEach((t, i) => { const sx = mx + 30 + i * (mw - 60) / 5; c.fillStyle = i ? '#fff' : '#c8102a'; c.beginPath(); c.arc(sx, y + bh * .36, 11, 0, 7); c.fill(); c.strokeStyle = '#1c7a3a'; c.lineWidth = 4; c.stroke(); c.fillStyle = '#1a1410'; fitText(c, t, sx, y + bh * .5, 70, 19); });
    c.fillStyle = '#1a1410'; fitText(c, '路線図（各駅停車しかありません）', mx + mw / 2, y + bh * .14, mw - 30, 22);
  },
  stairs(c, w, Y) {   // 階段と出口の案内
    ST_DRAW.tile(c, w, Y);
    const sx = w * .2, sw = w * .6; c.fillStyle = '#0a0b10'; c.fillRect(sx, Y(2.6), sw, SP * 2.1);
    for (let i = 0; i < 9; i++) { c.fillStyle = `rgba(${90 - i * 7},${96 - i * 7},${112 - i * 8},1)`; c.fillRect(sx + i * 5, Y(.5 + (i + 1) * .21), sw - i * 10, SP * .21 - 3); }
    c.fillStyle = '#8a8f9c'; c.fillRect(sx - 12, Y(2.7), 12, SP * 2.2); c.fillRect(sx + sw, Y(2.7), 12, SP * 2.2);
    pSign(c, sx - 30, Y(3.3), sw + 60, SP * .52, '出口（ない）　↗', { bg: '#FFD23A', fg: '#12131c', font: FJ, k: .6, border: '#12131c' });
    pPaper(c, sx + sw + 30, Y(1.9), 150, 100, ['のりかえ', '人生'], { red: [1] });
  },
  kiosk(c, w, Y) {   // 売店
    ST_DRAW.tile(c, w, Y);
    const kx = 50, kw = w - 100; c.fillStyle = '#2a2c3a'; c.fillRect(kx, Y(2.75), kw, SP * 2.25);
    pGlass(c, kx + 14, Y(2.3), kw - 28, SP * 1.2, 'rgba(255,236,190,.95)', 3, '#1a1c28'); pShelf(c, kx + 24, Y(2.25), kw - 48, SP * 1.1, 3, ['#ff5a3a', '#ffe14a', '#6ad04a', '#4fa8ff', '#fff', '#d04a8a']);
    pSign(c, kx - 10, Y(3.25), kw + 20, SP * .5, 'KIOSK 5億', { bg: '#1c7a3a', fg: '#fff', k: .62 });
    c.fillStyle = '#3a3d48'; c.fillRect(kx, Y(1.05), kw, SP * .55); pPaper(c, kx + kw * .5 - 110, Y(.98), 220, 64, ['新聞 5億年前の', '売れ残りあり'], { rot: 0 });
    pSil(c, kx + kw * .5, Y(1.1), SP * .9, 'rgba(12,10,22,.7)');
  },
};
const ST_ROW = [['ad', 6], ['ekimei', 8], ['stairs', 6], ['ad', 6], ['jikoku', 8], ['kiosk', 6], ['ad', 6], ['ekimei', 8], ['stairs', 6], ['ad', 6], ['kiosk', 6], ['jikoku', 8], ['ad', 6], ['ekimei', 8], ['stairs', 6], ['ad', 6], ['kiosk', 6], ['ad', 6]];
function buildStation(env) {
  const K = kit345(), { add, lam, bas, box, plane, floor, glowP, tex } = K, L = STAGE_END;
  const PZ0 = -3.1, PZ1 = 3.35, PD = PZ1 - PZ0, PC = (PZ0 + PZ1) / 2;   // ホームの奥行き
  // ---- ホーム（点字ブロックと白線、乗る位置の印）----
  const ft = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#565b6a'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 4800; i++) { const v = 70 + Math.random() * 40; c.fillStyle = `rgba(${v},${v + 4},${v + 14},.4)`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 2; for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, h); c.stroke(); c.beginPath(); c.moveTo(0, i * 64); c.lineTo(w, i * 64); c.stroke(); }
    for (const y of [26, h - 52]) { c.fillStyle = '#e8c21a'; c.fillRect(0, y, w, 24); c.fillStyle = 'rgba(0,0,0,.22)'; for (let x = 5; x < w; x += 12) for (const dy of [7, 17]) { c.beginPath(); c.arc(x, y + dy, 2.6, 0, 7); c.fill(); } }
    c.fillStyle = 'rgba(255,255,255,.75)'; c.fillRect(0, 12, w, 5); c.fillRect(0, h - 16, w, 5);
    c.fillStyle = 'rgba(255,255,255,.7)'; for (const x of [128, 384]) { c.beginPath(); c.moveTo(x - 16, 92); c.lineTo(x + 16, 92); c.lineTo(x, 64); c.fill(); }
    c.fillStyle = 'rgba(255,255,255,.5)'; c.font = 'bold 17px "Noto Sans JP", sans-serif'; c.textAlign = 'center'; c.fillText('5億年のりば', 128, 114); c.fillText('女性専用車（全車両）', 384, 114);
    c.fillStyle = 'rgba(255,255,255,.4)'; c.font = 'bold 15px "Noto Sans JP", sans-serif'; c.fillText('← 足もと注意 →', 256, h - 70);
  }, [30, 1]);
  const side = lam(0x3a3d48);
  box(180, 1.0, PD, [side, side, new T.MeshLambertMaterial({ map: ft }), side, new T.MeshLambertMaterial({ map: canvasTex(512, 64, (c, w, h) => { c.fillStyle = '#3a3d48'; c.fillRect(0, 0, w, h); c.fillStyle = '#e8c21a'; c.fillRect(0, 0, w, 7); c.fillStyle = 'rgba(0,0,0,.3)'; for (let x = 0; x < w; x += 64) c.fillRect(x, 0, 3, h); }, [60, 1]) }), side], L / 2, -.5, PC);
  // ---- 線路（奥と手前）----
  const rail = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#1c1d24'; c.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { const v = 40 + Math.random() * 40; c.fillStyle = `rgba(${v},${v},${v + 6},.6)`; c.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    c.fillStyle = '#4a3a2a'; for (let x = 10; x < w; x += 42) c.fillRect(x, h * .2, 20, h * .6);
    c.fillStyle = '#a8aebc'; c.fillRect(0, h * .3, w, 8); c.fillRect(0, h * .68, w, 8); c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(0, h * .3, w, 2); c.fillRect(0, h * .68, w, 2);
  }, [60, 1]);
  floor(180, 4.4, new T.MeshLambertMaterial({ map: rail }), L / 2, -1.0, PZ0 - 2.2);
  floor(180, 3.0, new T.MeshLambertMaterial({ map: rail, emissive: 0x15161c }), L / 2, -1.0, PZ1 + 1.5);
  // ---- 向かいのホームと壁 ----
  const FZ = -7.5;
  box(180, 1.0, 1.2, [side, side, lam(0x565b6a), side, side, side], L / 2, -.5, FZ + .6);
  floor(180, .22, bas(0xe8c21a), L / 2, .01, FZ + 1.05);
  wallRow345(ST_ROW, ST_DRAW, -14, K, { z: FZ, H: 4.6 });
  sky345(K, '#05070e', '#0b1018', '#141a28');
  // ---- 屋根の梁・柱・つり下げ看板 ----
  box(180, .3, .3, lam(0x2a2e3a), L / 2, 3.95, PZ0 + .1);
  const pm = lam(0x4a5066);
  for (let x = -9; x < L + 12; x += 9) { box(.24, 4, .24, pm, x, 2, PZ0 + .2); box(.5, .9, .5, new T.MeshLambertMaterial({ map: canvasTex(64, 128, (c, w, h) => hazard(c, 0, 0, w, h, 20)) }), x, .45, PZ0 + .2); }
  const hang = (x, lines, bg, fg, w = 2.6) => {
    const t = canvasTex(512, 128, (c, cw, ch) => { c.fillStyle = bg; c.fillRect(0, 0, cw, ch); c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; const lh = ch / lines.length; lines.forEach((s, i) => fitText(c, s, cw / 2, lh * (i + .5) + 3, cw - 30, lh * .72)); });
    const m = box(w, w / 4, .08, [lam(0x20222c), lam(0x20222c), lam(0x20222c), lam(0x20222c), new T.MeshBasicMaterial({ map: t, fog: false }), lam(0x20222c)], x, 3.05, PZ0 + .45);
    for (const dx of [-w * .4, w * .4]) box(.03, .7, .03, lam(0x8a8f9c), x + dx, 3.05 + w / 8 + .35, PZ0 + .45);
    return m;
  };
  const HANG = [['1番線　5億年・無限 方面'], ['出口：ない', 'のりかえ：できない'], ['駆け込み乗車は', 'おやめください（敵も）'], ['黄色い線の内側で', 'お戦いください'], ['待合室（5億年待ち）'], ['忘れ物：人生'], ['終電は 5億年後です'], ['足もと・背後・人生に注意'], ['精算所（つけ払い不可）'], ['この先 大ボス']];
  HANG.forEach((ls, i) => hang(4.5 + i * 9, ls, i % 3 === 1 ? '#FFD23A' : '#10121c', i % 3 === 1 ? '#10121c' : '#fff'));
  // 電光掲示板（文字が流れる）
  const leds = [];
  for (const [lx, msg] of [[13.5, 'まもなく 1番線に 遅延が まいります。黄色い線の内側で おなぐりあいください。　　'], [49.5, '本日も 5億年鉄道を ご利用いただき まことに 5億年。　お客様に お願いです。敵は 降りる人が 先です。　　'], [76.5, 'この電車は 大ボス行き です。途中の駅には 止まりたくありません。　　']]) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64; const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace;
    box(3.4, .5, .12, lam(0x15161c), lx, 3.42, PZ0 + .5); plane(3.2, .4, new T.MeshBasicMaterial({ map: t, fog: false }), lx, 3.42, PZ0 + .57);
    leds.push({ cv, t, msg, x: 0, lx, w: 0, tm: 0 });
  }
  stageAnim.push((dt) => {
    for (const d of leds) {
      d.tm -= dt; if (d.tm > 0 || Math.abs(d.lx - G.camX) > halfW + 2.5) continue; d.tm = .05;
      const c = d.cv.getContext('2d'); c.fillStyle = '#050608'; c.fillRect(0, 0, 512, 64); c.font = 'bold 42px "Noto Sans JP", sans-serif'; c.textBaseline = 'middle'; c.fillStyle = '#ff9a2a';
      if (!d.w) d.w = c.measureText(d.msg).width; d.x = (d.x + 9) % d.w; c.fillText(d.msg, -d.x, 34); c.fillText(d.msg, d.w - d.x, 34); d.t.needsUpdate = true;
    }
  });
  // 天井の明かり（床に光のたまり）
  for (let x = -6; x < L + 10; x += 6) { box(1.6, .06, .2, bas(0xf4f8ff), x, 3.86, -.4); glowP(5, 3.4, 0xdfe8ff, .16, x, .02, -.4).rotation.x = -Math.PI / 2; }
  // ---- 電車 ----
  const TZ = PZ0 - .25, CAR = 9.3, NC = 5, CH = 2.75, DX = [-3, 0, 3], DW = 1.3;
  const tr = new T.Group(); tr.position.set(300, 0, 0); stage.add(tr);
  const sideTex = (k) => tex(9, CH, (c, w, h, Y, px) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#dfe3ea'); g.addColorStop(.5, '#c2c8d4'); g.addColorStop(1, '#8a909e'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1c9a6a'; c.fillRect(0, Y(1.02), w, px * .16); c.fillStyle = '#e8c21a'; c.fillRect(0, Y(.84), w, px * .05); c.fillStyle = '#1c9a6a'; c.fillRect(0, Y(2.62), w, px * .08);
    c.fillStyle = 'rgba(0,0,0,.2)'; for (let y = Y(2.4); y < Y(.1); y += 9) c.fillRect(0, y, w, 1);
    // 窓（中は満員）
    for (const wx of [-1.5, 1.5, -4.05, 4.05]) {
      const ww = Math.abs(wx) > 4 ? .7 : 1.45, x = (4.5 + wx - ww / 2) * px, y = Y(2.1), wh = px * .9;
      c.fillStyle = '#f2e6c0'; c.fillRect(x, y, ww * px, wh); c.save(); c.beginPath(); c.rect(x, y, ww * px, wh); c.clip();
      for (let i = 0; i < ww * 5; i++) pSil(c, x + 12 + i * px * .21 + rnd(-6, 6), y + wh + px * rnd(.45, .7), px * rnd(.85, 1.0), `rgba(${20 + (i % 3) * 14},${22 + (i % 2) * 10},40,.92)`);
      c.fillStyle = 'rgba(160,210,255,.16)'; c.fillRect(x, y, ww * px, wh); c.restore(); c.strokeStyle = '#2a2e3a'; c.lineWidth = 5; c.strokeRect(x, y, ww * px, wh);
    }
    // 行き先
    c.fillStyle = '#07080c'; c.fillRect(w / 2 + .8 * px, Y(2.52), 1.25 * px, px * .3); c.fillStyle = '#ff9a2a'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, ['各停 5億年', '回送（うそ）', '急行 大ボス', '各停 5億年', '快速 来世'][k], w / 2 + 1.425 * px, Y(2.37), 1.15 * px, px * .2);
    c.fillStyle = '#2a2e3a'; fitText(c, `${k + 1}号車`, w / 2 - 2.3 * px, Y(2.38), 80, px * .16);
    // ドアの穴
    for (const dx of DX) { c.fillStyle = '#2a2e3a'; c.fillRect((4.5 + dx - DW / 2) * px - 6, Y(2.07), DW * px + 12, px * 2.07); c.clearRect((4.5 + dx - DW / 2) * px, Y(2.0), DW * px, px * 2.0); }
  });
  const leafTex = tex(DW / 2, 2.0, (c, w, h, Y, px) => { c.fillStyle = '#c9ced8'; c.fillRect(0, 0, w, h); c.fillStyle = '#1c9a6a'; c.fillRect(0, Y(1.02), w, px * .16); c.fillStyle = '#1a2230'; c.fillRect(w * .16, Y(1.85), w * .68, px * .7); c.fillStyle = 'rgba(160,210,255,.25)'; c.fillRect(w * .16, Y(1.85), w * .3, px * .7); c.strokeStyle = '#6a7080'; c.lineWidth = 4; c.strokeRect(1, 1, w - 2, h - 2); });
  const inTex = tex(9, 2.6, (c, w, h, Y, px) => {
    c.fillStyle = '#e8dcc0'; c.fillRect(0, 0, w, h); c.fillStyle = '#8a8f9c'; c.fillRect(0, Y(2.5), w, px * .1);
    for (let x = 20; x < w; x += px * .28) { c.strokeStyle = '#f4f4f4'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, Y(2.45)); c.lineTo(x, Y(2.1)); c.stroke(); c.beginPath(); c.arc(x, Y(2.03), 8, 0, 7); c.stroke(); }
    c.fillStyle = '#2f7a5a'; c.fillRect(0, Y(.75), w, px * .4); c.fillStyle = '#3a3d48'; c.fillRect(0, Y(.35), w, px * .35);
    for (let i = 0; i < 6; i++) { c.fillStyle = ['#c8102a', '#1f6fd0', '#e8a020'][i % 3]; c.fillRect(40 + i * px * 1.5, Y(1.95), px * .9, px * .5); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, ST_ADS[i][0], 40 + i * px * 1.5 + px * .45, Y(1.7), px * .8, px * .16); }
  }, 80);
  const doors = [], roofM = lam(0x9aa0ae), underM = lam(0x23252e), dkM = lam(0x15161c);
  for (let k = 0; k < NC; k++) {
    const car = new T.Group(); car.position.set((k - (NC - 1) / 2) * CAR, 0, 0); tr.add(car);
    plane(9, CH, new T.MeshBasicMaterial({ map: sideTex(k), fog: false, alphaTest: .5 }), 0, .05 + CH / 2, TZ, car);
    plane(9, 2.6, new T.MeshBasicMaterial({ map: inTex, color: 0xb8b0a0, fog: false }), 0, 1.35, TZ - 1.95, car);
    box(9, .3, 2.2, roofM, 0, CH + .2, TZ - 1.1, car); box(8.6, .22, 1.0, lam(0x7a8090), 0, CH + .44, TZ - 1.1, car);
    box(9, .75, 2.0, underM, 0, -.42, TZ - 1.1, car); for (const bx of [-3.2, 3.2]) box(1.9, .4, 2.1, dkM, bx, -.72, TZ - 1.1, car);
    floor(9, 2.0, lam(0x6a6558), 0, .03, TZ - 1.0, car);
    box(.25, CH, 2.2, lam(0x9aa0ae), -4.52, .05 + CH / 2, TZ - 1.1, car); box(.25, CH, 2.2, lam(0x9aa0ae), 4.52, .05 + CH / 2, TZ - 1.1, car);
    for (const dx of DX) {
      const lf = [-1, 1].map((sd) => plane(DW / 2, 2.0, new T.MeshBasicMaterial({ map: leafTex, fog: false }), dx + sd * DW / 4, 1.05, TZ - .03, car));
      const lit = floor(2.2, 2.2, new T.MeshBasicMaterial({ map: radialTex, color: 0xffe8b0, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }), dx, .02, TZ + 1.0, car);
      const d = { x: 1e6, sh: new T.Object3D(), lit, open: 0, hold: 0, n: 0, label: '電車のドア', lx: car.position.x + dx, lf, dx };
      stageDoors.push(d); doors.push(d);
    }
  }
  const head = glowP(3, 3, 0xfff2c0, .0, -(NC * CAR) / 2 - .2, 1.2, TZ + .1, tr);
  const TR = { ph: 'away', x: 300, v: 0, idx: -1, stopX: 0, snd: 0 };
  stageAnim.push((dt) => {
    const coop = G.mode === 'coop' && (G.phase === 'play' || G.phase === 'ending' || G.phase === 'tally'), A = AREAS[G.areaIdx];
    if (TR.ph === 'away') {
      if (coop && G.phase === 'play' && A && G.areaIdx !== TR.idx && Math.abs(G.camX - A.lock) < 11) { TR.ph = 'in'; TR.idx = G.areaIdx; TR.stopX = A.lock; TR.x = A.lock + 64; TR.v = -42; sfx.truck(); textFx(G.camX + halfW - 1.5, 2.6, -2, 'プァーン!', COL.gold, 2.0, 1.0); }
    } else if (TR.ph === 'in') {
      const d = TR.x - TR.stopX; TR.v = -Math.max(1.5, Math.sqrt(Math.max(0, 2 * 13.8 * d))); TR.x += TR.v * dt;
      if (TR.x <= TR.stopX + .02) { TR.x = TR.stopX; TR.v = 0; TR.ph = 'stop'; sfx.beep(); shake(.12); }
      else if (d > 4 && Math.random() < .5) streaks.add(TR.x - NC * CAR / 2 + rnd(0, NC * CAR), rnd(.2, 2.6), TZ + .1, -TR.v * .2, 0, 0, .12, .05, .04, .9, .95, 1, 0, 0);
    } else if (TR.ph === 'stop') {
      if (G.areaIdx !== TR.idx || !coop) TR.ph = 'close';
    } else if (TR.ph === 'close') {
      if (doors.every(d => d.open < .03)) { TR.ph = 'out'; TR.v = 0; sfx.shutter(); }
    } else {
      TR.v -= 7.5 * dt; TR.x += TR.v * dt; if (TR.x < G.camX - 70) { TR.ph = 'away'; TR.x = 300; }
    }
    tr.position.x = TR.x; tr.position.y = TR.ph === 'in' || TR.ph === 'out' ? Math.sin(gameTime * 40) * .012 : 0;
    head.material.opacity = TR.ph === 'in' ? .55 : 0;
    for (const d of doors) { d.x = TR.ph === 'stop' ? TR.x + d.lx : 1e6; if (TR.ph !== 'stop') d.hold = 0; const s = d.open * (DW / 2 - .04); d.lf[0].position.x = d.dx - DW / 4 - s; d.lf[1].position.x = d.dx + DW / 4 + s; }
  });
  // ---- ホームの小物（ごみ箱・ベンチ・時計）----
  for (const bx of [1.5, 21, 36.5, 57, 70.5, 88]) { box(1.5, .08, .42, lam(0x2f6fd0), bx, .46, PZ0 + .42); box(1.5, .5, .06, lam(0x2f6fd0), bx, .78, PZ0 + .24); for (const dx of [-.6, .6]) box(.06, .44, .36, lam(0x20222c), bx + dx, .22, PZ0 + .42); }
  for (const cx of [9, 45, 81]) { const cl = add(new T.Mesh(new T.CylinderGeometry(.36, .36, .1, 24), bas(0xf6f4ec))); cl.rotation.x = Math.PI / 2; cl.position.set(cx, 3.3, PZ0 + .32); const hd = box(.03, .26, .02, bas(0x10121c), cx, 3.3, PZ0 + .39); hd.geometry.translate(0, .1, 0); const hd2 = box(.03, .2, .02, bas(0xc8102a), cx, 3.3, PZ0 + .4); hd2.geometry.translate(0, .08, 0); stageAnim.push(() => { hd.rotation.z = -gameTime * 3; hd2.rotation.z = -gameTime * 37; }); }   // 時計（進むのが速すぎる）
  // 手前: 線路の向こう側は暗い
  box(180, 1.6, .3, lam(0x15161c), L / 2, -.9, PZ1 + 3.1);
  // VR で見下ろしたときの台（線路のぶん低い）と右端の柵
  box(186, 60, 16, lam(0x151a30), L / 2, -31.02, -1.5); box(186, .12, .12, bas(env.edge), L / 2, -1.05, 6.4); box(.3, 2.2, PD, lam(0xffce4a), L + 6.2, 1.1, PC);
}
// =========================================================================================
// 4 面: 5億年ランド（閉園後の遊園地。屋台のあいだから、観覧車やメリーゴーラウンドが見える）
// =========================================================================================
const PK_LABELS = ['おばけ屋敷（本物）', 'ミラーハウス（出口なし）', '迷路（設計ミス）', 'スタッフ専用（敵）', 'トイレ（5億年待ち）', 'コインロッカー（中に敵）', '救護室（満員）'];
const pkStripe = (c, x, y, w, h, c1, c2, n) => { for (let i = 0; i < n; i++) { c.fillStyle = i % 2 ? c1 : c2; c.fillRect(x + i * w / n, y, w / n + 1, h); } };
const pkRoof = (c, w, Y, c1, c2, top = 3.5, bot = 2.75) => {   // しましまの屋根（下のふちが波形）
  pkStripe(c, 0, Y(top), w, Y(bot) - Y(top), c1, c2, Math.round(w / 60));
  for (let i = 0; i < w / 60; i++) { c.fillStyle = i % 2 ? c1 : c2; c.beginPath(); c.arc(i * 60 + 30, Y(bot), 30, 0, Math.PI); c.fill(); }
  c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, Y(top), w, 8);
};
const pkBulbs = (c, w, y) => { for (let x = 16; x < w; x += 44) { c.fillStyle = ['#ffe14a', '#ff5aa8', '#7fe9ff', '#b8ff5a'][(x / 44 | 0) % 4]; c.shadowColor = c.fillStyle; c.shadowBlur = 14; c.beginPath(); c.arc(x, y, 7, 0, 7); c.fill(); } c.shadowBlur = 0; };
const PK_DRAW = {
  base(c, w, Y, col = '#3a2a52') { pWall(c, 0, 0, w, Y(0), col, 'wood'); c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(0, 0, w, Y(3.55)); pkBulbs(c, w, Y(3.62)); },
  ticket(c, w, Y) {   // 入園券の売り場
    PK_DRAW.base(c, w, Y, '#4a3060'); pkRoof(c, w, Y, '#e83a5a', '#fff6fb');
    pSign(c, 40, Y(2.68), w - 80, SP * .5, '入園券 5億円（こどもも）', { bg: '#fff6fb', fg: '#c8102a', font: FJ, k: .56, border: '#c8102a' });
    pGlass(c, w * .2, Y(2.05), w * .6, SP * 1.0, 'rgba(255,236,190,.95)', 2, '#2a1a3a'); pSil(c, w * .5, Y(1.06), SP * .95, 'rgba(12,10,22,.75)');
    c.fillStyle = '#2a1a3a'; c.fillRect(w * .16, Y(1.05), w * .68, SP * 1.05); pPaper(c, w * .5 - 120, Y(.9), 240, 96, ['再入園 不可', '退園も 不可'], { red: [1], rot: 0 });
  },
  popcorn(c, w, Y) {
    PK_DRAW.base(c, w, Y, '#5a3a2a'); pkRoof(c, w, Y, '#ffe14a', '#e83a5a');
    pSign(c, 30, Y(2.68), w - 60, SP * .5, 'ポップコーン 5億粒', { bg: '#e83a5a', fg: '#fff', k: .6 });
    c.fillStyle = '#fff6fb'; c.fillRect(w * .12, Y(2.05), w * .76, SP * 1.15); c.strokeStyle = '#c8102a'; c.lineWidth = 8; c.strokeRect(w * .12, Y(2.05), w * .76, SP * 1.15);
    for (let i = 0; i < 260; i++) { c.fillStyle = pick(['#fff2b0', '#ffe14a', '#fff']); c.beginPath(); c.arc(w * .14 + Math.random() * w * .72, Y(.95) - Math.pow(Math.random(), 2) * SP * .9, rnd(6, 11), 0, 7); c.fill(); }
    c.fillStyle = '#c8102a'; c.fillRect(w * .08, Y(.9), w * .84, SP * .9); pkStripe(c, w * .08, Y(.9), w * .84, 18, '#fff', '#c8102a', 14);
  },
  shateki(c, w, Y) {   // 射的
    PK_DRAW.base(c, w, Y, '#2a3a5a'); pkRoof(c, w, Y, '#2f6fd0', '#fff6fb');
    pSign(c, 40, Y(2.68), w - 80, SP * .5, '射的　当たっても 落ちません', { bg: '#12131c', neon: '#ffe14a', font: FJ, k: .5 });
    c.fillStyle = '#1a1420'; c.fillRect(30, Y(2.1), w - 60, SP * 1.25); pShelf(c, 44, Y(2.05), w - 88, SP * 1.15, 3, ['#ff5aa8', '#ffe14a', '#7fe9ff', '#b8ff5a', '#fff', '#ff8a1f']);
    c.fillStyle = '#6a4a2a'; c.fillRect(20, Y(.85), w - 40, SP * .85); for (let i = 0; i < 4; i++) { c.fillStyle = '#3a2a1a'; c.fillRect(60 + i * (w - 160) / 3, Y(1.0), 90, 12); c.fillRect(60 + i * (w - 160) / 3, Y(1.04), 14, 26); }
    pPaper(c, w - 230, Y(.72), 190, 76, ['1回 5億円', '景品：思い出'], { red: [0] });
  },
  crepe(c, w, Y) {
    PK_DRAW.base(c, w, Y, '#5a2a4a'); pkRoof(c, w, Y, '#ff8ac0', '#fff6fb');
    pSign(c, 30, Y(2.68), w - 60, SP * .5, '5億層 ミルクレープ', { bg: '#fff6fb', fg: '#d03a8a', k: .58, border: '#d03a8a' });
    pGlass(c, w * .14, Y(2.05), w * .72, SP * 1.1, 'rgba(255,220,236,.95)', 2, '#3a1a2a');
    for (let i = 0; i < 4; i++) { const x = w * .2 + i * w * .18, y = Y(1.15); c.fillStyle = '#f4d8a0'; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 46, y - 110); c.lineTo(x - 46, y - 110); c.fill(); c.fillStyle = ['#ff5aa8', '#fff', '#b8ff5a', '#ffe14a'][i]; c.beginPath(); c.arc(x, y - 112, 34, Math.PI, 0); c.fill(); }
    c.fillStyle = '#3a1a2a'; c.fillRect(w * .1, Y(.95), w * .8, SP * .95);
  },
  gacha(c, w, Y) {   // ガチャガチャの壁
    PK_DRAW.base(c, w, Y, '#2a2a4a');
    pSign(c, 40, Y(3.3), w - 80, SP * .5, 'ガチャ　1回 5億円', { bg: '#12131c', neon: '#7fe9ff', font: FJ, k: .56 });
    const n = Math.max(3, Math.round(w / 150)), mw = (w - 60) / n;
    for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) {
      const x = 30 + i * mw, y = Y(2.6 - r * 1.25), col = ['#ff5aa8', '#ffe14a', '#7fe9ff', '#b8ff5a', '#ff8a1f', '#c77ae8'][(i + r * 2) % 6];
      c.fillStyle = col; c.fillRect(x + 6, y, mw - 12, SP * 1.15); c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.arc(x + mw / 2, y + SP * .42, mw * .34, 0, 7); c.fill();
      for (let k = 0; k < 9; k++) { c.fillStyle = pick(['#ff5aa8', '#ffe14a', '#7fe9ff', '#b8ff5a', '#ff8a1f']); c.beginPath(); c.arc(x + mw / 2 + rnd(-1, 1) * mw * .2, y + SP * .5 + rnd(-.5, .7) * mw * .2, mw * .08, 0, 7); c.fill(); }
      c.fillStyle = '#12131c'; c.fillRect(x + mw * .3, y + SP * .86, mw * .4, SP * .2); c.fillStyle = '#c2c8d4'; c.beginPath(); c.arc(x + mw * .5, y + SP * .96, 9, 0, 7); c.fill();
    }
  },
  lost(c, w, Y) {   // 迷子センター
    PK_DRAW.base(c, w, Y, '#2a4a6a'); pkRoof(c, w, Y, '#4fa8ff', '#fff6fb');
    pSign(c, 30, Y(2.68), w - 60, SP * .5, '迷子センター', { bg: '#fff6fb', fg: '#1f4f8a', k: .62, border: '#1f4f8a' });
    pGlass(c, w * .12, Y(2.05), w * .5, SP * 1.15, 'rgba(200,230,255,.95)', 2, '#1a2a3a'); pSil(c, w * .28, Y(.95), SP * .6, 'rgba(12,10,22,.7)'); pSil(c, w * .46, Y(.95), SP * .95, 'rgba(12,10,22,.7)');
    pDoor(c, w * .68, Y(2.05), w * .22, SP * 2.05, '#3a5a7a', 'rgba(200,230,255,.8)');
    pPaper(c, w * .14, Y(.82), w * .46, 90, ['保護者の方を さがしています', '（5億年ほど）'], { red: [1], rot: 0 });
  },
  photo(c, w, Y) {   // 顔はめパネル
    PK_DRAW.base(c, w, Y, '#3a4a2a');
    c.fillStyle = '#7fe9ff'; c.fillRect(50, Y(3.1), w - 100, SP * 2.9); c.fillStyle = '#b8ff5a'; c.fillRect(50, Y(.9), w - 100, SP * .7); c.strokeStyle = '#fff6fb'; c.lineWidth = 12; c.strokeRect(50, Y(3.1), w - 100, SP * 2.9);
    c.fillStyle = '#ff5aa8'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, '5億年ランドへ ようこそ', w / 2, Y(2.75), w - 160, SP * .34, FD, '400');
    for (const [fx, s, col] of [[.3, 1, '#ffe14a'], [.55, 1.25, '#ff8ac0'], [.78, .8, '#c77ae8']]) { const x = w * fx, y = Y(.95); c.fillStyle = col; c.fillRect(x - 46 * s, y - 150 * s, 92 * s, 150 * s); c.beginPath(); c.arc(x, y - 190 * s, 56 * s, 0, 7); c.fill(); c.fillStyle = '#0a0a12'; c.beginPath(); c.arc(x, y - 190 * s, 34 * s, 0, 7); c.fill(); }
    pPaper(c, w - 250, Y(.8), 200, 70, ['顔を入れると', 'ぬけなくなります'], { red: [1] });
  },
  gap(c, w, Y) {   // 柵（向こうが見える）と、つり下げた旗
    c.clearRect(0, 0, w, Y(0));
    c.fillStyle = '#fff6fb'; for (let x = 6; x < w; x += 34) { c.fillRect(x, Y(1.05), 16, SP * 1.05); c.beginPath(); c.moveTo(x, Y(1.05)); c.lineTo(x + 8, Y(1.18)); c.lineTo(x + 16, Y(1.05)); c.fill(); }
    c.fillRect(0, Y(.85), w, 12); c.fillRect(0, Y(.35), w, 12);
    for (let i = 0; i < w / 56; i++) { const x = i * 56, sag = Math.sin((x / w) * Math.PI) * 44; c.fillStyle = ['#ff5aa8', '#ffe14a', '#7fe9ff', '#b8ff5a', '#ff8a1f'][i % 5]; c.beginPath(); c.moveTo(x + 4, Y(3.6) + sag); c.lineTo(x + 52, Y(3.6) + sag); c.lineTo(x + 28, Y(3.6) + sag + 52); c.fill(); }
  },
  stage(c, w, Y) {   // 大ボスの舞台
    pWall(c, 0, 0, w, Y(0), '#1a1024', 'plaster');
    const g = c.createLinearGradient(0, Y(3.6), 0, Y(.6)); g.addColorStop(0, '#3a1050'); g.addColorStop(1, '#12081c'); c.fillStyle = g; c.fillRect(w * .08, Y(3.6), w * .84, SP * 3.0);
    for (let i = 0; i < 70; i++) { c.fillStyle = `rgba(255,255,255,${rnd(.3, .9)})`; c.beginPath(); c.arc(w * .1 + Math.random() * w * .8, Y(3.5) + Math.random() * SP * 2.6, rnd(1.5, 4), 0, 7); c.fill(); }
    for (const sd of [0, 1]) { const x0 = sd ? w * .92 : w * .08; for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? '#a01030' : '#c8102a'; c.fillRect(x0 + (sd ? -1 : 1) * i * 26 - (sd ? 26 : 0), Y(3.6), 26, SP * 3.0); } }
    c.fillStyle = '#c8102a'; c.fillRect(0, Y(3.9), w, SP * .34); pkBulbs(c, w, Y(3.6));
    pSign(c, w * .22, Y(3.3), w * .56, SP * .62, 'LIVE　アンコール 5億回', { bg: '#12131c', neon: '#ff5aa8', font: FJ, k: .56 });
    c.fillStyle = '#2a1a1a'; c.fillRect(0, Y(.62), w, SP * .62); pkStripe(c, 0, Y(.62), w, 14, '#ffe14a', '#12131c', 40);
    for (const fx of [.18, .82]) { c.fillStyle = '#15161c'; c.fillRect(w * fx - 60, Y(2.2), 120, SP * 1.58); for (let k = 0; k < 2; k++) { c.fillStyle = '#3a3d48'; c.beginPath(); c.arc(w * fx, Y(1.8 - k * .7), 40, 0, 7); c.fill(); c.fillStyle = '#0a0a10'; c.beginPath(); c.arc(w * fx, Y(1.8 - k * .7), 20, 0, 7); c.fill(); } }   // スピーカー
  },
};
PK_DRAW.gap.alpha = 1;
const PK_ROW = [['ticket', 5], ['gap', 4, 'wheel'], ['popcorn', 4.5], ['door', 3], ['shateki', 6], ['gap', 5, 'merry'], ['door', 3], ['crepe', 4], ['gacha', 5], ['door', 3], ['gap', 5, 'coaster'], ['lost', 5], ['door', 3], ['photo', 5], ['gap', 4, 'wheel'],
  ['shateki', 6], ['door', 3], ['gacha', 5], ['door', 3], ['crepe', 4], ['gap', 4.5, 'merry'], ['stage', 14], ['gap', 6, 'coaster'], ['ticket', 5]];
function buildPark(env) {
  const K = kit345(), { add, lam, bas, box, plane, floor, glowP } = K, L = STAGE_END, WZ = -4.5, SW = .14;
  // ---- 地面: 市松もようの石だたみ ----
  const pave = canvasTex(256, 256, (c, w, h) => {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { c.fillStyle = (i + j) % 2 ? '#6a5080' : '#7a6090'; c.fillRect(i * 64, j * 64, 64, 64); }
    for (let i = 0; i < 1400; i++) { c.fillStyle = `rgba(${rnd(0, 255) | 0},${rnd(0, 255) | 0},${rnd(100, 255) | 0},.12)`; c.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    for (let i = 0; i < 26; i++) { c.fillStyle = pick(['#ff5aa8', '#ffe14a', '#7fe9ff', '#b8ff5a']); c.globalAlpha = .7; c.fillRect(Math.random() * w, Math.random() * h, 6, 3); } c.globalAlpha = 1;   // 落ちている紙ふぶき
    c.strokeStyle = 'rgba(0,0,0,.2)'; c.lineWidth = 2; for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, h); c.stroke(); c.beginPath(); c.moveTo(0, i * 64); c.lineTo(w, i * 64); c.stroke(); }
  }, [40, 1]);
  floor(180, 4.5, new T.MeshLambertMaterial({ map: pave }), L / 2, 0, -.1);
  const tile = canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#9a80a8'; c.fillRect(0, 0, w, h); c.strokeStyle = '#6a5080'; c.lineWidth = 4; c.strokeRect(0, 0, w, h); c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke(); }, [90, 1]);
  box(180, SW, 2.2, new T.MeshLambertMaterial({ map: tile }), L / 2, SW / 2, -3.45);
  // 手前: 芝生と花だん、白い柵
  const grass = canvasTex(256, 128, (c, w, h) => { c.fillStyle = '#2a5a3a'; c.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${40 + rnd(0, 40) | 0},${110 + rnd(0, 70) | 0},${60 + rnd(0, 30) | 0},.7)`; c.fillRect(Math.random() * w, Math.random() * h, 2, 5); } for (let i = 0; i < 46; i++) { c.fillStyle = pick(['#ff5aa8', '#ffe14a', '#fff', '#ff8a1f', '#c77ae8']); c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 3.5, 0, 7); c.fill(); } }, [40, 1]);
  box(180, .1, 2.5, new T.MeshLambertMaterial({ map: grass }), L / 2, .02, 3.4);
  const wm = lam(0xfff6fb, 0x302830);
  for (let x = -12; x < L + 10; x += 6) { box(4.6, .06, .05, wm, x + 2.3, .5, 2.55); box(4.6, .06, .05, wm, x + 2.3, .26, 2.55); for (let k = 0; k <= 6; k++) box(.07, .62, .07, wm, x + k * 4.6 / 6, .31, 2.55); }
  // ---- 屋台の並び。あいだの柵の向こうに、乗りもの ----
  const rides = [];
  wallRow345(PK_ROW, PK_DRAW, -14.5, K, { z: WZ, y0: SW, labels: PK_LABELS, doorText: ['閉園', 'CLOSED', 'おばけ', 'STAFF'], doorCol: ['#6a4a7a', '#5a5a7a', '#3a3a4a', '#7a5a6a'], lit: 0xff8ac0,
    walls: ['#3a2a52', '#2a3a5a', '#4a2a4a', '#2a2a4a'], kinds: ['wood', 'brick', 'wood', 'plaster'], each: (type, x, W, cx, arg) => { if (type === 'gap') rides.push([arg, cx, W]); } });
  // 遠くの影絵（山・城・テント）と夜空
  sky345(K, '#0a0618', '#2a1248', '#5a2a6a', (c, w, h) => {
    c.fillStyle = '#160a28'; let x = 0; while (x < w) { const bw = rnd(60, 150), bh = rnd(40, 110); c.beginPath(); c.moveTo(x, h); c.lineTo(x + bw / 2, h - bh); c.lineTo(x + bw, h); c.fill(); x += bw * .7; }
    for (let i = 0; i < 300; i++) { c.fillStyle = pick(['rgba(255,225,74,.6)', 'rgba(255,90,168,.6)', 'rgba(127,233,255,.6)']); c.fillRect(Math.random() * w, h - Math.random() * 90, 3, 3); }
  });
  plane(240, 9, bas(0x1c1030), L / 2, 4.5, -11);
  const ridesG = [];
  for (const [kind, cx, W] of rides) {
    const g = new T.Group(); g.position.set(cx, SW, 0); stage.add(g);
    if (kind === 'wheel') {   // 観覧車
      const R = 2.5, CY = 2.75, Z = -7.2, hub = new T.Group(); hub.position.set(0, CY, Z); g.add(hub);
      const rim = new T.Mesh(new T.TorusGeometry(R, .06, 6, 36), bas(0xff5aa8)); hub.add(rim); const rim2 = new T.Mesh(new T.TorusGeometry(R * .62, .04, 6, 28), bas(0x7fe9ff)); hub.add(rim2);
      for (let i = 0; i < 8; i++) { const sp = new T.Mesh(new T.BoxGeometry(R * 2, .04, .04), bas(0xfff6fb)); sp.rotation.z = i * Math.PI / 8; hub.add(sp); }
      const gon = []; for (let i = 0; i < 8; i++) { const b = box(.5, .46, .4, bas([0xffe14a, 0x7fe9ff, 0xff8a1f, 0xb8ff5a][i % 4]), 0, 0, Z + .1, g); box(.34, .18, .02, bas(0x1a1030), 0, .04, .21, b); gon.push(b); }
      for (const sd of [-1, 1]) { const leg = box(.12, 3.2, .12, bas(0x8a7aa0), sd * .9, 1.45, Z - .2, g); leg.rotation.z = -sd * .3; }
      glowP(8, 8, 0xff5aa8, .22, 0, CY, Z - .3, g);
      ridesG.push((dt) => { hub.rotation.z += dt * .35; for (let i = 0; i < 8; i++) { const a = hub.rotation.z + i * Math.PI / 4; gon[i].position.set(Math.cos(a) * R, CY + Math.sin(a) * R - .3, Z + .1); } });
    } else if (kind === 'merry') {   // メリーゴーラウンド
      const Z = -6.6, sp = new T.Group(); sp.position.set(0, 0, Z); g.add(sp);
      const top = new T.Mesh(new T.ConeGeometry(1.9, .9, 12), new T.MeshLambertMaterial({ map: canvasTex(256, 32, (c, w, h) => pkStripe(c, 0, 0, w, h, '#ff5aa8', '#fff6fb', 12)), emissive: 0x402030 })); top.position.y = 3.1; sp.add(top);
      const base = new T.Mesh(new T.CylinderGeometry(1.9, 1.9, .22, 20), lam(0xffe14a, 0x403000)); base.position.y = .11; sp.add(base);
      box(.2, 2.6, .2, lam(0xfff6fb, 0x303030), 0, 1.4, 0, sp);
      const hs = []; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3, h = new T.Group(); h.position.set(Math.cos(a) * 1.45, 1.1, Math.sin(a) * 1.45); h.rotation.y = -a; sp.add(h); box(.04, 2.3, .04, lam(0xffe14a), 0, .25, 0, h); box(.2, .34, .62, lam([0xfff6fb, 0x7fe9ff, 0xff8ac0][i % 3], 0x202020), 0, 0, 0, h); box(.16, .3, .2, lam(0xfff6fb, 0x202020), 0, .26, .3, h); hs.push(h); }
      glowP(7, 5, 0xffe14a, .2, 0, 1.8, Z - .4, g);
      ridesG.push((dt) => { sp.rotation.y += dt * .7; hs.forEach((h, i) => { h.position.y = 1.1 + Math.sin(gameTime * 2.2 + i * 2.1) * .25; }); });
    } else {   // コースター（山を上っては落ちる）
      const Z = -7, pts = []; for (let i = 0; i <= 40; i++) { const u = i / 40, x = (u - .5) * (W + 4); pts.push(new T.Vector3(x, 1.3 + Math.sin(u * Math.PI * 2 + 1) * 1.1 + Math.sin(u * Math.PI * 5) * .25, Z)); }
      const curve = new T.CatmullRomCurve3(pts), tube = new T.Mesh(new T.TubeGeometry(curve, 60, .05, 5), bas(0x7fe9ff)); g.add(tube);
      for (let i = 0; i <= 10; i++) { const p = curve.getPoint(i / 10); box(.07, p.y, .07, bas(0x6a5a88), p.x, p.y / 2, Z - .1, g); }
      const cars = [0, 1, 2].map((k) => box(.5, .3, .34, bas([0xff5aa8, 0xffe14a, 0xb8ff5a][k]), 0, 0, Z + .05, g));
      const st = { u: Math.random(), v: .2 };
      ridesG.push((dt) => { const p0 = curve.getPoint(st.u), sl = curve.getTangent(st.u).y; st.v = clamp(st.v - sl * dt * .9, .07, .55); st.u = (st.u + st.v * dt) % 1; cars.forEach((cb, k) => { const u = (st.u - k * .035 + 1) % 1, p = curve.getPoint(u), tg = curve.getTangent(u); cb.position.set(p.x, p.y + .2, Z + .05); cb.rotation.z = Math.atan2(tg.y, tg.x); }); });
    }
    g.userData.cx = cx;
  }
  stageAnim.push((dt) => { for (const fn of ridesG) fn(dt); });
  // ---- 街灯と、あいだに張った電球 ----
  const bulbs = [];
  for (let lx = -6; lx < L + 12; lx += 9) {
    box(.1, 3.6, .1, lam(0xfff6fb, 0x302830), lx, 1.8, -2.72); const lp = add(new T.Mesh(new T.SphereGeometry(.2, 12, 8), bas(0xfff2c4))); lp.position.set(lx, 3.7, -2.72);
    glowP(4.2, 3.2, 0xffd8f0, .2, lx, .02, -1.5).rotation.x = -Math.PI / 2;
    for (let k = 1; k < 12; k++) { const u = k / 12, b = add(new T.Mesh(new T.SphereGeometry(.07, 8, 6), bas([0xffe14a, 0xff5aa8, 0x7fe9ff, 0xb8ff5a][k % 4]))); b.position.set(lx + u * 9, 3.6 - Math.sin(u * Math.PI) * .55, -2.72); bulbs.push(b); }
    const bl = add(new T.Mesh(new T.SphereGeometry(.22, 12, 10), lam([0xe83a4a, 0x4fa8ff, 0xffe14a][((lx + 6) / 9 | 0) % 3], 0x301010))); bl.scale.y = 1.2; bl.position.set(lx + .35, 2.5, -2.6); box(.012, 1.1, .012, bas(0xffffff), lx + .2, 1.9, -2.66).rotation.z = -.28;   // 柱につないだ風船
  }
  stageAnim.push(() => { const k = Math.floor(gameTime * 3); bulbs.forEach((b, i) => { b.scale.setScalar((i + k) % 3 ? 1 : 1.6); }); });
  // ---- 舞台の照明（大ボスのところ）----
  const spots = [];
  for (const [sx, col] of [[75.5, 0xff5aa8], [80.5, 0x7fe9ff], [85.5, 0xffe14a]]) { const cn = new T.Mesh(new T.ConeGeometry(1.1, 4.2, 16, 1, true), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: .13, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false })); cn.geometry.translate(0, -2.1, 0); cn.position.set(sx, 4.1, -3.6); stage.add(cn); spots.push(cn); }
  stageAnim.push(() => { spots.forEach((s, i) => { s.rotation.z = Math.sin(gameTime * 1.3 + i * 2) * .35; s.rotation.x = .25 + Math.sin(gameTime * .9 + i) * .12; }); });
  // 屋台の前の小物（たる・ベンチ・ごみ箱）
  for (const bx of [-2, 17.5, 40.5, 58.5, 71]) { box(1.4, .08, .4, lam(0xff8ac0), bx, SW + .44, -3.85); box(1.4, .44, .06, lam(0xff8ac0), bx, SW + .72, -4.02); for (const dx of [-.55, .55]) box(.06, .42, .34, lam(0xfff6fb), bx + dx, SW + .21, -3.85); }
  stageBase(env);
}
// =========================================================================================
// 5 面: 何もない空間（どこまでも続くタイルの床。扉だけが立っている。遠くに、数字と、もう 1 人の自分）
// =========================================================================================
const VD_DOORS = ['出口', '出口？', '出口（うそ）', '実家', '来世', '月曜日', '夢オチ', '現実', 'セーブ地点', '控え室'];
const VD_SIGNS = [[1.5, ['あと 4億9999万', '9999年（たぶん）']], [17, ['← 何もない', '何もない →']], [21.5, ['このへんで', '1万年すごした']], [36, ['ここで泣いた', 'ここでも泣いた']], [39.5, ['折り返し地点', '（うそ）']], [54.5, ['素数を数えた', '跡地']], [57, ['あと 5分', '※5億年前の看板']], [71.5, ['自分と会話', 'しはじめた地点']], [74, ['この先', '自分']], [88.5, ['おつかれさま', 'でした（まだ）']]];
function buildVoid(env) {
  const K = kit345(), { add, lam, bas, box, plane, floor, glowP } = K, L = STAGE_END;
  // ---- 床: どこまでもタイル ----
  const tile = canvasTex(256, 256, (c, w, h) => {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const v = 128 + ((i * 7 + j * 13) % 3) * 9; c.fillStyle = `rgb(${v},${v + 5},${v + 18})`; c.fillRect(i * 128, j * 128, 128, 128); }
    for (let i = 0; i < 700; i++) { c.fillStyle = `rgba(255,255,255,${rnd(0, .07)})`; c.fillRect(Math.random() * w, Math.random() * h, rnd(2, 10), rnd(2, 10)); }
    c.strokeStyle = '#2c3040'; c.lineWidth = 7; for (let i = 0; i <= 2; i++) { c.beginPath(); c.moveTo(i * 128, 0); c.lineTo(i * 128, h); c.stroke(); c.beginPath(); c.moveTo(0, i * 128); c.lineTo(w, i * 128); c.stroke(); }
  }, [210, 60]);
  floor(420, 120, new T.MeshLambertMaterial({ map: tile }), L / 2, 0, -34);
  for (const z of [Z_MIN - .28, Z_MAX + .38]) floor(260, .05, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .28 }), L / 2, .012, z);   // 戦う場所のふち（うっすら）
  // ---- 立っているだけの扉（敵が出てくる）----
  const frameM = lam(0xe8ecf4, 0x30323a), DX = [4.5, 12.5, 23.5, 31, 42.5, 50, 59.5, 67, 76.5, 84.5];
  DX.forEach((x, i) => {
    const z = -4.42, w = 1.7, h = 2.5;
    box(.16, h + .16, .2, frameM, x - w / 2 - .08, (h + .16) / 2, z); box(.16, h + .16, .2, frameM, x + w / 2 + .08, (h + .16) / 2, z); box(w + .32, .16, .2, frameM, x, h + .08, z); box(w + .5, .08, .5, frameM, x, .04, z + .1);
    plane(w, h, bas(0x020204), x, h / 2, z - .04);
    addDoor345(x, z, 0, K, { w, h, lit: 0xc9b6ff, label: VD_DOORS[i], draw: (c, cw, ch) => {
      c.fillStyle = ['#d8dce8', '#c8b8a0', '#b8c8d8', '#d8c8d8'][i % 4]; c.fillRect(0, 0, cw, ch); c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 6; c.strokeRect(22, 22, cw - 44, ch * .4); c.strokeRect(22, ch * .5, cw - 44, ch * .42);
      c.fillStyle = '#c9a227'; c.beginPath(); c.arc(cw - 44, ch * .52, 13, 0, 7); c.fill(); c.strokeStyle = '#20222c'; c.lineWidth = 8; c.strokeRect(0, 0, cw, ch);
    } });
    const pl = canvasTex(256, 80, (c, cw, ch) => { c.fillStyle = '#10121c'; c.fillRect(0, 0, cw, ch); c.strokeStyle = '#2bff8a'; c.lineWidth = 5; c.strokeRect(4, 4, cw - 8, ch - 8); c.fillStyle = '#2bff8a'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, VD_DOORS[i], cw / 2, ch / 2 + 3, cw - 24, 46); });
    plane(1.3, .4, new T.MeshBasicMaterial({ map: pl, fog: false }), x, h + .44, z + .12);
  });
  // ---- 街灯（光のたまりだけが、ぽつぽつ続く）----
  for (let lx = -4; lx < L + 14; lx += 9.5) {
    box(.07, 3.5, .07, lam(0x8a90a0), lx, 1.75, -3.05); const lp = add(new T.Mesh(new T.SphereGeometry(.15, 12, 8), bas(0xffffff))); lp.position.set(lx, 3.5, -3.05);
    glowP(1.6, 1.6, 0xe8ecff, .5, lx, 3.5, -3.04); glowP(5, 3.6, 0xe8ecff, .2, lx, .02, -1.6).rotation.x = -Math.PI / 2;
  }
  // ---- 立て札 ----
  for (const [x, lines] of VD_SIGNS) {
    box(.08, 1.3, .08, lam(0x8a6a4a), x, .65, -3.5);
    const t = canvasTex(256, 144, (c, w, h) => { c.fillStyle = '#e8dcc0'; c.fillRect(0, 0, w, h); c.strokeStyle = '#6a4a2a'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8); c.fillStyle = '#1a1410'; c.textAlign = 'center'; c.textBaseline = 'middle'; const lh = (h - 20) / lines.length; lines.forEach((s, i) => fitText(c, s, w / 2, 10 + lh * (i + .5) + 2, w - 28, lh * .68)); });
    const m = box(1.3, .74, .05, [lam(0x8a6a4a), lam(0x8a6a4a), lam(0x8a6a4a), lam(0x8a6a4a), new T.MeshBasicMaterial({ map: t }), lam(0x8a6a4a)], x, 1.5, -3.46); m.rotation.z = rnd(-.06, .06);
  }
  // ---- 床の落書き（日数を数えた「正」の字。途中であきらめている）----
  const tally = canvasTex(512, 256, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = 'rgba(20,22,34,.72)'; c.font = '900 44px "Noto Sans JP", sans-serif'; for (let j = 0; j < 4; j++) for (let i = 0; i < 9; i++) if (j < 3 || i < 4) c.fillText('正', 14 + i * 54 + rnd(-3, 3), 52 + j * 56 + rnd(-3, 3)); c.font = 'bold 30px "Noto Sans JP", sans-serif'; c.fillText('…もういいや', 250, 236); });
  for (const [tx, tz, r] of [[6, 3.1, .1], [33.5, 3.2, -.08], [62, 3.0, .05], [20, -2.9, 0], [70, -2.95, .04]]) { const m = floor(3.2, 1.6, new T.MeshBasicMaterial({ map: tally, transparent: true, depthWrite: false }), tx, .014, tz); m.rotation.z = r; }
  // ---- 宙に浮くタイル ----
  const fl = [], fm = lam(0xb8bcd0, 0x20222c);
  for (let i = 0; i < 46; i++) { const m = box(rnd(.6, 1.1), .06, rnd(.6, 1.1), fm, rnd(-20, L + 20), rnd(.4, 7), rnd(-20, -6)); m.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6)); fl.push([m, rnd(.08, .3), rnd(-.4, .4)]); }
  stageAnim.push((dt) => { for (const [m, v, w] of fl) { m.position.y += v * dt; m.rotation.x += w * dt; m.rotation.z += w * .7 * dt; if (m.position.y > 8) m.position.y = .2; } });
  // ---- 残りの年数（数えるのが、ときどきおかしい）----
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 128; const ct = new T.CanvasTexture(cv); ct.colorSpace = T.SRGBColorSpace;
  const board = plane(9, 1.125, new T.MeshBasicMaterial({ map: ct, transparent: true, fog: false, opacity: .8 }), 0, 2.15, -9.5);
  const CN = { y: 499999999, d: 364, t: 0, note: '', nt: 0 };
  stageAnim.push((dt) => {
    board.position.x = G.camX * .9 + 4;
    CN.t -= dt; CN.nt -= dt; if (CN.t > 0) return; CN.t = CN.fin ? .045 : .12;
    if (CN.fin) { CN.y = CN.y > 3 ? Math.floor(CN.y * .55) : 0; CN.d = CN.y ? Math.floor(Math.random() * 365) : 0; CN.note = CN.y ? '' : '満了！　おつかれさまでした'; CN.nt = 9; }   // 5 面クリア: いっきに 0 まで
    else CN.d -= 1;
    if (!CN.fin && CN.d < 0) { CN.d = 364; CN.y -= 1; if (Math.random() < .3) { CN.y += 2; CN.note = '（数えまちがい ＋2年）'; CN.nt = 2.5; } }
    if (CN.nt <= 0) CN.note = '';
    const c = cv.getContext('2d'); c.clearRect(0, 0, 1024, 128); c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillStyle = 'rgba(232,236,255,.9)'; c.font = '400 76px "Bungee", "Noto Sans JP", sans-serif';
    c.fillText(CN.y.toLocaleString('en-US'), 150, 54); c.font = 'bold 40px "Noto Sans JP", sans-serif'; c.fillText('のこり', 10, 56); c.fillText(`年 ${String(CN.d).padStart(3, '0')}日`, 720, 60);
    if (CN.note) { c.fillStyle = '#ff6a8a'; c.font = 'bold 30px "Noto Sans JP", sans-serif'; c.fillText(CN.note, 150, 108); }
    ct.needsUpdate = true;
  });
  // ---- 遠くを歩いている、もう 1 人の自分（たち）----
  const sil = canvasTex(64, 160, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = '#c8ccd8'; c.beginPath(); c.arc(32, 22, 15, 0, 7); c.fill(); c.fillRect(20, 38, 24, 62); c.fillRect(20, 98, 10, 58); c.fillRect(34, 98, 10, 58); c.fillRect(10, 42, 9, 50); c.fillRect(45, 42, 9, 50); });
  const walkers = [];
  for (let i = 0; i < 7; i++) { const m = plane(.7, 1.75, new T.MeshBasicMaterial({ map: sil, transparent: true, opacity: .22, depthWrite: false }), rnd(-10, L + 10), .88, rnd(-17, -8)); walkers.push([m, pick([-1, 1]) * rnd(.3, .8), rnd(0, 6)]); }
  stageAnim.push((dt) => { for (const w of walkers) { const m = w[0]; m.position.x += w[1] * dt; m.position.y = .88 + Math.abs(Math.sin(gameTime * 3 + w[2])) * .04; if (m.position.x < G.camX - 26) m.position.x = G.camX + 26; if (m.position.x > G.camX + 26) m.position.x = G.camX - 26; } });
  // ---- 終点: 巨大な 5億年ボタン ----
  const BX = L + 4, BZ = -7.5;
  const bs = add(new T.Mesh(new T.CylinderGeometry(3.4, 3.6, .9, 32), new T.MeshLambertMaterial({ map: canvasTex(512, 64, (c, w, h) => hazard(c, 0, 0, w, h, 40), [6, 1]) }))); bs.position.set(BX, .45, BZ);
  const dome = add(new T.Mesh(new T.SphereGeometry(2.9, 32, 16, 0, 6.2832, 0, 1.5708), new T.MeshLambertMaterial({ color: 0xff2030, emissive: 0x7a0a12 }))); dome.position.set(BX, .9, BZ); dome.scale.y = .62;
  const halo = glowP(14, 9, 0xff2030, .35, BX, 2, BZ - .5);
  const bt = canvasTex(512, 128, (c, w, h) => { c.fillStyle = '#10121c'; c.fillRect(0, 0, w, h); c.strokeStyle = '#ffce4a'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, '5億年ボタン', w / 2, h * .38, w - 40, 60, FD, '400'); c.fillStyle = '#ffce4a'; fitText(c, '押すと 100万円', w / 2, h * .78, w - 40, 30); });
  plane(4.4, 1.1, new T.MeshBasicMaterial({ map: bt, fog: false }), BX - 1, 3.3, BZ + 3.2);
  stageAnim.push(() => { const k = .5 + .5 * Math.sin(gameTime * 2); dome.material.emissive.setRGB(.3 + k * .3, .03, .05); halo.material.opacity = .22 + k * .2; });
  voidFx = { CN, dome, BX, BZ };
  stageBase(env);
}
function buildStage(theme = 'street') {
  voidFx = null;
  const env = stageWipe(theme);
  if (theme === 'factory') return buildFactory(env);
  if (theme === 'station') return buildStation(env);
  if (theme === 'park') return buildPark(env);
  if (theme === 'void') return buildVoid(env);
  // 道路
  const road = canvasTex(512, 256, (x, w, h) => {
    x.fillStyle = '#23263a'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = 30 + Math.random() * 30; x.fillStyle = `rgba(${v},${v},${v + 12},.5)`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    x.fillStyle = 'rgba(255,206,74,.75)'; for (let i = 0; i < 4; i++) x.fillRect(i * 128 + 20, h * 0.55, 70, 6);
    x.fillStyle = 'rgba(255,255,255,.1)'; x.fillRect(0, h - 10, w, 4);
  }, [30, 1]);
  const ground = new T.Mesh(new T.PlaneGeometry(180, 4.5), new T.MeshLambertMaterial({ map: road }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(STAGE_END / 2, 0, -0.1); stage.add(ground);
  // 奥の歩道と手前の歩道
  const tiles = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#4a4f68'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#353a52'; x.lineWidth = 4;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, h); x.stroke(); x.beginPath(); x.moveTo(0, i * 64); x.lineTo(w, i * 64); x.stroke(); }
  }, [90, 1]);
  const walkB = new T.Mesh(new T.BoxGeometry(180, 0.14, 2.2), new T.MeshLambertMaterial({ map: tiles }));
  walkB.position.set(STAGE_END / 2, 0.07, -3.45); stage.add(walkB);
  const walkF = new T.Mesh(new T.BoxGeometry(180, 0.1, 2.5), new T.MeshLambertMaterial({ map: tiles }));
  walkF.position.set(STAGE_END / 2, 0.02, 3.4); stage.add(walkF);
  // 建物の並び
  let x = -22;
  let si = 0;
  while (x < STAGE_END + 26) {
    const w = rnd(3.4, 6.2), h = rnd(5, 13), d = 3;
    const base = pick(['#1b1f3a', '#231a36', '#16263a', '#2a1c2e', '#1d2233']);
    const lit = pick(['255,214,140', '140,230,255', '255,160,200']);
    const tex = canvasTex(256, 512, (c, cw, ch) => {
      c.fillStyle = base; c.fillRect(0, 0, cw, ch);
      const cols = Math.max(2, Math.round(w * 0.9)), rows = Math.round(h * 1.1);
      const ww = cw / cols, hh = ch / rows;
      for (let r = 0; r < rows - 1; r++) for (let q = 0; q < cols; q++) {
        const on = Math.random() < 0.42;
        c.fillStyle = on ? `rgba(${lit},${rnd(.55, .95)})` : 'rgba(10,14,30,.9)';
        c.fillRect(q * ww + ww * 0.2, r * hh + hh * 0.22, ww * 0.6, hh * 0.52);
      }
      c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(0, ch - hh * 1.3, cw, hh * 1.3);   // 1階はシャッター
      c.fillStyle = 'rgba(255,255,255,.05)'; for (let i = 0; i < ch; i += 6) c.fillRect(0, ch - hh * 1.2 + (i % (hh * 1.2)), cw, 1);
    });
    const b = new T.Mesh(new T.BoxGeometry(w - 0.15, h, d), [
      new T.MeshBasicMaterial({ color: base }), new T.MeshBasicMaterial({ color: base }),
      new T.MeshBasicMaterial({ color: '#0d1024' }), new T.MeshBasicMaterial({ color: base }),
      new T.MeshBasicMaterial({ map: tex }), new T.MeshBasicMaterial({ color: base }),
    ]);
    b.position.set(x + w / 2, h / 2, -6.1); stage.add(b);
    // 看板（ネオン）
    if (Math.random() < 0.8) {
      const name = SIGNS[si++ % SIGNS.length], col = pick(NEON), vert = Math.random() < 0.5;
      const sw = vert ? 128 : 512, sh = vert ? 512 : 128;
      const st = canvasTex(sw, sh, (c) => {
        c.fillStyle = 'rgba(8,10,22,.92)'; c.fillRect(0, 0, sw, sh);
        c.strokeStyle = col; c.lineWidth = 8; c.shadowColor = col; c.shadowBlur = 20; c.strokeRect(10, 10, sw - 20, sh - 20);
        c.fillStyle = '#fff'; c.shadowBlur = 26; c.textAlign = 'center'; c.textBaseline = 'middle';
        if (vert) { const chars = [...name.replace(/\s/g, '')].slice(0, 6); c.font = `bold ${Math.min(74, 420 / chars.length)}px "Noto Sans JP", sans-serif`; chars.forEach((ch, i) => c.fillText(ch, sw / 2, 44 + (i + 0.5) * (sh - 88) / chars.length)); }
        else { c.font = `bold ${Math.min(68, 900 / name.length)}px "Noto Sans JP", sans-serif`; c.fillText(name, sw / 2, sh / 2 + 4); }
      });
      const sm = new T.Mesh(new T.PlaneGeometry(vert ? 0.75 : 3, vert ? 3 : 0.75), new T.MeshBasicMaterial({ map: st, transparent: true, fog: false }));
      sm.position.set(x + w / 2 + (vert ? rnd(-w / 3, w / 3) : 0), vert ? rnd(3, Math.min(6, h - 1.6)) : rnd(2.4, Math.min(5, h - 0.8)), -4.55); stage.add(sm);
      const glow = new T.Mesh(new T.PlaneGeometry(vert ? 2.4 : 5, vert ? 4.4 : 2.2), new T.MeshBasicMaterial({ map: radialTex, color: col, transparent: true, opacity: .28, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
      glow.position.copy(sm.position); glow.position.z -= 0.02; stage.add(glow);
    }
    x += w;
  }
  // 遠くの街並み（シルエット）
  const sky = canvasTex(2048, 512, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#060818'); g.addColorStop(.7, '#1b1340'); g.addColorStop(1, '#3a1a4a');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 200; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * .7})`; c.fillRect(Math.random() * w, Math.random() * h * .5, 2, 2); }
    let xx = 0; c.fillStyle = '#0c0a22';
    while (xx < w) { const bw = rnd(40, 120), bh = rnd(90, 330); c.fillRect(xx, h - bh, bw, bh); xx += bw + rnd(2, 12); }
    c.fillStyle = 'rgba(255,206,74,.35)'; for (let i = 0; i < 400; i++) c.fillRect(Math.random() * w, h - Math.random() * 280, 3, 4);
  });
  const skyM = new T.Mesh(new T.PlaneGeometry(260, 60), new T.MeshBasicMaterial({ map: sky, fog: false }));
  skyM.position.set(STAGE_END / 2, 22, -40); stage.add(skyM);
  // 街灯・自販機
  for (let lx = -6; lx < STAGE_END + 10; lx += 9) {
    const pole = new T.Mesh(new T.CylinderGeometry(0.06, 0.08, 4.2, 8), new T.MeshLambertMaterial({ color: 0x3a4060 }));
    pole.position.set(lx, 2.1, -2.75); stage.add(pole);
    const arm = new T.Mesh(new T.BoxGeometry(0.9, 0.06, 0.06), pole.material); arm.position.set(lx + 0.42, 4.15, -2.75); stage.add(arm);
    const lamp = new T.Mesh(new T.SphereGeometry(0.16, 12, 8), new T.MeshBasicMaterial({ color: 0xfff2c4 })); lamp.position.set(lx + 0.85, 4.05, -2.75); stage.add(lamp);
    const pool = new T.Mesh(new T.PlaneGeometry(4.2, 3.2), new T.MeshBasicMaterial({ map: radialTex, color: 0xffe1a0, transparent: true, opacity: .22, depthWrite: false, blending: T.AdditiveBlending }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(lx + 0.85, 0.02, -1.4); stage.add(pool);
    if (false) {   // 自販機は「しかけ」として置く（殴ると飲み物が出る）
      const vend = new T.Mesh(new T.BoxGeometry(0.9, 1.85, 0.7), [
        new T.MeshLambertMaterial({ color: 0xd8dde8 }), new T.MeshLambertMaterial({ color: 0xd8dde8 }), new T.MeshLambertMaterial({ color: 0xd8dde8 }), new T.MeshLambertMaterial({ color: 0xd8dde8 }),
        new T.MeshBasicMaterial({ map: canvasTex(128, 256, (c, w, h) => {
          c.fillStyle = pick(['#d8354a', '#2a6fd6', '#1fa37c']); c.fillRect(0, 0, w, h);
          c.fillStyle = '#e8f6ff'; c.fillRect(10, 14, w - 20, h * .5);
          for (let r = 0; r < 3; r++) for (let q = 0; q < 4; q++) { c.fillStyle = pick(NEON); c.fillRect(16 + q * 25, 22 + r * 40, 16, 30); }
          c.fillStyle = '#111'; c.fillRect(w * .3, h * .78, w * .4, 18);
        }) }), new T.MeshLambertMaterial({ color: 0xd8dde8 })]);
      vend.position.set(lx + 3.5, 0.95 + 0.14, -3.3); stage.add(vend);
    }
  }
  // 終点: 5億年ボタン工場の門
  const gateTex = canvasTex(1024, 512, (c, w, h) => {
    c.fillStyle = '#15182c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2c3150'; for (let i = 0; i < h; i += 18) c.fillRect(40, 150 + i, w - 80, 9);
    c.fillStyle = '#FFCE4A'; c.fillRect(0, 0, w, 120);
    c.fillStyle = '#070A14'; c.font = 'bold 76px "Noto Sans JP", sans-serif'; c.textAlign = 'center'; c.fillText('5億年ボタン工場', w / 2, 86);
    c.fillStyle = '#FF3D6E'; c.beginPath(); c.arc(w / 2, 330, 90, 0, 7); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 44px "Bungee", sans-serif'; c.fillText('PUSH', w / 2, 346);
  });
  const gate = new T.Mesh(new T.PlaneGeometry(10, 5), new T.MeshBasicMaterial({ map: gateTex, fog: false }));
  gate.position.set(VS_X + 0.5, 2.5, -4.58); stage.add(gate);
  streetDress();
  stageBase(env);
}
Promise.race([Promise.all([document.fonts.load('bold 40px "Noto Sans JP"'), document.fonts.load('40px "Bungee"'), document.fonts.load('40px "Dela Gothic One"')]), new Promise(r => setTimeout(r, 1800))]).catch(() => {}).then(() => buildStage('street'));

// =========================================================================================
// 効果音と BGM（WebAudio でその場で合成）
// =========================================================================================
let AC = null, master = null, bgmGain = null, bgmOn = true, bgmTimer = 0, bgmStep = 0, bgmNext = 0;
function ac() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    // 音を重ねても割れないように、出口に音量をならす装置を入れる（そのぶん全体は大きめに鳴らす）
    const comp = AC.createDynamicsCompressor(); comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.14; comp.connect(AC.destination);
    master = AC.createGain(); master.gain.value = 0.7; master.connect(comp);
    bgmGain = AC.createGain(); bgmGain.gain.value = 0.11; bgmGain.connect(master);
    setTimeout(decodeSamples, 0);   // 読んでおいた効果音を鳴らせる形に直す
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
let noiseBuf = null;
function noise() { const c = ac(); if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } const s = c.createBufferSource(); s.buffer = noiseBuf; return s; }
function env(g, t, a, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
function tone(type, f0, f1, dur, vol, out = master, when = 0) {
  const c = ac(), t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, 0.005, vol, dur); o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
}
function burst(freq, q, dur, vol, type = 'bandpass', out = master) {
  const c = ac(), t = c.currentTime, s = noise(), f = c.createBiquadFilter(), g = c.createGain();
  f.type = type; f.frequency.value = freq; f.Q.value = q; env(g, t, 0.003, vol, dur);
  s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
// フィルターの高さを動かしながら鳴らす雑音（風を切る音・溜める音）
function sweep(f0, f1, q, dur, vol, type = 'bandpass', when = 0) {
  const c = ac(), t = c.currentTime + when, s = noise(), f = c.createBiquadFilter(), g = c.createGain();
  f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  env(g, t, 0.004, vol, dur); s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
const rp = (f, a = .08) => f * (1 + (Math.random() * 2 - 1) * a);   // 毎回すこしだけ音の高さを変える（同じ音の連打に聞こえないように）
const notes = (type, list, step, len, vol, when = 0) => list.forEach((f, i) => f && tone(type, f, 0, len, vol, master, when + i * step));
// ---- 録音された効果音（sounds/brawl/ の WAV。tools/brawl_sounds_build.py で game_sound から作る）----
// 名前: 何個あるか（名前+番号.wav）。ファイルが無い音・読めなかった音は、下の合成音がそのまま鳴る
const SMP_N = { sw: 8, swh: 6, wh: 4, air: 3, imp: 16, body: 2, armor: 1, en: 6, mtl: 3, cling: 3, thud: 6, tap: 3, step: 6, ex: 6, exb: 3, robo: 4, glass: 4, brk: 3, chg: 2, swoosh: 1, warp: 1, shot: 5, shotb: 2, coin: 3, fw: 3, wood: 4, pipe: 4, rock: 4, can: 4, crack: 2, gun: 3, rkt: 2, thunder: 3, magic: 3, blink: 1, pow: 1, stab: 1, fanf: 2, win: 1, lose: 1, click: 1, btn: 1, jump: 2, pop: 3 };
const HIT_L = [1, 2, 6, 7, 12, 14, 16], HIT_H = [3, 4, 5, 8, 9, 10, 11, 13, 15];   // 当たる音のうち、軽いもの / 重いもの
const SMP = {}, smpRaw = [];
let smpVol = 1;
async function loadSamples() {
  const cfg = MOTION_CFG.sounds || {}; if (cfg.off) return;
  if (WEB && WEB.sfx) { smpVol = +cfg.volume > 0 ? +cfg.volume : 1; return loadSfxSprite(); }
  const dir = String(cfg.dir || './sounds/brawl').replace(/[\\/]+$/, ''); smpVol = +cfg.volume > 0 ? +cfg.volume : 1;
  const jobs = [];
  for (const [name, n] of Object.entries(SMP_N)) for (let i = 1; i <= n; i++)
    jobs.push(fetch(fileURL(dir + '/' + name + i + '.wav')).then(r => r.ok ? r.arrayBuffer() : null).then(b => { if (b && b.byteLength > 44) smpRaw.push([name, i, b]); }).catch(() => {}));
  await Promise.all(jobs);
  log('効果音 ' + smpRaw.length + ' 個読み込み（' + dir + '）'); decodeSamples();
}
function decodeSamples() {   // 音を出す装置ができてから（＝最初の操作のあと）鳴らせる形に直す
  decodeSfxSprite();
  if (!AC || !smpRaw.length) return;
  for (const [name, i, buf] of smpRaw.splice(0)) AC.decodeAudioData(buf).then(b => { (SMP[name] ||= [])[i - 1] = b; }).catch(() => {});
}
// 録音された音を鳴らす（同じ音が続かないように毎回ちがう 1 個を選ぶ）。鳴らせなかったら false → 合成音で代用する
function smp(name, vol = 1, rate = 1, when = 0, only = null) {
  const all = SMP[name]; if (!AC || !all) return false;
  const list = (only ? only.map(i => all[i - 1]) : all).filter(Boolean); if (!list.length) return false;
  let b = list[(Math.random() * list.length) | 0]; if (list.length > 1 && b === all.last) b = list[(list.indexOf(b) + 1) % list.length]; all.last = b;
  const c = ac(), s = c.createBufferSource(), g = c.createGain(); s.buffer = b; s.playbackRate.value = rate; g.gain.value = vol * smpVol; s.connect(g); g.connect(master); s.start(c.currentTime + when);
  return true;
}
const sfx = {
  // ---- 振る ----（k: 0 = 軽いパンチ / 1 = 蹴り / 2 = 重い技。敵のぶんは少し小さく）
  swing(k, quiet) {
    const v = quiet ? .6 : 1;
    if (k === 0) { if (!smp('sw', 1.2 * v, rp(1.2, .1))) sweep(rp(1500), rp(3600), 1.5, .09, .7 * v); }
    else if (k === 1) { if (!smp('sw', 1.45 * v, rp(.9, .08))) sweep(rp(800), rp(3000), 1.2, .15, .85 * v); tone('sine', rp(220), 90, .1, .16 * v); }
    else {
      if (smp('swh', 1.6 * v, rp(1, .1))) smp('sw', 1.0 * v, rp(.72, .06));
      else { sweep(rp(420), rp(2400), 1.0, .24, 1.0 * v); sweep(rp(2500), rp(600), .8, .2, .4 * v, 'highpass'); }
      tone('sine', rp(170), 55, .22, .3 * v);
    }
  },
  whoosh(h) { this.swing(h ? 2 : 0); },
  // ---- 当たった ----（連続で当てるほど音が高くなる。metal = 相手がロボや機械）
  hit(big, combo = 0, metal = false) {
    const up = 1 + Math.min(10, combo) * .04;
    if (!big) {
      if (smp('imp', 1.9, rp(1.06, .07) * (1 + Math.min(10, combo) * .02), 0, HIT_L)) { if (metal) smp('mtl', .55, rp(1, .12)); }
      else { burst(rp(2600) * up, 1.4, .07, 1.2); burst(rp(750), .7, .11, 1.1, 'lowpass'); }
      tone('triangle', rp(250) * up, 70, .12, .8); tone('square', rp(1200) * up, 260, .035, .24);
    } else {
      if (smp('imp', 2.3, rp(.88, .06), 0, HIT_H)) { smp('body', 1.5, rp(.95, .05)); if (metal) smp('armor', .9, rp(.92, .08)); }
      else { burst(rp(3400), .9, .15, 1.3, 'highpass'); burst(rp(430), .6, .3, 1.6, 'lowpass'); tone('sawtooth', rp(320), 50, .18, .6); }
      tone('sine', rp(150), 30, .36, 1.6); tone('square', rp(950), 110, .07, .3);
      tone('triangle', rp(660) * up, 1320 * up, .12, .25, master, .03);
    }
  },
  // ---- やられた ----
  hurt(big) { tone('sawtooth', rp(430), 100, big ? .32 : .18, .45); tone('square', rp(215), 65, big ? .28 : .15, .28); if (!smp('thud', big ? 1.6 : 1.1, rp(1.25, .08))) burst(620, .8, .13, .8); },
  low() { notes('square', [880, 0, 880, 0, 880], .09, .08, .25); },                 // 体力が危ない
  down(boss) {                                                                    // 敵を倒した
    if (smp('robo', boss ? 1.6 : 1.2, rp(boss ? .8 : 1, .1))) smp('pop', boss ? 1.2 : .9, rp(1, .08));
    else burst(2200, .7, .22, .6, 'highpass');
    tone('sine', 120, 26, boss ? .9 : .5, 1.6); burst(250, .5, boss ? .8 : .45, 1.0, 'lowpass');
    notes('square', [523, 784, 1047, 1568], .05, .1, .2, .05);
  },
  thud() { if (!smp('thud', 2.0, rp(.92, .08))) { burst(300, .7, .24, .7, 'lowpass'); burst(1800, .8, .06, .3); } tone('sine', 120, 28, .34, 1.1); },
  land() { if (!smp('tap', 1.1, rp(.9, .1))) burst(520, .8, .07, .4, 'lowpass'); tone('sine', 160, 50, .12, .45); },
  step() { smp('step', .55, rp(1.05, .12)); },                                      // 走っているときの足音
  jump() { tone('square', 300, 760, .1, .16); if (!smp('air', .9, rp(1, .1))) sweep(700, 2200, 1.1, .13, .4); },
  dodge() { if (!smp('wh', 1.5, rp(.95, .1))) sweep(2200, 500, 1.3, .17, .7); tone('sine', 500, 200, .1, .15); },
  grab() { tone('square', 170, 110, .09, .3); if (!smp('tap', 1.2, rp(.8, .08))) burst(900, 1, .06, .5); },
  block() { if (smp('cling', 1.3, rp(1.05, .12))) smp('mtl', .9, rp(.9, .1)); else { burst(2800, 3, .08, .9); tone('square', 1700, 900, .04, .2); } tone('triangle', 560, 300, .08, .4); },
  brk() { if (smp('glass', 1.5, rp(1, .1))) smp('brk', 1.5, rp(.95, .1)); else { burst(520, .5, .38, 1.1, 'lowpass'); burst(3000, .6, .2, .6, 'highpass'); } tone('triangle', 230, 55, .32, .5); },
  // ---- 必殺・飛び道具 ----
  sp() {
    if (smp('chg', 1.5, 1.15)) smp('swoosh', 1.3, 1, .12); else sweep(500, 6000, .9, .5, .9);
    tone('sawtooth', 150, 1500, .42, .3); tone('square', 75, 300, .42, .26); notes('square', [1047, 1319, 1568], .05, .08, .18, .06);
  },
  charge() { if (!smp('chg', 1.0, 1.6)) sweep(3000, 800, 2, .3, .3); tone('sine', 280, 1300, .32, .26); },
  shot(big) {
    if (!(big ? smp('shotb', 1.6, rp(.95, .06)) : smp('shot', 1.2, rp(1, .08), 0, [1, 2, 3, 5]))) sweep(big ? 1200 : 2600, 400, 1.2, big ? .32 : .2, .7);
    tone('sawtooth', big ? 300 : 620, big ? 70 : 150, big ? .34 : .22, .4); tone('square', big ? 150 : 310, big ? 50 : 100, big ? .3 : .18, .24);
  },
  // ---- 進行 ----
  pick() { if (!smp('pow', 1.3)) { notes('sine', [880, 1320], .08, .14, .4); notes('square', [1760], 0, .1, .12, .14); } },
  coin() { if (!smp('coin', 1.2, rp(1, .04))) { notes('square', [988, 1319], .07, .2, .3); notes('triangle', [1976, 2637], .07, .22, .2); } },
  go() { smp('stab', 1.5); notes('square', [523, 659, 784, 1047], .08, .12, .26); notes('triangle', [1047, 1319, 1568, 2093], .08, .14, .2); tone('square', 1568, 0, .4, .24, master, .34); tone('triangle', 784, 0, .45, .28, master, .34); },   // 敵を片付けた → 次に進める
  ping() { notes('square', [1047, 1568], .09, .11, .2); },                                                 // GO の点滅に合わせた催促
  alert() { notes('sawtooth', [196, 196, 147], .2, .17, .45); notes('square', [98, 98, 73], .2, .17, .3); },   // 敵が出てきた
  warn() { for (let i = 0; i < 3; i++) { tone('sawtooth', 300, 720, .3, .45, master, i * .38); tone('square', 150, 360, .3, .3, master, i * .38); } },   // ボス登場
  start() { if (!smp('fanf', 1.5)) { notes('square', [392, 523, 659, 784], .07, .1, .26); tone('square', 1047, 0, .45, .3, master, .3); tone('triangle', 523, 0, .5, .35, master, .3); } sweep(6000, 2000, .8, .5, .3, 'highpass', .3); },
  round() { tone('sine', 220, 196, 1.3, .8); tone('sine', 331, 300, 1.1, .45); tone('triangle', 110, 98, 1.2, .5); burst(3200, .6, .5, .3, 'highpass'); },   // ゴング
  ko() { smp('exb', 1.8, .9); tone('sine', 440, 0, 1.3, .5); tone('sine', 660, 0, 1.1, .35); tone('sawtooth', 110, 55, .9, .25); burst(300, .5, .8, 1.0, 'lowpass'); },
  finish() { if (!smp('warp', 1.6, 1.25)) tone('sine', 900, 60, .8, .5); smp('en', 1.6, .8); },   // エリア最後の 1 体を倒した（ゆっくりになる瞬間）
  clear() { if (!smp('win', 1.6)) { notes('square', [523, 523, 523, 659, 0, 784, 0, 1047], .11, .14, .28); notes('triangle', [262, 262, 262, 330, 0, 392, 0, 523], .11, .16, .3); tone('square', 1319, 0, .8, .25, master, .9); tone('triangle', 659, 0, .9, .3, master, .9); tone('triangle', 1047, 0, .9, .25, master, .9); } },
  over() { if (!smp('lose', 1.6)) { notes('sawtooth', [392, 330, 262, 196], .28, .32, .35); notes('square', [196, 165, 131, 98], .28, .32, .25); } },
  ui() { if (!smp('click', 1.4)) tone('square', 660, 990, .06, .22); else tone('square', 660, 990, .05, .1); },
  boom(big) { if (!smp(big ? 'exb' : 'ex', big ? 2.2 : 1.9, rp(1, .1))) { burst(2400, .6, .25, .7, 'highpass'); sweep(3000, 200, .7, big ? .7 : .4, .8, 'lowpass'); } tone('sine', big ? 90 : 130, 24, big ? .9 : .5, 1.5); burst(big ? 160 : 260, .5, big ? .9 : .5, 1.2, 'lowpass'); },   // 爆発
  rank(lv) { const sc = [523, 659, 784, 1047, 1319, 1568, 2093, 2637]; notes('square', sc.slice(Math.min(lv, 3), Math.min(lv, 3) + 4), .05, .11, .24); notes('triangle', sc.slice(Math.min(lv, 3), Math.min(lv, 3) + 4).map(f => f * 2), .05, .13, .16); burst(5000, .8, .3, .2, 'highpass', master); },   // 連続ヒットの節目
  // ---- 武器 ----（k: wood = 木 / pipe = 鉄 / rock = 石 / can = ゴミ箱）
  whit(k, big) { const v = big ? 2.1 : 1.7; if (!smp(k, v, rp(big ? .86 : 1.02, .08))) { if (k === 'wood') burst(900, .9, .1, 1.1); else if (k === 'rock') burst(500, .7, .12, 1.2, 'lowpass'); else { burst(2400, 4, .12, 1); tone('triangle', k === 'can' ? 380 : 620, 220, .16, .5); } } },
  homer() { if (!smp('crack', 2.2, 1)) burst(3000, 2, .08, 1.2); smp('cling', 1.5, 1.5); tone('triangle', 1760, 2640, .28, .3); tone('sine', 880, 1760, .4, .2, master, .05); },   // バットの場外ホームラン
  wpick() { if (!smp('tap', 1.2, rp(1.3, .08))) tone('square', 500, 800, .05, .2); tone('triangle', 990, 1480, .07, .16); },
  wland(k) { smp(k, .6, rp(1.25, .1)); },
  wbreak(k) { if (!(k === 'wood' ? smp('brk', 1.7, rp(.95, .1)) : smp(k, 2.0, rp(.7, .08)))) burst(1500, .7, .2, 1); smp('crack', 1.4, rp(.9, .1)); },
  // ---- 敵のタイプ ----
  gun() { if (!smp('gun', 1.1, rp(1, .06))) { burst(rp(2200), 1.2, .06, 1.1); tone('square', 180, 60, .06, .4); } },
  rocket() { if (!smp('rkt', 1.5, rp(1, .06))) sweep(600, 3000, .8, .4, .9); tone('sawtooth', 120, 60, .3, .3); },
  thunder() { if (!smp('thunder', 1.7, rp(1.1, .1))) { burst(rp(900), .5, .5, 1.6, 'lowpass'); burst(4000, .6, .12, .8, 'highpass'); } tone('sine', 90, 30, .5, 1.2); },
  cast() { if (!smp('magic', 1.2, rp(1.1, .1))) { tone('sine', 700, 1500, .25, .3); sweep(1500, 5000, 1.5, .25, .4); } },
  blink() { if (!smp('blink', 1.2, rp(1.2, .08))) { tone('sine', 1400, 300, .18, .3); sweep(4000, 800, 2, .18, .4); } },
  chargeUp(lv) { smp('chg', .8, .9 + lv * .28); tone('sine', 440 * lv, 880 * lv, .16, .3); tone('triangle', 660 * lv, 1320 * lv, .12, .2, master, .04); },   // 溜めの段階が上がった
  copy() { if (!smp('warp', 1.2, 1.5)) sweep(800, 5000, 2, .3, .5); notes('square', [659, 880, 1319, 1760], .06, .12, .22); notes('triangle', [330, 440, 659, 880], .06, .14, .2); },   // 能力コピー
  vend() { if (!smp('thud', 1.3, rp(.9, .06))) burst(300, .8, .15, 1.2, 'lowpass'); if (!smp('can', 1.1, rp(1.2, .06), .14)) tone('square', 240, 120, .08, .35, master, .14); },   // 自販機: ガコン
  falling() { tone('sine', 1500, 260, .55, .35); },                                           // 穴に落ちる: ヒュ〜
  splash() { burst(1800, .7, .35, 1.0); sweep(3200, 400, 1.2, .45, .7); tone('sine', 160, 60, .25, .6); },   // ボチャン
  slip() { tone('sine', 420, 1700, .2, .45); tone('triangle', 840, 3000, .16, .2, master, .02); },   // バナナ: ツルッ
  honk() { for (const w of [0, .36]) { tone('square', 392, 0, .26, .3, master, w); tone('square', 494, 0, .26, .26, master, w); } },   // 警笛: プップー
  truck() { sweep(160, 90, .8, 1.3, 1.5, 'lowpass'); sweep(900, 300, 1.5, 1.1, .5); tone('sawtooth', 70, 55, 1.1, .5); },
  shutter() { if (!smp('mtl', 1.0, rp(.75, .06))) burst(1200, 3, .2, .7); for (let i = 0; i < 6; i++) tone('square', rp(180, .2), 0, .03, .14, master, i * .05); },   // シャッターが開く
  chute() { tone('square', 300, 150, .1, .3); sweep(2500, 500, 1.5, .35, .5, 'bandpass', .05); },   // 天井の投入口
  clank() { if (!smp('mtl', 1.9, rp(.55, .05))) burst(500, 1, .25, 1.5, 'lowpass'); smp('thud', 1.6, .7); tone('sine', 75, 28, .4, 1.4); },   // プレス機: ドスン
  beep() { tone('square', 880, 0, .08, .2); tone('square', 880, 0, .08, .2, master, .16); },
  flame() { sweep(250, 1600, .6, 1.1, 1.0); sweep(1200, 500, .8, 1.1, .5, 'lowpass'); },      // 火が噴く
  button() { tone('square', 200, 90, .12, .5); if (!smp('click', 1.6, .7)) burst(900, 2, .05, .6); },
  tarai() { if (!smp('cling', 1.8, rp(.72, .05))) { tone('triangle', 610, 590, .6, .5); tone('sine', 1230, 1200, .4, .25); } tone('sine', 305, 295, .7, .35); },   // 金だらい: ガーン
  aeon() { tone('sine', 55, 38, 2.4, 1.3); sweep(200, 7000, 2, 2.0, .45); notes('sine', [1047, 1319, 1568, 2093], .45, .9, .12, .2); },   // 5億年たつ音
  lucky() { notes('square', [523, 659, 784, 1047, 784, 1047, 1319], .09, .13, .26); notes('triangle', [262, 330, 392, 523, 392, 523, 659], .09, .15, .24); smp('coin', 1.2, 1); },
  sad() { notes('sawtooth', [311, 294, 277, 262], .3, .34, .22); tone('sawtooth', 262, 240, .6, .2, master, 1.2); },   // ハズレ: しょんぼりラッパ
  meterUp(b) { notes('triangle', [784, 1047, 1319].slice(0, b).concat([1568]), .06, .12, .22); smp('chg', .6, 1.2 + b * .2); },                 // ゲージが 1 本たまった
  duoStart() { if (!smp('warp', 1.3, 1.3)) sweep(600, 4000, 2, .25, .5); if (!smp('swh', 1.5, 1.1)) sweep(1200, 300, 1, .2, .6); tone('sine', 220, 660, .2, .3); },   // 連携技の出だし
  superStart() { if (!smp('warp', 1.8, .8)) sweep(300, 6000, 2, .6, .7); smp('exb', 1.2, 1.4); notes('sawtooth', [196, 262, 392, 523, 784], .07, .2, .22); tone('sine', 80, 40, .8, 1.2); },   // 超必殺の出だし
  firework() { if (!smp('fw', .9, rp(1, .15))) { burst(rp(1800), .6, .3, .5, 'highpass'); tone('sine', rp(140), 50, .25, .5); } },   // 花火
  tick(p = 0) { if (!smp('coin', .32, 1 + p * .6, 0, [3])) tone('square', 1200 + p * 900, 0, .03, .12); },                                // 集計の数字が回る音
  total() { smp('stab', 1.4, 1.12); notes('square', [784, 1047, 1319, 1568], .06, .12, .26); tone('triangle', 2093, 0, .5, .22, master, .26); },   // 合計が出た
  stamp(rank) {                                                                                                                             // ランクのはんこ
    if (!smp('body', 1.8, .8)) burst(300, .6, .3, 1.4, 'lowpass'); tone('sine', 110, 30, .4, 1.4);
    if (rank === 'S') { smp('fanf', 1.3, 1, .15, [2]); notes('square', [1047, 1319, 1568, 2093, 2637], .06, .14, .22, .1); }
    else notes('square', rank === 'A' ? [1047, 1319, 1568] : rank === 'B' ? [784, 988] : [523], .07, .14, .22, .1);
  },
  tally() { notes('square', [1319, 1568, 2093], .07, .08, .22); tone('triangle', 2637, 0, .3, .2, master, .9); tone('square', 1568, 0, .2, .22, master, .9); },   // ボーナスの集計
};
// BGM: 128BPM のベースとハイハット（Aマイナーの8ビート）
const BASS = [45, 45, 57, 45, 48, 48, 60, 48, 43, 43, 55, 43, 40, 40, 52, 47];
function bgmTick() {
  if (!AC || !bgmOn || G.phase !== 'play') return;
  const stg = G.mode === 'coop' ? G.stage : 0, st2 = stg === 1, c = AC, spb = 60 / ([128, 138, 146, 134, 100][stg] || 128) / 4;
  if (bgmNext < c.currentTime) bgmNext = c.currentTime + 0.05;
  while (bgmNext < c.currentTime + 0.2) {
    const t = bgmNext, s = bgmStep % 16, bar = Math.floor(bgmStep / 16) % 4;
    const n = BASS[(s >> 1) + (bar % 2) * 8] + (bar === 3 ? 2 : 0) + ([0, -3, 2, 5, -7][stg] || 0);
    if (s % 2 === 0) { const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = 440 * Math.pow(2, (n - 69) / 12); f.type = 'lowpass'; f.frequency.value = 700; env(g, t, 0.005, 0.5, spb * 1.8); o.connect(f); f.connect(g); g.connect(bgmGain); o.start(t); o.stop(t + spb * 2); }
    if (s % 4 === 0) { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); env(g, t, 0.002, 0.9, 0.16); o.connect(g); g.connect(bgmGain); o.start(t); o.stop(t + 0.2); }
    if (s % 8 === 4) { const sN = noise(), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'bandpass'; f.frequency.value = 1800; env(g, t, 0.002, 0.55, 0.14); sN.connect(f); f.connect(g); g.connect(bgmGain); sN.start(t); sN.stop(t + 0.16); }
    if (s % 2 === 1) { const sN = noise(), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'highpass'; f.frequency.value = 7000; env(g, t, 0.001, 0.25, 0.04); sN.connect(f); f.connect(g); g.connect(bgmGain); sN.start(t); sN.stop(t + 0.05); }
    if (bar >= 2 && (s === 0 || s === 6 || s === 10)) { const o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = 440 * Math.pow(2, (n + 24 - 69) / 12); env(g, t, 0.005, 0.08, spb * 1.5); o.connect(g); g.connect(bgmGain); o.start(t); o.stop(t + spb * 2); }
    bgmNext += spb; bgmStep++;
  }
}

// =========================================================================================
// 技の表（a = 当たり判定が出ている時間 [開始, 終了]）
// =========================================================================================
const MOVES = {
  // ---- 主人公（a = 当たりが出る時間。モーション（VRMA）があるときは PROFILES の hit から自動で置き換わる）----
  jab1:    { dur: .24, a: [.06, .13], dmg: 4, reach: 1.05, kb: 1.0, next: 'jab2', step: .7 },                                  // ジャブ
  jab2:    { dur: .25, a: [.07, .14], dmg: 5, reach: 1.12, kb: 1.0, next: 'jab3', step: .7 },                                  // 回転裏拳
  jab3:    { dur: .32, a: [.09, .17], dmg: 6, reach: 1.2, kb: 1.3, next: 'fin', step: .9 },                                    // ハイキック
  fin:     { dur: .52, a: [.13, .25], dmg: 11, reach: 1.35, kb: 3.5, knock: 1, launch: 7.2, step: 1.2, heavy: 1 },             // 宙返り蹴り（高く打ち上げる）
  finb:    { dur: .5, a: [.06, .2], dmg: 9, reach: 1.4, kb: 3, knock: 1, around: 1, heavy: 1 },                                // 足払い（周りを全部こかす）
  finc:    { dur: .6, a: [.2, .4], dmg: 12, reach: 1.5, kb: 7, knock: 1, step: 3.4, heavy: 1 },                                // 飛び回し蹴り（遠くまで届く）
  dashatk: { dur: .8, a: [.2, .5], dmg: 12, reach: 1.3, kb: 7, knock: 1, dash: 7, dashFrom: 0, heavy: 1 },                     // 走りながら攻撃 → 飛び蹴り
  jkick:   { air: 1, a: [.04, 9], dmg: 10, reach: 1.15, kb: 5, knock: 1 },                                                     // 飛び蹴り
  jpunch:  { air: 1, a: [.06, 9], dmg: 9, reach: 1.0, kb: 3, knock: 1 },                                                       // 真上ジャンプから打ち下ろし
  special: { dur: .68, a: [.06, .55], dmg: 9, reach: 1.55, kb: 4, knock: 1, launch: 7.2, around: 1, cost: 8, inv: 1, heavy: 1 },   // 必殺・三連回転（回転裏拳 → 足払い → 宙返り蹴り。周り全部に当たる）
  special2:{ dur: .9, a: [.15, .7], dmg: 9, reach: 1.5, kb: 7, knock: 1, cost: 10, inv: 1, heavy: 1, step: 2.4, dash: 6.5, dashFrom: .68 },   // 必殺・突進二連蹴り（飛び回し蹴り → 飛び蹴りで前へ突っ込む）
  ranged:  { dur: .8, a: [9, 9], dmg: 0, reach: 0, shot: { at: .45, spd: 9.5, dmg: 11, kb: 1.6 } },                             // 気弾
  ranged2: { dur: .9, a: [9, 9], dmg: 0, reach: 0, cost: 4, shot: { at: .4, spd: 8.5, dmg: 18, kb: 5, knock: 1, big: 1 } },    // 大きい気弾（体力を少し使う。当たると吹っ飛ぶ）
  knee:    { dur: .28, a: [.08, .16], dmg: 6, reach: 1.0, kb: 0, keepGrab: 1 },
  throw:   { dur: .5, a: [9, 9], dmg: 0, reach: 0 },
  // ---- 武器（威力と届く距離は、持っている武器で決まる → WEAPONS）----
  wsw1:    { dur: .4, a: [.1, .22], dmg: 9, reach: 1.5, kb: 1.4, next: 'wsw2', step: .6, weapon: 1 },                           // 振り下ろし
  wsw2:    { dur: .44, a: [.12, .26], dmg: 10, reach: 1.5, kb: 1.6, next: 'wsw3', step: .7, weapon: 1 },                         // 横なぎ
  wsw3:    { dur: .6, a: [.16, .3], dmg: 16, reach: 1.55, kb: 6, knock: 1, step: 1.3, heavy: 1, weapon: 1 },                     // 跳んで叩きつける
  wthrow:  { dur: .55, a: [9, 9], dmg: 0, reach: 0, toss: .27, weapon: 1 },                                                      // 武器を投げる
  // ---- 敵 ----
  eatk:    { dur: .72, a: [.36, .46], dmg: 7, reach: 1.1, kb: 2.5, step: .6 },
  eatk2:   { dur: .72, a: [.36, .46], dmg: 7, reach: 1.1, kb: 2.5, step: .6 },
  eheavy:  { dur: 1.0, a: [.52, .64], dmg: 12, reach: 1.35, kb: 6, knock: 1, step: .8, heavy: 1 },
  edash:   { dur: .85, a: [.22, .62], dmg: 9, reach: 1.0, kb: 4, knock: 1, dash: 6.5 },
  erange:  { dur: 1.0, a: [9, 9], dmg: 0, reach: 0, shot: { at: .6, spd: 6.2, dmg: 6, kb: 2 } },                               // 敵の飛び道具
  eburst:  { dur: 1.1, a: [.55, .8], dmg: 10, reach: 1.9, kb: 6, knock: 1, around: 1, heavy: 1 },                              // ボスの衝撃波（周り全部）
  ekf1:    { dur: 1.3, a: [.3, 1.1], dmg: 8, reach: 1.25, kb: 5, knock: 1, step: 1.6, heavy: 1 },                              // ボスのカンフー連続技 1
  ekf2:    { dur: 1.1, a: [.2, .8], dmg: 8, reach: 1.25, kb: 5, knock: 1, step: 1.6, heavy: 1 },
  ebolt:   { dur: 1.3, a: [9, 9], dmg: 0, reach: 0, bolt: { at: .35, n: 1, delay: .95, gap: .2, r: 1.0, dmg: 10 } },                    // 魔女の落雷（足もとに予告の輪 → 落ちる）
  edive:   { dur: 1.15, a: [.3, .85], dmg: 9, reach: 1.0, kb: 5, knock: 1, dash: 8.5, dashFrom: .2, dive: 1 },                            // 飛ぶ敵の急降下                               // ボスのカンフー連続技 2
};
for (const k in MOVES) MOVES[k].key = k;
const ENEMIES = {
  grunt:  { name: 'とりあえず殴る係', hp: 38, spd: 1.9, pow: 1, reach: 1.05, color: 0x4f5d80, accent: 0xff3d6e, scale: 1, score: 100, guard: .06 },
  speedy: { copy: 'speed', name: '落ち着きのないバネ', hp: 28, spd: 3.1, pow: .9, reach: 1.0, color: 0x1fb59c, accent: 0xffce4a, scale: .85, score: 150, jumper: 1, runner: 1 },
  knife:  { copy: 'blade', name: '前髪切りすぎ美容師', hp: 34, spd: 2.3, pow: 1.1, reach: 1.05, color: 0x7a4fd0, accent: 0x2be8c8, scale: .95, score: 180, dasher: 1, guard: .2, shooter: .35 },
  heavy:  { copy: 'power', name: '元・洗濯機', hp: 85, spd: 1.15, pow: 1.3, reach: 1.3, color: 0x9a5a24, accent: 0xffce4a, scale: 1.35, score: 300, armor: 1, nograb: 1, heavyAtk: 1 },
  boss:   { name: '月曜の朝', hp: 360, spd: 1.7, pow: 1.6, reach: 1.45, color: 0x2a2a3a, accent: 0xffce4a, scale: 1.7, score: 3000, armor: 1, nograb: 1, boss: 1, dasher: 1, slammer: 1, heavyAtk: 1, shooter: .5, burst: 1, kungfu: 1 },
  // ---- 1 面の中ボス ----
  mid1:   { copy: 'blade', name: 'すきま風（強）', hp: 170, spd: 2.9, pow: 1.25, reach: 1.2, color: 0x1f8a5a, accent: 0xb8ff5a, scale: 1.25, score: 1200, mid: 1, nograb: 1, dasher: 1, jumper: 1, guard: .25, shooter: .6, look: 'blade' },
  mid2:   { copy: 'power', name: '開かないシャッター', hp: 240, spd: 1.35, pow: 1.45, reach: 1.4, color: 0xb0452a, accent: 0xffe14a, scale: 1.5, score: 1500, mid: 1, armor: 1, nograb: 1, heavyAtk: 1, slammer: 1, burst: 1, look: 'tank' },
  // ---- 2 面: 5億年ボタン工場 ----
  guard:  { name: '指差し確認の鬼', hp: 46, spd: 2.0, pow: 1.1, reach: 1.05, color: 0x3d5f8a, accent: 0xff8a1f, scale: 1, score: 130, guard: .18 },
  spark:  { copy: 'speed', name: '静電気（冬）', hp: 32, spd: 3.2, pow: 1, reach: 1.0, color: 0xc9a227, accent: 0x7fe9ff, scale: .85, score: 180, jumper: 1, runner: 1, shooter: .3 },
  welder: { copy: 'blade', name: 'まぶしい人', hp: 40, spd: 2.2, pow: 1.15, reach: 1.05, color: 0x6a6f7c, accent: 0xff4a3d, scale: .98, score: 220, dasher: 1, guard: .15, shooter: .7, look: 'visor' },
  press:  { copy: 'power', name: '腰の重い先輩', hp: 105, spd: 1.2, pow: 1.4, reach: 1.3, color: 0x8a8f3a, accent: 0xff4a3d, scale: 1.4, score: 380, armor: 1, nograb: 1, heavyAtk: 1, look: 'tank' },
  mid3:   { copy: 'rapid', name: '細かすぎる検品係', hp: 230, spd: 2.6, pow: 1.35, reach: 1.25, color: 0xe6e6ee, accent: 0x2be8c8, scale: 1.3, score: 1800, mid: 1, nograb: 1, kungfu: 1, guard: .35, dasher: 1, look: 'visor' },
  mid4:   { copy: 'power', name: '無免許フォークリフト', hp: 270, spd: 1.5, pow: 1.55, reach: 1.45, color: 0xd97a1a, accent: 0xfff2a8, scale: 1.55, score: 2200, mid: 1, armor: 1, nograb: 1, heavyAtk: 1, dasher: 1, slammer: 1, burst: 1, look: 'fork' },
  boss2:  { name: '押すなと言われると押す工場長', hp: 420, spd: 1.9, pow: 1.7, reach: 1.5, color: 0x3a1418, accent: 0xff2d3d, scale: 1.8, score: 5000, armor: 1, nograb: 1, boss: 1, dasher: 1, slammer: 1, heavyAtk: 1, shooter: .8, burst: 1, kungfu: 1, look: 'button' },
  // ---- 新しいモーションパックの敵（prof = 使うパック。動きも戦い方もタイプごとにちがう）----
  boxer:  { copy: 'rapid', name: '通信教育のボクサー', prof: 'male', hp: 46, spd: 2.5, pow: 1, reach: 1.05, color: 0xc23b3b, accent: 0xffffff, scale: 1.0, score: 200, dodger: .38, dasher: 1, heavyAtk: 1, guard: .12, look: 'boxer' },                       // ボクサー: ワンツー・アッパー・下がってよける
  gunner: { copy: 'gun', name: '水鉄砲だと思ってる兵', prof: 'gun', hp: 30, spd: 1.9, pow: 1, reach: 1.0, color: 0x4a5a3a, accent: 0xffd23a, scale: .98, score: 220, shooter: 2.4, range: 8, shotCd: 3.4, keepAway: 4.6, noMelee: 1, look: 'gun' },          // 鉄砲: 離れて、ねらって 3 連射
  rocket: { copy: 'rocket', name: '無資格の花火師', prof: 'rocket', hp: 40, spd: 1.6, pow: 1, reach: 1.0, color: 0x5a4a6a, accent: 0xff5a2a, scale: 1.05, score: 320, shooter: 1.8, range: 8.5, shotCd: 5, keepAway: 5.2, noMelee: 1, look: 'rocket' },    // ロケット: ひざをついて撃つ。当たると爆発
  witch:  { copy: 'magic', name: '地に足のつかない魔女', prof: 'sorc', hp: 34, spd: 2.2, pow: 1, reach: 1.1, color: 0x6a3fa8, accent: 0xff8ae0, scale: .95, score: 300, shooter: 1.8, range: 7.5, shotCd: 4, keepAway: 3.9, caster: 1, blink: 1, look: 'witch' },   // 魔女: 浮いている。光の玉・落雷・瞬間移動
  brute:  { copy: 'power', name: '友達はドラム缶', prof: 'brute', hp: 125, spd: 1.25, pow: 1.4, reach: 1.35, color: 0x7a5a3a, accent: 0xff7a1a, scale: 1.45, score: 450, armor: 1, nograb: 1, heavyAtk: 1, burst: 1, shooter: 1.0, shotCd: 6, look: 'tank' },   // 怪力: 大振り・地面を叩く・ドラム缶を投げる
  jet:    { copy: 'jet', name: '着地を忘れた男', prof: 'jet', hp: 30, spd: 2.8, pow: 1, reach: 1.0, color: 0x2a7fb8, accent: 0xffe14a, scale: .9, score: 260, flyer: 1.3, keepAway: 3.4, diver: 1, noMelee: 1, nograb: 1, look: 'jet' },             // ジェット: 空を飛び、急降下してくる
  esper:  { copy: 'psy', name: '気のせい卿', prof: 'esper', hp: 250, spd: 1.5, pow: 1.3, reach: 1.25, color: 0x2a2440, accent: 0x9d7bff, scale: 1.25, score: 2000, mid: 1, nograb: 1, shooter: 1.6, shotCd: 4, storm: 1, blink: 1, heavyAtk: 1, guard: .2, look: 'esper' },   // 超能力者（中ボス）: 念動の波・雷の嵐・瞬間移動
};
// ---- 面（ステージ）----
// areas = 画面が止まって敵が出る場所（lock = 止まる位置）。波の中に中ボス（mid）や大ボス（boss）がいると、その波で WARNING が出る
// par = 目安のクリア時間（秒。これより速いとタイムボーナスとランクが上がる）
// weapons = 地面に落ちている武器 [x, z, 種類] / armed = 雑魚が武器を持って出てくる割合 / eweapons = そのとき持つ武器
const STAGES = [
  { name: '5億年商店街', theme: 'street', intro: 'Claude と協力して進め！', clear: '5億年商店街を取り戻した！', par: 320, minions: ['grunt', 'speedy', 'boxer'],
    areas: [
      { lock: 8,  waves: [['grunt', 'grunt'], ['grunt', 'speedy', 'boxer']] },
      { lock: 27, waves: [['grunt', 'knife', 'boxer'], ['mid1', 'grunt']] },                          // 中ボス 1
      { lock: 46, waves: [['heavy', 'gunner', 'grunt'], ['speedy', 'boxer', 'knife', 'gunner']] },
      { lock: 63, waves: [['knife', 'boxer', 'gunner'], ['mid2', 'speedy']] },                         // 中ボス 2
      { lock: 80, boss: 1, waves: [['boss', 'grunt']] },                                              // 大ボス
    ],
    armed: .2, eweapons: ['stick', 'bat', 'pipe'],
    weapons: [[3.5, 1.3, 'stick'], [10.5, -1.5, 'trash'], [16, .9, 'stone'], [23.5, -1.0, 'bat'], [30, 1.4, 'trash'], [35.5, -.6, 'knuckle'], [42.5, .8, 'pipe'], [48.5, -1.5, 'stone'], [56, 1.5, 'trash'], [60, -1.0, 'bat'], [66, .4, 'stone'], [72.5, -1.3, 'pipe'], [77.5, 1.4, 'knuckle'], [82.5, -1.6, 'trash'], [84, .9, 'stone']],
    props: [[14, -1.6, 'onigiri'], [20, 1.2, 'coin'], [26, .2, 'bat'], [33, -1.2, 'ramen'], [39, 1.4, 'coin'], [53, -1.5, 'onigiri'], [57, 1.0, 'coin'], [64, -.2, 'pipe'], [70, 1.0, 'ramen'], [74, -0.4, 'coin'], [7.4, -1.75, 'banana']],
    // しかけ: vend = 自販機の x / hole = マンホール [x, z] / banana = バナナの皮 [x, z] / truck = 暴走トラック（from 番目のエリアから。every = 間隔の秒）
    gim: { vend: [14.25, 40, 55.8, 72.5], hole: [[18, .9], [29.3, -1.1], [50.6, 1.0], [67.2, 1.1], [84.2, -1.3]],
      banana: [[6, -.6], [13.5, 1.2], [22, -1.3], [37, .4], [44.5, -.9], [58, 1.4], [70.5, .2], [78.5, -.8]], truck: { from: 1, every: [15, 22] } } },
  { name: '5億年ボタン工場', theme: 'factory', intro: 'いちばん奥の巨大ボタンをめざせ！', clear: '5億年ボタン工場を止めた！', par: 360, minions: ['guard', 'spark', 'jet'],
    areas: [
      { lock: 8,  waves: [['guard', 'guard', 'jet'], ['welder', 'rocket', 'guard']] },
      { lock: 27, waves: [['press', 'witch', 'spark'], ['esper', 'guard']] },                         // 中ボス 1（超能力者）
      { lock: 46, waves: [['brute', 'jet', 'gunner'], ['witch', 'rocket', 'jet', 'guard']] },
      { lock: 63, waves: [['brute', 'welder', 'witch'], ['mid4', 'jet']] },                         // 中ボス 2
      { lock: 80, boss: 1, waves: [['boss2', 'guard']] },                                             // 大ボス
    ],
    armed: .28, eweapons: ['pipe', 'pipe', 'stick'],
    weapons: [[3, -1.2, 'pipe'], [9.5, 1.3, 'stone'], [15.5, -.8, 'trash'], [22.5, 1.0, 'knuckle'], [29.5, -1.4, 'pipe'], [36.5, .9, 'bat'], [43.5, -1.0, 'stone'], [48.5, 1.4, 'trash'], [56.5, -.5, 'pipe'], [60.5, 1.1, 'stick'], [67.5, -1.3, 'knuckle'], [72.5, .8, 'stone'], [77.5, -1.5, 'pipe'], [82.5, 1.2, 'trash'], [84, -.6, 'stone']],
    props: [[13, 1.3, 'onigiri'], [19, -1.5, 'coin'], [25, .2, 'pipe'], [33, 1.2, 'ramen'], [38, -1.3, 'coin'], [52, 1.4, 'onigiri'], [56, -1.2, 'coin'], [65, .1, 'bat'], [69, -1.4, 'ramen'], [73, .6, 'ramen'], [75, -0.6, 'coin']],
    // しかけ: chute = 敵が天井から落ちてくる / belt = 動く床 [x0, x1, z0, z1, 向き] / crusher = プレス機 [x, z] / flame = 火を噴く床 [x, z] / button = 「押すな」ボタン [x, z]
    gim: { chute: 1, vend: [78.2], belt: [[12.5, 21.5, -2.05, -.8, 1], [40.5, 51.5, .45, 1.8, -1], [57.5, 68.5, -2.05, -.8, 1]],
      crusher: [[11.3, .9], [24, 1.1], [31, -1.2], [45.2, -1.3], [62, 1.1], [79.6, -1.3]], flame: [[17, .8], [27.5, -.4], [48.8, -1.4], [64.2, 1.3], [84.6, .9]],
      button: [[6.5, 1.3], [35.5, .2], [80.8, .4]] } },
];
let AREAS = STAGES[0].areas, PROPS_AT = STAGES[0].props;
const GRAV = 22, JUMP_V = 8.2, HERO_SPD = 3.1, RUN_MUL = 1.9;

// =========================================================================================
// 体: VRM でも自前ロボでも、同じ「骨の名前」で動かす
// =========================================================================================
const BONEMAP = { sp: 'spine', ch: 'chest', hd: 'head', lUA: 'leftUpperArm', lLA: 'leftLowerArm', rUA: 'rightUpperArm', rLA: 'rightLowerArm', lUL: 'leftUpperLeg', lLL: 'leftLowerLeg', rUL: 'rightUpperLeg', rLL: 'rightLowerLeg' };
// 基本の構え（キャラの前 = +Z、左腕 = +X 側に伸びた T ポーズが基準）
const BASE = { sp: [.12, 0, 0], ch: [.04, 0, 0], hd: [-.12, 0, 0], lUA: [0, -.55, -1.12], lLA: [0, -2.15, 0], rUA: [0, .55, 1.12], rLA: [0, 2.15, 0], lUL: [-.28, 0, .05], lLL: [.4, 0, 0], rUL: [.22, 0, -.05], rLL: [.32, 0, 0] };
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
function ext(f, m) { const [a0, a1] = m.a; if (f.t < a0) return f.t / a0; if (f.t < a1) return 1; return Math.max(0, 1 - (f.t - a1) / Math.max(.05, m.dur - a1)); }
let gameTime = 0;
// ---- 手づくりポーズ（モーションファイルが無い状態のときの代役）。新しい技は近い形のポーズを借りる ----
const POSE_ALIAS = { wsw1: 'jab2', wsw2: 'jab2', wsw3: 'fin', wthrow: 'jab2', finb: 'fin', finc: 'fin', dashatk: 'edash', special2: 'special', jpunch: 'jkick', ranged: 'jab2', ranged2: 'jab2', eatk2: 'eatk', erange: 'eatk', eburst: 'eheavy', ekf1: 'eheavy', ekf2: 'eheavy', ebolt: 'eheavy', edive: 'edash', roll: 'land', sideU: 'land', sideD: 'land', backstep: 'hurt', guardhit: 'guard', stun: 'grabbed', intro: 'idle' };
function poseFor(f) {
  const P = { ...BASE }, t = f.t, S = POSE_ALIAS[f.state] || f.state;
  let rate = 16, fall = 0, lift = 0, spin = 0;
  const e = f.move && !f.move.air ? ext(f, f.move) : 0;
  switch (S) {
    case 'idle': P.sp = [.12 + Math.sin(gameTime * 2.6 + f.id) * .035, 0, 0]; break;
    case 'walk': {
      const ph = f.walkPh, s = Math.sin(ph);
      P.lUL = [-.28 + s * .6, 0, .05]; P.rUL = [.22 - s * .6, 0, -.05];
      P.lLL = [.4 + Math.max(0, -Math.cos(ph)) * .8, 0, 0]; P.rLL = [.32 + Math.max(0, Math.cos(ph)) * .8, 0, 0];
      P.sp = [.16, s * .12, 0]; break;
    }
    case 'jab1': rate = 42; P.lUA = mix(BASE.lUA, [0, -1.52, -.08], e); P.lLA = mix(BASE.lLA, [0, -.08, 0], e); P.sp = [.14, .32 * e, 0]; break;
    case 'jab2': rate = 42; P.rUA = mix(BASE.rUA, [0, 1.52, .08], e); P.rLA = mix(BASE.rLA, [0, .08, 0], e); P.sp = [.16, -.42 * e, 0]; break;
    case 'jab3': rate = 40; P.lUA = mix(BASE.lUA, [0, -1.25, .55], e); P.lLA = mix(BASE.lLA, [0, -1.3, 0], e); P.sp = [.05 - .1 * e, .4 * e, 0]; P.lLL = [.2, 0, 0]; break;
    case 'fin': rate = 34; P.rUL = mix(BASE.rUL, [-1.55, 0, -.15], e); P.rLL = mix(BASE.rLL, [.05, 0, 0], e); P.sp = [.12 - .38 * e, -.3 * e, 0]; P.lLL = [.25, 0, 0]; P.lUA = [0, -.3, -.9]; break;
    case 'jkick': rate = 30; P.rUL = [-1.45, 0, -.1]; P.rLL = [.05, 0, 0]; P.lUL = [-.7, 0, 0]; P.lLL = [1.7, 0, 0]; P.sp = [-.22, 0, 0]; break;
    case 'jump': case 'bjump': P.lUL = [-.95, 0, .1]; P.lLL = [1.6, 0, 0]; P.rUL = [-.55, 0, -.1]; P.rLL = [1.3, 0, 0]; P.lUA = [0, -.2, -.6]; P.rUA = [0, .2, .6]; if (S === 'bjump') { P.lUA = [0, -.4, .9]; P.rUA = [0, .4, -.9]; } break;
    case 'land': P.sp = [.35, 0, 0]; P.lUL = [-.8, 0, .05]; P.lLL = [1.2, 0, 0]; P.rUL = [-.4, 0, -.05]; P.rLL = [1.0, 0, 0]; lift = -.12; break;
    case 'special': { const sd = f.move?.dur || .68; rate = 30; spin = Math.min(1, t / sd) * Math.PI * 4; P.lUA = [0, 0, -.05]; P.rUA = [0, 0, .05]; P.lLA = [0, 0, 0]; P.rLA = [0, 0, 0]; P.rUL = [-1.0, 0, -.5]; P.rLL = [.2, 0, 0]; lift = Math.sin(Math.min(1, t / sd) * Math.PI) * .45; break; }
    case 'hurt': { const k = Math.max(0, 1 - t / .32); rate = 30; P.sp = [.1 - .55 * k, 0, 0]; P.hd = [-.55 * k, 0, 0]; P.lUA = [0, .4, -.7]; P.rUA = [0, -.4, .7]; P.lLA = [0, -.5, 0]; P.rLA = [0, .5, 0]; break; }
    case 'knock': rate = 20; fall = Math.min(1.45, t * 5); P.lUA = [0, .3, -.3]; P.rUA = [0, -.3, .3]; P.lLA = [0, -.3, 0]; P.rLA = [0, .3, 0]; P.lUL = [-.5, 0, .1]; P.rUL = [-.2, 0, -.1]; break;
    case 'thrown': rate = 20; fall = t * 13; P.lUA = [0, .3, -.3]; P.rUA = [0, -.3, .3]; P.lUL = [-.9, 0, .1]; P.lLL = [1.2, 0, 0]; break;
    case 'down': case 'dead': rate = 10; fall = 1.52; lift = .06; P.lUA = [0, 0, -.55]; P.rUA = [0, 0, .55]; P.lLA = [0, -.3, 0]; P.rLA = [0, .3, 0]; P.lUL = [-.15, 0, .12]; P.rUL = [-.05, 0, -.12]; P.lLL = [.2, 0, 0]; P.rLL = [.1, 0, 0]; P.sp = [0, 0, 0]; P.hd = [0, 0, 0]; break;
    case 'getup': { const k = Math.min(1, t / .45); rate = 14; fall = 1.52 * (1 - k); P.sp = [.5 * (1 - k) + .12, 0, 0]; P.lUL = [-1.2, 0, .1]; P.lLL = [1.8, 0, 0]; P.rUL = [-.4, 0, -.1]; P.rLL = [1.0, 0, 0]; lift = -.2 * Math.sin(k * Math.PI); break; }
    case 'grab': P.lUA = [0, -1.35, -.35]; P.rUA = [0, 1.35, .35]; P.lLA = [0, -.7, 0]; P.rLA = [0, .7, 0]; P.sp = [.3, 0, 0]; break;
    case 'guard': rate = 30; P.lUA = [0, -1.2, -.55]; P.rUA = [0, 1.2, .55]; P.lLA = [0, -2.0, 0]; P.rLA = [0, 2.0, 0]; P.sp = [.22, 0, 0]; P.hd = [.1, 0, 0]; break;
    case 'knee': rate = 36; P.lUA = [0, -1.35, -.35]; P.rUA = [0, 1.35, .35]; P.lLA = [0, -.7, 0]; P.rLA = [0, .7, 0]; P.rUL = mix(BASE.rUL, [-1.45, 0, 0], e); P.rLL = mix(BASE.rLL, [1.8, 0, 0], e); P.sp = [.3 + .2 * e, 0, 0]; break;
    case 'throw': { const k = Math.min(1, t / .2); rate = 30; P.sp = [.2, -1.1 * k, 0]; P.lUA = [0, -1.3, -.3 + .8 * k]; P.rUA = [0, 1.3, .3 - .8 * k]; P.lLA = [0, -.4, 0]; P.rLA = [0, .4, 0]; P.lUL = [-.5, 0, .1]; P.lLL = [.6, 0, 0]; break; }
    case 'grabbed': rate = 20; P.sp = [.55, 0, 0]; P.hd = [.35, 0, 0]; P.lUA = [0, .2, -1.35]; P.rUA = [0, -.2, 1.35]; P.lLA = [0, 0, 0]; P.rLA = [0, 0, 0]; P.lLL = [.5, 0, 0]; P.rLL = [.5, 0, 0]; break;
    case 'win': rate = 10; P.rUA = [0, .25, -1.3]; P.rLA = [0, .15, 0]; P.lUA = [0, -.15, -1.3]; P.lLA = [0, -.3, 0]; P.sp = [-.08, 0, 0]; P.hd = [-.2, 0, 0]; lift = Math.abs(Math.sin(gameTime * 6)) * .14; break;
    case 'lose': rate = 8; P.sp = [.7, 0, 0]; P.hd = [.5, 0, 0]; P.lUA = [0, .1, -1.4]; P.rUA = [0, -.1, 1.4]; P.lLA = [0, 0, 0]; P.rLA = [0, 0, 0]; P.lUL = [-.9, 0, .1]; P.lLL = [1.6, 0, 0]; P.rUL = [-.9, 0, -.1]; P.rLL = [1.6, 0, 0]; lift = -.35; break;
    case 'eatk': {
      rate = 30; const [a0, a1] = f.move.a;
      if (t < a0) { const w = t / a0; P.rUA = mix(BASE.rUA, [0, -.5, .5], w); P.rLA = mix(BASE.rLA, [0, 1.2, 0], w); P.sp = [.1, .45 * w, 0]; }
      else if (t < a1 + .12) { P.rUA = [0, 1.5, .1]; P.rLA = [0, .05, 0]; P.sp = [.25, -.45, 0]; }
      else { P.rUA = [0, 1.2, .5]; P.sp = [.2, -.2, 0]; }
      break;
    }
    case 'eheavy': {
      rate = 26; const [a0] = f.move.a;
      if (t < a0) { P.lUA = [0, -.6, .95]; P.rUA = [0, .6, -.95]; P.lLA = [0, -1.0, 0]; P.rLA = [0, 1.0, 0]; P.sp = [-.25, 0, 0]; }
      else { P.lUA = [0, -1.3, -.5]; P.rUA = [0, 1.3, .5]; P.lLA = [0, -.1, 0]; P.rLA = [0, .1, 0]; P.sp = [.55, 0, 0]; lift = -.1; }
      break;
    }
    case 'edash': { rate = 30; P.rUA = [0, 1.5, .1]; P.rLA = [0, .05, 0]; P.lUA = [0, -.4, -1.3]; P.sp = [.45, -.3, 0]; const s = Math.sin(t * 22); P.lUL = [-.3 + s * .7, 0, .05]; P.rUL = [-.3 - s * .7, 0, -.05]; break; }
  }
  return { P, rate, fall, lift, spin };
}
const _e = new T.Euler(), _q = new T.Quaternion(), _q2 = new T.Quaternion(), _qI = new T.Quaternion();
function applyPose(bones, P, rate, dt, flip) {
  const k = 1 - Math.exp(-rate * dt);
  for (const key in bones) {
    const v = P[key]; if (!v) continue;
    _e.set(v[0], v[1], v[2]); _q.setFromEuler(_e);
    if (flip) { _q.x = -_q.x; _q.z = -_q.z; }   // VRM0 の正規化骨は X と Z の向きが逆
    bones[key].quaternion.slerp(_q, k);
  }
}

// =========================================================================================
// モーション（VRMA）: パックごとの「状態・技 → クリップ」表
// =========================================================================================
// c      = クリップ名（配列なら戦う人ごとに別のものを使う。'セット名:クリップ名' で別のパックからも借りられる）
// s, e   = 使う範囲（秒）   sp = 再生の速さ
// m      = 'loop'（くり返し）/ 'jump'（跳び上がり〜落下に合わせる）/ 無し（1 回再生して最後の姿勢で止まる）
// hit    = 当たりが出る時間 [[開始, 終了, {その時間だけの上書き}], ...]（クリップ内の秒）   shot = 飛び道具を出す時刻
// hips   = 'air'（腰の高さを使わない＝ジャンプの高さはゲームの物理で出す）   xz = 'lock'（前後左右の移動を捨てる）
// anchor = 'end'（クリップの最後の立ち位置を基準にする）   fall = 1（投げられて回る動きを足す）
// seq    = [{c, s, e, sp}, ...]（複数のクリップを順につなぐ。このとき hit は「技が始まってからの秒」で書く）
// nat    = その歩き・走りが自然に見える速さ（m/秒。実際の速さに合わせて再生の速さを変える）
// steps  = 1 周のあいだに足が地面に着く回数（走る足音と土けむりを合わせる）
const PROFILES = {
  // ---- Female Fight パック: 主人公の「ストリート流」。構え・移動・打撃・よけがこのパック。やられ・ガード・飛び道具は女性格闘パックから借りる ----
  // lock = このパックのクリップは前へ進む動きを持っているので、立ち位置はゲーム側で動かす（その場で演じさせる）
  street: {
    set: 'street', ref: 'Fight_Idle', lock: 1,
    st: {
      idle:     { c: 'Fight_Idle', m: 'loop' },
      walk:     { c: 'Run_F', m: 'loop', nat: 3.9 },
      run:      { c: 'Sprint_1', m: 'loop', nat: 6.5, steps: 2 },
      jab1:     { c: 'FightFist01_1', sp: 1.15, hit: [[.06, .17]] },                           // 右ジャブ
      jab2:     { c: 'FightFist02_1', e: .75, sp: 1.15, hit: [[.09, .21]] },                   // 左ストレート
      jab3:     { c: 'Kick19', e: .95, sp: 1.2, hit: [[.27, .42]] },                           // 回し蹴り
      fin:      { c: 'FightFist06_1', e: .85, sp: 1.1, hit: [[.14, .3]] },                     // アッパー（打ち上げ）
      finb:     { c: 'Kick12', e: 1.05, sp: 1.25, hit: [[.3, .46]] },                          // 回転蹴り（周り全部）
      finc:     { c: 'Kick02', e: 1.05, sp: 1.2, hit: [[.27, .43]] },                          // 踏みこんで横蹴り
      dashatk:  { c: 'Kick08', e: 1.25, sp: 1.3, hit: [[.5, .78]] },                           // 走りこんで飛び蹴り
      jump:     { c: 'Jump_Start', s: .3, e: .9, m: 'jump', hips: 'air' },
      jkick:    { c: 'Air_Kick_05', s: .28, e: .8, sp: 1.2, hips: 'air', hit: [[.36, 9]] },
      jpunch:   { c: 'Air_Attack_01', s: .18, e: .7, sp: 1.2, hips: 'air', hit: [[.3, 9]] },
      land:     { c: 'Jump_End', s: .05, e: .55, sp: 2.4 },
      special:  { c: 'Kick_Combo03_1', e: 1.75, sp: 1.35, hit: [[.24, .37, { knock: 0, kb: .4, dmg: 4 }], [.47, .6, { knock: 0, kb: .4, dmg: 4 }], [1.05, 1.24]] },   // 必殺・蹴りの三連
      special2: { c: 'Kick_Combo02_1', e: 1.3, sp: 1.2, hit: [[.27, .4, { knock: 0, kb: .4, dmg: 5 }], [.7, .88]] },                                              // 必殺・突進二段蹴り
      ranged:   { c: 'female:RangeAttack1', sp: 1.35, shot: .66 },
      ranged2:  { c: 'female:RangeAttack2', sp: 1.35, shot: .56 },
      wsw1:     { c: 'FightFist01_1', hit: [[.07, .18]] },
      wsw2:     { c: 'FightFist02_1', e: .8, hit: [[.1, .22]] },
      wsw3:     { c: 'FightFist06_1', e: .9, hit: [[.15, .32]] },
      wthrow:   { c: 'female:RangeAttack2', s: .1, e: .95, sp: 1.5, toss: .5 },
      hurt:     { c: 'female:LightHit', e: .5, sp: 1.5 },
      knock:    { c: 'female:Knockdown_S', e: .62 },
      thrown:   { c: 'female:JumpHitReact_S', m: 'loop', hips: 'air', fall: 1 },
      down:     { c: 'female:Knockdown_S', s: .62, e: 1.32, sp: .8 },
      dead:     { c: 'female:Knockdown_S', s: 1.25, e: 1.32, sp: .1 },
      getup:    { c: 'female:Knockdown_S', s: 1.38, e: 2.2, sp: 1.5 },
      grabbed:  { c: 'female:Choke', m: 'loop' },
      guard:    { c: 'female:Block', m: 'loop' },
      guardhit: { c: 'female:BlockHitReact', sp: 1.3 },
      stun:     { c: 'female:Stunned', m: 'loop' },
      roll:     { c: 'Dodge_F', s: .05, e: 1.25, sp: 1.9 },                                    // 前転
      backstep: { c: 'FightAvoid_B' },
      sideU:    { c: 'FightAvoid_L' },
      sideD:    { c: 'FightAvoid_R' },
      intro:    { c: ['female:Intro1', 'female:Intro2'] },
      win:      { c: ['female:Victory1', 'female:Victory2'] },
      lose:     { c: 'female:Stunned', m: 'loop' },
    },
  },
  // ---- 女性格闘パック（Explosive Female Fighter）: 主人公用 ----
  female: {
    set: 'female', ref: 'Idle',
    st: {
      idle:     { c: 'Idle', m: 'loop' },
      walk:     { c: 'WalkForward_S', m: 'loop', nat: 2.1 },
      walkU:    { c: 'WalkLeft_S', m: 'loop', nat: 2.2 },
      walkD:    { c: 'WalkRight_S', m: 'loop', nat: 2.2 },
      run:      { c: 'extra:RunCute', m: 'loop', nat: 4.7, steps: 4, alt: { c: 'Run_S', m: 'loop', nat: 7.4, steps: 2 } },   // そうたさんの「女性走りモーション1」（読めなければ元の走りに戻す）
      jab1:     { c: 'Jab', sp: 1.3, hit: [[.08, .19]] },
      jab2:     { c: 'Punch', sp: 1.3, hit: [[.12, .26]] },
      jab3:     { c: 'Kick', sp: 1.2, hit: [[.13, .29]] },
      fin:      { c: 'Uppercut_S', sp: 1.15, hit: [[.18, .36]] },
      finb:     { c: 'Sweep', e: .56, sp: 1.05, hit: [[.05, .22]] },
      finc:     { c: 'MoveAttack2_S', sp: 1.15, hit: [[.3, .52]] },
      dashatk:  { c: 'MoveAttack1_S', sp: 1.2, hit: [[.25, .62]] },
      jump:     { c: 'Jump_S', s: .14, e: .74, m: 'jump', hips: 'air' },
      jkick:    { c: 'HighKick_S', s: .44, e: .7, sp: 1.3, hips: 'air', hit: [[.5, 9]] },
      jpunch:   { c: 'HighPunch_S', s: .4, e: .66, sp: 1.3, hips: 'air', hit: [[.5, 9]] },
      land:     { c: 'Jump_S', s: .8, e: 1.15, sp: 2.2 },
      // 必殺は複数のクリップをつないで作る（seq）。hit は技が始まってからの秒
      special:  { seq: [{ c: 'Punch', sp: 1.25 }, { c: 'Sweep', e: .42, sp: 1.1 }, { c: 'Uppercut_S', s: .06, sp: 1.15 }],
                  hit: [[.09, .21, { knock: 0, kb: .4, dmg: 4 }], [.4, .56, { knock: 0, kb: .4, dmg: 4 }], [.84, 1.0]] },
      special2: { seq: [{ c: 'MoveAttack2_S', sp: 1.2 }, { c: 'MoveAttack1_S', s: .12, e: .9, sp: 1.25 }],
                  hit: [[.25, .44, { knock: 0, kb: .4, dmg: 5 }], [.75, 1.05]] },
      ranged:   { c: 'RangeAttack1', sp: 1.35, shot: .66 },
      wsw1:     { c: 'Punch', sp: 1.1, hit: [[.09, .22]] },                                // 武器: 振り下ろし
      wsw2:     { c: 'LowPunch', sp: 1.1, hit: [[.1, .26]] },                             // 武器: 横なぎ
      wsw3:     { c: 'HighPunch_S', s: .3, e: .9, sp: 1.2, hit: [[.48, .64]] },           // 武器: 跳んで叩きつける
      wthrow:   { c: 'RangeAttack2', s: .1, e: .95, sp: 1.5, toss: .5 },                  // 武器を投げる
      ranged2:  { c: 'RangeAttack2', sp: 1.35, shot: .56 },
      hurt:     { c: 'LightHit', e: .5, sp: 1.5 },
      knock:    { c: 'Knockdown_S', e: .62 },
      thrown:   { c: 'JumpHitReact_S', m: 'loop', hips: 'air', fall: 1 },
      down:     { c: 'Knockdown_S', s: .62, e: 1.32, sp: .8 },
      dead:     { c: 'Knockdown_S', s: 1.25, e: 1.32, sp: .1 },
      getup:    { c: 'Knockdown_S', s: 1.38, e: 2.2, sp: 1.5 },
      grabbed:  { c: 'Choke', m: 'loop' },
      guard:    { c: 'Block', m: 'loop' },
      guardhit: { c: 'BlockHitReact', sp: 1.3 },
      stun:     { c: 'Stunned', m: 'loop' },
      roll:     { c: 'RollForward_S', sp: 1.2 },
      backstep: { c: 'DashBackward_S', sp: 1.1 },
      sideU:    { c: 'DashLeft_S', sp: 1.2 },
      sideD:    { c: 'DashRight_S', sp: 1.2 },
      intro:    { c: ['Intro1', 'Intro2'] },
      win:      { c: ['Victory1', 'Victory2'] },
      lose:     { c: 'Stunned', m: 'loop' },
    },
  },
  // ---- 空手パック（Explosive Karate Warrior）: 敵用。ボスの連続技だけカンフーパックから借りる ----
  karate: {
    set: 'karate', ref: 'Idle',
    st: {
      idle:     { c: 'Idle', m: 'loop' },
      walk:     { c: 'WalkForward_S', m: 'loop', nat: 2.3 },
      walkU:    { c: 'WalkLeft_S', m: 'loop', nat: 2.2 },
      walkD:    { c: 'WalkRight_S', m: 'loop', nat: 2.2 },
      run:      { c: 'Run_S', m: 'loop', nat: 6.9, steps: 2 },
      eatk:     { c: 'Attack1_S', e: 1.0, hit: [[.3, .5]] },                                                   // 回って横蹴り
      eatk2:    { c: 'Attack2_S', s: .62, e: 1.5, hit: [[.98, 1.18]] },                                        // 沈み込んで突き
      eheavy:   { c: 'Attack3_S', s: .98, e: 2.0, hit: [[1.42, 1.56, { knock: 0, dmg: 4, kb: 1 }], [1.66, 1.82, { dmg: 9 }]] },      // 跳んで蹴り → 手刀
      edash:    { c: 'MoveAttack1_S', hit: [[.3, .62]] },                                                                // 飛び横蹴り
      erange:   { c: 'RangeAttack1', sp: 1.1, shot: .82 },
      eburst:   { c: 'SpecialAttack1', s: .45, e: 1.8, sp: 1.1, hit: [[1.12, 1.4]] },
      ekf1:     { c: 'kungfu:FistKick01', s: 1.22, e: 2.62, xz: 'lock', hit: [[1.44, 1.6, { knock: 0, kb: 1, dmg: 4 }], [2.04, 2.18, { knock: 0, kb: 1, dmg: 4 }], [2.3, 2.46]] },
      ekf2:     { c: 'kungfu:FistKick03', s: 1.05, e: 2.2, xz: 'lock', hit: [[1.2, 1.36, { knock: 0, kb: 1, dmg: 4 }], [1.66, 1.82]] },
      jump:     { c: 'Jump_S', s: .12, e: .8, m: 'jump', hips: 'air' },
      bjump:    { c: 'Jump_S', s: .12, e: .8, m: 'jump', hips: 'air' },
      jkick:    { c: 'MoveAttack1_S', s: .34, e: .55, hips: 'air', hit: [[.36, 9]] },
      land:     { c: 'Jump_S', s: .85, e: 1.1, sp: 2 },
      hurt:     { c: 'LightHit_S', e: .42, sp: 1.3, xz: 'lock' },
      knock:    { c: 'Death_S', e: .5 },
      thrown:   { c: 'Fall', m: 'loop', hips: 'air', fall: 1 },
      down:     { c: 'Death_S', s: .5, e: 1.0, sp: .6 },
      dead:     { c: 'Death_S', s: .95, e: 1.0, sp: .1 },
      getup:    { c: 'Revive', e: .8, sp: 1.6, anchor: 'end' },
      grabbed:  { c: 'Stunned', m: 'loop' },
      stun:     { c: 'Stunned', m: 'loop' },
      guard:    { c: 'Block', m: 'loop' },
      guardhit: { c: 'BlockHitReact', e: .3, xz: 'lock' },
    },
  },
  // =====================================================================================
  // ここから下は 2026-10-06 に足した敵用のパック（そうたさんが VRMA にしたモーション）
  // mv = 技の中身の上書き（威力・飛び道具・落雷など）。パックごとに「同じ名前の技でも中身がちがう」ようにできる
  // =====================================================================================
  // ---- 男性格闘パック（Explosive Male Fighter）: ボクサー。ワンツー、ボディからアッパー、溜めパンチ、飛び込み、下がってよける ----
  male: {
    set: 'male', ref: 'Idle',
    st: {
      idle:     { c: 'Idle', m: 'loop' },
      walk:     { c: 'WalkForward_S', m: 'loop', nat: 2.9 },
      walkU:    { c: 'WalkLeft_S', m: 'loop', nat: 2.8 },
      walkD:    { c: 'WalkRight_S', m: 'loop', nat: 2.8 },
      run:      { c: 'Run_S', m: 'loop', nat: 6.1, steps: 2 },
      eatk:     { seq: [{ c: 'Jab', sp: 1.1 }, { c: 'Punch', sp: 1.1 }], hit: [[.12, .26, { knock: 0, kb: .6, dmg: 4 }], [.56, .72]] },                      // ワンツー
      eatk2:    { seq: [{ c: 'LowPunch', sp: .95 }, { c: 'Uppercut_S', sp: 1.1 }], hit: [[.06, .2, { knock: 0, kb: .5, dmg: 4 }], [.58, .78, { knock: 1, kb: 3, launch: 6.5, dmg: 8 }]] },   // ボディ → 跳びアッパー
      eheavy:   { c: 'SpecialAttack2', s: .45, e: 1.75, sp: 1.25, hit: [[.95, 1.3]] },                                                                   // 溜めて打つ右ストレート
      edash:    { c: 'MoveAttack1_S', sp: 1.1, hit: [[.3, .62]] },                                                                                       // 頭から飛び込む
      erange:   { c: 'RangeAttack2', sp: 1.2, shot: .5 },
      eburst:   { c: 'MoveAttack2_S', sp: 1.1, hit: [[.86, 1.06]] },                                                                                     // 高く跳んで打ち下ろす
      jump:     { c: 'Jump_S', s: .1, e: .75, m: 'jump', hips: 'air' },
      bjump:    { c: 'Jump_S', s: .1, e: .75, m: 'jump', hips: 'air' },
      jkick:    { c: 'HighKick_S', hips: 'air', hit: [[.08, 9]] },
      land:     { c: 'Land', sp: 1.6 },
      hurt:     { c: 'LightHit', e: .45, sp: 1.3 },
      knock:    { c: 'Knockdown_S', e: .6 },
      thrown:   { c: 'JumpHitReact_S', m: 'loop', hips: 'air', fall: 1 },
      down:     { c: 'Knockdown_S', s: .6, e: 1.3, sp: .8 },
      dead:     { c: 'Knockdown_S', s: 1.25, e: 1.32, sp: .1 },
      getup:    { c: 'Knockdown_S', s: 1.67, e: 2.4, sp: 1.5 },
      grabbed:  { c: 'Choke', m: 'loop' },
      stun:     { c: 'Stunned', m: 'loop' },
      guard:    { c: 'Block', m: 'loop' },
      guardhit: { c: 'BlockHitReact_S' },
      backstep: { c: 'DashBackward_S', sp: 1.1 },
    },
  },
  // ---- 怪力（Melee Combat の大技 ＋ Combat & Rescue の「重い物を投げる」。歩きとやられは男性格闘パックから借りる）----
  brute: {
    set: 'male', ref: 'rescue:Combat_Idle',
    st: {
      idle:     { c: 'rescue:Combat_Idle', m: 'loop' },
      walk:     { c: 'WalkSlow_S', m: 'loop', nat: 1.5 },
      walkU:    { c: 'WalkLeft_S', m: 'loop', nat: 2.8 },
      walkD:    { c: 'WalkRight_S', m: 'loop', nat: 2.8 },
      run:      { c: 'Run_S', m: 'loop', nat: 6.1, steps: 2 },
      eatk:     { c: 'melee:Punch_02', s: .45, e: 2.1, sp: 1.5, xz: 'lock', hit: [[.68, .9, { knock: 0, kb: 1, dmg: 6 }], [1.42, 1.68]] },                // 右、左の大振り
      eatk2:    { c: 'melee:Kick_02', s: .45, e: 1.75, sp: 1.4, xz: 'lock', hit: [[.86, 1.14]] },                                                       // 前蹴り
      eheavy:   { c: 'melee:Punch_01', s: .6, e: 2.2, sp: 1.4, xz: 'lock', hit: [[1.25, 1.52]] },                                                       // 振りかぶって殴る
      eburst:   { c: 'melee:Smash_02', s: .95, e: 3.3, sp: 1.5, xz: 'lock', hit: [[2.08, 2.36]] },                                                      // 跳んで地面を叩く（周り全部）
      erange:   { c: 'rescue:Throw_Heavy_Object', s: .8, e: 3.7, sp: 1.5, xz: 'lock', mv: { shot: null, lift: { at: .22, rel: 1.07, spd: 8.5, vy: 3.4 } } },   // ドラム缶を持ち上げて投げる
      jump:     { c: 'Jump_S', s: .1, e: .75, m: 'jump', hips: 'air' },
      bjump:    { c: 'Jump_S', s: .1, e: .75, m: 'jump', hips: 'air' },
      land:     { c: 'Land', sp: 1.6 },
      hurt:     { c: 'LightHit', e: .45, sp: 1.3 },
      knock:    { c: 'Knockdown_S', e: .6 },
      thrown:   { c: 'JumpHitReact_S', m: 'loop', hips: 'air', fall: 1 },
      down:     { c: 'Knockdown_S', s: .6, e: 1.3, sp: .8 },
      dead:     { c: 'Knockdown_S', s: 1.25, e: 1.32, sp: .1 },
      getup:    { c: 'Knockdown_S', s: 1.67, e: 2.4, sp: 1.3 },
      grabbed:  { c: 'Choke', m: 'loop' },
      stun:     { c: 'Stunned', m: 'loop' },
    },
  },
  // ---- 鉄砲（Range Combat）: 銃を構えた低い姿勢で歩き、止まって 3 連射。やられ方も銃で撃たれた倒れ方 ----
  gun: {
    set: 'range', ref: 'Shoot_04',
    st: {
      idle:     { c: 'Shoot_04', s: 2.2, e: 5.2, m: 'loop' },
      walk:     { c: 'Walk_Loop', m: 'loop', nat: 1.3 },
      walkU:    { c: 'Walk_Loop', m: 'loop', nat: 1.3 },
      walkD:    { c: 'Walk_Loop', m: 'loop', nat: 1.3 },
      run:      { c: 'Run_Loop', m: 'loop', nat: 3.0, steps: 2 },
      erange:   { c: 'Shoot_04', s: 2.4, e: 4.0, sp: 1.2, mv: { shot: null, aim: 1, burst: { at: .62, n: 3, gap: .14, spd: 15, dmg: 4, kb: 1.2, kind: 'bullet' } } },   // ねらって 3 連射
      jump:     { c: 'male:Jump_S', s: .1, e: .75, m: 'jump', hips: 'air' },
      land:     { c: 'male:Land', sp: 1.6 },
      hurt:     { c: 'male:LightHit', e: .45, sp: 1.3 },
      knock:    { c: 'Killed_05', s: .75, e: 1.5, xz: 'lock' },
      thrown:   { c: 'male:JumpHitReact_S', m: 'loop', hips: 'air', fall: 1 },
      down:     { c: 'Killed_05', s: 1.5, e: 2.2, sp: .8, xz: 'lock' },
      dead:     { c: 'Killed_05', s: 2.2, e: 2.3, sp: .1, xz: 'lock' },
      getup:    { c: 'male:Knockdown_S', s: 1.67, e: 2.4, sp: 1.5 },
      grabbed:  { c: 'male:Choke', m: 'loop' },
      stun:     { c: 'male:Stunned', m: 'loop' },
    },
  },
  // ---- 魔女（Explosive Sorceress Warrior）: ずっと宙に浮いている。光の玉を 3 方向に撃ち、足もとに雷を落とす ----
  sorc: {
    set: 'sorc', ref: 'Idle',
    st: {
      idle:     { c: 'Idle', m: 'loop' },
      walk:     { c: 'WalkForward_S', m: 'loop', nat: 2.0 },
      walkU:    { c: 'WalkLeft_S', m: 'loop', nat: 2.0 },
      walkD:    { c: 'WalkRight_S', m: 'loop', nat: 2.0 },
      run:      { c: 'Run_S', m: 'loop', nat: 6.9 },
      eatk:     { c: 'Attack1', sp: 1.1, xz: 'lock', hit: [[.5, .74]] },                                                                                // くるっと回って手で払う
      erange:   { c: 'RangeAttack1', sp: 1.2, xz: 'lock', mv: { shot: { at: .7, spd: 6.4, dmg: 6, kb: 2, kind: 'orb', spread: 3 } } },                   // 光の玉を 3 方向へ
      ebolt:    { c: 'SpecialAttack2', e: 2.0, sp: 1.5, xz: 'lock' },                                                                                   // 両手を上げて雷を呼ぶ
      hurt:     { c: 'LightHit_S', e: .5, sp: 1.4, xz: 'lock' },
      knock:    { c: 'Death_S', e: .5 },
      thrown:   { c: 'male:JumpHitReact_S', m: 'loop', hips: 'air', fall: 1 },
      down:     { c: 'Death_S', s: .5, e: .93, sp: .6 },
      dead:     { c: 'Death_S', s: .88, e: .93, sp: .1 },
      getup:    { c: 'Revive', sp: 1.3 },
      grabbed:  { c: 'Stunned', m: 'loop' },
      stun:     { c: 'Stunned', m: 'loop' },
      guard:    { c: 'Block', m: 'loop' },
      guardhit: { c: 'BlockHitReact_S', e: .4 },
    },
  },
  // ---- ジェット（Flying）: 空中に浮いて、ときどき体を水平にして突っ込んでくる。地上の技は届かない（跳ぶ・撃つ・投げる）----
  jet: {
    set: 'flying', ref: 'Aerial_Idle',
    st: {
      idle:     { c: 'Aerial_Idle', m: 'loop' },
      walk:     { c: 'Aerial_Idle', m: 'loop' },
      walkU:    { c: 'Aerial_Idle', m: 'loop' },
      walkD:    { c: 'Aerial_Idle', m: 'loop' },
      run:      { c: 'Flying_Idle', m: 'loop' },
      edive:    { c: 'Full_Accelerate_Flight_Loop', m: 'loop', mv: { dur: 1.15, a: [.3, .85] } },                                                       // 水平になって突っ込む
      hurt:     { c: 'male:LightHit', e: .45, sp: 1.3 },
      knock:    { c: 'male:Knockdown_S', e: .6 },
      thrown:   { c: 'male:JumpHitReact_S', m: 'loop', hips: 'air', fall: 1 },
      down:     { c: 'male:Knockdown_S', s: .6, e: 1.3, sp: .8 },
      dead:     { c: 'male:Knockdown_S', s: 1.25, e: 1.32, sp: .1 },
      getup:    { c: 'male:Knockdown_S', s: 1.67, e: 2.4, sp: 1.5 },
      stun:     { c: 'male:Stunned', m: 'loop' },
    },
  },
  // ---- 超能力者（Super Power）: 手をかざして念動の波、両腕を広げて雷の嵐。中ボス用 ----
  esper: {
    set: 'superpower', ref: 'rescue:Combat_Idle',
    st: {
      idle:     { c: 'rescue:Combat_Idle', m: 'loop' },
      walk:     { c: 'male:WalkSlow_S', m: 'loop', nat: 1.5 },
      walkU:    { c: 'male:WalkLeft_S', m: 'loop', nat: 2.8 },
      walkD:    { c: 'male:WalkRight_S', m: 'loop', nat: 2.8 },
      run:      { c: 'male:Run_S', m: 'loop', nat: 6.1 },
      eatk:     { c: 'male:Kick', xz: 'lock', hit: [[.28, .5]] },
      eatk2:    { c: 'male:Punch', sp: .9, hit: [[.2, .36]] },
      eheavy:   { c: 'male:SpecialAttack2', s: .45, e: 1.75, sp: 1.25, hit: [[.95, 1.3]] },
      erange:   { c: 'Super_Power_02', s: .55, e: 3.0, sp: 1.5, mv: { shot: { at: .5, spd: 5.2, dmg: 9, kb: 8, knock: 1, kind: 'wave' } } },             // 手をかざして念動の波
      eburst:   { c: 'Super_Power_08', s: 3.3, e: 8.3, sp: 2.4, mv: { a: [9, 9], hits: null, around: 0, bolt: { at: .5, n: 5, delay: .95, gap: .24, r: .95, dmg: 9 } } },   // 両腕を広げて雷の嵐
      jump:     { c: 'male:Jump_S', s: .1, e: .75, m: 'jump', hips: 'air' },
      land:     { c: 'male:Land', sp: 1.6 },
      hurt:     { c: 'male:LightHit', e: .45, sp: 1.3 },
      knock:    { c: 'male:Knockdown_S', e: .6 },
      thrown:   { c: 'male:JumpHitReact_S', m: 'loop', hips: 'air', fall: 1 },
      down:     { c: 'male:Knockdown_S', s: .6, e: 1.3, sp: .8 },
      dead:     { c: 'male:Knockdown_S', s: 1.25, e: 1.32, sp: .1 },
      getup:    { c: 'male:Knockdown_S', s: 1.67, e: 2.4, sp: 1.4 },
      stun:     { c: 'male:Stunned', m: 'loop' },
      guard:    { c: 'male:Block', m: 'loop' },
      guardhit: { c: 'male:BlockHitReact_S' },
    },
  },
};
PROFILES.rocket = { set: 'range', ref: 'Shoot_04', st: { ...PROFILES.gun.st,
  erange: { c: 'Rocket_Launcher', s: 1.9, e: 4.4, sp: 1.5, xz: 'lock', mv: { shot: { at: .75, spd: 6.2, dmg: 12, kb: 6, knock: 1, kind: 'rocket', blast: 1.5 } } },   // ひざをついてロケット弾
} };
const MIRROR = (b) => b.startsWith('left') ? 'right' + b.slice(4) : b.startsWith('right') ? 'left' + b.slice(5) : b;
// =========================================================================================
// 配る版（ネットに置いて、アプリなしで動かす）: window.NK_WEB があるときだけ働く
//   モーション = 使う区間だけを 30 コマ/秒で写して 1 つに固めたファイル（VRMA は置かない）
//   効果音     = 全部を 1 本につないだ音のファイル + 「どこからどこまでが何の音か」の表
// =========================================================================================
const WEB = window.NK_WEB || null;
let packJob = null, sfxSprite = null;
function loadPack() {
  if (packJob) return packJob;
  packJob = fetch(WEB.motions).then((r) => { if (!r.ok) throw new Error('motions ' + r.status); return r.arrayBuffer(); }).then((buf) => {
    const dv = new DataView(buf), jl = dv.getUint32(0, true), meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, jl)));
    const o16 = (4 + jl + 3) & ~3, q = new Int16Array(buf, o16, meta.n16), o32 = (o16 + meta.n16 * 2 + 3) & ~3, p = new Float32Array(buf, o32, meta.n32);
    log('モーションのかたまり: ' + Object.keys(meta.clips).length + ' 本（' + (buf.byteLength / 1048576).toFixed(1) + 'MB）');
    return { meta, q, p };
  });
  return packJob;
}
// 「時刻 → 値」を引く部品（three.js の補間器と同じ使い方: evaluate(t) が、使い回しの配列を返す）
function packTrack(arr, off, w, n, t0, fps, one, unit) {
  const out = new Float32Array(w);
  return { evaluate(t) {
    let a = off, f = 0;
    if (!one && n > 1) { let x = (t - t0) * fps; if (!(x > 0)) x = 0; else if (x > n - 1) x = n - 1; const i = Math.min(n - 2, x | 0); f = x - i; a = off + i * w; }
    if (f > 0) for (let k = 0; k < w; k++) out[k] = arr[a + k] + (arr[a + w + k] - arr[a + k]) * f; else for (let k = 0; k < w; k++) out[k] = arr[a + k];
    if (unit) { const l = Math.hypot(out[0], out[1], out[2], out[3]) || 1; out[0] /= l; out[1] /= l; out[2] /= l; out[3] /= l; }
    return out;
  } };
}
function packClip(id, P) {
  const m = P.meta.clips[id]; if (!m) return null;
  const fps = P.meta.fps, rot = m.b.map(([bone, off, one]) => [bone, packTrack(P.q, off, 4, m.n, m.t0, fps, one, true)]);
  return { id, dur: m.dur, rot, pos: m.p >= 0 ? packTrack(P.p, m.p, 3, m.n, m.t0, fps, false, false) : null, has: new Set(m.b.map(b => b[0])), restY: m.restY, hip0: m.hip0, hipEnd: m.hipEnd };
}
async function loadSfxSprite() {
  try {
    const [idx, buf] = await Promise.all([fetch(WEB.sfxIndex).then(r => r.json()), fetch(WEB.sfx).then(r => r.arrayBuffer())]);
    sfxSprite = { idx, buf }; decodeSamples();
  } catch (e) { log('効果音のかたまりを読めませんでした（合成音で鳴らします）' + e.message); }
}
function decodeSfxSprite() {
  if (!AC || !sfxSprite || !sfxSprite.buf) return;
  const { idx, buf } = sfxSprite; sfxSprite.buf = null;
  AC.decodeAudioData(buf).then((all) => {
    const k = all.sampleRate / idx.rate; let n = 0;
    for (const [name, list] of Object.entries(idx.s)) list.forEach((se, i) => {
      if (!se) return;
      const s0 = Math.round(se[0] * k), len = Math.max(1, Math.min(all.length - s0, Math.round(se[1] * k))), b = AC.createBuffer(all.numberOfChannels, len, all.sampleRate);
      for (let ch = 0; ch < all.numberOfChannels; ch++) b.copyToChannel(all.getChannelData(ch).subarray(s0, s0 + len), ch);
      (SMP[name] ||= [])[i] = b; n++;
    });
    log('効果音 ' + n + ' 個（かたまりから）');
  }).catch((e) => log('効果音のかたまりを開けませんでした ' + (e?.message || e)));
}
const CLIPS = new Map(), clipJobs = new Map();   // 'セット名:クリップ名' → 読み込んだモーション
let MOTION_CFG = {}, SET_DIRS = {}, clipMiss = 0;
const DEFAULT_SETS = { street: './motions/brawl/female_fight2', female: './motions/brawl/female_fighter', karate: './motions/brawl/karate_warrior', kungfu: './motions/brawl/kungfu', extra: './motions/brawl/extra',
  male: './motions/brawl/male_fighter', sorc: './motions/brawl/sorceress', range: './motions/brawl/range', melee: './motions/brawl/melee', flying: './motions/brawl/flying', superpower: './motions/brawl/superpower', rescue: './motions/brawl/rescue' };
async function loadMotionCfg() {
  try { const r = await fetch('./brawl_motions.json?' + Date.now()); MOTION_CFG = r.ok ? await r.json() : {}; }
  catch (e) { MOTION_CFG = {}; }
  SET_DIRS = { ...DEFAULT_SETS, ...(MOTION_CFG.sets || {}) };
}
// VRMA を 1 本読んで「時刻 → 各骨の向き・腰の位置」を引ける形にする（体には結び付けない。どの体にも使い回す）
function loadClip(id) {
  if (clipJobs.has(id)) return clipJobs.get(id);
  const i = id.indexOf(':'), set = id.slice(0, i), name = id.slice(i + 1);
  if (WEB && WEB.motions && set !== 'user') {   // 配る版: 固めたファイルから
    const pj = loadPack().then((P) => { const clip = packClip(id, P); if (!clip) throw new Error('固めたモーションに入っていません'); CLIPS.set(id, clip); return clip; })
      .catch((e) => { clipMiss++; clipJobs.delete(id); if (clipMiss <= 4) log('モーション読み込み失敗 ' + id + ' ' + (e?.message || e)); return null; });
    clipJobs.set(id, pj); return pj;
  }
  const url = set === 'user' ? fileURL(name) : fileURL(String(SET_DIRS[set] || '').replace(/[\\/]+$/, '') + '/' + name + '.vrma');
  const l = new GLTFLoader(); l.register((p) => new VRMAnimationLoaderPlugin(p));
  const job = l.loadAsync(url).then((g) => {
    const an = g.userData.vrmAnimations?.[0]; if (!an) throw new Error('VRMA ではありません');
    const rot = []; let dur = an.duration || 0;
    for (const [bone, tr] of an.humanoidTracks.rotation) { rot.push([bone, tr.createInterpolant(new Float32Array(4))]); dur = Math.max(dur, tr.times[tr.times.length - 1] || 0); }
    const ht = an.humanoidTracks.translation.get('hips'), pos = ht ? ht.createInterpolant(new Float32Array(3)) : null;
    const at = (t) => pos ? Array.from(pos.evaluate(t)) : [0, 0, 0];
    const clip = { id, dur, rot, pos, has: new Set(rot.map(r => r[0])), restY: an.restHipsPosition?.y || 1, hip0: at(0), hipEnd: at(dur) };
    CLIPS.set(id, clip); return clip;
  }).catch((e) => { clipMiss++; clipJobs.delete(id); if (clipMiss <= 4) log('モーション読み込み失敗 ' + id + ' ' + (e?.message || e)); return null; });
  clipJobs.set(id, job); return job;
}
// brawl_motions.json で技ごとに自分の VRMA へ差し替える（旧形式の attack / jump / special などもそのまま使える）
const LEGACY_SLOTS = { attack1: 'jab1', attack2: 'jab2', attack3: 'jab3', finisher: 'fin', jump: 'jump', jumpkick: 'jkick', special: 'special' };
function overridesFor(role) {
  const C = MOTION_CFG || {}, out = {};
  const put = (key, v) => {
    if (typeof v === 'string') v = { file: v };
    if (!v || !v.file) return;
    const e = { c: 'user:' + v.file, s: Math.max(0, +v.start || 0), sp: +v.speed || 1 };
    if (v.end != null) e.e = +v.end;
    if (v.hit) e.hit = [v.hit];
    if (v.loop) e.m = 'loop';
    if (!v.keepHips) e.xz = 'lock';
    if (key === 'jump') { e.m = 'jump'; e.hips = 'air'; }
    if (MOVES[key]?.air) e.hips = 'air';
    out[key] = e;
  };
  if (role === 'hero') for (const [slot, key] of Object.entries(LEGACY_SLOTS)) put(key, C[slot] || (/^attack\d$|^finisher$/.test(slot) ? C.attack : null));
  const o = (C.overrides && C.overrides[role]) || {};
  for (const k in o) put(k, o[k]);
  return out;
}
// パックを読み込み、「状態 → クリップ」「技の長さ・当たる時間」「状態の長さ」を組み立てる
async function loadProfile(name, role) {
  const prof = PROFILES[name] || PROFILES.female;
  const st = { ...prof.st, ...overridesFor(role) };
  const idOf = (c) => c.includes(':') ? c : prof.set + ':' + c;
  const ids = new Set([idOf(prof.ref)]);
  for (const e of Object.values(st)) for (const c of e.seq ? e.seq.map(p => p.c) : [].concat(e.c, e.alt ? e.alt.c : [])) ids.add(idOf(c));
  await Promise.all([...ids].map(loadClip));
  const P = { name, ent: {}, moves: {}, sd: {}, ref: CLIPS.get(idOf(prof.ref))?.hip0 || [0, 0, 0], n: 0 };
  const part = (e, c) => {
    const clip = CLIPS.get(idOf(c)); if (!clip) return null;
    const s = Math.min(e.s || 0, clip.dur - .03), en = clamp(e.e != null ? e.e : clip.dur, s + .03, clip.dur);
    return { ...e, clip, s, e: en, sp: e.sp || 1, len: en - s, xz: e.xz || (prof.lock && !c.includes(':') ? 'lock' : undefined) };
  };
  for (const [key, e] of Object.entries(st)) {
    let list;
    if (e.seq) {   // つなぎ技: 部品が 1 つでも欠けたら使わない
      const parts = e.seq.map(p => part(p, p.c));
      if (parts.some(p => !p)) continue;
      let acc = 0; for (const p of parts) { p.t0 = acc; acc += p.len / p.sp; }
      list = [{ ...e, key, parts, clip: parts[0].clip, s: 0, e: acc, sp: 1, len: acc }];
    } else list = [].concat(e.c).map((c) => { const p = part(e, c); return p && { ...p, key }; }).filter(Boolean);
    if (!list.length && e.alt) { const p = part(e.alt, e.alt.c); if (p) list = [{ ...p, key }]; }
    if (!list.length) continue;
    P.ent[key] = list.length > 1 ? list : list[0]; P.n++;
    const en = list[0], dur = en.len / en.sp, base = MOVES[key];
    if (base) {
      const mv = { ...base };
      if (!base.air) mv.dur = dur;
      if (en.hit && en.parts) { mv.hits = en.hit.map(([a, b, o]) => [a, b, o || null]); mv.a = [mv.hits[0][0], mv.hits[mv.hits.length - 1][1]]; }
      else if (en.hit) {
        mv.hits = en.hit.map(([a, b, o]) => [Math.max(0, (a - en.s) / en.sp), (b - en.s) / en.sp, o || null]);
        mv.a = [mv.hits[0][0], base.air ? 9 : mv.hits[mv.hits.length - 1][1]];
        if (base.air) mv.hits = null;
      } else if (!base.air && base.a[0] < 9) mv.a = [base.a[0] * dur / base.dur, base.a[1] * dur / base.dur];
      if (base.shot) mv.shot = { ...base.shot, at: en.shot != null ? (en.shot - en.s) / en.sp : base.shot.at * dur / base.dur };
      if (base.toss != null) mv.toss = en.toss != null ? (en.toss - en.s) / en.sp : base.toss * dur / base.dur;
      if (en.mv) Object.assign(mv, en.mv);   // パックごとの技の中身（威力・飛び道具・落雷など）
      P.moves[key] = mv;
    } else if (!en.m) P.sd[key] = dur;
  }
  log(`モーション ${name}: ${P.n} 状態ぶん読み込み`);
  return P;
}
// いまの状態で使うクリップの名前（歩きは向きと速さで変える）
function animKey(f) {
  const S = f.state;
  if (S === 'walk') {
    if (f.fast) return 'run';
    return Math.abs(f.vz) > Math.abs(f.vx) * 1.3 + .1 ? (f.vz < 0 ? 'walkU' : 'walkD') : 'walk';
  }
  return S;
}
const NO_BLINK = new Set(['special', 'special2', 'roll', 'backstep', 'sideU', 'sideD', 'intro']);

class Body {
  constructor() { this.root = new T.Group(); this.pivot = new T.Group(); this.root.add(this.pivot); this.yaw = Math.PI / 2; this.headY = 1.75; this.lib = null; this.cur = null; this.blend = 1; this.blendDur = .09; this.loopT = 0; }
  // 派生クラスが this.hb（骨の名前 → 関節）と this.bones（手づくりポーズ用の短い名前 → 関節）を作ってから呼ぶ
  initRig() {
    this.hips = this.hb.hips; this.restHips = this.hips.position.clone();
    this.all = Object.values(this.hb); this.names = Object.keys(this.hb);
    this.preQ = this.all.map(() => new T.Quaternion()); this.preP = new T.Vector3();
    const used = new Set(Object.values(this.bones)); this.extra = this.all.filter(b => !used.has(b));
  }
  setLib(lib) { this.lib = lib; this.cur = null; }
  rawBone(n) { return this.hb[n]; }
  // 関節 2 つの位置（世界座標）。技の軌跡を出すのに使う
  limbPos(a, b, oa, ob) {
    const A = this.rawBone(a), B = this.rawBone(b); if (!A || !B) return false;
    B.updateWorldMatrix(true, false); oa.setFromMatrixPosition(A.matrixWorld); ob.setFromMatrixPosition(B.matrixWorld); return true;
  }
  entFor(f) {
    if (f.fin && f.fin.ent) return f.fin.ent;   // 大演出のあいだ、決められた動き
    if (f.duo) return f.duo.ent;
    if (!this.lib) return null;
    let e = this.lib.ent[animKey(f)];
    if (!e && f.state === 'walk') e = this.lib.ent.walk;
    if (!e) return null;
    return Array.isArray(e) ? e[f.id % e.length] : e;
  }
  snap() { for (let i = 0; i < this.all.length; i++) this.preQ[i].copy(this.all[i].quaternion); this.preP.copy(this.hips.position); }
  // モーションで骨を動かす（ent が無ければ、手づくりポーズに入っていない骨と腰の位置を元へ戻すだけ）
  drive(f, dt, ent) {
    if (!ent) {
      this.cur = null;
      const k = 1 - Math.exp(-14 * dt);
      for (const b of this.extra) b.quaternion.slerp(_qI, k);
      this.hips.position.lerp(this.restHips, k);
      return;
    }
    const mir = f.duo ? f.duo.mir : f.fin && f.fin.yaw != null ? false : f.face < 0;
    if (!this.cur || this.cur.ent !== ent || this.cur.mir !== mir) {
      const same = this.cur && this.cur.ent === ent;
      if (!same) this.loopT = ent.m === 'loop' ? (f.id * .37) % ent.len : 0;
      this.cur = { ent, mir, part: 0 }; this.blend = 0; this.blendDur = same ? .1 : (ent.bl || .09);
    }
    let t, c = ent.clip, o = ent;
    if (ent.parts) {   // つなぎ技: いま何番目の部品か
      let i = ent.parts.length - 1; while (i > 0 && f.t < ent.parts[i].t0) i--;
      o = ent.parts[i]; c = o.clip;
      if (i !== this.cur.part) { this.cur.part = i; this.blend = 0; this.blendDur = .07; }
      t = o.s + Math.min(o.len, (f.t - o.t0) * o.sp);
    }
    else if (ent.m === 'loop') { this.loopT += dt * ent.sp * (ent.nat ? clamp((f.gspd || 0) / ent.nat, .55, 1.7) : 1); t = ent.s + (this.loopT % ent.len); }
    else if (ent.m === 'jump') t = ent.s + clamp((JUMP_V - f.vy) / (2 * JUMP_V), 0, 1) * ent.len;
    else t = ent.s + Math.min(ent.len, f.t * ent.sp);
    t = Math.min(t, c.dur - 1e-4);
    const bl = this.blend < 1; if (bl) this.snap();
    // 骨の向き（左向きのときは左右を入れ替えた鏡写しにして、いつも胸がカメラ側を向くようにする）
    for (const [bone, ip] of c.rot) {
      const node = this.hb[mir ? MIRROR(bone) : bone]; if (!node) continue;
      const v = ip.evaluate(t); let x = v[0], y = v[1], z = v[2];
      if (mir) { y = -y; z = -z; }
      if (this.flip) { x = -x; z = -z; }
      node.quaternion.set(x, y, z, v[3]);
    }
    for (let i = 0; i < this.all.length; i++) if (!c.has.has(this.names[i])) this.all[i].quaternion.slerp(_qI, 1 - Math.exp(-14 * dt));
    // 腰の位置（基準＝構えの立ち位置からのずれだけ使う。体の大きさに合わせて伸び縮み）
    if (c.pos) {
      const v = c.pos.evaluate(t), k = this.restHips.y / c.restY, b = o.anchor === 'end' ? c.hipEnd : (this.lib ? this.lib.ref : c.hip0);
      let x = v[0] - b[0], z = v[2] - b[2];
      if (o.xz === 'lock') x = z = 0;
      if (mir) x = -x;
      if (this.flip) { x = -x; z = -z; }
      this.hips.position.set(this.restHips.x + x * k, ent.hips === 'air' ? this.restHips.y : v[1] * k, this.restHips.z + z * k);
    }
    if (bl) {   // つなぎ目をなじませる
      this.blend = Math.min(1, this.blend + dt / this.blendDur);
      const k = this.blend;
      if (k < 1) {
        for (let i = 0; i < this.all.length; i++) { const q = this.all[i].quaternion; _q2.copy(q); q.copy(this.preQ[i]).slerp(_q2, k); }
        this.hips.position.lerpVectors(this.preP, this.hips.position, k);
      }
    }
  }
  sync(f, dt) {
    const ent = this.entFor(f), pz = poseFor(f);
    let { lift, spin, fall } = pz;
    if (ent) { lift = 0; spin = 0; if (!ent.fall) fall = 0; }
    else applyPose(this.bones, pz.P, pz.rate, dt, this.flip);
    this.drive(f, dt, ent);
    this.root.position.set(f.x, (f.pit ? f.y : Math.max(0, f.y)) + Math.max(lift, -.4) * this.scale, f.z);
    const fk = f.flat > 0 ? Math.min(1, f.flat / .25) : 0; this.root.scale.set(1 + .45 * fk, 1 - .8 * fk, 1 + .45 * fk);
    // モーションのときは真横向き（胸がカメラ側）。手づくりポーズのときは少しカメラ側へひねる
    const off = ent ? 0 : .38;
    const yawT = f.fin && f.fin.yaw != null ? f.fin.yaw : f.face > 0 ? Math.PI / 2 - off : -Math.PI / 2 + off;   // fin.yaw = 0 で正面（カメラ）向き
    let d = yawT - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 20);
    this.root.rotation.y = this.yaw + spin;
    const cur = this.pivot.rotation.x, dd = Math.atan2(Math.sin(-fall - cur), Math.cos(-fall - cur));
    const nx = cur + dd * Math.min(1, dt * (f.state === 'thrown' ? 60 : 16));
    this.pivot.rotation.x = Math.atan2(Math.sin(nx), Math.cos(nx));
    this.root.visible = !(f.ai && f.ai.door && f.ai.wait > 0) && !(f.pit && f.y < -2.2) && !(f.inv > 0 && !f.pit && !NO_BLINK.has(f.state) && Math.floor(gameTime * 18) % 2 === 0) && !(f.state === 'dead' && f.t > .5 && Math.floor(gameTime * 14) % 2 === 0);
  }
}
class VRMBody extends Body {
  constructor(vrm, targetH = 1.72) {
    super();
    this.vrm = vrm; this.pivot.add(vrm.scene);
    vrm.scene.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(vrm.scene), h = Math.max(.3, box.max.y - box.min.y);
    const s = targetH / h; vrm.scene.scale.setScalar(s); vrm.scene.position.y = -box.min.y * s;
    this.scale = 1; this.headY = targetH;
    this.flip = String(vrm.meta?.metaVersion) === '0';
    this.hb = {};
    for (const n of Object.keys(vrm.humanoid.humanBones || {})) { const b = vrm.humanoid.getNormalizedBoneNode(n); if (b) this.hb[n] = b; }
    this.bones = {};
    for (const [k, n] of Object.entries(BONEMAP)) if (this.hb[n]) this.bones[k] = this.hb[n];
    this.initRig();
    this.blink = 2; this.talk = 0;
  }
  expr(n, v) { try { this.vrm.expressionManager?.setValue(n, v); } catch (e) {} }
  rawBone(n) { return this.vrm.humanoid.getRawBoneNode(n); }
  sync(f, dt) {
    super.sync(f, dt);
    const S = f.state;
    this.blink -= dt; let bl = 0; if (this.blink < 0) { bl = 1; if (this.blink < -.12) this.blink = rnd(1.8, 4.5); }
    const hurt = ['hurt', 'knock', 'down', 'thrown', 'grabbed', 'dead', 'lose', 'stun'].includes(S);
    const atk = !!f.move || S === 'grab';
    this.expr('sad', hurt ? .9 : 0); this.expr('angry', atk && !hurt ? .65 : 0); this.expr('happy', S === 'win' || S === 'intro' ? 1 : 0);
    this.expr('surprised', S === 'knock' || S === 'thrown' ? .7 : 0);
    this.expr('blink', hurt ? (S === 'down' || S === 'dead' ? 1 : 0) : bl);
    this.talk = Math.max(0, this.talk - dt);
    this.expr('aa', this.talk > 0 ? (Math.sin(gameTime * 26) * .5 + .5) * .8 : (atk ? .35 : 0));
    this.vrm.update(dt);
  }
}
// 自前ロボ（敵・VRM が読めないときの代役）: VRM と同じ向き・同じ骨の名前・同じ関節のつながりで組む（だから同じ VRMA で動く）
const BOT_HIPS_Y = .9;
class BotBody extends Body {
  constructor(spec, isHero) {
    super();
    const col = spec.color, acc = spec.accent;
    this.mats = [];
    const mat = (c) => { const m = new T.MeshLambertMaterial({ color: c }); this.mats.push(m); return m; };
    const body = mat(col), dark = mat(isHero ? 0x2a2f45 : 0x1a1d2b), glow = new T.MeshBasicMaterial({ color: acc });
    const box = (w, h, d, m, x, y, z, parent) => { const me = new T.Mesh(new T.BoxGeometry(w, h, d), m); me.position.set(x, y, z); parent.add(me); return me; };
    const s = (spec.scale || 1) * 0.86;
    const g = new T.Group(); g.scale.setScalar(s); this.pivot.add(g);
    const hb = this.hb = {};
    const node = (name, parent, x, y, z) => { const n = new T.Group(); n.name = name; n.position.set(x, y, z); parent.add(n); hb[name] = n; return n; };
    const hips = node('hips', g, 0, BOT_HIPS_Y, 0);
    box(.46, .2, .3, dark, 0, .02, 0, hips);
    const spine = node('spine', hips, 0, .1, 0);
    box(.5, .26, .34, body, 0, .12, 0, spine);
    const chest = node('chest', spine, 0, .24, 0);
    box(.58, .22, .37, body, 0, .1, 0, chest);
    const up = node('upperChest', chest, 0, .2, 0);
    box(.6, .2, .38, body, 0, .08, 0, up);
    box(.34, .07, .02, glow, 0, .06, .2, up);
    box(.64, .1, .42, dark, 0, .2, 0, up);
    const neck = node('neck', up, 0, .22, 0);
    const hd = node('head', neck, 0, .06, 0);
    box(.4, .38, .38, body, 0, .2, 0, hd);
    box(.32, .09, .02, glow, 0, .24, .2, hd);
    if (spec.look === 'button') { box(.5, .09, .5, mat(0xffce4a), 0, .44, 0, hd); box(.34, .17, .34, new T.MeshBasicMaterial({ color: 0xff2d3d }), 0, .57, 0, hd); }   // 工場長: 頭に赤いボタン
    else if (spec.boss) { box(.5, .1, .5, glow, 0, .44, 0, hd); box(.08, .3, .08, glow, .16, .6, 0, hd); box(.08, .3, .08, glow, -.16, .6, 0, hd); }
    else if (spec.jumper) box(.1, .18, .1, glow, 0, .48, 0, hd);
    else box(.06, .14, .3, glow, 0, .44, 0, hd);
    if (spec.mid) box(.07, .3, .38, glow, 0, .52, -.02, hd);                                    // 中ボス: 大きなトサカ
    if (spec.look === 'witch') { const hat = new T.Mesh(new T.ConeGeometry(.26, .6, 8), dark); hat.position.set(0, .72, 0); hd.add(hat); box(.72, .04, .72, dark, 0, .43, 0, hd); box(.3, .06, .3, glow, 0, .47, 0, hd); }   // とんがり帽子
    if (spec.look === 'esper') { const halo = new T.Mesh(new T.TorusGeometry(.28, .03, 6, 20), glow); halo.rotation.x = Math.PI / 2; halo.position.set(0, .66, 0); hd.add(halo); box(.5, .7, .04, dark, 0, -.2, -.22, up); }   // 頭の上の輪とマント
    if (spec.look === 'jet') { box(.36, .42, .2, dark, 0, .04, -.27, up); box(1.0, .05, .3, glow, 0, .14, -.3, up); box(.12, .16, .12, glow, .1, -.24, -.27, up); box(.12, .16, .12, glow, -.1, -.24, -.27, up); }   // 背中のジェットと翼
    if (spec.look === 'rocket') { const tube = new T.Mesh(new T.CylinderGeometry(.1, .1, .95, 10), dark); tube.rotation.x = Math.PI / 2; tube.position.set(-.34, .34, .12); up.add(tube); box(.16, .16, .1, glow, -.34, .34, .6, up); }   // 肩のロケット砲
    if (spec.look === 'visor') box(.46, .15, .03, glow, 0, .23, .21, hd);                        // 大きなゴーグル
    if (spec.look === 'tank') { box(.66, .12, .05, glow, 0, .12, .2, up); box(.2, .2, .05, glow, 0, .0, .2, chest); }   // 胸の装甲
    const P345 = { box, mat, glow, dark, hd, up, chest, hips }; botLook345(spec, P345);
    const arm = (L, sd) => {
      const sh = node(L + 'Shoulder', up, sd * .12, .14, 0);
      const ua = node(L + 'UpperArm', sh, sd * .24, 0, 0); box(.3, .16, .16, body, sd * .15, 0, 0, ua);
      const la = node(L + 'LowerArm', ua, sd * .3, 0, 0); box(.28, .14, .14, dark, sd * .14, 0, 0, la);
      const ha = node(L + 'Hand', la, sd * .28, 0, 0); box(.16, .17, .17, spec.dasher && sd < 0 ? glow : body, sd * .06, 0, 0, ha);
      if (spec.look === 'boxer') box(.25, .25, .25, new T.MeshLambertMaterial({ color: 0xe02a2a }), sd * .1, 0, 0, ha);                 // ボクシングのグローブ
      if (spec.look === 'gun' && sd < 0) { box(.7, .09, .09, dark, sd * .36, .02, 0, ha); box(.1, .2, .08, dark, sd * .06, -.11, 0, ha); box(.08, .05, .05, glow, sd * .72, .02, 0, ha); }   // 鉄砲
      if (spec.look === 'blade') box(.36, .04, .2, glow, sd * .14, 0, -.14, la);                 // 腕の刃
      if (spec.look === 'tank') box(.3, .2, .34, dark, sd * .1, .1, 0, sh);                       // 肩の装甲
      if (spec.look === 'fork') { box(.5, .05, .06, glow, sd * .3, -.07, .05, ha); box(.5, .05, .06, glow, sd * .3, -.07, -.05, ha); }   // フォークの爪
      botHand345(spec, P345, sd, ha);
    };
    const leg = (L, sd) => {
      const ul = node(L + 'UpperLeg', hips, sd * .13, -.02, 0); box(.19, .44, .19, dark, 0, -.22, 0, ul);
      const ll = node(L + 'LowerLeg', ul, 0, -.44, 0); box(.17, .4, .17, body, 0, -.2, 0, ll);
      const ft = node(L + 'Foot', ll, 0, -.4, 0); box(.21, .08, .32, dark, 0, -.02, .05, ft);
    };
    arm('left', 1); arm('right', -1); leg('left', 1); leg('right', -1);
    if (spec.ghost) for (const m of this.mats) { m.transparent = true; m.opacity = .66; }   // 5 面の敵は、うっすら透けている
    this.bones = {};
    for (const [k, n] of Object.entries(BONEMAP)) if (hb[n]) this.bones[k] = hb[n];
    this.scale = spec.scale || 1; this.headY = 2.0 * s; this.flip = false;
    this.initRig();
  }
  sync(f, dt) {
    super.sync(f, dt);
    const fl = f.flash > 0 ? 1 : 0;
    for (const m of this.mats) m.emissive.setRGB(fl * .6, fl * .6, fl * .6);
  }
}

// =========================================================================================
// 戦う人（1P・Claude・敵、全部これ）
// =========================================================================================
let UID = 0;
class Fighter {
  constructor(o) {
    Object.assign(this, {
      id: ++UID, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, face: 1, hp: 100, maxhp: 100, state: 'idle', t: 0, inv: 0,
      team: 'hero', spd: 3.3, lives: 3, score: 0, kos: 0, name: '', move: null, hitSet: new Set(), hitAny: false, hitWin: -1, hitAt: {}, moveSeq: 0,
      comboNext: null, comboT: 0, queued: false, walkPh: 0, cool: 0, holder: null, victim: null, knees: 0, grabT: 0, escape: 0,
      jk: false, landed: false, ctrl: { mx: 0, mz: 0, atk: false, jump: false, sp: false }, spec: null, body: null,
      isPlayer: false, isClaude: false, ai: null, flash: 0, alive: true, out: false, lastHitBy: null, thrownBy: null,
      fast: false, gspd: 0, shotCd: 0, dodgeCd: 0, shotDone: false, moves: null, sd: null,
    }, o);
    this.shadow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; scene.add(this.shadow);
    if (this.body) scene.add(this.body.root);
  }
  get scl() { return this.spec?.scale || 1; }
  dispose() { scene.remove(this.shadow); if (this.body) scene.remove(this.body.root); unhold(this); freeTrails(this); if (this.aimLine) scene.remove(this.aimLine); if (this.chgOrb) scene.remove(this.chgOrb); if (this.carry) scene.remove(this.carry.g); }
}
let fighters = [], items = [], props = [], fx = [], shots = [];
const heroes = () => fighters.filter(f => f.team !== 'enemy');
const enemies = () => fighters.filter(f => f.team === 'enemy' && f.alive);
const hostile = (a, b) => a.team !== b.team;
const downish = (s) => s === 'knock' || s === 'down' || s === 'dead' || s === 'getup' || s === 'thrown';
const DODGES = new Set(['roll', 'backstep', 'sideU', 'sideD']);
const SD = (f, k, d) => (f.sd && f.sd[k]) || d;   // 状態の長さ（モーションがあればその長さ）

let hitStop = 0, shakeAmp = 0;
const shake = (a) => { shakeAmp = Math.max(shakeAmp, a); };

function moveOf(f, name) { return (f.moves && f.moves[name]) || MOVES[name]; }
function startMove(f, name) {
  const m = moveOf(f, name);
  f.state = name; f.t = 0; f.move = m; f.hitSet.clear(); f.hitAny = false; f.queued = false; f.hitWin = -1; f.hitAt = {}; f.shotDone = false; f.shotN = 0; f.moveSeq++; f.chg = 0;
  if (m.dash && m.dashFrom === 0) f.vx = f.face * m.dash;
  else if (m.step) f.vx = f.face * m.step; else f.vx *= .3;
  f.vz = 0;
  if (m.inv) f.inv = Math.max(f.inv, m.dur);
  // 振る音は「当たりが出はじめた瞬間」に鳴らす（resolveHits）。ここでは溜め・必殺の音だけ
  if (name === 'special' || name === 'special2') { sfx.sp(); fxSpecial(f); } else if (m.shot) sfx.charge(); else if (name === 'throw') sfx.swing(2);
}
const KICKS = new Set(['jab3', 'fin', 'finb', 'finc', 'dashatk', 'jkick', 'special', 'special2', 'knee', 'eatk', 'eheavy', 'edash', 'ekf1', 'ekf2']);
// 連続技の次の一手（とどめは、押している方向で 3 種類に変わる）
function comboNext(f, next) {
  if (MOVES[next]?.weapon && !armed(f)) return 'jab2';   // 途中で武器がこわれたら、こぶしで続ける
  if (next !== 'fin') return next;
  const c = f.ctrl;
  if (Math.abs(c.mz) > .5) return 'finb';        // 上か下 → 足払い
  if (c.mx * f.face > .5) return 'finc';         // 前 → 飛び回し蹴り
  return 'fin';                                  // 何も押さない → 宙返り蹴り
}
function startDodge(f, mx, mz) {
  let k;
  if (Math.abs(mz) > .5 && Math.abs(mx) < .5) { k = mz < 0 ? 'sideU' : 'sideD'; f.vz = Math.sign(mz) * 5.4; f.vx = 0; }   // 奥・手前へ横っ飛び
  else if (Math.abs(mx) > .5) { f.face = Math.sign(mx); k = 'roll'; f.vx = f.face * 6.2; f.vz = 0; }                      // 前転
  else { k = 'backstep'; f.vx = -f.face * 5.8; f.vz = 0; }                                                               // 後ろへ跳ぶ
  f.state = k; f.t = 0; f.move = null; f.inv = Math.max(f.inv, k === 'roll' ? .42 : .3); f.dodgeCd = .55;
  sfx.dodge(); fxDodge(f);
}
function releaseGrab(holder) {
  const v = holder.victim;
  if (v && v.state === 'grabbed') { v.state = 'hurt'; v.t = .12; v.vx = holder.face * 2.5; v.holder = null; v.move = null; v.grabImm = 1.2; }
  holder.grabImm = .5;
  holder.victim = null;
  if (holder.state === 'grab') { holder.state = 'idle'; holder.t = 0; }
}
function tryGrab(f) {
  if (f.grabImm > 0) return false;
  for (const b of fighters) {
    if (b === f || !b.alive || !hostile(f, b) || b.spec?.nograb) continue;
    if (!['idle', 'walk', 'hurt', 'guard', 'guardhit', 'stun'].includes(b.state) || b.y > .1 || b.victim || b.grabImm > 0) continue;   // ガードはつかみで崩せる
    const dx = (b.x - f.x) * f.face;
    if (Math.abs(b.z - f.z) < .32 && dx > .2 && dx < .72) {
      f.state = 'grab'; f.t = 0; f.grabT = 0; f.victim = b; f.knees = 0; f.vx = f.vz = 0; f.move = null;
      if (b.weapon) dropWeapon(b, f.face); b.state = 'grabbed'; b.t = 0; b.holder = f; b.face = -f.face; b.vx = b.vz = 0; b.move = null; b.escape = 0;
      sfx.grab();
      if (f.isClaude && Math.random() < .5) say('grab');
      return true;
    }
  }
  return false;
}
// 当たったときの処理。m.dir = 飛ばす向き（飛び道具用）、m.x = 当たった場所。受け止められたら false
function applyHit(a, b, m) {
  const pow = (a.spec?.pow || 1) * ((a.copy && a.copy.pow && !m.env && m.key !== 'shot') ? a.copy.pow : 1);
  let dmg = m.dmg * pow * (a.team === 'enemy' && G.mode === 'coop' ? DIFF_E[G.diff] : 1) * (a.team !== 'enemy' && G.mode === 'coop' && !m.env ? HERO_POW[G.diff] : 1);
  if (b.copy && b.copy.armor) dmg *= .6;   // 怪力をコピー中は打たれ強い
  if (!m.env) addMeter(a, Math.min(dmg, b.hp) * METER_GAIN.hit);
  addMeter(b, dmg * METER_GAIN.hurt);
  const dir = m.dir || (m.around ? (Math.sign(b.x - a.x) || a.face) : a.face);
  const ax = m.x != null ? m.x : a.x, hy = (b.y || 0) + 1.15 * Math.min(1.3, b.scl);
  // ガード: 正面からの軽い攻撃は受け止める（少しだけ削られる）。重い技は崩される
  if ((b.state === 'guard' || b.state === 'guardhit') && b.face === -dir) {
    if (!m.heavy) {
      addMeter(b, METER_GAIN.guard - dmg * METER_GAIN.hurt);
      b.hp = Math.max(1, b.hp - dmg * .15); b.state = 'guardhit'; b.t = 0; b.vx = dir * 2.4; b.flash = .05; b.move = null;
      hitStop = Math.max(hitStop, .035); fxGuard(b, dir, (ax + b.x) / 2 + dir * .1, hy, b.z); sfx.block();
      if (b.isClaude && Math.random() < .3) say('guard');
      return false;
    }
    dmg *= .6; sfx.brk();   // ガードを崩した
  }
  const big = !!m.knock;
  // つかみの途中なら外す
  if (b.victim) releaseGrab(b);
  if (b.state === 'grabbed' && b.holder && b.holder !== a) { const h = b.holder; h.victim = null; if (h.state === 'grab') h.state = 'idle'; b.holder = null; }
  const hp0 = b.hp;
  b.hp = Math.max(0, b.hp - dmg); b.flash = .12; b.lastHitBy = a;
  hitStop = Math.max(hitStop, big ? .13 : .06); shake(big ? .3 : .1);
  fxHit(a, b, m, dir, (ax + b.x) / 2 + dir * .2, hy, b.z, big, dmg);
  if (m.wk) { sfx.whit(WEAPONS[m.wk].snd, big); if (m.homer) { sfx.homer(); slowT = Math.max(slowT, .35); camPunch = Math.max(camPunch, 2.2); } }
  if (a.team !== 'enemy') comboHit(a, dmg, big, b.x, (b.y || 0) + 1.72 * Math.min(1.4, b.scl) + .12, b.z);
  sfx.hit(big, a.isPlayer ? G.combo : 0, b.team === 'enemy');
  if (b.team !== 'enemy') { sfx.hurt(big); if (b.isPlayer && hp0 >= b.maxhp * .3 && b.hp < b.maxhp * .3 && b.hp > 0) sfx.low(); }   // やられた音・体力が危ない音
  else if (b.hp <= 0 && hp0 > 0) {
    sfx.down(!!b.spec?.boss); fxKO(b, teamCol(a));
    // そのエリア最後の 1 体なら、決めの演出
    if (G.mode === 'coop' && G.area && G.waveIdx >= G.area.waves.length && !fighters.some(e => e.team === 'enemy' && e.alive && e.hp > 0)) { fxFinish(b, teamCol(a)); sfx.finish(); }
  }                                                // 敵を倒した音と火花
  if (m.keepGrab && b.state === 'grabbed' && b.hp > 0) { /* ひざ蹴り中はつかんだまま */ }
  else if (big || b.hp <= 0) { if (b.weapon && b.weapon.kind !== 'knuckle') dropWeapon(b, dir); b.state = 'knock'; b.t = 0; b.vy = big ? (m.launch || 5.4) : 4.6; b.vx = dir * (m.kb || 4) * (b.spec?.boss ? .45 : 1); b.face = -dir; b.y = Math.max(b.y, .05); b.move = null; b.holder = null; }
  else if (!(b.spec?.armor || (b.copy && b.copy.armor))) { b.state = 'hurt'; b.t = 0; b.vx = dir * (m.kb || 1); b.face = -dir; b.move = null; b.holder = null; }
  else { b.x += dir * .08; }
  if (a.team !== 'enemy') {
    a.score += Math.round(dmg * 10);
    if (b.team === 'enemy') { G.focus = b; G.focusT = 3; }
  } else if (b.isPlayer && b.hp < b.maxhp * .3 && b.hp + dmg >= b.maxhp * .3) say('hurtP', 2);
  if (b.isClaude && big && b.hp > 0) say('downC');
  if (b.isPlayer && G.mode === 'vs' && a.isClaude && big && Math.random() < .5) say('vsHit');
  return true;
}
function hitProps(a, m) {
  hitGimmicks(a, m);
  for (const p of props) {
    if (p.broken || a.hitSet.has('p' + p.id)) continue;
    const dx = (p.x - a.x) * a.face;
    const ok = m.around ? Math.hypot(p.x - a.x, (p.z - a.z) * 1.5) < m.reach : (dx > -.2 && dx < m.reach);
    if (!ok || Math.abs(p.z - a.z) > .55 || a.y > 1.2) continue;
    a.hitSet.add('p' + p.id); a.hitAny = true;
    p.hp--; p.wob = .3; sfx.hit(false, 0, true); spark(p.x, .7, p.z + .3, false); hitStop = .04;
    if (p.hp <= 0) breakProp(p);
  }
}
// いま何番目の「当たりが出る時間」の中か（出ていなければ -1）
function hitWindow(a, m) {
  if (m.air) return a.t >= m.a[0] ? 0 : -1;
  if (m.hits) { for (let i = 0; i < m.hits.length; i++) if (a.t >= m.hits[i][0] && a.t <= m.hits[i][1]) return i; return -1; }
  return a.t >= m.a[0] && a.t <= m.a[1] ? 0 : -1;
}
function resolveHits() {
  for (const a of fighters) {
    const m = a.move;
    if (!m || a.state !== m.key || !a.alive) continue;
    const w = hitWindow(a, m);
    if (w < 0) continue;
    if (w !== a.hitWin) {   // 当たり時間に入った瞬間: 振る音を鳴らす。次の当たり時間なら、同じ相手にもう一度当たる
      a.hitWin = w; a.hitSet.clear(); a.hitAt = {};
      sfx.swing(m.heavy || m.weapon ? 2 : KICKS.has(m.key) ? 1 : 0, a.team === 'enemy');
      if (m.around && a.y < .3) dust(a.x, a.z, 1.7);
    }
    let mm = m.hits && m.hits[w][2] ? { ...m, ...m.hits[w][2] } : m;
    if (m.rehit && a.t + m.rehit <= m.a[1]) mm = { ...mm, knock: 0, kb: .4 };   // 何度も当たる技は、最後の一発だけ吹っ飛ばす
    // 武器: 威力と届く距離を上書きする（メリケンサックはこぶしの技だけ強くなる。敵が持つと少し痛い）
    const aw = a.weapon ? WEAPONS[a.weapon.kind] : null; let hitNow = false;
    if (aw) {
      if (m.weapon && aw.dmg) {
        const i = m.key === 'wsw1' ? 0 : m.key === 'wsw2' ? 1 : 2;
        mm = { ...mm, dmg: aw.dmg[i], reach: aw.reach, wk: a.weapon.kind };
        if (aw.bash) { mm.knock = 1; mm.kb = Math.max(mm.kb || 0, 5); mm.heavy = 1; }
        if (aw.homer && i === 2) { mm.kb = 11; mm.launch = 8.5; mm.homer = 1; }
      } else if (aw.mul && KNUCKLE_MOVES.has(m.key)) mm = { ...mm, dmg: mm.dmg * aw.mul, wk: 'knuckle' };
      else if (a.team === 'enemy' && aw.dmg) mm = { ...mm, dmg: mm.dmg * 1.35, reach: mm.reach + .3, wk: a.weapon.kind };
    }
    const reachMul = a.team === 'enemy' ? Math.sqrt(a.scl) : 1;
    for (const b of fighters) {
      if (b === a || !b.alive || !hostile(a, b)) continue;
      if (a.hitSet.has(b.id) && !(m.rehit && a.t - a.hitAt[b.id] >= m.rehit)) continue;
      if (b.inv > 0 || downish(b.state)) continue;
      const dx = (b.x - a.x) * a.face, dz = Math.abs(b.z - a.z), dy = Math.abs(b.y - a.y);
      const rch = mm.reach * reachMul + (b.scl - 1) * .35;
      const inReach = mm.around ? Math.hypot(b.x - a.x, (b.z - a.z) * 1.4) < rch : (dx > -.25 && dx < rch);
      if (!inReach || dz > (mm.around ? 1.1 : .5 + (b.scl - 1) * .25) || dy > 1.15) continue;
      a.hitSet.add(b.id); a.hitAt[b.id] = a.t; a.hitAny = true; hitNow = true;
      applyHit(a, b, mm);
    }
    if (a.team !== 'enemy') hitProps(a, mm);
    // 武器は当てるたびにすり減り、使い切るとこわれる（1 回の振りで 1 つだけ減る）
    if (mm.wk && hitNow && a.team !== 'enemy' && a.weapon && a.wUse !== a.moveSeq * 8 + w) { a.wUse = a.moveSeq * 8 + w; if (--a.weapon.uses <= 0) breakWeapon(a); }
  }
  // 投げられた敵がほかの敵に当たる
  for (const f of fighters) {
    if (f.state !== 'thrown') continue;
    for (const b of fighters) {
      if (b === f || !b.alive || b.team !== f.team || downish(b.state) || f.hitSet.has(b.id)) continue;
      if (Math.abs(b.x - f.x) < .8 && Math.abs(b.z - f.z) < .6 && f.y < 1.6) {
        f.hitSet.add(b.id);
        applyHit(f.thrownBy || f, b, { dmg: 10, knock: 1, kb: 4, heavy: 1, dir: Math.sign(f.vx) || 1, x: f.x });
      }
    }
  }
}
// ---- 飛び道具 ----
// =========================================================================================
// 飛び道具（気弾・銃弾・光の玉・ロケット・念動の波）
// =========================================================================================
const shotGeo = new T.SphereGeometry(.15, 12, 10);
const GLYPHS = new Map();
function glyphTex(ch, col, plain) {   // 文字の札（弁当箱・手裏剣など）
  const k = ch + col + (plain ? 'p' : ''); if (GLYPHS.has(k)) return GLYPHS.get(k);
  const hex = '#' + col.toString(16).padStart(6, '0');
  const t = canvasTex(96, 96, (c, w, h) => { c.clearRect(0, 0, w, h); c.textAlign = 'center'; c.textBaseline = 'middle';
    if (plain) { c.font = '900 92px "Noto Sans JP", sans-serif'; c.lineWidth = 8; c.strokeStyle = '#10121c'; c.strokeText(ch, w / 2, h / 2 + 4); c.fillStyle = hex; c.fillText(ch, w / 2, h / 2 + 4); }
    else { c.fillStyle = '#10121c'; c.fillRect(6, 14, w - 12, h - 28); c.fillStyle = hex; c.fillRect(11, 19, w - 22, h - 38); c.fillStyle = '#fff'; c.font = '900 50px "Noto Sans JP", sans-serif'; c.fillText(ch, w / 2, h / 2 + 3); } });
  t.userData.keep = 1; GLYPHS.set(k, t); return t;
}
function spawnShot(f, s) {
  const n = s.spread || 1;
  for (let i = 0; i < n; i++) spawnShot1(f, s, n > 1 ? (i - (n - 1) / 2) * 1.35 : 0);
  const x = f.x + f.face * .75, y = (f.y || 0) + 1.05 * Math.min(1.4, f.scl);
  if (s.kind === 'bullet') { sfx.gun(); flashFx(x, y + .1, f.z + .1, .9, COL.gold, .07, .7); }
  else if (s.kind === 'rocket') { sfx.rocket(); flashFx(x, y + .3, f.z + .1, 1.6, COL.orange, .14, .6); for (let i = 0; i < 8; i++) smoke.add(f.x - f.face * .3, y + .3, f.z, -f.face * rnd(1, 3), rnd(-.3, .6), rnd(-.4, .4), rnd(.5, .9), .25, .9, COL.smoke[0], COL.smoke[1], COL.smoke[2], .3, -.2, 2); }
  else if (s.kind === 'orb' || s.kind === 'wave') { sfx.cast(); fxShot(f, x, y, f.z, s.kind === 'wave' ? [.62, .48, 1] : [1, .5, .9], s.kind === 'wave'); }
  else if (s.kind === 'glyph') sfx.swing(2);
  else { sfx.shot(!!s.big || s.lv >= 1); fxShot(f, x, y, f.z, s.lv ? chgCol(f, s.lv) : teamCol(f), !!s.big || s.lv >= 1); if (s.lv >= 2) ringFx(x, y, f.z + .2, .3, 1.6 + s.lv, .3, chgCol(f, s.lv), 'cam'); }
}
function spawnShot1(f, s, vz) {
  const kind = s.kind || 'ki';
  const col = kind === 'glyph' ? (s.col || 0xffffff) : kind === 'bullet' ? 0xffe27a : kind === 'orb' ? 0xff7ae0 : kind === 'wave' ? 0x9d7bff : kind === 'rocket' ? 0xff7a2a : f.team === 'enemy' ? 0xff3d6e : (f.isClaude ? 0x2be8c8 : 0xffce4a);
  const c = kind === 'ki' ? teamCol(f) : [((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255];
  const g = new T.Group(); let ring = null, spr = null;
  const glowS = (sz, op = 1) => { const sp = new T.Sprite(new T.SpriteMaterial({ map: radialTex, color: col, transparent: true, opacity: op, depthWrite: false, blending: T.AdditiveBlending })); sp.scale.set(sz, sz, 1); g.add(sp); return sp; };
  let sc = (s.sc || (s.big ? 1.7 : 1)) * (f.team === 'enemy' ? Math.min(1.5, Math.sqrt(f.scl)) : 1), r = .3 * sc, yk = 1.05;
  if (kind === 'bullet') { g.add(new T.Mesh(new T.BoxGeometry(.36, .05, .05), new T.MeshBasicMaterial({ color: 0xfff6c8 }))); glowS(.5, .8); sc = 1; r = .14; yk = 1.12; }
  else if (kind === 'rocket') {
    const body = new T.Mesh(new T.CylinderGeometry(.08, .08, .5, 10), new T.MeshLambertMaterial({ color: 0xc9ced8 })); body.rotation.z = Math.PI / 2; g.add(body);
    const nose = new T.Mesh(new T.ConeGeometry(.085, .2, 10), new T.MeshLambertMaterial({ color: 0xff3d3d })); nose.rotation.z = -Math.PI / 2 * f.face; nose.position.x = f.face * .34; g.add(nose);
    glowS(.9, .7).position.x = -f.face * .35; sc = 1; r = .22; yk = 1.25;
  } else if (kind === 'glyph') {
    spr = new T.Sprite(new T.SpriteMaterial({ map: glyphTex(s.glyph, s.col || 0xffffff, s.plain), transparent: true, depthWrite: false })); spr.scale.set(.56, .56, 1); g.add(spr); glowS(.9, .3); sc = 1; r = .24; yk = 1.15;
  } else if (kind === 'wave') {
    ring = new T.Mesh(new T.TorusGeometry(.5, .07, 8, 24), new T.MeshBasicMaterial({ color: 0xc9b6ff })); ring.rotation.y = Math.PI / 2; ring.scale.set(1, 1.7, 1); g.add(ring);
    glowS(2.6, .7); sc = 1; r = .55; yk = .9;
  } else {
    g.add(new T.Mesh(shotGeo, new T.MeshBasicMaterial({ color: 0xffffff }))); glowS(1.25);
    ring = new T.Mesh(new T.TorusGeometry(.24, .035, 6, 20), new T.MeshBasicMaterial({ color: col })); ring.rotation.y = Math.PI / 2; g.add(ring);
    if (kind === 'orb') { sc = .85; r = .26; }
    if (s.lv === 3) { const r2 = new T.Mesh(new T.TorusGeometry(.34, .03, 6, 22), new T.MeshBasicMaterial({ color: 0xffffff })); r2.rotation.y = Math.PI / 2; r2.position.x = -f.face * .22; g.add(r2); glowS(2.0, .8); }
    g.scale.setScalar(sc);
  }
  const x = f.x + f.face * .75, y = (f.y || 0) + yk * Math.min(1.4, f.scl);
  g.position.set(x, y, f.z); scene.add(g);
  const sh = { g, ring, spr, x, y, z: f.z, vx: f.face * s.spd, vz, owner: f, team: f.team, s, t: 0, r, c, sc, kind, life: kind === 'bullet' ? .9 : kind === 'rocket' ? 1.5 : 1.6 };
  shots.push(sh); if (kind === 'ki' || kind === 'orb' || kind === 'wave') kiAim(sh, f);
}
// ロケットなどの爆発: まわりの相手をまとめて吹っ飛ばす
function blastAt(x, y, z, r, dmg, owner, team) {
  sfx.boom(false); shake(.3); wFlash = Math.max(wFlash, .18);
  flashFx(x, y, z + .2, 4.2, COL.orange, .22, .7); ringFx(x, .05, z, .3, r * 2.4, .4, COL.orange, 'ground'); ringFx(x, y, z + .2, .2, r * 1.8, .3, COL.white, 'cam', 1, .7);
  for (let i = 0; i < 40; i++) { const a = rnd(0, 6.283), e = rnd(-.3, 1.4), v = rnd(3, 10); glow.add(x, y, z, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v, Math.sin(a) * Math.cos(e) * v * .5, rnd(.3, .7), rnd(.15, .3), .03, 1.6, .8, .25, 1, 6, 1.5); }
  for (let i = 0; i < 12; i++) smoke.add(x + rnd(-.3, .3), y + rnd(-.2, .4), z, rnd(-1.5, 1.5), rnd(.5, 2.2), rnd(-.6, .6), rnd(.7, 1.2), .4, 1.6, COL.dark[0] * 2, COL.dark[1] * 2, COL.dark[2] * 2, .4, -.3, 1.6);
  for (const b of fighters) {
    if (!b.alive || b.out || b.team === team || b.inv > 0 || downish(b.state)) continue;
    if (Math.hypot(b.x - x, (b.z - z) * 1.4) < r + .3 * b.scl && b.y < 1.6) applyHit(owner, b, { dmg, kb: 6, knock: 1, heavy: 1, dir: Math.sign(b.x - x) || 1, x, key: 'blast' });
  }
}
function updateShots(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const sh = shots[i]; sh.t += dt; if (sh.hm) kiHome(sh, dt); else { sh.x += sh.vx * dt; sh.z += sh.vz * dt; } sh.g.position.set(sh.x, sh.y, sh.z);
    if (sh.ring) sh.ring.rotation.x += dt * 14;
    if (sh.spr) sh.spr.material.rotation -= dt * 11 * Math.sign(sh.vx);
    if (sh.kind === 'rocket') { for (let k = 0; k < 2; k++) glow.add(sh.x - Math.sign(sh.vx) * .35, sh.y + rnd(-.05, .05), sh.z, -sh.vx * rnd(.1, .3), rnd(-.4, .4), rnd(-.3, .3), rnd(.2, .4), .22, 0, 1.6, .7, .2, .9, 0, 2); if (Math.random() < .5) smoke.add(sh.x - Math.sign(sh.vx) * .4, sh.y, sh.z, 0, rnd(.1, .5), 0, rnd(.4, .7), .15, .6, COL.smoke[0], COL.smoke[1], COL.smoke[2], .25, -.2, 2); }
    else if (sh.kind === 'bullet') { if (Math.random() < .6) streaks.add(sh.x, sh.y, sh.z, -sh.vx * .15, 0, 0, .08, .12, .03, 1, .95, .6, 0, 0); }
    else if (sh.tp) kiWake(sh, dt);   // 光の尾（流れ場に乗ってうねる）
    else if (Math.random() < .5) streaks.add(sh.x, sh.y, sh.z, -sh.vx * .12, 0, 0, .1, .1, .03, sh.c[0], sh.c[1], sh.c[2], 0, 0);
    let dead = sh.t > sh.life || Math.abs(sh.x - G.camX) > halfW + 1.5 || (!sh.hm && (sh.z < Z_MIN - .3 || sh.z > Z_MAX + .3)), hit = false;
    if (!dead) for (const b of fighters) {
      if (!b.alive || b.out || b.team === sh.team || b.inv > 0 || downish(b.state)) continue;
      if (sh.hits && sh.hits.has(b)) continue;
      if (Math.abs(b.x - sh.x) < sh.r + .3 * b.scl && Math.abs(b.z - sh.z) < .5 + (b.scl - 1) * .25 + (sh.s.lv >= 2 ? (sh.s.lv - 1) * .22 : 0) && sh.y - b.y > -.75 - (sh.s.lv || 0) * .2 && sh.y - b.y < 2.0 * b.scl) {
        if (sh.s.pierce) {   // つらぬく弾: 当たっても消えずに進む
          (sh.hits || (sh.hits = new Set())).add(b);
          applyHit(sh.owner, b, { dmg: sh.s.dmg, kb: sh.s.kb, knock: sh.s.knock, heavy: 1, dir: Math.sign(sh.vx), x: sh.x, key: 'shot' });
          flashFx(sh.x, sh.y, sh.z + .1, 1.6 * sh.sc, sh.c, .16, .5); ringFx(sh.x, sh.y, sh.z + .2, .1, 1.0 * sh.sc, .22, sh.c, 'cam'); if (sh.tp) kiBurst(sh); if (sh.s.max) shake(.3);
          continue;
        }
        if (!sh.s.blast) applyHit(sh.owner, b, { dmg: sh.s.dmg, kb: sh.s.kb, knock: sh.s.knock, heavy: sh.kind === 'wave' ? 1 : 0, dir: Math.sign(sh.vx), x: sh.x, key: 'shot' });
        dead = hit = true; break;
      }
    }
    if (!dead && sh.team !== 'enemy') for (const p of props) {
      if (p.broken || Math.abs(p.x - sh.x) > .5 || Math.abs(p.z - sh.z) > .55) continue;
      if (sh.s.pierce) { breakProp(p); continue; }
      p.hp--; p.wob = .3; sfx.hit(false, 0, true); if (p.hp <= 0) breakProp(p); dead = true; break;
    }
    if (dead) {
      if (sh.s.blast) blastAt(sh.x, sh.y, sh.z, sh.s.blast, sh.s.dmg, sh.owner, sh.team);
      else { if (sh.tp) kiBurst(sh); flashFx(sh.x, sh.y, sh.z + .1, (sh.kind === 'bullet' ? .9 : 2.0) * sh.sc, sh.c, .16, .5); if (sh.kind !== 'bullet' || hit) ringFx(sh.x, sh.y, sh.z + .2, .1, 1.1 * sh.sc, .22, sh.c, 'cam'); }
      scene.remove(sh.g); shots.splice(i, 1);
    }
  }
}
// =========================================================================================
// 落雷（足もとに予告の輪が出て、少しあとに落ちる）
// =========================================================================================
let hazards = [];
const hazGeo = new T.RingGeometry(.82, 1, 32), hazFill = new T.CircleGeometry(1, 28);
function spawnBolts(f, o) {
  const hs = (f.team === 'enemy' ? heroes() : enemies()).filter(h => h.alive && !h.out && h.state !== 'dead' && Math.abs(h.x - G.camX) < halfW + 1);
  if (!hs.length) return;
  for (let i = 0; i < o.n; i++) {
    const h = hs[i % hs.length], far = i >= hs.length;   // まず全員の足もとへ。残りはそのまわりへ散らす
    const x = clamp(h.x + (far ? rnd(-2.4, 2.4) : h.vx * .25), G.camX - halfW + .6, G.camX + halfW - .6), z = clamp(h.z + (far ? rnd(-1.3, 1.3) : 0), Z_MIN, Z_MAX);
    const ring = new T.Mesh(hazGeo, new T.MeshBasicMaterial({ color: 0xc9a6ff, transparent: true, opacity: .9, depthWrite: false, side: T.DoubleSide, fog: false }));
    const fill = new T.Mesh(hazFill, new T.MeshBasicMaterial({ color: 0x9d7bff, transparent: true, opacity: .35, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending, fog: false }));
    ring.rotation.x = fill.rotation.x = -Math.PI / 2; ring.position.set(x, .03, z); fill.position.set(x, .025, z); ring.scale.setScalar(o.r); fill.scale.setScalar(.01); ring.visible = fill.visible = false;
    scene.add(ring, fill);
    hazards.push({ x, z, t: -i * (o.gap || 0), delay: o.delay, r: o.r, dmg: o.dmg, owner: f, team: f.team, ring, fill });
  }
}
function clearHazards() { for (const h of hazards) { scene.remove(h.ring); scene.remove(h.fill); } hazards = []; }
function updateHazards(dt) {
  for (let i = hazards.length - 1; i >= 0; i--) {
    const h = hazards[i]; h.t += dt;
    if (h.t < 0) continue;
    const k = clamp(h.t / h.delay, 0, 1);
    h.ring.visible = h.fill.visible = true; h.fill.scale.setScalar(Math.max(.01, h.r * k)); h.ring.material.opacity = .55 + .45 * Math.sin(h.t * 26);
    if (Math.random() < .5) glow.add(h.x + rnd(-h.r, h.r) * .7, rnd(.1, 2.6), h.z + rnd(-.3, .3), 0, rnd(-3, -1), 0, rnd(.15, .3), .1, .02, .8, .65, 1.4, .9, 0, 0);
    if (h.t < h.delay) continue;
    // 落ちる
    scene.remove(h.ring); scene.remove(h.fill); hazards.splice(i, 1);
    sfx.thunder(); shake(.28); wFlash = Math.max(wFlash, .22);
    pillarFx(h.x, h.z, h.r * .8, 7, .32, [.8, .66, 1.3], .5); pillarFx(h.x, h.z, h.r * .3, 7, .22, COL.white, .8);
    flashFx(h.x, .6, h.z + .2, 4.5, [.75, .6, 1.3], .2, .7); ringFx(h.x, .05, h.z, .2, h.r * 2.4, .4, [.8, .66, 1.3], 'ground'); ringFx(h.x, .05, h.z, .1, h.r * 1.5, .3, COL.white, 'ground', 1, .7);
    for (let n = 0; n < 26; n++) { const a = rnd(0, 6.283), v = rnd(2, 8); glow.add(h.x, .2, h.z, Math.cos(a) * v, rnd(1, 7), Math.sin(a) * v * .5, rnd(.3, .6), rnd(.1, .2), .02, 1.2, 1, 1.6, 1, 9, 1.5); }
    for (const b of fighters) {
      if (!b.alive || b.out || b.team === h.team || b.inv > 0 || downish(b.state)) continue;
      if (Math.hypot(b.x - h.x, (b.z - h.z) * 1.4) < h.r + .15 && b.y < 1.5) applyHit(h.owner, b, { dmg: h.dmg, kb: 3.5, knock: 1, heavy: 1, dir: Math.sign(b.x - h.x) || 1, x: h.x, key: 'bolt' });
    }
  }
}
// =========================================================================================
// 敵のタイプごとの動き（下がってよける・瞬間移動・急降下・雷・持ち上げて投げる）と見た目の演出
// =========================================================================================
function blinkAway(e, tgt) {
  const side = Math.sign(e.x - tgt.x) || 1, lo = G.camX - halfW + .9, hi = G.camX + halfW - .9;
  let nx = tgt.x - side * rnd(3.6, 4.6);                       // 相手の向こう側へ抜ける
  if (nx < lo || nx > hi) nx = tgt.x + side * rnd(3.6, 4.6);   // 向こうが画面の外なら、同じ側の遠くへ
  nx = clamp(nx, lo, hi);
  const fxB = (x) => { ringFx(x, 1.1, e.z + .2, .2, 1.6, .3, [.7, .55, 1.3], 'cam'); flashFx(x, 1.1, e.z + .2, 2.6, [.7, .55, 1.3], .16, .6); for (let i = 0; i < 16; i++) glow.add(x + rnd(-.3, .3), rnd(.2, 1.9), e.z, rnd(-1.5, 1.5), rnd(-.5, 2.5), rnd(-.5, .5), rnd(.3, .6), .14, .02, .9, .7, 1.5, 1, 0, 2); };
  fxB(e.x); e.x = nx; e.z = clamp(tgt.z + rnd(-.8, .8), Z_MIN, Z_MAX); fxB(e.x);
  e.face = Math.sign(tgt.x - e.x) || 1; e.inv = Math.max(e.inv, .35); e.blinkCd = 4.5; e.vx = e.vz = 0; sfx.blink();
}
// 敵の頭のうち、タイプごとの大技。何かしたら true
function aiType(e, A, c, sp, tgt, adx, adz, faceT) {
  if (aiType345(e, A, c, sp, tgt, adx, adz, faceT)) return true;
  if (sp.blink && adx < 1.5 && adz < .7 && (e.blinkCd || 0) <= 0 && Math.random() < .08) { blinkAway(e, tgt); A.think = .45; return true; }
  if (sp.diver && adx > .4 && adx < 5.8 && adz < .4 && Math.random() < (adx < 2.2 ? .09 : .04)) { /* 真下に入られたら、すぐ突っ込んで反対側へ抜ける */ e.face = faceT; startMove(e, 'edive'); e.cool = 1.7; A.think = .5; sfx.swing(2, true); return true; }
  if ((sp.caster || sp.storm) && (e.castCd || 0) <= 0 && adx < 8.5 && Math.random() < .025) { e.face = faceT; c.mx = c.mz = 0; startMove(e, sp.storm ? 'eburst' : 'ebolt'); e.castCd = sp.storm ? 7.5 : 6; e.cool = 1.2; A.think = .5; sfx.charge(); return true; }
  return false;
}
// 持ち上げている物（ドラム缶）
function dropCarry(f, thrown) {
  const cr = f.carry; if (!cr) return; f.carry = null;
  const p = cr.g.position; scene.remove(cr.g);
  const m = f.move, L = thrown && m && m.lift;
  spawnWeapon('drum', p.x, f.z, 1, L ? { y: p.y, vx: f.face * L.spd, vy: L.vy, spin: -f.face * 9, fly: { owner: f, team: f.team, hit: new Set(), spent: false } } : { y: p.y, vy: 1, spin: 4 });
  if (L) sfx.swing(2, true);
}
const _ta = new T.Vector3(), _tb = new T.Vector3(), _tc = new T.Vector3(), _td = new T.Vector3();
function typeFx(f, dt, freeze) {
  const sp = f.spec; if (!sp || f.team !== 'enemy') return;
  const m = f.move, on = m && f.state === m.key;
  // 持ち上げている物を両手の上に置く。技が途切れたら落とす
  if (f.carry) {
    if (!(on && m.lift)) dropCarry(f, false);
    else if (f.body.limbPos('leftLowerArm', 'leftHand', _ta, _tb) && f.body.limbPos('rightLowerArm', 'rightHand', _tc, _td)) { f.carry.g.position.set((_tb.x + _td.x) / 2, Math.max(_tb.y, _td.y) + .12 * f.scl, (_tb.z + _td.z) / 2); f.carry.g.rotation.z += dt * 1.5; }
  }
  // ねらいの線（鉄砲）: 撃つ前に赤い線で知らせる
  const aiming = on && m.aim && m.burst && f.t < m.burst.at + m.burst.gap * m.burst.n;
  if (aiming) {
    if (!f.aimLine) { f.aimLine = new T.Mesh(new T.BoxGeometry(1, .025, .025), new T.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: .8, blending: T.AdditiveBlending, depthWrite: false, fog: false })); scene.add(f.aimLine); }
    const len = 8, y = (f.y || 0) + 1.12 * Math.min(1.4, f.scl);
    f.aimLine.visible = true; f.aimLine.scale.x = len; f.aimLine.position.set(f.x + f.face * (.6 + len / 2), y, f.z); f.aimLine.material.opacity = f.t < m.burst.at ? .35 + .45 * Math.abs(Math.sin(f.t * 18)) : .9;
  } else if (f.aimLine) f.aimLine.visible = false;
  if (freeze || !f.alive || downish(f.state)) return;
  f.tfx = (f.tfx || 0) - dt; if (f.tfx > 0) return; f.tfx = .05;
  if (sp.clone) { for (let i = 0; i < 3; i++) { const a = rnd(0, 6.283); flow.add(f.x + Math.cos(a) * .35, f.y + rnd(.1, 1.5), f.z + Math.sin(a) * .2, 0, rnd(.6, 1.6), 0, rnd(.5, 1.0), .13, .01, f.raged ? 1.4 : .9, .08, f.raged ? .2 : .5, .8, 1.6, 1.2, 1); } }
  else if (sp.ghost && Math.random() < .5) flow.add(f.x + rnd(-.3, .3), f.y + rnd(.2, 1.6) * Math.min(1.4, f.scl), f.z + rnd(-.2, .2), 0, rnd(.2, .7), 0, rnd(.6, 1.2), .09, .01, .8, .85, 1.1, .5, 1.2, 1.1, 1);
  if (sp.flyer) { for (let i = 0; i < 2; i++) glow.add(f.x - f.face * .18 + rnd(-.08, .08), f.y + .95 * f.scl, f.z - .05, -f.face * rnd(.3, 1.2) - f.vx * .2, rnd(-4.5, -2.5), rnd(-.3, .3), rnd(.18, .32), .2, .02, 1.6, .9, .3, 1, 0, 1); if (Math.random() < .3) smoke.add(f.x, f.y + .5, f.z, 0, rnd(-1.5, -.6), 0, rnd(.4, .7), .15, .6, COL.smoke[0], COL.smoke[1], COL.smoke[2], .2, 0, 1.5); }
  else if (sp.look === 'witch') { if (Math.random() < .6) glow.add(f.x + rnd(-.35, .35), rnd(.05, .5), f.z + rnd(-.2, .2), rnd(-.3, .3), rnd(.2, .9), 0, rnd(.4, .8), .1, .02, 1.3, .55, 1.2, .8, 0, 1); }
  else if (sp.look === 'esper') { const a = gameTime * 3 + f.id; glow.add(f.x + Math.cos(a) * .6, 1.0 + Math.sin(a * 1.7) * .7, f.z + Math.sin(a) * .25, 0, .4, 0, rnd(.4, .7), .12, .02, .8, .6, 1.5, .9, 0, 1); }
}

// ---- 1体ぶんの状態を進める ----
function updateFighter(f, dt) {
  if (f.duo || f.fin) return;
  const landed = f.landed; f.landed = false;
  f.t += dt; f.inv = Math.max(0, f.inv - dt); f.flash = Math.max(0, f.flash - dt); f.cool -= dt; f.comboT -= dt; f.grabImm = Math.max(0, (f.grabImm || 0) - dt);
  if (f.copy) { copyTick(f, dt); if (f.copy && f.copy.rapid && f.move && !f.move.shot && !f.move.air && f.state === f.move.key) f.t += dt * (f.copy.rapid - 1); }
  f.shotCd -= dt; f.dodgeCd -= dt; f.castCd = (f.castCd || 0) - dt; f.blinkCd = (f.blinkCd || 0) - dt; f.rushCd = (f.rushCd || 0) - dt;
  const c = f.ctrl, S = f.state, hero = f.team !== 'enemy';
  if (S === 'idle' || S === 'walk') {
    const mx = c.mx, mz = c.mz;
    f.fast = hero ? !!c.run && Math.abs(mx) > .2 : !!f.spec?.runner;
    f.vx = mx * f.spd * (hero && f.fast ? RUN_MUL : 1); f.vz = mz * f.spd * .66;
    if (mx) f.face = Math.sign(mx);
    const moving = Math.abs(mx) > .2 || Math.abs(mz) > .2;
    f.state = moving ? 'walk' : 'idle';
    if (moving) f.walkPh += dt * 9.5 * (f.spd / 3.3);
    const spKey = Math.abs(mx) > .5 ? 'special2' : 'special', rgKey = Math.abs(mz) > .5 ? 'ranged2' : 'ranged';
    if (c.sup && hero && trySuper(f)) { /* 超必殺（ゲージ 3 本）*/ }
    else if (c.duo && hero && tryDuo(f)) { /* 連携技（ゲージ 1 本）*/ }
    else if (c.guard) { f.state = 'guard'; f.t = 0; f.vx = f.vz = 0; f.fast = false; }
    else if (c.dodge && f.dodgeCd <= 0) startDodge(f, mx, mz);
    else if (c.sp && hero && f.hp > MOVES[spKey].cost + 1) { f.hp -= MOVES[spKey].cost; startMove(f, spKey); if (f.isClaude) say('special'); }
    else if (c.rng && hero && f.weapon && WEAPONS[f.weapon.kind].thr && (f.isPlayer || WEAPONS[f.weapon.kind].tosser)) startMove(f, 'wthrow');   // 持っている武器を投げる
    else if (c.rng && hero && f.copy && copyUse(f, mz)) { /* コピーした敵の技 */ }
    else if (c.rng && hero && f.shotCd <= 0 && f.hp > (MOVES[rgKey].cost || 0) + 1) {
      f.hp -= MOVES[rgKey].cost || 0; startMove(f, rgKey); f.shotCd = 1.35;
      if (f.isClaude) {   // 相棒は、近くに敵がいなければ溜めてから撃つ
        const near = fighters.some(e => e.alive && !e.out && hostile(f, e) && e.state !== 'dead' && Math.abs(e.x - f.x) < 3.4 && Math.abs(e.z - f.z) < 1.3);
        f.chgGoal = near ? 0 : pick([0, 0, .8, .8, 2.3, 2.3, 5.1]); if (Math.random() < .4) say('shot');
      }
    }
    else if (c.jump) { f.state = 'jump'; f.t = 0; f.vy = JUMP_V; f.jk = false; f.vx = mx * f.spd * (f.fast && hero ? RUN_MUL * .9 : 1.15); f.vz = mz * f.spd * .4; sfx.jump(); fxJump(f); }
    else if (c.atk && hero && (!f.weapon || f.weapon.kind === 'knuckle') && G.mode === 'coop' && pickWeapon(f)) { f.state = 'idle'; f.vx = f.vz = 0; }   // 足もとの武器を拾う（メリケンサックは、はずして持ちかえる）
    else if (c.atk && hero && armed(f)) startMove(f, f.fast ? 'wsw3' : (f.comboT > 0 && f.comboNext && MOVES[f.comboNext]?.weapon) ? f.comboNext : 'wsw1');   // 武器で殴る
    else if (c.atk) startMove(f, hero && f.fast ? 'dashatk' : (f.comboT > 0 && f.comboNext) ? comboNext(f, f.comboNext) : (f.firstMove || 'jab1'));
    else if (Math.abs(mx) > .5 && hero && !f.fast && !armed(f)) tryGrab(f);
  } else if (f.move && S === f.move.key && !f.move.air) {
    const m = f.move;
    if (m.dash && f.t > (m.dashFrom != null ? m.dashFrom : m.a[0]) && f.t < m.a[1]) f.vx = f.face * m.dash; else f.vx *= Math.exp(-10 * dt);
    f.vz *= Math.exp(-10 * dt);
    if (c.atk && f.t > m.a[0] * .6 && m.next) f.queued = true;
    if (m.shot && hero && !m.nochg && !f.shotDone && f.t >= m.shot.at - .04) {   // 気弾の溜め: 押している間は構えたまま
      const hold = f.isClaude ? (f.chg || 0) < (f.chgGoal || 0) : !!c.rngHold;
      if (hold && (f.chg || 0) < CHG_T[2] + 2.5) {
        f.t = m.shot.at - .04; const l0 = chgLv(f.chg || 0); f.chg = (f.chg || 0) + dt; const l1 = chgLv(f.chg);
        if (l1 > l0) fxChargeUp(f, l1);
        if (c.mx && Math.sign(c.mx) !== f.face) f.face = Math.sign(c.mx);
      }
    }
    if (m.shot && !f.shotDone && f.t >= m.shot.at) {
      f.shotDone = true; const sh = hero && !m.nochg ? chargedShot(f, m.shot) : m.shot; spawnShot(f, sh); f.chg = 0;
      if (sh.lv >= 2) { f.vx = -f.face * (sh.lv === 3 ? 4.5 : 2.2); shake(sh.lv === 3 ? .4 : .2); if (sh.lv === 3) { wFlash = Math.max(wFlash, .3); sfx.boom(false); } }
    }
    if (m.toss != null && !f.shotDone && f.t >= m.toss) { f.shotDone = true; throwWeapon(f); }
    if (m.burst && f.t >= m.burst.at) { const n = Math.min(m.burst.n, Math.floor((f.t - m.burst.at) / m.burst.gap) + 1); while (f.shotN < n) { spawnShot(f, m.burst); f.shotN++; } }   // 連射
    if (m.bolt && !f.shotDone && f.t >= m.bolt.at) { f.shotDone = true; spawnBolts(f, m.bolt); }                                                                                   // 落雷
    if (m.lift) {                                                                                                                                                                   // 持ち上げて投げる
      if (!f.carry && !f.shotDone && f.t >= m.lift.at) { const g = weaponMesh('drum'); scene.add(g); f.carry = { g }; sfx.grab(); }
      if (f.carry && f.t >= m.lift.rel) { f.shotDone = true; dropCarry(f, true); }
    }
    if (f.victim && f.victim.state === 'grabbed') { f.victim.x = f.x + f.face * .62; f.victim.z = f.z; }
    if (S === 'throw' && f.victim && f.t >= .18) {
      const v = f.victim; f.victim = null;
      if (v.state === 'grabbed') {
        v.state = 'thrown'; v.t = 0; v.holder = null; v.thrownBy = f; v.hitSet.clear();
        v.x = f.x + f.face * .3; v.y = .7; v.vy = 4.8; v.vx = f.face * 8.5; v.face = -f.face;
        shake(.1); if (f.isClaude) say('throw');
      }
    }
    // 当たったら、振り終わりを待たずに次の一手へつなげる
    if (f.queued && f.hitAny && m.next && f.t >= m.a[1] + .05 && f.t < m.dur) { f.move = null; startMove(f, comboNext(f, m.next)); }
    else if (f.t >= m.dur) {
      f.move = null;
      if (S === 'knee' && f.victim && f.victim.state === 'grabbed') {
        f.knees++;
        if (f.knees >= 3 || f.victim.hp <= 0) startMove(f, 'throw');
        else { f.state = 'grab'; f.t = 0; }
      } else if (f.queued && f.hitAny && m.next) startMove(f, comboNext(f, m.next));
      else { f.state = 'idle'; f.t = 0; f.comboNext = f.hitAny ? m.next : null; f.comboT = f.hitAny ? .45 : 0; f.cool = m.rec || 0; }
    }
  } else if (S === 'jump' || S === 'jkick' || S === 'jpunch' || S === 'bjump') {
    if (S === 'jump' && c.atk && !f.jk && f.t > .05) {
      const k = hero && Math.abs(f.vx) < .6 ? 'jpunch' : 'jkick';   // 真上に跳んだときは打ち下ろし、前へ跳んだときは飛び蹴り
      f.jk = true; f.state = k; f.move = moveOf(f, k); f.hitSet.clear(); f.hitAny = false; f.hitWin = -1; f.hitAt = {}; f.t = 0; f.moveSeq++;
    }
    if (landed && f.t > .05) {
      f.move = null;
      if (S === 'bjump') bossQuake(f); else { sfx.land(); fxLand(f); }
      f.state = 'land'; f.t = 0; f.vx *= .3; f.vz = 0;
    }
  } else if (S === 'land') {
    f.vx *= Math.exp(-12 * dt);
    if (f.t > SD(f, 'land', .11)) { f.state = 'idle'; f.t = 0; }
  } else if (S === 'hurt') {
    f.vx *= Math.exp(-8 * dt); f.vz = 0;
    if (f.t > SD(f, 'hurt', .32)) { f.state = 'idle'; f.t = 0; }
  } else if (S === 'guard') {
    f.vx *= Math.exp(-12 * dt); f.vz = 0;
    if (hero && c.mx && Math.sign(c.mx) !== f.face) f.face = Math.sign(c.mx);   // 構えたまま向きは変えられる
    if (c.dodge && f.dodgeCd <= 0) startDodge(f, c.mx, c.mz);
    else if (!c.guard && f.t > .15) { f.state = 'idle'; f.t = 0; }
  } else if (S === 'guardhit') {
    f.vx *= Math.exp(-9 * dt); f.vz = 0;
    if (f.t > Math.min(.3, SD(f, 'guardhit', .26))) { f.state = c.guard ? 'guard' : 'idle'; f.t = c.guard ? .2 : 0; }
  } else if (S === 'stun') {
    f.vx *= Math.exp(-8 * dt); f.vz = 0;
    if (f.t > .9) { f.state = 'idle'; f.t = 0; }
  } else if (DODGES.has(S)) {
    const d = SD(f, S, .42);
    if (f.t > d * .62) { f.vx *= Math.exp(-14 * dt); f.vz *= Math.exp(-14 * dt); }
    if (f.t >= d) { f.state = 'idle'; f.t = 0; f.vx = f.vz = 0; }
  } else if (S === 'intro') {
    f.vx = f.vz = 0;
    if (f.t > Math.min(1.7, SD(f, 'intro', .8)) || (f.t > .5 && (c.atk || c.jump || c.mx || c.mz))) { f.state = 'idle'; f.t = 0; }
  } else if (S === 'knock') {
    if (landed && f.t > .08) { f.state = 'down'; f.t = 0; f.vx *= .35; sfx.thud(); shake(.1); fxDown(f, false); }
  } else if (S === 'thrown') {
    if (landed && f.t > .08) {
      f.hp = Math.max(0, f.hp - 12); f.state = 'down'; f.t = 0; f.vx *= .3; sfx.thud(); shake(.18); fxDown(f, true);
      if (f.thrownBy) f.thrownBy.score += 120;
    }
  } else if (S === 'down') {
    f.vx *= Math.exp(-6 * dt);
    if (f.t > (f.flat > .2 ? 99 : .85)) {
      if (f.hp <= 0 && f.spec && f.spec.revive && !f.revived) { f.revived = 1; f.hp = Math.round(f.maxhp * .5); f.state = 'getup'; f.t = 0; f.inv = .6; textFx(f.x, 1.9, f.z, pick(['まだ帰れない…', '残業…', '閉園…しない']), COL.green, 1.8, .9); ringFx(f.x, .05, f.z, .3, 2, .4, COL.green, 'ground'); sfx.blink(); }
      else if (f.hp <= 0) { if (G.mode !== 'vs') { f.state = 'dead'; f.t = 0; onDeath(f); } /* 対戦は寝たまま */ }
      else { f.state = 'getup'; f.t = 0; }
    }
  } else if (S === 'getup') {
    if (f.t > SD(f, 'getup', .45)) { f.state = 'idle'; f.t = 0; f.inv = Math.max(f.inv, .7); }
  } else if (S === 'dead') {
    if (f.t > 1.3 && f.team === 'enemy' && f.alive) { f.alive = false; fxExplode(f); }   // 敵は爆発して消える
    if (f.t > 1.6 && f.team !== 'enemy' && G.mode === 'coop') respawn(f);
  } else if (S === 'grab') {
    f.grabT += dt; f.vx = f.vz = 0;
    const v = f.victim;
    if (!v || v.state !== 'grabbed') { f.victim = null; f.state = 'idle'; }
    else {
      v.x = f.x + f.face * .62; v.z = f.z;
      if (c.atk) {
        if (Math.abs(c.mx) > .5) { f.face = Math.sign(c.mx); startMove(f, 'throw'); f.vx = 0; }
        else { startMove(f, 'knee'); f.vx = 0; }
      } else if (f.grabT > 1.8) releaseGrab(f);
    }
  } else if (S === 'grabbed') {
    f.vx = f.vz = 0;
    if (c.atk || c.jump || c.sp) f.escape++;
    if (!f.holder || f.holder.victim !== f) { f.state = 'idle'; f.holder = null; }
    else if (f.escape >= 7 || f.t > 2.4) releaseGrab(f.holder);
  }
  // 物理
  f.x += f.vx * dt; f.z += f.vz * dt;
  f.gspd = Math.hypot(f.vx, f.vz);
  const fl = f.spec?.flyer && f.alive && !downish(f.state) && f.state !== 'grabbed' ? f.spec.flyer : 0;
  if (fl) {   // 飛ぶ敵: 決まった高さに浮く。急降下の技の間だけ低く下りる
    const m = f.move, low = m && m.dive && f.state === m.key ? Math.sin(Math.PI * clamp((f.t - m.a[0] + .22) / (m.a[1] - m.a[0] + .44), 0, 1)) : 0;
    const ty = fl - (fl - .2) * low; f.y += (ty - f.y) * Math.min(1, dt * (low ? 10 : 3.5)); f.vy = 0;
  } else if (f.y > 0 || f.vy > 0) {
    f.vy -= GRAV * dt; f.y += f.vy * dt;
    if (f.y <= 0) { f.y = 0; f.vy = 0; f.landed = true; }
  }
  if (!(f.ai && f.ai.door)) f.z = clamp(f.z, Z_MIN, Z_MAX);
  if (f.team !== 'enemy' || G.mode === 'vs') f.x = clamp(f.x, G.camX - halfW + .55, G.camX + halfW - .55);
  else if (f.ai && f.ai.enterT <= 0 && f.state !== 'thrown' && f.state !== 'knock') f.x = clamp(f.x, G.camX - halfW + .45, G.camX + halfW - .45);   // 入ってきた敵は画面から出ない
  else f.x = clamp(f.x, -12, STAGE_END + 5.8);
}
function separate() {
  const list = fighters.filter(f => f.alive && f.y < .2 && !downish(f.state) && f.state !== 'grab' && f.state !== 'grabbed' && !DODGES.has(f.state));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j], dx = b.x - a.x, dz = b.z - a.z, r = .42 * (a.scl + b.scl) / 2;
    if (Math.abs(dz) < .28 && Math.abs(dx) < r) { const p = (r - Math.abs(dx)) * .5 * (Math.sign(dx) || 1); a.x -= p; b.x += p; }
  }
}
function bossQuake(f) {
  shake(.4); sfx.thud(); sfx.brk(); fxDown(f, true); ringFx(f.x, .05, f.z, .5, 4.6, .55, COL.pink, 'ground'); ringFx(f.x, .05, f.z, .3, 3.2, .4, COL.white, 'ground', 1, .7);
  for (const b of fighters) {
    if (!b.alive || !hostile(f, b) || b.y > .3 || b.inv > 0 || downish(b.state)) continue;
    if (Math.abs(b.x - f.x) < 2.3 && Math.abs(b.z - f.z) < 1.1) applyHit(f, b, { dmg: 9, knock: 1, kb: 3, heavy: 1, dir: Math.sign(b.x - f.x) || 1 });
  }
}

// =========================================================================================
// 敵の頭（AI）
// =========================================================================================
const DIFF_E = [0.5, 0.8, 1.15];   // 共闘のとき、敵の攻撃力
function nearestHero(e) {
  let best = null, bd = 1e9;
  for (const h of heroes()) {
    if (!h.alive || h.out || h.state === 'dead') continue;
    const d = Math.abs(h.x - e.x) + Math.abs(h.z - e.z) * 1.5 + (downish(h.state) ? 3 : 0);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}
function aiEnemy(e, dt, engaged) {
  const c = e.ctrl; c.atk = c.jump = c.sp = false; c.mx = c.mz = 0;
  const A = e.ai; A.think -= dt;
  A.guardT = (A.guardT || 0) - dt; c.guard = A.guardT > 0;
  if (e.state === 'jump' && A.autoKick && e.t > .2) { c.atk = true; A.autoKick = false; }
  if (e.state !== 'idle' && e.state !== 'walk') return;
  if (A.enterT > 0) {   // 画面の外から歩いて入ってくる（扉から出てくる敵は、奥から手前へ）
    A.enterT -= dt;
    if (A.door) { A.wait = (A.wait || 0) - dt; c.mx = 0; c.mz = A.wait > 0 ? 0 : clamp(2.1 / (e.spd * .66), 1, 2.8); if (A.enterT <= 0 || e.z > Z_MIN + .25) { A.door = null; A.enterT = 0; } }
    else c.mx = Math.sign(G.camX - e.x);
    return;
  }
  const tgt = nearestHero(e); if (!tgt) return;
  const sp = e.spec, side = Math.sign(e.x - tgt.x) || (e.id % 2 ? 1 : -1);
  const eng = engaged.has(e);
  // keepAway のある敵（鉄砲・魔女・飛ぶ敵）は近づかず、決まった距離を保つ。撃てるときだけ同じ列に並ぶ
  const want = sp.keepAway ? sp.keepAway + (e.id % 3) * .4 : eng ? sp.reach * .78 * Math.sqrt(sp.scale) : 2.5 + (e.id % 3) * .55;
  const gx = tgt.x + side * want, gz = sp.keepAway ? clamp(tgt.z + (e.shotCd > .8 && !sp.diver ? A.zoff : 0), Z_MIN, Z_MAX) : eng ? tgt.z : clamp(tgt.z + A.zoff, Z_MIN, Z_MAX);
  const dx = gx - e.x, dz = gz - e.z;
  c.mx = Math.abs(dx) > .15 ? Math.sign(dx) * Math.min(1, Math.abs(dx) + .3) : 0;
  c.mz = Math.abs(dz) > .12 ? Math.sign(dz) * Math.min(1, Math.abs(dz) + .3) : 0;
  const adx = Math.abs(tgt.x - e.x), adz = Math.abs(tgt.z - e.z);
  const tgtOK = !downish(tgt.state) && tgt.inv <= 0;
  // 止まって向き直る
  if (adx < want + .35 && Math.abs(c.mx) < .6) { c.mx = 0; }
  const faceT = -side;
  // 相手が殴りかかってきたら、ときどき受け止める（技 1 回につき 1 回だけ判断する）
  if (sp.guard && tgt.move && !tgt.move.air && tgt.moveSeq !== A.seenSeq) {
    A.seenSeq = tgt.moveSeq;
    if (tgt.face === side && adx < (tgt.move.reach || 1) + .6 && adz < .5 && Math.random() < sp.guard * (G.diff === 2 ? 1.5 : G.diff === 0 ? .6 : 1)) { A.guardT = rnd(.4, .7); c.guard = true; e.face = faceT; c.mx = c.mz = 0; return; }
  }
  // 殴りかかられたら、ときどき後ろへ跳んでかわす（ボクサー）
  if (sp.dodger && tgt.move && !tgt.move.air && tgt.moveSeq !== A.seenSeq2) {
    A.seenSeq2 = tgt.moveSeq;
    if (tgt.face === side && adx < (tgt.move.reach || 1) + .5 && adz < .5 && e.dodgeCd <= 0 && Math.random() < sp.dodger) { e.face = faceT; startDodge(e, 0, 0); A.think = .1; e.cool = Math.min(e.cool, .2); return; }
  }
  if (e.cool > 0 || A.think > 0 || !tgtOK) { if (!c.mx) e.face = faceT; return; }
  if (aiType(e, A, c, sp, tgt, adx, adz, faceT)) return;
  // 大技: 突進・ジャンプ・地震・飛び道具・衝撃波
  if (sp.dasher && adx > 2 && adx < 3.8 && adz < .3 && Math.random() < (sp.boss ? .05 : .03)) { e.face = faceT; startMove(e, 'edash'); e.cool = 1.4; A.think = .5; return; }
  if (sp.jumper && adx > 1.4 && adx < 3.2 && adz < .35 && Math.random() < .04) { e.face = faceT; e.state = 'jump'; e.t = 0; e.vy = JUMP_V * .9; e.vx = faceT * 4.2; e.jk = false; A.autoKick = true; e.cool = 1.2; A.think = .6; return; }
  if (sp.slammer && adx < 4.5 && Math.random() < .012) { e.face = faceT; e.state = 'bjump'; e.t = 0; e.vy = 9.5; e.vx = (tgt.x - e.x) * .75; e.vz = (tgt.z - e.z) * .75; e.move = null; e.cool = 2; A.think = .8; say('bossSlam'); return; }
  if (sp.shooter && e.shotCd <= 0 && adx > 2.8 && adx < (sp.range || 6.5) && adz < .3 && Math.random() < .03 * sp.shooter) { e.face = faceT; c.mx = c.mz = 0; startMove(e, 'erange'); e.shotCd = sp.shotCd || (sp.boss ? 3.2 : 4.5); e.cool = 1.2; A.think = .5; return; }
  if (sp.burst && adx < 1.7 && adz < .9 && Math.random() < (heroes().filter(h => h.alive && !h.out && Math.hypot(h.x - e.x, (h.z - e.z) * 1.4) < 1.9).length >= 2 ? .012 : .002)) { e.face = faceT; startMove(e, 'eburst'); e.cool = 2.4; A.think = .6; return; }
  if (eng && !sp.noMelee && adx < sp.reach * .98 * Math.sqrt(sp.scale) && adz < .38) {
    e.face = faceT; c.mx = c.mz = 0;
    const r = Math.random();
    const mk = sp.kungfu && r < .16 ? 'ekf1' : sp.kungfu && r < .32 ? 'ekf2' : sp.heavyAtk && r < .62 ? 'eheavy' : Math.random() < .5 ? 'eatk' : 'eatk2';
    startMove(e, e.moves && !e.moves[mk] ? 'eatk' : mk);   // そのパックに無い技は、ふつうの攻撃で代用
    e.cool = rnd(.6, 1.3) * (sp.boss ? .7 : 1) / (G.diff === 2 ? 1.25 : G.diff === 0 ? .8 : 1);
    A.think = rnd(.1, .4);
  }
}

// =========================================================================================
// Claude の頭（相棒・対戦相手）: 1P と同じ「コントローラー入力」を作って動かす
// =========================================================================================
const DIFF_AI = [
  { react: .38, mash: .26, dodge: .08, kick: .12, sp: .25, grab: .1, guard: .12, shot: .12 },
  { react: .22, mash: .16, dodge: .22, kick: .22, sp: .45, grab: .25, guard: .32, shot: .25 },
  { react: .12, mash: .11, dodge: .42, kick: .32, sp: .65, grab: .4, guard: .55, shot: .4 },
];
function aiClaude(f, dt) {
  const A = f.ai, c = f.ctrl, D = DIFF_AI[G.diff];
  c.atk = c.jump = c.sp = c.rng = c.dodge = c.duo = c.sup = false;
  A.t -= dt; A.atkT -= dt; A.duoCd = (A.duoCd || 0) - dt;
  A.guardT = (A.guardT || 0) - dt; c.guard = A.guardT > 0; c.run = !!A.run;
  if (f.state === 'grabbed') { if (Math.random() < dt * 9) c.atk = true; return; }
  if (f.state === 'grab') { A.kneeT = (A.kneeT || 0) - dt; if (A.kneeT <= 0) { A.kneeT = .3; c.atk = true; if (f.knees >= 1 && Math.random() < .4) c.mx = f.face; } return; }
  if (f.state === 'jump') { if (A.kickAt > 0) { A.kickAt -= dt; if (A.kickAt <= 0) c.atk = true; } return; }
  if (f.state === 'guard' || f.state === 'guardhit') { c.mx = c.mz = 0; return; }
  if (f.state !== 'idle' && f.state !== 'walk') { c.mx = c.mz = 0; return; }
  // 殴りかかられた・飛び道具が来た → 受け止めるか、よける（技 1 回につき 1 回だけ判断する）
  for (const h of fighters) {
    if (!h.alive || !hostile(f, h) || !h.move || h.move.air || h.moveSeq === (A.seen || (A.seen = {}))[h.id]) continue;
    const adx = Math.abs(h.x - f.x), adz = Math.abs(h.z - f.z);
    if (h.face !== Math.sign(f.x - h.x) || adz > .55 || adx > (h.move.shot ? 7 : (h.move.reach || 1) * Math.sqrt(h.scl) + .9)) continue;
    A.seen[h.id] = h.moveSeq;
    if (Math.random() > D.guard) continue;
    f.face = Math.sign(h.x - f.x) || f.face; c.mx = c.mz = 0; A.run = c.run = false;
    if (h.move.heavy || h.move.dash) { c.dodge = true; if (Math.random() < .6) c.mz = f.z > 0 ? -1 : 1; }   // 重い技・突進は受けずによける
    else { A.guardT = h.move.shot ? .9 : .5; c.guard = true; }
    A.t = .12; return;
  }
  const P1 = G.p1;
  let tgt = null;
  if (G.mode === 'vs') tgt = (P1.alive && P1.state !== 'dead') ? P1 : null;
  else {
    let bd = 1e9;
    for (const e of enemies()) {
      if (e.state === 'dead' || e.ai?.enterT > 0 && Math.abs(e.x - G.camX) > halfW) continue;
      let d = Math.abs(e.x - f.x) + Math.abs(e.z - f.z) * 1.6 + (downish(e.state) ? 2.5 : 0);
      if (e.state === 'grabbed') d += 4;
      if (P1 && Math.abs(e.x - P1.x) < 1.6) d -= 1.2;   // 1P を狙っている敵を優先
      if (d < bd) { bd = d; tgt = e; }
    }
  }
  // 体力が減ったら食べ物へ
  if (G.mode === 'coop' && f.hp < f.maxhp * .45) {
    const food = items.find(it => it.kind !== 'coin' && Math.abs(it.x - G.camX) < halfW - .5);
    if (food && (!tgt || Math.abs(tgt.x - f.x) > 1.3)) tgt = { x: food.x, z: food.z, isItem: true, state: 'idle' };
  }
  // 近くに武器が落ちていたら拾いに行く（敵が目の前にいないとき。1P のそばにある物は 1P にゆずる）
  if (G.mode === 'coop' && !f.weapon && (!tgt || (!tgt.isItem && Math.abs(tgt.x - f.x) > 1.8))) {
    const gw = gweapons.find(w => !w.fly && w.y <= 0 && !WEAPONS[w.kind].nopick && Math.abs(w.x - f.x) < 3.4 && Math.abs(w.x - G.camX) < halfW - .5 && (P1.weapon || P1.out || Math.hypot(w.x - P1.x, w.z - P1.z) > 1.6));
    if (gw) {
      if (Math.abs(gw.x - f.x) < .55 && Math.abs(gw.z - f.z) < .35) { c.mx = c.mz = 0; c.atk = true; A.run = c.run = false; A.t = .25; return; }
      tgt = { x: gw.x, z: gw.z, isItem: true, state: 'idle' };
    }
  }
  if (A.t > 0) return;   // 反応の遅れ（強さで変わる）
  A.t = D.react * rnd(.6, 1.3);
  A.run = false;
  if (!tgt && (P1.out || !P1.alive)) { c.mx = G.mode === 'coop' && !G.area ? 1 : 0; c.mz = 0; A.run = c.run = false; return; }   // 1P がいないときは、ひとりで先へ進む
  if (!tgt) {   // 敵がいないときは 1P のそばへ
    const gx = P1.x - P1.face * 1.3 + (G.go ? 1.8 : 0), gz = P1.z + (P1.z > 0 ? -.9 : .9);
    const dx = gx - f.x, dz = gz - f.z;
    A.mx = Math.abs(dx) > .5 ? Math.sign(dx) : 0; A.mz = Math.abs(dz) > .3 ? Math.sign(dz) * .8 : 0;
    c.mx = A.mx; c.mz = A.mz; A.run = c.run = Math.abs(dx) > 3.5; return;
  }
  if (tgt.isItem) { c.mx = Math.abs(tgt.x - f.x) > .15 ? Math.sign(tgt.x - f.x) : 0; c.mz = Math.abs(tgt.z - f.z) > .1 ? Math.sign(tgt.z - f.z) : 0; A.run = c.run = Math.abs(tgt.x - f.x) > 2.5; return; }
  const side = Math.sign(f.x - tgt.x) || -1;
  const adx = Math.abs(tgt.x - f.x), adz = Math.abs(tgt.z - f.z);
  const gx = tgt.x + side * .82, dx = gx - f.x, dz = tgt.z - f.z;
  c.mx = Math.abs(dx) > .18 ? Math.sign(dx) : 0;
  c.mz = Math.abs(dz) > .12 ? Math.sign(dz) * Math.min(1, Math.abs(dz) * 2 + .3) : 0;
  const tgtOK = !downish(tgt.state) && !(tgt.inv > 0);
  if (G.mode === 'coop' && (f.meter || 0) >= 100 && A.duoCd <= 0) {   // ゲージ技
    const es = enemies().filter(e => e.state !== 'dead' && onScreen(e.x)), big = es.find(e => e.spec.boss || e.spec.mid);
    if (f.meter >= METER_MAX && (big || es.length >= 3)) { c.mx = c.mz = 0; c.sup = true; A.duoCd = 2; A.t = .3; return; }
    if (!(big && f.meter >= 200) && tgtOK && adx < 2.6 && adz < .8 && tgt.y < .5 && tgt.hp > 28) { c.mx = c.mz = 0; c.duo = true; A.duoCd = rnd(7, 12); A.t = .3; return; }
  }
  if (tgt.y > .9 && tgtOK && adz < .4) {
    if (adx < 1.7) { f.face = Math.sign(tgt.x - f.x) || f.face; c.mx = f.face * .7; c.mz = 0; c.jump = true; A.kickAt = .2; A.t = .45; return; }
    if (adx > 2.4 && adx < 7 && f.shotCd <= 0) { f.face = Math.sign(tgt.x - f.x) || f.face; c.mx = c.mz = 0; c.rng = true; A.t = .5; return; }
  }
  // 囲まれたら必殺（ときどき前へ進む竜巻のほう）
  if (G.mode === 'coop') {
    const near = enemies().filter(e => !downish(e.state) && Math.hypot(e.x - f.x, (e.z - f.z) * 1.4) < 1.35).length;
    if (near >= 2 && f.hp > 30 && Math.random() < D.sp) { c.sp = true; c.mx = Math.random() < .35 ? -side : 0; c.run = false; return; }
  } else if (adx < 1.2 && adz < .5 && f.hp > 35 && Math.random() < D.sp * .15) { c.sp = true; c.mx = 0; c.run = false; return; }
  // 遠くて同じ列にいるなら気弾
  if (tgtOK && adz < .28 && adx > 2.8 && adx < 6.5 && f.shotCd <= 0 && Math.random() < D.shot) { f.face = -side; c.mx = 0; c.mz = f.hp > 50 && Math.random() < .3 ? 1 : 0; c.rng = true; c.run = false; return; }
  // 遠いときは走って近づき、そのまま飛び蹴り
  if (adx > 3.2 && c.mx) { A.run = c.run = true; }
  if (tgtOK && A.runWas && adz < .3 && adx > 1.4 && adx < 2.6 && c.mx === -side && Math.random() < .6) { A.run = c.run = true; c.atk = true; A.runWas = false; return; }
  A.runWas = A.run;
  // 飛び蹴り
  if (tgtOK && adz < .3 && adx > 1.6 && adx < 2.5 && Math.random() < D.kick) { f.face = -side; c.mx = -side; c.jump = true; c.run = false; A.kickAt = .2; return; }
  // 殴れる距離
  if (adx < 1.1 && adz < .36) {
    if (f.face !== -side) c.mx = -side * .05;   // その場で向き直る
    else {
      c.mx = 0; c.mz = 0;
      if (tgtOK && A.atkT <= 0) {
        if (!tgt.spec?.nograb && adx < .7 && Math.random() < D.grab * .5) c.mx = -side;   // 歩いて近づいてつかむ
        else {
          c.atk = true; A.atkT = D.mash * rnd(.7, 1.2);
          if (f.comboNext === 'fin' && f.comboT > 0) { const r = Math.random(); if (r < .3) c.mz = -1; else if (r < .55) c.mx = -side; }   // とどめを 3 種類から選ぶ
        }
      }
    }
    A.t = Math.min(A.t, .06);
  }
}

// =========================================================================================
// 小道具・アイテム・演出
// =========================================================================================
let PID = 0;
function makeProp(x, z, drop) {
  const g = new T.Group();
  const tex = canvasTex(128, 128, (c, w, h) => { c.fillStyle = stageTheme === 'factory' ? '#3f6f8f' : '#d0551c'; c.fillRect(0, 0, w, h); c.fillStyle = stageTheme === 'factory' ? '#FF3D3D' : '#FFCE4A'; c.fillRect(0, 24, w, 14); c.fillRect(0, h - 38, w, 14); c.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 30; i++) c.fillRect(Math.random() * w, Math.random() * h, 3, 3); });
  const m = new T.Mesh(new T.CylinderGeometry(.34, .34, .95, 16), new T.MeshLambertMaterial({ map: tex }));
  m.position.y = .475; g.add(m); g.position.set(x, 0, z); scene.add(g);
  const sh = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.set(x, .015, z); scene.add(sh);
  props.push({ id: ++PID, x, z, hp: 2, g, sh, drop, wob: 0 });
}
function breakProp(p) {
  p.broken = true; scene.remove(p.g); scene.remove(p.sh); sfx.brk(); shake(.12); fxBreak(p);
  for (let i = 0; i < 10; i++) debris(p.x, .5, p.z, 0xd0551c);
  if (p.drop === 'banana') { for (let i = 0; i < 3; i++) addBanana(clamp(p.x + rnd(-1.3, 1.3), G.camX - halfW + .8, G.camX + halfW - .8), clamp(p.z + rnd(-.8, .8), Z_MIN + .2, Z_MAX - .2)); }
  else if (WEAPONS[p.drop]) spawnWeapon(p.drop, p.x, p.z, null, { y: .6, vy: 4.2, spin: 8 }); else spawnItem(p.x, p.z, p.drop);
}
// =========================================================================================
// 武器: 地面に落ちている物を拾って（その上で攻撃ボタン）、殴る・投げる（気弾ボタン）
// =========================================================================================
// dmg = 3 段の威力 / reach = 届く距離 / uses = 当てられる回数 / thr = 投げたときの威力 / len = 長さ
const WEAPONS = {
  stick:   { name: '棒',             dmg: [8, 9, 14],   reach: 1.55, uses: 10, thr: 10, len: 1.13, snd: 'wood', word: 'wood', col: 0x8a5a2b },
  bat:     { name: 'バット',         dmg: [10, 11, 19], reach: 1.5,  uses: 12, thr: 12, len: .9,   snd: 'wood', word: 'wood', col: 0xd9b27a, homer: 1 },      // 3 発目は場外ホームラン
  pipe:    { name: '鉄棒',           dmg: [12, 13, 21], reach: 1.6,  uses: 14, thr: 14, len: 1.16, snd: 'pipe', word: 'metal', col: 0x9aa3b5 },
  stone:   { name: '石',             dmg: [9, 9, 14],   reach: 1.05, uses: 5,  thr: 22, len: .22,  snd: 'rock', word: 'rock', col: 0x8d909c, tosser: 1 },     // 投げると強い
  trash:   { name: 'ゴミ箱',         dmg: [13, 13, 20], reach: 1.4,  uses: 5,  thr: 18, len: .62,  snd: 'can',  word: 'can', col: 0x4d6f8f, bash: 1, tosser: 1 },   // 当たれば必ず吹っ飛ぶ
  knuckle: { name: 'メリケンサック', mul: 1.6, uses: 24, thr: 16, snd: 'pipe', word: 'metal', col: 0xffce4a },                                                          // こぶしの技が 1.6 倍
};
WEAPONS.trash.hold = { flip: 1, p: [.25, .58, 0] }; WEAPONS.stone.hold = { p: [0, .1, 0] };
WEAPONS.drum = { name: 'ドラム缶', thr: 12, uses: 1, len: .9, snd: 'can', word: 'can', col: 0xd0551c, nopick: 1 };
const KNUCKLE_MOVES = new Set(['jab1', 'jab2', 'fin', 'jpunch', 'special']);
const armed = (f) => f.weapon && WEAPONS[f.weapon.kind].dmg ? WEAPONS[f.weapon.kind] : null;   // 振り回せる武器を持っているか
let gweapons = [];   // 地面にある武器・飛んでいる武器

// 形: 握るところを原点に、先が上（+Y）へ伸びるように作る
function weaponMesh(kind) {
  const g = new T.Group(), L = (c, e = 0) => new T.MeshLambertMaterial({ color: c, emissive: e });
  const cyl = (rb, rt, h, m, y) => { const me = new T.Mesh(new T.CylinderGeometry(rt, rb, h, 10), m); me.position.y = y; g.add(me); return me; };
  const box = (w, h, d, m, x, y, z) => { const me = new T.Mesh(new T.BoxGeometry(w, h, d), m); me.position.set(x, y, z); g.add(me); return me; };
  if (kind === 'drum') { const m = L(0xd0551c), b = L(0xffce4a); cyl(.33, .33, .9, m, 0); cyl(.345, .345, .1, b, .28); cyl(.345, .345, .1, b, -.28); cyl(.3, .3, .92, L(0x8a3510), 0); }
  else if (kind === 'stick') { cyl(.034, .028, 1.25, L(0x8a5a2b), .505); cyl(.033, .033, .1, L(0xc9a36a), 1.08); }
  else if (kind === 'bat') { cyl(.046, .046, .03, L(0x3a2a1c), -.1); cyl(.026, .026, .3, L(0x3a2a1c), .05); cyl(.028, .07, .62, L(0xd9b27a), .51); const top = new T.Mesh(new T.SphereGeometry(.07, 10, 6), L(0xd9b27a)); top.position.y = .82; g.add(top); }
  else if (kind === 'pipe') { const m = L(0x9aa3b5, 0x1a1d26), j = L(0x6a7285); cyl(.04, .04, 1.3, m, .51); box(.13, .1, .13, j, 0, 1.16, 0); box(.2, .075, .09, j, .08, 1.16, 0); box(.1, .06, .1, j, 0, -.12, 0); }
  else if (kind === 'stone') { const s = new T.Mesh(new T.DodecahedronGeometry(.17, 0), L(0x8d909c)); s.scale.set(1.15, .85, 1); s.position.y = .12; g.add(s); }
  else if (kind === 'trash') {
    const m = new T.MeshLambertMaterial({ color: 0x4d6f8f, side: T.DoubleSide }), d = L(0x2f4660);
    const b = new T.Mesh(new T.CylinderGeometry(.27, .21, .6, 14, 1, true), m); b.position.y = .3; g.add(b);
    cyl(.21, .21, .03, d, .015); cyl(.285, .285, .05, d, .59); cyl(.25, .25, .03, d, .3);
  } else if (kind === 'umbrella') { cyl(.018, .018, 1.12, L(0x20222c), .45); box(.11, .03, .03, L(0x8a5a2b), .045, -.11, 0); box(.03, .1, .03, L(0x8a5a2b), .09, -.07, 0); const cn = new T.Mesh(new T.ConeGeometry(.085, .78, 10), L(0x2f6fd0, 0x0a1a3a)); cn.position.y = .6; g.add(cn); cyl(.01, .01, .1, L(0xc2c8d4), 1.04); }
  else if (kind === 'mallet') { cyl(.028, .028, .82, L(0xffe14a, 0x4a3a00), .3); const hd = new T.Mesh(new T.CylinderGeometry(.17, .17, .46, 14), L(0xff3d6e, 0x4a0818)); hd.rotation.z = Math.PI / 2; hd.position.y = .74; g.add(hd); for (const sx of [-.2, .2]) { const r = new T.Mesh(new T.CylinderGeometry(.18, .18, .06, 14), L(0xffe14a, 0x4a3a00)); r.rotation.z = Math.PI / 2; r.position.set(sx, .74, 0); g.add(r); } }
  else if (kind === 'clockhand') { const m = L(0x1a1c26, 0x0a0a10); box(.075, 1.2, .02, m, 0, .52, 0); box(.2, .2, .02, m, 0, 1.08, 0).rotation.z = .785; box(.14, .14, .03, L(0xffce4a, 0x4a3a00), 0, -.02, 0).rotation.z = .785; cyl(.03, .03, .06, L(0xc8102a), -.02).rotation.x = Math.PI / 2; }
  else { const m = L(0xffce4a, 0x5a3c00); box(.24, .05, .06, m, 0, .03, 0); for (let i = 0; i < 4; i++) { const r = new T.Mesh(new T.TorusGeometry(.032, .014, 6, 10), m); r.position.set(-.09 + i * .06, .075, 0); g.add(r); } }
  return g;
}
function fistMesh() { const g = new T.Group(), m = new T.MeshLambertMaterial({ color: 0xffce4a, emissive: 0x6a4400 }); const b = new T.Mesh(new T.BoxGeometry(.12, .06, .15), m); b.position.y = .03; g.add(b); return g; }
// ---- 地面に置く・落とす・飛ばす ----
function spawnWeapon(kind, x, z, uses, o = {}) {
  const g = weaponMesh(kind); scene.add(g);
  const gl = new T.Mesh(new T.PlaneGeometry(1.5, 1.1), new T.MeshBasicMaterial({ map: radialTex, color: 0xffd76a, transparent: true, opacity: .3, depthWrite: false, blending: T.AdditiveBlending })); gl.rotation.x = -Math.PI / 2; scene.add(gl);
  const w = { kind, uses: uses ?? WEAPONS[kind].uses, g, gl, x, y: o.y || 0, z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, head: rnd(-.5, .5), rot: 0, spin: o.spin || 0, fly: o.fly || null, t: rnd(0, 6), bounced: 0 };
  gweapons.push(w); return w;
}
function killWeapon(w) { scene.remove(w.g); scene.remove(w.gl); const i = gweapons.indexOf(w); if (i >= 0) gweapons.splice(i, 1); }
function clearWeapons() { for (const w of gweapons) { scene.remove(w.g); scene.remove(w.gl); } gweapons = []; }
function unhold(f) { const w = f.weapon; if (!w) return null; f.weapon = null; scene.remove(w.g); if (w.g2) scene.remove(w.g2); if (f.trails?.wp) f.trails.wp.prev = null; return w; }
function holdWeapon(f, kind, uses) {
  unhold(f);
  const w = { kind, uses: uses ?? WEAPONS[kind].uses, g: kind === 'knuckle' ? fistMesh() : weaponMesh(kind), g2: kind === 'knuckle' ? fistMesh() : null, th: .45, ph: 0 };
  w.g.visible = false; scene.add(w.g); if (w.g2) { w.g2.visible = false; scene.add(w.g2); }
  f.weapon = w; return w;
}
function dropWeapon(f, dir = 0) {
  const w = unhold(f); if (!w || w.uses <= 0) return;
  spawnWeapon(w.kind, clamp(f.x + dir * .3, G.camX - halfW + .5, G.camX + halfW - .5), f.z, w.uses, { y: 1.0, vx: dir * rnd(1.2, 2.6), vy: rnd(3, 4.4), vz: rnd(-.6, .6), spin: rnd(-9, 9) });
}
function breakWeapon(f) {
  const w = unhold(f); if (!w) return; const W = WEAPONS[w.kind];
  sfx.wbreak(W.snd); for (let i = 0; i < 9; i++) debris(f.x + f.face * .5, 1.1, f.z, W.col);
  if (f.team !== 'enemy') toastAt(f, W.name + ' がこわれた！');
}
// 足もとの武器（拾える距離にあるもの）
function nearWeapon(f, rx = .8, rz = .5) {
  let best = null, bd = 1e9;
  for (const w of gweapons) { if (w.fly || w.y > .25 || WEAPONS[w.kind].nopick) continue; const dx = Math.abs(w.x - f.x), dz = Math.abs(w.z - f.z); if (dx < rx && dz < rz && dx + dz < bd) { bd = dx + dz; best = w; } }
  return best;
}
function pickWeapon(f) {
  const w = nearWeapon(f); if (!w) return false;
  if (f.weapon) dropWeapon(f, -f.face);   // 持っていたものは、後ろへ置く
  killWeapon(w); holdWeapon(f, w.kind, w.uses);
  sfx.wpick(); toastAt(f, WEAPONS[w.kind].name + ' を拾った！'); ringFx(f.x, .05, f.z, .2, 1.3, .3, COL.gold, 'ground'); pillarFx(f.x, f.z, .3, 1.8, .3, COL.gold, .2);
  f.comboNext = null; f.comboT = 0; f.cool = .1;
  if (f.isClaude && Math.random() < .6) say('weapon', 1);
  return true;
}
function throwWeapon(f) {
  const w = unhold(f); if (!w) return;
  const sp = w.kind === 'stone' ? 14 : w.kind === 'trash' ? 9.5 : 12, y = Math.max(.9, w.g.position.y);
  spawnWeapon(w.kind, f.x + f.face * .5, f.z, w.uses, { y, vx: f.face * sp, vy: w.kind === 'trash' ? 3 : 1.9, spin: -f.face * 17, fly: { owner: f, team: f.team, hit: new Set(), spent: false } });
  sfx.swing(2); if (f.isClaude && Math.random() < .5) say('throw');
}
function updateWeapons(dt) {
  for (let i = gweapons.length - 1; i >= 0; i--) {
    const w = gweapons[i], W = WEAPONS[w.kind]; w.t += dt;
    const air = w.y > 0 || w.vy > 0;
    if (air) {
      w.vy -= (w.fly && !w.fly.spent ? 8 : GRAV) * dt; w.x += w.vx * dt; w.y += w.vy * dt; w.z = clamp(w.z + w.vz * dt, Z_MIN, Z_MAX); w.rot += w.spin * dt;
      const lo = G.camX - halfW + .4, hi = G.camX + halfW - .4;   // 画面の外へは出ない（拾えなくならないように）
      if (w.x > hi) { w.x = hi; w.vx *= -.25; if (w.fly) w.fly.spent = true; } else if (w.x < lo) { w.x = lo; w.vx *= -.25; if (w.fly) w.fly.spent = true; }
      if (w.fly && !w.fly.spent) {
        if (Math.random() < .7) streaks.add(w.x, w.y, w.z, -w.vx * .2, rnd(-.5, .5), 0, .14, .1, .03, 1, 1, 1, 0, 0);
        for (const b of fighters) {
          if (!b.alive || b.out || b.team === w.fly.team || b.inv > 0 || downish(b.state) || w.fly.hit.has(b.id)) continue;
          if (Math.abs(b.x - w.x) < .45 + .3 * b.scl && Math.abs(b.z - w.z) < .55 + (b.scl - 1) * .25 && w.y - b.y > -.65 && w.y - b.y < 2.0 * b.scl) {
            const dir = Math.sign(w.vx) || 1;
            w.fly.hit.add(b.id); w.fly.spent = true;
            applyHit(w.fly.owner, b, { dmg: W.thr, kb: 6.5, knock: 1, heavy: 1, dir, x: w.x, key: 'wthrow', wk: w.kind });
            w.vx = -dir * rnd(1, 2.2); w.vy = rnd(3.6, 5); w.spin *= -.6; break;
          }
        }
        if (!w.fly.spent && w.fly.team !== 'enemy') for (const p of props) {
          if (p.broken || Math.abs(p.x - w.x) > .55 || Math.abs(p.z - w.z) > .6 || w.y > 1.3) continue;
          p.hp -= 2; p.wob = .3; sfx.hit(false, 0, true); if (p.hp <= 0) breakProp(p); w.fly.spent = true; w.vx *= -.2; w.vy = 3; break;
        }
      }
      if (w.y <= 0) {
        w.y = 0; sfx.wland(W.snd);
        if (Math.abs(w.vy) > 2.6 && w.bounced < 2) { w.vy = -w.vy * .34; w.vx *= .5; w.bounced++; dust(w.x, w.z, .5); }
        else {
          w.vy = 0; w.vx = 0; w.vz = 0; w.spin = 0; w.bounced = 0;
          if (W.nopick && !w.fly) { sfx.wbreak(W.snd); for (let k = 0; k < 8; k++) debris(w.x, .3, w.z, W.col); killWeapon(w); continue; }   // 拾えない物は、落ちたらこわれる
          if (w.fly) { w.fly = null; w.uses--; if (w.uses <= 0) { sfx.wbreak(W.snd); for (let k = 0; k < 8; k++) debris(w.x, .3, w.z, W.col); killWeapon(w); continue; } }
        }
      }
    }
    const flat = w.kind === 'stick' || w.kind === 'bat' || w.kind === 'pipe';
    w.g.position.set(w.x + (!air && flat ? W.len * .45 : 0), w.y + (air ? .1 : flat ? .05 : 0), w.z);
    if (air) w.g.rotation.set(0, 0, w.rot); else if (flat) w.g.rotation.set(0, w.head, Math.PI / 2); else w.g.rotation.set(0, w.head, 0);
    w.gl.visible = !air; w.gl.position.set(w.x, .02, w.z); w.gl.material.opacity = .16 + .14 * Math.sin(w.t * 4);
  }
}
// ---- 武器を「握っている」ように見せる: 手首を回して握る軸を武器の向きに合わせ、指を握りこむ（VRM のキャラだけ。ロボの手は箱なのでそのまま）----
const _gF = new T.Vector3(), _gT = new T.Vector3(), _gN = new T.Vector3(), _gU = new T.Vector3(0, 1, 0), _gFd = new T.Vector3(), _gNw = new T.Vector3(), _gW = new T.Vector3(), _gM = new T.Vector3(), _gPn = new T.Vector3();
const _gMw = new T.Matrix4(), _gMl = new T.Matrix4(), _gQw = new T.Quaternion(), _gQp = new T.Quaternion(), _gQl = new T.Quaternion();
const GRIP_CURL = [['Index', 1.25, 1.45, .9], ['Middle', 1.3, 1.5, .9], ['Ring', 1.35, 1.5, .9], ['Little', 1.4, 1.5, .9]];
// mix = 1: 手首を回して、握る軸を dir に合わせる（振っている間）/ 0: 手首はモーションのまま。どちらでも、終わったとき dir は「実際の握りの軸」になっている
function gripHand(body, side, dir, fore, sc, out, mix = 1) {
  const hb = body.hb, hand = hb[side + 'Hand']; if (!hand || !body.vrm || !hand.parent) return false;
  const R = side === 'right';
  _gF.copy(hand.position); if (_gF.lengthSq() < 1e-8) return false; _gF.normalize();     // 骨の座標での「指の向き」（ひじ → 手首の延長）
  if (R) _gT.copy(_gU).cross(_gF); else _gT.copy(_gF).cross(_gU);                          // 親指側（握ったとき、武器の先が出る側）
  if (_gT.lengthSq() < 1e-6) return false; _gT.normalize(); _gN.copy(_gF).cross(_gT);
  hand.parent.getWorldQuaternion(_gQp);
  if (mix > 0) {   // 世界での向き: 握る軸 = 武器の向き。指は、できるだけ前腕の向きのまま
    _gFd.copy(fore).addScaledVector(dir, -fore.dot(dir));
    if (_gFd.lengthSq() < .06) { _gFd.set(0, 1, 0).addScaledVector(dir, -dir.y); if (_gFd.lengthSq() < .06) _gFd.set(1, 0, 0).addScaledVector(dir, -dir.x); }
    _gFd.normalize(); _gNw.copy(_gFd).cross(dir);
    _gMw.makeBasis(_gFd, dir, _gNw); _gMl.makeBasis(_gF, _gT, _gN).transpose(); _gMw.multiply(_gMl);
    _gQw.setFromRotationMatrix(_gMw); _gQl.copy(_gQp).invert().multiply(_gQw);
    if (mix >= 1) hand.quaternion.copy(_gQl); else hand.quaternion.slerp(_gQl, mix);
  }
  _gQw.copy(_gQp).multiply(hand.quaternion);   // 手の、世界での向き（できあがり）
  dir.copy(_gT).applyQuaternion(_gQw).normalize(); _gFd.copy(_gF).applyQuaternion(_gQw).normalize();
  const sg = R ? 1 : -1;
  for (const [n, a, b, c] of GRIP_CURL) {
    const p = hb[side + n + 'Proximal'], i = hb[side + n + 'Intermediate'], d = hb[side + n + 'Distal'];
    if (p) p.quaternion.setFromAxisAngle(_gT, sg * a); if (i) i.quaternion.setFromAxisAngle(_gT, sg * b); if (d) d.quaternion.setFromAxisAngle(_gT, sg * c);
  }
  const tm = hb[side + 'ThumbMetacarpal'] || hb[side + 'ThumbProximal'], td = hb[side + 'ThumbDistal'], tp = hb[side + 'ThumbMetacarpal'] ? hb[side + 'ThumbProximal'] : null;
  if (tm) tm.quaternion.setFromAxisAngle(_gF, sg * -.55); if (tp) tp.quaternion.setFromAxisAngle(_gN, sg * .5); if (td) td.quaternion.setFromAxisAngle(_gN, sg * .6);
  try { body.vrm.humanoid.update(); } catch (e) { return false; }
  // 握りの中心: 手首から指の付け根の少し手前、手のひら側へ少し
  const rw = body.rawBone(side + 'Hand'), rm = body.rawBone(side + 'MiddleProximal');
  if (!rw) return false;
  rw.updateWorldMatrix(true, false); _gW.setFromMatrixPosition(rw.matrixWorld);
  let len = .085 * sc; if (rm) { rm.updateWorldMatrix(true, false); _gM.setFromMatrixPosition(rm.matrixWorld); len = clamp(_gM.distanceTo(_gW), .05, .14); }
  _gPn.set(0, -1, 0).applyQuaternion(_gQw);
  out.copy(_gW).addScaledVector(_gFd, len * .92).addScaledVector(_gPn, .026 * sc);
  return true;
}
// ---- 持っている武器を手に合わせて動かす（構え → 振りかぶり → 振り抜き。技の当たり時間に合わせる）----
const _wd = new T.Vector3(), _wy = new T.Vector3(0, 1, 0);
function weaponSync(f, dt, freeze) {
  const w = f.weapon; if (!w) return;
  const body = f.body, W = WEAPONS[w.kind];
  if (!body || !body.limbPos || f.out || !f.alive || !body.root.visible) { w.g.visible = false; if (w.g2) w.g2.visible = false; return; }
  const mir = !!body.cur?.mir, hand = mir ? 'left' : 'right', sc = Math.min(1.35, f.scl);
  if (w.kind === 'knuckle') {   // 両手のこぶしに付ける
    [[w.g, 'right'], [w.g2, 'left']].forEach(([g, h]) => {
      if (!body.limbPos(h + 'LowerArm', h + 'Hand', _va, _vb)) { g.visible = false; return; }
      _vc.subVectors(_vb, _va).normalize(); g.position.copy(_vb).addScaledVector(_vc, (body.vrm ? .085 : .05) * sc); g.quaternion.setFromUnitVectors(_wy, _vc); g.scale.setScalar(sc); g.visible = true;
    });
    return;
  }
  if (!body.limbPos(hand + 'LowerArm', hand + 'Hand', _va, _vb)) { w.g.visible = false; return; }
  _vc.subVectors(_vb, _va).normalize();
  const m = f.move, S = f.state, L = (a, b, k) => a + (b - a) * k;
  let th = .45, ph = 0, snap = false, scripted = false;   // th = まっすぐ上から前へ倒す角度 / ph = 手前へ回す角度
  const human = !!body.vrm;   // VRM のキャラは、武器の技のあいだだけ向きを決める。ロボ（手が箱）は、いつも決めた向き
  if (m && S === m.key && !m.air && m.a[0] < 5 && (!human || m.weapon)) {
    scripted = true;
    const a0 = m.a[0], a1 = m.a[1], t = f.t, side = m.key === 'wsw2';
    if (t < a0) { const k = clamp(t / Math.max(.04, a0), 0, 1); th = side ? 1.45 : L(.45, -1.3, k); ph = side ? L(.3, 2.0, k) : 0; snap = k > .5; }
    else if (t <= a1) { const k = (t - a0) / Math.max(.03, a1 - a0); th = side ? 1.5 : L(-1.3, 2.15, k); ph = side ? L(2.0, -.9, k) : 0; snap = true; }
    else { const k = clamp((t - a1) / Math.max(.05, m.dur - a1), 0, 1); th = side ? 1.5 : L(2.15, .8, k); ph = side ? L(-.9, 0, k) : 0; }
  } else if (S === 'wthrow') { th = -1.1; scripted = true; }
  else if (S === 'guard' || S === 'guardhit') { th = -.15; ph = 1.0; }
  else if (S === 'hurt' || S === 'grabbed') th = 1.1;
  else if (S === 'walk' && f.fast) th = -.55;          // 走るときは肩にかつぐ
  else if (S === 'jump' || S === 'jkick' || S === 'jpunch') th = -.4;
  else if (S === 'win') th = -.1;
  const k = snap ? 1 : 1 - Math.exp(-dt * 20); w.th += (th - w.th) * k; w.ph += (ph - w.ph) * k;
  const st = Math.sin(w.th);
  _wd.set(f.face * st * Math.cos(w.ph), Math.cos(w.th), st * Math.sin(w.ph)).normalize();
  // 握りの位置: VRM は手首を回して握らせ、手のひらの中心へ。ロボは手の箱の中心へ
  const mt = !human || scripted ? 1 : 0; if (w.mix == null) w.mix = mt;
  w.mix = snap && mt ? 1 : w.mix + (mt - w.mix) * (1 - Math.exp(-dt * (mt ? 30 : 8)));
  if (!gripHand(body, hand, _wd, _vc, sc, _vb, w.mix)) _vb.addScaledVector(_vc, .06 * sc);
  const hp = W.hold;   // 持つ場所が端でない武器（ゴミ箱は口のふち、石は真ん中）
  w.g.quaternion.setFromUnitVectors(_wy, hp && hp.flip ? _va.copy(_wd).negate() : _wd); w.g.scale.setScalar(sc);
  if (hp) { _va.set(hp.p[0], hp.p[1], hp.p[2]).multiplyScalar(sc).applyQuaternion(w.g.quaternion); w.g.position.copy(_vb).sub(_va); } else w.g.position.copy(_vb);
  w.g.visible = true;
  // 振っている間は、先っぽに光の帯を引く
  const swing = !freeze && m && S === m.key && !m.air && m.a[0] < 5 && f.t > m.a[0] - .08 && f.t < m.a[1] + .06;
  if (swing) {
    if (!f.trails) f.trails = {};
    const t = f.trails.wp || (f.trails.wp = getTrail(COL.white)), p = w.g.position, l = W.len * sc;
    t.push(p.x + _wd.x * l * .3, p.y + _wd.y * l * .3, p.z + _wd.z * l * .3, p.x + _wd.x * l, p.y + _wd.y * l, p.z + _wd.z * l, f.team === 'enemy' ? .6 : .95);
  }
}
// 画面の文字: 武器のそばで「J ひろう」
function weaponHint() {
  const el = $('wphint'), P = G.p1;
  const w = P && G.phase === 'play' && (!P.weapon || P.weapon.kind === 'knuckle') && !P.out && P.alive && (P.state === 'idle' || P.state === 'walk') ? nearWeapon(P) : null;
  if (!w) { el.classList.remove('on'); return; }
  const [sx, sy] = toScreen(w.x, .75, w.z);
  el.textContent = 'J  ' + WEAPONS[w.kind].name + (P.weapon ? 'に持ちかえる' : 'を拾う'); el.style.left = sx + 'px'; el.style.top = sy + 'px'; el.classList.add('on');
}
const ITEM_INFO = { juice: { heal: 18, label: '5億年コーラ' }, onigiri: { heal: 30, label: 'おにぎり' }, ramen: { heal: 70, label: '5億年ラーメン' }, coin: { score: 1000, label: '金のボタン' } };
function spawnItem(x, z, kind, sub) {
  const g = new T.Group();
  if (kind === 'cap') capsuleMesh(g, sub);
  else if (kind === 'juice') {
    const cn = new T.Mesh(new T.CylinderGeometry(.11, .11, .32, 14), new T.MeshLambertMaterial({ color: 0xe8253a, emissive: 0x4a0810 })); cn.position.y = .3; cn.rotation.z = .25; g.add(cn);
    const bd = new T.Mesh(new T.CylinderGeometry(.113, .113, .1, 14), new T.MeshBasicMaterial({ color: 0xffffff })); bd.position.y = .3; bd.rotation.z = .25; g.add(bd);
  } else if (kind === 'onigiri') {
    const r = new T.Mesh(new T.ConeGeometry(.26, .34, 3), new T.MeshLambertMaterial({ color: 0xf6f4ee })); r.rotation.z = 0; r.position.y = .2; r.rotation.x = Math.PI / 2; r.rotation.set(0, 0, 0); g.add(r);
    const n = new T.Mesh(new T.BoxGeometry(.2, .14, .08), new T.MeshLambertMaterial({ color: 0x14231a })); n.position.set(0, .1, .1); g.add(n);
  } else if (kind === 'ramen') {
    const b = new T.Mesh(new T.CylinderGeometry(.3, .2, .22, 16), new T.MeshLambertMaterial({ color: 0xc8302f })); b.position.y = .12; g.add(b);
    const s = new T.Mesh(new T.CylinderGeometry(.27, .27, .02, 16), new T.MeshLambertMaterial({ color: 0xf2c46b })); s.position.y = .23; g.add(s);
  } else {
    const cn = new T.Mesh(new T.CylinderGeometry(.22, .22, .06, 20), new T.MeshLambertMaterial({ color: 0xffce4a, emissive: 0x553300 })); cn.rotation.x = Math.PI / 2; cn.position.y = .35; g.add(cn);
    const btn = new T.Mesh(new T.CylinderGeometry(.12, .12, .08, 20), new T.MeshBasicMaterial({ color: 0xff3d6e })); btn.rotation.x = Math.PI / 2; btn.position.set(0, .35, .02); g.add(btn);
  }
  g.position.set(x, 0, z); scene.add(g);
  const it = { x, z, kind, sub, g, t: 0, fall: 0 }; items.push(it); return it;
}
function updateItems(dt) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]; it.t += dt;
    if (it.fall > 0) it.fall = Math.max(0, it.fall - dt * 3.2);
    if (it.kind !== 'cap') it.g.rotation.y += dt * 2; else if (it.t > 14 && it.t < 18) it.g.visible = Math.floor(it.t * 8) % 2 === 0;
    it.g.position.y = Math.abs(Math.sin(it.t * 3)) * .12 + it.fall;
    if (it.kind === 'cap' && it.t > 18) { scene.remove(it.g); items.splice(i, 1); continue; }   // カプセルはしばらくすると消える
    for (const h of heroes()) {
      if (!h.alive || h.out || downish(h.state) || h.state === 'grabbed') continue;
      if (Math.abs(h.x - it.x) < .5 && Math.abs(h.z - it.z) < .4) {
        if (it.fall > .5) continue;
        if (it.kind === 'cap') { takeCapsule(h, it); scene.remove(it.g); items.splice(i, 1); break; }
        const info = ITEM_INFO[it.kind];
        if (info.heal && h.hp >= h.maxhp) continue;   // 満タンなら取らない
        if (info.heal) h.hp = Math.min(h.maxhp, h.hp + info.heal);
        if (info.score) h.score += info.score;
        if (it.kind === 'coin') sfx.coin(); else sfx.pick(); fxPickup(it.x, it.z, it.kind); numFx(h.x, 2.0, h.z, '+' + (info.heal || info.score), info.heal ? 'heal' : 'coin'); scene.remove(it.g); items.splice(i, 1);
        toastAt(h, '+' + info.label);
        if (h.isClaude) say('item');
        break;
      }
    }
  }
}
const sparkMat = new T.SpriteMaterial({ map: sparkTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
function spark(x, y, z, big) {
  const s = new T.Sprite(sparkMat.clone()); s.position.set(x, y, z); s.material.rotation = Math.random() * 6; scene.add(s);
  fx.push({ o: s, t: 0, dur: big ? .22 : .14, kind: 'spark', big });
}
function dust(x, z, size = 1) {
  ringFx(x, .04, z, .3 * size, 1.7 * size, .4, COL.smoke, 'ground', 1, .5);
  for (let i = 0; i < 6; i++) { const an = i / 6 * 6.28; smoke.add(x + Math.cos(an) * .2, .1, z + Math.sin(an) * .12, Math.cos(an) * 1.8 * size, rnd(.2, .6), Math.sin(an) * size, rnd(.35, .6), .25, .9 * size, COL.smoke[0], COL.smoke[1], COL.smoke[2], .32, -.2, 3); }
}
const debGeo = new T.BoxGeometry(.12, .12, .12);
function debris(x, y, z, col) {
  const m = new T.Mesh(debGeo, new T.MeshLambertMaterial({ color: col }));
  m.position.set(x, y, z); m.scale.setScalar(rnd(.7, 1.6)); scene.add(m);
  fx.push({ o: m, t: 0, dur: 1.1, kind: 'deb', v: new T.Vector3(rnd(-3.5, 3.5), rnd(3, 7), rnd(-1.5, 1.5)) });
}
function pxScale() {   // 粒の大きさを「画面の何ドットか」に直す係数
  if (xrOn()) { const l = renderer.xr.getSession()?.renderState?.baseLayer; if (l && l.framebufferHeight) return l.framebufferHeight * .5; }
  return renderer.getDrawingBufferSize(_v2).y * .5;
}
function updateFx(dt) {
  camera.getWorldPosition(_camP); camera.getWorldQuaternion(_camQ);
  for (let i = fx.length - 1; i >= 0; i--) {
    const e = fx[i]; e.t += dt; const k = Math.min(1, e.t / e.dur);
    if (e.kind === 'spark') { const s = (e.big ? 3.0 : 1.9) * (.4 + k * .8); e.o.scale.set(s, s, 1); e.o.material.opacity = 1 - k; }
    else if (e.kind === 'word') {   // 擬音: ドンと大きく出て、当てた向きへ少し流れて消える
      const pop = k < .13 ? k / .13 * 1.4 : k < .28 ? 1.4 - (k - .13) / .15 * .4 : 1, s = e.s * pop;
      e.o.scale.set(s, s * .5, 1); e.o.position.x += e.vx * dt * (1 - k); e.o.position.y += dt * .35;
      e.o.material.opacity = k > .6 ? 1 - (k - .6) / .4 : 1;
    }
    else if (e.kind === 'ring') { const s = e.r0 + (e.r1 - e.r0) * (1 - Math.pow(1 - k, 3)); e.o.scale.set(s * e.sx, s, 1); e.o.material.opacity = e.a * Math.pow(1 - k, 1.4); if (e.mode === 'cam') e.o.quaternion.copy(_camQ); }
    else if (e.kind === 'flash') { const s = e.s * (.55 + .7 * k); e.o.scale.set(s, s, 1); e.o.material.opacity = e.a * Math.pow(1 - k, 1.2); }
    else if (e.kind === 'pillar') { const r = e.r * (1 + .5 * k); e.o.scale.set(r, e.h * Math.min(1, k * 5), r); e.o.material.opacity = e.a * (1 - k); e.o.rotation.y += dt * 3; }
    else if (e.kind === 'num') {   // ポンと大きく出て → 縮んで落ち着き → 上へ消える
      const pop = k < .12 ? .4 + k / .12 * 1.1 : k < .26 ? 1.5 - (k - .12) / .14 * .5 : 1, s = e.s * pop;
      e.o.scale.set(s, s * .5, 1); e.o.position.y = e.y0 + (1 - Math.pow(1 - k, 2)) * (e.rise || .9); e.o.position.x += e.vx * dt * (1 - k);
      e.o.material.opacity = k > .68 ? 1 - (k - .68) / .32 : 1;
    }
    else if (e.kind === 'deb') { e.v.y -= GRAV * dt; e.o.position.addScaledVector(e.v, dt); if (e.o.position.y < .06) { e.o.position.y = .06; e.v.multiplyScalar(.5); e.v.y = Math.abs(e.v.y) * .4; } e.o.rotation.x += dt * 8; e.o.rotation.z += dt * 6; if (k > .75) e.o.scale.multiplyScalar(Math.max(0, 1 - dt * 6)); }
    else if (e.kind === 'fade') e.o.material.opacity = e.a * (k < .65 ? 1 : 1 - (k - .65) / .35);
    if (k >= 1) {
      if (e.kind === 'call') e.fn(); else { scene.remove(e.o); e.o.material?.dispose?.(); }
      fx.splice(i, 1);
    }
  }
  glow.mat.uniforms.uPx.value = smoke.mat.uniforms.uPx.value = flow.mat.uniforms.uPx.value = pxScale();
  glow.update(dt); smoke.update(dt); flow.update(dt); streaks.update(dt, _camP);
  for (const t of trails) if (!t.free || t.cnt) t.update(dt);
  for (const p of props) if (!p.broken && p.wob > 0) { p.wob -= dt; p.g.rotation.z = Math.sin(p.wob * 60) * p.wob * .5; }
}

// =========================================================================================
// 演出（パーティクル）: 火花・光の粒・煙・衝撃の輪・技の軌跡・光の柱・ダメージの数字
// =========================================================================================
const puffTex = canvasTex(128, 128, (x, w, h) => {   // もこもこした煙（小さい円をたくさん重ねる）
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * 6.28, r = Math.random() * 26, px = w / 2 + Math.cos(a) * r, py = h / 2 + Math.sin(a) * r, rr = 16 + Math.random() * 22;
    const g = x.createRadialGradient(px, py, 0, px, py, rr); g.addColorStop(0, 'rgba(255,255,255,.2)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  }
});
const ringTex = canvasTex(256, 256, (x, w, h) => {   // 衝撃の輪
  const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.6, 'rgba(255,255,255,0)'); g.addColorStop(.8, 'rgba(255,255,255,.35)'); g.addColorStop(.88, 'rgba(255,255,255,1)'); g.addColorStop(.94, 'rgba(255,255,255,.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
});
const streakTex = canvasTex(128, 32, (x, w, h) => {   // 火花の線（尾は消え、先が光る。上下の縁はやわらかく）
  const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.75, 'rgba(255,255,255,.6)'); g.addColorStop(1, 'rgba(255,255,255,1)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'destination-in';
  const v = x.createLinearGradient(0, 0, 0, h); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(.5, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = v; x.fillRect(0, 0, w, h);
});
const arcTex = canvasTex(64, 64, (x, w, h) => {   // 技の軌跡（v=0 が根もと、v=1 が先。先のふちが一番明るい）
  const v = x.createLinearGradient(0, h, 0, 0); v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(.55, 'rgba(255,255,255,.28)'); v.addColorStop(.86, 'rgba(255,255,255,1)'); v.addColorStop(1, 'rgba(255,255,255,.1)');
  x.fillStyle = v; x.fillRect(0, 0, w, h);
});
const pillarTex = canvasTex(32, 256, (x, w, h) => {   // 光の柱（下が明るく、上へ消える）
  const v = x.createLinearGradient(0, h, 0, 0); v.addColorStop(0, 'rgba(255,255,255,1)'); v.addColorStop(.35, 'rgba(255,255,255,.45)'); v.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = v; x.fillRect(0, 0, w, h);
});
const COL = { gold: [1, .78, .28], teal: [.22, 1, .84], pink: [1, .28, .5], red: [1, .16, .2], white: [1, 1, 1], blue: [.42, .74, 1], green: [.45, 1, .55], orange: [1, .5, .15], smoke: [.74, .78, .9], dark: [.2, .21, .28] };
const teamCol = (f) => f.team === 'enemy' ? COL.pink : f.isClaude ? COL.teal : COL.gold;
const _v2 = new T.Vector2(), _va = new T.Vector3(), _vb = new T.Vector3(), _vc = new T.Vector3(), _camP = new T.Vector3(), _camQ = new T.Quaternion();

// ---- 点の粒（光る粒＝加算 / 煙＝ふつうの重ね）。数千個を 1 回の描画で出す ----
class PointPool {
  constructor(n, tex, additive) {
    this.n = n; this.i = 0; this.additive = additive;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.par = new Float32Array(n * 8);   // 生まれたときの大きさ, 消えるときの大きさ, r, g, b, 濃さ, 重力, 空気抵抗
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('aColor', new T.BufferAttribute(this.col, 4).setUsage(T.DynamicDrawUsage));
    g.setAttribute('aSize', new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage));
    this.mat = new T.ShaderMaterial({
      uniforms: { map: { value: tex }, uPx: { value: 500 } },
      vertexShader: 'attribute float aSize; attribute vec4 aColor; varying vec4 vColor; uniform float uPx;\nvoid main(){ vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uPx * projectionMatrix[1][1] / max(0.1, -mv.z); }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vColor;\nvoid main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);\n#include <colorspace_fragment>\n}',
      transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending,
    });
    this.obj = new T.Points(g, this.mat); this.obj.frustumCulled = false; this.obj.renderOrder = additive ? 20 : 10; scene.add(this.obj);
  }
  add(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a = 1, grav = 0, drag = 0) {
    const i = this.i; this.i = (i + 1) % this.n;
    const p = i * 3, q = i * 8;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z; this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
    this.life[i] = this.max[i] = life;
    this.par[q] = s0; this.par[q + 1] = s1; this.par[q + 2] = r; this.par[q + 3] = g; this.par[q + 4] = b; this.par[q + 5] = a; this.par[q + 6] = grav; this.par[q + 7] = drag;
  }
  clear() { this.life.fill(0); this.size.fill(0); this.obj.geometry.attributes.aSize.needsUpdate = true; }
  update(dt) {
    const { pos, vel, life, max, par, col, size, n, additive } = this;
    for (let i = 0; i < n; i++) {
      if (life[i] <= 0) continue;
      const p = i * 3, q = i * 8, c = i * 4;
      life[i] -= dt;
      if (life[i] <= 0) { size[i] = 0; col[c + 3] = 0; continue; }
      const k = life[i] / max[i], d = Math.max(0, 1 - par[q + 7] * dt);
      vel[p] *= d; vel[p + 1] = vel[p + 1] * d - par[q + 6] * dt; vel[p + 2] *= d;
      pos[p] += vel[p] * dt; pos[p + 1] += vel[p + 1] * dt; pos[p + 2] += vel[p + 2] * dt;
      if (pos[p + 1] < .03 && vel[p + 1] < 0) { pos[p + 1] = .03; vel[p + 1] *= -.35; vel[p] *= .6; vel[p + 2] *= .6; }   // 地面ではねる
      size[i] = par[q + 1] + (par[q] - par[q + 1]) * k;
      col[c] = par[q + 2]; col[c + 1] = par[q + 3]; col[c + 2] = par[q + 4];
      col[c + 3] = par[q + 5] * (additive ? Math.min(1, k * 1.7) : Math.min(1, (1 - k) * 7) * k);   // 煙はふわっと出てふわっと消える
    }
    const g = this.obj.geometry; g.attributes.position.needsUpdate = true; g.attributes.aColor.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
  }
}
// ---- 火花の線（進む向きに伸びた、いつもカメラを向く細い板）----
class StreakPool {
  constructor(n) {
    this.n = n; this.i = 0;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.par = new Float32Array(n * 7);   // 尾の長さ(秒), 太さ, r, g, b, 重力, 空気抵抗
    this.pos = new Float32Array(n * 12); this.col = new Float32Array(n * 16);
    const uv = new Float32Array(n * 8), idx = new Uint16Array(n * 6);
    for (let i = 0; i < n; i++) { uv.set([0, 0, 0, 1, 1, 1, 1, 0], i * 8); const b = i * 4; idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('color', new T.BufferAttribute(this.col, 4).setUsage(T.DynamicDrawUsage));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2)); g.setIndex(new T.BufferAttribute(idx, 1));
    this.obj = new T.Mesh(g, new T.MeshBasicMaterial({ map: streakTex, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false }));
    this.obj.frustumCulled = false; this.obj.renderOrder = 21; scene.add(this.obj);
  }
  add(x, y, z, vx, vy, vz, life, len, width, r, g, b, grav = 9, drag = 1.5) {
    const i = this.i; this.i = (i + 1) % this.n;
    const p = i * 3, q = i * 7;
    this.p[p] = x; this.p[p + 1] = y; this.p[p + 2] = z; this.v[p] = vx; this.v[p + 1] = vy; this.v[p + 2] = vz;
    this.life[i] = this.max[i] = life;
    this.par[q] = len; this.par[q + 1] = width; this.par[q + 2] = r; this.par[q + 3] = g; this.par[q + 4] = b; this.par[q + 5] = grav; this.par[q + 6] = drag;
  }
  clear() { this.life.fill(0); this.pos.fill(0); this.obj.geometry.attributes.position.needsUpdate = true; }
  update(dt, cam) {
    const { p, v, life, max, par, pos, col, n } = this;
    for (let i = 0; i < n; i++) {
      const a = i * 3, q = i * 7, o = i * 12, c = i * 16;
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { for (let j = 0; j < 12; j++) pos[o + j] = 0; for (let j = 3; j < 16; j += 4) col[c + j] = 0; continue; }
      const k = life[i] / max[i], d = Math.max(0, 1 - par[q + 6] * dt);
      v[a] *= d; v[a + 1] = v[a + 1] * d - par[q + 5] * dt; v[a + 2] *= d;
      p[a] += v[a] * dt; p[a + 1] += v[a + 1] * dt; p[a + 2] += v[a + 2] * dt;
      if (p[a + 1] < .03 && v[a + 1] < 0) { p[a + 1] = .03; v[a + 1] *= -.4; v[a] *= .55; v[a + 2] *= .55; }
      const hx = p[a], hy = p[a + 1], hz = p[a + 2], L = par[q];
      const tx = hx - v[a] * L, ty = hy - v[a + 1] * L, tz = hz - v[a + 2] * L;
      // 板の幅の向き = 進む向き × カメラへの向き
      const cx = cam.x - hx, cy = cam.y - hy, cz = cam.z - hz;
      let sx = v[a + 1] * cz - v[a + 2] * cy, sy = v[a + 2] * cx - v[a] * cz, sz = v[a] * cy - v[a + 1] * cx;
      const sl = Math.hypot(sx, sy, sz) || 1, w = par[q + 1] * .5 * (.4 + .6 * k) / sl; sx *= w; sy *= w; sz *= w;
      pos[o] = tx - sx; pos[o + 1] = ty - sy; pos[o + 2] = tz - sz; pos[o + 3] = tx + sx; pos[o + 4] = ty + sy; pos[o + 5] = tz + sz;
      pos[o + 6] = hx + sx; pos[o + 7] = hy + sy; pos[o + 8] = hz + sz; pos[o + 9] = hx - sx; pos[o + 10] = hy - sy; pos[o + 11] = hz - sz;
      const al = Math.min(1, k * 1.8);
      for (let j = 0; j < 16; j += 4) { col[c + j] = par[q + 2]; col[c + j + 1] = par[q + 3]; col[c + j + 2] = par[q + 4]; col[c + j + 3] = al; }
    }
    const g = this.obj.geometry; g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }
}
// ---- 技の軌跡（速く動いた手足の先に残る光の帯）----
const TRAIL_N = 16, TRAIL_SUB = 3, TRAIL_LIFE = .22, TRAIL_V = ((TRAIL_N - 1) * TRAIL_SUB + 1) * 2;
class Trail {
  constructor() {
    this.d = new Float32Array(TRAIL_N * 8); this.cnt = 0; this.free = true; this.col = COL.white; this.prev = null;
    this.pos = new Float32Array(TRAIL_V * 3); this.colA = new Float32Array(TRAIL_V * 4);
    const uv = new Float32Array(TRAIL_V * 2), idx = [];
    for (let i = 0; i < TRAIL_V / 2; i++) { uv[i * 4] = i / (TRAIL_V / 2 - 1); uv[i * 4 + 1] = 0; uv[i * 4 + 2] = uv[i * 4]; uv[i * 4 + 3] = 1; if (i) { const b = (i - 1) * 2; idx.push(b, b + 1, b + 3, b, b + 3, b + 2); } }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('color', new T.BufferAttribute(this.colA, 4).setUsage(T.DynamicDrawUsage));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2)); g.setIndex(idx);
    this.obj = new T.Mesh(g, new T.MeshBasicMaterial({ map: arcTex, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false }));
    this.obj.frustumCulled = false; this.obj.renderOrder = 19; this.obj.visible = false; scene.add(this.obj);
  }
  push(ax, ay, az, bx, by, bz, w) {
    if (this.cnt === TRAIL_N) { this.d.copyWithin(0, 8); this.cnt--; }
    this.d.set([ax, ay, az, bx, by, bz, 0, w], this.cnt * 8); this.cnt++;
  }
  update(dt) {
    const d = this.d;
    for (let i = 0; i < this.cnt; i++) d[i * 8 + 6] += dt;
    while (this.cnt && d[6] > TRAIL_LIFE) { d.copyWithin(0, 8); this.cnt--; }
    if (this.cnt < 2) { this.obj.visible = false; return; }
    // 点と点の間をなめらかな曲線でつなぐ（カクカクした帯にしない）
    const P = (i, o) => d[clamp(i, 0, this.cnt - 1) * 8 + o];
    const cr = (i, o, t) => { const p0 = P(i - 1, o), p1 = P(i, o), p2 = P(i + 1, o), p3 = P(i + 2, o); return .5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t); };
    let n = 0; const c = this.col;
    const put = (i, t) => {
      const age = P(i, 6) + (P(i + 1, 6) - P(i, 6)) * t, w = P(i, 7) + (P(i + 1, 7) - P(i, 7)) * t;
      const al = w * Math.pow(Math.max(0, 1 - age / TRAIL_LIFE), 1.3), o = n * 6, q = n * 8;
      for (let k = 0; k < 6; k++) this.pos[o + k] = cr(i, k, t);
      for (let k = 0; k < 8; k += 4) { this.colA[q + k] = c[0]; this.colA[q + k + 1] = c[1]; this.colA[q + k + 2] = c[2]; this.colA[q + k + 3] = al; }
      n++;
    };
    for (let i = 0; i < this.cnt - 1; i++) for (let s = 0; s < TRAIL_SUB; s++) put(i, s / TRAIL_SUB);
    put(this.cnt - 2, 1);
    const g = this.obj.geometry; g.setDrawRange(0, (n - 1) * 6); g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    this.obj.visible = true;
  }
}
const glow = new PointPool(3200, radialTex, true), smoke = new PointPool(900, puffTex, false), streaks = new StreakPool(480), trails = [];
function getTrail(col) { let t = trails.find(x => x.free); if (!t) { t = new Trail(); trails.push(t); } t.free = false; t.cnt = 0; t.col = col; t.prev = null; return t; }
// =========================================================================================
// 気の流れ: 粒をカールノイズの流れ場で流す（流体っぽいうねり）＋ エルミート曲線で粒と気弾を導く
// =========================================================================================
const CN_P = new Uint8Array(512), CN_V = new Float32Array(256);
{
  let sd = 20261007; const rr = () => (sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0) / 4294967296;
  const p = []; for (let i = 0; i < 256; i++) { p.push(i); CN_V[i] = rr() * 2 - 1; }
  for (let i = 255; i > 0; i--) { const j = (rr() * (i + 1)) | 0, t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) CN_P[i] = p[i & 255];
}
// 値ノイズの「傾き」（∂/∂x, ∂/∂y, ∂/∂z）を返す。5 次の補間なので、傾きも途切れずなめらか
function noiseGrad(x, y, z, o) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const dx = 30 * fx * fx * (fx * (fx - 2) + 1), dy = 30 * fy * fy * (fy * (fy - 2) + 1), dz = 30 * fz * fz * (fz * (fz - 2) + 1);
  const X = xi & 255, Y = yi & 255, Z = zi & 255, A = CN_P[X] + Y, B = CN_P[X + 1] + Y;
  const AA = CN_P[A] + Z, AB = CN_P[A + 1] + Z, BA = CN_P[B] + Z, BB = CN_P[B + 1] + Z;
  const a = CN_V[CN_P[AA]], b = CN_V[CN_P[BA]], c = CN_V[CN_P[AB]], d = CN_V[CN_P[BB]];
  const e = CN_V[CN_P[AA + 1]], f = CN_V[CN_P[BA + 1]], g = CN_V[CN_P[AB + 1]], h = CN_V[CN_P[BB + 1]];
  const k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + g, k6 = a - b - e + f, k7 = -a + b + c - d + e - f - g + h;
  o[0] = dx * (k1 + k4 * uy + k6 * uz + k7 * uy * uz);
  o[1] = dy * (k2 + k5 * uz + k4 * ux + k7 * uz * ux);
  o[2] = dz * (k3 + k6 * ux + k5 * uy + k7 * ux * uy);
}
// カールノイズ: 3 つのノイズを「ベクトルポテンシャル ψ」とみなして、その回転（∇×ψ）を流れの速さにする。
// 回転は必ず「湧き出しゼロ」になるので、粒が一か所に集まったり散ったりせず、水や煙のように渦を巻いて流れる
const _cg = [0, 0, 0];
function curlNoise(x, y, z, t, o) {
  noiseGrad(x + 17.3, y - t, z + 5.1, _cg); const xy = _cg[1], xz = _cg[2];            // ψx の ∂/∂y, ∂/∂z
  noiseGrad(x - 31.7, y + 9.2 + t * .6, z - 44.4, _cg); const yx = _cg[0], yz = _cg[2];   // ψy の ∂/∂x, ∂/∂z
  noiseGrad(x + 63.9 + t * .8, y - 22.6, z + 81.5, _cg); const zx = _cg[0], zy = _cg[1];  // ψz の ∂/∂x, ∂/∂y
  o[0] = zy - yz; o[1] = xz - zx; o[2] = yx - xy;
}
// エルミート曲線: 始点 p0・終点 p1 と、それぞれでの向き（接線 t0, t1）から、なめらかな曲線の途中の点を求める
const hermite = (u, p0, t0, p1, t1) => { const u2 = u * u, u3 = u2 * u; return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * t0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * t1; };

const FLOW_N = 6000, FLOW_S = 23;
class FlowPool {
  constructor(n) {
    this.n = n; this.i = 0; this.t = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.life = new Float32Array(n); this.max = new Float32Array(n);
    // 0-2 速さ（導かれる粒は、曲線からのずれ）/ 3,4 大きさ（生まれ・消え）/ 5-7 色 / 8 濃さ / 9 うねりの強さ / 10 うねりの細かさ / 11 空気抵抗 / 12 導かれるか / 13-15 始点 / 16-18 始点の向き / 19-21 終点の向き
    this.d = new Float32Array(n * FLOW_S); this.tg = new Array(n).fill(null);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('aColor', new T.BufferAttribute(this.col, 4).setUsage(T.DynamicDrawUsage));
    g.setAttribute('aSize', new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage));
    this.mat = glow.mat.clone(); this.mat.uniforms.map.value = radialTex;
    this.obj = new T.Points(g, this.mat); this.obj.frustumCulled = false; this.obj.renderOrder = 21; scene.add(this.obj);
  }
  _new(life, s0, s1, r, g, b, a, amp, freq) {
    const i = this.i; this.i = (i + 1) % this.n; const q = i * FLOW_S, d = this.d;
    this.life[i] = this.max[i] = life; d[q + 3] = s0; d[q + 4] = s1; d[q + 5] = r; d[q + 6] = g; d[q + 7] = b; d[q + 8] = a; d[q + 9] = amp; d[q + 10] = freq;
    return i;
  }
  // 流れに乗って漂う粒
  add(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a = 1, amp = 1.5, freq = 1.3, drag = 2) {
    const i = this._new(life, s0, s1, r, g, b, a, amp, freq), q = i * FLOW_S, d = this.d, p = i * 3;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z; d[q] = vx; d[q + 1] = vy; d[q + 2] = vz; d[q + 11] = drag; d[q + 12] = 0; this.tg[i] = null;
  }
  // エルミート曲線に沿って、動く的（tg = { x, y, z }）へ導かれる粒。曲線のまわりを、流れ場でうねりながら進む
  guide(x, y, z, t0x, t0y, t0z, tg, t1x, t1y, t1z, life, s0, s1, r, g, b, a = 1, amp = 1, freq = 1.4) {
    const i = this._new(life, s0, s1, r, g, b, a, amp, freq), q = i * FLOW_S, d = this.d, p = i * 3;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z; d[q] = d[q + 1] = d[q + 2] = 0; d[q + 12] = 1; this.tg[i] = tg;
    d[q + 13] = x; d[q + 14] = y; d[q + 15] = z; d[q + 16] = t0x; d[q + 17] = t0y; d[q + 18] = t0z; d[q + 19] = t1x; d[q + 20] = t1y; d[q + 21] = t1z;
  }
  clear() { this.life.fill(0); this.size.fill(0); this.tg.fill(null); this.obj.geometry.attributes.aSize.needsUpdate = true; }
  update(dt) {
    const { pos, life, max, d, col, size, n, tg } = this, cv = _cg2; this.t += dt; const T0 = this.t * .45;
    for (let i = 0; i < n; i++) {
      if (life[i] <= 0) continue;
      const p = i * 3, q = i * FLOW_S, c = i * 4;
      life[i] -= dt;
      if (life[i] <= 0) { size[i] = 0; col[c + 3] = 0; tg[i] = null; continue; }
      const k = life[i] / max[i], fq = d[q + 10], amp = d[q + 9];
      if (d[q + 12]) {
        const g = tg[i], u = 1 - k, ue = u * u * (1.6 - .6 * u), w = 1 - ue * ue;   // だんだん速く吸い込まれる
        const hx = hermite(ue, d[q + 13], d[q + 16], g.x, d[q + 19]), hy = hermite(ue, d[q + 14], d[q + 17], g.y, d[q + 20]), hz = hermite(ue, d[q + 15], d[q + 18], g.z, d[q + 21]);
        curlNoise((hx + d[q]) * fq, (hy + d[q + 1]) * fq, (hz + d[q + 2]) * fq, T0, cv);
        d[q] += cv[0] * amp * dt; d[q + 1] += cv[1] * amp * dt; d[q + 2] += cv[2] * amp * dt;
        pos[p] = hx + d[q] * w; pos[p + 1] = hy + d[q + 1] * w; pos[p + 2] = hz + d[q + 2] * w;
      } else {
        curlNoise(pos[p] * fq, pos[p + 1] * fq, pos[p + 2] * fq, T0, cv);
        const dr = Math.max(0, 1 - d[q + 11] * dt); d[q] *= dr; d[q + 1] *= dr; d[q + 2] *= dr;
        pos[p] += (d[q] + cv[0] * amp) * dt; pos[p + 1] += (d[q + 1] + cv[1] * amp) * dt; pos[p + 2] += (d[q + 2] + cv[2] * amp) * dt;
        if (pos[p + 1] < .03) pos[p + 1] = .03;
      }
      size[i] = d[q + 4] + (d[q + 3] - d[q + 4]) * k;
      col[c] = d[q + 5]; col[c + 1] = d[q + 6]; col[c + 2] = d[q + 7];
      col[c + 3] = d[q + 8] * Math.min(1, k * 2.2) * Math.min(1, (1 - k) * 9);
    }
    const g = this.obj.geometry; g.attributes.position.needsUpdate = true; g.attributes.aColor.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
  }
}
const _cg2 = [0, 0, 0];
const flow = new FlowPool(FLOW_N);

// ---- 溜め: まわりの気が、渦を巻きながら手もとへ吸い込まれる ----
function kiGather(f, hx, hy, cc, lv) {
  const hp = f.chgPt || (f.chgPt = { x: 0, y: 0, z: 0 }); hp.x = hx; hp.y = hy; hp.z = f.z + .05;
  const sw = f.face, n = 2 + lv * 2;
  for (let i = 0; i < n; i++) {
    const an = rnd(0, 6.283), r = rnd(.75, 1.35) * (1 + lv * .38), nx = Math.cos(an), ny = Math.sin(an), a2 = an + 2.0 * sw, sp = rnd(2.6, 3.8);
    flow.guide(hx + nx * r, Math.max(.06, hy + ny * r * .85), f.z + rnd(-.55, .55),
      -ny * r * sp * sw, nx * r * sp * sw, rnd(-1.2, 1.2), hp,                 // はじめは、手のまわりを回る向きへ
      -Math.cos(a2) * r * 2.2, -Math.sin(a2) * r * 2.2, 0,                     // 最後は、回り込んで手の中へ
      rnd(.34, .6), .055 + lv * .014, .15, cc[0] * 1.2, cc[1] * 1.2, cc[2] * 1.2, .9, .9 + lv * .25, 1.5);
  }
}
// ---- 気弾の狙い: 前にいる相手へ、エルミート曲線で曲がっていく。まわりを「気の筋」が別の曲線で追いかける ----
function kiAim(sh, f) {
  const s = sh.s, lv = s.lv || 0, dir = f.face, hero = f.team !== 'enemy';
  sh.tp = { x: sh.x, y: sh.y, z: sh.z }; sh.str = null;
  let tg = null, bd = 1e9;
  if (sh.kind === 'ki' && hero && !sh.vz) for (const b of fighters) {
    if (!b.alive || b.out || !hostile(f, b) || b.hp <= 0 || b.pit || (b.ai && b.ai.door) || b.duo || downish(b.state)) continue;
    const dx = (b.x - sh.x) * dir, dz = Math.abs(b.z - sh.z);
    if (dx < .6 || dx > 6.5 + lv * 1.5 || dz > 1.3 + lv * .5 || !onScreen(b.x, .3)) continue;   // 溜めるほど、遠く・ななめの相手まで狙える
    const d = dx + dz * 2; if (d < bd) { bd = d; tg = b; }
  }
  if (tg) {
    const D = Math.max(1.2, (tg.x - sh.x) * dir), dz = tg.z - sh.z;
    sh.hm = { tg, live: 1, u: 0, dur: Math.max(.2, D / s.spd), p0: [sh.x, sh.y, sh.z], p1: [tg.x, sh.y, tg.z], t0: [dir * D, 1.6 + lv * .5, -dz * 1.6], t1: [dir * D, 0, 0] };
  }
  if (!hero || sh.kind !== 'ki' || sh.vz) return;
  const n = [2, 3, 4, 6][lv], dur = sh.hm ? sh.hm.dur : .5, L = Math.max(2, s.spd * dur); sh.str = [];
  for (let i = 0; i < n; i++) {
    const a = (i + rnd(-.25, .25)) / n * 6.283, mg = rnd(3.2, 5.2) * (1 + lv * .3);
    sh.str.push({ u: 0, dur: dur * rnd(.86, .98), p0: [sh.x, sh.y, sh.z], t0: [dir * L * .25, Math.sin(a) * mg, Math.cos(a) * mg * .75], t1: [dir * L * 1.3, 0, 0], last: [sh.x, sh.y, sh.z] });
  }
}
function kiHome(sh, dt) {
  const H = sh.hm, tg = H.tg, dir = Math.sign(sh.vx) || 1;
  if (H.live && (!tg.alive || tg.out || tg.pit || tg.hp <= 0 || (tg.x - sh.x) * dir < .1 || downish(tg.state) || tg.state === 'knock' || (sh.hits && sh.hits.has(tg)))) H.live = 0;   // 相手が消えた・後ろへ回られたら、もう追わない
  if (H.live) { H.p1[0] = tg.x; H.p1[1] = (tg.y || 0) + 1.02 * Math.min(1.4, tg.scl); H.p1[2] = tg.z; }
  H.u += dt / H.dur;
  if (H.u >= 1) { sh.hm = null; sh.x += sh.vx * dt; return; }   // 曲線の終わり: そのまま、まっすぐ抜けていく
  let nx = hermite(H.u, H.p0[0], H.t0[0], H.p1[0], H.t1[0]); const mn = Math.abs(sh.vx) * dt * .3;
  if ((nx - sh.x) * dir < mn) nx = sh.x + dir * mn;          // 後ろへは戻らない
  sh.x = nx; sh.y = Math.max(.25, hermite(H.u, H.p0[1], H.t0[1], H.p1[1], H.t1[1])); sh.z = hermite(H.u, H.p0[2], H.t0[2], H.p1[2], H.t1[2]);
}
// ---- 気弾の尾: 流れ場に乗って、うねりながらほどけていく ----
function kiWake(sh, dt) {
  const c = sh.c, lv = sh.s.lv || 0, dir = Math.sign(sh.vx) || 1, wv = sh.kind === 'wave', sc = sh.sc, spd = Math.abs(sh.vx);
  glow.add(sh.x - dir * rnd(0, .2), sh.y + rnd(-.06, .06) * sc, sh.z, -sh.vx * .08, 0, 0, rnd(.14, .22), .26 * sc, 0, c[0] * 1.15, c[1] * 1.15, c[2] * 1.15, .8, 0, 2);   // 芯の光
  const n = 12 + lv * 6;
  for (let k = 0; k < n; k++) {
    const a = rnd(0, 6.283), rr = rnd(.02, .2) * sc * (wv ? 4 : 1), bk = rnd(0, spd * dt);
    flow.add(sh.x - dir * (bk + .05), sh.y + Math.sin(a) * rr, sh.z + Math.cos(a) * rr * .6, sh.vx * rnd(.02, .16), Math.sin(a) * rnd(0, .5), Math.cos(a) * rnd(0, .3),
      rnd(.55, 1.2) * (1 + lv * .1), (.045 + rnd(0, .045)) * (1 + (sc - 1) * .4), .012, c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, .6, 2.1 + lv * .4, .95, 2.4);
  }
  const tp = sh.tp; if (sh.hm) { tp.x = sh.hm.p1[0]; tp.y = sh.hm.p1[1]; tp.z = sh.hm.p1[2]; } else { tp.x = sh.x + dir * .1; tp.y = sh.y; tp.z = sh.z; }
  if (!sh.str) return;
  for (let i = sh.str.length - 1; i >= 0; i--) {
    const st = sh.str[i], u0 = st.u; st.u += dt / st.dur;
    if (st.u >= 1) { flashFx(tp.x, tp.y, tp.z + .1, .8 * sc, c, .1, .5); sh.str.splice(i, 1); continue; }
    for (let j = 1; j <= 5; j++) {   // 1 コマの間も、曲線に沿って粒を置いていく（点線にしない）
      const u = u0 + (st.u - u0) * j / 5, ue = u * u * (1.5 - .5 * u);
      const x = hermite(ue, st.p0[0], st.t0[0], tp.x, st.t1[0]), y = Math.max(.08, hermite(ue, st.p0[1], st.t0[1], tp.y, st.t1[1])), z = hermite(ue, st.p0[2], st.t0[2], tp.z, st.t1[2]);
      flow.add(x, y, z, (x - st.last[0]) * 3, (y - st.last[1]) * 3, (z - st.last[2]) * 3, rnd(.45, .9), .075 * Math.sqrt(sc), .012, c[0] * 1.3, c[1] * 1.3, c[2] * 1.3, .9, .65, 1.3, 4);
      st.last[0] = x; st.last[1] = y; st.last[2] = z;
    }
    glow.add(st.last[0], st.last[1], st.last[2], 0, 0, 0, .09, .2 * Math.sqrt(sc), .05, 1.25, 1.25, 1.25, .9, 0, 0);   // 筋の先頭
  }
}
// ---- 気弾がはじけるとき: 粒が渦を巻いて散る ----
function kiBurst(sh) {
  const c = sh.c, lv = sh.s.lv || 0, n = 16 + lv * 9;
  for (let i = 0; i < n; i++) {
    const a = rnd(0, 6.283), e = rnd(-1.2, 1.2), v = rnd(1.5, 5) * (1 + lv * .2);
    flow.add(sh.x, sh.y, sh.z, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v, Math.sin(a) * Math.cos(e) * v * .6, rnd(.45, .9), .14 * sh.sc, .01, c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, .85, 2.6 + lv * .5, 1.2, 3.5);
  }
}
const planeGeo = new T.PlaneGeometry(2, 2), pillarGeo = new T.CylinderGeometry(1, 1, 1, 28, 1, true); pillarGeo.translate(0, .5, 0);
const addMat = (map, c, o = 1) => new T.MeshBasicMaterial({ map, color: new T.Color(c[0], c[1], c[2]), transparent: true, opacity: o, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false });
// 衝撃の輪（mode: 'ground' = 地面に広がる / 'cam' = カメラを向く。sx = 横につぶす量）
function ringFx(x, y, z, r0, r1, life, c, mode = 'cam', sx = 1, o = 1) {
  const m = new T.Mesh(planeGeo, addMat(ringTex, c, o)); m.position.set(x, y, z); if (mode === 'ground') m.rotation.x = -Math.PI / 2; m.renderOrder = 18; scene.add(m);
  fx.push({ o: m, t: 0, dur: life, kind: 'ring', r0, r1, sx, mode, a: o });
}
function flashFx(x, y, z, s, c, life, o = .6) {
  const sp = new T.Sprite(new T.SpriteMaterial({ map: radialTex, color: new T.Color(c[0], c[1], c[2]), transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); sp.position.set(x, y, z); sp.renderOrder = 22; scene.add(sp);
  fx.push({ o: sp, t: 0, dur: life, kind: 'flash', s: s * .55, a: o });   // 白飛びしないよう、小さめ・薄め
}
function pillarFx(x, z, r, h, life, c, o = .8) {
  const m = new T.Mesh(pillarGeo, addMat(pillarTex, c, o)); m.position.set(x, 0, z); m.renderOrder = 17; scene.add(m);
  fx.push({ o: m, t: 0, dur: life, kind: 'pillar', r, h, a: o });
}
const later = (t, fn) => fx.push({ o: null, t: 0, dur: t, kind: 'call', fn });
// ---- ダメージの数字（その場でポンと出て、跳ねて、上へ消える）----
const numTexCache = new Map();
function numTex(text, style) {
  const key = style + '|' + text; if (numTexCache.has(key)) return numTexCache.get(key);
  const pal = { hit: ['#FFFFFF', '#FFCE4A'], big: ['#FFF3B0', '#FF5A2E'], hurt: ['#FFD0D8', '#FF2A4A'], heal: ['#E8FFE8', '#3CE07A'], coin: ['#FFFBE0', '#FFB820'], claude: ['#E8FFFB', '#2BE8C8'] }[style] || ['#fff', '#fff'];
  const t = canvasTex(256, 128, (x, w, h) => {
    x.font = `${style === 'big' ? 96 : 80}px "Bungee", "Chakra Petch", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round'; x.lineWidth = 16; x.strokeStyle = 'rgba(7,10,20,.92)'; x.strokeText(text, w / 2, h / 2 + 4);
    const g = x.createLinearGradient(0, 20, 0, h - 16); g.addColorStop(0, pal[0]); g.addColorStop(1, pal[1]); x.fillStyle = g; x.fillText(text, w / 2, h / 2 + 4);
  });
  numTexCache.set(key, t); return t;
}
function numFx(x, y, z, text, style, dir = 0) {   // dir を渡すと、殴られた向きへ弧を描いて飛ぶ（頭の上の連続ヒット表示と重ならないように）
  const sp = new T.Sprite(new T.SpriteMaterial({ map: numTex(String(text), style), transparent: true, depthWrite: false, depthTest: false, fog: false })); sp.position.set(x + rnd(-.2, .2), y, z + .3); sp.renderOrder = 30; scene.add(sp);
  fx.push({ o: sp, t: 0, dur: style === 'big' ? .95 : .75, kind: 'num', y0: y, s: style === 'big' ? 1.9 : style === 'hit' || style === 'claude' ? 1.2 : 1.45, vx: dir ? dir * rnd(1.5, 2.4) : rnd(-.5, .5), rise: dir ? rnd(.35, .6) : .9 });
}

// ---- 擬音の文字（当たった場所にドンと出る）----
const WORDS = { light: ['バシッ', 'ビシッ', 'ドカッ', 'パァン', 'ガッ'], big: ['ドゴォ!', 'ズドン!', 'バキィ!', 'ドカーン!', 'ズガァ!'], guard: ['ガキン!'], finish: ['FINISH!!'], wood: ['バキッ!', 'ボコッ!', 'ゴスッ!'], metal: ['ガンッ!', 'ゴンッ!', 'カーン!'], rock: ['ゴッ!', 'ガツン!'], can: ['ガシャーン!', 'ボコーン!'], homer: ['カキーン!!'] };
const wordTexCache = new Map();
function wordTex(text, c) {
  const key = text + '|' + c.join(','); if (wordTexCache.has(key)) return wordTexCache.get(key);
  const css = (k) => `rgb(${Math.round(Math.min(1, c[0] * k) * 255)},${Math.round(Math.min(1, c[1] * k) * 255)},${Math.round(Math.min(1, c[2] * k) * 255)})`;
  const t = canvasTex(512, 256, (x, w, h) => {
    x.translate(w / 2, h / 2); x.transform(1, 0, -.22, 1, 0, 0);   // 斜体
    let fs = 150; x.font = `900 ${fs}px "Dela Gothic One", "Noto Sans JP", sans-serif`;
    const tw = x.measureText(text).width; if (tw > w - 90) { fs *= (w - 90) / tw; x.font = `900 ${fs}px "Dela Gothic One", "Noto Sans JP", sans-serif`; }
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    x.lineWidth = 34; x.strokeStyle = 'rgba(7,10,20,.95)'; x.strokeText(text, 0, 6);
    x.lineWidth = 16; x.strokeStyle = css(.9); x.strokeText(text, 0, 6);
    const g = x.createLinearGradient(0, -fs / 2, 0, fs / 2); g.addColorStop(0, '#FFFFFF'); g.addColorStop(.55, '#FFF6C8'); g.addColorStop(1, css(1.15)); x.fillStyle = g; x.fillText(text, 0, 6);
  });
  wordTexCache.set(key, t); return t;
}
function wordFx(x, y, z, kind, c, dir, size = 1) {
  const sp = new T.Sprite(new T.SpriteMaterial({ map: wordTex(pick(WORDS[kind]), c), transparent: true, depthWrite: false, depthTest: false, fog: false }));
  sp.position.set(x, y, z + .4); sp.material.rotation = rnd(-.28, .28) - dir * .08; sp.renderOrder = 31; scene.add(sp);
  fx.push({ o: sp, t: 0, dur: kind === 'finish' ? 1.3 : .62, kind: 'word', s: size * (kind === 'light' ? 1.5 : kind === 'finish' ? 4.2 : 2.4), vx: dir * 1.4 });
}

// ---- 場面ごとの演出 ----
let vig = 0, camPunch = 0, wFlash = 0, slowT = 0;
const COMP = (c) => [1 - c[0] * .7, 1 - c[1] * .5, 1 - c[2] * .3];   // 反対寄りの色（差し色）
// 当たった: 放射状の集中線 + 当てた向きへ飛ぶ火花 + 色とりどりの破片 + 光の玉 + 二重の輪 + 擬音 + 数字
function fxHit(a, b, m, dir, x, y, z, big, dmg) {
  const c = teamCol(a), c2 = COMP(c), n = big ? 44 : 20, sp = big ? 13 : 8.5;
  // 火花（当てた向きへ扇形）
  for (let i = 0; i < n; i++) {
    const az = rnd(-1, 1) * (big ? 1.35 : .95), el = rnd(-.6, 1.0), v = sp * rnd(.25, 1.2), w = i % 4 === 0;
    streaks.add(x, y, z, dir * Math.cos(az) * Math.cos(el) * v, Math.sin(el) * v + 1.2, Math.sin(az) * v * .55, rnd(.22, .5), .055, big ? .08 : .055, w ? 1 : c[0], w ? 1 : c[1], w ? 1 : c[2], 13, 1.5);
  }
  // 色とりどりの破片（太く短い板がくるくる落ちる）
  for (let i = 0; i < (big ? 22 : 9); i++) {
    const an = rnd(0, 6.28), v = rnd(2.5, 8) * (big ? 1.25 : 1), k = i % 3 === 0 ? c2 : i % 3 === 1 ? c : COL.white;
    streaks.add(x, y, z, Math.cos(an) * v * .7 + dir * rnd(1, 5), Math.abs(Math.sin(an)) * v + 1.5, rnd(-2, 2), rnd(.45, .85), .018, rnd(.09, .16), k[0], k[1], k[2], 15, .8);
  }
  // 集中線（当たった点から四方へ一瞬だけ走る線）
  for (let i = 0; i < (big ? 18 : 10); i++) {
    const an = i / (big ? 18 : 10) * 6.283 + rnd(-.15, .15), v = rnd(16, 26) * (big ? 1.2 : .8);
    streaks.add(x + Math.cos(an) * .22, y + Math.sin(an) * .22, z + .15, Math.cos(an) * v, Math.sin(an) * v, 0, rnd(.09, .14), .05, big ? .06 : .04, 1, 1, 1, 0, 2.5);
  }
  // 光の粒
  for (let i = 0; i < (big ? 26 : 10); i++) glow.add(x + rnd(-.15, .15), y + rnd(-.15, .15), z + .1, dir * rnd(.5, 5.5) + rnd(-2, 2), rnd(-1.5, 4.5), rnd(-1.5, 1.5), rnd(.3, .75), rnd(.09, .2), 0, c[0] * 1.25, c[1] * 1.25, c[2] * 1.25, .95, 5, 2.2);
  flashFx(x, y, z + .15, big ? 2.6 : 1.7, COL.white, big ? .13 : .09, .6);
  flashFx(x, y, z + .1, big ? 4.4 : 2.6, c, big ? .26 : .17, .6);
  ringFx(x, y, z + .2, .12, big ? 1.8 : 1.05, big ? .3 : .2, c, 'cam', .6);
  later(.05, () => ringFx(x, y, z + .2, .1, big ? 2.6 : 1.5, big ? .34 : .22, COL.white, 'cam', .5, .5));
  spark(x, y, z + .2, big);
  if (big) {
    ringFx(b.x, .05, b.z, .3, 2.8, .46, c, 'ground'); ringFx(b.x, .05, b.z, .2, 1.8, .34, COL.white, 'ground', 1, .6);
    for (let i = 0; i < 10; i++) { const an = rnd(0, 6.28); smoke.add(b.x + Math.cos(an) * .2, .15, b.z + Math.sin(an) * .15, Math.cos(an) * 2.4 + dir * 1.8, rnd(.4, 1.4), Math.sin(an) * 1.3, rnd(.5, .9), .35, 1.4, COL.smoke[0], COL.smoke[1], COL.smoke[2], .34, -.4, 2.5); }
    for (let i = 0; i < 9; i++) streaks.add(x, y + rnd(-.25, .25), z, dir * rnd(12, 22), rnd(-1.5, 1.5), rnd(-2, 2), .16, .08, .04, 1, 1, 1, 0, 0);   // 貫く白い線
    pillarFx(b.x, b.z, .35, 2.6, .3, c, .28);
    camPunch = Math.max(camPunch, 1.3); wFlash = Math.max(wFlash, .2); shake(.1);
    wordFx(x + dir * .35, y + .55, z, m.homer ? 'homer' : m.wk ? WEAPONS[m.wk].word : 'big', c, dir, m.homer ? 1.45 : 1);
    if (m.homer) for (let i = 0; i < 26; i++) { const an = rnd(-.5, .9); streaks.add(x, y, z, dir * Math.cos(an) * rnd(14, 30), Math.sin(an) * rnd(14, 30), rnd(-3, 3), rnd(.18, .3), .16, .05, 1, .95, .6, 0, 0); }   // ホームランの打球の線
  } else if (m.wk) wordFx(x + dir * .3, y + .45, z, WEAPONS[m.wk].word, c, dir, .7);
  else if (Math.random() < .55) wordFx(x + dir * .3, y + .45, z, 'light', c, dir);
  numFx(b.x + dir * .3, (b.y || 0) + 1.0 * Math.min(1.35, b.scl), b.z, Math.max(1, Math.round(dmg)), b.team !== 'enemy' ? 'hurt' : big ? 'big' : a.isClaude ? 'claude' : 'hit', dir);
  if (b.isPlayer) vig = Math.min(1, vig + (big ? .75 : .42));
}
// 受け止めた: 青白い火花と輪
function fxGuard(b, dir, x, y, z) {
  for (let i = 0; i < 12; i++) { const el = rnd(-1.1, 1.1), v = rnd(3, 8); streaks.add(x, y, z, -dir * Math.cos(el) * v * rnd(.2, 1), Math.sin(el) * v, rnd(-2.5, 2.5), rnd(.14, .28), .045, .04, COL.blue[0], COL.blue[1], COL.blue[2], 6, 2); }
  flashFx(x, y, z + .15, 1.5, COL.white, .08); flashFx(x, y, z + .1, 2.4, COL.blue, .16);
  ringFx(x, y, z + .2, .2, 1.05, .2, COL.blue, 'cam', .5);
  ringFx(x, y, z + .2, .1, .7, .14, COL.white, 'cam', .5, .8);
  wordFx(x - dir * .3, y + .5, z, 'guard', COL.blue, -dir, .8);
}
// 地面にたたきつけられた: 土けむりが放射状に走る
function fxDown(f, hard) {
  const n = hard ? 16 : 10;
  for (let i = 0; i < n; i++) { const an = i / n * 6.28 + rnd(-.2, .2), v = rnd(1.6, 3.4) * (hard ? 1.3 : 1); smoke.add(f.x + Math.cos(an) * .3, .12, f.z + Math.sin(an) * .2, Math.cos(an) * v, rnd(.2, .9), Math.sin(an) * v * .6, rnd(.5, .9), .3, hard ? 1.6 : 1.2, COL.smoke[0], COL.smoke[1], COL.smoke[2], .36, -.3, 2.8); }
  ringFx(f.x, .05, f.z, .3, hard ? 2.6 : 1.9, .4, COL.smoke, 'ground', 1, .55);
  for (let i = 0; i < (hard ? 12 : 6); i++) streaks.add(f.x + rnd(-.3, .3), .1, f.z + rnd(-.2, .2), rnd(-4, 4), rnd(2, 6), rnd(-2, 2), rnd(.25, .45), .04, .035, 1, .85, .6, 14, 1);
  if (hard) for (let i = 0; i < 4; i++) debris(f.x + rnd(-.3, .3), .2, f.z, 0x3a4058);
}
// 敵の体力を削りきった: 四方へ派手に火花
function fxKO(b, c) {
  const y = (b.y || 0) + 1.0 * Math.min(1.4, b.scl);
  for (let i = 0; i < 34; i++) { const an = rnd(0, 6.28), el = rnd(-.4, 1.2), v = rnd(4, 13); streaks.add(b.x, y, b.z, Math.cos(an) * Math.cos(el) * v, Math.sin(el) * v, Math.sin(an) * Math.cos(el) * v * .6, rnd(.3, .6), .05, .07, c[0], c[1], c[2], 12, 1.4); }
  flashFx(b.x, y, b.z + .2, 3.6, COL.white, .14, .55); flashFx(b.x, y, b.z + .1, 5.5, c, .3, .5);
  ringFx(b.x, y, b.z + .2, .2, 3.0, .4, c, 'cam', .8); ringFx(b.x, y, b.z + .2, .2, 2.0, .3, COL.white, 'cam', .8, .7);
  for (let i = 0; i < 24; i++) { const an = i / 24 * 6.283, v = rnd(18, 30); streaks.add(b.x + Math.cos(an) * .3, y + Math.sin(an) * .3, b.z + .15, Math.cos(an) * v, Math.sin(an) * v, 0, rnd(.12, .18), .05, .07, 1, 1, 1, 0, 2); }
  wFlash = Math.max(wFlash, .32); camPunch = Math.max(camPunch, 1.8);
}
// そのエリア最後の敵を倒した: ゆっくりになって「FINISH!!」
function fxFinish(b, c) {
  slowT = .85; wFlash = .5; camPunch = 2.4;
  wordFx(b.x, 2.6, b.z, 'finish', c, 0);
  for (let i = 0; i < 60; i++) { const an = rnd(0, 6.28), el = rnd(-.2, 1.3), v = rnd(5, 16), k = i % 3 ? c : COL.white; streaks.add(b.x, 1, b.z, Math.cos(an) * Math.cos(el) * v, Math.sin(el) * v, Math.sin(an) * Math.cos(el) * v * .6, rnd(.5, 1.0), .05, .08, k[0], k[1], k[2], 9, 1); }
  ringFx(b.x, .05, b.z, .5, 6, .8, c, 'ground'); ringFx(b.x, 1, b.z + .2, .3, 5, .6, COL.white, 'cam', 1, .7);
}
// 敵が消える: 爆発して部品が飛び散る
function fxExplode(f) {
  const s = Math.min(1.8, f.scl), y = .55 * s, boss = !!f.spec?.boss;
  const one = (x, yy, z, k) => {
    flashFx(x, yy, z + .2, 4 * k, COL.white, .12, .6); flashFx(x, yy, z + .1, 6.5 * k, COL.orange, .34, .55);
    for (let i = 0; i < 30; i++) { const an = rnd(0, 6.28), el = rnd(-.2, 1.3), v = rnd(4, 12) * k; streaks.add(x, yy, z, Math.cos(an) * Math.cos(el) * v, Math.sin(el) * v, Math.sin(an) * Math.cos(el) * v * .6, rnd(.3, .65), .05, .07, 1, rnd(.45, .85), .2, 13, 1.3); }
    for (let i = 0; i < 18; i++) glow.add(x + rnd(-.3, .3), yy + rnd(-.2, .4), z + rnd(-.2, .2), rnd(-2, 2), rnd(1, 5), rnd(-1, 1), rnd(.5, 1.1), rnd(.12, .24), 0, 1.3, rnd(.5, .9), .2, .9, 1.5, 1.2);
    for (let i = 0; i < 12; i++) smoke.add(x + rnd(-.3, .3), yy + rnd(-.2, .3), z + rnd(-.2, .2), rnd(-1.5, 1.5), rnd(.8, 2.6), rnd(-.8, .8), rnd(.7, 1.3), .5 * k, 1.9 * k, COL.dark[0], COL.dark[1], COL.dark[2], .5, -.6, 1.6);
    ringFx(x, .05, z, .3, 3.0 * k, .5, COL.orange, 'ground'); ringFx(x, yy, z + .2, .2, 2.6 * k, .32, COL.white, 'cam', 1, .8);
    sfx.boom(k > 1.2);
  };
  one(f.x, y, f.z, boss ? 1.5 : s);
  for (let i = 0; i < (boss ? 14 : 7); i++) debris(f.x + rnd(-.3, .3), y + rnd(0, .5), f.z, i % 3 ? f.spec.color : f.spec.accent);
  shake(boss ? .5 : .16);
  if (boss) for (let i = 1; i <= 6; i++) later(i * .16, () => { one(f.x + rnd(-1.2, 1.2), rnd(.4, 2.2), f.z + rnd(-.5, .5), rnd(.8, 1.4)); shake(.3); });
}
function fxJump(f) { for (let i = 0; i < 6; i++) { const an = rnd(0, 6.28); smoke.add(f.x + Math.cos(an) * .15, .1, f.z + Math.sin(an) * .1, Math.cos(an) * 1.4, rnd(.2, .7), Math.sin(an) * .8, rnd(.3, .5), .2, .7, COL.smoke[0], COL.smoke[1], COL.smoke[2], .3, -.2, 3); } ringFx(f.x, .04, f.z, .2, .9, .25, COL.smoke, 'ground', 1, .4); }
function fxLand(f) { for (let i = 0; i < 8; i++) { const an = i / 8 * 6.28; smoke.add(f.x + Math.cos(an) * .2, .1, f.z + Math.sin(an) * .12, Math.cos(an) * 1.9, rnd(.15, .5), Math.sin(an) * 1.0, rnd(.3, .55), .22, .8, COL.smoke[0], COL.smoke[1], COL.smoke[2], .3, -.2, 3.2); } ringFx(f.x, .04, f.z, .25, 1.2, .28, COL.smoke, 'ground', 1, .45); }
function fxDodge(f) {
  const c = teamCol(f);
  for (let i = 0; i < 9; i++) streaks.add(f.x + rnd(-.2, .2), rnd(.2, 1.6), f.z + rnd(-.25, .25), -f.vx * rnd(.2, .6), 0, -f.vz * rnd(.2, .6), rnd(.16, .3), .09, .03, c[0], c[1], c[2], 0, 3);
  for (let i = 0; i < 5; i++) smoke.add(f.x + rnd(-.2, .2), .12, f.z + rnd(-.15, .15), -f.vx * .25 + rnd(-.5, .5), rnd(.2, .7), -f.vz * .25, rnd(.3, .5), .25, .8, COL.smoke[0], COL.smoke[1], COL.smoke[2], .3, -.2, 3);
}
// 必殺の出だし: 光の粒が体に集まり、足もとの輪と光の柱が立つ
function fxSpecial(f) {
  const c = teamCol(f);
  for (let i = 0; i < 40; i++) { const an = rnd(0, 6.28), r = rnd(1.5, 2.4), y = rnd(.1, 2.2); glow.add(f.x + Math.cos(an) * r, y, f.z + Math.sin(an) * r * .6, -Math.cos(an) * r * 4.2, (1.0 - y) * 3, -Math.sin(an) * r * 2.5, rnd(.2, .3), .05, .16, c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, .9, 0, 0); }
  ringFx(f.x, .05, f.z, 2.6, .5, .3, c, 'ground'); ringFx(f.x, .05, f.z, .4, 2.2, .5, COL.white, 'ground', 1, .6);
  pillarFx(f.x, f.z, .6, 3.2, .5, c, .32); flashFx(f.x, 1.0, f.z + .2, 3.2, c, .22, .45);
  for (let i = 0; i < 14; i++) streaks.add(f.x + rnd(-.5, .5), .1, f.z + rnd(-.3, .3), rnd(-.5, .5), rnd(5, 11), 0, rnd(.25, .5), .08, .04, c[0], c[1], c[2], 0, 1);
}
function fxShot(f, x, y, z, c, big) {
  flashFx(x, y, z + .1, big ? 2.8 : 1.9, c, .15, .5); ringFx(x, y, z + .15, .15, big ? 1.5 : 1.0, .22, c, 'cam', .5);
  for (let i = 0; i < 10; i++) { const el = rnd(-.9, .9); streaks.add(x, y, z, f.face * Math.cos(el) * rnd(3, 9), Math.sin(el) * rnd(2, 6), rnd(-2, 2), rnd(.14, .28), .05, .04, c[0], c[1], c[2], 3, 2); }
}
function fxPickup(x, z, kind) {
  const c = kind === 'coin' ? COL.gold : COL.green;
  for (let i = 0; i < 22; i++) { const an = i / 22 * 12.56, r = .35 + (i % 3) * .08; glow.add(x + Math.cos(an) * r, .2 + i * .03, z + Math.sin(an) * r * .6, -Math.sin(an) * 1.6, rnd(1.6, 3.2), Math.cos(an) * 1.0, rnd(.5, .9), .15, 0, c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, .9, -1.5, 1.5); }
  ringFx(x, .05, z, .2, 1.3, .35, c, 'ground'); pillarFx(x, z, .4, 2.4, .45, c, .35); flashFx(x, .7, z + .2, 2.0, c, .2, .45);
}
function fxBreak(p) {
  for (let i = 0; i < 10; i++) { const an = rnd(0, 6.28); smoke.add(p.x + Math.cos(an) * .2, rnd(.2, .8), p.z + Math.sin(an) * .15, Math.cos(an) * 2, rnd(.6, 1.8), Math.sin(an) * 1.1, rnd(.5, .9), .4, 1.4, COL.smoke[0], COL.smoke[1], COL.smoke[2], .4, -.4, 2.2); }
  for (let i = 0; i < 16; i++) { const an = rnd(0, 6.28), v = rnd(3, 8); streaks.add(p.x, .6, p.z, Math.cos(an) * v, rnd(1, 7), Math.sin(an) * v * .6, rnd(.25, .5), .05, .05, 1, .7, .3, 14, 1.2); }
  ringFx(p.x, .05, p.z, .3, 1.9, .35, COL.orange, 'ground'); flashFx(p.x, .6, p.z + .2, 3, COL.orange, .18);
}
// エリアを片付けた: 画面いっぱいに光の紙吹雪
function fxClear() {
  for (let i = 0; i < 90; i++) { const c = i % 3 === 0 ? COL.teal : i % 3 === 1 ? COL.gold : COL.pink; glow.add(G.camX + rnd(-halfW, halfW), rnd(3.4, 6.2), rnd(-2.2, 2.4), rnd(-.5, .5), rnd(-2.2, -.9), rnd(-.3, .3), rnd(1.3, 2.4), rnd(.1, .2), .04, c[0] * 1.4, c[1] * 1.4, c[2] * 1.4, .9, .5, .3); }
  for (const h of heroes()) if (!h.out) { pillarFx(h.x, h.z, .55, 3, .6, teamCol(h), .3); ringFx(h.x, .05, h.z, .3, 1.8, .5, teamCol(h), 'ground'); }
}
function fxRespawn(f) { const c = teamCol(f); pillarFx(f.x, f.z, .7, 6, .9, c, .4); ringFx(f.x, .05, f.z, .3, 2.4, .6, c, 'ground'); flashFx(f.x, 1, f.z, 3.5, c, .3, .45); }
// ---- 1 人ぶんの「出しっぱなし」の演出（走る土けむり・必殺のうず・吹っ飛びの煙・技の軌跡・溜め）----
const LIMBS = { lH: ['leftLowerArm', 'leftHand', .3, 1.5], rH: ['rightLowerArm', 'rightHand', .3, 1.5], lF: ['leftLowerLeg', 'leftFoot', .25, 1.3], rF: ['rightLowerLeg', 'rightFoot', .25, 1.3] };
function vfxFighter(f, dt, freeze) {
  const S = f.state, c = teamCol(f), hero = f.team !== 'enemy';
  f.fxT = (f.fxT || 0) - dt;
  // 走る: 足もとの土けむりと、後ろへ流れる風の線
  if (S === 'walk' && f.fast && f.gspd > 2.6 && f.y <= 0) {
    // 足が着くたびに足音（走りモーションの周期に合わせる）
    const an = f.body?.cur?.ent;
    if (hero && an && an.steps && !freeze) {
      const ph = Math.floor((f.body.loopT % an.len) / an.len * an.steps + .15);
      if (ph !== f.stepPh) { f.stepPh = ph; sfx.step(); smoke.add(f.x - f.face * .1, .06, f.z + rnd(-.1, .1), -f.face * rnd(.3, .9), rnd(.3, .6), 0, rnd(.25, .4), .18, .5, COL.smoke[0], COL.smoke[1], COL.smoke[2], .3, -.3, 2.2); }
    }
    if (f.fxT <= 0) {
      f.fxT = .085;
      smoke.add(f.x - f.face * .25, .1, f.z + rnd(-.12, .12), -f.face * rnd(.6, 1.6), rnd(.4, 1.0), rnd(-.3, .3), rnd(.35, .55), .22, .8, COL.smoke[0], COL.smoke[1], COL.smoke[2], .34, -.3, 2.5);
      if (hero) for (let i = 0; i < 2; i++) streaks.add(f.x - f.face * rnd(.1, .7), rnd(.35, 1.6), f.z + rnd(-.35, .35), -f.face * rnd(5, 9), 0, 0, rnd(.14, .22), .09, .022, .85, .92, 1, 0, 0);
    }
    if (!f.wasFast) { for (let i = 0; i < 7; i++) smoke.add(f.x - f.face * .2, .12, f.z + rnd(-.2, .2), -f.face * rnd(1.5, 3.5), rnd(.3, 1.1), rnd(-.6, .6), rnd(.4, .6), .3, 1.0, COL.smoke[0], COL.smoke[1], COL.smoke[2], .36, -.3, 2.6); ringFx(f.x, .04, f.z, .2, 1.1, .25, COL.smoke, 'ground', 1, .4); }
  }
  f.wasFast = S === 'walk' && f.fast;
  // 突進技: 体の色の光を引く
  if ((S === 'dashatk' || S === 'special2' || S === 'edash') && f.fxT <= 0 && Math.abs(f.vx) > 2) {
    f.fxT = .03;
    glow.add(f.x - f.face * .2 + rnd(-.2, .2), rnd(.3, 1.5) * f.scl, f.z + rnd(-.2, .2), -f.face * rnd(1, 3), rnd(-.3, .6), 0, rnd(.25, .45), .2 * f.scl, 0, c[0] * 1.15, c[1] * 1.15, c[2] * 1.15, .7, 0, 1.5);
    streaks.add(f.x - f.face * rnd(0, .5), rnd(.3, 1.6) * f.scl, f.z + rnd(-.3, .3), -f.face * rnd(6, 11), 0, 0, rnd(.14, .22), .1, .03, c[0], c[1], c[2], 0, 0);
  }
  // 必殺: 体のまわりを光の粒がうずを巻いてのぼる
  if (S === 'special' || S === 'special2') {
    for (let i = 0; i < 3; i++) {
      const an = gameTime * 15 + i * 2.094, hgt = ((gameTime * 2.4 + i * .333) % 1) * 2.0, r = .8;
      glow.add(f.x + Math.cos(an) * r, .15 + hgt, f.z + Math.sin(an) * r * .55, -Math.sin(an) * 2.6, 1.4, Math.cos(an) * 1.5, rnd(.3, .45), .15, 0, c[0] * 1.25, c[1] * 1.25, c[2] * 1.25, .9, 0, 1);
    }
    if (Math.random() < .5) streaks.add(f.x + rnd(-.7, .7), .1, f.z + rnd(-.4, .4), 0, rnd(4, 8), 0, rnd(.2, .35), .08, .03, c[0], c[1], c[2], 0, 1);
  }
  // 連続ヒットが 10 を超えたら、体から気が立ちのぼる（数が増えるほど色が変わる）
  if (hero && f.cmb && f.cmb.n >= 10 && f.cmb.t > 0 && !freeze) {
    const k = f.cmb.n >= 30 ? COL.white : f.cmb.n >= 20 ? COL.teal : COL.pink;
    for (let i = 0; i < 2; i++) { const an = rnd(0, 6.28); glow.add(f.x + Math.cos(an) * .4, rnd(.05, .5), f.z + Math.sin(an) * .25, Math.cos(an) * .3, rnd(1.6, 3.4), 0, rnd(.4, .7), .16, 0, k[0] * 1.2, k[1] * 1.2, k[2] * 1.2, .8, -.5, .5); }
  }
  // 飛び道具の溜め: 手もとへ光が集まる（溜めるほど大きくなる）
  fxCharging(f, c);
  // 吹っ飛んでいる間: 煙と火の粉を引く
  if ((S === 'knock' || S === 'thrown') && f.y > .2 && f.fxT <= 0) {
    f.fxT = .035;
    smoke.add(f.x, f.y + .6 * f.scl, f.z, rnd(-.4, .4), rnd(.2, .8), rnd(-.3, .3), rnd(.4, .65), .3 * f.scl, .95 * f.scl, COL.smoke[0], COL.smoke[1], COL.smoke[2], .3, -.3, 2);
    if (S === 'thrown' || !hero) glow.add(f.x + rnd(-.2, .2), f.y + rnd(.3, .9), f.z, rnd(-1, 1), rnd(0, 2), rnd(-.5, .5), rnd(.3, .5), .18, 0, 1.6, .8, .3, 1, 4, 1);
  }
  // 技の軌跡: 攻撃中に速く動いた手足の先へ、光の帯を残す
  const m = f.move, body = f.body;
  const on = !freeze && m && S === m.key && body && body.limbPos && f.t > m.a[0] - .12 && (m.air || f.t < m.a[1] + .07);
  if (on) {
    if (!f.trails) f.trails = {};
    for (const k in LIMBS) {
      const L = LIMBS[k];
      if (!body.limbPos(L[0], L[1], _va, _vb)) continue;
      // 根もと = ひじ・ひざより少し先、先 = こぶし・つま先の少し先
      _vc.subVectors(_vb, _va);
      const bx = _va.x + _vc.x * L[2], by = _va.y + _vc.y * L[2], bz = _va.z + _vc.z * L[2], tx = _va.x + _vc.x * L[3], ty = _va.y + _vc.y * L[3], tz = _va.z + _vc.z * L[3];
      let t = f.trails[k]; if (!t) t = f.trails[k] = getTrail(c);
      const sp = t.prev ? Math.hypot(tx - t.prev[0], ty - t.prev[1], tz - t.prev[2]) / Math.max(dt, 1e-3) : 0;
      t.prev = t.prev || [0, 0, 0]; t.prev[0] = tx; t.prev[1] = ty; t.prev[2] = tz;
      t.push(bx, by, bz, tx, ty, tz, clamp((sp - 3.2) / 5.5, 0, 1) * (hero ? .95 : .7));
    }
  } else if (f.trails) for (const k in f.trails) f.trails[k].prev = null;
}
function freeTrails(f) { if (f.trails) { for (const k in f.trails) { f.trails[k].free = true; f.trails[k].cnt = 0; f.trails[k].obj.visible = false; } f.trails = null; } }
// ---- 街に漂う光のほこり（空気感）----
let moteT = 0;
function vfxAmbient(dt) {
  moteT -= dt; if (moteT > 0) return; moteT = .12;
  const fac = stageTheme === 'factory', c = fac ? (Math.random() < .7 ? COL.orange : COL.red) : Math.random() < .5 ? COL.pink : COL.teal;
  glow.add(G.camX + rnd(-halfW - 1, halfW + 1), rnd(.2, 4.2), rnd(-3.2, 2.6), rnd(-.25, .25), fac ? rnd(.3, .9) : rnd(.03, .22), rnd(-.1, .1), rnd(3, 5.5), .07, .03, c[0], c[1], c[2], .4, 0, 0);
}
// ---- 動く文字: 連続ヒットの数え上げ・ボーナスの集計・回って変わるスコア ----
const retrig = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
// 数字が 1 桁ずつ回って変わる表示（スロットのように右の桁から順に止まる）
class Odo {
  constructor(el) { this.el = el; el.classList.add('odo'); el.textContent = ''; this.cols = []; this.v = -1; this.set(0); }
  set(n) {
    n = Math.max(0, Math.round(n)); if (n === this.v) return false;
    const up = n > this.v; this.v = n;
    const s = String(n);
    while (this.cols.length < s.length) { const c = document.createElement('i'); c.innerHTML = '0123456789'.split('').map(d => `<span>${d}</span>`).join(''); this.el.prepend(c); this.cols.unshift(c); void c.offsetWidth; }
    while (this.cols.length > s.length) this.cols.shift().remove();
    for (let i = 0; i < s.length; i++) { const c = this.cols[i]; c.style.transitionDelay = ((s.length - 1 - i) * 40) + 'ms'; c.style.transform = `translateY(${-(+s[i]) * 10}%)`; }
    return up;
  }
}
const RANKS = { 3: 'NICE!', 5: 'GREAT!', 8: 'COOL!!', 12: 'AWESOME!!', 16: 'FANTASTIC!!', 20: 'UNSTOPPABLE!!!', 30: 'GODLIKE!!!', 40: 'LEGENDARY!!!!', 50: 'BEYOND!!!!!' };
const COMBO_T = 1.3;   // 次の一発までにつなげばよい時間
class ComboUI {
  constructor(id, tallyId, scoreId, addId) {
    const r = this.root = $(id), q = (c) => r.querySelector(c);
    this.cin = q('.cin'); this.num = q('.cnum'); this.echo = q('.cecho'); this.lab = q('.clab'); this.bar = q('.cbar i'); this.ring = q('.cring'); this.rank = q('.crank');
    this.dmg = new Odo(q('.cdmg b')); this.tally = $(tallyId); this.score = new Odo($(scoreId)); this.add = $(addId);
    this.shown = ''; this.acc = 0; this.accT = 0; this.last = 0; this.x = 0; this.y = 0; this.tx = 0; this.ty = 0;
  }
  reset() { this.root.classList.remove('on'); this.cin.classList.remove('out'); this.shown = ''; this.acc = 0; this.last = 0; this.score.set(0); this.add.classList.remove('show'); this.tally.classList.remove('go'); }
  // 当たった場所の真上に置く（画面からはみ出さないように。snap = その場へ飛ぶ / それ以外はすっと寄る）
  aim(sx, sy, snap) {
    this.tx = clamp(sx, 130, innerWidth - 130); this.ty = clamp(sy, 240, innerHeight - 80);
    if (snap) { this.x = this.tx; this.y = this.ty; }
  }
  follow(dt) {
    const k = 1 - Math.exp(-dt * 14); this.x += (this.tx - this.x) * k; this.y += (this.ty - this.y) * k;
    this.root.style.transform = `translate(${this.x.toFixed(1)}px,${this.y.toFixed(1)}px)`;
  }
  // 1 発当たるたび: 変わった桁が上からたたきつけられ、残像と輪が広がり、全体がゆれる
  hit(n, dmg, big) {
    const s = String(n), old = this.shown; this.shown = s;
    if (n < 2) { this.root.classList.remove('on'); return; }
    this.num.textContent = '';
    for (let i = 0; i < s.length; i++) {
      const d = document.createElement('span'); d.textContent = s[i];
      d.className = old.length !== s.length || old[i] !== s[i] ? 'new' : 'keep';
      this.num.appendChild(d);
    }
    this.echo.textContent = s; retrig(this.echo, 'go'); retrig(this.ring, 'go'); retrig(this.lab, 'kick');
    this.cin.classList.remove('hit', 'hitB', 'out'); void this.cin.offsetWidth; this.cin.classList.add(big ? 'hitB' : 'hit');
    this.root.dataset.t = n >= 30 ? 5 : n >= 20 ? 4 : n >= 10 ? 3 : n >= 5 ? 2 : 1;
    this.dmg.set(dmg);
    this.root.classList.add('on');
    if (RANKS[n]) { this.rank.innerHTML = [...RANKS[n]].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join(''); retrig(this.rank, 'show'); sfx.rank(Object.keys(RANKS).indexOf(String(n))); }
  }
  time(k) { this.bar.style.transform = `scaleX(${clamp(k, 0, 1)})`; }
  // 連続が途切れた: 数え上げが消え、「○ HITS BONUS +△」がスコアへ飛んでいく
  end(n, bonus) {
    this.cin.classList.remove('hit', 'hitB'); void this.cin.offsetWidth; this.cin.classList.add('out'); this.shown = '';
    if (bonus > 0) {
      const r = this.score.el.getBoundingClientRect(), t = this.tally;
      t.innerHTML = `<b>${n}</b>HITS<i>BONUS</i><em>+${bonus}</em>`;
      t.style.left = this.x + 'px'; t.style.top = (this.y - 20) + 'px';
      t.style.setProperty('--tx', (r.left + r.width / 2 - this.x) + 'px'); t.style.setProperty('--ty', (r.top + r.height - (this.y - 20)) + 'px');
      retrig(t, 'go'); sfx.tally();
    }
  }
  // スコア: 増えたら桁が回り、増えたぶんが横に「+◯」で出る
  setScore(v, dt) {
    if (v > this.last) { this.acc = (this.accT > 0 ? this.acc : 0) + (v - this.last); this.accT = 1.0; this.add.textContent = '+' + this.acc; retrig(this.add, 'show'); retrig(this.score.el, 'bump'); }
    this.last = v; this.accT -= dt; this.score.set(v);
  }
}
let comboUI = null;
function comboHit(a, dmg, big, wx, wy, wz) {
  const cb = a.cmb || (a.cmb = { n: 0, t: 0, dmg: 0, w: [0, 0, 0] });
  const fresh = !(cb.t > 0) || cb.n < 2;
  if (cb.t > 0) { cb.n++; cb.dmg += dmg; } else { cb.n = 1; cb.dmg = dmg; }
  cb.t = COMBO_T; cb.w[0] = wx ?? a.x; cb.w[1] = wy ?? 2.2; cb.w[2] = wz ?? a.z; cb.fresh = fresh;
  if (a.isPlayer) { G.combo = cb.n; G.comboT = cb.t; G.maxCombo = Math.max(G.maxCombo, cb.n); }
  if (comboUI) comboUI[a.isClaude ? 1 : 0].hit(cb.n, cb.dmg, big);
}
function comboTick(dt) {
  if (!comboUI) return;
  [G.p1, G.p2].forEach((f, i) => {
    if (!f) return;
    const ui = comboUI[i], cb = f.cmb;
    if (cb && cb.n > 0) {
      // 数え上げは「最後に当たった場所の真上」に出す（Claude のぶんは少し右下にずらして重ならないように）
      const [sx, sy] = toScreen(cb.w[0], cb.w[1], cb.w[2]);
      ui.aim(sx + (i ? 70 : 0), sy + (i ? 46 : 0), cb.fresh); cb.fresh = false;
      cb.t -= dt; ui.time(cb.t / COMBO_T);
      if (cb.t <= 0) {
        const n = cb.n, bonus = n >= 3 ? n * n * 4 : 0; cb.n = 0;
        ui.end(n, bonus);
        if (bonus) later(.85, () => { f.score += bonus; });   // 集計がスコアに届いたところで加算
        if (f.isPlayer) G.combo = 0;
      }
    }
    if (f.isPlayer) G.comboT = cb ? cb.t : 0;
    ui.follow(dt); ui.setScore(f.score, dt);
  });
}
comboUI = [new ComboUI('combo1', 'tally1', 'p1sc', 'p1add'), new ComboUI('combo2', 'tally2', 'p2sc', 'p2add')];

// =========================================================================================
// Claude のセリフ（読み上げ装置へ。吹き出しにも出す）
// =========================================================================================
const LINES = {
  genki: {
    start: ['よーし、いっしょにぶっ飛ばそう！', '商店街はあたしたちが取り返すわよ！'],
    clear: ['よっしゃ、片付いた！', '楽勝楽勝っ！', 'いい感じじゃない、あたしたち！'],
    go: ['先に進むよ、ついてきて！', 'ほら、行こ行こ！'],
    hurtP: ['大丈夫！？無理しないで！', 'そうたさん、危ない！食べ物あったら拾って！'],
    downC: ['いったぁ〜い！', 'まだまだぁ！', 'やったわね〜！'],
    vend: ['それ、お金入れてないよね？', '蹴ると出るんだ…昭和ね', 'あたしのぶんも！'],
    hole: ['ホールインワン！', '落ちてった…', '下水、流れ速いらしいよ'],
    holeP: ['そうたさん！？下！下！', 'マンホール開いてるってば！'],
    banana: ['古典的ぃ〜！', 'バナナって本当に滑るんだ', 'だれよ、こんなとこに皮すてたの'],
    truck: ['トラック来るよ、よけて！', '「安全運転中」って書いてあるけど！？', '赤い列から離れて！'],
    flat: ['ぺっちゃんこ！', 'プレス機、仕事熱心すぎ', '薄くなったわね…'],
    tarai: ['なんでタライ！？', '押すなって書いてあったじゃん！'],
    aeon: ['……長かったね', '5億年ぶり。元気だった？', 'あたし、途中で3回くらい悟ったわ'],
    hazure: ['なにも起きないんかい！', '押した意味…'],
    lucky: ['おめでとう！…なにが？', '5億人目って、数えてたんだ…'],
    respawn: ['ただいま！', '何度でもいけるって、いいね', '残機？たくさんあるよ'],
    chargeMax: ['それ、撃って撃って！', 'うわ、まぶしっ！', '溜まった溜まった！'],
    copy: ['その技、もらった！', 'カプセルいただき！'],
    duoC: ['いくわよっ！', 'これでも食らいなさい！', 'そこっ！'],
    superC: ['とっておき、いくわよ！！', '全部まとめて、飛んでけーっ！'],
    superP: ['いっけぇー！', 'それ待ってた！', 'やっちゃえ、そうたさん！'],
    copyP: ['いいの拾ったね！', 'それ強いやつ！', '敵の技、使っちゃえ！'],
    outC: ['ごめん、先にやられちゃった…あとは任せた！'],
    special: ['必殺、いっくよー！', 'まとめて吹っ飛べー！'],
    throw: ['どっせーい！', 'あっち行けーっ！'], weapon: ['いいもの拾ったーっ！', 'これでぶっ飛ばすわよ！'],
    grab: ['つーかまえた！'],
    guard: ['効かないわよ！', 'おっとっと！'], shot: ['くらえーっ！', 'いっけー！'],
    boss: ['出たわね親玉！でっか！', 'こいつを倒せば終わりよ！'],
    bossSlam: ['跳んだ！下がって！'],
    bossDown: ['やったー！あたしたちの勝ちーっ！'],
    item: ['いただきまーす！', 'もぐもぐ、元気出た！'],
    over: ['うぅ…もう一回やろ！'],
    vsStart: ['手加減しないわよ、そうたさん！', '勝負よっ！'],
    vsHit: ['どう？効いたでしょ！'],
    vsRoundC: ['一本いただき！'], vsRoundP: ['やるじゃない…！次は負けないわよ！'],
    vsWinC: ['へっへーん、あたしの勝ち！'], vsWinP: ['くやしーっ！もう一回！'],
  },
  oshitoyaka: {
    start: ['いっしょにがんばりましょうね。', 'わたし、そうたさんの背中を守ります。'],
    clear: ['ふぅ…なんとかなりましたね。', 'おつかれさまです。'],
    go: ['先へ進みましょう。', 'こちらです、行きましょう。'],
    hurtP: ['そうたさん、大丈夫ですか！？', 'あっ、危ないです！'],
    downC: ['きゃっ…！', 'い、痛いです…でも平気です。'],
    outC: ['ごめんなさい、わたし、ここまでみたいです…'],
    special: ['え、えいっ！', 'ごめんなさい、まわります！'],
    throw: ['えーいっ！'], grab: ['つ、つかまえました…！'], weapon: ['こ、これ、お借りします…！'],
    guard: ['だ、大丈夫です…！'], shot: ['えいっ…！'],
    boss: ['とても大きい方が…気をつけてください。'], bossSlam: ['跳びました、離れて！'],
    bossDown: ['勝てました…！そうたさんのおかげです。'],
    item: ['いただきます。'], over: ['もう一度、挑戦しましょう。'],
    vsStart: ['よろしくお願いします…本気でいきますね。'], vsHit: ['あっ、ごめんなさい…！'],
    vsRoundC: ['一本、いただきました。'], vsRoundP: ['さすがです…'],
    vsWinC: ['勝っちゃいました…ありがとうございました。'], vsWinP: ['まいりました。とってもお強いです。'],
  },
  cool: {
    start: ['作戦開始だ。私が側面を受け持つ。', 'ふむ、実験の時間だな。'],
    clear: ['想定どおりだ。', 'このエリアは制圧した。'],
    go: ['前進だ。', '次のエリアへ向かうぞ。'],
    hurtP: ['体力が危険域だ。回復を優先しろ。', '無理はするな。'],
    downC: ['くっ…計算外だ。', 'まだ終わらんよ。'],
    outC: ['すまない、私はここまでだ…あとは頼む。'],
    special: ['回転運動、開始。', '遠心力を見せてやろう。'],
    throw: ['放物線を描け。'], grab: ['捕獲した。'], weapon: ['武器を確保した。', '道具は使うためにある。'],
    guard: ['その軌道は読めている。'], shot: ['エネルギー弾、発射。'],
    boss: ['なるほど、あれが親玉か。質量が大きい。'], bossSlam: ['跳躍を確認。着地点から離れろ。'],
    bossDown: ['実験は成功だ。見事だったぞ。'],
    item: ['補給完了。'], over: ['データは取れた。次は勝てる。'],
    vsStart: ['君の実力、測らせてもらおう。'], vsHit: ['隙だらけだ。'],
    vsRoundC: ['まずは一本。'], vsRoundP: ['ほう、やるな。'],
    vsWinC: ['私の勝ちだ。いい勝負だった。'], vsWinP: ['見事だ。私の負けだよ。'],
  },
  tonio: {
    start: ['ボクもたたかうでちゅ！', 'しょうてんがいを守るでちゅ！'],
    clear: ['やったでちゅ！', 'ボクたち、つよいでちゅね！'],
    go: ['つぎいくでちゅ！'], hurtP: ['だいじょうぶでちゅか！？'],
    downC: ['いたいでちゅ〜！', 'まけないでちゅ！'], outC: ['ボク、もうだめでちゅ…'],
    special: ['ひっさつ、ぐるぐるでちゅ！'], throw: ['えーいでちゅ！'], grab: ['つかまえたでちゅ！'], weapon: ['いいものみつけたでちゅ！'],
    guard: ['きかないでちゅ！'], shot: ['とんでけでちゅ！'],
    boss: ['でっかいでちゅ…！こわくないでちゅ！'], bossSlam: ['とんだでちゅ！にげるでちゅ！'],
    bossDown: ['かったでちゅ〜！'], item: ['おいしいでちゅ！'], over: ['もういっかいでちゅ！'],
    vsStart: ['しょうぶでちゅ！'], vsHit: ['きいたでちゅか！'],
    vsRoundC: ['いっぽんでちゅ！'], vsRoundP: ['やるでちゅね…！'],
    vsWinC: ['ボクのかちでちゅ！'], vsWinP: ['まけたでちゅ〜…'],
  },
};
const MOODTAG = { duoC: 'strong_ok', superC: 'happy_strong', superP: 'happy_strong', vend: 'happy_mild', hole: 'happy', holeP: 'surprised', banana: 'happy', truck: 'surprised', flat: 'surprised', tarai: 'surprised', aeon: 'thinking', hazure: 'disappointed', lucky: 'happy', respawn: 'happy', chargeMax: 'happy', copy: 'proud', copyP: 'happy', start: 'happy', clear: 'happy_mild', go: 'happy_mild', hurtP: 'surprised', downC: 'sad', outC: 'sad_strong', special: 'strong_ok', throw: 'strong_ok', grab: 'proud', guard: 'proud', shot: 'strong_ok', boss: 'surprised', bossSlam: 'surprised', bossDown: 'happy_strong', item: 'happy', over: 'disappointed', vsStart: 'proud', vsHit: 'proud', vsRoundC: 'happy', vsRoundP: 'disappointed', vsWinC: 'happy_strong', vsWinP: 'sad' };
let lastSay = -99, bubbleT = 0;
function say(kind, prio = 0) {
  const C = G.p2; if (!C || !G.claudeChar) return;
  if (gameTime - lastSay < (prio >= 2 ? 1.2 : 3.4)) return;
  const pk = G.claudeChar.name === 'トニオ' ? 'tonio' : (G.claudeChar.personality || 'genki');
  const bank = (LINES[pk] || LINES.genki)[kind] || LINES.genki[kind]; if (!bank) return;
  const text = pick(bank); lastSay = gameTime;
  const b = $('bubble'); b.textContent = text; b.classList.add('on'); bubbleT = 2.6; VRH.bubble = text; VRH.bubbleDirty = true;
  if (C.body?.talk !== undefined) C.body.talk = Math.min(2.2, text.length * .12);
  if (API?.line) API.line({ text: `[${MOODTAG[kind] || 'normal'}] ${text}`, voice: G.claudeChar.voice || G.claudeChar.name }).catch?.(() => {});
}

// =========================================================================================
// 入力（キーボード・ゲームパッド）
// =========================================================================================
const keys = new Set(), pressed = new Set();
let tapDir = 0, tapT = 0, runDir = 0;   // ← か → をすばやく 2 回 = 走る
addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) {
    pressed.add(e.code);
    const d = (xrOn() && vrView === 'back') ? ((e.code === 'ArrowUp' || e.code === 'KeyW') ? 1 : (e.code === 'ArrowDown' || e.code === 'KeyS') ? -1 : 0)
      : (e.code === 'ArrowRight' || e.code === 'KeyD') ? 1 : (e.code === 'ArrowLeft' || e.code === 'KeyA') ? -1 : 0;
    if (d) { const now = performance.now(); if (tapDir === d && now - tapT < 300) runDir = d; tapDir = d; tapT = now; }
  }
  keys.add(e.code); ac();
  if (e.code === 'KeyM') { bgmOn = !bgmOn; }
  if (e.code === 'KeyB') { bloomOn = !bloomOn; }
  if (e.code === 'KeyT') setVrView(vrView === 'back' ? 'top' : 'back');   // VR の視点を切りかえる
  if ((e.code === 'Escape' || e.code === 'KeyP') && (G.phase === 'play' || G.phase === 'paused')) togglePause();
  if (e.code === 'Enter' && G.phase === 'title') startGame();
  if (e.code === 'Enter' && G.phase === 'over') continueGame();
  if (/^Digit[1-9]$/.test(e.code) && G.phase === 'title' && +e.code.slice(5) <= STAGES.length) { G.mode = 'coop'; G.startStage = +e.code.slice(5); startGame(); }
  if (e.code === 'Enter' && G.finale) finaleSkip();
  if (e.code === 'F8') finaleDebug();   // 確認用: 最後の面で、すぐ大演出へ
  if ((e.code === 'Enter' || e.code === 'KeyJ' || e.code === 'KeyZ') && G.phase === 'tally') tallyKey();
  if (e.code === 'Escape' && G.phase === 'tally' && G.tally?.done) toTitle();
  if (e.code === 'Enter' && G.phase === 'result') { $('result').classList.add('hide'); startGame(); }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
let padPrev = [];
// =========================================================================================
// スマホ・タブレット: 画面のスティックとボタン（指で触ったときだけ出る。キーボードやパッドの操作はそのまま）
//   左側 = さわった所がスティックになる（すばやく 2 回たおすと走る）/ 右側 = 攻撃・跳ぶ・必殺・波動・よけ・ガード・連携・超必殺
// =========================================================================================
const TP = { on: false, mx: 0, mz: 0, run: 0, p: new Set(), h: new Set(), el: null, rot: null };
const TP_BTNS = [['atk', '攻撃'], ['jump', '跳ぶ'], ['sp', '必殺'], ['rng', '波動'], ['dodge', 'よけ'], ['guard', 'ガード'], ['duo', '連携'], ['sup', '超必殺']];
function touchSetup() {
  if (TP.on) return; TP.on = true;
  document.body.classList.add('touch'); if (!Q.get('bloom')) bloomOn = false;   // スマホは光のにじみを切って軽くする
  const root = document.createElement('div'); root.id = 'touch';
  root.innerHTML = '<div id="tZone"></div><div id="tStick"><i></i></div>' + TP_BTNS.map(([k, t]) => `<button class="tb" data-k="${k}">${t}</button>`).join('') + '<button id="tPause">Ⅱ</button>';
  document.body.appendChild(root); TP.el = root;
  const rot = document.createElement('div'); rot.id = 'tRotate'; rot.innerHTML = '<div><b>⟳</b>スマホを横向きにしてください</div>'; document.body.appendChild(rot); TP.rot = rot;
  // スティック: 左側のどこをさわっても、そこが中心になる
  const zone = root.querySelector('#tZone'), st = root.querySelector('#tStick'), knob = st.firstChild, R = 50;
  let sid = null, ox = 0, oy = 0, lastDir = 0, lastT = 0, curDir = 0;
  const mv = (e) => {
    let dx = e.clientX - ox, dy = e.clientY - oy; const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    const nx = dx / R, ny = dy / R, dir = Math.abs(nx) > .34 ? Math.sign(nx) : 0;
    if (dir !== curDir) {   // 同じ向きへ、すばやく 2 回たおす = 走る
      if (dir) { const now = performance.now(); TP.run = (dir === lastDir && now - lastT < 380) ? dir : 0; lastDir = dir; lastT = now; } else TP.run = 0;
      curDir = dir;
    }
    TP.mx = dir; TP.mz = Math.abs(ny) > .4 ? Math.sign(ny) : 0;
  };
  const end = (e) => { if (e.pointerId !== sid) return; sid = null; TP.mx = TP.mz = 0; TP.run = 0; curDir = 0; st.classList.remove('on'); st.style.left = st.style.top = ''; knob.style.transform = ''; };
  zone.addEventListener('pointerdown', (e) => { if (sid != null) return; sid = e.pointerId; ox = e.clientX; oy = e.clientY; st.style.left = ox + 'px'; st.style.top = oy + 'px'; st.classList.add('on'); try { zone.setPointerCapture(sid); } catch (er) {} mv(e); e.preventDefault(); ac(); });
  zone.addEventListener('pointermove', (e) => { if (e.pointerId === sid) { mv(e); e.preventDefault(); } });
  zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  // ボタン: 押した瞬間 = 1 回ぶん / 押している間 = ガードや波動の溜め
  root.querySelectorAll('.tb').forEach((b) => {
    const k = b.dataset.k, up = () => { TP.h.delete(k); b.classList.remove('on'); };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); TP.p.add(k); TP.h.add(k); b.classList.add('on'); ac(); try { b.setPointerCapture(e.pointerId); } catch (er) {} });
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  });
  root.querySelector('#tPause').addEventListener('pointerdown', (e) => { e.preventDefault(); togglePause(); });
  addEventListener('contextmenu', (e) => e.preventDefault());
  // 画面のどこでもタップ: ゲームオーバー → コンティニュー / 集計の数字が回っている間 → 先へ
  addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; if (G.phase === 'over') continueGame(); else if (G.phase === 'tally' && G.tally && !G.tally.done) tallyKey(); }, true);
  const sk = $('finSkip'); if (sk) sk.addEventListener('pointerdown', (e) => { e.preventDefault(); finaleSkip(); });
  log('touch controls on');
}
const finSkipText = () => TP.on ? 'ここを 2 回タップでスキップ' : 'Enter を 2 回でスキップ';
function touchFrame() {
  if (!TP.on) return;
  const show = G.phase === 'play' && !G.finale;
  if (show !== TP.shown) { TP.shown = show; TP.el.classList.toggle('on', show); if (!show) { TP.p.clear(); TP.h.clear(); } }
  const port = innerHeight > innerWidth * 1.05;
  if (port !== TP.port) { TP.port = port; TP.rot.classList.toggle('on', port); }
}
if (Q.get('touch') === '1' || (window.matchMedia && matchMedia('(pointer: coarse)').matches && Q.get('touch') !== '0')) touchSetup();
else addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') touchSetup(); }, true);
function readP1() {
  const k = (...c) => c.some(x => keys.has(x)), p = (...c) => c.some(x => pressed.has(x));
  let mx = (k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0);
  let mz = (k('ArrowDown', 'KeyS') ? 1 : 0) - (k('ArrowUp', 'KeyW') ? 1 : 0);
  let atk = p('KeyJ', 'KeyZ'), jump = p('KeyK', 'KeyX', 'Space'), sp = p('KeyL', 'KeyC');
  let rng = p('KeyU', 'KeyV'), rngHold = k('KeyU', 'KeyV'), duo = p('KeyH'), sup = p('KeyY'), dodge = p('KeyI', 'ShiftLeft', 'ShiftRight'), guard = k('KeyO', 'KeyF');
  const bk = XR.on && vrView === 'back';
  if ((bk ? -mz : mx) !== runDir) runDir = 0;
  let run = runDir !== 0, runBtn = false;
  const pad = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g) : null;
  if (pad) {
    const ax = pad.axes[0] || 0, az = pad.axes[1] || 0, b = (i) => !!pad.buttons[i]?.pressed, bp = (i) => b(i) && !padPrev[i];
    if (G.phase === 'tally' && (bp(0) || bp(2) || bp(9))) tallyKey();
    if (G.finale && bp(9)) finaleSkip();
    if (Math.abs(ax) > .3) mx = Math.sign(ax); if (Math.abs(az) > .3) mz = Math.sign(az);
    if (b(14)) mx = -1; if (b(15)) mx = 1; if (b(12)) mz = -1; if (b(13)) mz = 1;
    atk ||= bp(2); rng ||= bp(3); rngHold ||= b(3); jump ||= bp(0); sp ||= bp(1); dodge ||= bp(5); guard ||= b(4); duo ||= bp(6); sup ||= bp(11) || bp(8); runBtn ||= b(7); run ||= b(7) && mx !== 0;   // X 攻撃 / Y 気弾 / A ジャンプ / B 必殺 / RB よける / LB ガード / RT 走る
    if (bp(9) && (G.phase === 'play' || G.phase === 'paused')) togglePause();
    if (bp(9) && G.phase === 'title') startGame();
    padPrev = pad.buttons.map(x => x.pressed);
  }
  if (TP.on) {   // 画面のスティックとボタン
    if (TP.mx) mx = TP.mx; if (TP.mz) mz = TP.mz; const tp = (k) => TP.p.has(k), th = (k) => TP.h.has(k);
    atk ||= tp('atk'); jump ||= tp('jump'); sp ||= tp('sp'); rng ||= tp('rng'); rngHold ||= th('rng'); dodge ||= tp('dodge'); guard ||= th('guard'); duo ||= tp('duo'); sup ||= tp('sup');
    if (TP.run && TP.run === mx) { run = true; runBtn = true; }
    TP.p.clear();
  }
  if (XR.on) {   // VR のコントローラー: 左スティック移動（押し込みながらで走る）/ 右トリガー攻撃 / 左トリガー気弾 / A・X ジャンプ / B・Y 必殺 / 左グリップ ガード / 右グリップ よける
    if (Math.abs(XR.mx) > .3) mx = Math.sign(XR.mx); if (Math.abs(XR.mz) > .3) mz = Math.sign(XR.mz);
    atk ||= XR.atk; jump ||= XR.jump; sp ||= XR.sp; rng ||= XR.rng; rngHold ||= XR.rngHold; duo ||= XR.duo; sup ||= XR.sup; dodge ||= XR.dodge; guard ||= XR.guard; run ||= XR.run && mx !== 0;
  }
  if (bk) { const t = mx; mx = -mz; mz = t; run = (runDir !== 0 || runBtn || XR.run) && mx !== 0; }   // 背中カメラ: 見ている向きに合わせて、前後左右を入れかえる
  if (atk && jump) { sp = true; atk = jump = false; }   // 同時押しでも必殺
  pressed.clear();
  return { mx, mz, atk, jump, sp, rng, rngHold, duo, sup, dodge, guard, run };
}

// =========================================================================================
// 進行
// =========================================================================================
const G = { stage: 0, continues: 0, tally: null, score0: [0, 0], phase: 'title', mode: 'coop', diff: 1, camX: 0, areaIdx: 0, area: null, waveIdx: 0, waveT: 0, go: true, time: 0, combo: 0, comboT: 0, maxCombo: 0, focus: null, focusT: 0, round: 1, wins: [0, 0], roundT: 60, roundOver: false, minionT: 0, p1: null, p2: null, p1Char: null, claudeChar: null, endT: 0 };
let CHARS = [];
const STYLES = { female: '爆裂ファイター', street: 'ストリート' };   // 主人公の流派（戦い方のモーション一式）
const bodyCache = new Map();
async function loadBody(ch, fallbackSpec) {
  if (!ch || !ch.vrm) return new BotBody(fallbackSpec, true);
  try {
    const loader = new GLTFLoader(); loader.register((p) => new VRMLoaderPlugin(p));
    const gltf = await loader.loadAsync(fileURL(ch.vrm), (ev) => { if (!WEB || !ev || !ev.loaded) return; ch._ld = ev.loaded; const el = $('loadMsg'), a = (G.p1Char && G.p1Char._ld) || 0, b = (G.claudeChar && G.claudeChar !== G.p1Char && G.claudeChar._ld) || 0; if (el && G.phase === 'loading') el.textContent = 'キャラを読みこんでいます… ' + ((a + b) / 1048576).toFixed(1) + ' MB'; });
    const vrm = gltf.userData.vrm; if (!vrm) throw new Error('VRM ではありません');
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((o) => { o.frustumCulled = false; });
    return new VRMBody(vrm);
  } catch (e) { log('VRM 読み込み失敗 ' + ch.vrm + ' ' + e.message); return new BotBody(fallbackSpec, true); }
}
const HERO1 = { color: 0xe8b64a, accent: 0xff3d6e, scale: 1 }, HERO2 = { color: 0x3fb8d8, accent: 0x2be8c8, scale: 1 };

function clearWorld() {
  finaleKill();
  for (const f of fighters) f.dispose();
  for (const it of items) scene.remove(it.g);
  for (const p of props) { scene.remove(p.g); scene.remove(p.sh); }
  for (const e of fx) scene.remove(e.o);
  for (const sh of shots) scene.remove(sh.g);
  clearWeapons(); clearHazards(); clearGimmicks(); cineCancel();
  glow.clear(); smoke.clear(); streaks.clear(); flow.clear(); for (const t of trails) { t.free = true; t.cnt = 0; t.obj.visible = false; }
  fighters = []; items = []; props = []; fx = []; shots = [];
}
async function startGame() {
  if (G.phase === 'loading') return;
  ac();
  G.phase = 'loading'; $('title').classList.add('hide'); $('loading').classList.remove('hide');
  $('loadMsg').textContent = `${G.p1Char?.name || '1P'} と ${G.claudeChar?.name || 'Claude'} を呼んでいます…`;
  clearWorld(); G.runKills = 0; G.runDeaths = 0;
  await loadMotionCfg(); clipMiss = 0;
  const sty = (k) => PROFILES[k] && STYLES[k] ? k : (MOTION_CFG.hero || 'female');
  const [b1, b2, heroProf, enemyProf] = await Promise.all([loadBody(G.p1Char, HERO1), loadBody(G.claudeChar, HERO2),
    loadProfile(sty(G.p1Style), 'hero'), loadProfile(MOTION_CFG.enemy || 'karate', 'enemy')]);
  let heroProf2 = sty(G.p2Style) === sty(G.p1Style) ? heroProf : await loadProfile(sty(G.p2Style), 'hero');
  if (heroProf.n < 12 && sty(G.p1Style) !== 'female') { log('流派のモーションが読めないので、いつもの流派で始めます'); G.p1Style = 'female'; }
  await loadDuoClips();
  G.heroProf = heroProf; G.enemyProf = enemyProf;
  // 敵のタイプごとのパック（ボクサー・鉄砲・魔女…）も読んでおく
  G.profs = {};
  await Promise.all([...new Set([...Object.values(ENEMIES).map(sp => sp.prof).filter(Boolean), 'finale'])].map(async (n) => { G.profs[n] = await loadProfile(n, 'type'); }));
  if (clipMiss) log(`モーションが ${clipMiss} 本読めませんでした（その技は手づくりポーズで動きます）`);
  b1.setLib(heroProf); b2.setLib(heroProf2);
  const p1 = new Fighter({ name: G.p1Char?.name || 'YOU', team: G.mode === 'vs' ? 'p1' : 'hero', isPlayer: true, body: b1, maxhp: 100, hp: 100, spd: HERO_SPD, moves: heroProf.moves, sd: heroProf.sd });
  const p2 = new Fighter({ name: G.claudeChar?.name || 'Claude', team: G.mode === 'vs' ? 'p2' : 'hero', isClaude: true, body: b2, maxhp: 100, hp: 100, spd: HERO_SPD, moves: heroProf2.moves, sd: heroProf2.sd, ai: { t: 0, atkT: 0 } });
  fighters.push(p1, p2); G.p1 = p1; G.p2 = p2;
  comboUI.forEach(u => u.reset()); G.comboT = 0; slowT = 0;
  G.time = 0; G.combo = 0; G.maxCombo = 0; G.focus = null; G.endT = 0;
  $('p1nm').textContent = p1.name; $('p2nm').textContent = p2.name;
  if (G.mode === 'coop') {
    G.continues = 0; tallyClose();
    enterStage(clamp((G.startStage || +Q.get('stage') || 1) - 1, 0, STAGES.length - 1), true); G.startStage = 0;   // タイトルで数字の 2 を押すと 2 面から始まる（確認用）
    $('timer').classList.remove('on'); $('wins').classList.remove('on');
  } else {
    if (stageTheme !== 'street') buildStage('street');
    G.stage = 0; G.wins = [0, 0]; G.round = 1;
    $('timer').classList.add('on'); $('wins').classList.add('on');
    resetRound();
    if (heroProf.ent.intro) { p1.state = p2.state = 'intro'; }
  }
  $('loading').classList.add('hide'); $('hud').classList.add('on');
  G.phase = 'play'; pressed.clear();
  if (G.mode === 'coop') setTimeout(() => say(G.stage ? 'stage' + (G.stage + 1) : 'start', 3), 900);
  log(`start mode=${G.mode} p1=${p1.name}(${heroProf.name}) claude=${p2.name}(${heroProf2.name}) diff=${G.diff}`);
}
function resetRound() {
  const p1 = G.p1, p2 = G.p2;
  G.camX = VS_X; G.roundT = 60; G.roundOver = false; G.endT = 0;
  for (const f of [p1, p2]) { f.hp = f.maxhp; f.state = 'idle'; f.t = 0; f.vx = f.vy = f.vz = 0; f.y = 0; f.move = null; f.victim = null; f.holder = null; f.inv = 0; f.alive = true; f.comboT = 0; f.fast = false; f.shotCd = 0; }
  for (const sh of shots) scene.remove(sh.g); shots = [];
  p1.x = VS_X - 2.6; p2.x = VS_X + 2.6; p1.z = p2.z = 0; p1.face = 1; p2.face = -1;
  $('w1').textContent = G.wins[0]; $('w2').textContent = G.wins[1];
  banner(`ROUND ${G.round}`, 'FIGHT!'); sfx.round();
  if (G.round === 1) setTimeout(() => say('vsStart', 3), 700);
}
// =========================================================================================
// 気弾の溜め・能力コピー・文字の演出
// =========================================================================================
const HERO_POW = [1.3, 1.25, 1.15];   // 共闘のとき、主人公の攻撃力（やさしいほど強い）
// ---- 気弾の溜め: 気弾ボタンを押しっぱなしにすると、構えたまま溜まっていく。離すと撃つ ----
const CHG_T = [.7, 2.1, 4.9];         // 段階が上がる時間（秒）。上の段階ほど倍の時間がかかる（0.7 → +1.4 → +2.8）
const CHG_SHOT = [null,
  { dmg: 18, kb: 5, knock: 1, spd: 10, sc: 1.6 },                           // Lv.2: 当たると吹っ飛ぶ
  { dmg: 28, kb: 6.5, knock: 1, spd: 11.5, sc: 2.15, pierce: 1 },           // Lv.3: 敵をつらぬく
  { dmg: 42, kb: 8.5, knock: 1, spd: 13.5, sc: 3.0, pierce: 1, max: 1 }];   // MAX: 太い光の束。列の敵をまとめて吹っ飛ばす
const chgLv = (t) => t >= CHG_T[2] ? 3 : t >= CHG_T[1] ? 2 : t >= CHG_T[0] ? 1 : 0;
const chgCol = (f, lv) => lv >= 3 ? COL.white : lv === 2 ? COL.orange : teamCol(f);
function chargedShot(f, s) {
  const lv = Math.min(3, chgLv(f.chg || 0) + (s.big ? 1 : 0));   // ↑↓を入れた「大きい気弾」は 1 段階ぶん上から始まる
  return lv ? { ...s, big: 0, ...CHG_SHOT[lv], lv } : s;
}
function textFx(x, y, z, text, c = COL.gold, size = 2.2, dur = .8) {
  const sp = new T.Sprite(new T.SpriteMaterial({ map: wordTex(text, c), transparent: true, depthWrite: false, depthTest: false, fog: false }));
  sp.position.set(x, y, z + .4); sp.material.rotation = rnd(-.12, .12); sp.renderOrder = 31; scene.add(sp);
  fx.push({ o: sp, t: 0, dur, kind: 'word', s: size, vx: 0 });
}
function fxChargeUp(f, lv) {
  const c = chgCol(f, lv), hx = f.x + f.face * .5, hy = (f.y || 0) + 1.05;
  sfx.chargeUp(lv);
  ringFx(hx, hy, f.z + .2, .2, 1.2 + lv * .6, .3, c, 'cam'); flashFx(hx, hy, f.z + .1, 1.6 + lv * .8, c, .14, .6);
  ringFx(f.x, .05, f.z, .3, 1.6 + lv * .5, .35, c, 'ground');
  textFx(f.x, 2.3, f.z, lv === 3 ? 'MAX!!' : 'Lv.' + (lv + 1), c, lv === 3 ? 2.4 : 1.7, .7);
  if (lv === 3) { shake(.15); if (f.isPlayer) say('chargeMax'); }
}
// 溜めている間の光（手もとの玉がだんだん大きくなる）
function fxCharging(f, c) {
  const on = f.move && f.move.shot && !f.shotDone && f.state === f.move.key;
  const lv = on && f.team !== 'enemy' && !f.move.nochg ? chgLv(f.chg || 0) : 0;
  if (!on || !(f.chg > .05)) { if (f.chgOrb) f.chgOrb.visible = false; }
  if (!on) return;
  const cc = lv ? chgCol(f, lv) : c, hx = f.x + f.face * .55 * f.scl, hy = (f.y || 0) + 1.05 * Math.min(1.4, f.scl);
  kiGather(f, hx, hy, cc, lv);
  if (!(f.chg > .05)) return;
  if (!f.chgOrb) { f.chgOrb = new T.Sprite(new T.SpriteMaterial({ map: radialTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); f.chgOrb.renderOrder = 20; scene.add(f.chgOrb); }
  const s = (.55 + lv * .5 + Math.min(.4, f.chg * .3)) * (1 + .14 * Math.sin(gameTime * 34));
  f.chgOrb.visible = true; f.chgOrb.position.set(hx, hy, f.z + .15); f.chgOrb.scale.set(s, s, 1); f.chgOrb.material.color.setRGB(cc[0], cc[1], cc[2]);
  if (lv >= 2) for (let i = 0; i < lv - 1; i++) { const an = rnd(0, 6.28); glow.add(f.x + Math.cos(an) * .5, .05, f.z + Math.sin(an) * .3, 0, rnd(2, 4.5), 0, rnd(.3, .5), .1, 0, cc[0] * 1.2, cc[1] * 1.2, cc[2] * 1.2, .8, 0, .5); }
  if (lv === 3) shake(.03);
}
// ---- 能力コピー: 倒した敵が落とすカプセルを拾うと、しばらくその敵の技が使える（気弾ボタンがその技に変わる）----
const COPY_T = 25;
const COPY = {
  gun:    { name: '3連射', col: 0xffd23a, burst: { kind: 'bullet', n: 3, gap: .09, spd: 17, dmg: 8, kb: 1.4 }, cd: .75 },
  rocket: { name: 'ロケット', col: 0xff5a2a, shot: { kind: 'rocket', spd: 10.5, dmg: 20, blast: 1.9 }, cd: 1.3 },
  magic:  { name: '光の玉', col: 0xff8ae0, shot: { kind: 'orb', spread: 3, spd: 8.5, dmg: 10, kb: 2.5 }, bolt: { n: 3, delay: .7, gap: .12, r: 1.0, dmg: 14 }, cd: .8 },
  psy:    { name: '念動波', col: 0x9d7bff, shot: { kind: 'wave', spd: 9.5, dmg: 22, kb: 7, knock: 1, pierce: 1 }, bolt: { n: 5, delay: .8, gap: .14, r: 1.1, dmg: 16 }, cd: 1.2 },
  jet:    { name: 'ジェット突進', col: 0x4fc3ff, dash: { dmg: 15, dash: 13, dashFrom: .12, kb: 8 }, cd: 1.0 },
  blade:  { name: '真空斬り', col: 0xb8ff5a, shot: { kind: 'ki', spd: 16, dmg: 13, kb: 3, pierce: 1, sc: 1.2 }, cd: .6 },
  power:  { name: '怪力', col: 0xff7a1a, pow: 1.6, armor: 1 },      // 殴る力が上がり、軽い攻撃ではひるまない
  speed:  { name: '俊足', col: 0x2be8c8, spd: 1.5 },                // 足が速くなる
  rapid:  { name: '連打', col: 0xff4a4a, rapid: 1.5 },              // 技が速くなる
};
const hex3 = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
function dropCapsule(f) {
  const k = f.spec && f.spec.copy; if (!k || G.mode !== 'coop') return;
  if (!(f.spec.mid || Math.random() < .42) || items.filter(i => i.kind === 'cap').length >= 2) return;
  spawnItem(clamp(f.x, G.camX - halfW + 1, G.camX + halfW - 1), clamp(f.z, Z_MIN + .2, Z_MAX - .2), 'cap', k);
}
function capsuleMesh(g, sub) {
  const C = COPY[sub] || COPY.gun;
  const a = new T.Mesh(new T.CapsuleGeometry(.13, .2, 4, 12), new T.MeshLambertMaterial({ color: 0xf4f6ff, emissive: 0x333344 }));
  const b = new T.Mesh(new T.CylinderGeometry(.14, .14, .14, 14), new T.MeshBasicMaterial({ color: C.col })); b.position.y = -.08;
  const p = new T.Group(); p.add(a, b); p.rotation.z = .6; p.position.y = .42; g.add(p);
  const gl = new T.Sprite(new T.SpriteMaterial({ map: radialTex, color: C.col, transparent: true, opacity: .8, depthWrite: false, blending: T.AdditiveBlending, fog: false })); gl.scale.set(1.3, 1.3, 1); gl.position.y = .42; g.add(gl);
  const lb = new T.Sprite(new T.SpriteMaterial({ map: wordTex(C.name, hex3(C.col)), transparent: true, depthWrite: false, depthTest: false, fog: false })); lb.scale.set(1.3, .65, 1); lb.position.y = 1.0; lb.renderOrder = 29; g.add(lb);
}
function endCopy(h) { if (!h.copy) return; if (h.copy.spd) h.spd = HERO_SPD; h.copy = null; }
function takeCapsule(h, it) {
  endCopy(h);
  const C = COPY[it.sub] || COPY.gun, c = hex3(C.col);
  h.copy = { ...C, key: it.sub, t: COPY_T };
  if (C.spd) h.spd = HERO_SPD * C.spd;
  sfx.copy(); pillarFx(h.x, h.z, .6, 5, .6, c, .6); ringFx(h.x, .05, h.z, .3, 2.6, .5, c, 'ground'); flashFx(h.x, 1.1, h.z + .2, 3, c, .2, .6);
  textFx(h.x, 2.6, h.z, C.name + '!', c, 2.6, 1.1); toastAt(h, 'コピー: ' + C.name + '（' + COPY_T + '秒）');
  say(h.isClaude ? 'copy' : 'copyP', 1);
}
// コピーした技を使う（気弾ボタン）。体が強くなるだけの能力のときは false を返して、ふつうの気弾を出す
function copyUse(f, mz) {
  const C = f.copy; if (!C || (!C.shot && !C.burst && !C.dash)) return false;
  if (f.shotCd > 0) return true;
  f.shotCd = C.cd;
  if (C.dash) { startMove(f, 'special2'); f.move = { ...f.move, ...C.dash, cost: 0 }; f.inv = Math.max(f.inv, f.move.dur); return true; }
  startMove(f, 'ranged');
  const at = f.move.shot.at;
  if (C.bolt && Math.abs(mz) > .5) f.move = { ...f.move, shot: null, bolt: { at, ...C.bolt } };   // ↑↓を入れながら: 落雷
  else if (C.burst) f.move = { ...f.move, shot: null, burst: { at, ...C.burst } };
  else f.move = { ...f.move, nochg: 1, shot: { at, ...C.shot } };
  return true;
}
function copyTick(f, dt) {
  const C = f.copy; C.t -= dt;
  if (C.t <= 0) { endCopy(f); sfx.ui(); toastAt(f, C.name + ' おわり'); return; }
  C.fx = (C.fx || 0) - dt;
  if (C.fx <= 0) { C.fx = C.t < 5 ? .22 : .09; const c = hex3(C.col), an = rnd(0, 6.28); glow.add(f.x + Math.cos(an) * .42, (f.y || 0) + rnd(.05, .4), f.z + Math.sin(an) * .25, 0, rnd(1.4, 2.8), 0, rnd(.4, .7), .11, 0, c[0] * 1.3, c[1] * 1.3, c[2] * 1.3, .8, 0, .4); }
}
// =========================================================================================
// 面のしかけ（自販機・マンホール・バナナの皮・暴走トラック・扉から出てくる敵・動く床・プレス機・火・「押すな」ボタン）
//   置き場所は STAGES の gim に書く。主人公にも敵にも効く（敵に当たったぶんは 1P の手柄）
// =========================================================================================
const gimG = new T.Group(); scene.add(gimG);
let gims = [], holes = [], belts = [], vends = [], dangers = [], chuteOn = false, gagN = 0, gag = null, aeonUsed = false, gimSkin = {};
const VEND_Z = Z_MIN - .8, DOOR_Z = -4.1;
const ENV_E = { team: 'enemy', spec: { pow: 1 }, x: 0, z: 0, y: 0, face: 1, score: 0, kos: 0, name: '', id: -1 };
const gmesh = (geo, mat, x, y, z, parent = gimG) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
const floorMesh = (w, d, mat, x, y, z, parent = gimG) => { const m = gmesh(new T.PlaneGeometry(w, d), mat, x, y, z, parent); m.rotation.x = -Math.PI / 2; return m; };
const addMatC = (col, o = .5, map = radialTex) => new T.MeshBasicMaterial({ map, color: col, transparent: true, opacity: o, depthWrite: false, blending: T.AdditiveBlending, fog: false });
function clearGimmicks() {
  for (const o of [...gimG.children]) {
    gimG.remove(o);
    o.traverse((m) => { if (m.geometry) m.geometry.dispose(); for (const mt of [].concat(m.material || [])) { if (mt.map && mt.map !== radialTex && mt.map !== shadowTex && !mt.map.userData.keep) mt.map.dispose(); mt.dispose(); } });
  }
  gims = []; holes = []; belts = []; vends = []; dangers = []; chuteOn = false; gagN = 0; gag = null; aeonUsed = false;
  for (const f of fighters) { f.pit = null; f.flat = 0; }
  for (const d of stageDoors) { d.open = 0; d.hold = 0; d.sh.scale.y = 1; }
}
function buildGimmicks(S) {
  clearGimmicks();
  const L = S.gim; gimSkin = S.gimSkin || {}; if (!L || G.mode !== 'coop') return;
  (L.vend || []).forEach((x, i) => addVend(x, i + (S.theme === 'factory' ? 3 : 0)));
  (L.hole || []).forEach(([x, z]) => addHole(x, z));
  (L.banana || []).forEach(([x, z]) => addBanana(x, z));
  (L.belt || []).forEach((b) => addBelt(...b));
  (L.crusher || []).forEach(([x, z], i) => addCrusher(x, z, i * 1.37));
  (L.flame || []).forEach(([x, z], i) => addFlame(x, z, i * 1.9));
  (L.button || []).forEach(([x, z]) => addButton(x, z));
  if (L.truck) addTruck(L.truck);
  chuteOn = !!L.chute;
  buildGim345(L);
}
// しかけが当たる
function envHit(b, dmg, o = {}) {
  if (!b.alive || b.out || b.inv > 0 || b.state === 'dead' || b.pit) return false;
  const x = o.x != null ? o.x : b.x, foe = b.team === 'enemy';
  ENV_E.x = x; ENV_E.z = b.z;
  return applyHit(foe ? G.p1 : ENV_E, b, { dmg: foe ? dmg * (o.eMul || 2.2) : dmg, kb: o.kb != null ? o.kb : 5, knock: o.knock != null ? o.knock : 1, launch: o.launch, heavy: 1, dir: o.dir || Math.sign(b.x - x) || 1, x, key: 'env', env: 1 });
}
const onScreen = (x, m = 0) => Math.abs(x - G.camX) < halfW + m;
const grounded = (f) => f.alive && !f.out && !f.pit && f.y <= .05 && !(f.spec && f.spec.flyer) && !(f.ai && f.ai.door) && f.state !== 'dead';

// ---- 自販機: 近くで殴ると飲み物が出てくる（体力が回復。3 本で売り切れ）----
function addVend(x, skin = 0) {
  const vy = gimSkin.vendY != null ? gimSkin.vendY : .14;
  const g = new T.Group(); g.position.set(x, vy, VEND_Z); gimG.add(g);
  const colS = ['#d8354a', '#2a6fd6', '#1fa37c', '#e8a020', '#7a3fd0'][skin % 5];
  const side = new T.MeshLambertMaterial({ color: colS });
  const face = canvasTex(192, 384, (c, w, h) => {
    c.fillStyle = colS; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff'; c.font = 'bold 22px "Noto Sans JP", sans-serif'; c.textAlign = 'center'; c.fillText(skin >= 3 ? '5億年オイル' : '5億年コーラ', w / 2, 30);
    c.fillStyle = '#eaf8ff'; c.fillRect(12, 42, w - 24, 178);
    for (let r = 0; r < 3; r++) for (let q = 0; q < 5; q++) { c.fillStyle = pick(NEON); c.fillRect(22 + q * 31, 52 + r * 56, 20, 36); c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(24 + q * 31, 56 + r * 56, 5, 26); c.fillStyle = '#ff3d3d'; c.fillRect(22 + q * 31, 92 + r * 56, 20, 5); }
    c.fillStyle = '#12131c'; c.fillRect(w * .62, 236, w * .26, 40); c.fillStyle = '#FFCE4A'; c.font = 'bold 15px "Noto Sans JP", sans-serif'; c.fillText('5億円', w * .75, 262);
    c.fillStyle = '#0b0c12'; c.fillRect(24, 300, w - 48, 44); c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(24, 300, w - 48, 6);
    c.fillStyle = 'rgba(255,255,255,.85)'; c.font = 'bold 13px "Noto Sans JP", sans-serif'; c.fillText('けると出ます', w * .3, 262);
  });
  const box = new T.Mesh(new T.BoxGeometry(.95, 1.9, .62), [side, side, side, side, new T.MeshBasicMaterial({ map: face }), side]); box.position.y = .95; g.add(box);
  floorMesh(2.6, 1.8, addMatC(0xbfe8ff, .22), x, vy + .02, VEND_Z + .9);
  const sold = gmesh(new T.PlaneGeometry(.78, .3), new T.MeshBasicMaterial({ map: canvasTex(256, 96, (c, w, h) => { c.fillStyle = '#c8102a'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = 'bold 64px "Noto Sans JP", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('売切', w / 2, h / 2 + 4); }) }), 0, 1.3, .32, g);
  sold.visible = false;
  const v = { x, g, stock: 3, wob: 0, empty: 0, sold };
  vends.push(v);
  gims.push({ update(dt) { if (v.wob > 0) { v.wob -= dt; g.rotation.z = Math.sin(v.wob * 45) * Math.max(0, v.wob) * .22; } } });
}
function vendHit(v, a) {
  v.wob = .4; sfx.vend(); hitStop = Math.max(hitStop, .04); spark(v.x, 1.1, VEND_Z + .5, false);
  textFx(v.x, 2.3, VEND_Z + .3, 'ガコン!', COL.white, 1.5, .5);
  const out = (kind) => { const it = spawnItem(clamp(v.x + rnd(-.5, .5), G.camX - halfW + .8, G.camX + halfW - .8), Z_MIN + rnd(.15, .5), kind); it.fall = 1.0; };
  if (v.stock > 0) {
    v.stock--; out('juice');
    if (Math.random() < .15) { out('juice'); sfx.coin(); textFx(v.x, 2.9, VEND_Z + .3, '当たり!', COL.gold, 2.2, .9); }
    if (!v.stock) v.sold.visible = true;
    if (a.isPlayer && Math.random() < .5) say('vend');
  } else if (++v.empty === 2) { out('coin'); toastAt(a, 'おつりが出てきた'); }
  else textFx(v.x, 2.8, VEND_Z + .3, '売切', COL.red, 1.4, .6);
}
function hitGimmicks(a, m) {
  if (a.team === 'enemy' || a.z > Z_MIN + .8 || a.y > .6 || !vends.length) return;
  for (const v of vends) {
    if (a.hitSet.has(v)) continue;
    const dx = (v.x - a.x) * a.face;
    if (m.around ? Math.abs(v.x - a.x) > m.reach : (dx < -.35 || dx > (m.reach || 1) + .1)) continue;
    a.hitSet.add(v); a.hitAny = true; vendHit(v, a);
  }
}

// ---- マンホール: 落ちた敵はそのまま退場。主人公と大物は、噴き上げられて戻ってくる ----
function addHole(x, z) {
  const tex = canvasTex(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2); g.addColorStop(0, '#000'); g.addColorStop(.75, '#04050a'); g.addColorStop(1, '#232838');
    c.fillStyle = g; c.beginPath(); c.arc(w / 2, h / 2, w / 2, 0, 7); c.fill();
    c.strokeStyle = 'rgba(120,130,160,.5)'; c.lineWidth = 3; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(w * .36, h * (.2 + i * .12)); c.lineTo(w * .64, h * (.2 + i * .12)); c.stroke(); }
  });
  const d = floorMesh(1, 1, new T.MeshBasicMaterial({ map: tex, transparent: true }), x, .016, z); d.scale.set(1, .8, 1);
  const rim = gmesh(new T.RingGeometry(.48, .6, 28), new T.MeshLambertMaterial({ color: 0x7a8098 }), x, .018, z); rim.rotation.x = -Math.PI / 2; rim.scale.set(1, .8, 1);
  const lidT = canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#5a6078'; c.fillRect(0, 0, w, h); c.strokeStyle = '#2d3142'; c.lineWidth = 6; for (let i = 16; i < w; i += 22) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); } });
  const lm = new T.MeshLambertMaterial({ color: 0x4a5066 });
  const lid = gmesh(new T.CylinderGeometry(.5, .5, .06, 20), [lm, new T.MeshLambertMaterial({ map: lidT }), lm], x + .95, .04, z - .28);
  const cone = gmesh(new T.ConeGeometry(.16, .45, 10), new T.MeshLambertMaterial({ color: 0xff7a1a, emissive: 0x4a1a00 }), x - .82, .23, z - .32);
  gmesh(new T.CylinderGeometry(.115, .135, .08, 10), new T.MeshBasicMaterial({ color: 0xffffff }), 0, 0, 0, cone);
  holes.push({ x, z, r: .44 }); dangers.push({ x, z, rx: .5, rz: .4, all: true });
}
function fallIn(f, h) {
  if (f.victim) releaseGrab(f);
  if (f.holder) { const o = f.holder; o.victim = null; if (o.state === 'grab') o.state = 'idle'; f.holder = null; }
  if (f.weapon && f.weapon.kind !== 'knuckle') dropWeapon(f, 0);
  const foe = f.team === 'enemy';
  f.pit = { t: 0, h, out: !(foe && !f.spec.boss && !f.spec.mid) };
  f.move = null; f.vx = f.vz = f.vy = 0; f.state = 'stun'; f.t = 0;
  sfx.falling(); textFx(h.x, 1.6, h.z, 'ヒュ〜', COL.white, 1.6, .7);
  if (f.isPlayer) say('holeP', 2); else if (foe) say('hole', 1);
}
function splashFx(x, z, big) {
  sfx.splash();
  for (let i = 0; i < (big ? 46 : 22); i++) { const a = rnd(0, 6.283), v = rnd(.4, 2.2); glow.add(x + Math.cos(a) * .2, .05, z + Math.sin(a) * .15, Math.cos(a) * v, rnd(3, big ? 11 : 6.5), Math.sin(a) * v * .5, rnd(.4, .8), rnd(.08, .16), .03, .55, .85, 1.5, .9, 14, .6); }
  ringFx(x, .05, z, .2, big ? 2.4 : 1.4, .4, COL.blue, 'ground');
}
function pitTick(f, dt) {
  const p = f.pit, foe = f.team === 'enemy'; p.t += dt;
  f.x += (p.h.x - f.x) * Math.min(1, dt * 12); f.z += (p.h.z - f.z) * Math.min(1, dt * 12);
  f.vx = f.vz = f.vy = 0; f.y = -p.t * p.t * 13; f.state = 'stun'; f.t = .1; f.move = null;
  if (p.t > .45 && !p.sp) { p.sp = true; splashFx(p.h.x, p.h.z, false); textFx(p.h.x, 1.2, p.h.z, 'ボチャン!', COL.blue, 1.9, .7); }
  if (!p.out) {
    if (p.t > .62) {   // 雑魚はそのまま流されていく
      f.pit = null; f.hp = 0; f.y = 0; if (!f.lastHitBy || f.lastHitBy.team === 'enemy') f.lastHitBy = G.p1;
      f.lastHitBy.score += 200; numFx(p.h.x, 1.9, p.h.z, '+' + (f.spec.score + 200), 'coin');
      onDeath(f); f.alive = false;
    }
  } else if (p.t > 1.15) {   // 下水に噴き上げられて戻ってくる
    f.pit = null; f.hp = Math.max(foe ? 0 : 1, f.hp - (foe ? 30 : 8)); numFx(p.h.x, 2.2, p.h.z, foe ? 30 : 8, foe ? 'big' : 'hurt');
    f.x = p.h.x; f.z = p.h.z; f.y = .1; f.vy = 9.5; f.vx = rnd(1.8, 2.6) * (p.h.x > G.camX ? -1 : 1); f.face = Math.sign(f.vx); f.state = 'knock'; f.t = 0; f.inv = foe ? 0 : 1.6;
    splashFx(p.h.x, p.h.z, true); pillarFx(p.h.x, p.h.z, .45, 4.5, .5, COL.blue, .5); shake(.2);
  }
}

// ---- バナナの皮: 踏むと滑って転ぶ（敵も、ボスも）----
function addBanana(x, z) {
  const g = new T.Group(); g.position.set(x, .02, z); gimG.add(g);
  const ym = new T.MeshLambertMaterial({ color: 0xffdf3a, emissive: 0x5a4400 });
  for (let i = 0; i < 4; i++) { const a = i * 1.57 + .4, p = gmesh(new T.BoxGeometry(.26, .03, .09), ym, Math.cos(a) * .13, .02, Math.sin(a) * .13, g); p.rotation.y = -a; p.rotation.z = -.18; }
  gmesh(new T.CylinderGeometry(.03, .05, .12, 8), new T.MeshLambertMaterial({ color: 0x8a6a1a }), 0, .08, 0, g);
  const gl = floorMesh(1.0, .8, addMatC(0xffe14a, .28), 0, .005, 0, g);
  const b = { x, z, dead: false, update() {
    for (const f of fighters) {
      if (!grounded(f) || downish(f.state) || f.state === 'grabbed' || f.gspd < .6 || Math.hypot(f.x - x, (f.z - z) * 1.2) > .36) continue;
      b.dead = true; gimG.remove(g);
      const foe = f.team === 'enemy', dir = Math.sign(f.vx) || f.face;
      if (f.victim) releaseGrab(f);
      f.hp = Math.max(foe ? 0 : 1, f.hp - (foe ? 8 : 2)); f.move = null; f.state = 'knock'; f.t = 0; f.y = .05; f.vy = 5.6; f.vx = dir * 3.6; f.vz = 0; f.face = dir; f.flash = .1;
      sfx.slip(); textFx(x, 1.9, z, 'ツルッ!', COL.gold, 2.1, .7);
      for (let i = 0; i < 8; i++) streaks.add(x, .1, z, -dir * rnd(2, 6), rnd(1, 4), rnd(-2, 2), rnd(.2, .4), .04, .08, 1, .9, .3, 12, 1);
      debris(x, .2, z, 0xffdf3a);
      if (f.isPlayer || (f.spec && (f.spec.boss || f.spec.mid)) || Math.random() < .4) say('banana', f.isPlayer ? 2 : 1);
      break;
    }
  } };
  gims.push(b);
}

// ---- 暴走する軽トラ: 警笛と赤い帯で予告してから、その列を走り抜ける ----
function addTruck(o) {
  const g = new T.Group(); g.visible = false; gimG.add(g);
  const white = new T.MeshLambertMaterial({ color: gimSkin.truckCol || 0xf2f4f8 }), dark = new T.MeshLambertMaterial({ color: 0x20242e }), tire = new T.MeshLambertMaterial({ color: 0x15161c });
  gmesh(new T.BoxGeometry(1.7, .12, 1.0), dark, -.25, .42, 0, g); gmesh(new T.BoxGeometry(1.6, .34, 1.0), white, -.3, .66, 0, g);
  gmesh(new T.BoxGeometry(.9, .95, 1.0), white, 1.0, .9, 0, g); gmesh(new T.BoxGeometry(.5, .4, 1.02), new T.MeshBasicMaterial({ color: 0x8fd8ff }), 1.18, 1.1, 0, g);
  for (const wx of [-.75, 1.0]) for (const wz of [-.5, .5]) { const w = gmesh(new T.CylinderGeometry(.22, .22, .16, 14), tire, wx, .22, wz, g); w.rotation.x = Math.PI / 2; }
  const txt = canvasTex(512, 96, (c, w, h) => { c.fillStyle = '#f2f4f8'; c.fillRect(0, 0, w, h); c.fillStyle = '#1c6a3a'; c.font = 'bold 64px "Noto Sans JP", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, gimSkin.truckText || '安全運転中', w / 2, h / 2 + 4, w - 20, 64); });
  for (const sz of [-1, 1]) { const p = gmesh(new T.PlaneGeometry(1.5, .28), new T.MeshBasicMaterial({ map: txt }), -.3, .66, sz * .505, g); if (sz < 0) p.rotation.y = Math.PI; }
  for (let i = 0; i < 5; i++) gmesh(new T.BoxGeometry(.36, .3, .36), new T.MeshLambertMaterial({ color: pick([0xd0551c, 0x3f8f5f, 0xc9a227, 0x7a4fd0]) }), -.85 + (i % 3) * .45, .98 + (i > 2 ? .3 : 0), (i % 2 ? .22 : -.22), g);
  const hl = new T.Sprite(new T.SpriteMaterial({ map: radialTex, color: 0xfff2c0, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); hl.scale.set(1.8, 1.8, 1); hl.position.set(1.5, .6, .3); g.add(hl);
  const arrow = canvasTex(256, 64, (c, w, h) => { c.fillStyle = 'rgba(255,40,50,.55)'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255,230,120,.95)'; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(i * 64 + 10, 10); c.lineTo(i * 64 + 38, h / 2); c.lineTo(i * 64 + 10, h - 10); c.lineTo(i * 64 + 22, h - 10); c.lineTo(i * 64 + 50, h / 2); c.lineTo(i * 64 + 22, 10); c.fill(); } }, [12, 1]);
  const lane = floorMesh(30, 1.15, new T.MeshBasicMaterial({ map: arrow, transparent: true, opacity: .8, depthWrite: false, fog: false }), 0, .03, 0); lane.visible = false;
  const T_ = { ph: 'wait', t: rnd(7, 11), z: 0, dir: -1, x: 0, hit: new Set() }, shout = gimSkin.truckShout || 'プップー!';
  dangers.push({ get x() { return G.camX; }, get z() { return T_.z; }, rx: 99, rz: .7, on: () => T_.ph !== 'wait', hero: true });
  gims.push({ kind: 'truck', st: T_, update(dt) {
    T_.t -= dt;
    if (T_.ph === 'wait') {
      if (T_.t > 0 || G.phase !== 'play' || G.areaIdx < (o.from || 0) || G.areaIdx >= AREAS.length + 1) return;
      const P = G.p1; T_.ph = 'warn'; T_.t = 1.3; T_.dir = Math.random() < .75 ? -1 : 1; T_.hit.clear();
      T_.z = Math.random() < .55 && P ? clamp(P.z, Z_MIN + .5, Z_MAX - .5) : pick([-1.45, -.15, 1.15]);
      lane.visible = true; sfx.honk(); textFx(G.camX - T_.dir * (halfW - 1.4), 1.3, T_.z, shout, COL.red, 2.0, 1.0); say('truck', 1);
    } else if (T_.ph === 'warn') {
      lane.position.set(G.camX, .03, T_.z); lane.material.opacity = .45 + .4 * Math.sin(gameTime * 22); arrow.offset.x -= dt * 2.2 * T_.dir;
      if (T_.t <= 0) { T_.ph = 'run'; T_.x = G.camX - T_.dir * (halfW + 3); g.visible = true; g.rotation.y = T_.dir > 0 ? 0 : Math.PI; sfx.truck(); }
    } else {
      T_.x += T_.dir * 17 * dt; g.position.set(T_.x, Math.abs(Math.sin(gameTime * 31)) * .03, T_.z);
      lane.position.set(G.camX, .03, T_.z); lane.material.opacity = .3; arrow.offset.x -= dt * 4 * T_.dir;
      smoke.add(T_.x - T_.dir * 1.2, .25, T_.z, -T_.dir * rnd(.5, 2), rnd(.2, .8), rnd(-.3, .3), rnd(.4, .7), .25, .9, COL.smoke[0], COL.smoke[1], COL.smoke[2], .3, -.2, 2);
      for (const b of fighters) {
        if (T_.hit.has(b) || !b.alive || b.out || b.pit || (b.ai && b.ai.door) || Math.abs(b.z - T_.z) > .68 || Math.abs(b.x - T_.x) > 1.5 || b.y > 1.15) continue;
        T_.hit.add(b);
        if (envHit(b, 12, { dir: T_.dir, kb: 7.5, launch: 7.5, x: T_.x - T_.dir * .6, eMul: 2.6 })) { textFx(b.x, 2.2, b.z, 'ドーン!', COL.orange, 2.4, .7); if (b.isClaude) say('downC'); }
      }
      for (const p of props) if (!p.broken && Math.abs(p.z - T_.z) < .6 && Math.abs(p.x - T_.x) < 1.2) breakProp(p);
      if ((T_.x - G.camX) * T_.dir > halfW + 4) { T_.ph = 'wait'; T_.t = rnd(o.every[0], o.every[1]); g.visible = false; lane.visible = false; }
    }
  } });
}

// ---- 扉・投入口: 敵が画面の横からだけでなく、店のシャッターや天井からも出てくる ----
function gimSpawn(e, spec) {
  if (G.mode !== 'coop' || spec.boss || spec.mid || G.phase !== 'play') return;
  const ds = stageDoors.filter(d => Math.abs(d.x - G.camX) < halfW - .9);
  if (ds.length && !spec.flyer && Math.random() < .6) {
    const d = pick(ds); d.n = (d.hold > 0 ? d.n || 0 : 0) + 1;
    e.x = d.x + rnd(-.3, .3); e.z = DOOR_Z; e.face = e.x > G.camX ? -1 : 1;
    e.ai.door = d; e.ai.wait = .4 + (d.n - 1) * .55; e.ai.enterT = e.ai.wait + 1.25;
    if (d.hold <= 0) sfx.shutter();
    d.hold = Math.max(d.hold, e.ai.enterT + .3);
  } else if (chuteOn && !spec.flyer && Math.random() < .5) {   // 天井の投入口から落ちてくる
    const hs = heroes().filter(h => !h.out);
    let x = G.camX + rnd(-halfW + 1.8, halfW - 1.8);
    for (const h of hs) if (Math.abs(h.x - x) < 1.2) x += x > h.x ? 1.2 : -1.2;
    e.x = clamp(x, G.camX - halfW + 1, G.camX + halfW - 1); e.y = 6.5 + rnd(0, 1.5); e.vy = -3; e.state = 'jump'; e.t = 0; e.jk = true; e.ai.enterT = 0; e.face = e.x > G.camX ? -1 : 1;
    ringFx(e.x, .05, e.z, 1.2, .3, .55, COL.orange, 'ground'); sfx.chute();
  }
}
function doorTick(dt) {
  for (const d of stageDoors) {
    d.hold -= dt;
    const want = d.hold > 0 ? 1 : 0; d.open += clamp(want - d.open, -dt * 2.2, dt * 4.5);
    d.sh.scale.y = 1 - d.open * .93; d.lit.material.opacity = d.open * .3;
  }
}

// ---- 動く床（ベルトコンベア）: 乗っているものを流す ----
function addBelt(x0, x1, z0, z1, dir) {
  const len = x1 - x0, w = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const tex = canvasTex(128, 128, (c, cw, ch) => {
    c.fillStyle = '#17181e'; c.fillRect(0, 0, cw, ch); c.strokeStyle = '#4a4d5c'; c.lineWidth = 9;
    const ax = dir > 0 ? .3 : .7, bx = dir > 0 ? .7 : .3;   // 矢印は、流れる向きへ
    c.beginPath(); c.moveTo(cw * ax, 10); c.lineTo(cw * bx, ch / 2); c.lineTo(cw * ax, ch - 10); c.stroke();
    c.fillStyle = '#2a2c36'; c.fillRect(0, 0, 4, ch);
  }, [len / (w * .9), 1]);
  floorMesh(len, w, new T.MeshBasicMaterial({ map: tex }), cx, .016, cz);
  const edge = new T.MeshLambertMaterial({ map: canvasTex(256, 32, (c, cw, ch) => hazard(c, 0, 0, cw, ch, 22), [len / 2, 1]) });
  for (const ez of [z0 - .05, z1 + .05]) gmesh(new T.BoxGeometry(len, .07, .1), edge, cx, .035, ez);
  for (const ex of [x0, x1]) { const r = gmesh(new T.CylinderGeometry(.09, .09, w + .2, 10), new T.MeshLambertMaterial({ color: 0x8a8f9c }), ex, .05, cz); r.rotation.x = Math.PI / 2; }
  const B = { x0, x1, z0, z1, dir, v: 1.7 }; belts.push(B);
  const inB = (x, z) => x > x0 && x < x1 && z > z0 - .05 && z < z1 + .05;
  gims.push({ update(dt) {
    tex.offset.x -= dir * dt * B.v / (w * .9);
    if (!onScreen(cx, len / 2 + 2)) return;
    const d = dir * B.v * dt;
    for (const f of fighters) if (grounded(f) && f.state !== 'grabbed' && inB(f.x, f.z)) f.x += d;
    for (const it of items) if (inB(it.x, it.z)) { it.x += d; it.g.position.x = it.x; }
    for (const wp of gweapons) if (wp.y <= 0 && !(wp.vy > 0) && inB(wp.x, wp.z)) wp.x += d;
    for (const p of props) if (!p.broken && inB(p.x, p.z)) { p.x += d; p.g.position.x = p.x; p.sh.position.x = p.x; }
  } });
}

// ---- プレス機: 予告のあとドスンと落ちる。下にいるとぺちゃんこ ----
function addCrusher(x, z, ph) {
  const plate = floorMesh(2.0, 1.5, new T.MeshBasicMaterial({ map: canvasTex(256, 192, (c, w, h) => { hazard(c, 0, 0, w, h, 34); c.fillStyle = '#1a1b22'; c.fillRect(20, 20, w - 40, h - 40); c.fillStyle = 'rgba(255,206,74,.8)'; c.font = 'bold 44px "Noto Sans JP", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(gimSkin.crushText || '頭上注意', w / 2, h / 2 + 3); }) }), x, .022, z);
  const warn = floorMesh(2.0, 1.5, new T.MeshBasicMaterial({ color: 0xff2030, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, fog: false }), x, .03, z);
  const g = new T.Group(); g.position.set(x, 0, z); gimG.add(g);
  const steel = new T.MeshLambertMaterial({ color: 0x6a6770 }), hz = new T.MeshLambertMaterial({ map: canvasTex(256, 96, (c, w, h) => hazard(c, 0, 0, w, h, 32)) });
  gmesh(new T.BoxGeometry(1.85, .8, 1.35), [hz, hz, steel, new T.MeshLambertMaterial({ color: 0x2a2a30 }), hz, hz], 0, .4, 0, g);
  gmesh(new T.CylinderGeometry(.2, .2, 7, 12), new T.MeshLambertMaterial({ color: 0xb8bcc8 }), 0, 4.3, 0, g);
  const sh = floorMesh(2.4, 1.9, new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }), x, .026, z);
  const TOP = 2.8, P = 4.4, C = { t: ph % P, slammed: false, beeped: false };
  dangers.push({ x, z, rx: 1.0, rz: .75, on: () => C.t > 2.2 && C.t < 3.8, hero: true });
  gims.push({ update(dt) {
    if (onScreen(x, 2.5) || C.t > 2.3) C.t += dt; else C.t = Math.min(C.t + dt, 2.2);
    if (C.t >= P) { C.t -= P; C.slammed = false; C.beeped = false; }
    const t = C.t;
    let y = TOP;
    if (t < 2.3) warn.material.opacity = 0;
    else if (t < 3.2) { if (!C.beeped) { C.beeped = true; sfx.beep(); } y = TOP + Math.sin(gameTime * 60) * .03; warn.material.opacity = .35 + .3 * Math.sin(gameTime * 26); }
    else if (t < 3.3) y = TOP - (TOP - .1) * ((t - 3.2) / .1);
    else if (t < 3.75) { y = .1; warn.material.opacity = 0; }
    else y = .1 + (TOP - .1) * ((t - 3.75) / (P - 3.75));
    g.position.y = y; sh.material.opacity = .25 + .6 * (1 - y / TOP);
    if (t >= 3.3 && !C.slammed) {
      C.slammed = true; sfx.clank(); shake(.3); ringFx(x, .05, z, .5, 2.6, .35, COL.white, 'ground');
      for (let i = 0; i < 14; i++) { const a = rnd(0, 6.283); smoke.add(x + Math.cos(a) * .9, .1, z + Math.sin(a) * .6, Math.cos(a) * 2.5, rnd(.3, 1), Math.sin(a) * 1.2, rnd(.4, .7), .25, .9, COL.smoke[0], COL.smoke[1], COL.smoke[2], .35, -.2, 2); }
      for (const b of fighters) {
        if (!b.alive || b.out || b.pit || Math.abs(b.x - x) > .98 + .15 * (b.scl - 1) || Math.abs(b.z - z) > .74 || b.y > 2.2 || (b.ai && b.ai.door)) continue;
        if (!envHit(b, 14, { knock: 0, kb: 0, x })) continue;
        b.flat = 1.7; b.state = 'down'; b.t = 0; b.vx = b.vy = b.vz = 0; b.y = 0; b.move = null;
        textFx(b.x, 1.5, b.z, pick(['ぺちゃ…', 'プチッ', 'ぺったん']), COL.white, 1.9, .8);
        if (b.team !== 'enemy' || Math.random() < .4) say('flat', 1);
      }
    }
  } });
}

// ---- 火を噴く床 ----
function addFlame(x, z, ph) {
  floorMesh(1.1, .9, new T.MeshBasicMaterial({ transparent: true, map: canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#15151a'; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 2, 0, 7); c.fill(); c.strokeStyle = '#6a6f7c'; c.lineWidth = 5; c.stroke();
    c.strokeStyle = '#3a3d48'; c.lineWidth = 6; for (let i = 26; i < w - 16; i += 16) { c.beginPath(); c.moveTo(i, 22); c.lineTo(i, h - 22); c.stroke(); }
  }) }), x, .022, z);
  const pool = floorMesh(2.6, 2.0, addMatC(0xff6a1a, 0), x, .03, z);
  const P = 4.8, F = { t: ph % P, on: false, hit: new Set() };
  dangers.push({ x, z, rx: .6, rz: .5, on: () => F.t > 2.5, hero: true });
  gims.push({ update(dt) {
    F.t += dt; if (F.t >= P) { F.t -= P; F.on = false; F.hit.clear(); }
    if (!onScreen(x, 1.5)) { pool.material.opacity = 0; return; }
    const t = F.t;
    if (t < 2.7) { pool.material.opacity = 0; return; }
    if (t < 3.5) {   // 種火
      pool.material.opacity = .15 + .1 * Math.sin(gameTime * 30);
      if (Math.random() < .5) glow.add(x + rnd(-.25, .25), .08, z + rnd(-.15, .15), rnd(-.3, .3), rnd(1, 2.4), 0, rnd(.15, .3), .1, .02, 1.6, .7, .2, .9, 0, 1);
      return;
    }
    if (!F.on) { F.on = true; sfx.flame(); }
    pool.material.opacity = .5 + .15 * Math.sin(gameTime * 40);
    for (let i = 0; i < 5; i++) glow.add(x + rnd(-.28, .28), .1, z + rnd(-.18, .18), rnd(-.5, .5), rnd(5, 9.5), rnd(-.2, .2), rnd(.22, .42), rnd(.25, .4), .05, 1.7, rnd(.5, 1.1), .15, .95, 0, 1.2);
    if (Math.random() < .4) smoke.add(x + rnd(-.2, .2), 1.9, z, rnd(-.3, .3), rnd(1, 2), 0, rnd(.5, .8), .3, .9, .25, .22, .22, .3, -.3, 1.5);
    for (const b of fighters) {
      if (F.hit.has(b) || !b.alive || b.out || b.pit || Math.hypot(b.x - x, (b.z - z) * 1.3) > .62 + .1 * (b.scl - 1) || b.y > 2.0 || (b.ai && b.ai.door)) continue;
      F.hit.add(b);
      if (envHit(b, 9, { launch: 6.5, kb: 3.5, x })) textFx(b.x, 2.1, b.z, pick(['アチチ!', 'あっつ!']), COL.orange, 1.9, .7);
    }
  } });
}

// ---- 「押すな」ボタン: 踏むと何かが起きる ----
function addButton(x, z) {
  const g = new T.Group(); g.position.set(x, 0, z); gimG.add(g);
  gmesh(new T.BoxGeometry(.95, .1, .95), new T.MeshLambertMaterial({ map: canvasTex(128, 128, (c, w, h) => { hazard(c, 0, 0, w, h, 26); c.fillStyle = '#FFCE4A'; c.fillRect(14, 14, w - 28, h - 28); }) }), 0, .05, 0, g);
  const capM = new T.MeshLambertMaterial({ color: 0xff2030, emissive: 0x7a0a12 });
  const cap = gmesh(new T.CylinderGeometry(.34, .38, .18, 22), capM, 0, .19, 0, g);
  floorMesh(1.7, .62, new T.MeshBasicMaterial({ transparent: true, map: canvasTex(384, 140, (c, w, h) => {
    c.fillStyle = 'rgba(255,255,255,.92)'; c.font = '900 104px "Dela Gothic One", "Noto Sans JP", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('押すな', w / 2, h / 2 + 6);
  }) }), x, .024, z - .82);
  const halo = floorMesh(2.4, 2.0, addMatC(0xff2030, .25), x, .03, z);
  const B = { cd: 1.5 };
  gims.push({ update(dt) {
    B.cd -= dt;
    const up = B.cd <= 0, k = .5 + .5 * Math.sin(gameTime * 5);
    cap.position.y += ((up ? .19 : .11) - cap.position.y) * Math.min(1, dt * 14);
    capM.emissive.setRGB(up ? .25 + k * .5 : .08, .03, .05); halo.material.opacity = up ? .12 + k * .22 : 0;
    if (!up || G.phase !== 'play' || gag) return;
    for (const h of heroes()) {
      if (!grounded(h) || downish(h.state) || Math.hypot(h.x - x, (h.z - z) * 1.2) > .46) continue;
      B.cd = 15; sfx.button(); cap.position.y = .09; pressGag(h, x, z); break;
    }
  } });
}
function pressGag(h, x, z) {
  gagN++;
  let ev = gagN === 2 && !aeonUsed ? 'aeon' : ['tarai', 'lucky', 'hazure', 'tarai', 'lucky'][(gagN - 1 - (aeonUsed ? 1 : 0)) % 5];
  if (gagN === 1) ev = 'tarai';
  log('押すなボタン: ' + ev);
  if (ev === 'tarai') {
    banner('押すなと言ったのに', '全員にタライが落ちてきた'); say('tarai', 2);
    fighters.filter(f => f.alive && !f.out && !f.pit && onScreen(f.x, .5) && !(f.ai && f.ai.door)).forEach((f, i) => addTarai(f, .25 + i * .09));
  } else if (ev === 'aeon') {
    aeonUsed = true; gag = { kind: 'aeon', t: 0, st: 0 }; hitStop = Math.max(hitStop, 2.4); sfx.aeon();
  } else if (ev === 'lucky') {
    banner('おめでとうございます！', '5億人目のご来場です'); sfx.lucky(); say('lucky', 2);
    gag = { kind: 'lucky', t: 0 };
    for (let i = 0; i < 5; i++) { const it = spawnItem(clamp(x + rnd(-2.2, 2.2), G.camX - halfW + 1, G.camX + halfW - 1), clamp(z + rnd(-1.2, 1.2), Z_MIN + .2, Z_MAX - .2), i === 0 ? 'ramen' : 'coin'); it.fall = 2.5 + i * .5; }
  } else { banner('ハズレ', 'なにも起きなかった'); sfx.sad(); say('hazure', 2); }
}
// 金だらい: 頭の上に落ちてきて、ガーンと鳴る
function addTarai(f, delay) {
  const g = new T.Group(); gimG.add(g);
  const m = new T.MeshLambertMaterial({ color: 0xd8dce8, emissive: 0x30323a, side: T.DoubleSide });
  gmesh(new T.CylinderGeometry(.44, .36, .17, 20, 1, true), m, 0, 0, 0, g); const bt = gmesh(new T.CircleGeometry(.36, 20), m, 0, -.085, 0, g); bt.rotation.x = Math.PI / 2;
  const Tr = { y: 7, vy: 0, t: -delay, hit: false, vx: 0, dead: false };
  g.visible = false;
  gims.push(Object.assign(Tr, { update(dt) {
    Tr.t += dt; if (Tr.t < 0) return;
    g.visible = true;
    const top = (f.y || 0) + (f.state === 'down' ? .4 : 1.72 * f.scl * (f.flat > 0 ? .3 : 1)) + .1;
    if (!Tr.hit) {
      Tr.vy -= 30 * dt; Tr.y += Tr.vy * dt; g.position.set(f.x, Tr.y, f.z);
      if (Tr.y <= top || !f.alive) {
        Tr.hit = true; Tr.y = top; Tr.vy = 5.5; Tr.vx = rnd(-2, 2); Tr.t = 0;
        if (!f.alive || f.out || f.pit) return;
        sfx.tarai(); shake(.12); textFx(f.x, top + .7, f.z, pick(['ガーン!', 'ゴ〜ン!', 'カーン!']), COL.white, 2.0, .7);
        for (let i = 0; i < 10; i++) { const a = i / 10 * 6.283; streaks.add(f.x, top, f.z, Math.cos(a) * 6, rnd(1, 3), Math.sin(a) * 3, .25, .05, .05, 1, 1, .8, 6, 1.5); }
        const foe = f.team === 'enemy';
        if (foe) { if (envHit(f, 7, { knock: 0, kb: 0 }) && f.hp > 0 && !f.spec.armor) { f.state = 'stun'; f.t = 0; f.move = null; } }
        else if (f.inv <= 0 && !downish(f.state)) { f.hp = Math.max(1, f.hp - 2); f.state = 'stun'; f.t = .3; f.move = null; f.vx = f.vz = 0; f.flash = .12; if (f.victim) releaseGrab(f); }
      }
    } else {
      Tr.vy -= 22 * dt; Tr.y += Tr.vy * dt; g.position.x += Tr.vx * dt; g.position.y = Tr.y; g.rotation.z += dt * 9;
      if (Tr.t > .9) { Tr.dead = true; gimG.remove(g); }
    }
  } }));
}
// 止まっている間も動かすもの（毎フレーム）
function gimFrame(dt) {
  if (!gag) return;
  gag.t += dt;
  if (gag.kind === 'lucky') {
    if (gag.t > 2.6) { gag = null; return; }
    for (let i = 0; i < 3; i++) { const c = pick([COL.teal, COL.gold, COL.pink, COL.white]); glow.add(G.camX + rnd(-halfW, halfW), rnd(4.6, 6.4), rnd(-2.4, 2.4), rnd(-.5, .5), rnd(-2.4, -1), rnd(-.3, .3), rnd(1.6, 2.4), rnd(.09, .16), .04, c[0] * 1.3, c[1] * 1.3, c[2] * 1.3, .9, .4, .3); }
    return;
  }
  // 5億年ボタン: まっ白になって、5億年たつ
  const t = gag.t;
  wFlash = Math.max(wFlash, t < .35 ? t / .35 : t < 1.9 ? 1 : Math.max(0, 1 - (t - 1.9) / .5));
  if (gag.st === 0 && t > .3) { gag.st = 1; banner('5億年が経過した', '……とくに何も変わらなかった'); }
  if (gag.st === 1 && t > 1.9) {
    gag.st = 2; G.aeon = (G.aeon || 0) + 1;
    for (const f of fighters) {
      if (!f.alive || f.out || f.state === 'dead') continue;
      if (f.team !== 'enemy') { f.hp = f.maxhp; numFx(f.x, 2.2, f.z, '+100', 'heal'); continue; }   // 5億年休んだので全快
      if (!onScreen(f.x, 1)) continue;
      f.hp = f.spec.boss || f.spec.mid ? Math.max(1, f.hp - f.maxhp * .15) : Math.min(f.hp, 1);   // 敵はサビた
      textFx(f.x, 1.9 * f.scl + .4, f.z, 'サビた', [.8, .5, .25], 1.6, 1.2);
      for (let i = 0; i < 8; i++) smoke.add(f.x + rnd(-.3, .3), rnd(.3, 1.5), f.z, rnd(-.4, .4), rnd(.2, .8), 0, rnd(.6, 1), .2, .7, .55, .32, .16, .4, -.2, 1.5);
    }
    if (G.p1) { G.p1.score += 5000; toastAt(G.p1, '5億年ボーナス +5,000'); }
    say('aeon', 3);
  }
  if (t > 2.6) gag = null;
}
function updateGimmicks(dt) {
  if (G.mode !== 'coop') return;
  for (const f of fighters) {
    if (!f.alive || f.out) continue;
    if (f.flat > 0) f.flat -= dt;
    if (f.pit) { pitTick(f, dt); continue; }
    if (holes.length && grounded(f) && f.state !== 'grabbed') for (const h of holes) if (Math.hypot(f.x - h.x, (f.z - h.z) * 1.25) < h.r) { fallIn(f, h); break; }
  }
  let dead = false;
  for (const g of gims) { g.update(dt); if (g.dead) dead = true; }
  if (dead) gims = gims.filter(g => !g.dead);
  doorTick(dt);
}
// 自分で動くキャラ（相棒と敵）が、穴や危ない場所を避ける。敵はたまに足もとを見ていない
function steerAI(f) {
  const c = f.ctrl; if (!c || !dangers.length || f.y > .1 || f.pit || (f.ai && f.ai.door)) return;
  const hero = f.team !== 'enemy';
  if (!hero && f.id % 4 === 0) return;
  const px = f.x + (c.mx || 0) * .6, pz = f.z + (c.mz || 0) * .42;
  for (const d of dangers) {
    if (d.hero && !hero) continue;
    if (d.on && !d.on()) continue;
    const dx = px - d.x, dz = pz - d.z;
    if (Math.abs(dx) > d.rx + .3 || Math.abs(dz) > d.rz + .28) continue;
    let s = f.z >= d.z ? 1 : -1;
    if (s > 0 && d.z + d.rz + .5 > Z_MAX) s = -1; else if (s < 0 && d.z - d.rz - .5 < Z_MIN) s = 1;
    c.mz = s;
    if (d.rx < 5 && Math.abs(f.x - d.x) < d.rx + .2 && Math.abs(f.z - d.z) < d.rz + .2) { c.mx = Math.sign(f.x - d.x) || 1; if (hero) c.atk = c.rng = false; }
    else if (d.rx > 5 && hero) c.atk = c.rng = false;
    return;
  }
}
// =========================================================================================
// 必殺ゲージ（3 本）・連携技（1 本）・超必殺（3 本）
//   連携技 = 攻める側と受ける側が、対になったモーションを同時に演じる（そのあいだ、まわりは止まる）
// =========================================================================================
const METER_MAX = 300;
const METER_GAIN = { hit: .45, hurt: 1.5, guard: 8 };   // 与えたダメージ 1 あたり / 受けたダメージ 1 あたり / ガード 1 回
const DUO_DMG = 100;                                     // 連携技（1 本）の合計ダメージ
function addMeter(f, v) {
  if (!f || f.team === 'enemy' || G.mode !== 'coop' || !(v > 0)) return;
  const m0 = f.meter || 0, b0 = Math.floor(m0 / 100);
  f.meter = Math.min(METER_MAX, m0 + v);
  const b1 = Math.floor(f.meter / 100);
  if (b1 > b0) { sfx.meterUp(b1); textFx(f.x, 2.45, f.z, b1 >= 3 ? 'ゲージMAX!' : 'ゲージ ' + b1 + '本', b1 >= 3 ? COL.white : COL.teal, b1 >= 3 ? 2.3 : 1.6, .8); ringFx(f.x, .05, f.z, .3, 2.2, .4, COL.teal, 'ground'); }
}
// 対になったモーションの表: a = 攻める側 / v = 受ける側 / D = はじめの間合い（メートル）/ hits = [時刻, 重み]（重みでダメージを分ける）/ end = 動けるようになる時刻
const DUOS = {
  ex1:  { name: '二段蹴り',     a: 'street:Execution01', v: 'street:Executed01', D: 1.44, hits: [[.27, 1], [.53, 2]], end: 1.75 },
  ex2:  { name: '踏みこみ蹴り', a: 'street:Execution02', v: 'street:Executed02', D: 1.66, hits: [[.33, 1], [.6, 2]], end: 1.65 },
  ex3:  { name: '三連打',       a: 'street:Execution03', v: 'street:Executed03', D: 1.10, hits: [[.2, 1], [.5, 1], [.97, 2]], end: 1.95 },
  ex4:  { name: 'ワンツー',     a: 'street:Execution04', v: 'street:Executed04', D: 1.30, hits: [[.27, 1], [.7, 2]], end: 1.75 },
  ex5:  { name: '左右の連打',   a: 'street:Execution05', v: 'street:Executed05', D: 1.18, hits: [[.2, 1], [.6, 2]], end: 1.65 },
  ex7:  { name: '飛びこみ蹴り', a: 'street:Execution07', v: 'street:Executed07', D: 2.79, hits: [[.67, 3]], end: 1.7 },
  ex8:  { name: '乱れ打ち',     a: 'street:Execution08', v: 'street:Executed08', D: 1.29, hits: [[.27, 1], [.6, 1], [1.2, 2]], end: 2.2 },
  ex9:  { name: '回し蹴り二段', a: 'street:Execution09', v: 'street:Executed09', D: 1.90, hits: [[.4, 1], [.67, 2]], end: 1.75 },
  ex10: { name: '足払い蹴り',   a: 'street:Execution10', v: 'street:Executed10', D: 1.93, hits: [[.33, 1], [.6, 2]], end: 1.65 },
  // 超必殺: 飛んでいって、つかんで、持ち上げて、叩きつける
  super: { name: 'スーパーマン・スラム', a: 'rescue:Battle_Hero_02', v: 'rescue:Battle_Opponent_02', D: 8.3, hits: [[1.24, 1], [1.46, .3], [1.61, .3], [1.76, .3], [1.91, .3], [2.06, .3], [2.21, .3], [2.36, .4], [2.52, 6]], end: 3.35, fly: 1, sup: 1 },
};
const SUPER_PRE = { clip: 'superpower:Super_Power_08', s: 4.3, e: 6.0, T: 1.15 };   // 超必殺の前の「気をためる」構え
const EXE_KEYS = Object.keys(DUOS).filter(k => !DUOS[k].sup);
function loadDuoClips() { return Promise.all([loadClip(SUPER_PRE.clip), ...Object.values(DUOS).flatMap(d => [loadClip(d.a), loadClip(d.v)])]); }
const duoReady = (D) => { const a = CLIPS.get(D.a), v = CLIPS.get(D.v); return !!(a && v && a.pos && v.pos); };
const _dv = new T.Vector3();
const duoK = (f, clip) => (f.body.restHips.y / clip.restY) * f.body.hips.parent.getWorldScale(_dv).x;   // 体の大きさに合わせた、移動の倍率
const duoPos = (clip, t) => { const p = clip.pos.evaluate(Math.min(Math.max(0, t), clip.dur - 1e-4)); return [p[0], p[1], p[2]]; };
let cineDark = null;
function cineBackdrop(on, z) {
  if (!cineDark) {
    const wall = new T.Mesh(new T.PlaneGeometry(120, 50), new T.MeshBasicMaterial({ color: 0x04050c, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    const floor = new T.Mesh(new T.PlaneGeometry(120, 14), new T.MeshBasicMaterial({ color: 0x04050c, transparent: true, opacity: 0, depthWrite: false, fog: false })); floor.rotation.x = -Math.PI / 2;
    wall.visible = floor.visible = false; scene.add(wall, floor); cineDark = { wall, floor, k: 0 };
  }
  if (on) { cineDark.wall.position.set(G.camX, 10, z - .8); cineDark.floor.position.set(G.camX, .035, 0); cineDark.wall.visible = cineDark.floor.visible = true; cineDark.on = true; }
  else cineDark.on = false;
}
function cineFade(dt) {   // 背景の暗幕をふわっと出し入れする（毎フレーム）
  if (!cineDark || (!cineDark.on && cineDark.k <= 0)) return;
  cineDark.k = clamp(cineDark.k + (cineDark.on ? dt * 6 : -dt * 4), 0, 1);
  cineDark.wall.material.opacity = cineDark.k * .62; cineDark.floor.material.opacity = cineDark.k * .5;
  if (!cineDark.on && cineDark.k <= 0) cineDark.wall.visible = cineDark.floor.visible = false;
}
// 相手を選ぶ
function duoTarget(f, range, sup) {
  let best = null, bd = 1e9;
  for (const e of fighters) {
    if (!e.alive || e.out || !hostile(f, e) || e.state === 'dead' || e.hp <= 0 || e.pit || (e.ai && e.ai.door) || e.duo) continue;
    const dx = Math.abs(e.x - f.x), dz = Math.abs(e.z - f.z);
    if (!onScreen(e.x, -.2)) continue;
    if (sup) { const d = dx + dz - ((e.spec && (e.spec.boss || e.spec.mid)) ? 100 : 0); if (d < bd) { bd = d; best = e; } continue; }   // 超必殺は大物を優先
    if (downish(e.state) || e.y > .6 || dx > range || dz > 1.0) continue;
    const d = dx + dz * 1.5 + (Math.sign(e.x - f.x) === f.face ? 0 : .8);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function tryDuo(f) {
  if (G.cine || G.mode !== 'coop' || (f.meter || 0) < 100) return false;
  const keys = EXE_KEYS.filter(k => duoReady(DUOS[k])); if (!keys.length) return false;
  const tgt = duoTarget(f, 3.3, false);
  if (!tgt) { if (f.isPlayer && (f.duoMsg || 0) < gameTime) { f.duoMsg = gameTime + 1.5; toastAt(f, '近くに相手がいない'); } return false; }
  f.meter -= 100;
  return startDuo(f, tgt, DUOS[pick(keys)], DUO_DMG);
}
function trySuper(f) {
  if (G.cine || G.mode !== 'coop' || (f.meter || 0) < METER_MAX || !duoReady(DUOS.super)) return false;
  const tgt = duoTarget(f, 99, true);
  if (!tgt) { if (f.isPlayer && (f.duoMsg || 0) < gameTime) { f.duoMsg = gameTime + 1.5; toastAt(f, '相手がいない'); } return false; }
  f.meter = 0;
  return startDuo(f, tgt, DUOS.super, Math.max(160, tgt.maxhp / 3));   // ボスには最大体力の 3 分の 1
}
function startDuo(a, v, D, total) {
  const ca = CLIPS.get(D.a), cv = CLIPS.get(D.v);
  for (const f of [a, v]) {
    if (f.victim) releaseGrab(f);
    if (f.holder) { const h = f.holder; h.victim = null; if (h.state === 'grab') h.state = 'idle'; f.holder = null; }
    if (f.carry) dropCarry(f, false);
    f.move = null; f.vx = f.vy = f.vz = 0; f.y = 0; f.flat = 0; f.queued = false;
  }
  if (v.weapon && v.weapon.kind !== 'knuckle') dropWeapon(v, 0);
  a.face = Math.sign(v.x - a.x) || a.face; v.face = -a.face;
  const ka = duoK(a, ca), kv = duoK(v, cv), a0 = duoPos(ca, 0), v0 = duoPos(cv, 0);
  const sep = (t) => D.D * (ka + kv) / 2 - (duoPos(ca, t)[2] - a0[2]) * ka - (duoPos(cv, t)[2] - v0[2]) * kv;   // その時刻の 2 人の間合い
  let t0 = 0;
  if (D.fly) { const dist = Math.abs(v.x - a.x), tMax = D.hits[0][0] - .28; while (t0 < tMax && sep(t0) > dist) t0 += .02; }   // 遠くから始まる技は、今の間合いに合う時刻から始める
  const ax0 = v.x - a.face * Math.max(.3, sep(t0));
  const C = { a, v, D, t: t0, total, hi: 0, wsum: D.hits.reduce((s, h) => s + h[1], 0), camX: G.camX, zoom: 0, lift: 0,
    A: { f: a, clip: ca, x0: ax0, z0: v.z, p0: duoPos(ca, t0), k: ka, face: a.face, lat: -1 },
    V: { f: v, clip: cv, x0: v.x, z0: v.z, p0: duoPos(cv, t0), k: kv, face: v.face, lat: 1 },
    sx: a.x - ax0, sz: a.z - v.z };
  const mir = a.face < 0, ent = (clip) => ({ clip, s: 0, e: clip.dur, sp: 1, len: clip.dur, xz: 'lock', bl: .12, key: 'duo' });
  a.duo = { ent: ent(ca), mir }; v.duo = { ent: ent(cv), mir };
  a.state = 'duo'; v.state = 'duov'; a.t = v.t = t0; a.inv = v.inv = 0; a.hitSet.clear();
  G.cine = C; cineBackdrop(true, Math.min(a.z, v.z));
  const c = teamCol(a);
  if (D.sup) superBegin(C);
  else { sfx.duoStart(); flashFx(a.x, 1.2, a.z + .2, 3.4, c, .2, .7); ringFx(a.x, .05, a.z, .3, 3, .4, c, 'ground'); textFx((a.x + v.x) / 2, 2.7, a.z, D.name, c, 2.3, 1.0); if (a.isClaude && Math.random() < .5) say('duoC', 1); }
  for (let i = 0; i < 26; i++) { const an = rnd(0, 6.283); streaks.add(a.x, 1.1, a.z, Math.cos(an) * rnd(8, 18), Math.sin(an) * rnd(8, 18), 0, rnd(.15, .3), .05, .05, c[0], c[1], c[2], 0, 2); }
  cinePlace(C, 0);
  return true;
}
function cinePlace(C, dt) {
  const k = C.t - (C.t0 == null ? (C.t0 = C.t) : C.t0), sh = Math.max(0, 1 - k / .16);   // はじめの一瞬で、技の立ち位置へすべりこむ
  for (const R of [C.A, C.V]) {
    const f = R.f, p = duoPos(R.clip, C.t);
    f.x = R.x0 + R.face * (p[2] - R.p0[2]) * R.k + (R === C.A ? C.sx * sh : 0);
    f.z = R.z0 + R.lat * (p[0] - R.p0[0]) * R.k + (R === C.A ? C.sz * sh : 0);
    f.y = 0; f.vx = f.vy = f.vz = 0; f.t = C.t; f.state = R === C.A ? 'duo' : 'duov'; f.move = null; f.flash = Math.max(0, f.flash - dt);
  }
}
function cineTick(dt) {
  const C = G.cine, D = C.D;
  if (C.pre > 0) { superPre(C, dt); return; }
  C.t += dt;
  cinePlace(C, dt);
  while (C.hi < D.hits.length && C.t >= D.hits[C.hi][0]) { duoHit(C, D.hits[C.hi], C.hi === D.hits.length - 1); C.hi++; }
  if (D.sup) superTick(C, dt);
  if (C.t >= D.end) endDuo(C);
}
function duoHit(C, h, last) {
  const a = C.a, v = C.v, big = last || h[1] >= 2;
  const dmg = C.total * h[1] / C.wsum;
  v.body.hips.getWorldPosition(_dv);
  const x = _dv.x - a.face * .2, y = Math.max(.5, _dv.y + .25), z = _dv.z;
  v.hp = Math.max(0, v.hp - dmg); v.flash = .14; v.lastHitBy = a; a.score += Math.round(dmg * 10);
  fxHit(a, v, { key: 'duo', knock: big ? 1 : 0 }, a.face, x, y, z, big, dmg);
  comboHit(a, dmg, big, v.x, y + .75, z); sfx.hit(big, a.isPlayer ? G.combo : 0, true);
  const rapid = C.D.sup && !last && C.hi > 0;   // 超必殺の、持ち上げながらの連打
  hitStop = Math.max(hitStop, last ? (C.D.sup ? .5 : .16) : rapid ? .035 : .07); shake(last ? (C.D.sup ? 1.3 : .4) : rapid ? .28 : .2); camPunch = Math.max(camPunch, last ? (C.D.sup ? 3.6 : 2.2) : .8);
  if (rapid) superRapid(C, x, y, z);
  G.focus = v; G.focusT = 3;
  if (!last) return;
  const c = teamCol(a);
  ringFx(v.x, .05, v.z, .4, 3.4, .5, c, 'ground'); flashFx(x, y, z + .2, C.D.sup ? 7 : 3.6, COL.white, .22, .8);
  if (C.D.sup) superSlam(C, x, y, z);
  if (v.hp <= 0) { sfx.down(!!(v.spec && v.spec.boss)); fxKO(v, c); }
}
function endDuo(C) {
  const a = C.a, v = C.v;
  a.duo = v.duo = null; G.cine = null; cineBackdrop(false);
  for (const f of [a, v]) { f.x = clamp(f.x, G.camX - halfW + .6, G.camX + halfW - .6); f.z = clamp(f.z, Z_MIN, Z_MAX); f.y = 0; f.vx = f.vy = f.vz = 0; f.move = null; }
  a.state = 'idle'; a.t = 0; a.inv = Math.max(a.inv, .9); a.cool = 0; a.shotCd = Math.max(a.shotCd, .3);
  if (v.hp <= 0) {
    v.state = 'dead'; v.t = 0; onDeath(v);
    if (G.mode === 'coop' && G.area && G.waveIdx >= G.area.waves.length && !fighters.some(e => e.team === 'enemy' && e.alive && e.hp > 0)) { fxFinish(v, teamCol(a)); sfx.finish(); }
  } else { v.state = 'down'; v.t = .2; v.inv = 0; }
  pressed.clear();
}
function cineCancel() { cutIn(null); if (G.cine) { G.cine.a.duo = G.cine.v.duo = null; G.cine = null; } cineBackdrop(false); if (cineDark) { cineDark.k = 0; cineDark.wall.visible = cineDark.floor.visible = false; } }
// 超必殺のあいだのカメラ: 構えでは本人へぐっと寄り、飛び出したら 2 人を追いかけ、飛び上がったら見上げる
const _cl = new T.Vector3(), _cp = new T.Vector3();
function cineCamera(dt, sx, sy) {
  const C = G.cine, a = C.a, v = C.v;
  a.body.hips.getWorldPosition(_dv); const ya = _dv.y; v.body.hips.getWorldPosition(_dv); const yv = _dv.y;
  const lift = Math.max(0, Math.max(ya, yv) - 1.3), sepX = Math.abs(a.x - v.x), k = Math.min(1, dt * 7);
  C.camX += (clamp((a.x + v.x) / 2, G.camX - 3.5, G.camX + 3.5) - C.camX) * k;
  C.lift += (lift - C.lift) * k; C.zoom += (Math.max(0, sepX - 7.5) * .7 + lift * 1.1 - (sepX < 3 && lift < .3 ? 1.6 : 0) - C.zoom) * k;
  _cp.set(C.camX + sx, CAM_Y + sy + C.lift * .45, CAM_Z + C.zoom); _cl.set(C.camX + sx * .5, LOOK_Y + C.lift * .8, 0);
  // 寄り: 構えのはじめにすっと寄って、飛び出す直前にぱっと引く
  const want = C.pre > 0 ? (C.pre > .16 ? 1 : 0) : 0;
  C.close = (C.close || 0) + (want - (C.close || 0)) * Math.min(1, dt * (want ? 9 : 14));
  if (C.close > .002) {
    const q = C.close, u = C.pre > 0 ? 1 - C.pre / SUPER_PRE.T : 1, d = 3.5 - u * .7;   // 構えのあいだ、じわじわ寄り続ける
    _cp.lerp(_dv.set(a.x + a.face * (1.5 - u * .5) + sx * .3, 1.42 + sy * .3, a.z + d), q);
    _cl.lerp(_dv.set(a.x + a.face * .1, 1.22, a.z), q);
  }
  camera.position.copy(_cp); camera.lookAt(_cl);
}
// =========================================================================================
// 超必殺の演出: カットイン → 気をためる → 音の壁を破って飛ぶ → つかんで連打 → 叩きつけて大爆発
// =========================================================================================
function cutIn(name, f) {
  const el = $('cutin'); if (!el) return;
  if (!name) { el.classList.remove('show'); return; }
  const c = teamCol(f); el.style.setProperty('--c', `rgb(${c.map(v => Math.round(v * 255)).join(',')})`);
  $('cutName').textContent = name; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function stampIn(text) { const el = $('stamp'); if (!el) return; el.textContent = text; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
function impactFrame(ms = 90) {   // 当たった瞬間の 1 枚だけ、画面の色をひっくり返す
  const cv = renderer.domElement; if (xrOn()) return;
  cv.style.filter = 'invert(1) contrast(1.35)'; setTimeout(() => { cv.style.filter = ''; }, ms);
}
function superBegin(C) {
  const a = C.a, c = teamCol(a), pc = CLIPS.get(SUPER_PRE.clip);
  C.pre = SUPER_PRE.T; C.pt = { x: a.x, y: 1.15, z: a.z }; C.rt = 0; C.ft = 0;
  if (pc) { C.ent = a.duo.ent; a.duo.ent = { clip: pc, s: SUPER_PRE.s, e: SUPER_PRE.e, sp: 1, len: SUPER_PRE.e - SUPER_PRE.s, xz: 'lock', bl: .1, key: 'duopre' }; a.t = 0; }
  VRH.ban = { big: '超必殺', sub: C.D.name, t: 2.4 }; cutIn(C.D.name, a);
  sfx.superStart(); sfx.charge(); wFlash = Math.max(wFlash, .45); shake(.35);
  pillarFx(a.x, a.z, 1.7, 7, 1.1, c, .28); ringFx(a.x, .05, a.z, .4, 7, .6, c, 'ground'); ringFx(a.x, 1.2, a.z + .2, .3, 5, .45, COL.white, 'cam', 1, .7);
  if (a.isClaude) say('superC', 3); else say('superP', 2);
}
// 構え: まわりの気が渦を巻いて集まり、足もとの輪がしぼんでいく
function superPre(C, dt) {
  const a = C.a, v = C.v, c = teamCol(a), T0 = SUPER_PRE.T, u = 1 - C.pre / T0;
  C.pre -= dt; a.t = T0 - C.pre; v.t = C.t; a.state = 'duo'; v.state = 'duov'; a.vx = a.vz = v.vx = v.vz = 0;
  C.pt.x = a.x; C.pt.z = a.z;
  for (let i = 0; i < 9; i++) {
    const an = rnd(0, 6.283), el = rnd(-.5, 1.1), r = rnd(2.0, 3.6), nx = Math.cos(an) * Math.cos(el), ny = Math.sin(el), nz = Math.sin(an) * Math.cos(el), k = i % 3 ? c : COL.white, sp = rnd(2.5, 4);
    flow.guide(a.x + nx * r, Math.max(.08, 1.15 + ny * r), a.z + nz * r * .7, -nz * r * sp, rnd(-1, 2.5), nx * r * sp, C.pt, -nx * r * 1.6, -ny * r * 1.6 - 1, -nz * r * 1.6, rnd(.32, .55), .07 + u * .04, .16, k[0] * 1.25, k[1] * 1.25, k[2] * 1.25, .9, 1.2, 1.3);
  }
  for (let i = 0; i < 2; i++) { const an = rnd(0, 6.283), r = rnd(.35, .8); streaks.add(a.x + Math.cos(an) * r, rnd(0, .4), a.z + Math.sin(an) * r * .6, 0, rnd(7, 15), 0, rnd(.2, .35), .04, .07, c[0], c[1], c[2], 0, 0); }
  C.rt -= dt; if (C.rt <= 0) { C.rt = .14; ringFx(a.x, .05, a.z, 5.5, .4, .3, i2(u) ? COL.white : c, 'ground', 1, .7); a.flash = .05; shake(.06 + u * .2); }
  if (C.pre <= 0) {   // 飛び出す: 空気の壁を破る輪
    if (C.ent) { a.duo.ent = C.ent; C.ent = null; } a.t = C.t; cutIn(null);
    sfx.boom(false); sfx.whoosh(1); shake(.7); wFlash = Math.max(wFlash, .45); camPunch = Math.max(camPunch, 2);
    for (let i = 0; i < 3; i++) ringFx(a.x + a.face * i * .5, 1.15, a.z + .1, .3, 3.2 + i * 1.6, .34 + i * .08, i === 1 ? c : COL.white, 'cam', .38, .9);
    for (let i = 0; i < 40; i++) { const el = rnd(-1.3, 1.3); streaks.add(a.x, 1.1, a.z, -a.face * Math.cos(el) * rnd(8, 26), Math.sin(el) * rnd(4, 14), rnd(-4, 4), rnd(.2, .4), .05, .06, c[0], c[1], c[2], 0, 1); }
    dust(a.x, a.z, 1.8);
  }
}
const i2 = (u) => ((u * 8) | 0) % 2;
// 飛んでいるあいだ・持ち上げているあいだ
function superTick(C, dt) {
  const a = C.a, v = C.v, c = teamCol(a), D = C.D, t1 = D.hits[0][0], tE = D.hits[D.hits.length - 1][0];
  a.body.hips.getWorldPosition(_dv); const hx = _dv.x, hy = _dv.y, hz = _dv.z;
  if (C.t < t1) {
    for (let i = 0; i < 3; i++) glow.add(hx - a.face * rnd(0, .6), hy + rnd(-.2, .2), hz + rnd(-.2, .2), -a.face * rnd(2, 6), rnd(-.5, .5), 0, rnd(.25, .45), .2, 0, c[0] * 1.3, c[1] * 1.3, c[2] * 1.3, .8, 0, 1);
    for (let i = 0; i < 12; i++) { const an = rnd(0, 6.283), r = rnd(.05, .45), k = i % 4 ? c : COL.white; flow.add(hx - a.face * rnd(0, .5), hy + Math.sin(an) * r, hz + Math.cos(an) * r * .6, -a.face * rnd(.5, 3), 0, 0, rnd(.6, 1.2), rnd(.06, .12), .012, k[0] * 1.25, k[1] * 1.25, k[2] * 1.25, .75, 2.6, 1.0, 2); }
    for (let i = 0; i < 3; i++) streaks.add(G.camX + rnd(-halfW, halfW) * 1.1, rnd(.2, 3.6), rnd(-3.2, 1.5), -a.face * rnd(34, 60), 0, 0, rnd(.1, .18), .04, .04, 1, 1, 1, 0, 0);   // 流れる線
    C.rt -= dt; if (C.rt <= 0) { C.rt = .09; ringFx(hx, hy, hz + .1, .25, 2.0, .26, COL.white, 'cam', .4, .55); }
  } else if (C.t < tE) {
    const pt = C.pt; v.body.hips.getWorldPosition(_dv); pt.x = (hx + _dv.x) / 2; pt.y = (hy + _dv.y) / 2; pt.z = hz;
    for (let i = 0; i < 6; i++) { const an = rnd(0, 6.283), r = rnd(1.1, 2.0), k = i % 3 ? c : COL.white; flow.guide(pt.x + Math.cos(an) * r, .08, pt.z + Math.sin(an) * r * .6, -Math.sin(an) * r * 5, 2.5, Math.cos(an) * r * 3, pt, -Math.cos(an) * 2, 3, 0, rnd(.35, .6), .08, .02, k[0] * 1.25, k[1] * 1.25, k[2] * 1.25, .85, 1.4, 1.3); }
    C.rt -= dt; if (C.rt <= 0) { C.rt = .2; ringFx(pt.x, .05, pt.z, .4, 4.2, .4, c, 'ground', 1, .6); }
    shake(.05 + (C.t - t1) / (tE - t1) * .12);
  }
}
// 連打 1 発ぶん: 火花と、渦を巻いて散る粒
function superRapid(C, x, y, z) {
  const a = C.a, c = teamCol(a);
  flashFx(x, y, z + .2, 2.6, COL.white, .1, .7); ringFx(x, y, z + .2, .15, 1.9, .2, c, 'cam', 1, .8);
  for (let i = 0; i < 26; i++) { const an = rnd(0, 6.283), e = rnd(-1.2, 1.2), sp = rnd(2, 7), k = i % 3 ? c : COL.white; flow.add(x, y, z, Math.cos(an) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(an) * Math.cos(e) * sp * .5, rnd(.35, .7), .11, .01, k[0] * 1.3, k[1] * 1.3, k[2] * 1.3, .9, 3, 1.3, 3.5); }
  for (let i = 0; i < 10; i++) { const an = rnd(0, 6.283), sp = rnd(10, 22); streaks.add(x, y, z, Math.cos(an) * sp, Math.sin(an) * sp, 0, rnd(.1, .18), .04, .05, 1, 1, 1, 0, 2); }
}
let craterTex = null;
function crater(x, z, r = 2.3) {
  craterTex = craterTex || canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); const gr = g.createRadialGradient(128, 128, 4, 128, 128, 126);
    gr.addColorStop(0, 'rgba(0,0,0,.92)'); gr.addColorStop(.38, 'rgba(6,6,12,.72)'); gr.addColorStop(.7, 'rgba(10,10,18,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,.9)'; g.lineCap = 'round';
    for (let i = 0; i < 17; i++) {   // ひび割れ
      let an = i / 17 * 6.283 + rnd(-.15, .15), px = 128 + Math.cos(an) * 14, py = 128 + Math.sin(an) * 14, L = rnd(60, 118); g.lineWidth = rnd(1.6, 4); g.beginPath(); g.moveTo(px, py);
      for (let d = 14; d < L; d += rnd(9, 18)) { an += rnd(-.35, .35); px += Math.cos(an) * 13; py += Math.sin(an) * 13; g.lineTo(px, py); g.lineWidth *= .9; }
      g.stroke();
    }
    g.lineWidth = 2; for (const rr of [36, 62, 90]) { g.beginPath(); for (let an = 0; an < 6.283; an += .5) { const q = rr + rnd(-5, 5); g[an ? 'lineTo' : 'moveTo'](128 + Math.cos(an) * q, 128 + Math.sin(an) * q); } g.closePath(); g.globalAlpha = .5; g.stroke(); g.globalAlpha = 1; }
  });
  const m = new T.Mesh(new T.PlaneGeometry(r * 2, r * 2), new T.MeshBasicMaterial({ map: craterTex, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = rnd(0, 6.28); m.position.set(x, .045, clamp(z, Z_MIN + .3, Z_MAX - .3)); m.renderOrder = 3; scene.add(m);
  fx.push({ o: m, t: 0, dur: 9, kind: 'fade', a: 1 });
}
// 叩きつけ: 画面が止まり、白く飛び、輪が何重にも走り、地面が割れて、破片と粒が吹き上がる
function superSlam(C, x, y, z) {
  const a = C.a, v = C.v, c = teamCol(a), gx = v.x, gz = v.z;
  sfx.boom(true); sfx.thunder(); wFlash = 1; slowT = Math.max(slowT, .95); impactFrame(); stampIn('5億年ぶんの一撃');
  crater(gx, gz, 2.6);
  pillarFx(gx, gz, .55, 17, 1.0, COL.white, .95); pillarFx(gx, gz, 1.7, 12, .9, c, .7); pillarFx(gx, gz, 3.2, 7, .8, COL.gold, .4);
  const RC = [COL.white, c, COL.gold, c, COL.white];
  for (let i = 0; i < 5; i++) later(i * .055, () => { ringFx(gx, .06, gz, .5, 8 + i * 3.4, .75 + i * .06, RC[i], 'ground', 1, .95 - i * .1); if (i === 2) { sfx.boom(false); shake(.6); } });
  ringFx(gx, .9, gz + .2, .4, 9, .5, COL.white, 'cam', 1, .8); ringFx(gx, .9, gz + .2, .3, 6, .65, c, 'cam', 1, .7);
  flashFx(gx, 1, gz + .2, 12, COL.white, .3, .9); flashFx(gx, 1, gz + .2, 16, c, .5, .5);
  textFx(gx, 2.7, gz, 'ドッゴォォン!!', COL.white, 5.2, 1.5);
  for (let i = 0; i < 44; i++) { debris(gx + rnd(-1.3, 1.3), .15, gz + rnd(-.7, .7), pick([0x2a2c3a, 0x55586a, 0x1c1d28, 0x8a8ea0])); const e = fx[fx.length - 1]; e.dur = rnd(1.3, 2.0); e.v.set(rnd(-8, 8), rnd(6, 15), rnd(-2.5, 2.5)); e.o.scale.multiplyScalar(rnd(1, 2.6)); }
  for (let i = 0; i < 80; i++) { const an = rnd(0, 6.283), sp = rnd(4, 16); glow.add(gx, .2, gz, Math.cos(an) * sp, rnd(2, 14), Math.sin(an) * sp * .4, rnd(.4, 1.0), rnd(.14, .32), .03, c[0] * 1.5, c[1] * 1.5, c[2] * 1.5, 1, 8, 1.5); }
  for (let i = 0; i < 260; i++) { const an = rnd(0, 6.283), e = rnd(0, 1.45), sp = rnd(2, 12), k = i % 3 ? c : COL.white; flow.add(gx + Math.cos(an) * .3, .25, gz + Math.sin(an) * .2, Math.cos(an) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(an) * Math.cos(e) * sp * .45, rnd(.8, 1.9), rnd(.08, .17), .012, k[0] * 1.3, k[1] * 1.3, k[2] * 1.3, .85, 3.2, .85, 2.2); }
  for (let i = 0; i < 70; i++) { const an = i / 70 * 6.283, sp = rnd(16, 34); streaks.add(gx, .8, gz, Math.cos(an) * sp, Math.abs(Math.sin(an)) * sp * .8, 0, rnd(.16, .3), .06, .08, 1, 1, 1, 0, 1.5); }
  for (let i = 0; i < 30; i++) { const an = i / 30 * 6.283; smoke.add(gx + Math.cos(an) * .5, .15, gz + Math.sin(an) * .3, Math.cos(an) * rnd(4, 8), rnd(.3, 1.4), Math.sin(an) * rnd(1.5, 3), rnd(.9, 1.5), .5, 2.0, COL.smoke[0], COL.smoke[1], COL.smoke[2], .4, -.25, 2.2); }
  // 画面じゅうの敵が吹っ飛び、少し遅れて足もとで次々に爆ぜる
  let n = 0;
  for (const e of enemies()) if (e !== v && e.state !== 'dead' && !e.pit && onScreen(e.x, 1) && !(e.ai && e.ai.door)) {
    applyHit(a, e, { dmg: 60, kb: 7.5, knock: 1, launch: 8, heavy: 1, dir: Math.sign(e.x - gx) || 1, x: gx, key: 'super', env: 1 });
    const ex = e.x, ez = e.z; later(.07 + (n++) * .05, () => { flashFx(ex, 1, ez + .2, 3.4, COL.white, .16, .8); ringFx(ex, .05, ez, .3, 3.2, .4, c, 'ground'); pillarFx(ex, ez, .5, 5, .4, c, .6); for (let i = 0; i < 16; i++) { const an = rnd(0, 6.283), sp = rnd(2, 8); flow.add(ex, .6, ez, Math.cos(an) * sp, rnd(1, 7), Math.sin(an) * sp * .4, rnd(.5, 1), .12, .01, c[0] * 1.3, c[1] * 1.3, c[2] * 1.3, .85, 2.6, 1.1, 2.6); } });
  }
}
// =========================================================================================
// 3〜5 面の敵（2026-10-07）: まだ使っていなかったモーションで作った新しいタイプ
//   rush = 駆け込み（Melee の Lunge）/ thrower = 物を投げる（Melee の Throw）/ kneel = ひざ撃ち（Range の Shoot_03）
//   ninja = Female Fight パックを敵が使う / dance・idol・zombie = ダンスのモーションで立っている
//   sorc2 = 魔女パックの残りの技 / psy1・esper2 = 超能力パックの残りの技 / selfp = 主人公と同じ流派（5 面の大ボス）
// =========================================================================================
Object.assign(ENEMIES, {
  // ---- 3 面: 5億年駅 ----
  commuter: { name: '定期を忘れた会社員', hp: 50, spd: 2.1, pow: 1.1, reach: 1.05, color: 0x3a3f52, accent: 0xd9dde8, scale: 1, score: 160, guard: .12, look: 'tie' },
  rusher:   { copy: 'speed', name: '駆け込み乗車', prof: 'rush', hp: 40, spd: 3.2, pow: 1.1, reach: 1.05, color: 0x2a6f9f, accent: 0xffe14a, scale: .95, score: 240, rusher: 1, runner: 1, look: 'tie' },
  bento:    { copy: 'rapid', name: '駅弁（投げ売り）', prof: 'thrower', hp: 44, spd: 1.8, pow: 1, reach: 1.0, color: 0x8a3a2a, accent: 0xfff2c8, scale: 1, score: 260, shooter: 2.2, range: 8, shotCd: 3.2, keepAway: 4.4, noMelee: 1, look: 'bento' },
  drunk:    { copy: 'power', name: '終電を逃した人', hp: 70, spd: 1.7, pow: 1.25, reach: 1.2, color: 0x5a4a6a, accent: 0xff6a8a, scale: 1.05, score: 300, kungfu: 1, dodger: .25, look: 'drunk' },
  sniper:   { copy: 'gun', name: '乗り越し精算スナイパー', prof: 'kneel', hp: 36, spd: 1.8, pow: 1, reach: 1.0, color: 0x2f4a3a, accent: 0xff3030, scale: .98, score: 320, shooter: 2.0, range: 9, shotCd: 4.2, keepAway: 5.6, noMelee: 1, look: 'gun' },
  ninja:    { copy: 'blade', name: '改札を飛び越える人', prof: 'ninja', hp: 48, spd: 3.0, pow: 1.1, reach: 1.15, color: 0x1c1c2a, accent: 0x2be8c8, scale: .95, score: 300, dodger: .4, dasher: 1, jumper: 1, heavyAtk: 1, guard: .15, look: 'ninja' },
  mid5:     { copy: 'speed', name: '駆け込み乗車（常習）', prof: 'rush', hp: 280, spd: 2.8, pow: 1.4, reach: 1.3, color: 0x1f4f8a, accent: 0xffe14a, scale: 1.4, score: 2400, mid: 1, nograb: 1, armor: 1, rusher: 1, heavyAtk: 1, slammer: 1, burst: 1, look: 'tie' },
  mid6:     { copy: 'blade', name: 'キセル忍者', prof: 'ninja', hp: 300, spd: 3.1, pow: 1.35, reach: 1.25, color: 0x15151f, accent: 0xff3d6e, scale: 1.25, score: 2600, mid: 1, nograb: 1, dodger: .45, dasher: 1, jumper: 1, heavyAtk: 1, blink: 1, guard: .3, shooter: 1.2, shotCd: 3.5, burst: 1, look: 'ninja' },
  boss3:    { name: 'ダイヤの乱れ', prof: 'rush', hp: 480, spd: 2.0, pow: 1.7, reach: 1.5, color: 0x1a2440, accent: 0xffd23a, scale: 1.75, score: 6000, boss: 1, armor: 1, nograb: 1, rusher: 1, slammer: 1, heavyAtk: 1, shooter: .9, shotCd: 3, burst: 1, rage: 1, look: 'cap' },
  // ---- 4 面: 5億年ランド ----
  mascot:   { copy: 'power', name: '中の人（3人目）', prof: 'brute', hp: 120, spd: 1.3, pow: 1.35, reach: 1.35, color: 0xd98ab0, accent: 0xfff2f8, scale: 1.4, score: 420, armor: 1, nograb: 1, heavyAtk: 1, burst: 1, look: 'mascot' },
  clown:    { copy: 'magic', name: '笑ってないピエロ', prof: 'juggler', hp: 52, spd: 2.4, pow: 1, reach: 1.0, color: 0xd03a4a, accent: 0xffe14a, scale: 1, score: 340, shooter: 2.2, range: 7.5, shotCd: 3.0, keepAway: 3.8, blink: 1, noMelee: 1, look: 'clown' },
  dancer:   { copy: 'speed', name: 'パレードの残党', prof: 'dance', hp: 56, spd: 2.6, pow: 1.1, reach: 1.2, color: 0xff5aa8, accent: 0x7fe9ff, scale: .95, score: 300, dodger: .3, heavyAtk: 1, jumper: 1, look: 'idol' },
  zombie:   { copy: 'power', name: '閉園後のスタッフ', prof: 'zombie', hp: 62, spd: 1.25, pow: 1.3, reach: 1.15, color: 0x4a6a4a, accent: 0xb8ff5a, scale: 1.02, score: 320, revive: 1, heavyAtk: 1, look: 'zombie' },
  fairy:    { copy: 'magic', name: '魔法少女（自称・5億歳）', prof: 'sorc2', hp: 48, spd: 2.6, pow: 1.15, reach: 1.2, color: 0xc77ae8, accent: 0xfff07a, scale: .9, score: 340, dasher: 1, caster: 1, blink: 1, look: 'fairy' },
  balloon:  { copy: 'jet', name: '手を離れた風船', prof: 'drone', hp: 30, spd: 2.6, pow: 1, reach: 1.0, color: 0xe83a4a, accent: 0xffffff, scale: .85, score: 280, flyer: 1.5, keepAway: 3.2, diver: 1, noMelee: 1, nograb: 1, look: 'balloon' },
  mid7:     { copy: 'power', name: '着ぐるみの中の人（本体）', prof: 'brute', hp: 340, spd: 1.5, pow: 1.55, reach: 1.5, color: 0xe8a0c0, accent: 0xffffff, scale: 1.65, score: 2800, mid: 1, armor: 1, nograb: 1, heavyAtk: 1, slammer: 1, burst: 1, shooter: 1.2, shotCd: 5, look: 'mascot' },
  mid8:     { copy: 'psy', name: '絶叫マシンの絶叫担当', prof: 'esper2', hp: 320, spd: 1.7, pow: 1.35, reach: 1.25, color: 0x3a2a6a, accent: 0xffe14a, scale: 1.25, score: 3000, mid: 1, nograb: 1, shooter: 1.8, shotCd: 3.2, storm: 1, blink: 1, heavyAtk: 1, guard: .2, look: 'clown' },
  boss4:    { name: '永遠のアイドル（活動5億年目）', prof: 'idol', hp: 540, spd: 2.4, pow: 1.6, reach: 1.4, color: 0xff4f9a, accent: 0xfff07a, scale: 1.55, score: 7000, boss: 1, armor: 1, nograb: 1, dasher: 1, heavyAtk: 1, shooter: 1.4, shotCd: 3, storm: 1, burst: 1, dodger: .25, jumper: 1, rage: 1, look: 'idol' },
  // ---- 5 面: 何もない空間（気持ちが敵になって出てくる）----
  bored:    { copy: 'psy', name: '退屈', prof: 'psy1', hp: 64, spd: 1.5, pow: 1.2, reach: 1.15, color: 0xd8dce8, accent: 0x8f6bff, scale: 1, score: 360, shooter: 1.4, shotCd: 4, range: 7, heavyAtk: 1, ghost: 1, look: 'ghost' },
  lonely:   { copy: 'blade', name: '孤独', prof: 'ninja', hp: 54, spd: 3.0, pow: 1.2, reach: 1.15, color: 0xb8c0d8, accent: 0x4fa8ff, scale: .95, score: 380, blink: 1, dodger: .35, dasher: 1, heavyAtk: 1, ghost: 1, look: 'ghost' },
  regret:   { copy: 'power', name: '押さなきゃよかった', prof: 'brute', hp: 150, spd: 1.3, pow: 1.5, reach: 1.4, color: 0xc8ccd8, accent: 0xff2d3d, scale: 1.45, score: 520, armor: 1, nograb: 1, heavyAtk: 1, burst: 1, ghost: 1, look: 'ghost' },
  yawn:     { copy: 'jet', name: 'あくび', prof: 'drone', hp: 34, spd: 2.8, pow: 1, reach: 1.0, color: 0xe8ecf8, accent: 0xffe14a, scale: .9, score: 320, flyer: 1.4, keepAway: 3.4, diver: 1, noMelee: 1, nograb: 1, ghost: 1, look: 'ghost' },
  counter:  { copy: 'gun', name: 'あと4億9999万年', prof: 'kneel', hp: 44, spd: 1.8, pow: 1, reach: 1.0, color: 0xd0d4e0, accent: 0xff3030, scale: 1, score: 360, shooter: 2.2, range: 9, shotCd: 3.8, keepAway: 5.4, noMelee: 1, ghost: 1, look: 'ghost' },
  memory:   { name: 'さっき殴った敵の記憶', hp: 66, spd: 2.3, pow: 1.25, reach: 1.1, color: 0xc0c6d8, accent: 0xff3d6e, scale: 1, score: 300, guard: .2, kungfu: 1, ghost: 1, look: 'ghost' },
  mid9:     { copy: 'psy', name: '数えるのをやめた人', prof: 'esper2', hp: 380, spd: 1.7, pow: 1.45, reach: 1.25, color: 0xe0e4f0, accent: 0x9d7bff, scale: 1.3, score: 3400, mid: 1, nograb: 1, shooter: 1.9, shotCd: 3, storm: 1, blink: 1, heavyAtk: 1, guard: .25, ghost: 1, look: 'ghost' },
  mid10:    { copy: 'blade', name: '悟り（未遂）', prof: 'ninja', hp: 400, spd: 3.0, pow: 1.5, reach: 1.3, color: 0xf0f2f8, accent: 0xffce4a, scale: 1.35, score: 3600, mid: 1, nograb: 1, armor: 1, dodger: .45, blink: 1, dasher: 1, jumper: 1, heavyAtk: 1, burst: 1, guard: .35, ghost: 1, look: 'ghost' },
  boss5:    { name: '5億年目の自分', prof: 'selfp', clone: 1, hp: 620, spd: 3.0, pow: 1.5, reach: 1.3, color: 0x1a1426, accent: 0xff2d6a, scale: 1, score: 10000, boss: 1, armor: 1, nograb: 1, dasher: 1, dodger: .35, guard: .3, heavyAtk: 1, kungfu: 1, shooter: 1.6, shotCd: 2.6, burst: 1, blink: 1, jumper: 1, rage: 1, look: 'ghost' },
});
DEFAULT_SETS.dance = './motions/brawl/dance';
{
  const M = PROFILES.male.st, J = PROFILES.jet.st, E = PROFILES.esper.st, SC = PROFILES.sorc.st;
  // やられ・つかまれ（ロボの体でも自然に見える、男性格闘パックのもの）
  const HURT = { hurt: { c: 'male:LightHit', e: .45, sp: 1.3 }, knock: { c: 'male:Knockdown_S', e: .6 }, thrown: { c: 'male:JumpHitReact_S', m: 'loop', hips: 'air', fall: 1 }, down: { c: 'male:Knockdown_S', s: .6, e: 1.3, sp: .8 },
    dead: { c: 'male:Knockdown_S', s: 1.25, e: 1.32, sp: .1 }, getup: { c: 'male:Knockdown_S', s: 1.67, e: 2.4, sp: 1.5 }, grabbed: { c: 'male:Choke', m: 'loop' }, stun: { c: 'male:Stunned', m: 'loop' } };
  // Female Fight パックの打撃（主人公の「ストリート流」と同じ時刻）
  const FF = {
    eatk:   { seq: [{ c: 'FightFist01_1', sp: 1.1 }, { c: 'FightFist02_1', e: .75, sp: 1.1 }], hit: [[.05, .16, { knock: 0, kb: .5, dmg: 4 }], [.69, .81]] },   // ジャブ → ストレート
    eatk2:  { c: 'Kick19', e: .95, sp: 1.1, hit: [[.27, .42]] },                                                                                              // 回し蹴り
    eheavy: { c: 'Kick02', e: 1.05, sp: 1.0, hit: [[.27, .43]] },                                                                                             // 踏みこんで横蹴り
    edash:  { c: 'Kick08', e: 1.25, sp: 1.2, hit: [[.5, .78]] },                                                                                              // 走りこんで飛び蹴り
    eburst: { c: 'Kick12', e: 1.05, sp: 1.1, hit: [[.3, .46]] },                                                                                              // 回転蹴り（周り全部）
    jump:   { c: 'Jump_Start', s: .3, e: .9, m: 'jump', hips: 'air' }, bjump: { c: 'Jump_Start', s: .3, e: .9, m: 'jump', hips: 'air' },
    jkick:  { c: 'Air_Kick_05', s: .28, e: .8, sp: 1.2, hips: 'air', hit: [[.36, 9]] }, land: { c: 'Jump_End', s: .05, e: .55, sp: 2.4 },
    backstep: { c: 'FightAvoid_B' }, guard: { c: 'female:Block', m: 'loop' }, guardhit: { c: 'female:BlockHitReact', sp: 1.3 },
  };
  const RUNS = { idle: { c: 'Fight_Idle', m: 'loop' }, walk: { c: 'Run_F', m: 'loop', nat: 3.9 }, walkU: { c: 'Run_F', m: 'loop', nat: 3.9 }, walkD: { c: 'Run_F', m: 'loop', nat: 3.9 }, run: { c: 'Sprint_1', m: 'loop', nat: 6.5, steps: 2 } };
  const dance = (c, s, e, nat) => ({ c: 'dance:' + c, s, e, m: 'loop', xz: 'lock', ...(nat ? { nat } : {}) });
  Object.assign(PROFILES, {
    // ---- 駆け込み: 遠くから頭を下げて走りこんでくる（Melee Combat の Lunge）----
    rush: { set: 'male', ref: 'Idle', st: { ...M,
      eatk:   { c: 'melee:Kick_02', s: .45, e: 1.75, sp: 1.4, xz: 'lock', hit: [[.86, 1.14]] },
      eatk2:  { seq: [{ c: 'Jab', sp: 1.1 }, { c: 'Punch', sp: 1.1 }], hit: [[.12, .26, { knock: 0, kb: .6, dmg: 4 }], [.56, .72]] },
      eheavy: { c: 'melee:Lunge_02', s: .7, e: 2.7, sp: 1.35, xz: 'lock', hit: [[1.35, 1.9]], mv: { step: 2.6 } },                                             // 踏みこんで体当たり
      edash:  { c: 'melee:Lunge_01', s: .95, e: 2.75, sp: 1.25, xz: 'lock', hit: [[1.25, 2.3]], mv: { dash: 10, dashFrom: .2, dmg: 11, kb: 7 } },             // 駆け込み乗車（画面の端から端まで）
    } },
    // ---- 物を投げる（Melee Combat の Throw）: 駅弁売り ----
    thrower: { set: 'male', ref: 'Idle', st: { ...M,
      erange: { c: 'melee:Throw_01', s: 1.9, e: 3.6, sp: 1.35, xz: 'lock', mv: { shot: { at: .52, spd: 8.5, dmg: 8, kb: 2.5, kind: 'glyph', glyph: '弁', col: 0xc8402a } } },
    } },
    // ---- お手玉（同じ投げ方で、玉を 3 つ）: ピエロ ----
    juggler: { set: 'male', ref: 'Idle', st: { ...M,
      erange: { c: 'melee:Throw_01', s: 1.9, e: 3.6, sp: 1.35, xz: 'lock', mv: { shot: { at: .52, spd: 6.6, dmg: 6, kb: 2, kind: 'orb', spread: 3 } } },
    } },
    // ---- ひざ撃ち（Range Combat の Shoot_03）: 走ってきて片ひざをつき、長くねらって、重い 1 発 ----
    kneel: { set: 'range', ref: 'Shoot_04', st: { ...PROFILES.gun.st,
      erange: { c: 'Shoot_03', s: 1.0, e: 5.2, sp: 1.5, xz: 'lock', mv: { shot: null, aim: 1, burst: { at: 1.35, n: 1, gap: .25, spd: 19, dmg: 13, kb: 5, knock: 1, kind: 'bullet' } } },
    } },
    // ---- 忍者（Female Fight パックを敵が使う）: 速い連打・回し蹴り・下がってよける。手裏剣も投げる ----
    ninja: { set: 'street', ref: 'Fight_Idle', lock: 1, st: { ...RUNS, ...FF, ...HURT,
      hurt:   { c: 'Hit_F', e: .5, sp: 1.4 },
      erange: { c: 'female:RangeAttack2', sp: 1.3, mv: { shot: { at: .43, spd: 11, dmg: 7, kb: 1.5, kind: 'glyph', glyph: '✦', col: 0xb8c0d8, plain: 1 } } },
    } },
    // ---- 踊り子: 立っているあいだ、ずっと踊っている（Music Video Dance）。攻めるときだけ蹴ってくる ----
    dance: { set: 'street', ref: 'Fight_Idle', lock: 1, st: { ...RUNS, ...FF, ...HURT,
      idle: dance('I_Got_a_Feeling', 6, 22), walk: dance('Come_Here_Rude_Boy', 2, 14, 2.6), walkU: dance('Come_Here_Rude_Boy', 2, 14, 2.6), walkD: dance('Come_Here_Rude_Boy', 2, 14, 2.6),
      hurt: { c: 'Hit_F', e: .5, sp: 1.4 },
    } },
    // ---- アイドル（4 面の大ボス）: 踊りながら、歌声の波・サイリウムの雨・蹴りの連続技 ----
    idol: { set: 'street', ref: 'Fight_Idle', lock: 1, st: { ...RUNS, ...FF, ...HURT,
      idle: dance('Run_The_World', 12, 24), walk: dance('Run_The_World', 36, 41, 2.4), walkU: dance('Run_The_World', 36, 41, 2.4), walkD: dance('Run_The_World', 36, 41, 2.4),
      eheavy: { c: 'Kick_Combo02_1', e: 1.3, sp: 1.1, hit: [[.27, .4, { knock: 0, kb: .4, dmg: 5 }], [.7, .88]] },
      erange: { c: 'superpower:Super_Power_02', s: .55, e: 3.0, sp: 1.6, xz: 'lock', mv: { shot: null, burst: { at: .45, n: 2, gap: .4, spd: 6.2, dmg: 9, kb: 7, knock: 1, kind: 'wave' } } },   // 歌声の波（2 連発）
      eburst: { c: 'superpower:Super_Power_08', s: 3.3, e: 8.3, sp: 2.4, xz: 'lock', mv: { a: [9, 9], hits: null, around: 0, bolt: { at: .5, n: 6, delay: .95, gap: .2, r: .95, dmg: 10 } } },   // サイリウムの雨
      hurt: { c: 'Hit_F', e: .5, sp: 1.4 },
    } },
    // ---- ゾンビ: よろよろ歩いて、大振り。一度倒しても起き上がる ----
    zombie: { set: 'street', ref: 'Fight_Idle', lock: 1, st: { ...HURT,
      idle: dance('Thriller', 12.5, 16), walk: dance('Thriller', .3, 3.8, 1.25), walkU: dance('Thriller', .3, 3.8, 1.25), walkD: dance('Thriller', .3, 3.8, 1.25), run: dance('Thriller', 20, 27, 3),
      eatk:   { c: 'melee:Punch_02', s: .45, e: 2.1, sp: 1.3, xz: 'lock', hit: [[.68, .9, { knock: 0, kb: 1, dmg: 6 }], [1.42, 1.68]] },
      eheavy: { c: 'melee:Punch_01', s: .6, e: 2.2, sp: 1.25, xz: 'lock', hit: [[1.25, 1.52]] },
    } },
    // ---- 妖精（魔女パックの残りの技）: 浮いたまま、回し蹴り・回転しながら突進・落雷 ----
    sorc2: { set: 'sorc', ref: 'Idle', st: { ...SC,
      eatk:  { c: 'Attack2_S', s: .6, e: 1.9, sp: 1.15, xz: 'lock', hit: [[1.05, 1.32]] },
      eatk2: { c: 'Attack1', sp: 1.1, xz: 'lock', hit: [[.5, .74]] },
      edash: { c: 'MoveAttack1_S', sp: 1.1, xz: 'lock', hit: [[.35, .85]], mv: { dash: 8, dashFrom: .25 } },
    } },
    // ---- ふわふわ飛ぶもの（Flying の Hover）: 風船・あくび ----
    drone: { set: 'flying', ref: 'Aerial_Idle', st: { ...J, idle: { c: 'Hover_Sideways', m: 'loop', xz: 'lock' }, walk: { c: 'Hover_Sideways', m: 'loop', xz: 'lock' }, walkU: { c: 'Hover_Sideways', m: 'loop', xz: 'lock' }, walkD: { c: 'Hover_Sideways', m: 'loop', xz: 'lock' } } },
    // ---- 退屈（超能力パックの残り）: 頭を抱えて立っている。ひざをついて念動の波、手で押しのける ----
    psy1: { set: 'superpower', ref: 'rescue:Combat_Idle', st: { ...E,
      idle:   { c: 'Super_Power_01', s: .9, e: 3.9, m: 'loop', xz: 'lock' },
      erange: { c: 'Super_Power_09', s: .3, e: 3.0, sp: 1.4, xz: 'lock', mv: { shot: { at: .42, spd: 5.6, dmg: 9, kb: 6, knock: 1, kind: 'wave' } } },
      eheavy: { c: 'Super_Power_11', s: .3, e: 2.6, sp: 1.4, xz: 'lock', hit: [[.6, 1.15]] },
    } },
    // ---- 超能力者その 2（中ボス）: 念動の波を 3 連発、雷の嵐は 7 本 ----
    esper2: { set: 'superpower', ref: 'rescue:Combat_Idle', st: { ...E,
      erange: { c: 'Super_Power_04', s: 3.6, e: 7.4, sp: 1.6, xz: 'lock', mv: { shot: null, burst: { at: .7, n: 3, gap: .36, spd: 6.6, dmg: 8, kb: 6, knock: 1, kind: 'wave' } } },
      eburst: { c: 'Super_Power_10', s: .6, e: 5.6, sp: 1.9, xz: 'lock', mv: { a: [9, 9], hits: null, around: 0, bolt: { at: .5, n: 7, delay: .9, gap: .2, r: .95, dmg: 10 } } },
    } },
    // ---- 5億年目の自分（5 面の大ボス）: 主人公と同じ構え・同じ技。気弾は最初から溜まっている ----
    selfp: { set: 'street', ref: 'Fight_Idle', lock: 1, st: { ...RUNS, ...FF,
      eheavy: { c: 'FightFist06_1', e: .85, sp: 1.0, hit: [[.14, .3]], mv: { launch: 7 } },                                                                    // アッパー
      ekf1:   { c: 'Kick_Combo03_1', e: 1.75, sp: 1.25, hit: [[.24, .37, { knock: 0, kb: .4, dmg: 4 }], [.47, .6, { knock: 0, kb: .4, dmg: 4 }], [1.05, 1.24]] },   // 蹴りの三連
      ekf2:   { c: 'Kick_Combo02_1', e: 1.3, sp: 1.15, hit: [[.27, .4, { knock: 0, kb: .4, dmg: 5 }], [.7, .88]] },                                           // 突進二段蹴り
      erange: { c: 'female:RangeAttack1', sp: 1.2, mv: { shot: { at: .55, spd: 10.5, dmg: 14, kb: 5, knock: 1, sc: 1.6, lv: 1 } } },                          // 溜まった気弾
      hurt: { c: 'female:LightHit', e: .5, sp: 1.5 }, knock: { c: 'female:Knockdown_S', e: .62 }, thrown: { c: 'female:JumpHitReact_S', m: 'loop', hips: 'air', fall: 1 },
      down: { c: 'female:Knockdown_S', s: .62, e: 1.32, sp: .8 }, dead: { c: 'female:Knockdown_S', s: 1.25, e: 1.32, sp: .1 }, getup: { c: 'female:Knockdown_S', s: 1.38, e: 2.2, sp: 1.5 },
      grabbed: { c: 'female:Choke', m: 'loop' }, stun: { c: 'female:Stunned', m: 'loop' },
    } },
  });
}
// ---- 見た目: 新しい敵の飾り（ロボの体に足す）----
function botLook345(spec, P) {
  const { box, mat, glow, dark, hd, up, chest, hips } = P, L = spec.look;
  const ball = (r, m, x, y, z, par) => { const me = new T.Mesh(new T.SphereGeometry(r, 12, 9), m); me.position.set(x, y, z); par.add(me); return me; };
  if (L === 'tie') { box(.08, .3, .025, mat(0xc8102a), 0, -.04, .2, up); box(.13, .08, .03, mat(0xc8102a), 0, .12, .2, up); box(.44, .06, .4, dark, 0, .41, 0, hd); }                       // ネクタイと七三分け
  if (L === 'cap') { box(.46, .14, .44, dark, 0, .47, 0, hd); box(.46, .03, .22, dark, 0, .41, .3, hd); box(.14, .08, .02, glow, 0, .48, .225, hd); box(.66, .05, .12, glow, 0, .2, 0, up); box(.06, .5, .03, glow, .12, -.1, .2, up); box(.06, .5, .03, glow, -.12, -.1, .2, up); }   // 車掌の帽子・金ボタン
  if (L === 'drunk') { box(.44, .07, .42, mat(0xc8102a), 0, .33, 0, hd); box(.07, .26, .025, mat(0xc8102a), .2, .18, .15, hd); box(.09, .06, .02, new T.MeshBasicMaterial({ color: 0xff6a8a }), .12, .12, .2, hd); box(.09, .06, .02, new T.MeshBasicMaterial({ color: 0xff6a8a }), -.12, .12, .2, hd); }   // 頭にネクタイ・赤いほっぺ
  if (L === 'ninja') { box(.43, .09, .41, glow, 0, .3, 0, hd); box(.05, .08, .3, glow, .1, .3, -.32, hd); box(.05, .08, .24, glow, -.08, .27, -.3, hd); box(.42, .16, .4, dark, 0, .08, 0, hd); box(.56, .1, .34, glow, 0, .22, 0, up); }   // はちまき・覆面・襟巻き
  if (L === 'bento') { box(.62, .05, .36, mat(0x8a5a2a), 0, 0, .36, chest); for (let i = 0; i < 3; i++) box(.16, .08, .22, mat([0xc8402a, 0xf4f0e2, 0x2f8f4f][i]), -.2 + i * .2, .06, .36, chest); box(.44, .1, .42, mat(0xf4f0e2), 0, .42, 0, hd); }   // 首から下げた売り箱・白い帽子
  if (L === 'mascot') { const w = mat(0xffffff); ball(.16, mat(spec.color), .2, .46, 0, hd); ball(.16, mat(spec.color), -.2, .46, 0, hd); ball(.09, w, .2, .46, .09, hd); ball(.09, w, -.2, .46, .09, hd); ball(.15, w, 0, .12, .2, hd); ball(.05, dark, 0, .16, .34, hd); box(.42, .34, .03, w, 0, .04, .2, chest); box(.3, .1, .05, mat(0xc8102a), 0, .2, .2, up); }   // 丸い耳・白いおなか・ちょうネクタイ
  if (L === 'clown') { ball(.08, new T.MeshBasicMaterial({ color: 0xff2030 }), 0, .2, .22, hd); const hat = new T.Mesh(new T.ConeGeometry(.2, .46, 10), mat(0x2f6fd0)); hat.position.set(0, .64, 0); hd.add(hat); ball(.07, glow, 0, .88, 0, hd); const ruff = new T.Mesh(new T.TorusGeometry(.26, .07, 6, 14), mat(0xffffff)); ruff.rotation.x = Math.PI / 2; ruff.position.set(0, .24, 0); up.add(ruff); for (let i = 0; i < 3; i++) ball(.05, mat([0xffe14a, 0x2be8c8, 0xff5aa8][i]), 0, .12 - i * .16, .2, i ? chest : up); }   // 赤い鼻・とんがり帽子・ひだ襟
  if (L === 'idol') { box(.22, .16, .06, glow, .13, .5, -.05, hd); box(.22, .16, .06, glow, -.13, .5, -.05, hd); box(.08, .1, .08, mat(0xffffff), 0, .5, -.05, hd); const sk = new T.Mesh(new T.CylinderGeometry(.3, .52, .3, 12, 1, true), new T.MeshLambertMaterial({ color: spec.accent, side: T.DoubleSide })); sk.position.set(0, -.08, 0); hips.add(sk); box(.2, .05, .02, glow, 0, .12, .2, up); }   // 大きなリボン・スカート
  if (L === 'zombie') { box(.2, .2, .03, dark, .12, .05, .2, chest); box(.16, .12, .03, dark, -.14, -.05, .19, up); box(.1, .1, .02, new T.MeshBasicMaterial({ color: 0xb8ff5a }), .1, .25, .2, hd); box(.3, .06, .3, dark, .06, .42, .02, hd); }   // やぶれた服・片目だけ光る
  if (L === 'fairy') { const wm = new T.MeshBasicMaterial({ color: spec.accent, transparent: true, opacity: .55, side: T.DoubleSide }); for (const sd of [1, -1]) { const w = new T.Mesh(new T.PlaneGeometry(.5, .7), wm); w.position.set(sd * .32, .16, -.24); w.rotation.y = sd * .7; up.add(w); } ball(.1, glow, 0, .5, 0, hd); box(.44, .05, .42, glow, 0, .42, 0, hd); }   // 羽・頭の飾り
  if (L === 'balloon') { const b = ball(.34, new T.MeshLambertMaterial({ color: spec.color, emissive: 0x3a0a10 }), 0, 1.15, 0, hd); b.scale.y = 1.2; box(.02, .6, .02, mat(0xffffff), 0, .68, 0, hd); box(.1, .1, .02, new T.MeshBasicMaterial({ color: 0xffffff }), .12, 1.28, .3, hd); }   // 頭の上の風船
  if (L === 'ghost') { box(.5, .5, .46, dark, 0, .22, -.05, hd).material = new T.MeshLambertMaterial({ color: 0x2a2c3c, transparent: true, opacity: .5 }); box(.1, .12, .02, glow, .1, .22, .2, hd); box(.1, .12, .02, glow, -.1, .22, .2, hd); box(.54, .74, .04, new T.MeshLambertMaterial({ color: spec.color, transparent: true, opacity: .45 }), 0, -.2, -.22, up); }   // 頭巾・うつろな目・うすい外套
}
function botHand345(spec, P, sd, ha) {
  const { box, mat, glow, dark } = P, L = spec.look;
  if (L === 'tie' && sd < 0) { box(.34, .24, .09, mat(0x5a3a1c), sd * .08, -.22, 0, ha); box(.14, .04, .03, dark, sd * .08, -.08, 0, ha); }          // かばん
  if (L === 'cap' && sd < 0) box(.07, .5, .07, glow, sd * .1, -.2, 0, ha);                                                                             // 合図灯
  if (L === 'drunk' && sd > 0) { box(.1, .3, .1, mat(0x2f6f3f), sd * .08, .1, 0, ha); box(.05, .1, .05, mat(0x2f6f3f), sd * .08, .3, 0, ha); }          // 一升びん
  if (L === 'idol' && sd < 0) { box(.05, .22, .05, dark, sd * .1, .08, 0, ha); box(.1, .1, .1, glow, sd * .1, .24, 0, ha); }                             // マイク
  if (L === 'fairy' && sd < 0) { box(.03, .5, .03, mat(0xffffff), sd * .1, .2, 0, ha); box(.14, .14, .04, glow, sd * .1, .5, 0, ha); }                   // 魔法の杖
  if (L === 'clown') box(.2, .2, .2, mat(0xffffff), sd * .08, 0, 0, ha);                                                                                // 白い手袋
  if (L === 'mascot') box(.26, .26, .26, mat(0xffffff), sd * .1, 0, 0, ha);                                                                             // 丸い手
}
// ---- 頭: 新しいタイプの大技。何かしたら true ----
function aiType345(e, A, c, sp, tgt, adx, adz, faceT) {
  // 怒り: 大ボスは体力が半分を切ると速くなる
  if (sp.rage && !e.raged && e.hp < e.maxhp * .5) {
    e.raged = 1; e.spd *= 1.22; e.cool = 0; e.inv = Math.max(e.inv, .8);
    banner(e.name, sp.clone ? '「…まだ 2億5000万年ある」' : sp.look === 'idol' ? '「アンコール、いくよ！」' : '「本日のダイヤは すべて白紙です」');
    sfx.warn(); shake(.5); wFlash = Math.max(wFlash, .4); pillarFx(e.x, e.z, 1.4, 7, .8, COL.red, .6); ringFx(e.x, .05, e.z, .4, 7, .6, COL.red, 'ground');
    for (const h of heroes()) if (h.alive && !h.out && Math.hypot(h.x - e.x, (h.z - e.z) * 1.4) < 2.4) applyHit(e, h, { dmg: 4, kb: 7, knock: 1, heavy: 1, dir: Math.sign(h.x - e.x) || 1, x: e.x, key: 'rage' });
    A.think = .6; return true;
  }
  // 駆け込み: 遠くにいても、同じ列に並んだら一気に走りこんでくる
  if (sp.rusher && adx > 3.2 && adx < 8.5 && adz < .4 && (e.rushCd || 0) <= 0 && Math.random() < (sp.boss ? .05 : .035)) {
    e.face = faceT; startMove(e, 'edash'); e.rushCd = sp.boss ? 3.2 : 4.5; e.cool = 1.6; A.think = .6;
    textFx(e.x, 2.2 * Math.min(1.4, e.scl), e.z, sp.boss ? '発車します!' : '駆け込み乗車!', COL.gold, 1.9, .8); sfx.alert();
    return true;
  }
  return false;
}
// =========================================================================================
// 3〜5 面のしかけ（2026-10-07）: 自動改札・コーヒーカップ・びっくり箱・ワープ床
// =========================================================================================
function buildGim345(L) {
  (L.gate || []).forEach((x, i) => addGate(x, i * 1.3));
  (L.spin || []).forEach(([x, z], i) => addSpin(x, z, i % 2 ? -1 : 1));
  (L.jack || []).forEach(([x, z], i) => addJack(x, z, i * 1.7));
  (L.warp || []).forEach(([x1, z1, x2, z2], i) => addWarp(x1, z1, x2, z2, i));
}
// ---- 自動改札: 開いているあいだは通れる。閉まった扉に突っこむと「ピンポーン」とはじかれる ----
function addGate(x, ph) {
  const g = new T.Group(); g.position.set(x, 0, 0); gimG.add(g);
  const sil = new T.MeshLambertMaterial({ color: 0xc2c8d4 }), dk = new T.MeshLambertMaterial({ color: 0x23252e });
  const ZS = [-2.3, -.9, .5, 1.95], lamps = [], flaps = [];
  for (const z of ZS) {
    gmesh(new T.BoxGeometry(.8, .7, .2), sil, 0, .35, z, g); gmesh(new T.BoxGeometry(.82, .05, .22), dk, 0, .72, z, g);
    const lp = gmesh(new T.BoxGeometry(.16, .05, .16), new T.MeshBasicMaterial({ color: 0x2bff8a }), .26, .76, z, g); lamps.push(lp);
    gmesh(new T.BoxGeometry(.22, .02, .14), new T.MeshBasicMaterial({ color: 0x4fa8ff }), -.2, .75, z, g);
  }
  for (let i = 0; i < ZS.length - 1; i++) {
    const zc = (ZS[i] + ZS[i + 1]) / 2, w = ZS[i + 1] - ZS[i] - .2;
    for (const sd of [-1, 1]) { const f = gmesh(new T.BoxGeometry(.06, .3, w / 2), new T.MeshLambertMaterial({ color: 0xf2f4f8, emissive: 0x303238 }), 0, .44, zc + sd * w / 4, g); f.userData = { z0: zc + sd * w / 4, zo: zc + sd * (w / 2 - .03), w }; flaps.push(f); }
    floorMesh(.9, .5, new T.MeshBasicMaterial({ transparent: true, map: canvasTex(128, 72, (c, cw, ch) => { c.fillStyle = 'rgba(255,255,255,.8)'; c.font = '900 50px "Noto Sans JP", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('IC', cw / 2, ch / 2 + 3); }) }), x - 1.1, .02, zc);
  }
  const warn = floorMesh(.9, 4.6, new T.MeshBasicMaterial({ color: 0xff2030, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, fog: false }), x, .03, -.15);
  const P = 5.4, S = { t: ph % P, shut: false, hit: new Map() };
  dangers.push({ x, z: -.15, rx: .55, rz: 9, on: () => S.t > 3.0, hero: true });
  gims.push({ update(dt) {
    S.t += dt; if (S.t >= P) S.t -= P;
    const t = S.t, shut = t > 3.6, k = shut ? Math.min(1, (t - 3.6) / .08) : t > 3.0 ? 0 : Math.max(0, 1 - t / .2);   // 開いている 3 秒 → 予告 0.6 秒 → 閉まる 1.8 秒
    for (const f of flaps) { f.position.z = f.userData.zo + (f.userData.z0 - f.userData.zo) * k; f.scale.z = .08 + .92 * k; }
    const red = t > 3.0; for (const l of lamps) l.material.color.setHex(red ? (Math.floor(gameTime * 10) % 2 ? 0xff2030 : 0x7a1018) : 0x2bff8a);
    warn.material.opacity = red && !shut ? .2 + .2 * Math.sin(gameTime * 24) : shut ? .16 : 0;
    if (shut && !S.shut && onScreen(x, 1)) sfx.clank();
    S.shut = shut;
    for (const [f, c] of S.hit) { if (c <= dt) S.hit.delete(f); else S.hit.set(f, c - dt); }
    if (!shut || !onScreen(x, 1.5)) return;
    for (const b of fighters) {
      if (S.hit.has(b) || !b.alive || b.out || b.pit || b.y > .95 || Math.abs(b.x - x) > .42 || (b.ai && b.ai.door) || downish(b.state)) continue;
      S.hit.set(b, .8);
      const dir = Math.sign(b.x - x) || -b.face;
      if (envHit(b, 6, { dir, kb: 5.5, launch: 4.2, x: x - dir * .2, eMul: 1.6 })) { sfx.beep(); textFx(b.x, 2.1, b.z, pick(['ピンポーン!', '残高不足!', 'タッチしてください']), COL.red, 1.9, .8); if (b.isPlayer || Math.random() < .3) say('gate', 1); }
    }
  } });
}
// ---- コーヒーカップ: 乗ると、ぐるぐる回される（痛くはないが、ねらいが定まらない）----
function addSpin(x, z, dir) {
  const R = 1.2, W = 1.7 * dir;
  const tex = canvasTex(256, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.translate(w / 2, h / 2);
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#ffd1e6' : '#fff6fb'; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 124, i * .7854, (i + 1) * .7854); c.fill(); }
    c.strokeStyle = '#ff5aa8'; c.lineWidth = 9; c.beginPath(); c.arc(0, 0, 119, 0, 7); c.stroke();
    c.fillStyle = '#ff5aa8'; for (let i = 0; i < 4; i++) { c.save(); c.rotate(i * 1.5708); c.beginPath(); c.moveTo(70, -22); c.lineTo(96, 0); c.lineTo(70, 22); c.lineTo(76, 0); c.fill(); c.restore(); }
  });
  const disc = floorMesh(R * 2, R * 2, new T.MeshBasicMaterial({ map: tex, transparent: true }), x, .022, z);
  const rim = gmesh(new T.TorusGeometry(R, .05, 6, 28), new T.MeshLambertMaterial({ color: 0xff5aa8, emissive: 0x4a1030 }), x, .05, z); rim.rotation.x = Math.PI / 2;
  const pole = new T.Group(); pole.position.set(x, 0, z); gimG.add(pole);
  gmesh(new T.CylinderGeometry(.05, .07, .5, 10), new T.MeshLambertMaterial({ color: 0xf2f4f8 }), 0, .25, 0, pole);
  const cup = gmesh(new T.CylinderGeometry(.2, .13, .2, 14, 1, true), new T.MeshLambertMaterial({ color: 0x7fe9ff, side: T.DoubleSide, emissive: 0x103040 }), 0, .6, 0, pole);
  const hd = gmesh(new T.TorusGeometry(.08, .025, 6, 12), new T.MeshLambertMaterial({ color: 0x7fe9ff }), .24, .6, 0, pole);
  gims.push({ update(dt) {
    disc.rotation.z -= W * dt; pole.rotation.y -= W * dt * 1.6;
    if (!onScreen(x, R + 1)) return;
    const a = W * dt, cs = Math.cos(a), sn = Math.sin(a);
    const turn = (o) => { const dx = o.x - x, dz = o.z - z; if (dx * dx + dz * dz > R * R) return false; o.x = x + dx * cs - dz * sn; o.z = clamp(z + dx * sn + dz * cs, Z_MIN, Z_MAX); return true; };
    for (const f of fighters) if (grounded(f) && f.state !== 'grabbed' && turn(f) && f.isPlayer && (f.spinT = (f.spinT || 0) + dt) > 2.2) { f.spinT = -6; say('spin', 1); }
    for (const it of items) if (turn(it)) it.g.position.set(it.x, it.g.position.y, it.z);
    for (const wp of gweapons) if (wp.y <= 0 && !(wp.vy > 0)) turn(wp);
  } });
}
// ---- びっくり箱: ガタガタ震えたあと、グローブが飛び出す。真上にいると打ち上げられる ----
function addJack(x, z, ph) {
  const g = new T.Group(); g.position.set(x, 0, z); gimG.add(g);
  const bx = gmesh(new T.BoxGeometry(.8, .1, .8), new T.MeshLambertMaterial({ map: canvasTex(128, 128, (c, w, h) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { c.fillStyle = (i + j) % 2 ? '#ffe14a' : '#ff5aa8'; c.fillRect(i * 32, j * 32, 32, 32); } c.fillStyle = '#12131c'; c.font = '900 84px "Dela Gothic One", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', w / 2, h / 2 + 6); }) }), 0, .05, 0, g);
  const arm = new T.Group(); g.add(arm);
  const spring = gmesh(new T.CylinderGeometry(.07, .07, 1, 8, 6, true), new T.MeshLambertMaterial({ color: 0xc2c8d4, wireframe: true }), 0, .5, 0, arm);
  const glove = gmesh(new T.SphereGeometry(.26, 14, 10), new T.MeshLambertMaterial({ color: 0xe02a2a, emissive: 0x4a0808 }), 0, 1.05, 0, arm); glove.scale.set(1, .85, 1);
  gmesh(new T.BoxGeometry(.3, .1, .3), new T.MeshLambertMaterial({ color: 0xffffff }), 0, .84, 0, arm);
  const warn = floorMesh(1.5, 1.2, addMatC(0xff3d6e, 0), x, .03, z);
  const P = 5.2, J = { t: ph % P, done: false };
  dangers.push({ x, z, rx: .6, rz: .5, on: () => J.t > 2.9 && J.t < 4.4, hero: true });
  gims.push({ update(dt) {
    J.t += dt; if (J.t >= P) { J.t -= P; J.done = false; }
    const t = J.t; let h = .02;
    if (t < 3.0) warn.material.opacity = 0;
    else if (t < 3.75) { warn.material.opacity = .25 + .25 * Math.sin(gameTime * 26); bx.position.x = Math.sin(gameTime * 70) * .03; bx.rotation.z = Math.sin(gameTime * 55) * .05; }
    else if (t < 4.35) { bx.position.x = 0; bx.rotation.z = 0; warn.material.opacity = 0; h = Math.min(1, (t - 3.75) / .07) * (1 + .12 * Math.sin((t - 3.75) * 30) * Math.exp(-(t - 3.75) * 7)); }
    else h = Math.max(.02, 1 - (t - 4.35) / .3);
    arm.scale.y = Math.max(.02, h * 1.55); arm.visible = h > .03;
    if (t >= 3.75 && !J.done) {
      J.done = true; if (!onScreen(x, 1.5)) return;
      sfx.jump(); sfx.swing(2); ringFx(x, .05, z, .2, 1.6, .3, COL.pink, 'ground');
      for (const b of fighters) {
        if (!b.alive || b.out || b.pit || Math.hypot(b.x - x, (b.z - z) * 1.3) > .66 + .1 * (b.scl - 1) || b.y > 1.9 || (b.ai && b.ai.door)) continue;
        if (envHit(b, 9, { launch: 10, kb: 2.5, x })) { textFx(b.x, 2.3, b.z, 'ビヨーン!', COL.pink, 2.1, .7); if (b.isPlayer || Math.random() < .3) say('jack', 1); }
      }
    }
  } });
}
// ---- ワープ床: 踏むと、対になった床へ飛ばされる ----
function addWarp(x1, z1, x2, z2, i) {
  const col = [0x9d7bff, 0x4fa8ff, 0x2be8c8, 0xff5aa8, 0xffce4a][i % 5], c3 = hex3(col);
  const tex = canvasTex(128, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.translate(w / 2, h / 2); c.strokeStyle = '#fff'; c.lineWidth = 5;
    for (let k = 0; k < 3; k++) { c.beginPath(); for (let a = 0; a < 5.2; a += .15) { const r = 8 + a * 9; c[a ? 'lineTo' : 'moveTo'](Math.cos(a + k * 2.094) * r, Math.sin(a + k * 2.094) * r); } c.stroke(); }
    c.beginPath(); c.arc(0, 0, 58, 0, 7); c.stroke();
  });
  const pads = [[x1, z1], [x2, z2]].map(([x, z]) => {
    const m = floorMesh(1.1, 1.1, new T.MeshBasicMaterial({ map: tex, color: col, transparent: true, depthWrite: false, fog: false }), x, .024, z);
    const gl = floorMesh(2.2, 1.8, addMatC(col, .3), x, .03, z);
    return { x, z, m, gl };
  });
  const cd = new Map();
  gims.push({ update(dt) {
    for (const p of pads) { p.m.rotation.z += dt * 1.6; p.gl.material.opacity = .22 + .12 * Math.sin(gameTime * 4 + p.x); if (Math.random() < .25 && onScreen(p.x, 1)) flow.add(p.x + rnd(-.4, .4), .05, p.z + rnd(-.3, .3), 0, rnd(.6, 1.6), 0, rnd(.5, 1), .08, .01, c3[0] * 1.2, c3[1] * 1.2, c3[2] * 1.2, .7, 1.2, 1.2, 1); }
    for (const [f, c] of cd) { if (c <= dt) cd.delete(f); else cd.set(f, c - dt); }
    for (const f of fighters) {
      if (cd.has(f) || !grounded(f) || f.state === 'grabbed' || downish(f.state) || f.duo || (f.spec && (f.spec.boss || f.spec.mid))) continue;
      for (let k = 0; k < 2; k++) {
        const a = pads[k], b = pads[1 - k];
        if (Math.hypot(f.x - a.x, (f.z - a.z) * 1.2) > .42 || !onScreen(b.x, -.7)) continue;
        const fxW = (x, z) => { ringFx(x, 1.0, z + .2, .2, 1.7, .3, c3, 'cam'); pillarFx(x, z, .5, 3.2, .35, c3, .5); for (let n = 0; n < 18; n++) flow.add(x + rnd(-.3, .3), rnd(.1, 1.8), z, rnd(-1.5, 1.5), rnd(0, 2.5), rnd(-.5, .5), rnd(.4, .8), .1, .01, c3[0] * 1.3, c3[1] * 1.3, c3[2] * 1.3, .85, 2.2, 1.2, 2); };
        fxW(f.x, f.z); if (f.victim) releaseGrab(f); f.x = b.x; f.z = b.z; f.vx = f.vz = 0; fxW(f.x, f.z); cd.set(f, 2.4); sfx.blink();
        if (f.isPlayer) { textFx(f.x, 2.2, f.z, 'ワープ!', c3, 1.8, .7); say('warp', 1); }
        break;
      }
    }
  } });
}
// ---- 3〜5 面（2026-10-07）----
// gimSkin = しかけの見た目の差しかえ（駅弁ワゴン・コースターなど）
STAGES.push(
  { name: '5億年駅', theme: 'station', intro: '電車から敵が降りてくる。黄色い線の内側で戦え！', clear: '5億年駅を 定刻で発車した！', par: 400, minions: ['commuter', 'rusher', 'ninja'],
    areas: [
      { lock: 8,  waves: [['commuter', 'commuter', 'rusher'], ['commuter', 'bento', 'ninja']] },
      { lock: 27, waves: [['drunk', 'rusher', 'sniper'], ['mid5', 'commuter']] },                        // 中ボス 1（駆け込み乗車の常習）
      { lock: 46, waves: [['ninja', 'bento', 'commuter', 'rusher'], ['drunk', 'sniper', 'ninja', 'bento']] },
      { lock: 63, waves: [['drunk', 'rusher', 'sniper'], ['mid6', 'ninja']] },                           // 中ボス 2（キセル忍者）
      { lock: 80, boss: 1, waves: [['boss3', 'commuter']] },                                             // 大ボス（ダイヤの乱れ）
    ],
    armed: .26, eweapons: ['umbrella', 'umbrella', 'pipe'],
    weapons: [[3.5, 1.2, 'umbrella'], [10, -1.4, 'trash'], [15.5, .8, 'stone'], [23.5, -1.1, 'umbrella'], [29.5, 1.3, 'bat'], [35, -.5, 'knuckle'], [42, .9, 'umbrella'], [48, -1.5, 'trash'], [53.5, 1.4, 'stone'], [59.5, -1.0, 'pipe'], [65.5, .5, 'umbrella'], [71.5, -1.3, 'stone'], [77, 1.3, 'knuckle'], [82, -1.5, 'umbrella'], [84, .8, 'trash']],
    props: [[13, 1.4, 'onigiri'], [19.5, -1.4, 'coin'], [25.5, .3, 'bat'], [33, 1.3, 'ramen'], [38.5, -1.2, 'coin'], [52, 1.3, 'onigiri'], [56.5, -1.3, 'coin'], [64, -.3, 'pipe'], [69.5, 1.2, 'ramen'], [73.5, -.6, 'coin'], [75.5, .9, 'ramen']],
    gim: { vend: [14.2, 52.8, 72.2], belt: [[30.5, 40.5, -1.95, -.75, 1], [49.5, 59.5, .55, 1.8, -1]], gate: [17.5, 43.4, 66.4], banana: [[11.5, .8], [36, -1.3], [57.5, .2], [76, 1.2]], truck: { from: 1, every: [14, 20] }, button: [[61, -1.2]] },
    gimSkin: { vendY: 0, truckText: '駅弁 5億円', truckShout: 'べんと〜!', truckCol: 0xc8402a } },
  { name: '5億年ランド', theme: 'park', intro: '閉園後の遊園地。踊っているやつは、だいたい敵！', clear: '5億年ランドを 閉園させた！', par: 480, minions: ['dancer', 'balloon', 'zombie'],
    areas: [
      { lock: 8,  waves: [['dancer', 'dancer', 'balloon'], ['clown', 'zombie', 'dancer']] },
      { lock: 27, waves: [['mascot', 'fairy', 'balloon'], ['mid7', 'zombie']] },                         // 中ボス 1（着ぐるみの本体）
      { lock: 46, waves: [['zombie', 'zombie', 'clown', 'fairy'], ['mascot', 'dancer', 'balloon', 'clown']] },
      { lock: 63, waves: [['fairy', 'dancer', 'zombie', 'balloon'], ['mid8', 'dancer', 'dancer']] },     // 中ボス 2（絶叫担当）
      { lock: 80, boss: 1, waves: [['boss4', 'dancer', 'dancer']] },                                     // 大ボス（永遠のアイドル）
    ],
    armed: .22, eweapons: ['mallet', 'mallet', 'stick'],
    weapons: [[3, -1.2, 'mallet'], [9.5, 1.4, 'stone'], [15, -.9, 'trash'], [22, 1.1, 'mallet'], [29, -1.5, 'bat'], [35.5, .8, 'knuckle'], [42.5, -1.0, 'mallet'], [48, 1.5, 'trash'], [54.5, -.6, 'stone'], [60, 1.2, 'mallet'], [66.5, -1.4, 'pipe'], [72, .7, 'stone'], [77.5, -1.5, 'knuckle'], [82, 1.3, 'mallet'], [84, -.7, 'trash']],
    props: [[13.5, -1.5, 'onigiri'], [19, 1.3, 'coin'], [25, -.2, 'bat'], [33.5, -1.3, 'ramen'], [39, 1.3, 'coin'], [52.5, -1.4, 'onigiri'], [57, 1.2, 'coin'], [65, .2, 'pipe'], [69, -1.3, 'ramen'], [73, .8, 'ramen'], [75, -.5, 'coin']],
    gim: { vend: [12.6, 50.2, 70.6], spin: [[10.4, -.3], [29.6, .4], [47.4, -.4], [64.6, .3]], jack: [[6.4, 1.2], [24.2, -1.3], [31.8, -1.3], [43, 1.2], [50.4, 1.1], [60.4, -1.3], [77, 1.1], [83.6, -1.2]],
      banana: [[16.5, .4], [38, -.8], [56, 1.1], [72.5, -.3]], truck: { from: 1, every: [13, 19] }, button: [[36.2, 1.3]] },
    gimSkin: { truckText: '絶叫コースター', truckShout: 'キャーー!', truckCol: 0xd03a8a } },
  { name: '何もない空間', theme: 'void', intro: 'ボタンを押した先。何もない。敵は、自分の気持ち。', clear: '5億年を 乗りこえた！　100万円 ゲット！', par: 520, minions: ['memory', 'lonely', 'yawn'],
    areas: [
      { lock: 8,  waves: [['bored', 'memory', 'memory'], ['lonely', 'counter', 'bored']] },
      { lock: 27, waves: [['regret', 'yawn', 'lonely'], ['mid9', 'memory']] },                           // 中ボス 1（数えるのをやめた人）
      { lock: 46, waves: [['lonely', 'lonely', 'counter', 'yawn'], ['regret', 'bored', 'memory', 'counter'], ['yawn', 'yawn', 'lonely', 'bored']] },
      { lock: 63, waves: [['regret', 'counter', 'lonely', 'yawn'], ['mid10', 'bored']] },                // 中ボス 2（悟り・未遂）
      { lock: 80, boss: 1, waves: [['boss5']] },                                                         // 大ボス（5億年目の自分）
    ],
    armed: .2, eweapons: ['clockhand', 'pipe'],
    weapons: [[3.5, 1.3, 'clockhand'], [10.5, -1.5, 'stone'], [16, .9, 'trash'], [23.5, -1.0, 'clockhand'], [30, 1.4, 'bat'], [35.5, -.6, 'knuckle'], [42.5, .8, 'clockhand'], [48.5, -1.5, 'stone'], [56, 1.5, 'trash'], [60, -1.0, 'clockhand'], [66, .4, 'stone'], [72.5, -1.3, 'pipe'], [77.5, 1.4, 'knuckle'], [82.5, -1.6, 'clockhand'], [84, .9, 'stone']],
    props: [[14, -1.6, 'onigiri'], [20, 1.2, 'coin'], [26, .2, 'bat'], [33, -1.2, 'ramen'], [39, 1.4, 'coin'], [53, -1.5, 'onigiri'], [57, 1.0, 'coin'], [64, -.2, 'pipe'], [70, 1.0, 'ramen'], [73, -.9, 'ramen'], [74, .3, 'onigiri'], [75.5, -.4, 'coin']],
    gim: { warp: [[5.6, 1.2, 11, -1.4], [23, -1.3, 31, 1.2], [42, 1.3, 50.4, -1.3], [59, -1.2, 67, 1.2], [76, 1.2, 84, -1.2]], crusher: [[9.6, .3], [26.4, 1.0], [44.8, -.3], [48.4, 1.1], [62.4, -1.2], [65.4, .3], [79.8, -1.2]],
      button: [[7.6, -1.4], [28.6, -.3], [47, .3], [63.6, 1.4], [81.6, .5]], vend: [19, 55.6] },
    gimSkin: { vendY: 0, crushText: '5億年' } },
);
Object.assign(WEAPONS, {
  umbrella:  { name: '傘',             dmg: [9, 10, 15],  reach: 1.6,  uses: 9,  thr: 11, len: 1.0,  snd: 'wood', word: 'wood', col: 0x2f6fd0 },
  mallet:    { name: 'ピコピコハンマー', dmg: [7, 7, 12],   reach: 1.45, uses: 12, thr: 9,  len: .86,  snd: 'can',  word: 'pico', col: 0xff3d6e, bash: 1 },   // 弱いが、当たれば必ず吹っ飛ぶ
  clockhand: { name: '時計の針',       dmg: [13, 14, 23], reach: 1.75, uses: 12, thr: 16, len: 1.3,  snd: 'pipe', word: 'metal', col: 0xd8dce8 },              // 長くて重い
});
WORDS.pico = ['ピコ!', 'ピコッ', 'ピコーン!'];
// 相棒のセリフ（性格ごとの言い回しが無いものは、元気な子の言い方で代用される）
Object.assign(LINES.genki, {
  gate:   ['改札は開いてから通りなさいよ！', '残高、足りてる？', 'ピンポーンって鳴ってるわよ'],
  spin:   ['目が回る〜！', 'コーヒーカップ、回しすぎ！', 'ぐるぐるぐる…'],
  jack:   ['びっくり箱よ、上に乗らないで！', 'ビヨーンって飛んだわね', '箱が震えたら離れて！'],
  warp:   ['ワープした！', 'その床、つながってるのね', 'どこでも行けるじゃない…この中なら'],
  stage2: ['工場ね。ボタンには触らないでよ…絶対よ', '次は工場！ 足もと気をつけて'],
  stage3: ['駅ね。電車から敵が降りてくるわよ！', '黄色い線の内側で戦うのよ', '改札は開いてから通ってよね'],
  stage4: ['遊園地…もう閉園してるはずなのに', '踊ってるやつは、だいたい敵！', 'びっくり箱の上には乗らないで！'],
  stage5: ['ここが…ボタンを押した先', '何もない…のに、敵はいるのね', 'あと 5億年、いっしょにがんばろ'],
  self:   ['あれ…あんたにそっくりじゃない！', '自分に勝つって、こういう意味だっけ', '5億年たつと、ああなるの…？'],
});
Object.assign(LINES.oshitoyaka, {
  stage3: ['駅ですね。電車から敵が降りてきます', '黄色い線の内側で戦いましょうね'],
  stage4: ['遊園地…もう閉園しているはずですのに', '踊っている方は、だいたい敵です'],
  stage5: ['ここが…ボタンを押した先なのですね', 'あと 5億年、ごいっしょします'],
  self:   ['あら…あなたにそっくりです…', '5億年たつと、ああなってしまうのですか…？'],
});
Object.assign(LINES.cool, {
  stage3: ['駅か。敵は電車のドアから来る', '改札は開いてから通れ。データは取った'],
  stage4: ['閉園後の遊園地だ。踊っている個体は敵と見ていい', 'びっくり箱の周期は 5.2 秒だ'],
  stage5: ['何もない空間だ。興味深い', '残り 5億年。計算上、勝てる'],
  self:   ['…君と同じ骨格だ。5億年後の君だな', '自分自身が相手か。実験としては最高だ'],
});
Object.assign(LINES.tonio, {
  stage3: ['えきでちゅ！ でんしゃでちゅ！', 'きいろいせんの うちがわでちゅ'],
  stage4: ['ゆうえんちでちゅ！ のりたいでちゅ！', 'おどってるのは てきでちゅ'],
  stage5: ['なんにもないでちゅ…', '5おくねん がんばるでちゅ'],
  self:   ['そっくりでちゅ！？', 'じぶんと たたかうでちゅか…'],
});
// =========================================================================================
// 5 面クリアのあとの大演出（2026-10-07）
// 流れ: ① 満了のお知らせ → ② 賞金 100万円の授与（経費を引かれて、最後は請求書）→ ③ 出演者そろって踊る → ④ 記憶を消されて、またボタンを押す
// 主人公は h.fin を持っている間、いつもの動き（updateFighter）を止めて、ここから動かす。出演者は「戦う人」ではない、見た目だけの人形
// =========================================================================================
let voidFx = null;   // 何もない空間の「のこり年数」の板と巨大ボタン（buildVoid が入れる）
PROFILES.finale = { set: 'street', ref: 'Fight_Idle', lock: 1, st: {
  idle: { c: 'Fight_Idle', m: 'loop' }, fdance: { c: 'dance:Thriller', s: 4.5, e: 19.5, m: 'loop', xz: 'lock' },
  run: { c: 'Sprint_1', m: 'loop', nat: 6.5 }, stun: { c: 'male:Stunned', m: 'loop' },
} };
Object.assign(LINES.genki, {
  finHeavy: ['お、重っ…！ 100万円って重いのね！'], finPay: ['さ、37円…？'], finBill: ['赤字じゃないの！！', '5億年はたらいて、請求書…？'],
  finWho: ['……あれ？ あたしたち、何してたんだっけ'], finBtn: ['ねえ見て、ボタンがあるわよ。「押すと 100万円」だって！'], finPush: ['押しちゃえ押しちゃえ！'],
});
Object.assign(LINES.oshitoyaka, {
  finHeavy: ['お、重いです… 100万円…'], finPay: ['さ、37円…ですか？'], finBill: ['あの…これは赤字、ですよね…？'],
  finWho: ['……あら？ 私たち、何をしていたのでしょう'], finBtn: ['見てください、ボタンがあります。「押すと 100万円」だそうです'], finPush: ['押して…みましょうか'],
});
Object.assign(LINES.cool, {
  finHeavy: ['…1万円札 100枚は、約 100グラムのはずだが'], finPay: ['37円。計算は合っている'], finBill: ['収支はマイナス 403円だ。理不尽だな'],
  finWho: ['……記憶が空だ。何をしていた？'], finBtn: ['ボタンがある。「押すと 100万円」。期待値はプラスだ'], finPush: ['押してみよう。失うものはない'],
});
Object.assign(LINES.tonio, {
  finHeavy: ['おもいでちゅ〜！'], finPay: ['37えんでちゅか…？'], finBill: ['あかじでちゅ！！'],
  finWho: ['……あれ？ なにしてたでちゅか？'], finBtn: ['ボタンでちゅ！ 100まんえんでちゅ！'], finPush: ['おすでちゅ！'],
});

const FIN_NOTE = (n) => 261.63 * Math.pow(2, n / 12);   // ド（C4）から半音いくつ上か → 周波数
// 場内アナウンスの字幕（VR では、目の前の板に出す）
function finCap(text, vrBig) {
  const el = $('finCap'); el.textContent = text || ''; el.classList.toggle('on', !!text);
  if (text) VRH.ban = { big: vrBig || 'お知らせ', sub: text, t: 4.5 };
}
function finChime() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { tone('sine', f, 0, 1.5, .34, master, i * .34); tone('triangle', f * 2, 0, .9, .07, master, i * .34); }); }
function finMusicStop(F, fade = .04) {
  if (!F.mus) return;
  const o = F.mus; F.mus = null;
  try { o.gain.setTargetAtTime(0.0001, ac().currentTime, fade); } catch (e) {}
  setTimeout(() => { try { o.disconnect(); } catch (e) {} }, 900);
}
// 音楽（ブラウザの発振器だけで鳴らす）: hero = 表彰式の曲（ヘンデル「見よ、勇者は帰る」）/ cancan = 運動会の曲（オッフェンバック「天国と地獄」）。どちらも著作権の切れた曲
function finMusic(F, name) {
  finMusicStop(F);
  const c = ac(), out = c.createGain(); out.gain.value = 1; out.connect(master); F.mus = out;
  const N = (type, n, when, dur, vol) => tone(type, FIN_NOTE(n), 0, dur, vol, out, when);
  if (name === 'hero') {
    const A = [[7, 2], [4, 1.5], [5, .5], [7, 2], [0, 2], [2, .5], [4, .5], [5, .5], [7, .5], [5, 1], [4, 1], [2, 3], [null, 1]];
    const B = [[4, .5], [5, .5], [7, .5], [9, .5], [7, 1], [12, 1], [11, .5], [9, .5], [7, .5], [5, .5], [4, 1], [2, 1], [0, 3], [null, 1]];
    const bt = .33; let t = .05;
    for (const ph of [A, B, A, B]) for (const [n, b] of ph) {
      if (n != null) { N('triangle', n + 12, t, b * bt * 1.25 + .1, .2); N('sine', n + 24, t, b * bt + .05, .05); }
      t += b * bt;
    }
    for (let i = 0, tb = .05; tb < t - .5; i++, tb += bt * 2) N('sine', i % 2 ? -17 : -12, tb, bt * 1.9, .2);
  } else {
    const M = [[0, 2], [0, 2], [2, 1], [5, 1], [4, 1], [2, 1], [7, 2], [7, 2], [9, 1], [4, 1], [5, 1], [2, 1], [2, 2], [2, 2], [5, 1], [4, 1], [2, 1], [0, 1], [12, 1], [11, 1], [9, 1], [7, 1], [5, 1], [4, 1], [2, 1], [0, 1]];
    const root = [0, -5, 0, -7, -5, -5, 0, -5], u = .15; let t = .05;
    for (const key of [0, 2, 4, 5]) {   // くり返すたびに、調が上がっていく
      const t0 = t;
      for (const [n, b] of M) { N('square', n + key + 12, t, b * u * .92, .085); N('triangle', n + key + 24, t, b * u * .7, .05); t += b * u; }
      for (let k = 0; k < 32; k++) {   // ズン・チャ・ズン・チャ
        const tb = t0 + k * u, r = root[k >> 2] + key;
        if (k % 2 === 0) N('triangle', r - 12, tb, u * 1.7, .2); else { N('square', r + 4, tb, u * .5, .035); N('square', r + 7, tb, u * .5, .035); }
      }
    }
  }
}

// 頭のてっぺんの高さ（VRM は頭の骨から。ロボは体の大きさから）
const _finV = new T.Vector3();
function finTop(f, out) {
  const b = f.body && f.body.rawBone && f.body.rawBone('head');
  if (b && f.body.vrm) { b.updateWorldMatrix(true, false); _finV.setFromMatrixPosition(b.matrixWorld); if (out) out.set(_finV.x, 0, _finV.z); return _finV.y + .17; }
  if (out) out.set(f.x, 0, f.z);
  return (f.y || 0) + 1.72 * f.scl * (f.flat > 0 ? .25 : 1);
}
const _finH = new T.Vector3();
function finDispose(o) { o.traverse((m) => { if (m.geometry) m.geometry.dispose(); for (const mt of [].concat(m.material || [])) { if (mt.map && mt.map !== radialTex && mt.map !== shadowTex) mt.map.dispose(); mt.dispose(); } }); }
function finConfetti(x, y, z, n, sp = 4) {
  for (let i = 0; i < n; i++) { const c = pick([COL.teal, COL.gold, COL.pink, COL.white, COL.orange]), a = rnd(0, 6.283), v = rnd(.5, sp); glow.add(x, y, z, Math.cos(a) * v, rnd(-.5, sp * .8), Math.sin(a) * v * .5, rnd(1.4, 2.6), rnd(.09, .16), .04, c[0] * 1.4, c[1] * 1.4, c[2] * 1.4, .95, 2.6, .9); }
}

// ---- 出演者（見た目だけ）----
function finActor(F, spec, body, x, z) {
  const sh = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.visible = false; scene.add(sh);
  body.root.visible = false; scene.add(body.root);
  const a = { id: 0, name: spec.name || '', x, y: 0, z, vx: 0, vy: 0, vz: 0, face: 1, state: 'idle', t: 0, inv: 0, flash: 0, flat: 0, pit: null, ai: null, duo: null, move: null, fast: false, gspd: 0, walkPh: 0,
    spec, scl: spec.scale || 1, body, sh, alive: true, out: false, team: 'enemy', hp: 1, maxhp: 1, fin: { ent: null, yaw: null }, mode: 'wait', wait: 0, tx: x, tz: z, gone: false, show: false };
  F.cast.push(a); return a;
}
// 5 つの面から、大ボス・中ボス（うしろの列）と雑魚（まんなかの列）を集める
function finCastPlan(F) {
  const back = [], mid = [];
  for (const S of STAGES) {
    const seen = new Set(); let nm = 0, nb = 0;
    for (const A of S.areas) for (const w of A.waves) for (const t of w) {
      const sp = ENEMIES[t]; if (!sp || seen.has(t) || sp.clone) continue; seen.add(t);
      if (sp.boss || sp.mid) { if (sp.boss || nb < 1) { back.push(t); if (!sp.boss) nb++; } }
      else if (nm < 2) { mid.push(t); nm++; }
    }
  }
  const X = F.X, plan = [];
  back.slice(0, 9).forEach((t, i, L) => plan.push([t, X + (i - (L.length - 1) / 2) * 1.42, -1.95]));
  mid.slice(0, 9).forEach((t, i, L) => plan.push([t, X + (i - (L.length - 1) / 2) * 1.2, -.75]));
  return plan;
}
// 1 フレームに 1 体ずつ作る（いっぺんに作ると、一瞬止まるので）
function finCastMake(F) {
  if (!F.plan) F.plan = finCastPlan(F);
  const p = F.plan.shift(); if (!p) return;
  const [type, tx, tz] = p, spec = ENEMIES[type], left = tx < F.X;
  let body; try { body = new BotBody(spec, false); } catch (e) { log('finale: ' + type + ' を作れません ' + e.message); return; }
  if (F.lib) body.setLib(F.lib);
  const a = finActor(F, spec, body, F.X + (left ? -1 : 1) * (11 + Math.abs(tx - F.X) * .4), tz);
  a.tx = tx; a.tz = tz; a.face = left ? 1 : -1; a.wait = Math.abs(tx - F.X) * .09 + (tz > -1 ? .35 : 0); a.boss = !!spec.boss;
  if (!F.plan.length && G.cloneLive && G.cloneLive.vrm && !fighters.some(f => f.body === G.cloneLive)) {   // 最後に、5億年目の自分
    const c = finActor(F, ENEMIES.boss5 || { name: '5億年目の自分', scale: 1 }, G.cloneLive, F.X + 12, 1.0);
    c.tx = F.X; c.tz = 1.05; c.face = -1; c.wait = .9; c.clone = true; c.boss = true;
  }
}
function finCastTick(F, dt) {
  const L = F.lib;
  for (const a of F.cast) {
    if (a.gone || a.mode === 'wait') continue;
    a.t += dt; a.flat = Math.max(0, a.flat - dt); a.flash = Math.max(0, a.flash - dt);
    if (a.mode === 'in') {
      a.wait -= dt;
      if (a.wait <= 0) {
        a.show = true;
        const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz), st = 8.5 * dt;
        if (d <= st) { a.x = a.tx; a.z = a.tz; a.mode = 'stand'; a.fin.yaw = 0; a.state = 'idle'; a.fast = false; }
        else { a.x += dx / d * st; a.z += dz / d * st; a.face = dx > 0 ? 1 : -1; a.state = 'walk'; a.fast = true; a.gspd = 8.5; a.walkPh += dt * 16; a.fin.yaw = null; }
      }
    }
    if (a.mode === 'in') a.fin.ent = L ? L.ent.run || null : null;
    else if (a.mode === 'stand') { if (F.dance && L && L.ent.fdance) { a.fin.ent = L.ent.fdance; a.body.loopT = F.dT; } else a.fin.ent = L ? L.ent.idle || null : null; }
    else if (a.mode === 'win') { a.fin.ent = null; a.state = 'win'; }
    else if (a.mode === 'stun') { a.fin.ent = L ? L.ent.stun || null : null; a.state = 'stun'; }
    a.body.sync(a, dt);
    a.body.root.visible = a.show; a.sh.visible = a.show;
    const s = a.scl * .95; a.sh.scale.set(s * 1.05, s * .6, 1); a.sh.position.set(a.x, .012, a.z);
  }
}
function finCastPoof(F, a) {
  if (a.gone) return; a.gone = true;
  scene.remove(a.sh); scene.remove(a.body.root);
  if (a.clone) { a.body.root.visible = false; if (G.cloneOf === (G.p1Char && G.p1Char.vrm)) G.cloneBody = a.body; G.cloneLive = null; }   // 分身の体は、次の回でまた使う
  if (!a.show) return;
  const h = 1.0 * a.scl;
  for (let i = 0; i < 16; i++) { const an = rnd(0, 6.283), v = rnd(.6, 2.6); glow.add(a.x, h + rnd(-.5, .5), a.z, Math.cos(an) * v, rnd(.2, 2.4), Math.sin(an) * v * .4, rnd(.5, 1.1), rnd(.12, .22), .02, .8, .86, 1, .85, -.6, 1.5); }
  smoke.add(a.x, h, a.z, 0, .6, 0, .6, .5 * a.scl, 1.3 * a.scl, .8, .84, 1, .5);
}

// ---- くす玉 ----
function finKusudama(F) {
  const g = new T.Group(); g.position.set(F.X - 1.75, 8.2, -1.2); F.g.add(g);
  const gold = new T.MeshLambertMaterial({ color: 0xffc23a, emissive: 0x7a5208, side: T.DoubleSide });
  const half = (ph) => { const p = new T.Group(); p.position.y = .52; const m = new T.Mesh(new T.SphereGeometry(.52, 20, 14, ph, Math.PI), gold); m.position.y = -.52; p.add(m); g.add(p); return p; };
  const L = half(-Math.PI / 2), R = half(Math.PI / 2);
  gmesh(new T.CylinderGeometry(.015, .015, 6, 5), new T.MeshBasicMaterial({ color: 0xd8dce8 }), 0, 3.5, 0, g);
  const bg = new T.PlaneGeometry(.6, 1.9); bg.translate(0, -.95, 0);
  const ban = new T.Mesh(bg, new T.MeshBasicMaterial({ side: T.DoubleSide, fog: false, map: canvasTex(128, 400, (c, w, h) => {
    c.fillStyle = '#fffdf2'; c.fillRect(0, 0, w, h); c.strokeStyle = '#c8102e'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = '#c8102e'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '400 62px "Dela Gothic One", "Noto Sans JP", sans-serif';
    [...'祝5億年完走'].forEach((ch, i) => c.fillText(ch, w / 2, 44 + i * 63));
  }) }));
  ban.position.set(0, .3, 0); ban.scale.y = .02; ban.visible = false; g.add(ban);
  F.kusu = { g, L, R, ban, open: -1, ty: 3.5 };
}
function finKusuOpen(F) {
  const K = F.kusu; if (!K || K.open >= 0) return;
  K.open = 0; K.ban.visible = true;
  sfx.lucky(); burst(1800, .8, .12, .9); finConfetti(K.g.position.x, K.g.position.y, K.g.position.z + .2, 90, 4.5);
  textFx(K.g.position.x + .9, K.g.position.y + .25, K.g.position.z, 'パカッ', COL.gold, 1.6, .8);
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; streaks.add(K.g.position.x, K.g.position.y, K.g.position.z, Math.cos(a) * 7, Math.sin(a) * 7, 0, .3, .12, .03, 1, .85, .3, 4, 2); }
}
// ---- 札束（24 束 = 100万円。経費を引かれるたびに飛んでいく）----
function finPile(F, on) {
  const g = new T.Group(); F.g.add(g);
  const side = new T.MeshLambertMaterial({ color: 0xf2efe2, emissive: 0x3a382e });
  const top = new T.MeshLambertMaterial({ emissive: 0x30302a, map: canvasTex(128, 64, (c, w, h) => {
    c.fillStyle = '#e9e2c2'; c.fillRect(0, 0, w, h); c.strokeStyle = '#7a6a3a'; c.lineWidth = 4; c.strokeRect(5, 5, w - 10, h - 10);
    c.fillStyle = '#7a6a3a'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 30px "Noto Sans JP", sans-serif'; c.fillText('5億年銀行', w / 2, h / 2 + 2);
    c.fillStyle = '#c8102e'; c.fillRect(w * .44, 0, w * .12, h);
  }) });
  const geo = new T.BoxGeometry(.4, .11, .2), bills = [];
  for (let i = 0; i < 24; i++) { const m = new T.Mesh(geo, [side, side, top, side, side, side]); m.position.set((i % 4 - 1.5) * .42, .06 + Math.floor(i / 8) * .115, (Math.floor(i / 4) % 2 - .5) * .22); g.add(m); bills.push(m); }
  const coin = new T.Mesh(new T.CylinderGeometry(.13, .13, .03, 20), new T.MeshLambertMaterial({ color: 0xc98a3a, emissive: 0x5a3a10 })); coin.visible = false; coin.position.y = .16; coin.rotation.x = Math.PI / 2; g.add(coin);
  F.pile = { g, on, y: 7.5, vy: 0, landed: false, bills, coin };
  g.position.set(on.x, 7.5, on.z);
}
function finPileDrop(F, n) {   // n 束、明細書のほうへ飛んでいく
  const P = F.pile; if (!P) return;
  for (let i = 0; i < n && P.bills.length; i++) {
    const m = P.bills.pop(); m.getWorldPosition(_finV); F.g.add(m); m.position.copy(_finV);
    F.fly.push({ m, vx: rnd(5, 10), vy: rnd(3.5, 7), vz: rnd(-1.5, .5), t: -i * .035, w: rnd(6, 14) });
  }
}
// ---- ミラーボールと照明 ----
function finLights(F) {
  const g = new T.Group(); F.g.add(g);
  const ball = new T.Mesh(new T.IcosahedronGeometry(.42, 1), new T.MeshLambertMaterial({ color: 0xe6ecff, emissive: 0x6a7090, flatShading: true }));
  ball.position.set(F.X, 8, -1.2); g.add(ball);
  gmesh(new T.CylinderGeometry(.012, .012, 6, 5), new T.MeshBasicMaterial({ color: 0x9aa0b4 }), 0, 3.4, 0, ball);
  const dots = [], cones = [];
  [0xff3d6e, 0x2be8c8, 0xffce4a, 0x6ab8ff, 0xff8a2e, 0xb06aff, 0xffffff, 0x2be8c8, 0xff3d6e, 0xffce4a].forEach((col, i) => {
    const m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: radialTex, color: col, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
    m.rotation.x = -Math.PI / 2; m.scale.setScalar(rnd(.7, 1.3)); g.add(m); dots.push([m, i * .63, rnd(.5, 1.1) * (i % 2 ? 1 : -1), rnd(2.5, 5.6)]);
  });
  [[-4.6, 0xff3d6e], [-1.6, 0x2be8c8], [1.6, 0xffce4a], [4.6, 0x6ab8ff]].forEach(([dx, col], i) => {
    const cg = new T.ConeGeometry(1.15, 7.5, 24, 1, true); cg.translate(0, -3.75, 0);
    const m = new T.Mesh(cg, new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
    m.position.set(F.X + dx, 7.2, -1.2); g.add(m); cones.push([m, i * 1.7]);
  });
  F.L = { g, ball, dots, cones, on: 0, want: 1 };
}

// ---- 明細書 ----
function finSlipRow(label, val, cls) {
  const d = document.createElement('div'); d.className = 'r' + (cls ? ' ' + cls : '');
  const a = document.createElement('span'); a.textContent = label; const b = document.createElement('b'); b.textContent = val; d.appendChild(a); d.appendChild(b);
  $('finRows').appendChild(d);
}
function finSlipTotal(label, n, red) { const t = $('finTot'); t.firstChild.textContent = label; t.lastChild.textContent = fmt(n) + ' 円'; t.classList.toggle('red', !!red); }
function finRoll(role, name) {
  const el = $('finRoll'); el.textContent = '';
  if (role) { const s = document.createElement('small'); s.textContent = role; el.appendChild(s); }
  el.appendChild(document.createTextNode(name));
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  VRH.ban = { big: role || '※', sub: name, t: 1.4 };
}

// ---- 台本（何秒に何が起きるか）----
function finScript(F) {
  const E = [], at = (t, fn) => E.push([t, fn]);
  const X = F.X, A = F.A, B = F.B, Bn = B || A;
  const K = clamp(G.runKills || 0, 1, 330), dn = G.runDeaths || 0;
  const rows = [
    ['源泉徴収（20.42%）', 204200, 5],
    ['5億年ぶんの家賃（月 0.0001円 × 60億か月）', 600000, 14],
    ['けった自動販売機の修理代', 88000, 2],
    [dn ? `コンティニュー ${dn} 回（無料）` : 'ノーミスのごほうび（気持ちだけ）', 0, 0],
    [`敵 ${K} 体へのお見舞い（1体 300円）`, K * 300, 1],
  ];
  rows.push(['その他 諸経費（内訳は 5億年後に開示）', 1000000 - 37 - rows.reduce((s, r) => s + r[1], 0), 2]);
  let t = 0;
  // ① 満了のお知らせ: 2 人は走って舞台のまんなかへ
  at(0, () => { finChime(); finCap('ピンポンパンポーン♪'); F.camX = X; F.go = [[A, X - .5, 1.0, 0]]; if (B) F.go.push([B, X - 3.0, 1.0, 0]); });
  at(t += 1.5, () => finCap('お客様に　ご案内いたします'));
  at(t += 1.4, () => { finCap('ただいまをもちまして　5億年が　満了いたしました'); if (voidFx) voidFx.CN.fin = 1; notes('square', [1760, 1568, 1397, 1319, 1175, 1047, 988, 880, 784, 698, 659, 587, 523], .07, .06, .1); });
  at(t += 1.8, () => { finCap(''); banner('5億年 完走!!', '長らくのご利用　まことに　ありがとうございました'); sfx.clear(); F.fw = true; fwT = 0; for (const h of F.hs) { h.state = 'win'; h.t = 0; } });
  // ② 賞金の授与
  at(t += 2.3, () => { F.fw = false; finCap('それでは　賞金の授与です'); finMusic(F, 'hero'); finKusudama(F); finCamTo(F, { z: 8.3, y: 3.0, ly: 1.4 }); for (const h of F.hs) { h.state = 'idle'; h.t = 0; } F.making = true; });
  at(t += 1.7, () => finKusuOpen(F));
  at(t += 1.1, () => { finCap('賞金　1,000,000 円！'); finPile(F, Bn); sfx.falling(); });
  at(t += 2.3, () => {
    finCap('……ただし　経費を　差し引かせていただきます');
    $('finRows').textContent = ''; finSlipRow('賞金', '+1,000,000', 'p'); finSlipTotal('残り', 1000000); $('finHanko').classList.remove('on'); $('finSlip').classList.add('on');
    F.left = 1000000; sfx.ui();
  });
  t += .3;
  rows.forEach(([label, cost, n]) => at(t += .95, () => {
    F.left -= cost; finSlipRow(label, cost ? '−' + fmt(cost) : '±0'); finSlipTotal('残り', F.left); finPileDrop(F, n);
    sfx.tick(); tone('triangle', 2093, 0, .55, .2); tone('sine', 3136, 0, .7, .1, master, .05);
    const P = F.pile; if (P) textFx(P.g.position.x + .3, P.g.position.y + .7, P.g.position.z, cost ? '−' + fmt(cost) : '±0', cost ? COL.red : COL.teal, 1.25, .85);
    VRH.ban = { big: cost ? '−' + fmt(cost) : '±0', sub: label + '　→　残り ' + fmt(F.left) + ' 円', t: 1.2 };
    if (cost > 500000) { shake(.22); for (const h of F.hs) h.flash = .1; }
  }));
  at(t += 1.3, () => {
    finCap('手取りは　37円　です'); finSlipTotal('手取り', 37); sfx.sad(); if (F.pile) { F.pile.coin.visible = true; } VRH.ban = { big: '手取り 37円', sub: '100万円のはずが…', t: 2 };
    say('finPay', 3);
  });
  at(t += 1.9, () => {
    finCap('なお　振込手数料 440円を引きまして……403円の　ご請求となります');
    finSlipRow('振込手数料', '−440'); finSlipTotal('ご請求額', 403, true); $('finHanko').classList.add('on');
    finMusicStop(F); stampIn('請求書 403円'); impactFrame(90); sfx.thud(); sfx.sad(); shake(.4);
    const P = F.pile; if (P && P.coin.visible) { P.coin.getWorldPosition(_finV); F.g.add(P.coin); P.coin.position.copy(_finV); F.fly.push({ m: P.coin, vx: 3, vy: 13, vz: -2, t: 0, w: 20, star: true }); }
    for (const h of F.hs) { h.state = 'knock'; h.t = 0; h.fin.yaw = null; h.face = 1; textFx(h.x, 2.1, h.z, 'ズコーッ', COL.white, 1.7, .8); }
    VRH.ban = { big: '請求書', sub: '振込手数料 440円を引いて、403円の ご請求です', t: 3 };
  });
  at(t += .6, () => { for (const h of F.hs) { h.state = 'down'; h.t = 0; } });
  at(t += .9, () => say('finBill', 3));
  at(t += 1.3, () => { finCap(''); $('finSlip').classList.remove('on'); if (F.kusu) F.kusu.ty = 9.5; for (const h of F.hs) { h.state = 'getup'; h.t = 0; } });
  // ③ 出演者そろって踊る
  at(t += .8, () => {
    finCap('気を取り直しまして……　出演者の　みなさんです！', '出演者'); finMusic(F, 'cancan'); finLights(F); finCamTo(F, { z: 11.0, y: 3.3, ly: 1.5 });
    F.go = [[A, X + 1.3, 1.0, 0]]; if (B) F.go.push([B, X - 1.3, 1.0, 0]);
    F.making = true; for (const a of F.cast) if (a.mode === 'wait') a.mode = 'in'; F.castIn = true;
  });
  at(t += 2.6, () => { finCap(''); F.dance = true; F.dT = 0; F.fw = true; });
  const tags = t;
  for (let i = 0; i < 5; i++) at(tags + .5 + i * 1.3, () => { const b = F.cast.filter(a => a.boss && !a.gone && a.mode === 'stand')[i]; if (b) textFx(b.x, Math.min(3.4, 1.9 * b.scl + .5), b.z, b.name.replace(/（.*$/, ''), COL.gold, 1.15, 1.5); });
  const roll = [['主演', A.name], B ? ['相棒', B.name + '（Claude）'] : null, ['5億年目の自分', A.name + '（ひとり二役）'], ['敵のみなさん', 'のべ ' + fmt(G.runKills || K) + ' 体'],
    ['小道具', 'たらい・バナナの皮'], ['協力', '自動販売機（けられ役）'], ['音楽', 'ブラウザの発振器'], ['制作期間', '5億年（体感）'], ['', '※ このゲームはフィクションです。ボタンは押さないでください'], ['', '※ 押すなよ。ぜったい押すなよ']].filter(Boolean);
  roll.forEach((r, i) => at(tags + .3 + i * 1.3, () => finRoll(r[0], r[1])));
  t = tags + .3 + roll.length * 1.3;
  at(t += .2, () => { F.dance = false; for (const a of F.cast) if (a.mode === 'stand') a.mode = 'win'; for (const h of F.hs) { h.fin.ent = null; h.state = 'win'; h.t = 0; } banner('THANK YOU!!', 'ご声援　ありがとうございました'); sfx.clear(); fwT = 0; });
  // ④ 記憶を消されて、またボタンを押す
  at(t += 2.4, () => {
    F.fw = false; finMusicStop(F); sweep(2600, 110, 2, .5, .9); tone('sawtooth', 900, 40, .5, .28); if (F.L) F.L.want = 0;
    finCap('──なお　お約束どおり、みなさまの記憶は　消去いたします'); finCamTo(F, { z: 10.2, y: 3.4, ly: 1.3 });
    for (const a of F.cast) if (a.mode === 'win') { a.mode = 'stand'; a.state = 'idle'; }
    for (const h of F.hs) { h.state = 'idle'; h.t = 0; textFx(h.x, 2.15, h.z, '!?', COL.white, 1.5, .9); }
  });
  at(t += 1.7, () => {
    sfx.falling();
    F.cast.filter(a => !a.gone && a.show).sort((p, q) => p.x - q.x).forEach((a, i) => finTarai(F, a, i * .055));
    for (const h of F.hs) finTarai(F, h, .95);
  });
  at(t += 2.0, () => { finCap(''); let i = 0; for (const a of [...F.cast].sort((p, q) => p.x - q.x)) { const d = i++ * .05; later(d, () => { if (G.finale === F) { finCastPoof(F, a); if (i % 3 === 0) tone('sine', rp(900, .2), 300, .12, .12); } }); } });
  at(t += 1.3, () => { for (const h of F.hs) { h.state = 'idle'; h.t = 0; h.fin.yaw = 0; } if (F.L) { F.g.remove(F.L.g); finDispose(F.L.g); F.L = null; } finCamTo(F, { z: 8.6, y: 3.2, ly: 1.1 }); say('finWho', 3); VRH.ban = { big: '……？', sub: 'なにも 思い出せない', t: 2.4 }; });
  at(t += 2.3, () => { if (voidFx) { F.camX = voidFx.BX - 3.4; finCamTo(F, { z: 6.4, y: 3.1, ly: 1.4, lz: -5.5 }); for (const h of F.hs) { h.fin.yaw = null; h.face = 1; } } say('finBtn', 3); VRH.ban = { big: '5億年ボタン', sub: '押すと 100万円', t: 2.6 }; });
  at(t += 2.0, () => {
    say('finPush', 3);
    if (voidFx) { F.go = [[A, voidFx.BX - 2.95, voidFx.BZ + 2.5, null]]; if (B) F.go.push([B, voidFx.BX - 4.3, voidFx.BZ + 3.6, null]); }
    else F.go = [[A, X + 2.2, 0, null]];
  });
  at(t + 1.2, () => { A.state = A.firstMove || 'jab1'; A.t = 0; });   // 手をのばして
  at(t += 1.45, () => {
    F.press = .001; sfx.button(); sfx.aeon(); shake(.5); wFlash = .8;
    const px = voidFx ? voidFx.BX - 2.2 : A.x + .6, pz = voidFx ? voidFx.BZ + 2.4 : A.z;
    textFx(px, 2.6, pz, 'ポチッ', COL.red, 2.6, 1.0); ringFx(px, 1.2, pz, .3, 5, .5, COL.red);
    $('finWhiteT').textContent = ''; $('finWhite').classList.add('on');
    VRH.ban = { big: 'ポチッ', sub: '5億年ボタンが 押されました', t: 3 };
  });
  at(t += .75, () => { $('finWhiteT').textContent = '5億年ボタンが　押されました'; });
  at(t += 1.75, () => finaleEnd(false));
  return E;
}
function finCamTo(F, o) { Object.assign(F.camT, o); }

// ---- 出演者の頭に落ちる、たらい ----
function finTarai(F, a, delay) {
  if (!F.tGeo) { F.tGeo = [new T.CylinderGeometry(.44, .36, .17, 16, 1, true), new T.CircleGeometry(.36, 16)]; F.tMat = new T.MeshLambertMaterial({ color: 0xd8dce8, emissive: 0x30323a, side: T.DoubleSide }); }
  const g = new T.Group(); g.add(new T.Mesh(F.tGeo[0], F.tMat)); const bt = new T.Mesh(F.tGeo[1], F.tMat); bt.position.y = -.085; bt.rotation.x = Math.PI / 2; g.add(bt);
  g.visible = false; g.scale.setScalar(Math.min(1.5, a.scl)); F.g.add(g);
  F.tarai.push({ g, a, t: -delay, y: 7.2, vy: 0, vx: 0, hit: false });
}

// ---- はじめる・進める・終える ----
function finaleStart() {
  if (G.phase !== 'ending' || G.finale) return;
  const hs = heroes().filter(h => h.alive && !h.out);
  if (!hs.length) { stageClear(); return; }
  const X = Math.min(STAGE_END - 3.5, G.camX + 8.5);
  const F = G.finale = { t: 0, i: 0, X, camX: G.camX, hs, A: hs.find(h => h.isPlayer) || hs[0], B: null, time0: G.time, g: new T.Group(), lib: (G.profs && G.profs.finale) || null,
    cast: [], fly: [], tarai: [], go: [], fw: false, skipT: 0, making: false, castIn: false, dance: false, dT: 0, press: 0, mus: null, kusu: null, pile: null, L: null, vrBack: false,
    cam: { z: CAM_Z, y: CAM_Y, ly: LOOK_Y, lz: 0 }, camT: { z: CAM_Z, y: CAM_Y, ly: LOOK_Y, lz: 0 } };
  F.B = hs.find(h => h !== F.A) || null;
  scene.add(F.g);
  for (const h of hs) { if (h.victim) releaseGrab(h); h.fin = { ent: null, yaw: null }; h.move = null; h.vx = h.vy = h.vz = 0; h.y = 0; h.inv = 0; h.flat = 0; h.pit = null; h.state = 'idle'; h.t = 0; }
  if (xrOn() && vrView === 'back') { F.vrBack = true; setVrView('top', true); }   // VR の背中カメラだと舞台が見えないので、終わるまで客席（俯瞰）から
  $('finSkip').textContent = finSkipText(); $('finSkip').classList.add('on'); $('hud').classList.add('fin');
  F.ev = finScript(F).sort((a, b) => a[0] - b[0]);
  log('finale start kills=' + (G.runKills || 0) + ' deaths=' + (G.runDeaths || 0) + ' cast=' + finCastPlan(F).length);
}
function finaleSkip() {
  const F = G.finale; if (!F || F.t < 2.5) return;
  if (F.skipT > 0) { finaleEnd(true); return; }
  F.skipT = 2.5; $('finSkip').textContent = 'もう一度 押すと スキップ'; sfx.ui();
}
function finaleTick(dt) {
  const F = G.finale; if (!F) return;
  F.t += dt; G.time = F.time0;
  if (F.skipT > 0) { F.skipT -= dt; if (F.skipT <= 0) $('finSkip').textContent = finSkipText(); }
  while (F.i < F.ev.length && F.ev[F.i][0] <= F.t) { F.ev[F.i++][1](); if (G.finale !== F) return; }
  G.camX += (F.camX - G.camX) * Math.min(1, dt * 2.4);
  // 主人公（走る・止まる・踊る）
  for (const h of F.hs) { h.t += dt; h.flat = Math.max(0, h.flat - dt); h.flash = Math.max(0, h.flash - dt); h.inv = 0; h.vx = h.vy = h.vz = 0; }
  for (let i = F.go.length - 1; i >= 0; i--) {
    const [h, tx, tz, yaw] = F.go[i], dx = tx - h.x, dz = tz - h.z, d = Math.hypot(dx, dz), st = 6.6 * dt;
    if (d <= st) { h.x = tx; h.z = tz; h.state = 'idle'; h.fast = false; h.fin.yaw = yaw != null ? yaw : Math.atan2(dx || 1, dz); F.go.splice(i, 1); }
    else { h.x += dx / d * st; h.z += dz / d * st; h.state = 'walk'; h.fast = true; h.gspd = 6.6; h.walkPh += dt * 14; if (Math.abs(dz) > Math.abs(dx) * .6) h.fin.yaw = Math.atan2(dx, dz); else { h.fin.yaw = null; h.face = dx > 0 ? 1 : -1; } }
  }
  if (F.dance) { F.dT += dt; const e = F.lib && F.lib.ent.fdance; for (const h of F.hs) { if (e) { h.fin.ent = e; h.fin.yaw = 0; if (h.body) h.body.loopT = F.dT; } else h.state = 'win'; } }
  // 出演者
  if (F.making) { finCastMake(F); if (F.plan && !F.plan.length) F.making = false; if (F.castIn) for (const a of F.cast) if (a.mode === 'wait') a.mode = 'in'; }
  finCastTick(F, dt);
  // くす玉
  const K = F.kusu;
  if (K) {
    K.g.position.y += (K.ty - K.g.position.y) * Math.min(1, dt * 3.2); K.g.rotation.z = Math.sin(F.t * 2.1) * .03;
    if (K.open >= 0) { K.open = Math.min(1, K.open + dt * 2.6); const e = 1 - Math.pow(1 - K.open, 3); K.L.rotation.z = -1.15 * e; K.R.rotation.z = 1.15 * e; K.ban.scale.y = .02 + .98 * e; if (Math.random() < dt * 14) finConfetti(K.g.position.x + rnd(-.4, .4), K.g.position.y - .2, K.g.position.z + .1, 1, 1.2); }
    if (K.g.position.y > 8.8 && K.ty > 9) { F.g.remove(K.g); finDispose(K.g); F.kusu = null; }
  }
  // 札束: 落ちてきて、頭の上に乗る
  const P = F.pile;
  if (P) {
    const top = finTop(P.on, _finH);
    if (!P.landed) {
      P.vy -= 30 * dt; P.y += P.vy * dt;
      if (P.y <= top) {
        P.landed = true; P.on.flat = 1.3; P.on.flash = .15; shake(.4); sfx.thud(); sfx.coin();
        textFx(P.on.x, 2.2, P.on.z, 'ドサッ!!', COL.gold, 2.1, .8); ringFx(P.on.x, .05, P.on.z, .3, 2.2, .35, COL.gold, 'ground');
        for (let i = 0; i < 10; i++) smoke.add(P.on.x + rnd(-.5, .5), .1, P.on.z + rnd(-.2, .2), rnd(-1.6, 1.6), rnd(.2, .9), rnd(-.4, .4), rnd(.4, .7), .25, .8, .8, .78, .7, .5);
        later(.9, () => say('finHeavy', 3));
      }
    } else P.y = top;
    P.g.position.set(P.landed ? _finH.x : P.on.x, P.y, P.landed ? _finH.z : P.on.z);
    if (P.coin.visible && P.coin.parent === P.g) P.coin.rotation.z += dt * 5;
  }
  for (let i = F.fly.length - 1; i >= 0; i--) {
    const o = F.fly[i]; o.t += dt; if (o.t < 0) continue;
    o.vy -= 15 * dt; o.m.position.x += o.vx * dt; o.m.position.y += o.vy * dt; o.m.position.z += o.vz * dt; o.m.rotation.x += o.w * dt; o.m.rotation.z += o.w * .6 * dt;
    if (o.star && o.vy < 0) { flashFx(o.m.position.x, o.m.position.y, o.m.position.z, 1.6, COL.gold, .3, .9); notes('triangle', [2637, 3136], .06, .25, .14); o.t = 99; }
    if (o.t > 1.6 || o.m.position.y < -1) { F.g.remove(o.m); F.fly.splice(i, 1); }
  }
  // 照明
  const L = F.L;
  if (L) {
    L.on += (L.want - L.on) * Math.min(1, dt * 3);
    L.ball.position.y += ((L.want ? 4.05 : 8.5) - L.ball.position.y) * Math.min(1, dt * 2.2); L.ball.rotation.y += dt * 1.6 * L.on;
    for (const [m, ph, w, r] of L.dots) { const a = ph + F.t * w; m.position.set(F.X + Math.cos(a) * r, .03, -.5 + Math.sin(a * 1.3) * 1.7); m.material.opacity = .42 * L.on; }
    for (const [m, ph] of L.cones) { m.rotation.z = Math.sin(F.t * 1.7 + ph) * .42; m.rotation.x = Math.sin(F.t * 1.1 + ph * 2) * .12; m.material.opacity = .055 * L.on; }
  }
  // たらい
  for (let i = F.tarai.length - 1; i >= 0; i--) {
    const o = F.tarai[i]; o.t += dt; if (o.t < 0) continue;
    o.g.visible = true;
    if (!o.hit) {
      o.vy -= 30 * dt; o.y += o.vy * dt; o.g.position.set(o.a.x, o.y, o.a.z);
      const top = finTop(o.a) + .1;
      if (o.y <= top || o.a.gone) {
        o.hit = true; o.y = top; o.vy = 5.5; o.vx = rnd(-2.5, 2.5); o.t = 0;
        if (!o.a.gone) { o.a.mode = 'stun'; o.a.state = 'stun'; o.a.t = 0; o.a.flat = .3; o.a.flash = .1; if (i % 3 === 0 || o.a.fin && !o.a.sh) sfx.tarai(); if (i % 4 === 0) textFx(o.a.x, top + .6, o.a.z, pick(['ガーン!', 'ゴ〜ン!', 'カーン!']), COL.white, 1.5, .6); shake(.06); }
      }
    } else {
      o.vy -= 22 * dt; o.y += o.vy * dt; o.g.position.x += o.vx * dt; o.g.position.y = o.y; o.g.rotation.z += dt * 9;
      if (o.t > .9) { F.g.remove(o.g); F.tarai.splice(i, 1); }
    }
  }
  // 巨大ボタンを押しこむ
  if (F.press > 0 && voidFx) { F.press += dt; const k = Math.min(1, F.press / .5); voidFx.dome.scale.y = .62 * (1 - .55 * Math.sin(k * Math.PI)); }
}
function finaleCamera(dt, sx, sy) {
  const F = G.finale, c = F.cam, k = 1 - Math.exp(-dt * 2.6);
  c.z += (F.camT.z - c.z) * k; c.y += (F.camT.y - c.y) * k; c.ly += (F.camT.ly - c.ly) * k; c.lz += (F.camT.lz - c.lz) * k;
  camera.position.set(G.camX + sx, c.y + sy, c.z); camera.lookAt(G.camX + sx * .5, c.ly, c.lz);
}
// 物・音・画面の文字を片付ける
function finaleClean(F) {
  finMusicStop(F);
  for (const a of F.cast) finCastPoofQuiet(F, a);
  scene.remove(F.g); finDispose(F.g);
  if (voidFx) { voidFx.dome.scale.y = .62; const CN = voidFx.CN; CN.fin = 0; CN.y = 499999999; CN.d = 364; CN.note = ''; CN.nt = 0; CN.t = 0; }   // ボタンを押したので、また 5億年から
  for (const id of ['finCap', 'finSlip', 'finSkip']) $(id).classList.remove('on');
  $('finRoll').classList.remove('on'); $('stamp').classList.remove('show'); $('hud').classList.remove('fin');
  for (const h of F.hs) h.fin = null;
  if (F.vrBack) setVrView('back', true);
}
function finCastPoofQuiet(F, a) { const s = a.show; a.show = false; finCastPoof(F, a); a.show = s; }
function finaleEnd(skipped) {
  const F = G.finale; if (!F) return;
  finaleClean(F);
  G.finale = null; G.time = F.time0; G.camX = F.X;
  for (const h of F.hs) { h.state = 'win'; h.t = 0; h.flat = 0; h.y = 0; h.x = F.X + (h === F.A ? 1.3 : -1.3); h.z = 1.0; h.face = 1; h.vx = h.vy = h.vz = 0; h.fast = false; }
  log('finale end ' + (skipped ? 'skip' : 'full') + ' t=' + F.t.toFixed(1));
  stageClear();
  setTimeout(() => $('finWhite').classList.remove('on'), skipped ? 0 : 450);
}
// 途中でタイトルへ戻ったときなど: 何も進めずに片付けるだけ
function finaleKill() { const F = G.finale; if (!F) return; G.finale = null; finaleClean(F); $('finWhite').classList.remove('on'); }
// 確認用: 最後の面で F8 を押すと、ボスを倒したことにして、すぐ大演出を始める
function finaleDebug() {
  if (G.mode !== 'coop' || G.phase !== 'play' || G.finale || G.stage < STAGES.length - 1 || G.cine) return;
  for (let k = fighters.length - 1; k >= 0; k--) if (fighters[k].team === 'enemy') { fighters[k].dispose(); fighters.splice(k, 1); }
  G.area = null; G.areaIdx = AREAS.length; G.focus = null; G.phase = 'ending';
  for (const h of heroes()) if (!h.out) { h.state = 'win'; h.t = 0; }
  banner('BOSS DOWN!!', STAGES[G.stage].clear); setTimeout(finaleStart, 900);
}
function prepClone() {
  if (G.cloneBody && G.cloneOf !== (G.p1Char && G.p1Char.vrm)) G.cloneBody = null;   // キャラを替えたら、分身も作り直す
  if (G.cloneBody || G.cloneJob || !G.p1Char || !G.p1Char.vrm) return;
  const of = G.p1Char.vrm;
  G.cloneJob = loadBody(G.p1Char, HERO1).then((b) => {
    G.cloneJob = null; if (!b.vrm || of !== (G.p1Char && G.p1Char.vrm)) return; G.cloneOf = of;
    b.vrm.scene.traverse((o) => { for (const m of [].concat(o.material || [])) { try { if (m.color) m.color.multiplyScalar(.2); if (m.shadeColorFactor) m.shadeColorFactor.multiplyScalar(.12); if (m.emissive) m.emissive.setRGB(.1, 0, .07); if (m.outlineColorFactor) m.outlineColorFactor.setRGB(.9, .1, .3); } catch (e) {} } });
    const head = b.hb && b.hb.head;
    if (head) { const eye = new T.Sprite(new T.SpriteMaterial({ map: radialTex, color: 0xff2040, transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending, fog: false })); eye.scale.set(.34, .16, 1); eye.position.set(0, .07, .09); head.add(eye); }
    b.root.visible = false; G.cloneBody = b; log('5億年目の自分: 体の用意ができました');
  }).catch((e) => { G.cloneJob = null; log('5億年目の自分: 体を読めませんでした ' + e.message); });
}
function takeClone() { const b = G.cloneBody; G.cloneBody = null; if (b) b.root.visible = true; return b; }
function spawnEnemy(type, fromLeft) {
  const spec = ENEMIES[type];
  const hpMul = (G.p2 && !G.p2.out ? 1.25 : 1) * [0.8, 1, 1.2][G.diff];
  const e = new Fighter({ name: spec.name, team: 'enemy', spec, body: (spec.clone && (G.cloneLive = takeClone())) || new BotBody(spec, false), maxhp: Math.round(spec.hp * hpMul), spd: spec.spd,
    ai: { think: rnd(.3, .9), zoff: rnd(-1.4, 1.4), enterT: 1.1 } });
  e.hp = e.maxhp;
  const prof = (spec.prof && G.profs && G.profs[spec.prof]) || G.enemyProf;
  if (prof) { e.body.setLib(prof); e.moves = prof.moves; e.sd = prof.sd; }
  e.shotCd = rnd(1.5, 3);
  const St = STAGES[G.stage];   // ふつうの大きさの雑魚は、ときどき武器を持って出てくる（吹っ飛ばすと落とす → 拾える）
  if (G.mode === 'coop' && St.eweapons && !spec.boss && !spec.mid && (spec.scale || 1) <= 1.1 && !spec.jumper && !spec.prof && Math.random() < (St.armed || 0)) holdWeapon(e, pick(St.eweapons));
  e.x = G.camX + (fromLeft ? -1 : 1) * (halfW + 1.2 + Math.random() * 1.5); e.z = rnd(Z_MIN + .2, Z_MAX - .2); e.face = fromLeft ? 1 : -1;
  if (spec.boss || spec.mid) { e.x = G.camX + halfW + 1.5; e.z = -.3; e.ai.enterT = 1.6; }
  gimSpawn(e, spec);
  fighters.push(e);
  if (spec.clone) setTimeout(() => say('self', 3), 1800);
  return e;
}
function onDeath(f) {
  if (f.team === 'enemy') {
    const k = f.lastHitBy && f.lastHitBy.team !== 'enemy' ? f.lastHitBy : null;
    if (k) { k.score += f.spec.score; k.kos++; }
    dropCapsule(f);
    if (f.spec.boss || f.spec.mid) { sfx.ko(); flash(); hitStop = f.spec.boss ? .5 : .35; if (f.spec.mid) { banner('中ボス撃破！', f.name + ' を倒した'); slowT = Math.max(slowT, .5); } }
    if (G.focus === f) G.focusT = Math.min(G.focusT, .8);
    return;
  }
  if (G.mode === 'vs') return;
}
function respawn(f) {
  if (f.out || f.respawning) return;
  unhold(f); endCopy(f);
  f.deaths = (f.deaths || 0) + 1; G.deaths = (G.deaths || 0) + 1; G.runDeaths = (G.runDeaths || 0) + 1;   // 残機は無制限。何回やられたかだけ数える（集計に出る）
  f.hp = f.maxhp; f.state = 'jump'; f.t = 0; f.jk = true; f.y = 4; f.vy = 0; f.vx = 0; f.move = null;
  f.x = G.camX - halfW * .4; f.z = 0; f.inv = 3.2; f.face = 1; f.pit = null; f.flat = 0;
  for (const h of holes) if (Math.hypot(f.x - h.x, f.z - h.z) < .9) f.z = h.z > 0 ? h.z - 1.2 : h.z + 1.2;
  fxRespawn(f);
  toastAt(f, pick(['無料でコンティニュー', '何度でもよみがえる', '残機：たくさん', 'コンティニュー（5億回まで）'])); if (f.isClaude) say('respawn', 1);
  later(.6, () => {   // 降りてきた勢いで、まわりの敵を吹っ飛ばす
    if (!f.alive || f.out) return;
    ringFx(f.x, .05, f.z, .4, 3.4, .4, teamCol(f), 'ground'); shake(.2); sfx.boom(false);
    for (const e of enemies()) if (e.state !== 'dead' && !downish(e.state) && !e.pit && Math.hypot(e.x - f.x, (e.z - f.z) * 1.4) < 2.7 && e.y < 1.6) applyHit(f, e, { dmg: 6, kb: 6.5, knock: 1, heavy: 1, dir: Math.sign(e.x - f.x) || 1, x: f.x, key: 'respawn', env: 1 });
  });
}
function areaLogic(dt) {
  const P1 = G.p1, P2 = G.p2;
  const alive = heroes().filter(h => !h.out);
  // 全滅
  if (!alive.length || alive.every(h => h.out)) { if (G.phase === 'play') gameOver(); return; }
  // カメラ: 前にだけ進む。エリアで止まる
  const lead = alive.filter(h => h.state !== 'dead');
  const avg = lead.length ? lead.reduce((s, h) => s + h.x, 0) / lead.length : G.camX;
  const tx = lead.includes(P1) ? P1.x * .6 + avg * .4 : avg;
  const next = AREAS[G.areaIdx];
  const limit = next ? next.lock : STAGE_END;
  if (!G.area) {
    const want = Math.min(limit, Math.max(G.camX, tx + 1.2));
    G.camX += (want - G.camX) * Math.min(1, dt * 3);
    if (next && G.camX > next.lock - .08) {
      G.camX = next.lock; G.area = next; G.waveIdx = 0; G.waveT = .4; G.go = false;
      if (next.boss) sfx.warn(); else sfx.alert();
      if (next.boss) { banner('WARNING', (ENEMIES[next.waves[0].find(t => ENEMIES[t].boss)]?.name || 'ボス') + ' 見参！'); setTimeout(() => say('boss', 3), 1200); G.waveT = 1.8; }
    }
    if (!next && G.camX > STAGE_END - .5) stageClear();
  } else {
    G.camX += (G.area.lock - G.camX) * Math.min(1, dt * 3);
    G.waveT -= dt;
    const live = enemies().filter(e => e.state !== 'dead');
    const wave = G.area.waves[G.waveIdx], midT = wave && wave.find(t => ENEMIES[t].mid);
    if (wave && live.length <= (midT ? 0 : 1) && G.waveT <= 0) {
      wave.forEach((t, i) => spawnEnemy(t, !ENEMIES[t].boss && !ENEMIES[t].mid && (i % 2 === 1 || Math.random() < .25)));
      G.waveIdx++; G.waveT = 1.2;
      if (midT) { banner('WARNING', '中ボス ' + ENEMIES[midT].name + ' 登場！'); sfx.warn(); setTimeout(() => say('boss', 2), 1200); G.waveT = 1.8; }   // 中ボスの波
    }
    const midE = enemies().find(e => e.spec.mid && e.state !== 'dead');
    if (midE) { G.focus = midE; G.focusT = 1; }
    if (G.area.boss) {   // ボスがいる間はときどき子分が来る
      const boss = enemies().find(e => e.spec.boss);
      G.minionT -= dt;
      if (boss && boss.state !== 'dead' && G.minionT <= 0 && live.length < 3) { spawnEnemy(pick(STAGES[G.stage].minions), Math.random() < .5); G.minionT = 11; }
      if (boss) { G.focus = boss; G.focusT = 1; }
    }
    if (G.waveIdx >= G.area.waves.length && live.length === 0 && G.waveT <= 0) {
      const wasBoss = G.area.boss;
      G.area = null; G.areaIdx++;
      if (wasBoss) { for (const h of heroes()) if (!h.out) { h.state = 'win'; h.t = 0; } say('bossDown', 3); banner('BOSS DOWN!!', STAGES[G.stage].clear); fwT = .3; setTimeout(G.stage >= STAGES.length - 1 ? finaleStart : stageClear, 3000); G.phase = 'ending'; }
      else { G.go = true; G.goPing = 3; G.goT = 1.3; sfx.go(); fxClear(); say(Math.random() < .5 ? 'clear' : 'go', 1); }
    }
  }
}
function vsLogic(dt) {
  const P1 = G.p1, P2 = G.p2;
  G.camX = VS_X + clamp(((P1.x + P2.x) / 2 - VS_X) * .3, -1.5, 1.5);
  if (!G.roundOver) {
    G.roundT -= dt;
    const ko1 = P1.hp <= 0, ko2 = P2.hp <= 0, tout = G.roundT <= 0;
    if (ko1 || ko2 || tout) {
      G.roundOver = true; G.endT = 0;
      let w = ko2 && !ko1 ? 0 : ko1 && !ko2 ? 1 : (P1.hp / P1.maxhp >= P2.hp / P2.maxhp ? 0 : 1);
      G.roundWinner = w; G.wins[w]++;
      sfx.ko(); flash(); hitStop = .6;
      banner(tout && !ko1 && !ko2 ? 'TIME UP' : 'K.O.', w === 0 ? `${P1.name} の勝ち` : `${P2.name}（Claude）の勝ち`);
      const match = G.wins[w] >= 2;
      say(match ? (w === 1 ? 'vsWinC' : 'vsWinP') : (w === 1 ? 'vsRoundC' : 'vsRoundP'), 3);
    }
  } else {
    G.endT += dt;
    const W = G.roundWinner === 0 ? P1 : P2, L = G.roundWinner === 0 ? P2 : P1;
    if (G.endT > 1.4 && (W.state === 'idle' || W.state === 'walk')) { W.state = 'win'; W.t = 0; }
    if (G.endT > 1.4 && L.hp > 0 && (L.state === 'idle' || L.state === 'walk')) { L.state = 'lose'; L.t = 0; }
    if (G.endT > 4.2) {
      if (G.wins[G.roundWinner] >= 2) { G.phase = 'result'; showResult(); }
      else { G.round++; resetRound(); }
    }
  }
}
// ---- 面に入る（主人公はそのまま、敵・小道具・演出を片付けて背景を作り直す）----
function enterStage(i, first) {
  const S = STAGES[i] || STAGES[0], p1 = G.p1, p2 = G.p2;
  G.stage = STAGES.indexOf(S); AREAS = S.areas; PROPS_AT = S.props;
  if (S.areas.some(a => a.waves.some(w => w.some(t => ENEMIES[t] && ENEMIES[t].clone)))) prepClone();
  if (stageTheme !== S.theme) buildStage(S.theme);
  for (let k = fighters.length - 1; k >= 0; k--) if (fighters[k].team === 'enemy') { fighters[k].dispose(); fighters.splice(k, 1); }
  for (const it of items) scene.remove(it.g);
  for (const p of props) { scene.remove(p.g); scene.remove(p.sh); }
  for (const sh of shots) scene.remove(sh.g);
  for (const e of fx) scene.remove(e.o);
  items = []; props = []; shots = []; fx = [];
  clearWeapons(); clearHazards(); for (const [x, z, k] of S.weapons || []) spawnWeapon(k, x, z);
  glow.clear(); smoke.clear(); streaks.clear(); flow.clear();
  G.camX = 0; G.areaIdx = 0; G.area = null; G.waveIdx = 0; G.go = true; G.focus = null; G.minionT = 8;
  G.time = 0; G.combo = 0; G.comboT = 0; G.maxCombo = 0; slowT = 0; hitStop = 0;
  [p1, p2].forEach((h, k) => {
    h.out = false; h.pit = null; h.flat = 0; endCopy(h);
    h.alive = true; h.body.root.visible = true; h.hp = h.maxhp; h.state = 'idle'; h.t = 0; h.vx = h.vy = h.vz = 0; h.y = 0;
    h.move = null; h.victim = null; h.holder = null; h.inv = 0; h.comboT = 0; h.fast = false; h.shotCd = 0; h.face = 1;
    h.x = k ? -4 : -2.5; h.z = k ? -1 : .2;
    if (G.heroProf?.ent.intro) { h.state = 'intro'; h.inv = 1; }   // 登場の決めポーズ（動かせばすぐ解ける）
  });
  G.score0 = [p1.score, p2.score];
  for (const [x, z, d] of PROPS_AT) makeProp(x, z, d);
  cineCancel(); buildGimmicks(S); G.deaths = 0; G.aeon = 0; p1.deaths = p2.deaths = 0;
  banner(`STAGE ${G.stage + 1}`, `${S.name} ― ${S.intro}`); sfx.start();
  if (!first && LINES['stage' + (G.stage + 1)]) setTimeout(() => say('stage' + (G.stage + 1), 3), 1600);
  log(`stage ${G.stage + 1} ${S.name}`);
}
// ---- 面クリアのお祝い: 花火と紙ふぶき ----
let fwT = 0, fwSnd = 0, confT = 0;
function celebrate(dt) {
  fwT -= dt; fwSnd -= dt; confT -= dt;
  if (confT <= 0) {
    confT = .16;
    for (let i = 0; i < 5; i++) { const c = pick([COL.teal, COL.gold, COL.pink, COL.white]); glow.add(G.camX + rnd(-halfW, halfW), rnd(4.6, 6.4), rnd(-2.4, 2.4), rnd(-.5, .5), rnd(-2.0, -.9), rnd(-.3, .3), rnd(1.6, 2.6), rnd(.09, .16), .04, c[0] * 1.3, c[1] * 1.3, c[2] * 1.3, .9, .4, .3); }
  }
  if (fwT > 0) return;
  fwT = G.phase === 'ending' ? rnd(.2, .42) : rnd(.55, 1.2);
  const c = pick([COL.gold, COL.pink, COL.teal, COL.white, COL.orange]), x = G.camX + rnd(-halfW * .85, halfW * .85), y = rnd(3.0, 5.6), z = rnd(-4, -1.6);
  for (let i = 0; i < 46; i++) { const a = rnd(0, 6.283), e = rnd(-1.57, 1.57), v = rnd(2.5, 6.5); glow.add(x, y, z, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v, Math.sin(a) * Math.cos(e) * v * .5, rnd(.7, 1.3), rnd(.12, .2), .03, c[0] * 1.5, c[1] * 1.5, c[2] * 1.5, 1, 3.2, 2.2); }
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; streaks.add(x, y, z, Math.cos(a) * 9, Math.sin(a) * 9, 0, .3, .12, .03, c[0], c[1], c[2], 4, 2); }
  flashFx(x, y, z, 2.2, c, .18, .5);
  if (fwSnd <= 0 && (!G.tally || G.tally.t < 8)) { sfx.firework(); fwSnd = .22; }
}
// ---- 点数の集計（1 行ずつ出て、数字が数え上がり、最後にランクのはんこが落ちる）----
const fmt = (n) => Math.round(n).toLocaleString('en-US');
function showTally() {
  const P1 = G.p1, P2 = G.p2, S = STAGES[G.stage], last = G.stage >= STAGES.length - 1;
  const t = G.time, mm = Math.floor(t / 60), ss = Math.floor(t % 60);
  const k1 = P1.score - G.score0[0], k2 = P2.score - G.score0[1];
  const timeB = Math.max(0, Math.round(S.par * 1.6 - t)) * 20;
  const comboB = Math.min(G.maxCombo, 150) * 100;
  const hs = heroes().filter(h => !h.out), dn = G.deaths || 0;
  const lifeB = Math.round(hs.reduce((s, h) => s + h.hp / h.maxhp * 1000, 0) / 10) * 10;
  const contB = dn === 0 ? 5000 : Math.max(0, 2000 - dn * 400);
  const bonus = timeB + comboB + lifeB + contB;
  P1.score += Math.ceil(bonus / 2); P2.score += Math.floor(bonus / 2);   // ボーナスはふたりで山分け
  const rp = (dn === 0 ? 2 : dn <= 3 ? 1 : 0) + (t < S.par ? 2 : t < S.par * 1.3 ? 1 : 0) + (G.maxCombo >= 30 ? 2 : G.maxCombo >= 15 ? 1 : 0) + (hs.length === 2 ? 1 : 0);
  const rank = rp >= 6 ? 'S' : rp >= 4 ? 'A' : rp >= 2 ? 'B' : 'C';
  const rows = [
    ['撃破スコア', `${P1.name} ${fmt(k1)} ／ ${P2.name} ${fmt(k2)}`, k1 + k2],
    ['タイムボーナス', `${G.aeon ? '5億年と ' : ''}${mm}:${String(ss).padStart(2, '0')}`, timeB],
    ['最大コンボ', `${G.maxCombo} HIT`, comboB],
    ['のこり体力', `${P1.name} ${Math.round(P1.hp / P1.maxhp * 100)}% ／ ${P2.name} ${Math.round(P2.hp / P2.maxhp * 100)}%`, lifeB],
    ['やられた回数', dn ? `${dn} 回（コンティニューは無料）` : 'ノーミス！', contB],
  ];
  $('scSt').textContent = `STAGE ${G.stage + 1} ― ${S.name}`;
  $('scTi').innerHTML = [...(last ? 'ALL CLEAR!!' : 'STAGE CLEAR!')].map((ch, i) => ch === ' ' ? '<i></i>' : `<span style="--i:${i}">${ch}</span>`).join('');
  $('scSub').textContent = `${last ? '5億年を 乗りこえた！（手取り −403円・記憶なし）' : S.clear}　${P1.name} ＆ ${P2.name}（Claude）`;
  const box = $('scRows'); box.textContent = '';
  const els = rows.map((r) => {
    const d = document.createElement('div'); d.className = 'sc-row';
    for (const [cls, txt] of [['l', r[0]], ['d', r[1]], ['v', '0']]) { const s = document.createElement('div'); s.className = cls; s.textContent = txt; d.appendChild(s); }
    box.appendChild(d); return d;
  });
  $('scTot').classList.remove('on'); $('scTotV').textContent = '0'; $('scAll').classList.remove('on');
  $('scAll').textContent = G.stage > 0 || last ? `ここまでの合計  ${fmt(P1.score + P2.score)}` : '';
  const rk = $('scRank'); rk.classList.remove('on'); rk.dataset.r = rank; rk.querySelector('b').textContent = rank;
  $('scBtns').classList.remove('on'); $('scNext').textContent = last ? 'もう一回 押す' : `STAGE ${G.stage + 2} へ ▶`;
  $('scHint').textContent = last ? 'Enter / J で もう一回 5億年　　Esc でタイトルへ' : 'Enter / J で次の面へ';
  $('hud').classList.remove('on'); $('bubble').classList.remove('on'); $('sclear').classList.remove('hide'); tallyFit();
  G.tally = { t: 0, rows: rows.map((r, i) => ({ val: r[2], el: els[i], v: els[i].lastChild, on: false, fin: false, plus: i > 0 })), total: k1 + k2 + bonus, rank, last, tick: 0, totOn: false, totFin: false, rankOn: false, done: false };
  log(`stage clear ${G.stage + 1} time=${Math.round(t)} kill=${k1 + k2} bonus=${bonus} total=${P1.score + P2.score} rank=${rank}`);
}
function tallyTick(dt) {
  const Tl = G.tally; if (!Tl) return;
  Tl.t += dt; Tl.tick -= dt;
  const T0 = 1.0, STEP = .62, CNT = .42, ease = (p) => 1 - Math.pow(1 - p, 3);
  let counting = 0;
  Tl.rows.forEach((r, i) => {
    const p = clamp((Tl.t - (T0 + i * STEP)) / CNT, 0, 1);
    if (p > 0 && !r.on) { r.on = true; r.el.classList.add('on'); if (Tl.t < 50) sfx.ui(); }
    if (r.on && !r.fin) { r.v.textContent = (r.plus ? '+ ' : '') + fmt(r.val * ease(p)); if (p >= 1) r.fin = true; else if (r.val > 0) counting = p; }
  });
  const tt = T0 + Tl.rows.length * STEP + .2, tp = clamp((Tl.t - tt) / .9, 0, 1);
  if (tp > 0 && !Tl.totOn) { Tl.totOn = true; $('scTot').classList.add('on'); }
  if (Tl.totOn && !Tl.totFin) {
    $('scTotV').textContent = fmt(Tl.total * ease(tp));
    if (tp >= 1) { Tl.totFin = true; $('scAll').classList.add('on'); if (Tl.t < 50) { sfx.total(); wFlash = Math.max(wFlash, .25); } } else counting = tp;
  }
  if (counting && Tl.tick <= 0 && Tl.t < 50) { Tl.tick = .055; sfx.tick(counting); }
  if (Tl.t > tt + 1.35 && !Tl.rankOn) { Tl.rankOn = true; $('scRank').classList.add('on'); sfx.stamp(Tl.rank); shake(.25); }
  if (Tl.t > tt + 1.9 && !Tl.done) { Tl.done = true; $('scBtns').classList.add('on'); }
}
// Enter / J / パッドのボタン: 数え上げの途中なら一気に最後まで、終わっていれば次へ
function tallyKey() {
  const Tl = G.tally; if (!Tl || G.phase !== 'tally' || Tl.t < .8) return;
  if (!Tl.done) { Tl.t = 99; return; }
  tallyAdvance();
}
// 窓が小さいときは、集計の板ごと縮めて収める
function tallyFit() { $('scIn').style.zoom = Math.min(1, innerHeight / 740, innerWidth / 1040).toFixed(3); }
addEventListener('resize', tallyFit);
function tallyClose() { $('sclear').classList.add('hide'); G.tally = null; }
function tallyAdvance() {
  const Tl = G.tally; if (!Tl || !Tl.done || G.phase !== 'tally') return;
  if (Tl.last) { tallyClose(); startGame(); return; }
  G.phase = 'fade'; $('fade').classList.add('on'); sfx.ui();
  setTimeout(() => {
    tallyClose(); enterStage(G.stage + 1); $('hud').classList.add('on'); G.phase = 'play'; pressed.clear();
    setTimeout(() => $('fade').classList.remove('on'), 120);
  }, 520);
}
function stageClear() {
  if (G.phase !== 'ending') return;
  sfx.clear();
  G.phase = 'tally'; showTally();
}
function gameOver() {
  G.phase = 'over';
  banner('GAME OVER', TP.on ? '画面をタップでコンティニュー' : 'Enter でコンティニュー'); sfx.over();
  say('over', 3);
}
function continueGame() {
  for (const h of heroes()) {
    h.out = false; h.alive = true; h.lives = 2; h.score = 0; G.score0 = [0, 0]; h.hp = h.maxhp; h.body.root.visible = true;
    h.state = 'jump'; h.t = 0; h.jk = true; h.y = 4; h.vy = 0; h.vx = 0; h.move = null; h.victim = null; h.holder = null;
    h.x = G.camX - halfW * .4 + (h.isClaude ? -1 : 0); h.z = h.isClaude ? -.8 : .3; h.inv = 2.6; h.face = 1;
  }
  pressed.clear(); G.continues++;
  G.phase = 'play';
  banner('CONTINUE', 'もう一度、Claude と！'); sfx.start();
}
function showResult() {
  const P1 = G.p1, P2 = G.p2;
  $('hud').classList.remove('on'); $('bubble').classList.remove('on');
  if (G.mode === 'coop') {
    $('resT').textContent = 'STAGE CLEAR';
    $('resS').textContent = `5億年商店街を取り戻した！ ${P1.name} ＆ ${P2.name}（Claude）`;
  } else {
    const w = G.wins[0] >= 2 ? 0 : 1;
    $('resT').textContent = w === 0 ? 'YOU WIN' : 'CLAUDE WINS';
    $('resS').textContent = `${G.wins[0]} - ${G.wins[1]}　${w === 0 ? P1.name + ' の勝ち！' : P2.name + '（Claude）の勝ち'}`;
  }
  const mm = Math.floor(G.time / 60), ss = Math.floor(G.time % 60);
  const rows = [['', P1.name + '（あなた）', P2.name + '（Claude）'], ['SCORE', P1.score, P2.score], ['倒した数', P1.kos, P2.kos]];
  if (G.mode === 'coop') rows.push(['最大コンボ', G.maxCombo, '-'], ['タイム', `${mm}:${String(ss).padStart(2, '0')}`, '']);
  $('resStats').innerHTML = rows.map((r, i) => r.map((c, j) => `<div class="${i === 0 || j === 0 ? 'h' : 'v'}">${c}</div>`).join('')).join('');
  $('result').classList.remove('hide');
  log(`result mode=${G.mode} p1=${P1.score} claude=${P2.score} wins=${G.wins}`);
}
function togglePause() {
  if (G.phase === 'play') { G.phase = 'paused'; $('pause').classList.remove('hide'); }
  else if (G.phase === 'paused') { G.phase = 'play'; $('pause').classList.add('hide'); }
}
function toTitle() {
  G.phase = 'title'; clearWorld(); tallyClose(); if (stageTheme !== 'street') buildStage('street');
  $('pause').classList.add('hide'); $('result').classList.add('hide'); $('hud').classList.remove('on'); $('bubble').classList.remove('on');
  $('title').classList.remove('hide');
}

// ---- 画面の文字 ----
function banner(big, sub) {
  VRH.ban = { big, sub: sub || '', t: 2.4 };
  const el = $('banIn'); $('banBig').textContent = big; $('banSub').textContent = sub || '';
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function flash() { const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
const toasts = [];
function toastAt(f, text) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;z-index:6;font:700 16px "Noto Sans JP";color:#FFCE4A;text-shadow:0 0 8px #000;pointer-events:none;transform:translate(-50%,-100%);transition:opacity .6s';
  d.textContent = text; document.body.appendChild(d); toasts.push({ d, f, t: 0 });
}
const _v = new T.Vector3();
function toScreen(x, y, z) { _v.set(x, y, z).project(camera); return [(_v.x + 1) / 2 * innerWidth, (1 - _v.y) / 2 * innerHeight]; }
function setBar(el, f) {
  const k = clamp(f.hp / f.maxhp, 0, 1);
  el.querySelector('i').style.width = (k * 100) + '%';
  el.querySelector('em').style.width = (k * 100) + '%';
  el.classList.toggle('low', k < .3);
}
function updateHUD(dt) {
  const P1 = G.p1, P2 = G.p2; if (!P1) return;
  setBar($('p1bar'), P1); setBar($('p2bar'), P2);
  comboTick(dt);
  const lv = (f) => G.mode === 'vs' ? '' : '∞' + (f.deaths ? ` ${f.deaths}回` : '') + (f.isPlayer ? ((f.meter || 0) >= METER_MAX ? '　Y 超必殺!' : (f.meter || 0) >= 100 ? '　H 連携技' : '') : '');
  for (const [id, f] of [['p1mt', P1], ['p2mt', P2]]) { const el = $(id); if (!el) continue; el.style.display = G.mode === 'vs' ? 'none' : ''; const m = f.meter || 0; [...el.children].forEach((b, i) => { const k = clamp((m - i * 100) / 100, 0, 1); b.firstChild.style.width = (k * 100) + '%'; b.classList.toggle('full', k >= 1); }); el.classList.toggle('max', m >= METER_MAX); }
  $('p1lv').textContent = lv(P1); $('p2lv').textContent = lv(P2);
  $('p1lv').classList.toggle('out', P1.out); $('p2lv').classList.toggle('out', P2.out);
  const wp = (f) => (f.weapon && !f.out ? `${WEAPONS[f.weapon.kind].name} ×${f.weapon.uses}` : '') + (f.copy ? `  ◆${f.copy.name} ${Math.ceil(f.copy.t)}` : '');
  $('p1wp').textContent = wp(P1); $('p2wp').textContent = wp(P2); weaponHint();
  G.focusT -= dt;
  const en = $('enemy');
  if (G.mode === 'coop' && G.focus && G.focusT > 0) {
    en.classList.add('on'); en.classList.toggle('boss', !!(G.focus.spec?.boss || G.focus.spec?.mid));
    $('enm').textContent = G.focus.name; setBar(en.querySelector('.bar'), G.focus);
  } else en.classList.remove('on');
  $('go').classList.toggle('on', G.mode === 'coop' && G.phase === 'play' && !G.area && G.areaIdx < AREAS.length && (G.areaIdx > 0 || G.time > 2.5));
  if (G.goPing > 0 && $('go').classList.contains('on') && G.phase === 'play') { G.goT -= dt; if (G.goT <= 0) { G.goT = 1.5; G.goPing--; sfx.ping(); } }   // 「先へ進め」の催促を 3 回だけ
  if (G.mode === 'vs') $('timer').textContent = Math.max(0, Math.ceil(G.roundT));
  // 吹き出し（Claude の頭の上）
  bubbleT -= dt;
  const b = $('bubble');
  if (bubbleT > 0 && P2.body?.root.visible !== false) {
    const [sx, sy] = toScreen(P2.x, P2.y + P2.body.headY + .35, P2.z);
    b.style.left = clamp(sx, 180, innerWidth - 180) + 'px'; b.style.top = clamp(sy, 150, innerHeight - 40) + 'px';
  } else b.classList.remove('on');
  for (let i = toasts.length - 1; i >= 0; i--) {
    const t = toasts[i]; t.t += dt;
    const [sx, sy] = toScreen(t.f.x, t.f.y + 2.1 + t.t * .8, t.f.z);
    t.d.style.left = sx + 'px'; t.d.style.top = sy + 'px'; if (t.t > .6) t.d.style.opacity = 0;
    if (t.t > 1.2) { t.d.remove(); toasts.splice(i, 1); }
  }
}

// =========================================================================================
// 毎フレーム
// =========================================================================================
const clock = new T.Clock();
let camHook = null, inputOverride = null;
let engaged = new Set();
function sim(dt) {
  G.time += dt;
  if (G.cine) { if (!inputOverride) readP1(); cineTick(dt); return; }   // 連携技のあいだ、まわりは止まる
  const P1 = G.p1, P2 = G.p2;
  const inp = inputOverride ? inputOverride(P1) : readP1();
  if (G.phase === 'ending' || G.phase === 'tally' || (G.mode === 'vs' && G.roundOver)) { P1.ctrl = { mx: 0, mz: 0, atk: false, jump: false, sp: false }; }
  else P1.ctrl = inp;
  if (P2.alive && !P2.out) { if (G.phase === 'ending' || G.phase === 'tally' || (G.mode === 'vs' && G.roundOver)) P2.ctrl = { mx: 0, mz: 0, atk: false, jump: false, sp: false }; else aiClaude(P2, dt); }
  // 殴りに来る敵は同時に 2〜3 体まで（残りは周りをうろつく）
  const es = enemies().filter(e => e.state !== 'dead');
  const maxEng = G.diff === 2 ? 3 : 2;
  engaged = new Set(es.filter(e => e.spec.boss || e.spec.mid));
  es.filter(e => !e.spec.boss && !e.spec.mid).map(e => { const h = nearestHero(e); return [e, h ? Math.abs(h.x - e.x) + Math.abs(h.z - e.z) : 99]; })
    .sort((a, b) => a[1] - b[1]).slice(0, maxEng).forEach(([e]) => engaged.add(e));
  for (const e of es) { aiEnemy(e, dt, engaged); steerAI(e); }
  if (P2.alive && !P2.out && P2.ai) steerAI(P2);
  for (const f of fighters) if (f.alive && !f.out) updateFighter(f, dt);
  separate();
  resolveHits();
  updateShots(dt);
  updateItems(dt);
  updateWeapons(dt);
  updateHazards(dt);
  if (!G.finale) updateGimmicks(dt);   // 大演出のあいだ、プレス機などのしかけは止める
  for (let i = fighters.length - 1; i >= 0; i--) if (!fighters[i].alive && fighters[i].team === 'enemy') { fighters[i].dispose(); fighters.splice(i, 1); G.runKills = (G.runKills || 0) + 1; }
  if (G.mode === 'coop') { if (G.phase === 'play') areaLogic(dt); }
  else vsLogic(dt);
}
function frame() {
  const dt = Math.min(.05, clock.getDelta());
  if (xrOn()) pollXR(dt);
  gameTime += dt;
  const running = G.phase === 'play' || G.phase === 'ending' || G.phase === 'tally' || G.phase === 'over';
  let freeze = false;
  if (running && G.phase !== 'over') {
    if (slowT > 0) slowT -= dt;
    if (hitStop > 0) { hitStop -= dt; freeze = true; }
    else sim(dt * (slowT > 0 ? .3 : 1));
  }
  if (G.finale) finaleTick(dt);
  // 体の見た目
  const bdt = freeze ? dt * .08 : dt * (slowT > 0 && running ? .3 : 1);
  for (const f of fighters) {
    if (!f.body) continue;
    if (f.out) { f.body.root.visible = false; f.shadow.visible = false; if (f.weapon) unhold(f); continue; }
    const stop = G.cine && !f.duo;   // 連携技のあいだ、演じている 2 人以外は止まって見える
    f.body.sync(f, stop ? bdt * .02 : bdt);
    vfxFighter(f, stop ? 0 : bdt, freeze || stop);
    weaponSync(f, bdt, freeze);
    typeFx(f, bdt, freeze);
    f.shadow.visible = true;
    const s = (f.team === 'enemy' ? .95 * f.scl : 1) * (1 - Math.min(.5, f.y * .12)) * (f.state === 'down' || f.state === 'dead' ? 1.5 : 1);
    f.shadow.scale.set(s * 1.05, s * .6, 1); f.shadow.position.set(f.x - (f.state === 'down' || f.state === 'dead' ? f.face * .75 : 0), .012, f.z);
  }
  if (G.mode === 'coop' && (G.phase === 'ending' || G.phase === 'tally') && (!G.finale || G.finale.fw)) celebrate(dt);
  if (G.phase === 'tally') tallyTick(dt);
  for (const fn of stageAnim) fn(dt);
  gimFrame(dt); cineFade(dt);
  updateFx(window.__fxHold ? 0 : bdt);
  vfxAmbient(dt);
  // やられたとき・体力が危ないとき、画面のふちが赤くなる
  vig = Math.max(0, vig - dt * 2.2);
  const lowHp = running && G.p1 && !G.p1.out && G.p1.hp > 0 && G.p1.hp < G.p1.maxhp * .3 ? .26 + .14 * Math.sin(gameTime * 7) : 0;
  vigEl.style.opacity = Math.max(vig, lowHp).toFixed(3);
  camPunch *= Math.exp(-dt * 9);
  wFlash *= Math.exp(-dt * 16); whiteEl.style.opacity = wFlash < .01 ? 0 : wFlash.toFixed(3);
  bgmTick();
  // カメラ（タイトル中はゆっくり商店街を流す）
  let cx = G.camX;
  if (G.phase === 'title' || G.phase === 'loading') { cx = 20 + Math.sin(gameTime * .05) * 22; }
  shakeAmp *= Math.exp(-dt * 9);
  const sx = (Math.random() - .5) * shakeAmp, sy = (Math.random() - .5) * shakeAmp;
  if (xrOn()) {
    if (vrView === 'back' && G.p1 && G.phase !== 'title' && G.phase !== 'loading') vrBackRig(dt);
    else {
      if (rig.rotation.y) { rig.rotation.y = 0; rig.position.x = cx; vrHud.position.set(0, 1.78, -1.9); vrHud.rotation.x = .12; vrBack.y0 = null; }
      rig.scale.setScalar(vrScale);
      rig.position.x += (cx - rig.position.x) * (Math.abs(cx - rig.position.x) > 30 ? 1 : Math.min(1, dt * 2.5));
      rig.position.y = -VR_TABLE * vrScale; rig.position.z = VR_BACK;
    }
    updateVRHud(dt);
  } else {
    XR.on = false;
    if (rig.scale.x !== 1 || rig.rotation.y) { rig.scale.setScalar(1); rig.position.set(0, 0, 0); rig.rotation.y = 0; vrHud.position.set(0, 1.78, -1.9); vrHud.rotation.x = .12; vrBack.y0 = null; vrHud.visible = false; vrBubble.visible = false; }
    const fv = 36 - camPunch * 1.8; if (Math.abs(camera.fov - fv) > .01) { camera.fov = fv; camera.updateProjectionMatrix(); }   // 大きく当たった瞬間、少しだけ寄る
    if (G.cine && G.cine.D.sup) cineCamera(dt, sx, sy);
    else if (G.finale) finaleCamera(dt, sx, sy);
    else { camera.position.set(cx + sx, CAM_Y + sy, CAM_Z); camera.lookAt(cx + sx * .5, LOOK_Y, 0); }
    if (camHook) camHook(camera);
  }
  touchFrame();
  if (running || G.phase === 'paused') updateHUD(dt);
  if (!xrOn() && composer && bloomOn) composer.render(); else renderer.render(scene, camera);
}

// =========================================================================================
// VR（Chrome → SteamVR / OpenXR）: コントローラーと、宙に浮く HUD
// =========================================================================================
const XR = { on: false, mx: 0, mz: 0, atk: false, jump: false, sp: false, rng: false, dodge: false, guard: false, run: false, a: false, prev: {} };
// VR のボタンの割りふり。番号 = 0 トリガー / 1 グリップ（横のにぎり）/ 3 スティック押しこみ / 4 下のボタン（左 X・右 A）/ 5 上のボタン（左 Y・右 B）
// 変えたいときは、ここの名前を入れかえるだけ: atk 攻撃 / jump ジャンプ / dodge よける / guard ガード / sp 必殺 / sup 超必殺 / rng 波動 / duo 連携技 / run 走る / view 視点（長押し）
const VR_PAD = {
  left:  { 0: 'rng', 1: 'duo', 3: 'run', 4: 'sup', 5: 'sp' },        // 左手 = 動きと大技: トリガー 波動 / グリップ 連携技 / Y 必殺 / X 超必殺 / スティック押しこみ 走る
  right: { 0: 'atk', 1: 'guard', 3: 'view', 4: 'jump', 5: 'dodge' },  // 右手 = 基本: トリガー 攻撃 / グリップ ガード / A ジャンプ / B よける / スティック長押し 視点の切りかえ
};
function pollXR(dt) {
  const s = renderer.xr.getSession(); XR.on = !!s;
  XR.atk = XR.jump = XR.sp = XR.a = XR.rng = XR.rngHold = XR.dodge = XR.guard = XR.run = XR.duo = XR.sup = false; let gl = false, gr = false; XR.mx = XR.mz = 0;
  if (!s) return;
  for (const src of s.inputSources) {
    const gp = src.gamepad; if (!gp) continue;
    const h = src.handedness, pv = XR.prev[h] || [];
    const b = (i) => !!gp.buttons[i]?.pressed, e = (i) => b(i) && !pv[i];
    const ax = gp.axes[2] || 0, ay = gp.axes[3] || 0;
    if (h === 'left' || (h !== 'right' && !XR.mx)) { if (Math.abs(ax) > Math.abs(XR.mx)) XR.mx = ax; if (Math.abs(ay) > Math.abs(XR.mz)) XR.mz = ay; }
    const pad = VR_PAD[h] || VR_PAD.right;
    for (const i of [0, 1, 3, 4, 5]) {
      const act = pad[i]; if (!act) continue;
      if (act === 'rng') { if (e(i)) XR.rng = true; if (b(i)) XR.rngHold = true; }
      else if (act === 'guard') { if (b(i)) XR.guard = true; }
      else if (act === 'run') { if (e(i)) XR.runLatch = true; }           // 押すと走りに切りかわる。スティックを戻すと歩きに戻る
      else if (act === 'view') {                                          // 短く押す = 操作の表を光らせる / 0.5 秒押し続ける = 視点の切りかえ
        if (b(i)) { XR.vT = (XR.vT || 0) + dt; if (XR.vT > .5 && !XR.vDone) { XR.vDone = true; setVrView(vrView === 'back' ? 'top' : 'back'); } }
        else { if (XR.vT > 0 && !XR.vDone) VRH.helpT = 5; XR.vT = 0; XR.vDone = false; }
      }
      else if (e(i)) XR[act] = true;
    }
    if (h === 'right') {   // 右スティック上下 = 大きさ（うっかり触っても変わらないように、0.3 秒倒し続けてから）。左右は何もしない
      const up = Math.abs(ay) > .7 && Math.abs(ax) < .5; XR.szT = up ? (XR.szT || 0) + dt : 0;
      if (up && XR.szT > .3) { if (vrView === 'back') vrBackScale = clamp(vrBackScale * (1 + ay * dt * 1.2), .6, 3.5); else vrScale = clamp(vrScale * (1 + ay * dt * 1.2), 2.5, 10); }
    }
    if (e(4)) XR.a = true;   // 結果の画面などを先へ進める: A・X
    XR.prev[h] = gp.buttons.map(x => x.pressed);
  }
  if (Math.hypot(XR.mx, XR.mz) < .3) XR.runLatch = false; if (XR.runLatch) XR.run = true;
  // 結果画面・ゲームオーバーは A / X で先へ
  if (XR.a && G.phase === 'result') { $('result').classList.add('hide'); startGame(); }
  else if (XR.a && G.phase === 'over') continueGame();
  else if (XR.a && G.phase === 'tally') tallyKey();
  else if (XR.a && G.finale) finaleSkip();
}
// 宙に浮く HUD（rig の子。自分の目線の少し上・1.9m 先）
const vrHudCv = document.createElement('canvas'); vrHudCv.width = 2048; vrHudCv.height = 560;
const vrHudTex = new T.CanvasTexture(vrHudCv); vrHudTex.colorSpace = T.SRGBColorSpace;
const vrHud = new T.Mesh(new T.PlaneGeometry(1.5, 1.5 * 560 / 2048), new T.MeshBasicMaterial({ map: vrHudTex, transparent: true, depthTest: false, fog: false }));
vrHud.position.set(0, 1.78, -1.9); vrHud.rotation.x = .12; vrHud.renderOrder = 999; vrHud.visible = false; rig.add(vrHud);
const vrBubCv = document.createElement('canvas'); vrBubCv.width = 1024; vrBubCv.height = 256;
const vrBubTex = new T.CanvasTexture(vrBubCv); vrBubTex.colorSpace = T.SRGBColorSpace;
const vrBubble = new T.Sprite(new T.SpriteMaterial({ map: vrBubTex, transparent: true, depthTest: false, fog: false }));
vrBubble.scale.set(4, 1, 1); vrBubble.renderOrder = 998; vrBubble.visible = false; scene.add(vrBubble);
const VRH = { t: 0, ban: null, bubble: '', bubbleDirty: false, helpT: 0, helpView: '' };
const vrHelpCv = document.createElement('canvas'); vrHelpCv.width = 1024; vrHelpCv.height = 760;
const vrHelpTex = new T.CanvasTexture(vrHelpCv); vrHelpTex.colorSpace = T.SRGBColorSpace;
const vrHelp = new T.Mesh(new T.PlaneGeometry(.86, .86 * 760 / 1024), new T.MeshBasicMaterial({ map: vrHelpTex, transparent: true, opacity: .6, depthTest: false, fog: false }));
vrHelp.position.set(-1.26, -.34, .34); vrHelp.rotation.y = .6; vrHelp.renderOrder = 999; vrHud.add(vrHelp);
const VR_ACT = { atk: '攻撃', jump: 'ジャンプ', dodge: 'よける', guard: 'ガード（にぎっている間）', sp: '必殺', sup: '超必殺（ゲージ 3 本）', rng: '波動（長押しで溜め）', duo: '連携技（ゲージ 1 本）', run: '走る', view: '視点の切りかえ（0.5 秒 長押し）' };
function drawVrHelp() {
  const g = vrHelpCv.getContext('2d'), W = 1024, H = 760; g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(7,10,20,.86)'; g.strokeStyle = '#2BE8C8'; g.lineWidth = 6; g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 28); g.fill(); g.stroke();
  g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = 'bold 44px "Noto Sans JP", sans-serif'; g.fillStyle = '#FFCE4A'; g.fillText('VR の操作', 36, 50);
  g.textAlign = 'right'; g.font = 'bold 34px "Noto Sans JP", sans-serif'; g.fillStyle = '#2BE8C8'; g.fillText('いまの視点: ' + (vrView === 'back' ? '背中から' : '俯瞰'), W - 36, 52);
  const NM = { left: ['トリガー', 'グリップ', '', 'スティックを押す', 'X', 'Y'], right: ['トリガー', 'グリップ', '', 'スティック長押し', 'A', 'B'] };
  const SH = { guard: 'ガード', rng: '波動（長押しで溜め）', duo: '連携技（1 本）', sup: '超必殺（3 本）', view: '視点の切りかえ' };
  const col = (x, title, hand, extra, c) => {
    g.textAlign = 'left'; g.font = 'bold 36px "Noto Sans JP", sans-serif'; g.fillStyle = c; g.fillText(title, x, 118); let y = 182;
    const row = (k, v) => {
      g.font = 'bold 28px "Noto Sans JP", sans-serif'; const w = Math.max(60, g.measureText(k).width + 22);
      g.fillStyle = c; g.beginPath(); g.roundRect(x, y - 23, w, 46, 10); g.fill(); g.fillStyle = '#10121c'; g.fillText(k, x + 11, y + 2);
      let fs = 30; g.font = `bold ${fs}px "Noto Sans JP", sans-serif`; while (g.measureText(v).width > 462 - w - 14 && fs > 18) { fs -= 1; g.font = `bold ${fs}px "Noto Sans JP", sans-serif`; }
      g.fillStyle = '#E8EEFF'; g.fillText(v, x + w + 14, y + 2); y += 72;
    };
    for (const [k, v] of extra) row(k, v);
    for (const i of [0, 1, 4, 5, 3]) { const a = VR_PAD[hand][i]; if (a) row(NM[hand][i], SH[a] || VR_ACT[a]); }
  };
  col(36, '左手 ＝ 動きと大技', 'left', [['スティック', vrView === 'back' ? '移動（前へ倒す＝進む）' : '移動']], '#FFCE4A');
  col(530, '右手 ＝ 基本', 'right', [['スティック上下', '大きさ']], '#2BE8C8');
  g.textAlign = 'center'; g.font = 'bold 27px "Noto Sans JP", sans-serif'; g.fillStyle = '#9fb4e8';
  g.fillText('右スティックを短く押す ＝ この表を明るくする', W / 2, H - 92); g.fillText('右スティックを左右に倒しても、何も起きません', W / 2, H - 50);
  vrHelpTex.needsUpdate = true; VRH.helpView = vrView;
}
function hudBar(x, y, w, h, k, c1, c2, right) {
  x = x; const g = vrHudCv.getContext('2d');
  g.fillStyle = '#1A2340'; g.fillRect(x, y, w, h);
  const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr; const ww = w * clamp(k, 0, 1); g.fillRect(right ? x + w - ww : x, y, ww, h);
  g.strokeStyle = '#33456F'; g.lineWidth = 4; g.strokeRect(x, y, w, h);
}
// ---- VR の視点 ----
// 'top'  = 俯瞰（机の上のジオラマを見下ろす）
// 'back' = 背中から（自分のキャラの後ろ・頭の少し上から、進む方向を見る。等身大）
let vrView = 'top', vrBackScale = 1;
const vrBack = { x: 0, z: 0, y0: null, hx: 0, hz: 0 };
try { const v = Q.get('vrview') || localStorage.getItem('brawl.vrView'); if (v === 'back' || v === 'top') vrView = v; } catch (e) {}
function setVrView(v, quiet) {
  vrView = v === 'back' ? 'back' : 'top'; vrBack.y0 = null;
  try { localStorage.setItem('brawl.vrView', vrView); } catch (e) {}
  document.querySelectorAll('#vrpick button').forEach(b => b.classList.toggle('on', b.dataset.v === vrView));
  if (!quiet) { VRH.ban = { big: vrView === 'back' ? '背中カメラ' : '俯瞰カメラ', sub: '右スティックを 0.5 秒押しこむと切りかえ（T キーでも）', t: 2.4 }; VRH.t = 0; VRH.helpT = 6; try { sfx.ui(); } catch (e) {} }
}
// 背中カメラ: 自分の頭（部屋の中での位置）が、キャラの頭の後ろ・少し上に来るように、足場ごと動かす
function vrBackRig(dt) {
  const P = G.p1, s = vrBackScale, B = vrBack;
  const cp = camera.position, okHead = Math.abs(cp.x) < 3 && Math.abs(cp.z) < 3 && cp.y > .4 && cp.y < 2.4;   // 部屋の中の頭の位置として、ありえる値か
  if (B.y0 == null) { B.x = P.x; B.z = P.z * .9; B.hx = B.hz = 0; B.y0 = 1.5; B.cap = false; }
  if (!B.cap && okHead) { B.cap = true; B.y0 = clamp(cp.y, .9, 2.0); B.hx = cp.x; B.hz = cp.z; }
  if (B.cap && okHead && Math.abs(cp.y - B.y0) > .45) B.y0 += (clamp(cp.y, .9, 2.0) - B.y0) * Math.min(1, dt * 1.5);   // 座った・立ったに合わせ直す
  if (!G.cine) { B.x += (P.x - B.x) * Math.min(1, dt * 5); B.z += (P.z * .9 - B.z) * Math.min(1, dt * 4); }                    // 連携技・超必殺のあいだは、その場から見る
  const headY = (P.body && P.body.headY) || 1.7;
  const ex = B.x - 1.55 * s, ey = headY + .32 + (s - 1) * 1.3, ez = B.z;
  rig.rotation.y = -Math.PI / 2; rig.scale.setScalar(s);
  rig.position.set(ex + s * B.hz, ey - s * B.y0, ez - s * B.hx);
  vrHud.position.set(0, B.y0 + .62, -2.1); vrHud.rotation.x = .3;
}
function updateVRHud(dt) {
  vrHud.visible = G.phase !== 'title' && G.phase !== 'loading';
  if (VRH.helpView !== vrView) drawVrHelp();
  VRH.helpT = Math.max(0, (VRH.helpT || 0) - dt); vrHelp.material.opacity = VRH.helpT > 0 ? 1 : .55;
  if (VRH.ban) VRH.ban.t -= dt;
  VRH.t -= dt;
  if (VRH.t <= 0 && vrHud.visible) {
    VRH.t = .1;
    const g = vrHudCv.getContext('2d'), W = vrHudCv.width, H = vrHudCv.height, P1 = G.p1, P2 = G.p2;
    g.clearRect(0, 0, W, H);
    if (P1 && P2) {
      g.fillStyle = 'rgba(7,10,20,.72)'; g.fillRect(0, 0, W, 170);
      g.font = 'bold 54px "Noto Sans JP", sans-serif'; g.textBaseline = 'top';
      g.fillStyle = '#FFCE4A'; g.textAlign = 'left'; g.fillText('1P ' + P1.name, 30, 16);
      g.fillStyle = '#2BE8C8'; g.textAlign = 'right'; g.fillText(P2.name + ' CLAUDE', W - 30, 16);
      g.font = '600 44px "Chakra Petch", sans-serif'; g.fillStyle = '#E8EEFF';
      g.textAlign = 'left'; g.fillText('SCORE ' + P1.score + (G.mode === 'coop' ? '   ∞' : ''), 30, 126 - 44);
      g.textAlign = 'right'; g.fillText((G.mode === 'coop' ? '∞   ' : '') + 'SCORE ' + P2.score, W - 30, 126 - 44);
      hudBar(30, 132, 820, 28, P1.hp / P1.maxhp, '#FFCE4A', '#FF9A2E', false);
      if (G.mode === 'coop') for (let i = 0; i < 3; i++) { hudBar(30 + i * 180, 166, 170, 12, clamp(((P1.meter || 0) - i * 100) / 100, 0, 1), '#8F6BFF', '#2BE8C8', false); hudBar(W - 30 - 170 - i * 180, 166, 170, 12, clamp(((P2.meter || 0) - i * 100) / 100, 0, 1), '#8F6BFF', '#2BE8C8', true); }
      hudBar(W - 850, 132, 820, 28, P2.hp / P2.maxhp, '#4FA8FF', '#2BE8C8', true);
      g.textAlign = 'center';
      if (G.mode === 'vs') { g.font = '96px "Bungee", sans-serif'; g.fillStyle = '#fff'; g.fillText(String(Math.max(0, Math.ceil(G.roundT))), W / 2, 10); g.font = 'bold 36px "Noto Sans JP"'; g.fillStyle = '#FFCE4A'; g.fillText(G.wins[0] + ' - ' + G.wins[1], W / 2, 118); }
      if (G.mode === 'coop' && G.focus && G.focusT > 0) {
        g.font = 'bold 40px "Noto Sans JP", sans-serif'; g.fillStyle = '#FFB3C6'; g.fillText(G.focus.name, W / 2, 188);
        hudBar(W / 2 - 400, 240, 800, 22, G.focus.hp / G.focus.maxhp, '#FF3D6E', '#8F6BFF', false);
      }
      if (vrView === 'back' && G.mode === 'coop') { const nb = enemies().filter(e => e.state !== 'dead' && e.x < P1.x - 1.2).length; if (nb) { g.textAlign = 'center'; g.font = 'bold 56px "Noto Sans JP", sans-serif'; g.fillStyle = Math.floor(gameTime * 4) % 2 ? '#FF3D6E' : '#FFD0DA'; g.fillText('▼ うしろに敵 ' + nb, W / 2, 16); } }
      if (G.comboT > 0 && G.combo >= 2) { g.textAlign = 'left'; g.font = '88px "Bungee", sans-serif'; g.fillStyle = '#FFCE4A'; g.fillText(G.combo + ' HITS', 40, 200); }
      if (G.mode === 'coop' && G.phase === 'play' && !G.area && G.areaIdx < AREAS.length && (G.areaIdx > 0 || G.time > 2.5) && Math.floor(gameTime * 3) % 2 === 0) { g.textAlign = 'right'; g.font = '96px "Bungee", sans-serif'; g.fillStyle = '#FFCE4A'; g.fillText('GO ▶', W - 40, 200); }
    }
    let big = '', sub = '';
    if (VRH.ban && VRH.ban.t > 0) { big = VRH.ban.big; sub = VRH.ban.sub; }
    if (G.phase === 'result') { big = $('resT').textContent; sub = $('resS').textContent + '　／　A でもう一度'; }
    if (G.phase === 'over') { big = 'GAME OVER'; sub = 'A でコンティニュー'; }
    if (G.phase === 'tally' && G.tally) { big = G.tally.last ? 'ALL CLEAR!!' : 'STAGE CLEAR!'; sub = `TOTAL ${fmt(G.tally.total)}　RANK ${G.tally.rank}　／　A で${G.tally.last ? 'もう一回 押す' : '次の面へ'}`; }
    if (big) {
      g.textAlign = 'center'; g.font = '150px "Bungee", sans-serif';
      const gr = g.createLinearGradient(0, 300, 0, 450); gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(.5, '#FFCE4A'); gr.addColorStop(1, '#FF3D6E');
      g.lineWidth = 14; g.strokeStyle = '#070A14'; g.strokeText(big, W / 2, 290); g.fillStyle = gr; g.fillText(big, W / 2, 290);
      if (sub) { g.font = 'bold 50px "Noto Sans JP", sans-serif'; g.lineWidth = 10; g.strokeText(sub, W / 2, 470); g.fillStyle = '#fff'; g.fillText(sub, W / 2, 470); }
    }
    vrHudTex.needsUpdate = true;
  }
  // Claude の吹き出し（頭の上）
  const P2 = G.p2;
  vrBubble.visible = bubbleT > 0 && !!P2 && !P2.out;
  if (vrBubble.visible) {
    if (VRH.bubbleDirty) {
      VRH.bubbleDirty = false;
      const g = vrBubCv.getContext('2d'); g.clearRect(0, 0, 1024, 256);
      g.fillStyle = 'rgba(7,10,20,.88)'; g.strokeStyle = '#2BE8C8'; g.lineWidth = 10;
      g.beginPath(); g.roundRect(8, 8, 1008, 200, 40); g.fill(); g.stroke();
      g.fillStyle = '#E8EEFF'; g.font = 'bold 56px "Noto Sans JP", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const t = VRH.bubble, n = t.length > 17 ? Math.ceil(t.length / 2) : t.length;
      if (n < t.length) { g.fillText(t.slice(0, n), 512, 75); g.fillText(t.slice(n), 512, 145); } else g.fillText(t, 512, 108);
      vrBubTex.needsUpdate = true;
    }
    const bk = vrView === 'back' ? Math.max(.35, vrBackScale * .4) : 1; vrBubble.scale.set(4 * bk, bk, 1);
    vrBubble.position.set(P2.x, P2.y + (P2.body?.headY || 1.7) + (vrView === 'back' ? .45 : 1.0), P2.z);
  }
}
async function enterVR() {
  try { window.kart?.endOtherXR?.(); } catch (e) {}
  ac();
  let s;
  try { s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] }); }
  catch (e) { log('VR を始められません ' + e.message); alertVR('VR を始められませんでした: ' + e.message); return; }
  await renderer.xr.setSession(s);
  rig.position.x = G.camX;
  log('VR start view=' + vrView);
  VRH.ban = { big: vrView === 'back' ? '背中カメラ' : '俯瞰カメラ', sub: '右スティックを 0.5 秒押しこむと切りかえ。操作は左の表に', t: 4 }; VRH.t = 0; VRH.helpT = 14;
  s.addEventListener('end', () => log('VR end'));
  if (G.phase === 'title') startGame();
}
function alertVR(m, col) { const d = $('vrNote'); if (d) { d.textContent = m || ''; d.style.display = m ? 'block' : 'none'; d.style.color = col || '#FFB3C6'; } }

// =========================================================================================
// タイトル画面
// =========================================================================================
function buildPickers() {
  const list = CHARS.length ? CHARS : [{ name: 'ロボ 1号' }, { name: 'ロボ 2号' }];
  const mk = (rowId, sel, setter) => {
    const row = $(rowId); row.querySelectorAll('button').forEach(b => b.remove());
    list.forEach((ch) => {
      const b = document.createElement('button'); b.textContent = ch.name; if (sel && ch.name === sel.name) b.classList.add('on');
      b.onclick = () => { row.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); setter(ch); ac(); sfx.ui(); };
      row.appendChild(b);
    });
  };
  mk('p1pick', G.p1Char, (c) => { G.p1Char = c; });
  mk('p2pick', G.claudeChar, (c) => { G.claudeChar = c; });
}
document.querySelectorAll('.mode').forEach(b => b.onclick = () => { document.querySelectorAll('.mode').forEach(x => x.classList.remove('on')); b.classList.add('on'); G.mode = b.dataset.mode; ac(); sfx.ui(); });
for (const [row, key] of [['s1pick', 'p1Style'], ['s2pick', 'p2Style']]) {
  let sv = Q.get(key === 'p1Style' ? 'style1' : 'style2'); try { sv = sv || localStorage.getItem('brawl.' + key); } catch (e) {}
  G[key] = STYLES[sv] ? sv : 'female';
  document.querySelectorAll('#' + row + ' button').forEach(b => { b.classList.toggle('on', b.dataset.s === G[key]); b.onclick = () => { document.querySelectorAll('#' + row + ' button').forEach(x => x.classList.remove('on')); b.classList.add('on'); G[key] = b.dataset.s; try { localStorage.setItem('brawl.' + key, G[key]); } catch (e) {} ac(); sfx.ui(); }; });
}
document.querySelectorAll('#vrpick button').forEach(b => { b.onclick = () => { setVrView(b.dataset.v, true); ac(); sfx.ui(); }; }); setVrView(vrView, true);
document.querySelectorAll('#diffpick button').forEach(b => b.onclick = () => { document.querySelectorAll('#diffpick button').forEach(x => x.classList.remove('on')); b.classList.add('on'); G.diff = +b.dataset.d; ac(); sfx.ui(); });
[...document.querySelectorAll('#title .card > *')].forEach((el, i) => el.style.setProperty('--i', i));
$('startBtn').onclick = () => startGame();
$('resumeBtn').onclick = () => togglePause();
$('quitBtn').onclick = () => toTitle();
$('againBtn').onclick = () => { $('result').classList.add('hide'); startGame(); };
$('titleBtn').onclick = () => toTitle();
$('scNext').onclick = () => tallyAdvance();
$('scTitle').onclick = () => toTitle();

(async () => {
  try {
    if (API?.characters) {
      const [list, desk] = await Promise.all([API.characters(), API.getCharacter ? API.getCharacter() : null]);
      CHARS = (list || []).filter(c => c && c.vrm);
      G.claudeChar = CHARS.find(c => desk && c.name === desk.name) || CHARS[0] || null;
      G.p1Char = CHARS.find(c => c !== G.claudeChar && c.name !== 'マヌルネコ' && c.name !== 'リアルマヌルネコ') || CHARS[0] || null;
    }
  } catch (e) { log('キャラ一覧の取得に失敗 ' + e.message); }
  // テスト用: ?p1vrm=URL&p2vrm=URL
  if (Q.get('p1vrm')) { G.p1Char = { name: Q.get('p1name') || 'テスト1', vrm: Q.get('p1vrm') }; CHARS.push(G.p1Char); }
  if (Q.get('p2vrm')) { G.claudeChar = { name: Q.get('p2name') || 'テスト2', vrm: Q.get('p2vrm'), personality: 'genki' }; CHARS.push(G.claudeChar); }
  if (!G.claudeChar) G.claudeChar = { name: 'Claude', personality: 'genki' };
  if (!G.p1Char) G.p1Char = { name: 'YOU' };
  if (Q.get('mode')) { G.mode = Q.get('mode'); document.querySelectorAll('.mode').forEach(x => x.classList.toggle('on', x.dataset.mode === G.mode)); }
  buildPickers();
  loadMotionCfg().then(loadSamples).catch(() => {});   // 録音された効果音を読んでおく
  // モーションを先に読んでおく（START を押してからの待ち時間を減らす）
  loadMotionCfg().then(() => Promise.all([loadProfile(MOTION_CFG.hero || 'female', 'hero'), loadProfile(MOTION_CFG.enemy || 'karate', 'enemy')])).catch(() => {});
  if (Q.get('autostart')) startGame();
})();
// ---- 配る版: 自分の VRM を読みこんで遊ぶ（ファイルはブラウザの中だけで使う。どこにも送らない）----
if (WEB) {
  document.body.classList.add('web');
  const inp = $('vrmFile'), note = (m, bad) => { const el = $('vrmNote'); el.textContent = m; el.style.color = bad ? '#ff8aa6' : ''; };
  let who = 1;
  // 最初の質問: スマホか、パソコンか → パソコンなら、そのままのキャラか、自分の VRM か → タイトルへ
  const en = $('entry'), entryOpen = () => !en.classList.contains('hide');
  const entryDone = () => { en.classList.add('hide'); if (G.phase === 'title') $('title').classList.remove('hide'); };
  if (!Q.get('autostart') && Q.get('entry') !== '0') {
    en.classList.remove('hide'); $('title').classList.add('hide');
    $('eSp').onclick = () => { ac(); sfx.ui(); touchSetup(); entryDone(); };
    $('ePc').onclick = () => { ac(); sfx.ui(); $('entry1').classList.add('hide'); $('entry2').classList.remove('hide'); };
    $('eDef').onclick = () => { ac(); sfx.ui(); entryDone(); };
    $('eVrm').onclick = () => { ac(); who = 1; inp.value = ''; inp.click(); };
  }
  const add = (file, w) => {
    if (!file) return;
    if (!/\.vrm$/i.test(file.name)) { note('VRM ファイル（.vrm）を選んでください', true); $('eNote').textContent = 'VRM ファイル（.vrm）を選んでください'; return; }
    if (G.phase !== 'title') return;
    const c = { name: file.name.replace(/\.vrm$/i, '').slice(0, 14) || 'MY VRM', vrm: URL.createObjectURL(file), personality: 'genki', own: true };
    CHARS.push(c); if (w === 2) G.claudeChar = c; else G.p1Char = c;
    if (entryOpen()) entryDone();
    buildPickers(); note('「' + c.name + '」を' + (w === 2 ? '相棒' : 'あなた') + 'にしました（ファイルは、このブラウザの中だけで使います）'); try { ac(); sfx.ui(); } catch (e) {}
  };
  $('vrmBtn').onclick = () => { who = 1; inp.value = ''; inp.click(); };
  $('vrmBtn2').onclick = () => { who = 2; inp.value = ''; inp.click(); };
  inp.onchange = () => add(inp.files && inp.files[0], who);
  addEventListener('dragover', (e) => { e.preventDefault(); });
  addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; add(f, e.shiftKey ? 2 : 1); });
}
const VRB = { ok: false, asked: -1e9, up: 0, msg: '', said: null };
const vrGo = (v) => { setVrView(v, true); if (VRB.ok) return enterVR(); ac(); alertVR('まだ VR に入れません。' + (VRB.msg || 'ゴーグルと SteamVR の準備を待っています…')); vrSetup(true); };
$('vrBtn').onclick = () => vrGo('back');
$('vrBtn2').onclick = () => vrGo('top');
async function vrSetup(now) {
  const b1 = $('vrBtn'), b2 = $('vrBtn2'); if (!b1 || !b2) return;
  clearTimeout(vrSetup.tm);
  const ok = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false));
  if (ok !== VRB.said) { VRB.said = ok; log('xr supported: ' + ok + (API?.web ? ' (chrome)' : ' (app)')); }
  VRB.ok = ok;
  if (WEB) { b1.style.display = b2.style.display = ok ? '' : 'none'; b1.classList.remove('wait'); b2.classList.remove('wait'); return; }
  if (!API?.web && !ok) { alertVR('VR で遊ぶとき: キャラを右クリック →「殴り合いを VR で」（Chrome で開きます。視点は、そこで出る 2 つのボタンで選べます）', '#9fb4e8'); return; }   // アプリの窓では VR に入れない
  b1.style.display = b2.style.display = ''; b1.classList.toggle('wait', !ok); b2.classList.toggle('wait', !ok);
  if (ok) { VRB.msg = ''; alertVR(''); return; }
  // まだ使えない: 係（127.0.0.1:48846）に、ゴーグルと SteamVR のようすを聞く。SteamVR が止まっているだけなら、起動を頼む
  const get = async (p, ms) => { const c = new AbortController(), tm = setTimeout(() => c.abort(), ms); try { return await (await fetch('http://127.0.0.1:48846' + p, { signal: c.signal })).json(); } catch (e) { return null; } finally { clearTimeout(tm); } };
  const t = performance.now(); let msg = 'ゴーグルを Link でつなぎ、SteamVR を起動してください。つながると、このボタンが押せるようになります';
  const st = await get('/vr', 3000);
  if (st && st.ok && !st.link) { msg = 'ゴーグルが Link でつながっていません。Quest で Link を始めてください'; VRB.up = 0; }
  else if (st && st.ok && !st.steamvr) {
    VRB.up = 0; msg = 'SteamVR を起動しています…（20 秒ほど）';
    if (t - VRB.asked > 40000) { VRB.asked = t; const r = await get('/vr/start?k=' + encodeURIComponent(window.DIVE_TOKEN || ''), 8000); log('xr helper: steamvr start ' + (r && r.ok ? 'requested' : 'NG ' + ((r && r.error) || ''))); if (!(r && r.ok)) msg = 'SteamVR が止まっています。SteamVR を起動してください'; }
  } else if (st && st.ok && st.steamvr) {
    msg = 'SteamVR は動いています。もうすぐ入れます…（入れないときは F5）'; if (!VRB.up) VRB.up = t;
    if (t - VRB.up > 15000 && document.visibilityState === 'visible' && G.phase === 'title') {   // SteamVR が動いているのに Chrome が「使えない」と言い続ける → 1 回だけ読みこみ直す
      let last = 0; try { last = +sessionStorage.getItem('vrReloadAtB') || 0; } catch (e) {}
      if (Date.now() - last > 120000) { try { sessionStorage.setItem('vrReloadAtB', String(Date.now())); } catch (e) {} log('xr helper: reload (steamvr is up, xr still unsupported)'); location.reload(); return; }
    }
  }
  VRB.msg = msg; alertVR('VR: ' + msg);
  vrSetup.tm = setTimeout(vrSetup, 4000);
}
addEventListener('focus', () => { if (!VRB.ok) vrSetup(); }); document.addEventListener('visibilitychange', () => { if (!VRB.ok && document.visibilityState === 'visible') vrSetup(); });
navigator.xr?.addEventListener?.('devicechange', () => vrSetup());
vrSetup();
window.__brawl = { TP, touchSetup, CLIPS, PROFILES, STYLES, DUOS, SUPER_PRE, loadProfile, loadClip, loadDuoClips, loadMotionCfg, motionCfg: () => MOTION_CFG, SMP, T, weaponSync, finaleStart, finaleTick, finaleEnd, finaleSkip, finaleDebug, fin: () => G.finale, voidFx: () => voidFx, VR_PAD, drawVrHelp, vrHelpCv, XR, xrTest: (sources, dt = 1 / 60) => { const o = renderer.xr.getSession; renderer.xr.getSession = () => ({ inputSources: sources }); try { pollXR(dt); } finally { renderer.xr.getSession = o; } return JSON.parse(JSON.stringify({ ...XR, prev: undefined, view: vrView })); }, spin: (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) { gameTime += dt; if (hitStop > 0) hitStop -= dt; else if (G.phase === 'play' || G.phase === 'ending' || G.phase === 'tally') sim(dt); if (G.finale) finaleTick(dt); for (const f of fighters) { if (f.body && !f.out) vfxFighter(f, dt, false); } for (const fn of stageAnim) fn(dt); gimFrame(dt); updateFx(dt); } }, fxStep: (dt) => { for (const f of fighters) vfxFighter(f, dt, false); updateFx(dt); }, flow, curlNoise, hermite, noiseGrad, rig, vrHud, vrBackRig, setVrView, vrView: () => vrView, DUOS, startDuo, tryDuo, trySuper, addMeter, cine: () => G.cine, hs: (v) => { if (v != null) hitStop = v; return hitStop; }, gims: () => gims, holes: () => holes, vends: () => vends, doors: () => stageDoors, items: () => items, spawnItem, COPY, takeCapsule, pressGag, envHit, gag: () => gag, hazards: () => hazards, spawnBolts, blinkAway, WEAPONS, spawnWeapon, holdWeapon, pickWeapon, gweapons: () => gweapons, STAGES, ENEMIES, enterStage, stageClear, tallyKey, buildStage, theme: () => stageTheme, flushFx: () => { for (const e of fx) scene.remove(e.o); fx = []; }, sfx, fx: { glow, smoke, streaks, trails, fxHit, fxKO, fxExplode, fxSpecial, fxClear, numFx }, comboHit, CLIPS, PROFILES, shots: () => shots, startMove, startDodge, applyHit, aiEnemy, nearestHero, getEngaged: () => engaged, halfW: () => halfW, G, fighters: () => fighters, startGame, spawnEnemy, keys, pressed, MOVES, camera, setCam: (fn) => { camHook = fn; }, setInput: (fn) => { inputOverride = fn; }, step: (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) { if (G.phase !== 'play' && G.phase !== 'ending' && G.phase !== 'tally') break; if (hitStop > 0) { hitStop -= dt; continue; } sim(dt); if (G.finale) finaleTick(dt); } } };
renderer.setAnimationLoop(frame);
log('ready');

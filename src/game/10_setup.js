// SHASHLIK NIGHT: first-person grill-out with friends.
// All models, textures, rigs and animation clips come from build_models.py (procedural Python), embedded as a gzipped GLB.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { SFX } from './audio.js';
import { NET, MAX_PLAYERS, detectBackend, netLog } from './net.js';
import { Particles } from './particles.js';

// ------------------------------------------------------------------ tuning
const CONFIG = {
  nightLength: 300,          // seconds per night (19:30 -> 00:30)
  slots: 6,
  reach: 2.6,
  walk: 2.3, sprint: 3.8,
  cookTime: { pork: 21, chicken: 17, veg: 11, lamb: 14 }, // seconds per side at ideal heat
  patience: 85, patienceMin: 48,
  fuelBurn: 0.0036, charcoalCost: 15,
  firstOrder: 4,
};
const TYPES = {
  pork:    { name: 'Свинина', acc: 'свинину', icon: '🥩', level: 1, base: 100, fat: 1.0, raw: 0.45, dark: [0.36, 0.16, 0.07], light: [0.82, 0.55, 0.25], src: 'Ведро со свининой' },
  veg:     { name: 'Овощи', acc: 'овощи', icon: '🫑', level: 1, base: 65, fat: 0.12, raw: 0.4, veg: true, src: 'Ящик с овощами' },
  chicken: { name: 'Курица', acc: 'курицу', icon: '🍗', level: 2, base: 95, fat: 0.55, raw: 0.62, dark: [0.60, 0.34, 0.12], light: [0.92, 0.70, 0.36], src: 'Миска с курицей' },
  lamb:    { name: 'Люля-кебаб', acc: 'люля-кебаб', icon: '🍢', level: 3, base: 135, fat: 1.45, raw: 0.5, dark: [0.30, 0.13, 0.06], light: [0.64, 0.40, 0.20], src: 'Тарелка с люля' },
};
const RECIPES = {
  pork: ['pork_0', 'onion_0', 'pork_1', 'pork_2', 'onion_1', 'pork_3', 'pork_1', 'pork_0'],
  chicken: ['chicken_0', 'chicken_1', 'pepper_r', 'chicken_2', 'chicken_3', 'pepper_g', 'chicken_0', 'chicken_1'],
  veg: ['tomato', 'pepper_r', 'zucchini', 'mushroom', 'pepper_g', 'onion_0', 'zucchini', 'tomato'],
  lamb: ['lyulya'],
};
const FRIENDS = [
  { key: 'A', name: 'Вася', seat: 'chair_2', x: 2.35, z: 0.55, fav: 'pork', pitch: 105, level: 1, lines: ['Шашлык пора!', 'Где моё мясо?', 'Мясо давай!'] },
  { key: 'B', name: 'Лена', seat: 'log_seat', x: 3.05, z: -0.85, fav: 'veg', pitch: 215, level: 1, lines: ['А овощи будут?', 'Я умираю с голоду!', 'Ну скоро?'] },
  { key: 'C', name: 'Дима', seat: 'chair_0', x: 2.6, z: -2.25, fav: 'lamb', pitch: 125, level: 1, guitar: true, lines: ['Шампур барду!', 'Песню за шампур?', 'Хочу шашлык!'] },
  { key: 'D', name: 'Катя', seat: 'chair_1', x: 1.25, z: -3.15, fav: 'chicken', pitch: 235, level: 4, lines: ['Курочку, пожалуйста!', 'Уже готово?', 'Курочку!'] },
];
const ACH = [
  { id: 'perfect', i: '🥇', t: 'Золотая корочка: подать идеальный шампур' },
  { id: 'combo5', i: '🔥', t: 'В ударе: 5 идеальных подряд' },
  { id: 'shoo3', i: '🐕', t: 'Не сегодня, Шарик: прогнать пса 3 раза' },
  { id: 'feed', i: '🦴', t: 'Лучшие друзья: накормить Шарика шашлыком' },
  { id: 'fire10', i: '🧯', t: 'Пожарный: потушить 10 вспышек' },
  { id: 'coal', i: '⚫', t: 'Жертва огню: превратить шампур в уголь' },
  { id: 'survive', i: '🌙', t: 'До последнего уголька: продержаться всю ночь' },
  { id: 'stars3', i: '⭐', t: 'Мастер мангала: 3 звезды за ночь' },
  { id: 'salmon', i: '🤢', t: 'Спидран сальмонеллы: подать сырую курицу' },
  { id: 'rich', i: '💰', t: 'Олигарх: заработать 3000 ₽ за ночь' },
];
const TITLES = ['Новичок у мангала', 'Ученик шампура', 'Заклинатель углей', 'Сержант гриля', 'Мастер шашлыка', 'Легенда дачи'];
const UNLOCKS = [{ l: 1, i: '🥩', t: 'Свинина' }, { l: 1, i: '🫑', t: 'Овощи' }, { l: 2, i: '🍗', t: 'Курица' }, { l: 3, i: '🍢', t: 'Люля-кебаб' }, { l: 4, i: '👩', t: 'Приходит Катя' }, { l: 5, i: '✨', t: 'Золотые шампуры, +10% чаевых' }];

// ------------------------------------------------------------------ save
const SKEY = 'shashlik-night-v1';
const save = Object.assign({ name: '', xp: 0, best: 0, nights: 0, perfect: 0, served: 0, shoo: 0, fed: 0, flares: 0, ach: {}, tut: false, quality: 'high', muted: false },
  (() => { try { return JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch (e) { return {}; } })());
const persist = () => { try { localStorage.setItem(SKEY, JSON.stringify(save)); } catch (e) { } };
const xpAt = L => 75 * L * (L - 1);
const levelOf = xp => { let L = 1; while (xp >= xpAt(L + 1)) L++; return L; };

// ------------------------------------------------------------------ helpers
const $ = id => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window && navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');
const kb = h => !isTouch ? h : h.replace(/<kbd>Держи F<\/kbd>/g, '<kbd>Держи ВЕЕР</kbd>').replace(/<kbd>ЛКМ<\/kbd>/g, '<kbd>ДЕЙСТВИЕ</kbd>').replace(/<kbd>E<\/kbd>/g, '<kbd>СНЯТЬ</kbd>').replace(/<kbd>F<\/kbd>/g, '<kbd>ВЕЕР</kbd>').replace(/<kbd>Q<\/kbd>/g, '<kbd>ВОДА</kbd>').replace(/<kbd>Клик<\/kbd>/g, '<kbd>Касание</kbd>');

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.03, 650);
camera.rotation.order = 'YXZ';
scene.add(camera);
scene.fog = new THREE.Fog(0x8a6a5a, 28, 170);
const UT = { value: 0 };     // shared time uniform
const UHEAT = { value: 0.8 };
let composer, bloom, quality = new URLSearchParams(location.search).get('q') || save.quality || 'high';

function setupComposer() {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.45, 0.97);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}
function applyQuality() {
  const hi = quality === 'high';
  renderer.setPixelRatio(Math.min(devicePixelRatio, hi ? 1.75 : 1));
  renderer.shadowMap.enabled = true;
  if (sunL) { sunL.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024); if (sunL.shadow.map) { sunL.shadow.map.dispose(); sunL.shadow.map = null; } }
  if (grassMeshes) grassMeshes.forEach(g => g.count = hi ? g.userData.full : Math.floor(g.userData.full * 0.35));
  resize();
  if (window.__syncSettingsUI) window.__syncSettingsUI();
  save.quality = quality; persist();
}
function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
  const sc = h * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  [smoke, embers, flames].forEach(p => p && (p.mat.uniforms.uScale.value = sc));
}
addEventListener('resize', resize);

// sky, lights
const sky = new Sky(); sky.scale.setScalar(520); scene.add(sky);
const skyU = sky.material.uniforms;
skyU.turbidity.value = 6; skyU.rayleigh.value = 2.2; skyU.mieCoefficient.value = 0.006; skyU.mieDirectionalG.value = 0.82;
skyU.cloudCoverage.value = 0.32; skyU.cloudDensity.value = 0.35; skyU.cloudScale.value = 0.00025;
const hemi = new THREE.HemisphereLight(0xc8d0e8, 0x3c2c1e, 0.9); scene.add(hemi);
const sunL = new THREE.DirectionalLight(0xffc89a, 2.3);
sunL.castShadow = true; sunL.shadow.mapSize.set(2048, 2048);
Object.assign(sunL.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 70 });
sunL.shadow.bias = -0.0004; sunL.shadow.normalBias = 0.025;
scene.add(sunL, sunL.target);
const M0 = V(0, 0, -1.2);           // mangal position
const MANGAL_TOP = 0.78;
const PLATE = V(0.9, 0.48, -0.5);  // serving plate on a stool: parks finished skewers
const fireL = new THREE.PointLight(0xff7a30, 0, 9, 1.35); fireL.position.set(M0.x, 1.18, M0.z + 0.05); scene.add(fireL);
const lanternL = new THREE.PointLight(0xffb565, 0, 6, 1.7); scene.add(lanternL);
const fairyLs = [new THREE.PointLight(0xffc27a, 0, 9, 1.5), new THREE.PointLight(0xffc27a, 0, 9, 1.5)]; fairyLs.forEach(l => scene.add(l));

// stars + moon
const stars = (() => {
  const n = 1600, p = new Float32Array(n * 3), s = new Float32Array(n), r = mulberry(7);
  for (let i = 0; i < n; i++) {
    const u = r() * 2 * Math.PI, v = Math.acos(1 - r() * 0.95);
    p.set([Math.sin(v) * Math.cos(u) * 400, Math.cos(v) * 400, Math.sin(v) * Math.sin(u) * 400], i * 3); s[i] = 0.6 + r() * r() * 2.6;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aS', new THREE.BufferAttribute(s, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uO: { value: 0 }, uTime: UT },
    vertexShader: 'attribute float aS; varying float vT; uniform float uTime; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; vT = 0.6+0.4*sin(uTime*2.0+position.x*7.0); gl_PointSize = aS*1.6; }',
    fragmentShader: 'uniform float uO; varying float vT; void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d); gl_FragColor=vec4(vec3(1.,.95,.85)*1.6, a*uO*vT); }'
  });
  const pts = new THREE.Points(g, m); pts.renderOrder = -1; pts.frustumCulled = false; scene.add(pts); return pts;
})();
const moon = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.9), fog: false, transparent: true }));
scene.add(moon);

// particles
let smoke, embers, flames;
smoke = new Particles(scene, 320, { soft: 0.5, order: 11 });
embers = new Particles(scene, 260, { additive: true, soft: 0.42, order: 12 });
flames = new Particles(scene, 220, { additive: true, soft: 0.5, order: 13 });
const fireflies = new Particles(scene, 60, { additive: true, soft: 0.45, order: 12 });

// ------------------------------------------------------------------ assets
async function loadGLB() {
  const bin = Uint8Array.from(atob(window.__ASSETS), c => c.charCodeAt(0));
  let buf;
  if ('DecompressionStream' in window) {
    buf = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  } else throw new Error('Этот браузер слишком старый, чтобы распаковать модели (нужен DecompressionStream).');
  return await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
}

let gltf, grassMeshes = [];
const get = n => gltf.scene.getObjectByName(n);
const meshesOf = o => { const r = []; o.traverse(c => c.isMesh && r.push(c)); return r; };
const colliders = [];   // [x, z, r]
const proxies = [];
const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
function proxy(w, h, d, x, y, z, data, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), proxyMat); m.position.set(x, y, z); m.userData = data; parent.add(m); proxies.push(m); return m;
}
function place(name, x, y, z, ry = 0, s = 1, cast = true) {
  const o = get(name).clone(); o.position.set(x, y, z); o.rotation.y = ry;
  if (typeof s === 'number') o.scale.setScalar(s); else o.scale.set(...s);
  o.traverse(c => { if (c.isMesh) { c.castShadow = cast; c.receiveShadow = true; } });
  scene.add(o); return o;
}

// GLSL noise used by several patched materials
const NOISE = `
float hash13(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z); }`;

function windPatch(mat, kind) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = UT;
    const lift = kind === 'grass' ? '0.0' : '1.5';
    const body = kind === 'grass'
      ? 'transformed.x += sin(ph + position.y*3.0)*0.10*hgt; transformed.z += cos(ph*0.8)*0.07*hgt;'
      : 'transformed.x += sin(ph)*0.010*hgt + sin(uTime*3.3 + position.x*2.0 + position.z*1.7)*0.03*min(hgt,1.0); transformed.z += cos(ph*0.9)*0.010*hgt + cos(uTime*2.9 + position.y*2.3)*0.028*min(hgt,1.0);';
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      vec3 wO = (modelMatrix * instanceMatrix * vec4(0.,0.,0.,1.)).xyz;
      #else
      vec3 wO = (modelMatrix * vec4(0.,0.,0.,1.)).xyz;
      #endif
      float hgt = max(position.y - ${lift}, 0.0);
      float ph = uTime*${kind === 'grass' ? '1.7' : '1.1'} + wO.x*0.37 + wO.z*0.29;
      ${body}`);
  };
  mat.customProgramCacheKey = () => 'wind-' + kind;
}

function patchMaterials() {
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material; if (!m || m.userData.patched) return; m.userData.patched = true;
    if (m.map) { m.map.anisotropy = 8; }
    if (m.name === 'leaf_birch' || m.name === 'leaf_spruce') { windPatch(m, 'leaf'); m.side = THREE.FrontSide; }
    if (m.name === 'grass') { windPatch(m, 'grass'); }
    if (m.name === 'dirt') { m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
    if (m.name === 'fabric') m.side = THREE.DoubleSide;
    if (m.name === 'coal') {
      m.onBeforeCompile = sh => {
        sh.uniforms.uTime = UT; sh.uniforms.uHeat = UHEAT;
        sh.vertexShader = 'varying vec3 vCP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCP = position;');
        sh.fragmentShader = 'varying vec3 vCP; uniform float uTime; uniform float uHeat;\n' + NOISE + '\n' + sh.fragmentShader
          .replace('#include <color_fragment>', `#include <color_fragment>
            vec3 cc = vColor.rgb;
            diffuseColor.rgb = mix(vec3(0.028,0.026,0.024), vec3(0.42,0.40,0.38), cc.g*(0.35+0.65*clamp(1.25-uHeat,0.0,1.0)));`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            float fl = vnoise(vec3(vCP.x*28.0, vCP.z*28.0+uTime*0.7, uTime*1.6));
            float fl2 = vnoise(vCP*140.0 + uTime*0.3);
            totalEmissiveRadiance = vec3(1.0,0.30,0.06) * pow(cc.r,1.5) * uHeat * (0.35+1.1*fl) * (0.5+0.8*fl2) * (1.0 - 0.75*cc.g*clamp(1.4-uHeat,0.0,1.0)) * 1.25;`);
      };
      m.customProgramCacheKey = () => 'coal';
    }
  });
}

// ------------------------------------------------------------------ world
const mats = {};
const fpMats = [];
let skewerBladeGeo, skewerBladeMat, goldMat, fpArm, fpHand, fpCardboard, fpSpray, guitarObj, mugObj, fairyBulbs, lanternMat, holeMat;
const skewerGeos = {};
function buildWorld() {
  patchMaterials();
  { const gr = get('ground'); gr.traverse(c => { if (c.isMesh) c.receiveShadow = true; }); scene.add(gr); }
  place('dirt_patch', 0.2, 0, -0.9, 0.3, 1, false);
  const mg = place('mangal', M0.x, 0, M0.z);
  holeMat = meshesOf(mg).map(m => m.material).find(m => m.name === 'hole');
  place('coals', M0.x, 0, M0.z, 0, 1, false);
  colliders.push([M0.x - 0.25, M0.z, 0.42], [M0.x + 0.25, M0.z, 0.42]);
  // prep area
  place('prep_table', -1.6, 0, -1.15, 0, [1.4, 1, 1]);
  colliders.push([-1.25, -1.15, 0.42], [-1.95, -1.15, 0.42]);
  const srcs = [['bowl_chicken', 'chicken', -2.05, 0.72, -1.15], ['crate_veg', 'veg', -1.6, 0.72, -1.15], ['plate_lamb', 'lamb', -1.15, 0.72, -1.1], ['bucket_pork', 'pork', -0.8, 0, -0.78]];
  for (const [n, t, x, y, z] of srcs) {
    place(n, x, y, z, rnd(-0.3, 0.3));
    const h = n === 'bucket_pork' ? [0.36, 0.5, 0.36, x, 0.25, z] : [0.42, 0.25, 0.32, x, y + 0.1, z];
    proxy(h[0], h[1], h[2], h[3], h[4], h[5], { kind: 'source', type: t });
  }
  colliders.push([-0.8, -0.78, 0.24]);
  place('charcoal_bag', 0.82, 0, -1.08, -0.35); proxy(0.42, 0.6, 0.3, 0.82, 0.3, -1.08, { kind: 'charcoal' }); colliders.push([0.82, -1.08, 0.24]);
  place('trash_bag', 1.45, 0, -0.2, 0.6); proxy(0.5, 0.6, 0.45, 1.45, 0.3, -0.2, { kind: 'trash' }); colliders.push([1.45, -0.2, 0.26]);
  place('serving_stool', PLATE.x, 0, PLATE.z, 0.3); proxy(0.46, 0.5, 0.46, PLATE.x, 0.3, PLATE.z, { kind: 'plate' }); colliders.push([PLATE.x, PLATE.z, 0.24]);
  place('spray', -1.25, 0.72, -0.98, 0.4); place('cardboard', 0.45, 0, -0.98, 0.2).rotation.x = -0.35;
  // slots + mangal proxy
  for (let i = 0; i < CONFIG.slots; i++) proxy(0.1, 0.14, 0.72, slotX(i), MANGAL_TOP + 0.03, M0.z + 0.06, { kind: 'slot', i });
  proxy(1.0, 0.78, 0.4, M0.x, 0.39, M0.z, { kind: 'mangal' });
  // camp
  place('stump_axe', -2.7, 0, -2.9, 0.6); colliders.push([-2.7, -2.9, 0.34]);
  place('firewood', -3.35, 0, -2.0, 0.5); colliders.push([-3.35, -2.0, 0.4]);
  place('tent', -4.5, 0, -5.0, 0.72); colliders.push([-4.5, -5.0, 1.3]);
  const tr = Math.PI / 2 + 0.28;
  place('picnic_table', 4.25, 0, -1.2, tr); place('lantern_glass', 4.25, 0, -1.2, tr, 1, false);
  colliders.push([4.25 + Math.sin(tr) * 0.5, -1.2 + Math.cos(tr) * 0.5, 0.55], [4.25 - Math.sin(tr) * 0.5, -1.2 - Math.cos(tr) * 0.5, 0.55]);
  lanternL.position.set(4.25 + Math.sin(tr) * 0.05, 0.95, -1.2 + Math.cos(tr) * 0.05);
  lanternMat = meshesOf(get('lantern_glass'))[0].material;
  place('mug', 4.1, 0.75, -0.75, 1.2);
  [[6, -2.5, 0], [-3.5, 2.8, 1], [3.5, 3.6, 2], [-6.5, -1.2, 1], [0.5, -6.2, 0]].forEach(([x, z, k]) => { place('rock_' + k, x, 0, z, rnd(0, 6)); colliders.push([x, z, 0.4]); });
  // skewer resources
  const sk = get('skewer'); const skm = sk.isMesh ? sk : meshesOf(sk)[0];
  skewerBladeGeo = skm.geometry; skewerBladeMat = skm.material;
  goldMat = skewerBladeMat.clone(); goldMat.color.setRGB(1.0, 0.72, 0.28); goldMat.roughness = 0.2;
  const floatGeo = n => { const g = meshesOf(get(n))[0].geometry.clone(); for (const a of ['normal', 'color']) { const at = g.getAttribute(a); if (at && at.normalized) { const f = new Float32Array(at.count * 3); for (let i = 0; i < at.count; i++) { f[i * 3] = at.getX(i); f[i * 3 + 1] = at.getY(i); f[i * 3 + 2] = at.getZ(i); } g.setAttribute(a, new THREE.BufferAttribute(f, 3)); } } return g; };
  for (const t of Object.keys(RECIPES)) {
    skewerGeos[t] = [];
    for (let v = 0; v < 3; v++) {
      const r = mulberry(100 + v * 7 + t.length * 13), list = RECIPES[t], parts = [];
      const n = list.length;
      list.forEach((name, i) => {
        const g = floatGeo(name);
        const m = new THREE.Matrix4().makeRotationZ(r() * Math.PI * 2);
        const z = n === 1 ? -0.005 : -0.122 + i * (0.24 / (n - 1)) + (r() - 0.5) * 0.006;
        m.premultiply(new THREE.Matrix4().makeTranslation((r() - 0.5) * 0.004, (r() - 0.5) * 0.004, z));
        g.applyMatrix4(m); parts.push(g);
      });
      const merged = mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g));
      merged.computeBoundingSphere();
      skewerGeos[t].push(merged);
    }
  }
  // seats & friends
  for (const f of FRIENDS) {
    const ry = Math.atan2(0.3 - f.x, -1.0 - f.z);
    place(f.seat, f.x, 0, f.z, ry);
    colliders.push([f.x, f.z, 0.5]);
    f.ry = ry;
  }
  // fairy lights
  buildFairyLights();
  // vegetation
  buildTrees();
  buildGrass();
  // first-person arm + tools
  fpArm = new THREE.Group();
  const arm = get('fp_arm').clone(); arm.traverse(c => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; c.material = c.material.clone(); c.material.emissive = c.material.color.clone().multiplyScalar(0.25); c.material.emissiveIntensity = 0.2; if (c.material.map) c.material.emissiveMap = c.material.map; fpMats.push(c.material); } });
  fpArm.add(arm); fpHand = arm;
  fpCardboard = get('cardboard').clone(); fpCardboard.position.set(0, -0.02, -0.05); fpCardboard.rotation.set(0.2, 0, 0); fpCardboard.visible = false; fpArm.add(fpCardboard);
  fpSpray = get('spray').clone(); fpSpray.position.set(0, -0.09, -0.02); fpSpray.visible = false; fpArm.add(fpSpray);
  camera.add(fpArm);
  guitarObj = get('guitar'); mugObj = get('mug').clone(); scene.add(mugObj); mugObj.visible = false;
}

function slotX(i) { return M0.x - 0.3 + i * 0.12; }

function buildFairyLights() {
  const poles = [[1.5, 1.1], [4.95, -0.1], [4.7, -3.7], [1.2, -4.75]];
  const bulbs = [], wire = [];
  const H = 2.45;
  const pg = new THREE.CylinderGeometry(0.035, 0.045, H + 0.1, 8); pg.translate(0, (H + 0.1) / 2, 0);
  const pm = new THREE.MeshStandardMaterial({ color: 0x6b5340, roughness: 0.9 });
  poles.forEach(([x, z]) => { const p = new THREE.Mesh(pg, pm); p.position.set(x, 0, z); p.castShadow = true; scene.add(p); colliders.push([x, z, 0.12]); });
  for (let k = 0; k < poles.length - 1; k++) {
    const a = V(poles[k][0], H, poles[k][1]), b = V(poles[k + 1][0], H, poles[k + 1][1]);
    const pts = []; const L = a.distanceTo(b); const n = Math.round(L / 0.3);
    for (let i = 0; i <= n; i++) { const t = i / n; const p = a.clone().lerp(b, t); p.y -= 0.42 * 4 * t * (1 - t); pts.push(p); if (i > 0 && i < n) bulbs.push(p.clone().add(V(0, -0.05, 0))); }
    wire.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, 0.006, 4));
  }
  const wm = new THREE.Mesh(mergeGeometries(wire), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 })); scene.add(wm);
  const bg = new THREE.SphereGeometry(0.04, 10, 8);
  fairyBulbs = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbs.length);
  const cols = [0xffb347, 0xff6b6b, 0xffd56b, 0x8fd7ff, 0xb9ff8a].map(c => new THREE.Color(c));
  const m4 = new THREE.Matrix4();
  bulbs.forEach((p, i) => { m4.makeTranslation(p.x, p.y, p.z); fairyBulbs.setMatrixAt(i, m4); fairyBulbs.setColorAt(i, cols[i % cols.length]); });
  fairyBulbs.userData.base = cols; fairyBulbs.userData.n = bulbs.length;
  scene.add(fairyBulbs);
  fairyLs[0].position.set(3.2, 2.1, 0.3); fairyLs[1].position.set(3.0, 2.1, -3.6);
}

function buildTrees() {
  const r = mulberry(42);
  const variants = ['birch_0', 'birch_1', 'birch_2', 'spruce_0', 'spruce_1'];
  const buckets = variants.map(() => ({ near: [], far: [] }));
  const keep = [[-4.5, -5.0, 2.6]];
  let placed = 0, tries = 0;
  while (placed < 150 && tries < 3000) {
    tries++;
    const ang = r() * Math.PI * 2; const rad = 8 + Math.pow(r(), 0.8) * 52;
    const x = 0.8 + Math.cos(ang) * rad, z = -1.2 + Math.sin(ang) * rad;
    if (keep.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr)) continue;
    let vi = r() < 0.58 ? Math.floor(r() * 3) : 3 + Math.floor(r() * 2);
    const s = 0.8 + r() * 0.45;
    const m = new THREE.Matrix4().compose(V(x, 0, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), r() * 6.28), V(s, s * (0.9 + r() * 0.25), s));
    (rad < 20 ? buckets[vi].near : buckets[vi].far).push(m);
    if (rad < 12) colliders.push([x, z, 0.35]);
    placed++;
  }
  // a few bushes
  const bushM = [];
  for (let i = 0; i < 28; i++) { const a = r() * 6.28, d = 7 + r() * 10; const s = 0.7 + r() * 0.8; bushM.push(new THREE.Matrix4().compose(V(0.8 + Math.cos(a) * d, 0, -1.2 + Math.sin(a) * d), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), r() * 6), V(s, s, s))); }
  const inst = (tpl, mats4, cast) => {
    if (!mats4.length) return;
    for (const mesh of meshesOf(get(tpl))) {
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, mats4.length);
      mats4.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = cast; im.receiveShadow = true;
      im.computeBoundingSphere(); scene.add(im);
    }
  };
  variants.forEach((v, i) => { inst(v, buckets[i].near, true); inst(v, buckets[i].far, false); });
  inst('bush_0', bushM, true);
}

function buildGrass() {
  const r = mulberry(9);
  const avoid = [[0.2, -0.9, 2.0], [-1.6, -1.15, 0.9], [4.25, -1.2, 1.1], [-4.5, -5.0, 1.6], [-2.7, -2.9, 0.5], [-3.35, -2.0, 0.6], ...FRIENDS.map(f => [f.x, f.z, 0.55])];
  const lists = [[], []];
  const N = 7500;
  for (let i = 0; i < N * 3 && lists[0].length + lists[1].length < N; i++) {
    const a = r() * 6.28, d = 0.8 + Math.sqrt(r()) * 17;
    const x = 0.3 + Math.cos(a) * d, z = -1.0 + Math.sin(a) * d;
    let ok = true;
    for (const [ax, az, ar] of avoid) { const dd = Math.hypot(x - ax, z - az); if (dd < ar) { ok = false; break; } if (dd < ar + 1.2 && r() > (dd - ar) / 1.2) { ok = false; break; } }
    if (!ok) continue;
    const s = 0.7 + r() * 0.7;
    const m = new THREE.Matrix4().compose(V(x, 0, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), r() * 6.28), V(s, s * (0.8 + r() * 0.5), s));
    lists[r() < 0.12 ? 1 : 0].push(m);
  }
  ['grass_0', 'grass_1'].forEach((n, k) => {
    for (const mesh of meshesOf(get(n))) {
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, lists[k].length);
      lists[k].forEach((m, i) => im.setMatrixAt(i, m)); im.receiveShadow = true; im.castShadow = false;
      im.userData.full = lists[k].length; im.computeBoundingSphere(); scene.add(im); grassMeshes.push(im);
    }
  });
}

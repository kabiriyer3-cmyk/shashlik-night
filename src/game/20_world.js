// ------------------------------------------------------------------ cooking material
function cookMaterial(type) {
  const T = TYPES[type];
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0 });
  const c = (a) => new THREE.Color().setRGB(a[0], a[1], a[2], THREE.SRGBColorSpace);
  const u = m.userData.u = { uDoneA: { value: 0 }, uDoneB: { value: 0 }, uVeg: { value: T.veg ? 1 : 0 }, uGlow: { value: 0 }, uEat: { value: 0 },
    uDark: { value: c(T.dark || [0.3, 0.2, 0.1]) }, uLight: { value: c(T.light || [0.6, 0.4, 0.2]) } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vLoc;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position;');
    sh.fragmentShader = 'varying vec3 vLoc; uniform float uDoneA, uDoneB, uVeg, uGlow, uEat; uniform vec3 uDark, uLight;\n' + NOISE + '\nfloat cookK; float charK;\n' + sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (vLoc.z < mix(-0.16, 0.14, uEat)) discard;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vLoc.y / max(length(vLoc.xy), 0.003);
        float d = mix(uDoneA, uDoneB, smoothstep(-0.5, 0.5, sd));
        float n = vnoise(vLoc*230.0); float n2 = vnoise(vLoc*75.0 + 3.1);
        vec3 raw = diffuseColor.rgb;
        float lum = dot(raw, vec3(0.3,0.59,0.11));
        vec3 cooked = uVeg > 0.5 ? raw*vec3(0.60,0.50,0.38) + vec3(0.025,0.012,0.0) : mix(uDark, uLight, smoothstep(0.18, 0.7, lum));
        cooked *= 0.78 + 0.42*n2;
        cookK = smoothstep(0.1, 0.92, d + (n-0.5)*0.16);
        charK = smoothstep(1.06, 1.6, d + (n-0.5)*0.5);
        vec3 col = mix(raw, cooked, cookK);
        col = mix(col, vec3(0.026,0.019,0.015), charK);
        diffuseColor.rgb = col;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(0.36, 0.6, cookK) + charK*0.3;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(1.0,0.26,0.04) * charK * uGlow * (0.15 + 0.5*n);');
  };
  m.customProgramCacheKey = () => 'cook';
  return m;
}


// ================================================================== skewers (registry + where they live)
// Every skewer has a location: ['s', slot] grill · ['h', playerId] hand · ['p', k] plate · ['f', friendIdx] eating · ['d'] dog's mouth
const SK = new Map();
let sid = 0;
function makeSkewer(type, v, id) {
  if (v === undefined || v === null) v = Math.floor(Math.random() * skewerGeos[type].length);
  const grp = new THREE.Group();
  const blade = new THREE.Mesh(skewerBladeGeo, G.contentLevel >= 5 ? goldMat : skewerBladeMat); blade.castShadow = true;
  const mat = cookMaterial(type);
  const meat = new THREE.Mesh(skewerGeos[type][v], mat); meat.castShadow = true; meat.receiveShadow = true;
  grp.add(blade, meat);
  if (id === undefined) id = ++sid; else sid = Math.max(sid, id);
  const s = { id, type, v, grp, mat, doneA: 0, doneB: 0, flipped: false, rot: 0, rotT: 0, slot: -1, flare: 0, coalAch: false, loc: null, locKey: '' };
  SK.set(id, s);
  return s;
}
function dropSkewer(s) { if (!s) return; s.grp.removeFromParent(); SK.delete(s.id); s.loc = null; s.locKey = ''; }
function setLoc(s, loc) { s.loc = loc; s.locKey = loc ? loc.join(':') : ''; attach(s); }
function attach(s) {
  const g = s.grp, L = s.loc; g.removeFromParent(); s.mat.userData.u.uGlow.value = 0;
  if (!L) return;
  g.quaternion.identity();
  switch (L[0]) {
    case 's': scene.add(g); g.position.set(slotX(L[1]), MANGAL_TOP + 0.004, M0.z); g.rotation.set(0, 0, s.rot); break;
    case 'h': if (L[1] === me.id) { fpArm.add(g); g.position.set(0, 0.005, -0.33); g.rotation.set(0, 0.08, 0); } else scene.add(g); break;
    case 'p': scene.add(g); g.position.set(PLATE.x - 0.05 + L[1] * 0.05, PLATE.y + 0.03 + L[1] * 0.012, PLATE.z); g.rotation.set(0, 0.3 + L[1] * 0.25, 0); break;
    case 'f': scene.add(g); break;
    case 'd': dog.head.add(g); g.position.set(0, -0.035, 0.14); g.rotation.set(0, Math.PI / 2, 0); break;
  }
}

// ================================================================== game state
const G = {
  mode: 'loading', night: 1, nid: 0, t: 0, score: 0, combo: 0, bestCombo: 0, mood: 70, heat: 0.85, fuel: 0.9, contentLevel: 1,
  fanning: false, plate: [], sprayCD: 0, coalCD: 0, slots: new Array(CONFIG.slots).fill(null),
  served: 0, perfect: 0, burnt: 0, flaresOut: 0, shoo: 0, fed: 0, stolen: 0, earnedAch: [], shake: 0,
  tutStep: 0, toastDone: false, ending: false,
};
const player = { pos: V(0, 0, 0.45), yaw: 0, pitch: -0.42, bob: 0, vel: V(), reachT: 0 };
// the local player; remote players live in PL
const me = { get id() { return NET.myId; }, name: save.name || 'Повар', color: '#ff7a2a', hand: null, fanIn: false, fanVis: false, fanT: 0, sprayAnim: 0, pos: player.pos, local: true };
Object.defineProperty(G, 'hand', { get: () => me.hand, set: v => { me.hand = v; }, enumerable: false });
const PL = new Map();
const COLORS = { h: '#ff7a2a', p1: '#5cc26a', p2: '#4aa3ff', p3: '#c45cff', solo: '#ff7a2a' };
const playerById = id => id === me.id ? me : PL.get(id);
const posOf = P => P === me ? camera.position : P.pos;
const chefs = () => 1 + PL.size;
const keys = {};
let friends = [], dog;
const isAuthority = () => NET.role !== 'client';

// ================================================================== events (host plays them locally and broadcasts)
const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100, r3 = x => Math.round(x * 1000) / 1000;
const P3 = v => [r3(v.x), r3(v.y), r3(v.z)];
function runEv(e) {
  switch (e.k) {
    case 's': SFX_.play(e.n, e.p ? V(e.p[0], e.p[1], e.p[2]) : undefined); break;
    case 'v': { const f = friends[e.f]; if (f && f.active) SFX_.voice(headPos(f), f.def.pitch * (e.pm || 1), e.n, e.m || 0); break; }
    case 'fl': floater(V(e.p[0], e.p[1], e.p[2]), e.x, e.c); break;
    case 't': toast(e.x, e.d); break;
    case 'a': award(e.id); break;
    case 'sm': puff(e.n, e.i); break;
    case 'sh': if (SET.shake) G.shake = e.v; break;
    case 'qc': showQC(e); break;
  }
}
function fx(e) { runEv(e); if (NET.role === 'host') NET.broadcast({ t: 'ev', e }); }
function fxTo(P, e) { if (!P || P === me) runEv(e); else if (NET.role === 'host') NET.send(P.id, { t: 'ev', e }); }
const sfx = (n, pos) => fx({ k: 's', n, p: pos ? P3(pos) : 0 });
const flt = (pos, x, c) => fx({ k: 'fl', p: P3(pos), x, c });
const tst = (x, d) => fx({ k: 't', x, d });
const voice = (f, n, m, pm) => fx({ k: 'v', f: friends.indexOf(f), n, m, pm });
const teamAward = id => fx({ k: 'a', id });
function puff(kind, i) {
  if (kind === 'place') for (let k = 0; k < 14; k++) smoke.spawn(slotX(i) + rnd(-0.03, 0.03), MANGAL_TOP + 0.02, M0.z + rnd(-0.1, 0.1), rnd(-0.1, 0.1), rnd(0.4, 0.8), rnd(-0.1, 0.1), rnd(1.5, 2.5), 0.08, 0.6, [0.7, 0.68, 0.66], [0.5, 0.5, 0.52], 0.2, 0.8, 0.1);
  if (kind === 'coal') for (let k = 0; k < 25; k++) smoke.spawn(M0.x + rnd(-0.4, 0.4), MANGAL_TOP, M0.z + rnd(-0.12, 0.12), rnd(-0.2, 0.2), rnd(0.2, 0.6), rnd(-0.2, 0.2), rnd(1.5, 3), 0.1, 0.5, [0.3, 0.29, 0.28], [0.45, 0.45, 0.46], 0.5, 1.0, 0.05);
  if (kind === 'spray') for (let k = 0; k < 30; k++) smoke.spawn(M0.x + rnd(-0.35, 0.35), MANGAL_TOP + 0.02, M0.z + rnd(-0.12, 0.12), rnd(-0.2, 0.2), rnd(0.7, 1.4), rnd(-0.2, 0.2), rnd(0.8, 1.6), 0.06, 0.45, [0.95, 0.95, 0.97], [0.8, 0.82, 0.85], 0.55, 1.2, 0);
}

// ================================================================== friends
function setupFriends() {
  friends = FRIENDS.map((def, i) => {
    const obj = get('friend' + def.key);
    const fwd = V(Math.sin(def.ry), 0, Math.cos(def.ry));
    obj.position.set(def.x + fwd.x * 0.02, -0.43, def.z + fwd.z * 0.02);
    obj.rotation.set(0, def.ry, 0);
    obj.scale.setScalar(def.key === 'A' ? 1.04 : def.key === 'C' ? 1.0 : 0.96);
    obj.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; c.frustumCulled = false; } });
    scene.add(obj);
    const mixer = new THREE.AnimationMixer(obj);
    const actions = {};
    for (const clip of gltf.animations) {
      if (!clip.name.startsWith('sit_')) continue;
      const c = clip.clone(); c.tracks.forEach(t => t.name = t.name.replace(/^A_/, def.key + '_'));
      actions[clip.name] = mixer.clipAction(c);
    }
    const f = { def, obj, mixer, actions, cur: null, state: 'idle', hungerT: CONFIG.firstOrder + i * 13 + rnd(0, 4), order: null,
      head: obj.getObjectByName(def.key + '_Head'), handR: obj.getObjectByName(def.key + '_HandR'), handL: obj.getObjectByName(def.key + '_HandL'),
      look: 0, chatT: rnd(6, 14), stateT: 0, held: null, grade: null, bubble: null, card: null, active: true, eatDur: 7, sayT: 0, sayText: '', tmpAnimT: 0 };
    f.play = (name, fade = 0.35) => {
      if (f.cur === name) return; const a = f.actions[name]; if (!a) return;
      a.reset().setEffectiveWeight(1).fadeIn(fade).play();
      if (f.cur && f.actions[f.cur]) f.actions[f.cur].fadeOut(fade);
      f.cur = name;
    };
    f.baseAnim = () => def.guitar ? 'sit_strum' : 'sit_idle';
    f.play(f.baseAnim(), 0);
    mixer.setTime(Math.random() * 5);
    if (def.guitar) {
      guitarObj.position.set(-0.14, 1.12, 0.26); guitarObj.rotation.set(0, 0, 0.16); guitarObj.scale.setScalar(1);
      guitarObj.traverse(c => { if (c.isMesh) c.castShadow = true; });
      obj.add(guitarObj); f.guitar = guitarObj;
    }
    f.proxy = proxy(0.7, 1.35, 0.75, def.x, 0.68, def.z, { kind: 'friend', i });
    f.bubble = document.createElement('div'); f.bubble.className = 'bub'; f.bubble.innerHTML = '<div class="b"></div><div class="tail"></div>'; $('bubbles').appendChild(f.bubble);
    f.card = document.createElement('div'); f.card.className = 'ord panel'; $('orders').appendChild(f.card);
    return f;
  });
}
function activeFriends() { return friends.filter(f => f.active); }
function setFriendsForLevel(L) {
  G.contentLevel = L;
  friends.forEach(f => {
    f.active = L >= f.def.level;
    f.obj.visible = f.active; f.proxy.userData.disabled = !f.active;
    f.card.style.display = f.active ? '' : 'none'; f.bubble.style.display = 'none';
  });
}
function unlockedTypes() { return Object.keys(TYPES).filter(t => TYPES[t].level <= G.contentLevel); }
const paceMul = () => 1 + 0.3 * (chefs() - 1);

function makeOrder(f) {
  const types = unlockedTypes();
  const pool = types.flatMap(t => t === f.def.fav ? [t, t, t] : [t]);
  let type = pick(pool);
  if (G.night === 1 && G.served === 0 && f === friends[0]) type = 'pork';
  let mod = 'normal';
  if (G.night >= 2 || G.served >= 4) { const r = Math.random(); mod = r < 0.22 ? 'medium' : r < 0.42 ? 'crispy' : 'normal'; }
  const pat = Math.max(CONFIG.patienceMin, CONFIG.patience - (G.night - 1) * 5);
  f.order = { type, mod, total: pat, left: pat };
  f.state = 'hungry'; f.stateT = 0;
  f.play('sit_wave');
  voice(f, 5, 0.5);
  say(f, pick(f.def.lines), 2.6);
}
const MODS = { normal: 'обычный', medium: 'сочный', crispy: 'с корочкой' };
const WINDOWS = { normal: [0.78, 1.04], medium: [0.62, 0.86], crispy: [0.98, 1.22] };
function sideScore(d, lo, hi, rawT) {
  if (d < rawT) return 0;
  if (d < lo) return 0.3 + 0.55 * (d - rawT) / (lo - rawT);
  if (d <= hi) return 1;
  if (d < 1.32) return 0.85 - 0.45 * (d - hi) / (1.32 - hi);
  return 0.06;
}
function grade(s, order) {
  const T = TYPES[s.type]; const [lo, hi] = WINDOWS[order ? order.mod : 'normal'];
  const a = sideScore(s.doneA, lo, hi, T.raw), b = sideScore(s.doneB, lo, hi, T.raw);
  const q = 0.6 * Math.min(a, b) + 0.4 * (a + b) / 2;
  const raw = Math.min(s.doneA, s.doneB) < T.raw, burnt = Math.max(s.doneA, s.doneB) > 1.32;
  const g = burnt ? 'BURNT' : raw ? 'RAW' : q >= 0.93 ? 'PERFECT' : q >= 0.72 ? 'GOOD' : 'OK';
  return { q, g, raw, burnt };
}
function serve(f, s, P) {
  const o = f.order; const res = grade(s, o);
  const match = s.type === o.type;
  let mult = 1 + 0.25 * Math.min(G.combo, 8);
  if (G.contentLevel >= 5) mult *= 1.1;
  const speed = o.left / o.total;
  let pay = Math.round(TYPES[s.type].base * res.q * (match ? 1 : 0.5) * (res.g === 'PERFECT' ? mult : 1) + (res.q > 0.5 && speed > 0.55 ? 20 : 0));
  if (res.g === 'RAW' || res.g === 'BURNT') pay = Math.max(0, Math.round(pay * 0.3));
  G.score += pay; G.served++;
  let moodD = { PERFECT: 9, GOOD: 5, OK: 1, RAW: -11, BURNT: -10 }[res.g];
  if (!match) moodD -= 3;
  if (res.g === 'PERFECT') { G.combo++; G.perfect++; G.bestCombo = Math.max(G.bestCombo, G.combo); teamAward('perfect'); if (G.combo >= 5) teamAward('combo5'); sfx('perfect'); }
  else if (res.g === 'GOOD') sfx('coin');
  else { G.combo = 0; sfx(res.g === 'OK' ? 'coin' : 'bad'); }
  if (res.raw && s.type === 'chicken') { moodD -= 8; teamAward('salmon'); }
  if (res.burnt) G.burnt++;
  G.mood = clamp(G.mood + moodD, 0, 100);
  const col = { PERFECT: '#ffd36a', GOOD: '#bfe07a', OK: '#f1e3c8', RAW: '#ff8a7a', BURNT: '#ff7050' }[res.g];
  const label = { PERFECT: 'ИДЕАЛЬНО!', GOOD: 'Вкусно', OK: 'Съедобно…', RAW: 'СЫРОЕ!', BURNT: 'СГОРЕЛО!' }[res.g];
  const who = NET.on && P ? `${P.name}: ` : '';
  flt(headPos(f).add(V(0, 0.35, 0)), `${who}${label} +${pay} ₽${res.g === 'PERFECT' && G.combo > 1 ? '  ×' + mult.toFixed(2).replace(/\.?0+$/, '') : ''}`, col);
  if (!match) setTimeout(() => flt(headPos(f).add(V(0, 0.15, 0)), `Я же просил ${TYPES[o.type].acc}…`, '#f1e3c8'), 500);
  f.order = null; f.state = 'eating'; f.stateT = 0; f.grade = res.g;
  f.held = s; setLoc(s, ['f', friends.indexOf(f)]);
  f.play('sit_eat', 0.3);
  if (f.def.guitar) f.guitar.visible = false;
  f.eatDur = res.g === 'RAW' || res.g === 'BURNT' ? 2.2 : 7;
  voice(f, 3, res.q > 0.7 ? 1 : -0.5);
  if (G.tutStep === 5 && P === me) advanceTut();
}
function orderFail(f) {
  f.order = null; f.state = 'react'; f.stateT = 0; f.grade = 'ANGRY';
  f.play('sit_disgust'); G.mood = clamp(G.mood - 13, 0, 100); G.combo = 0;
  say(f, pick(['Ну и ладно…', 'Поем хлеба тогда.', 'Эх…']), 2.5);
  voice(f, 4, -0.8, 0.9); sfx('bad');
  f.hungerT = rnd(14, 24) / paceMul();
}
const _v = V();
function headPos(f) { return f.head.getWorldPosition(V()).add(V(0, 0.12, 0)); }
function say(f, text, dur) { f.sayText = text; f.sayT = dur; }

function simFriends(dt) {
  for (const f of friends) {
    if (!f.active) continue;
    f.stateT += dt;
    if (f.state === 'idle') {
      f.hungerT -= dt;
      if (f.hungerT <= 0 && !G.ending) makeOrder(f);
      f.chatT -= dt;
      if (f.chatT <= 0) {
        f.chatT = rnd(9, 20);
        if (!f.def.guitar || Math.random() < 0.3) {
          const a = Math.random() < 0.5 ? 'sit_talk' : Math.random() < 0.5 ? 'sit_drink' : 'sit_laugh';
          f.play(a); f.tmpAnimT = a === 'sit_drink' ? 3 : 3.2;
          if (a !== 'sit_drink') voice(f, 4 + Math.floor(Math.random() * 4), a === 'sit_laugh' ? 1 : 0);
        }
      }
      if (f.tmpAnimT > 0) { f.tmpAnimT -= dt; if (f.tmpAnimT <= 0) f.play(f.baseAnim()); }
    } else if (f.state === 'hungry') {
      f.order.left -= dt;
      if (f.stateT > 2.4 && f.cur === 'sit_wave') f.play(f.order.left / f.order.total < 0.35 ? 'sit_talk' : f.baseAnim());
      if (f.order.left / f.order.total < 0.35 && f.stateT > 2.4 && Math.random() < dt * 0.15) { f.play('sit_wave'); f.stateT = 0; voice(f, 3, 0.8); say(f, pick(['Эй, шеф!', 'Шашлык!', 'Ну долго ещё?']), 2); }
      if (f.order.left / f.order.total < 0.4) G.mood = clamp(G.mood - dt * 0.18, 0, 100);
      if (f.order.left <= 0) orderFail(f);
    } else if (f.state === 'eating') {
      const s = f.held;
      if (s) s.mat.userData.u.uEat.value = clamp((f.stateT - 0.8) / (f.eatDur - 0.5), 0, 1) * (f.grade === 'RAW' || f.grade === 'BURNT' ? 0.15 : 1);
      if (f.stateT > f.eatDur) {
        if (s) { dropSkewer(s); f.held = null; }
        f.state = 'react'; f.stateT = 0;
        const g = f.grade;
        f.play(g === 'PERFECT' ? 'sit_cheer' : g === 'GOOD' ? 'sit_laugh' : g === 'OK' ? 'sit_talk' : 'sit_disgust');
        const lines = { PERFECT: ['Божественно!', 'Шеф, ты бог!', 'Лучший шашлык в жизни!'], GOOD: ['Вкусно!', 'Хорош!', 'Отлично!'], OK: ['Ну… нормально.', 'Съедобно.', 'Сойдёт.'], RAW: ['Оно ещё мычит!', 'Сырое!', 'Недожарено!'], BURNT: ['Это уголь?!', 'Угли…', 'Хрустящее… очень.'] }[g];
        say(f, pick(lines), 2.6);
        voice(f, 5, g === 'PERFECT' || g === 'GOOD' ? 1 : -0.6);
        f.hungerT = rnd(20, 38) / (1 + (G.night - 1) * 0.08) / paceMul();
      }
    } else if (f.state === 'react') {
      if (f.stateT > 2.6) { f.state = 'idle'; f.play(f.baseAnim()); if (f.def.guitar) f.guitar.visible = true; }
    }
  }
}
function visFriends(dt) {
  const camPos = camera.position;
  for (const f of friends) {
    if (!f.active) continue;
    f.mixer.update(dt);
    if (f.sayT > 0) f.sayT -= dt;
    if (f.held) {
      const hand = f.handR.getWorldPosition(V());
      const mouth = f.head.localToWorld(V(0, 0.06, 0.1));
      const dir = mouth.sub(hand).normalize();
      f.held.grp.quaternion.setFromUnitVectors(V(0, 0, -1), dir);
      f.held.grp.position.copy(hand).addScaledVector(dir, 0.35);
    }
    if (f.cur === 'sit_drink' && f.def.key === 'B') {
      mugObj.visible = true; f.handL.getWorldPosition(mugObj.position); mugObj.position.y -= 0.05; mugObj.rotation.set(0, f.def.ry, 0);
    } else if (f.def.key === 'B') mugObj.visible = false;
    // head turns toward whoever is closest (yourself, locally)
    const hp = f.head.getWorldPosition(_v);
    const dx = camPos.x - hp.x, dz = camPos.z - hp.z;
    let yaw = Math.atan2(dx, dz) - f.def.ry; yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    const dist = Math.hypot(dx, dz);
    const want = (f.cur === 'sit_eat' || f.cur === 'sit_drink' || f.cur === 'sit_strum' && f.state !== 'hungry') ? 0 : (dist < 6 ? clamp(yaw, -1.0, 1.0) : 0);
    f.look += (want - f.look) * (1 - Math.exp(-4 * dt));
    if (Math.abs(f.look) > 0.001) f.head.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), f.look * 0.85));
  }
}

// ================================================================== dog (Sharik)
function setupDog() {
  const obj = get('dog'); scene.add(obj); obj.visible = false;
  obj.traverse(c => { if (c.isMesh) { c.castShadow = true; c.frustumCulled = false; } });
  const mixer = new THREE.AnimationMixer(obj); const actions = {};
  for (const clip of gltf.animations) if (clip.name.startsWith('dog_')) actions[clip.name] = mixer.clipAction(clip);
  dog = { obj, mixer, actions, cur: null, state: 'away', t: 0, nextT: 70, from: V(), target: V(), carried: null, head: obj.getObjectByName('DHead'), speed: 2.5, faceId: null, tp: V(), tr: 0 };
  dog.play = (n, f = 0.25) => { if (dog.cur === n || !dog.actions[n]) return; const a = dog.actions[n]; a.reset().fadeIn(f).play(); if (dog.cur) dog.actions[dog.cur].fadeOut(f); dog.cur = n; };
  dog.proxy = proxy(0.34, 0.7, 0.9, 0, 0.4, 0, { kind: 'dog' }, obj);
  dog.play('dog_idle', 0);
}
const DOG_SPAWNS = [V(-9.5, 0, 1.5), V(-3, 0, 8), V(2, 0, 8.5), V(-8, 0, -6)];
function simDog(dt) {
  const d = dog;
  if (d.state === 'away') {
    if (G.mode !== 'menu' && G.t > d.nextT && !G.ending) {
      if (!G.slots.some(Boolean)) { d.nextT = G.t + 6; return; }
      d.from.copy(pick(DOG_SPAWNS));
      d.target.set(d.from.x < 0 ? -0.62 : 0.5, 0, d.from.x < 0 ? -0.5 : -0.48);
      d.obj.position.copy(d.from); d.obj.visible = true; d.state = 'approach'; d.speed = 2.4; d.play('dog_run', 0);
      sfx('bark', d.obj.position); tst('🐕 Шарик учуял шашлык! Кликни, чтобы прогнать, или накорми его.', 3.2);
    }
    return;
  }
  const p = d.obj.position;
  const moveTo = (tgt, spd) => {
    const dx = tgt.x - p.x, dz = tgt.z - p.z, dist = Math.hypot(dx, dz);
    if (dist > 0.02) {
      const step = Math.min(dist, spd * dt); p.x += dx / dist * step; p.z += dz / dist * step;
      const ry = Math.atan2(dx, dz); let dr = ry - d.obj.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); d.obj.rotation.y += dr * (1 - Math.exp(-10 * dt));
    }
    return dist;
  };
  d.t += dt;
  if (d.state === 'approach') {
    if (moveTo(d.target, d.speed) < 0.05) { d.state = 'sniff'; d.t = 0; d.play('dog_idle'); }
  } else if (d.state === 'sniff') {
    const ry = Math.atan2(M0.x - p.x, M0.z - p.z); d.obj.rotation.y += (ry - d.obj.rotation.y) * (1 - Math.exp(-6 * dt));
    if (d.t > 3.2) {
      let best = null, bv = -1;
      G.slots.forEach(s => { if (s) { const v = (s.doneA + s.doneB); if (v > bv) { bv = v; best = s; } } });
      if (best) {
        G.slots[best.slot] = null; best.slot = -1; best.flare = 0;
        d.carried = best; setLoc(best, ['d']);
        G.mood = clamp(G.mood - 7, 0, 100); G.stolen++; G.combo = 0;
        tst('Шарик утащил шампур! 🐕💨', 2.5); sfx('bark', p);
        laughRandom();
      }
      dogLeave(3.2, 'dog_run');
    }
  } else if (d.state === 'leave') {
    if (moveTo(d.target, d.speed) < 0.1) {
      d.state = 'away'; d.obj.visible = false;
      if (d.carried) { dropSkewer(d.carried); d.carried = null; }
      d.nextT = G.t + rnd(55, 85) / (1 + (G.night - 1) * 0.12) / (1 + 0.15 * (chefs() - 1));
    }
  } else if (d.state === 'beg') {
    const P = playerById(d.faceId) || me; const fp = posOf(P);
    const ry = Math.atan2(fp.x - p.x, fp.z - p.z); d.obj.rotation.y += (ry - d.obj.rotation.y) * (1 - Math.exp(-6 * dt));
    if (d.t > 1.6 && d.cur !== 'dog_eat') d.play('dog_eat');
    if (d.t > 4.5) { if (d.carried) { dropSkewer(d.carried); d.carried = null; } dogLeave(1.3, 'dog_walk'); }
  }
}
function visDog(dt, mirror) {
  const d = dog; d.mixer.update(dt);
  if (!mirror) return;
  d.obj.visible = d.state !== 'away';
  const p = d.obj.position;
  if (p.distanceTo(d.tp) > 3) p.copy(d.tp); else p.lerp(d.tp, 1 - Math.exp(-12 * dt));
  let dr = d.tr - d.obj.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); d.obj.rotation.y += dr * (1 - Math.exp(-12 * dt));
}
function dogLeave(speed, anim) {
  const d = dog; const p = d.obj.position;
  const away = V(p.x - M0.x, 0, p.z - M0.z).normalize();
  if (away.lengthSq() < 0.01) away.set(-1, 0, 0);
  d.target.copy(p).addScaledVector(away, 14); d.state = 'leave'; d.speed = speed; d.play(anim);
}
function shooDog(P) {
  const d = dog; sfx('yelp', d.obj.position); sfx('whistle', posOf(P));
  flt(d.obj.position.clone().add(V(0, 0.9, 0)), 'Фу, Шарик! 🐾', '#ffd36a');
  G.mood = clamp(G.mood + 3, 0, 100); G.shoo++; save.shoo++; if (save.shoo >= 3) teamAward('shoo3');
  dogLeave(4.2, 'dog_run'); laughRandom();
}
function feedDog(P) {
  const d = dog, s = P.hand; P.hand = null;
  const burnt = Math.max(s.doneA, s.doneB) > 1.32;
  d.carried = s; setLoc(s, ['d']); d.faceId = P.id;
  d.state = 'beg'; d.t = 0; d.play('dog_sit');
  const bonus = burnt ? 30 : 10; G.score += bonus; G.mood = clamp(G.mood + 4, 0, 100); G.fed++; save.fed++; teamAward('feed');
  flt(d.obj.position.clone().add(V(0, 0.9, 0)), burnt ? `Шарик любит хрустящее! +${bonus} ₽` : `Хороший пёс! +${bonus} ₽`, '#bfe07a');
  sfx('bark', d.obj.position);
}
function laughRandom() {
  const idle = friends.filter(f => f.active && f.state === 'idle'); if (!idle.length) return;
  const f = pick(idle); f.play('sit_laugh'); f.tmpAnimT = 2.6; voice(f, 6, 1);
}

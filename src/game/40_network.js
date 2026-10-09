// ================================================================== settings
const SET_DEF = { master: 80, sfx: 100, amb: 80, music: 70, voice: 90, muted: false, bgAudio: false, sens: 100, invertY: false, autoRun: false, bob: true,
  quality: 'high', fov: 72, bright: 100, ui: 100, fps: false, hints: true, bubbles: true, shake: true };
const SET = save.set = Object.assign({}, SET_DEF, { muted: !!save.muted, quality: save.quality || 'high' }, save.set || {});
{ const qp = new URLSearchParams(location.search).get('q'); if (qp === 'low' || qp === 'high') SET.quality = qp; }
const sensK = () => 0.0022 * SET.sens / 100;
function applySettings() {
  SFX_.muted = SET.muted; save.muted = SET.muted;
  for (const k of ['master', 'sfx', 'amb', 'music', 'voice']) SFX_.setLevel(k, SET[k] / 100);
  SFX_.setMuted(SET.muted);
  if (quality !== SET.quality) { quality = SET.quality; applyQuality(); }
  camera.fov = SET.fov; camera.updateProjectionMatrix(); resize();
  document.documentElement.style.setProperty('--uiz', SET.ui / 100);
  document.body.classList.toggle('nohints', !SET.hints);
  document.body.classList.toggle('nobubbles', !SET.bubbles);
  $('fps').classList.toggle('hidden', !SET.fps);
  persist();
}
const OUT = { master: '%', sfx: '%', amb: '%', music: '%', voice: '%', sens: '%', fov: '°', bright: '%', ui: '%' };
function syncSettingsUI() {
  SET.quality = quality;
  document.querySelectorAll('#settings [data-k]').forEach(el => {
    const k = el.dataset.k;
    if (el.type === 'checkbox') el.checked = !!SET[k]; else el.value = SET[k];
    const o = el.parentElement.querySelector('output'); if (o) o.textContent = SET[k] + (OUT[k] || '');
  });
  const mt = SET.muted ? '🔇 Звук выкл.' : '🔊 Звук вкл.'; $('muteBtn').textContent = mt;
}
window.__syncSettingsUI = () => { if ($('settings')) syncSettingsUI(); };
function setupSettings() {
  document.querySelectorAll('#settings [data-k]').forEach(el => {
    el.addEventListener('input', () => {
      const k = el.dataset.k;
      SET[k] = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : +el.value;
      const o = el.parentElement.querySelector('output'); if (o) o.textContent = SET[k] + (OUT[k] || '');
      applySettings(); syncSettingsUI();
      if (k === 'sfx' || k === 'master') { SFX_.init(); SFX_.play('coin'); }
      if (k === 'voice') { SFX_.init(); const f = friends.find(f => f.active); if (f) SFX_.voice(camera.position.clone().add(V(0.5, 0, -1)), f.def.pitch, 3, 0.5); }
    });
  });
  document.querySelectorAll('#settings .tab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#settings .tab').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('#settings .tabp').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + b.dataset.tab));
    SFX_.play('ui');
  }));
  $('setBtn').onclick = () => openSettings(); $('setBtn2').onclick = () => openSettings();
  $('setClose').onclick = () => closeSettings();
  $('setDefaults').onclick = () => { Object.assign(SET, SET_DEF); applySettings(); syncSettingsUI(); SFX_.play('ui'); };
  $('tutBtn').onclick = () => { save.tut = false; persist(); $('resetMsg').textContent = 'Обучение включится в следующей одиночной ночи.'; };
  let armed = false;
  $('resetBtn').onclick = () => {
    if (!armed) { armed = true; $('resetBtn').textContent = 'Точно? Нажми ещё раз'; setTimeout(() => { armed = false; $('resetBtn').textContent = 'Сбросить прогресс'; }, 4000); return; }
    armed = false;
    Object.assign(save, { xp: 0, best: 0, nights: 0, perfect: 0, served: 0, shoo: 0, fed: 0, flares: 0, ach: {}, tut: false }); persist();
    $('resetBtn').textContent = 'Сбросить прогресс'; $('resetMsg').textContent = 'Прогресс сброшен. Начинаем с чистого мангала.';
    if (G.mode === 'menu') { setFriendsForLevel(1); refreshMenu(); }
  };
  document.addEventListener('visibilitychange', () => {
    if (!SFX_.ctx) return;
    if (document.hidden && !SET.bgAudio) SFX_.ctx.suspend(); else if (!document.hidden) SFX_.ctx.resume();
  });
  syncSettingsUI(); applySettings();
}
function openSettings() { syncSettingsUI(); $('settings').classList.remove('hidden'); $('resetMsg').textContent = ''; SFX_.init(); SFX_.play('ui'); }
function closeSettings() { $('settings').classList.add('hidden'); SFX_.play('ui'); }
const settingsOpen = () => !$('settings').classList.contains('hidden');

// ================================================================== quick chat + feed
const QC = ['Сюда!', 'Переверни!', 'Шарик! 🐕', 'Ура! 🎉'];
let qcCD = 0;
function feedLine(html, color) {
  const box = $('feed'); const d = document.createElement('div'); d.innerHTML = html; if (color) d.style.borderLeftColor = color;
  box.appendChild(d); while (box.children.length > 5) box.firstChild.remove();
  setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 600); }, 6000);
}
function doQC(i) {
  if (!NET.on || G.mode !== 'play' || performance.now() < qcCD) return; qcCD = performance.now() + 900;
  if (NET.role === 'client') NET.send('h', { t: 'qc', i }); else fx({ k: 'qc', id: me.id, i });
}
function showQC(e) {
  const P = playerById(e.id); const txt = QC[e.i]; if (!txt) return;
  const name = P ? P.name : 'Повар'; const col = P ? P.color : '#ffcf6a';
  feedLine(`<b style="color:${col}">${esc(name)}:</b> ${txt}`, col);
  if (P && P.avatar) { P.avatar.qc = txt; P.avatar.qcT = 3; }
  SFX_.play('ui');
}
// ================================================================== input
const canvas = renderer.domElement;
let locked = false, noLock = false, rmb = false;
let lockFails = 0;
function lockFailed() { lockFails++; if (lockFails >= 4) { noLock = true; toast('Захват мыши недоступен: держи правую кнопку мыши, чтобы осматриваться', 3.2); } }
function requestLock() { if (isTouch || noLock || !canvas.requestPointerLock) { if (!canvas.requestPointerLock) noLock = true; return; } try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(lockFailed); } catch (e) { lockFailed(); } }
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas; if (locked) lockFails = 0;
  if (!locked && G.mode === 'play' && !isTouch && !noLock) pause();
});
document.addEventListener('pointerlockerror', lockFailed);
addEventListener('mousemove', e => {
  if (G.mode !== 'play' && G.mode !== 'paused') return;
  if (locked || (noLock && rmb)) { player.yaw -= e.movementX * sensK(); player.pitch = clamp(player.pitch - e.movementY * sensK() * (SET.invertY ? -1 : 1), -1.45, 1.35); }
});
canvas.addEventListener('mousedown', e => {
  SFX_.init();
  if (G.mode !== 'play') return;
  if (e.button === 2) { rmb = true; return; }
  if (!locked && !noLock && !isTouch) { requestLock(); return; }
  if (e.button === 0) doAct();
});
addEventListener('mouseup', e => { if (e.button === 2) rmb = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') { if (e.code === 'Enter' && e.target.id === 'codeIn') joinCoop(); return; }
  if (settingsOpen()) { if (e.code === 'Escape') closeSettings(); return; }
  keys[e.code] = true;
  if (G.mode === 'play' && /^Digit[1-4]$/.test(e.code)) doQC(+e.code.slice(5) - 1);
  if (G.mode === 'play') {
    if (e.code === 'KeyE') doTake();
    if (e.code === 'KeyQ') doSpray();
    if (e.code === 'Escape' || e.code === 'KeyP') pause();
  } else if (G.mode === 'paused' && (e.code === 'KeyP')) resume();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (G.mode === 'play') pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G.mode === 'play') pause(); });

const touch = { mx: 0, my: 0, stickId: null, lookId: null, lx: 0, ly: 0, fan: false };
function setupTouch() {
  if (!isTouch) return;
  $('touch').classList.remove('hidden');
  const st = $('tStick'), knob = st.querySelector('i');
  st.addEventListener('pointerdown', e => { touch.stickId = e.pointerId; st.setPointerCapture(e.pointerId); SFX_.init(); });
  st.addEventListener('pointermove', e => {
    if (e.pointerId !== touch.stickId) return; const r = st.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2); const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    touch.mx = x; touch.my = y; knob.style.transform = `translate(${x * 36}px,${y * 36}px)`;
  });
  const end = e => { if (e.pointerId === touch.stickId) { touch.stickId = null; touch.mx = touch.my = 0; knob.style.transform = ''; } };
  st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
  const lk = $('tLook');
  lk.addEventListener('pointerdown', e => { touch.lookId = e.pointerId; touch.lx = e.clientX; touch.ly = e.clientY; lk.setPointerCapture(e.pointerId); SFX_.init(); });
  lk.addEventListener('pointermove', e => { if (e.pointerId !== touch.lookId) return; player.yaw -= (e.clientX - touch.lx) * 0.005 * SET.sens / 100; player.pitch = clamp(player.pitch - (e.clientY - touch.ly) * 0.005 * SET.sens / 100 * (SET.invertY ? -1 : 1), -1.45, 1.35); touch.lx = e.clientX; touch.ly = e.clientY; });
  lk.addEventListener('pointerup', e => { if (e.pointerId === touch.lookId) touch.lookId = null; });
  const btn = (id, down, up) => { const b = $(id); b.addEventListener('pointerdown', e => { e.preventDefault(); SFX_.init(); down(); }); if (up) { b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up); } };
  btn('tAct', doAct); btn('tTake', doTake); btn('tSpray', doSpray); btn('tFan', () => touch.fan = true, () => touch.fan = false); btn('tPause', () => G.mode === 'play' ? pause() : resume());
}

// ================================================================== local player
function updatePlayer(dt) {
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz -= 1; if (keys.KeyS || keys.ArrowDown) iz += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1; if (keys.KeyD || keys.ArrowRight) ix += 1;
  ix += touch.mx; iz += touch.my;
  const len = Math.hypot(ix, iz); if (len > 1) { ix /= len; iz /= len; }
  const spd = (!!(keys.ShiftLeft || keys.ShiftRight) !== !!SET.autoRun) ? CONFIG.sprint : CONFIG.walk;
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const wx = (ix * cy + iz * sy) * spd, wz = (-ix * sy + iz * cy) * spd;
  const k = 1 - Math.exp(-12 * dt);
  player.vel.x += (wx - player.vel.x) * k; player.vel.z += (wz - player.vel.z) * k;
  player.pos.x += player.vel.x * dt; player.pos.z += player.vel.z * dt;
  for (let it = 0; it < 2; it++) {
    for (const [cx, cz, r] of colliders) {
      const dx = player.pos.x - cx, dz = player.pos.z - cz, d = Math.hypot(dx, dz), rr = r + 0.28;
      if (d < rr && d > 1e-5) { player.pos.x = cx + dx / d * rr; player.pos.z = cz + dz / d * rr; }
    }
    for (const P of PL.values()) { // soft push away from other chefs
      const dx = player.pos.x - P.pos.x, dz = player.pos.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.5 && d > 1e-5) { player.pos.x = P.pos.x + dx / d * 0.5; player.pos.z = P.pos.z + dz / d * 0.5; }
    }
  }
  const cx = 0.5, cz = -1.0, R = 10.5; const dd = Math.hypot(player.pos.x - cx, player.pos.z - cz);
  if (dd > R) { player.pos.x = cx + (player.pos.x - cx) / dd * R; player.pos.z = cz + (player.pos.z - cz) / dd * R; }
  const sp = Math.hypot(player.vel.x, player.vel.z);
  player.bob += dt * sp * 3.2;
  const bobY = SET.bob ? Math.sin(player.bob * 2) * 0.025 * Math.min(1, sp / 2) : 0;
  let shx = 0, shy = 0; if (G.shake > 0) { G.shake -= dt; shx = (Math.random() - 0.5) * G.shake * 0.05; shy = (Math.random() - 0.5) * G.shake * 0.05; }
  camera.position.set(player.pos.x, 1.63 + bobY, player.pos.z);
  camera.rotation.set(player.pitch + shy, player.yaw + shx, 0);
  // first-person arm
  me.fanIn = G.mode === 'play' && !!(keys.KeyF || touch.fan);
  const fanning = me.fanVis = me.fanIn && nearMangal(me);
  if (fanning) { me.fanT += dt; if (Math.floor(me.fanT / 0.29) !== Math.floor((me.fanT - dt) / 0.29)) SFX_.play('fan', M0); }
  player.reachT = Math.max(0, player.reachT - dt);
  const r = Math.sin(clamp(player.reachT / 0.25, 0, 1) * Math.PI);
  const sway = Math.sin(player.bob) * 0.012 * Math.min(1, sp / 2);
  const holding = !!me.hand;
  let ax = 0.24, ay = holding ? -0.27 : -0.33, az = -0.42 + r * -0.12, rx = holding ? 0.05 : 0.25, ry = 0.12, rz = 0;
  fpCardboard.visible = fanning && !holding; fpSpray.visible = (me.sprayAnim > 0) && !holding;
  if (fanning && !holding) { const w = Math.sin(me.fanT * 22); ax = 0.2 + w * 0.05; ay = -0.3; az = -0.5; rx = -0.6 + w * 0.5; rz = w * 0.2; }
  if (me.sprayAnim > 0) { me.sprayAnim -= dt; if (!holding) { ax = 0.18; ay = -0.24; az = -0.45; rx = -0.2; ry = 0.0; } }
  fpArm.position.set(ax + sway, ay + Math.abs(sway) * 0.6 + bobY * 0.3, az);
  fpArm.rotation.set(rx, ry, rz);
}

// ================================================================== cooking + fire
function simGrill(dt) {
  let anyFan = me.fanVis;
  for (const P of PL.values()) if (P.fan && !P.hand && nearMangal(P)) anyFan = true;
  const fanning = G.fanning = G.mode !== 'menu' && anyFan;
  const tgt = 0.22 + 0.86 * G.fuel;
  if (fanning && G.fuel > 0.03) G.heat = Math.min(1.6, G.heat + dt * (0.34 * (0.4 + G.fuel)));
  else G.heat += (tgt - G.heat) * (1 - Math.exp(-dt * (G.heat > tgt ? 0.12 : 0.05)));
  G.fuel = Math.max(0, G.fuel - dt * CONFIG.fuelBurn * (0.5 + G.heat));
  G.sprayCD = Math.max(0, G.sprayCD - dt); G.coalCD = Math.max(0, G.coalCD - dt);
  const heatEff = Math.pow(Math.max(G.heat, 0), 1.35);
  G.slots.forEach(s => {
    if (!s) return;
    const rate = heatEff / CONFIG.cookTime[s.type];
    const flare = s.flare > 0 ? 3.0 : 1;
    const turning = Math.abs(s.rotT - s.rot) > 0.3;
    if (turning) { s.doneA += rate * 0.5 * dt; s.doneB += rate * 0.5 * dt; }
    else if (s.flipped) { s.doneB += rate * flare * dt; s.doneA += rate * 0.12 * dt; }
    else { s.doneA += rate * flare * dt; s.doneB += rate * 0.12 * dt; }
    if (Math.max(s.doneA, s.doneB) > 1.65 && !s.coalAch) { s.coalAch = true; teamAward('coal'); }
    if (s.flare > 0) { s.flare -= dt; if (s.flare <= 0) s.flare = 0; }
    else if (G.mode !== 'menu' && G.heat > 1.04 && Math.random() < dt * 0.11 * TYPES[s.type].fat * (G.heat - 0.94) * 3.2) {
      s.flare = rnd(4, 6.5); fx({ k: 'sh', v: 0.25 }); sfx('flare', s.grp.position);
      if (!G.flareHint) { G.flareHint = true; tst('🔥 Вспышка! Жир капнул на угли: жми Q, чтобы сбрызнуть', 2.6); }
    }
  });
}
function fxGrill(dt) {
  const fanning = G.fanning;
  UHEAT.value = G.heat;
  const heatEff = Math.pow(Math.max(G.heat, 0), 1.35);
  let sizzle = 0, flaring = 0;
  G.slots.forEach((s, i) => {
    if (!s) return;
    s.rot += (s.rotT - s.rot) * (1 - Math.exp(-13 * dt));
    s.grp.rotation.z = s.rot;
    const u = s.mat.userData.u; u.uDoneA.value = s.doneA; u.uDoneB.value = s.doneB; u.uGlow.value = G.heat * (s.flare > 0 ? 2.5 : 1);
    sizzle += (0.4 + TYPES[s.type].fat) * heatEff;
    if (s.flare > 0) {
      flaring++;
      for (let k = 0; k < 3; k++) flames.spawn(slotX(i) + rnd(-0.025, 0.025), MANGAL_TOP - 0.05, M0.z + rnd(-0.12, 0.12), rnd(-0.05, 0.05), rnd(0.9, 1.6), rnd(-0.05, 0.05), rnd(0.18, 0.4), rnd(0.05, 0.09), 0.015, [3, 2.0, 0.7], [1.6, 0.3, 0.05], 0.9, 1.5, 0.6);
    }
    if (Math.random() < dt * (2 + 6 * heatEff * TYPES[s.type].fat)) smoke.spawn(slotX(i) + rnd(-0.02, 0.02), MANGAL_TOP + 0.03, M0.z + rnd(-0.1, 0.1), rnd(-0.05, 0.05), rnd(0.35, 0.6), rnd(-0.05, 0.05), rnd(2.2, 3.8), 0.06, rnd(0.5, 0.9), [0.62, 0.6, 0.58], [0.5, 0.5, 0.53], 0.13, 0.6, 0.05);
  });
  // items in hands/plates/friends: keep their cooked look in sync
  for (const s of SK.values()) if (s.slot < 0) { const u = s.mat.userData.u; u.uDoneA.value = s.doneA; u.uDoneB.value = s.doneB; }
  G.sizzle = sizzle; G.flaring = flaring;
  if (Math.random() < dt * (3 + 5 * G.heat)) smoke.spawn(M0.x + rnd(-0.4, 0.4), MANGAL_TOP, M0.z + rnd(-0.12, 0.12), rnd(-0.05, 0.05), rnd(0.25, 0.5), 0, rnd(2.5, 4), 0.08, 0.8, [0.5, 0.48, 0.46], [0.42, 0.42, 0.45], 0.08, 0.5, 0.06);
  const emb = G.heat * G.heat * 4 + (fanning ? 45 : 0);
  if (Math.random() < dt * emb || (fanning && Math.random() < 0.6)) {
    const n = fanning ? 3 : 1;
    for (let k = 0; k < n; k++) embers.spawn(M0.x + rnd(-0.42, 0.42), MANGAL_TOP - 0.06, M0.z + rnd(-0.13, 0.13), rnd(-0.25, 0.25), rnd(0.5, fanning ? 2.2 : 1.3), rnd(-0.25, 0.25), rnd(0.7, 1.7), rnd(0.012, 0.022), 0.004, [3.0, 1.4, 0.4], [2.0, 0.3, 0.05], 1, 0.9, 0.35);
  }
  if (G.heat > 1.12 && Math.random() < dt * (G.heat - 1.1) * 30) flames.spawn(M0.x + rnd(-0.4, 0.4), MANGAL_TOP - 0.07, M0.z + rnd(-0.12, 0.12), 0, rnd(0.5, 0.9), 0, rnd(0.15, 0.3), rnd(0.03, 0.05), 0.01, [2.4, 1.3, 0.4], [1.2, 0.25, 0.05], 0.8, 1, 0.4);
  const fl = 0.85 + 0.15 * Math.sin(UT.value * 13) * Math.sin(UT.value * 7.3 + 1) + (Math.random() - 0.5) * 0.08;
  fireL.intensity = (1.3 + 3.0 * G.heat + flaring * 2.5) * fl;
  if (holeMat) holeMat.emissiveIntensity = (0.4 + 2.2 * G.heat) * fl;
}

// ================================================================== time of day
const sunDir = V();
function updateSky(p) {
  const elev = THREE.MathUtils.degToRad(lerp(17, -12, Math.pow(clamp(p, 0, 1.2), 0.85)));
  const az = THREE.MathUtils.degToRad(196);
  sunDir.setFromSphericalCoords(1, Math.PI / 2 - elev, az);
  skyU.sunPosition.value.copy(sunDir);
  const night = sstep(-0.02, -0.14, elev);
  const dusk = sstep(0.16, -0.05, elev);
  skyU.rayleigh.value = lerp(2.3, 0.9, dusk); skyU.turbidity.value = lerp(5.5, 9, dusk);
  skyU.time.value = UT.value;
  const dayI = sstep(-0.035, 0.08, elev);
  const mElev = THREE.MathUtils.degToRad(lerp(-4, 34, p)); const mAz = THREE.MathUtils.degToRad(30);
  const moonDir = V().setFromSphericalCoords(1, Math.PI / 2 - mElev, mAz);
  moon.position.copy(camera.position).addScaledVector(moonDir, 300); moon.lookAt(camera.position); moon.material.opacity = sstep(0.2, 0.8, night);
  if (dayI > 0.02) {
    sunL.position.copy(M0).addScaledVector(sunDir, 40); sunL.color.setRGB(1.0, lerp(0.55, 0.82, sstep(0, 0.16, elev)), lerp(0.3, 0.62, sstep(0, 0.16, elev)));
    sunL.intensity = 3.0 * dayI;
  } else {
    sunL.position.copy(M0).addScaledVector(moonDir.y > 0.05 ? moonDir : V(0.3, 0.6, 0.5).normalize(), 40); sunL.color.setRGB(0.55, 0.65, 1.0);
    sunL.intensity = 0.42 * sstep(0.2, 1, night);
  }
  sunL.target.position.copy(M0).add(V(1, 0, -0.5));
  hemi.intensity = lerp(1.35, 0.55, night);
  hemi.color.setRGB(lerp(0.85, 0.22, night), lerp(0.78, 0.28, night), lerp(0.85, 0.5, night));
  hemi.groundColor.setRGB(lerp(0.3, 0.06, night), lerp(0.22, 0.05, night), lerp(0.16, 0.06, night));
  const fogC = new THREE.Color().setRGB(lerp(0.80, 0.27, dusk), lerp(0.58, 0.22, dusk), lerp(0.48, 0.32, dusk)).lerp(new THREE.Color(0.025, 0.03, 0.055), night);
  scene.fog.color.copy(fogC);
  scene.fog.near = lerp(30, 14, night); scene.fog.far = lerp(170, 75, night);
  renderer.toneMappingExposure = lerp(0.68, 1.15, night) * SET.bright / 100;
  smoke.mat.uniforms.uTint.value.setRGB(lerp(0.30, 1, dayI), lerp(0.25, 1, dayI), lerp(0.24, 1, dayI));
  stars.material.uniforms.uO.value = sstep(0.3, 1, night);
  const lightsOn = sstep(0.25, 0.45, p);
  const flick = 0.92 + 0.08 * Math.sin(UT.value * 2.0);
  fairyLs.forEach(l => l.intensity = lightsOn * 4.5 * flick);
  lanternL.intensity = (0.5 + 5 * sstep(0.15, 0.5, p)) * (0.9 + 0.1 * Math.sin(UT.value * 9) * Math.sin(UT.value * 5.1));
  if (lanternMat) lanternMat.emissiveIntensity = 0.4 + 3 * sstep(0.15, 0.5, p);
  if (fairyBulbs) {
    const c = new THREE.Color();
    for (let i = 0; i < fairyBulbs.userData.n; i++) {
      const tw = 0.75 + 0.25 * Math.sin(UT.value * 2.2 + i * 1.7);
      c.copy(fairyBulbs.userData.base[i % 5]).multiplyScalar(0.15 + lightsOn * 3.2 * tw); fairyBulbs.setColorAt(i, c);
    }
    fairyBulbs.instanceColor.needsUpdate = true;
  }
  G.night01 = night;
  fpMats.forEach(m => m.emissiveIntensity = 0.15 + 0.9 * night);
  if (night > 0.4 && fireflies.n < 45 && Math.random() < 0.3) {
    const a = Math.random() * 6.28, d = rnd(4, 11);
    fireflies.spawn(0.5 + Math.cos(a) * d, rnd(0.3, 1.6), -1 + Math.sin(a) * d, rnd(-0.2, 0.2), rnd(-0.05, 0.1), rnd(-0.2, 0.2), rnd(3, 6), 0.035, 0.03, [1.6, 2.6, 0.6], [1.2, 2.2, 0.4], 1, 0.3, 0);
  }
}

// ================================================================== hand / grill placement
function setHand(P, s) { P.hand = s; if (s) setLoc(s, ['h', P.id]); }
function layoutPlate() { G.plate.forEach((s, k) => setLoc(s, ['p', k])); }
function placeOnGrill(s, i) {
  G.slots[i] = s; s.slot = i; s.flare = 0; setLoc(s, ['s', i]);
  sfx('place', s.grp.position); fx({ k: 'sm', n: 'place', i });
}

// ================================================================== interaction
const raycaster = new THREE.Raycaster();
let target = null;
function updateTarget() {
  camera.updateMatrixWorld();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = 14;
  const hits = raycaster.intersectObjects(proxies.filter(p => !p.userData.disabled && (p.userData.kind !== 'dog' || dog.obj.visible)), false);
  target = null;
  for (const h of hits) {
    const k = h.object.userData.kind;
    const lim = k === 'dog' ? 13 : k === 'friend' ? 3.4 : CONFIG.reach;
    if (h.distance <= lim) { target = Object.assign({}, h.object.userData, { dist: h.distance }); break; }
    if (k !== 'dog') break;
  }
  if (dog && dog.obj.visible && (dog.state === 'approach' || dog.state === 'sniff') && (!target || target.kind !== 'dog')) {
    const c = dog.obj.position.clone().add(V(0, 0.4, 0)); const to = c.sub(camera.position); const dist = to.length();
    const fwd = V(0, 0, -1).applyQuaternion(camera.quaternion);
    if (dist < 13 && to.normalize().dot(fwd) > Math.cos(0.1 + 0.25 / Math.max(dist, 1)) && (!target || target.dist > dist)) target = { kind: 'dog', dist };
  }
}
function nearMangal(P = me) { const p = posOf(P); return Math.hypot(p.x - M0.x, p.z - M0.z) < 2.7; }
function promptFor(t) {
  const h = me.hand;
  if (!t) return '';
  switch (t.kind) {
    case 'source': {
      const T = TYPES[t.type];
      if (T.level > G.contentLevel) return `🔒 ${T.name}: откроется на уровне ${T.level}`;
      if (h) return h.type === t.type && h.doneA + h.doneB < 0.05 ? `<kbd>ЛКМ</kbd> Положить обратно` : 'Руки заняты';
      return `<kbd>ЛКМ</kbd> Взять шампур: ${T.name.toLowerCase()} ${T.icon}`;
    }
    case 'slot': {
      const s = G.slots[t.i];
      if (s) return h ? 'Руки заняты' : `<kbd>ЛКМ</kbd> Перевернуть &nbsp;·&nbsp; <kbd>E</kbd> Снять`;
      return h ? `<kbd>ЛКМ</kbd> Положить на мангал` : `<kbd>F</kbd> Раздуть &nbsp;·&nbsp; <kbd>Q</kbd> Сбрызнуть`;
    }
    case 'mangal': return `<kbd>Держи F</kbd> Раздуть угли &nbsp;·&nbsp; <kbd>Q</kbd> Сбрызнуть водой`;
    case 'plate': {
      if (h) return G.plate.length < 3 ? `<kbd>ЛКМ</kbd> Положить на тарелку (перестанет жариться)` : 'Тарелка полная';
      return G.plate.length ? `<kbd>ЛКМ</kbd> Взять шампур с тарелки (${G.plate.length})` : 'Тарелка: сюда можно отложить готовые шампуры';
    }
    case 'charcoal': return `<kbd>ЛКМ</kbd> Подсыпать угля (−${CONFIG.charcoalCost} ₽)`;
    case 'trash': return h ? `<kbd>ЛКМ</kbd> Выбросить шампур` : 'Мусорный мешок';
    case 'friend': {
      const f = friends[t.i];
      if (f.state === 'hungry' && f.order) return h ? `<kbd>ЛКМ</kbd> Угостить: ${f.def.name}` : `${f.def.name} хочет ${TYPES[f.order.type].icon} ${TYPES[f.order.type].acc}${f.order.mod !== 'normal' ? ' (' + MODS[f.order.mod] + ')' : ''}`;
      return f.state === 'eating' ? `${f.def.name} ест` : `${f.def.name} отдыхает`;
    }
    case 'dog': return h ? `<kbd>ЛКМ</kbd> Накормить Шарика` : `<kbd>ЛКМ</kbd> Прогнать! «Фу, Шарик!»`;
  }
  return '';
}
const tgOf = t => t ? { kind: t.kind, i: t.i, type: t.type, dist: t.dist } : null;
// local input -> either run directly (solo/host) or ask the host
function doAct() {
  if (G.mode !== 'play' || !target) return;
  reach();
  if (NET.role === 'client') { NET.send('h', { t: 'act', tg: tgOf(target) }); return; }
  act(me, target);
}
function doTake() {
  if (G.mode !== 'play' || !target || target.kind !== 'slot' || me.hand || !G.slots[target.i]) return;
  reach();
  if (NET.role === 'client') { NET.send('h', { t: 'take', tg: tgOf(target) }); return; }
  takeOff(me, target);
}
function doSpray() {
  if (G.mode !== 'play' || !nearMangal(me)) return;
  if (!me.hand) me.sprayAnim = 0.5;
  if (NET.role === 'client') { NET.send('h', { t: 'spray' }); return; }
  spray(me);
}
function act(P, t) {
  if (!t || (G.mode !== 'play' && G.mode !== 'paused')) return;
  const h = P.hand;
  const deny = () => fxTo(P, { k: 's', n: 'deny' });
  switch (t.kind) {
    case 'source': {
      const T = TYPES[t.type]; if (!T) return;
      if (T.level > G.contentLevel) { deny(); fxTo(P, { k: 't', x: `${T.name}: откроется на уровне ${T.level}`, d: 1.6 }); return; }
      if (h) { if (h.type === t.type && h.doneA + h.doneB < 0.05) { P.hand = null; dropSkewer(h); sfx('grab', posOf(P)); } else deny(); return; }
      const s = makeSkewer(t.type); setHand(P, s); sfx('grab', posOf(P));
      if (G.tutStep === 1 && P === me) advanceTut();
      return;
    }
    case 'slot': {
      if (!(t.i >= 0 && t.i < CONFIG.slots)) return;
      const s = G.slots[t.i];
      if (s && !h) { s.flipped = !s.flipped; s.rotT += Math.PI; sfx('flip', s.grp.position); if (G.tutStep === 3 && P === me) advanceTut(); return; }
      if (!s && h) { P.hand = null; placeOnGrill(h, t.i); if (G.tutStep === 2 && P === me) advanceTut(); return; }
      deny(); return;
    }
    case 'plate': {
      if (h) { if (G.plate.length >= 3) { deny(); return; } P.hand = null; G.plate.push(h); layoutPlate(); sfx('take', PLATE); return; }
      if (!G.plate.length) return;
      let bi = 0, bq = -1; G.plate.forEach((s, i) => { const q = grade(s, null).q; if (q > bq) { bq = q; bi = i; } });
      const s = G.plate.splice(bi, 1)[0]; layoutPlate(); setHand(P, s); sfx('take', PLATE); return;
    }
    case 'charcoal': {
      if (G.coalCD > 0) return;
      if (G.fuel > 0.95) { fxTo(P, { k: 't', x: 'Мангал и так полон углей', d: 1.5 }); return; }
      G.fuel = Math.min(1, G.fuel + 0.45); G.heat = Math.max(0.2, G.heat - 0.12); G.score = Math.max(0, G.score - CONFIG.charcoalCost); G.coalCD = 1.2;
      sfx('coal', M0); flt(V(0.82, 0.8, -1.08), `−${CONFIG.charcoalCost} ₽`, '#f1e3c8'); fx({ k: 'sm', n: 'coal' });
      return;
    }
    case 'trash': {
      if (!h) return; P.hand = null; dropSkewer(h); sfx('grab', V(1.45, 0.5, -0.2));
      if (Math.max(h.doneA, h.doneB) > 1.32) flt(V(1.45, 0.8, -0.2), 'Покойся с миром, шампур', '#f1e3c8');
      return;
    }
    case 'friend': {
      const f = friends[t.i]; if (!f || !f.active) return;
      if (f.state === 'hungry' && h) { P.hand = null; serve(f, h, P); return; }
      if (h && f.state !== 'hungry') { say(f, pick(['Спасибо, я сыт!', 'Пока не голоден', 'Попозже!']), 1.6); voice(f, 2, 0); }
      return;
    }
    case 'dog': {
      if (dog.state !== 'approach' && dog.state !== 'sniff') return;
      if (h) { if (t.dist > CONFIG.reach + 0.6) { fxTo(P, { k: 't', x: 'Подойди ближе, чтобы накормить', d: 1.2 }); return; } feedDog(P); } else shooDog(P);
      return;
    }
  }
}
function takeOff(P, t) {
  if (!t || t.kind !== 'slot' || P.hand || (G.mode !== 'play' && G.mode !== 'paused')) return;
  const s = G.slots[t.i]; if (!s) return;
  G.slots[t.i] = null; s.slot = -1; s.flare = 0; setHand(P, s); sfx('take', posOf(P));
  if (G.tutStep === 4 && P === me) advanceTut();
}
function spray(P) {
  if (G.sprayCD > 0 || !nearMangal(P) || (G.mode !== 'play' && G.mode !== 'paused')) return;
  G.sprayCD = 0.55; G.heat = Math.max(0.1, G.heat - 0.2);
  let out = 0;
  G.slots.forEach(s => { if (s && s.flare > 0) { s.flare = 0; out++; } });
  if (out) { G.flaresOut += out; save.flares += out; if (save.flares >= 10) teamAward('fire10'); flt(V(M0.x, 1.1, M0.z), out > 1 ? `Потушено вспышек: ${out}` : 'Вспышка потушена!', '#8fd7ff'); }
  sfx('spray', M0); fx({ k: 'sm', n: 'spray' });
}
function reach() { player.reachT = 0.25; }

// ================================================================== other players' avatars
function tintMat(base, col) {
  const m = base.clone(); m.userData.tint = { value: col.clone() };
  m.onBeforeCompile = sh => {
    sh.uniforms.uTint = m.userData.tint;
    sh.fragmentShader = 'uniform vec3 uTint;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      { float mc = min(vColor.r, min(vColor.g, vColor.b)); float w = smoothstep(0.42, 0.55, mc); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uTint, w); }`);
  };
  m.customProgramCacheKey = () => 'tint';
  return m;
}
function makeAvatar(P) {
  const o = SkeletonUtils.clone(get('friendP'));
  const col = new THREE.Color(P.color);
  o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; c.frustumCulled = false; if (c.material && c.material.name === 'vc_cloth') c.material = tintMat(c.material, col); } });
  o.position.copy(P.pos); scene.add(o);
  const mixer = new THREE.AnimationMixer(o); const actions = {};
  for (const clip of gltf.animations) if (clip.name.startsWith('stand_')) { const c = clip.clone(); c.tracks.forEach(t => t.name = t.name.replace(/^A_/, 'P_')); actions[clip.name] = mixer.clipAction(c); }
  const tag = document.createElement('div'); tag.className = 'ptag'; $('bubbles').appendChild(tag);
  P.avatar = { o, mixer, actions, cur: null, head: o.getObjectByName('P_Head'), handR: o.getObjectByName('P_HandR'), tag, speed: 0, last: P.pos.clone() };
  P.avatar.play = (n, f = 0.25) => { const a = P.avatar; if (a.cur === n || !a.actions[n]) return; a.actions[n].reset().fadeIn(f).play(); if (a.cur) a.actions[a.cur].fadeOut(f); a.cur = n; };
  P.avatar.play('stand_idle', 0);
}
function addRemote(id, name, color) {
  let P = PL.get(id);
  if (!P) { P = { id, name, color, pos: V(0.3, 0, 0.9), tpos: V(0.3, 0, 0.9), yaw: 0, tyaw: 0, pitch: 0, fan: false, hand: null }; PL.set(id, P); makeAvatar(P); }
  P.name = name; if (P.color !== color) { P.color = color; P.avatar.o.traverse(c => { if (c.isMesh && c.material.userData.tint) c.material.userData.tint.value.set(color); }); }
  return P;
}
function removeRemote(id) {
  const P = PL.get(id); if (!P) return;
  if (P.hand && isAuthority()) dropSkewer(P.hand);
  P.avatar.o.removeFromParent(); P.avatar.tag.remove(); PL.delete(id);
}
function updateAvatars(dt) {
  for (const P of PL.values()) {
    const a = P.avatar;
    if (P.pos.distanceTo(P.tpos) > 4) P.pos.copy(P.tpos); else P.pos.lerp(P.tpos, 1 - Math.exp(-12 * dt));
    let dy = P.tyaw - P.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); P.yaw += dy * (1 - Math.exp(-14 * dt));
    const sp = dt > 0 ? a.last.distanceTo(P.pos) / dt : 0; a.last.copy(P.pos); a.speed += (sp - a.speed) * (1 - Math.exp(-8 * dt));
    a.o.position.set(P.pos.x, 0, P.pos.z); a.o.rotation.y = P.yaw + Math.PI;
    const moving = a.speed > 0.35, holding = !!P.hand;
    const fanning = P.fan && !holding && nearMangal(P);
    a.play(fanning ? 'stand_fan' : holding ? (moving ? 'stand_hold_walk' : 'stand_hold') : moving ? 'stand_walk' : 'stand_idle');
    if (a.actions[a.cur]) a.actions[a.cur].timeScale = moving ? clamp(a.speed / 1.6, 0.7, 2.2) : 1;
    a.mixer.update(dt);
    a.head.rotateX(clamp(-P.pitch * 0.6, -0.5, 0.6));
    a.o.updateMatrixWorld(true);
    if (P.hand && P.hand.loc && P.hand.loc[0] === 'h') {
      const hand = a.handR.getWorldPosition(V());
      const dir = V(-Math.sin(P.yaw), -0.18, -Math.cos(P.yaw)).normalize();
      P.hand.grp.quaternion.setFromUnitVectors(V(0, 0, -1), dir);
      P.hand.grp.position.copy(hand).addScaledVector(dir, 0.3);
    }
    // name tag
    const hp = a.head.getWorldPosition(V()).add(V(0, 0.42, 0)); const pp = hp.project(camera);
    const vis = (G.mode === 'play' || G.mode === 'paused') && pp.z < 1 && Math.abs(pp.x) < 1.1 && Math.abs(pp.y) < 1.1;
    a.tag.style.display = vis ? '' : 'none';
    if (vis) {
      a.tag.style.left = ((pp.x + 1) / 2 * innerWidth) + 'px'; a.tag.style.top = ((1 - pp.y) / 2 * innerHeight) + 'px';
      if (a.qcT > 0) a.qcT -= dt;
      const html = `<i style="background:${P.color}"></i>${esc(P.name)}${P.hand ? ' ' + TYPES[P.hand.type].icon : ''}${a.qcT > 0 ? `<span class="qc">${a.qc}</span>` : ''}`;
      if (a._html !== html) { a._html = html; a.tag.innerHTML = html; }
    }
  }
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ================================================================== networking glue
let netSendT = 0, netPingT = 0, netDogT = 0, lobbyInfo = null;
function rosterList() {
  const list = [{ id: NET.role === 'host' ? 'h' : me.id, name: me.name, color: me.color }];
  if (NET.role === 'host') for (const P of PL.values()) list.push({ id: P.id, name: P.name, color: P.color });
  return list;
}
function sendLobby() {
  if (NET.role !== 'host') return;
  lobbyInfo = { t: 'lobby', mode: G.mode === 'paused' ? 'play' : G.mode, code: NET.code, players: rosterList(), lvl: G.contentLevel };
  NET.broadcast(lobbyInfo); refreshCoop();
}
function snapshot() {
  const sk = [];
  for (const s of SK.values()) if (s.loc) sk.push([s.id, s.type, s.v, r3(s.doneA), r3(s.doneB), s.flipped ? 1 : 0, r2(s.rotT), s.flare > 0 ? 1 : 0, r2(s.mat.userData.u.uEat.value), s.loc]);
  const fr = friends.map(f => [f.state, f.cur, f.order ? [f.order.type, f.order.mod, r1(f.order.left), f.order.total] : 0, f.grade || '', f.sayT > 0 ? f.sayText : '', r1(f.sayT), f.guitar ? (f.guitar.visible ? 1 : 0) : 0]);
  const dp = dog.obj.position;
  const pl = [['h', me.name, me.color, r2(player.pos.x), r2(player.pos.z), r2(player.yaw), r2(player.pitch), me.fanIn ? 1 : 0]];
  for (const P of PL.values()) pl.push([P.id, P.name, P.color, r2(P.tpos.x), r2(P.tpos.z), r2(P.tyaw), r2(P.pitch), P.fan ? 1 : 0]);
  return { nid: G.nid, mode: 'play', t: r2(G.t), sc: G.score, cb: G.combo, md: r1(G.mood), ht: r3(G.heat), fu: r3(G.fuel), fan: G.fanning ? 1 : 0, night: G.night, lvl: G.contentLevel, end: G.ending ? 1 : 0,
    sk, fr, dg: [dog.state, r2(dp.x), r2(dp.z), r2(dog.obj.rotation.y), dog.cur], pl };
}
function applySnap(S) {
  if (S.nid !== G.nid) { G.nid = S.nid; if (S.lvl !== G.contentLevel) setFriendsForLevel(S.lvl); resetNight(false, true); G.night = S.night; enterPlayUI(true); }
  else if (G.mode !== 'play' && G.mode !== 'paused') enterPlayUI(false);
  if (S.lvl !== G.contentLevel) setFriendsForLevel(S.lvl);
  if (Math.abs(S.t - G.t) > 1) G.t = S.t; else G.t += (S.t - G.t) * 0.3;
  Object.assign(G, { score: S.sc, combo: S.cb, mood: S.md, heat: S.ht, fuel: S.fu, fanning: !!S.fan, night: S.night, ending: !!S.end });
  // skewers
  const seen = new Set();
  G.slots = new Array(CONFIG.slots).fill(null); G.plate = []; me.hand = null; friends.forEach(f => f.held = null); dog.carried = null; PL.forEach(P => P.hand = null);
  for (const r of S.sk) {
    const [id, type, v, a, b, fl, rotT, flare, eat, loc] = r;
    let s = SK.get(id); if (!s) { s = makeSkewer(type, v, id); s.rot = rotT; }
    s.doneA = a; s.doneB = b; s.flipped = !!fl; s.rotT = rotT; s.flare = flare; s.mat.userData.u.uEat.value = eat;
    const key = loc.join(':');
    if (key !== s.locKey) { s.loc = loc; s.locKey = key; attach(s); }
    if (loc[0] === 's') { G.slots[loc[1]] = s; s.slot = loc[1]; } else s.slot = -1;
    if (loc[0] === 'p') G.plate[loc[1]] = s;
    if (loc[0] === 'h') { const P = playerById(loc[1]); if (P) P.hand = s; }
    if (loc[0] === 'f') { const f = friends[loc[1]]; if (f) f.held = s; }
    if (loc[0] === 'd') dog.carried = s;
    seen.add(id);
  }
  G.plate = G.plate.filter(Boolean);
  for (const [id, s] of SK) if (!seen.has(id)) dropSkewer(s);
  // friends
  S.fr.forEach((r, i) => {
    const f = friends[i]; if (!f) return;
    const [st, cur, o, gr, sayText, sayT, gv] = r;
    f.state = st; if (cur && cur !== f.cur) f.play(cur);
    f.order = o ? { type: o[0], mod: o[1], left: o[2], total: o[3] } : null;
    f.grade = gr || null;
    if (sayText) { if (sayText !== f.sayText || f.sayT <= 0) { f.sayText = sayText; f.sayT = sayT; } } else f.sayT = 0;
    if (f.guitar) f.guitar.visible = !!gv;
  });
  // dog
  const [ds, dx, dz, dry, dcur] = S.dg;
  if (dog.state === 'away' && ds !== 'away') dog.obj.position.set(dx, 0, dz);
  dog.state = ds; dog.tp.set(dx, 0, dz); dog.tr = dry; if (dcur) dog.play(dcur);
  // players
  const ids = new Set();
  for (const [id, name, color, x, z, yaw, pitch, fan] of S.pl) {
    if (id === me.id) { if (me.color !== color) me.color = color; continue; }
    ids.add(id);
    const P = addRemote(id, name, color);
    P.tpos.set(x, 0, z); P.tyaw = yaw; P.pitch = pitch; P.fan = !!fan;
  }
  for (const id of [...PL.keys()]) if (!ids.has(id)) removeRemote(id);
  lobbyInfo = lobbyInfo || {};
  lobbyInfo.players = S.pl.map(p => ({ id: p[0], name: p[1], color: p[2] }));
}
function setupNet() {
  NET.handlers.join = (pid, d) => {
    const name = String(d.name || 'Повар').slice(0, 14) || 'Повар';
    const P = addRemote(pid, name, COLORS[pid] || '#ffffff');
    NET.send(pid, { t: 'welcome', id: pid, color: P.color });
    sendLobby();
    tst(`${esc(name)} приехал на дачу 👋`, 2.4); sfx('ui');
  };
  NET.handlers.leave = pid => {
    const P = PL.get(pid); if (!P) return;
    removeRemote(pid); sendLobby();
    tst(`${esc(P.name)} уехал домой`, 2.2);
  };
  NET.handlers.data = (pid, d) => {
    if (!d || typeof d !== 'object') return;
    if (NET.role === 'host') {
      const P = PL.get(pid); if (!P) return;
      switch (d.t) {
        case 'p': if (isFinite(d.x) && isFinite(d.z)) { P.tpos.set(d.x, 0, d.z); P.tyaw = +d.y || 0; P.pitch = +d.pi || 0; P.fan = !!d.f; } break;
        case 'act': act(P, d.tg); break;
        case 'take': takeOff(P, d.tg); break;
        case 'spray': spray(P); break;
        case 'qc': if ((d.i | 0) >= 0 && (d.i | 0) < QC.length) fx({ k: 'qc', id: P.id, i: d.i | 0 }); break;
        case 'name': P.name = String(d.name || 'Повар').slice(0, 14); sendLobby(); break;
      }
      return;
    }
    switch (d.t) {
      case 'welcome': NET.myId = d.id; me.color = d.color; refreshCoop(); break;
      case 's': applySnap(d.s); break;
      case 'ev': runEv(d.e); break;
      case 'end': if (G.mode !== 'results') showResults(d.st); break;
      case 'lobby': lobbyInfo = d; if (d.mode === 'menu' && G.mode !== 'menu') showMenu(); setFriendsForLevel(d.lvl || 1); refreshCoop(); break;
      case 'full': coopMsg('На этой даче нет мест (максимум 4 повара).', true); leaveCoop(true); break;
      case 'bye': coopLost('Хозяин закрыл дачу.'); break;
    }
  };
  NET.handlers.lost = msg => coopLost(msg);
  NET.handlers.status = msg => { if (!NET.on) coopMsg(esc(msg)); };
}
function coopLost(msg) {
  if (!NET.on) return;
  leaveCoop(true); showMenu(); coopMsg(msg, true); toast(msg, 3);
}
function netTick(dt) {
  if (!NET.on) return;
  netSendT += dt; netPingT += dt;
  if (NET.role === 'host') {
    if ((G.mode === 'play' || G.mode === 'paused') && netSendT > 1 / 12) { netSendT = 0; if (NET.conns.size) NET.broadcast({ t: 's', s: snapshot() }); }
    if (netPingT > 2) { netPingT = 0; NET.broadcast({ t: 'ping' }); NET.watchdog(); }
  } else {
    if ((G.mode === 'play' || G.mode === 'paused') && netSendT > 1 / 15) { netSendT = 0; NET.send('h', { t: 'p', x: r2(player.pos.x), z: r2(player.pos.z), y: r2(player.yaw), pi: r2(player.pitch), f: me.fanIn ? 1 : 0 }); }
    else if (netPingT > 2) { netPingT = 0; NET.send('h', { t: 'ping' }); }
    if (netPingT > 1) NET.watchdog();
  }
}
async function hostCoop() {
  saveName(); coopMsg('Открываем дачу…');
  try {
    const code = await NET.host(); me.color = COLORS.h; G.contentLevel = levelOf(save.xp);
    coopMsg(`Отправь друзьям код <b>${code}</b>. Пусть откроют этот же файл, введут код и нажмут «Войти».`);
    sendLobby(); refreshCoop(); SFX_.init(); SFX_.play('ui');
  } catch (e) { coopMsg(e.message, true); NET.leave(); }
}
async function joinCoop() {
  saveName(); const code = $('codeIn').value.trim().toUpperCase();
  coopMsg(`Стучимся на дачу ${esc(code)}…`);
  try { await NET.join(code, { name: me.name }); coopMsg(`Ты на даче <b>${NET.code}</b>. Ждём, пока хозяин разожжёт мангал…`); refreshCoop(); SFX_.init(); SFX_.play('ui'); }
  catch (e) { coopMsg(esc(e.message) + ' <a href="#" id="logBtn" class="loglink">Скопировать журнал связи</a>', true); NET.leave(); refreshCoop(); const lb = $('logBtn'); if (lb) lb.onclick = ev => { ev.preventDefault(); try { navigator.clipboard.writeText(netLog()); lb.textContent = 'Журнал скопирован'; } catch (x) { } }; }
}
function leaveCoop(silent) {
  NET.leave(); for (const id of [...PL.keys()]) removeRemote(id); lobbyInfo = null; me.color = COLORS.solo;
  if (!silent) coopMsg('');
  setFriendsForLevel(levelOf(save.xp)); refreshCoop();
}
function saveName() { const n = ($('nameIn').value || '').trim().slice(0, 14); me.name = n || 'Повар'; save.name = n; persist(); }
function coopMsg(html, err) { const el = $('coopMsg'); el.innerHTML = html; el.classList.toggle('err', !!err); }
function refreshCoop() {
  const inRoom = NET.on;
  $('coopIdle').classList.toggle('hidden', inRoom); $('coopRoom').classList.toggle('hidden', !inRoom);
  if (inRoom) {
    $('roomCode').textContent = NET.code || '…';
    const ps = NET.role === 'host' ? rosterList() : (lobbyInfo && lobbyInfo.players) || [];
    $('roomPlayers').innerHTML = ps.map(p => `<span class="chip"><i class="dot" style="background:${p.color}"></i>${esc(p.name)}${p.id === 'h' ? ' · хозяин' : ''}${p.id === me.id ? ' (ты)' : ''}</span>`).join('') + (ps.length < MAX_PLAYERS ? `<span class="chip lock">свободно мест: ${MAX_PLAYERS - ps.length}</span>` : '');
  }
  const sb = $('startBtn');
  if (NET.role === 'client') { sb.disabled = true; sb.textContent = 'Ждём хозяина…'; }
  else { sb.disabled = false; sb.textContent = NET.role === 'host' ? `Разжечь мангал · поваров: ${chefs()}` : (save.nights ? `Ночь ${save.nights + 1}: разжечь мангал` : 'Разжечь мангал'); }
}



// ================================================================== UI
let toastTimer = 0;
function toast(t, dur = 2) { const el = $('toast'); el.innerHTML = kb(t); el.style.opacity = 1; toastTimer = dur; }
function floater(world, text, color = '#fff') {
  const p = world.clone().project(camera); if (p.z > 1) return;
  const el = document.createElement('div'); el.className = 'fl'; el.textContent = text; el.style.color = color;
  el.style.left = ((p.x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - p.y) / 2 * innerHeight) + 'px';
  $('floaters').appendChild(el); setTimeout(() => el.remove(), 1700);
}
function award(id) {
  if (save.ach[id]) return; save.ach[id] = Date.now(); persist(); G.earnedAch.push(id);
  const a = ACH.find(x => x.id === id); if (!a) return; $('apI').textContent = a.i; $('apN').textContent = a.t.split(':')[0];
  const el = $('achpop'); el.classList.add('show'); SFX_.play('achieve'); clearTimeout(award.t); award.t = setTimeout(() => el.classList.remove('show'), 3200);
}
const hudCache = {};
const setHTML = (id, v) => { if (hudCache[id] !== v) { hudCache[id] = v; $(id).innerHTML = kb(v); } };
function updateHUD(dt) {
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').style.opacity = 0; }
  const p = G.t / CONFIG.nightLength;
  const mins = 19 * 60 + 30 + Math.floor(clamp(p, 0, 1) * 300);
  setHTML('clock', `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);
  setHTML('nightlbl', `Ночь ${G.night} · ${CONFIG.nightLength - G.t < 30 ? '<b style="color:#ffcf6a">последние заказы!</b>' : TITLES[Math.min(levelOf(save.xp) - 1, 5)]}`);
  setHTML('score', `${G.score.toLocaleString('ru')} ₽`);
  const cm = 1 + 0.25 * Math.min(G.combo, 8);
  setHTML('combo', G.combo > 1 ? `🔥 ${G.combo} идеальных · ×${cm.toFixed(2).replace(/\.?0+$/, '')}` : '');
  $('mood').firstElementChild.style.width = G.mood + '%';
  setHTML('moodemo', G.mood < 20 ? '😡' : G.mood < 45 ? '😕' : G.mood < 70 ? '🙂' : G.mood < 90 ? '😄' : '🤩');
  const hb = $('heat').firstElementChild; hb.style.left = `calc(${clamp(G.heat / 1.6, 0, 1) * 100}% - 2px)`;
  setHTML('heatTxt', G.heat < 0.48 ? 'холодно' : G.heat < 0.76 ? 'тепло' : G.heat < 1.09 ? '<span style="color:#8fbf5a">отлично</span>' : '<span style="color:#ff7a50">слишком жарко!</span>');
  $('fuel').firstElementChild.style.width = (G.fuel * 100) + '%';
  setHTML('fuelTxt', G.fuel < 0.2 ? '<span style="color:#ff7a50">подсыпь угля!</span>' : Math.round(G.fuel * 100) + '%');
  $('dmg').style.boxShadow = G.flaring ? 'inset 0 0 140px rgba(255,90,30,.28)' : G.mood < 20 ? 'inset 0 0 160px rgba(200,30,20,.25)' : 'inset 0 0 120px rgba(255,90,30,0)';
  // co-op roster chip
  if (NET.on) {
    const ps = [{ name: me.name, color: me.color, you: true }, ...[...PL.values()].map(P => ({ name: P.name, color: P.color }))];
    setHTML('coopHud', `🏡 <b>${NET.code}</b> &nbsp;` + ps.map(p => `<span class="pc"><i style="background:${p.color}"></i>${esc(p.name)}${p.you ? ' (ты)' : ''}</span>`).join(''));
    $('coopHud').classList.remove('hidden');
  } else $('coopHud').classList.add('hidden');
  const pr = G.mode === 'play' ? (!locked && !noLock && !isTouch ? '<kbd>Клик</kbd> чтобы осматриваться' : promptFor(target)) : '';
  setHTML('prompt', pr); $('cross').classList.toggle('on', !!pr && pr.includes('kbd'));
  let ins = null;
  if (target && target.kind === 'slot' && G.slots[target.i]) ins = G.slots[target.i]; else if (target && target.kind === 'plate' && !me.hand && G.plate.length) ins = G.plate.reduce((a, b) => grade(b, null).q > grade(a, null).q ? b : a); else if (me.hand && me.hand.doneA + me.hand.doneB > 0.02) ins = me.hand;
  const ip = $('inspect');
  if (ins && G.mode === 'play') {
    ip.classList.remove('hidden');
    const bottom = ins.flipped ? ins.doneB : ins.doneA, top = ins.flipped ? ins.doneA : ins.doneB;
    setHTML('insName', `${TYPES[ins.type].icon} ${TYPES[ins.type].name}${ins.flare > 0 ? ' 🔥' : ''}`);
    const lbl = d => d < TYPES[ins.type].raw ? 'сырое' : d < 0.78 ? 'розовое' : d <= 1.04 ? '<span style="color:#8fbf5a">золотистое</span>' : d < 1.32 ? 'прожаренное' : '<span style="color:#ff7a50">сгорело</span>';
    $('insA').style.left = `calc(${clamp(bottom / 1.5, 0, 1) * 100}% - 2px)`; $('insB').style.left = `calc(${clamp(top / 1.5, 0, 1) * 100}% - 2px)`;
    setHTML('insAl', lbl(bottom)); setHTML('insBl', lbl(top));
    const g = grade(ins, null);
    setHTML('insQ', g.g === 'PERFECT' ? '<span style="color:#ffd36a">готово!</span>' : g.g === 'BURNT' ? '<span style="color:#ff7a50">испорчено</span>' : '');
  } else ip.classList.add('hidden');
  for (const f of friends) {
    if (!f.active) continue;
    let ic = '💤', nm = f.def.name, sub = 'отдыхает', w = 0, cls = 'ord panel idle';
    if (f.state === 'hungry' && f.order) {
      const o = f.order; const T = TYPES[o.type]; ic = T.icon; sub = `хочет ${T.acc}${o.mod !== 'normal' ? ' · <b>' + MODS[o.mod] + '</b>' : ''}`; w = o.left / o.total * 100;
      cls = 'ord panel' + (w < 30 ? ' urgent' : '');
    } else if (f.state === 'eating') { ic = '😋'; sub = 'ест'; } else if (f.state === 'react') { ic = { PERFECT: '🤩', GOOD: '😊', OK: '😐', RAW: '🤢', BURNT: '😵', ANGRY: '😠' }[f.grade] || '🙂'; sub = 'делится впечатлениями'; }
    else if (f.def.guitar && f.cur === 'sit_strum') { ic = '🎸'; sub = 'играет на гитаре'; }
    const html = `<div class="ic">${ic}</div><div style="flex:1"><div class="nm">${nm}</div><div class="sub">${sub}</div>${f.state === 'hungry' ? `<div class="track"><i style="width:${w}%;background:${w < 30 ? '#ee4a3a' : w < 60 ? '#ffcf6a' : '#8fbf5a'}"></i></div>` : ''}</div>`;
    if (f._cardHTML !== html) { f._cardHTML = html; f.card.innerHTML = html; }
    if (f.card.className !== cls) f.card.className = cls;
    const show = G.mode === 'play' && ((f.state === 'hungry' && f.order) || f.sayT > 0);
    const hp = headPos(f).add(V(0, 0.22, 0)); const pp = hp.clone().project(camera);
    const vis = show && pp.z < 1 && Math.abs(pp.x) < 1.2 && Math.abs(pp.y) < 1.2;
    f.bubble.style.display = vis ? '' : 'none';
    if (vis) {
      f.bubble.style.left = ((pp.x + 1) / 2 * innerWidth) + 'px'; f.bubble.style.top = ((1 - pp.y) / 2 * innerHeight) + 'px';
      let inner;
      if (f.sayT > 0) inner = `<span class="say">${f.sayText}</span>`;
      else { const o = f.order; const fr = o.left / o.total; inner = `<span class="ring" style="background:conic-gradient(${fr < 0.3 ? '#ee4a3a' : fr < 0.6 ? '#e8a93a' : '#6aa040'} ${fr * 360}deg, rgba(0,0,0,.12) 0)"><span class="e">${TYPES[o.type].icon}</span></span>${o.mod !== 'normal' ? MODS[o.mod] : ''}`; }
      if (f._bubHTML !== inner) { f._bubHTML = inner; f.bubble.firstElementChild.innerHTML = inner; }
      f.bubble.classList.toggle('urgent', f.state === 'hungry' && f.order && f.order.left / f.order.total < 0.3 && !(f.sayT > 0));
    }
  }
}

const TUT = [
  null,
  'Вася проголодался. Возьми <b class="k">шампур со свининой</b> из эмалированного ведра слева от мангала. <kbd>ЛКМ</kbd>',
  'Положи его на мангал. Наведись на свободное место и жми <kbd>ЛКМ</kbd>.',
  'Жарится только нижняя сторона. Следи за мясом (и полоской). Когда станет <b class="k">золотистым</b>, жми <kbd>ЛКМ</kbd>, чтобы перевернуть.',
  'Обе стороны золотистые? Снимай с мангала: <kbd>E</kbd>.',
  'Подойди к другу с облачком и угости его. <kbd>ЛКМ</kbd><br><small>Держи жар в зелёной зоне: <kbd>F</kbd> раздувает угли, <kbd>Q</kbd> тушит вспышки, бумажный мешок добавляет угля, на тарелку на пне можно отложить готовые шампуры.</small>',
];
function advanceTut() {
  G.tutStep++; if (G.tutStep >= TUT.length) { G.tutStep = 0; save.tut = true; persist(); $('tut').classList.add('hidden'); toast('Отлично! Корми всех до полуночи!', 2.6); return; }
  showTut();
}
function showTut() { const el = $('tut'); el.classList.remove('hidden'); el.innerHTML = kb(`<div class="step">Школа мангала · ${G.tutStep}/${TUT.length - 1}</div>${TUT[G.tutStep]}`); }

// ================================================================== flow
function refreshMenu() {
  const L = levelOf(save.xp);
  $('mLvl').textContent = 'Уровень ' + L; $('mTitle').textContent = TITLES[Math.min(L - 1, 5)];
  const [a, b] = [xpAt(L), xpAt(L + 1)];
  $('xp').firstElementChild.style.width = clamp((save.xp - a) / (b - a), 0, 1) * 100 + '%';
  $('mBest').textContent = save.best.toLocaleString('ru') + ' ₽'; $('mNights').textContent = save.nights; $('mPerf').textContent = save.perfect;
  $('mUnl').innerHTML = UNLOCKS.map(u => `<span class="chip ${u.l > L ? 'lock' : ''}">${u.i} ${u.t}${u.l > L ? ' · ур. ' + u.l : ''}</span>`).join('');
  $('mAch').innerHTML = ACH.map(a => `<div class="${save.ach[a.id] ? '' : 'no'}" data-t="${a.t}">${a.i}</div>`).join('');
  syncSettingsUI();
  refreshCoop();
}
function showMenu() {
  G.mode = 'menu'; $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); $('results').classList.add('hidden'); $('pause').classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  if (NET.role !== 'client') setFriendsForLevel(NET.role === 'host' ? G.contentLevel || levelOf(save.xp) : levelOf(save.xp));
  refreshMenu(); resetNight(true);
  if (NET.role === 'host') sendLobby();
}
function resetNight(preview = false, mirror = false) {
  for (const s of [...SK.values()]) dropSkewer(s);
  me.hand = null; PL.forEach(P => P.hand = null);
  friends.forEach(f => { f.held = null; });
  if (dog) { dog.state = 'away'; dog.obj.visible = false; dog.carried = null; }
  Object.assign(G, { plate: [], tutWarn: false, t: preview ? CONFIG.nightLength * 0.12 : 0, score: 0, combo: 0, bestCombo: 0, mood: 70, heat: 0.85, fuel: 0.9, slots: new Array(CONFIG.slots).fill(null),
    served: 0, perfect: 0, burnt: 0, flaresOut: 0, shoo: 0, fed: 0, stolen: 0, earnedAch: [], ending: false, flareHint: false, toastDone: false, tutStep: 0, fanning: false });
  me.sprayAnim = 0;
  if (!mirror) {
    G.night = save.nights + 1;
    if (NET.role !== 'client') setFriendsForLevel(levelOf(save.xp));
    friends.forEach((f, i) => { f.state = 'idle'; f.order = null; f.grade = null; f.hungerT = (CONFIG.firstOrder + i * (G.night === 1 && !NET.on ? 16 : 9) + rnd(0, 3)) / (NET.on ? 1 + 0.15 * (chefs() - 1) : 1); f.sayT = 0; f.tmpAnimT = 0; f.play(f.baseAnim()); if (f.guitar) f.guitar.visible = true; });
    dog.nextT = G.night === 1 && !NET.on ? 95 : rnd(45, 70);
  }
  player.vel.set(0, 0, 0);
  if (preview) { player.pos.set(-1.2, 0, 2.3); player.yaw = -0.55; player.pitch = -0.12; }
  else {
    const spots = { solo: [0, 0.45], h: [0, 0.45], p1: [-0.7, 0.55], p2: [0.7, 0.6], p3: [-0.2, 1.3] };
    const sp = spots[me.id] || spots.solo; player.pos.set(sp[0], 0, sp[1]); player.yaw = Math.atan2(-(M0.x - sp[0]), -(M0.z - sp[1])); player.pitch = -0.42;
  }
}
function enterPlayUI(fresh) {
  $('menu').classList.add('hidden'); $('results').classList.add('hidden'); $('pause').classList.add('hidden'); $('hud').classList.remove('hidden'); $('tut').classList.add('hidden');
  G.mode = 'play';
  if (fresh) toast(`Ночь ${G.night} на ${NET.role === 'client' ? 'даче у хозяина' : 'твоей даче'}. Жарим вместе!`, 3);
}
function startNight() {
  if (NET.role === 'client') return;
  SFX_.init(); SFX_.play('ui');
  resetNight(false);
  G.nid = (Date.now() % 1e9) + Math.floor(Math.random() * 1000);
  $('menu').classList.add('hidden'); $('results').classList.add('hidden'); $('hud').classList.remove('hidden');
  G.mode = 'play';
  requestLock();
  toast(NET.on ? `Ночь ${G.night}: поваров у мангала: ${chefs()}. Друзья проголодались.` : `Ночь ${G.night}. Угли горячие, друзья голодные.`, 3);
  if (!save.tut && !NET.on) { G.tutStep = 1; showTut(); friends.forEach((f, i) => { if (i > 0) f.hungerT += 20; }); } else $('tut').classList.add('hidden');
  if (NET.role === 'host') { sendLobby(); NET.broadcast({ t: 's', s: snapshot() }); }
}
function pause() {
  if (G.mode !== 'play') return; G.mode = 'paused';
  $('pauseSub').textContent = NET.on ? 'Кооператив: ночь продолжается, пока ты здесь.' : 'Угли подождут, пока тебя нет.';
  $('quitBtn').textContent = NET.role === 'client' ? 'Уехать с дачи' : 'Закончить ночь';
  $('pause').classList.remove('hidden'); if (document.pointerLockElement) document.exitPointerLock();
}
function resume() { if (G.mode !== 'paused') return; $('pause').classList.add('hidden'); G.mode = 'play'; requestLock(); SFX_.init(); }
function endNight(failed) {
  if (G.mode === 'results' || NET.role === 'client') return;
  const st = { failed, score: G.score, served: G.served, perfect: G.perfect, bestCombo: G.bestCombo, flaresOut: G.flaresOut, fed: G.fed, shoo: G.shoo, stolen: G.stolen,
    mood: Math.round(G.mood), night: G.night, nFr: activeFriends().length, nChefs: chefs() };
  if (NET.role === 'host') NET.broadcast({ t: 'end', st });
  showResults(st);
}
function showResults(st) {
  G.mode = 'results'; if (document.pointerLockElement) document.exitPointerLock();
  if (me.hand) { dropSkewer(me.hand); me.hand = null; }
  const sc = 1 + 0.12 * (st.night - 1);
  const th = [350, 800, 1350].map(x => Math.round(x * sc * st.nFr / 3 * (1 + 0.35 * (st.nChefs - 1))));
  const stars = st.failed ? 0 : st.score >= th[2] ? 3 : st.score >= th[1] ? 2 : st.score >= th[0] ? 1 : 0;
  if (!st.failed) award('survive'); if (stars === 3) award('stars3'); if (st.score >= 3000) award('rich');
  const xpGain = Math.floor(st.score / 5 / Math.sqrt(st.nChefs)) + st.perfect * 10 + (st.failed ? 0 : 50) + stars * 25;
  const L0 = levelOf(save.xp);
  const best0 = save.best;
  save.xp += xpGain; save.nights += 1; save.best = Math.max(save.best, st.score); save.perfect += st.perfect; save.served += st.served; persist();
  const L1 = levelOf(save.xp);
  $('rTitle').textContent = st.failed ? 'Вечеринка не удалась' : stars === 3 ? 'Легендарная ночь!' : 'Угли догорают';
  $('rSub').textContent = st.failed ? 'Все разъехались голодные и злые. Меньше ожидания, меньше горелого.' : `Ночь ${st.night} закончилась${st.nChefs > 1 ? ` (поваров: ${st.nChefs})` : ''}. ${['Друзья запомнят этот хлеб.', 'Неплохо, шеф!', 'Отличный вечер!', 'Они уже планируют следующие выходные.'][stars]}`;
  $('rStars').innerHTML = [0, 1, 2].map(i => `<span class="${i < stars ? '' : 'off'}">⭐</span>`).join('');
  $('rStats').innerHTML = `<div>Заработано <b>${st.score.toLocaleString('ru')} ₽</b></div><div>Подано шампуров <b>${st.served}</b></div><div>Идеальных <b>${st.perfect}</b></div><div>Лучшая серия <b>${st.bestCombo}</b></div><div>Потушено вспышек <b>${st.flaresOut}</b></div><div>Шарик ${st.fed ? 'накормлен' : 'прогнан'} <b>${st.fed || st.shoo}</b></div><div>Утащил Шарик <b>${st.stolen}</b></div><div>Настроение <b>${st.mood}%</b></div>`;
  const [a, b] = [xpAt(L1), xpAt(L1 + 1)];
  $('rXp').firstElementChild.style.width = '0%'; setTimeout(() => $('rXp').firstElementChild.style.width = clamp((save.xp - a) / (b - a), 0, 1) * 100 + '%', 200);
  $('rXpTxt').textContent = `+${xpGain} опыта · Уровень ${L1} · ${TITLES[Math.min(L1 - 1, 5)]} · до следующего: ${Math.max(0, b - save.xp)}`;
  const news = [];
  if (L1 > L0) { news.push(`<div>⬆️ <b>Уровень ${L1}!</b> Теперь ты: ${TITLES[Math.min(L1 - 1, 5)]}.</div>`); UNLOCKS.filter(u => u.l > L0 && u.l <= L1).forEach(u => news.push(`<div>${u.i} Открыто: <b>${u.t}</b>${NET.role === 'client' ? ' (в твоих ночах и когда ты хозяин)' : ''}</div>`)); setTimeout(() => SFX_.play('levelup'), 400); }
  else { const nxt = UNLOCKS.find(u => u.l > L1); if (nxt) news.push(`<div>На уровне ${nxt.l} откроется: ${nxt.i} <b>${nxt.t}</b></div>`); }
  G.earnedAch.forEach(id => { const x = ACH.find(a => a.id === id); if (x) news.push(`<div>${x.i} ${x.t}</div>`); });
  if (st.score > best0 && st.score > 0) news.push(`<div>🏆 Новый рекорд ночи: <b>${st.score.toLocaleString('ru')} ₽</b></div>`);
  $('rNews').innerHTML = news.join('');
  const nb = $('nextBtn');
  if (NET.role === 'client') { nb.disabled = true; nb.textContent = 'Ждём хозяина…'; $('menuBtn').textContent = 'Уехать с дачи'; }
  else { nb.disabled = false; nb.textContent = `Ночь ${save.nights + 1}${NET.on ? ' · все вместе' : ''}`; $('menuBtn').textContent = 'В меню'; }
  $('results').classList.remove('hidden'); $('hud').classList.add('hidden'); $('pause').classList.add('hidden');
  if (NET.role === 'host') sendLobby();
}

$('startBtn').onclick = () => startNight();
$('resumeBtn').onclick = () => resume();
$('quitBtn').onclick = () => { $('pause').classList.add('hidden'); if (NET.role === 'client') { leaveCoop(); showMenu(); } else endNight(false); };
$('nextBtn').onclick = () => startNight();
$('menuBtn').onclick = () => { if (NET.role === 'client') leaveCoop(); showMenu(); };
const toggleMute = () => { SET.muted = !SET.muted; applySettings(); syncSettingsUI(); SFX_.init(); };
$('muteBtn').onclick = toggleMute;
$('hostBtn').onclick = () => hostCoop();
$('joinBtn').onclick = () => joinCoop();
$('leaveBtn').onclick = () => { leaveCoop(); showMenu(); };
$('copyBtn').onclick = () => { const c = NET.code || ''; try { navigator.clipboard.writeText(c); coopMsg(`Код <b>${c}</b> скопирован. Отправь его друзьям.`); } catch (e) { } };
$('nameIn').value = save.name || '';
$('nameIn').addEventListener('change', () => { saveName(); if (NET.role === 'client') NET.send('h', { t: 'name', name: me.name }); if (NET.role === 'host') sendLobby(); });
$('codeIn').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
{ const q = new URLSearchParams(location.search).get('room'); if (q) $('codeIn').value = q.toUpperCase().slice(0, 4); }
addEventListener('beforeunload', () => { if (NET.on) NET.leave(); });

// ================================================================== main loop
const SFX_ = new SFX(); SFX_.muted = !!save.muted;
let lastT = performance.now();
let frameAvg = 16, slowT = 0, fpsAcc = 0, fpsN = 0;
function loop() { requestAnimationFrame(loop); frame(true); }
// keeps the host (and pings) alive when the tab is in the background and rAF is throttled
setInterval(() => { if (G.mode !== 'loading' && performance.now() - lastT > 150) frame(false); }, 50);
function simStep(dt, mirror, live) {
  if (G.mode === 'play' || G.mode === 'paused') {
    if (G.mode === 'play') updatePlayer(dt); else { me.fanIn = false; me.fanVis = false; }
    if (mirror) G.t += dt;
  }
  if (!mirror && live) {
    if (G.mode !== 'menu') {
      G.t += dt;
      if (G.t >= CONFIG.nightLength && !G.ending) G.ending = true;
      if (G.ending && !friends.some(f => f.state === 'eating')) { endNight(false); return; }
      else if (G.mood <= 0) { endNight(true); return; }
      if (!G.toastDone && G.t > CONFIG.nightLength * 0.6 && G.mood > 50) { G.toastDone = true; tst('🥂 Тост за повара! За шефа!', 3); G.mood = clamp(G.mood + 6, 0, 100); friends.filter(f => f.active && f.state === 'idle').forEach(f => { f.play('sit_cheer'); f.tmpAnimT = 2.4; }); sfx('clink'); }
      if (G.tutStep === 3 && G.slots.some(s => s && (s.flipped ? s.doneB : s.doneA) > 0.95) && !G.tutWarn) { G.tutWarn = true; toast('Переворачивай! <kbd>ЛКМ</kbd>', 1.8); }
      simFriends(dt);
    }
    simGrill(dt);
    simDog(dt);
  }
}
function frame(render) {
  const nowT = performance.now(); const realDt = Math.max(0, (nowT - lastT) / 1000); lastT = nowT;
  const rdt = Math.min(realDt, 0.1);
  const playing = G.mode === 'play';
  const mirror = NET.role === 'client' && G.mode !== 'menu';
  const live = G.mode === 'play' || G.mode === 'menu' || (G.mode === 'paused' && NET.on);
  // when throttled, catch the simulation up in small steps (only matters for the host)
  const n = render ? 1 : Math.min(20, Math.max(1, Math.ceil(realDt / 0.1)));
  const stepDt = render ? rdt : Math.min(realDt / n, 0.1);
  const dt = live ? (render ? rdt : stepDt * n) : 0;
  UT.value += render ? rdt : stepDt * n;
  if (G.mode === 'menu') {
    G.t = CONFIG.nightLength * (0.12 + 0.02 * Math.sin(UT.value * 0.05));
    player.yaw = -0.55 + Math.sin(UT.value * 0.07) * 0.18; camera.position.set(-1.2, 1.7, 2.3); camera.rotation.set(-0.12, player.yaw, 0);
  }
  for (let k = 0; k < n; k++) simStep(live ? stepDt : 0, mirror, live);
  netTick(realDt);
  if (!render) { visFriends(Math.min(dt, 0.1)); return; }
  fxGrill(dt);
  visFriends(dt);
  visDog(dt, mirror);
  updateAvatars(rdt);
  if (playing) updateTarget(); else target = null;
  updateSky(G.t / CONFIG.nightLength);
  const wind = [0.18 + 0.1 * Math.sin(UT.value * 0.3), -0.06];
  smoke.update(dt, wind); embers.update(dt, wind); flames.update(dt, wind); fireflies.update(dt);
  if (fireflies.n) { for (let i = 0; i < fireflies.n; i++) { fireflies.v[i * 3] += (Math.random() - 0.5) * 0.04; fireflies.v[i * 3 + 2] += (Math.random() - 0.5) * 0.04; } }
  const fwd = V(0, 0, -1).applyQuaternion(camera.quaternion);
  SFX_.listener(camera.position, fwd);
  const dima = friends.find(f => f.def.guitar);
  SFX_.update(rdt, { sizzle: G.sizzle || 0, heat: G.heat, night: G.night01 || 0, wind: 0.5 + 0.5 * Math.sin(UT.value * 0.2), guitarOn: live && dima && dima.active && dima.cur === 'sit_strum', guitarPos: dima ? dima.obj.position.clone().add(V(0, 1.4, 0)) : null });
  if (G.mode !== 'loading') updateHUD(rdt);
  $('qcbar').classList.toggle('hidden', !NET.on || isTouch);
  if (SET.fps) { fpsAcc += realDt; fpsN++; if (fpsAcc > 0.5) { $('fps').textContent = Math.round(fpsN / fpsAcc) + ' FPS'; fpsAcc = 0; fpsN = 0; } }
  if (fpArm) fpArm.visible = G.mode === 'play' || G.mode === 'paused';
  if (isTouch) { const tv = G.mode === 'play' || G.mode === 'paused'; if (loop.tv !== tv) { loop.tv = tv; $('touch').classList.toggle('hidden', !tv); } }
  if (!window.__norender) { if (quality === 'high') composer.render(); else renderer.render(scene, camera); }
  frameAvg = frameAvg * 0.95 + rdt * 1000 * 0.05; window.__frame = frameAvg;
  if (playing && quality === 'high' && frameAvg > 34 && !window.__noAuto) { slowT += rdt; if (slowT > 4) { quality = 'low'; SET.quality = 'low'; applyQuality(); persist(); toast('Включено низкое качество, чтобы не тормозило', 2.2); } } else slowT = 0;
}

// ================================================================== boot
(async () => {
  try {
    gltf = await loadGLB();
    buildWorld();
    setupFriends();
    setupDog();
    setupComposer();
    applyQuality();
    setupTouch();
    setupNet();
    setupSettings();
    detectBackend().then(b => { $('netInfo').textContent = { 'netlify+turn': 'Сеть: свой сервер на Netlify · свой TURN ✓', 'netlify+publicturn': 'Сеть: свой сервер на Netlify · общий бесплатный TURN (свой надёжнее, см. README)', netlify: 'Сеть: свой сервер на Netlify · без TURN (из строгих сетей может не подключиться)', peerjs: 'Сеть: общий сервер PeerJS · общий бесплатный TURN', 'peerjs+turn': 'Сеть: общий сервер PeerJS · свой TURN из ice.json ✓', local: 'Сеть: локальный тест' }[b] || ''; });
    resize();
    $('loading').classList.add('hidden');
    showMenu();
    window.__game = { NET, PL, me, SK, sfx: SFX_, THREE, scene, updateTarget, get target() { return target; }, set target(v) { target = v; }, G, save, friends, get dog() { return dog; },
      act: (t) => act(me, t || target), doAct, doTake, doSpray, takeOff: (t) => takeOff(me, t || target), spray: () => spray(me), startNight, player, camera, endNight, makeSkewer, placeOnGrill,
      give: s => setHand(me, s), hostCoop, joinCoop, leaveCoop, showMenu, award, keys, snapshot };
    document.title = 'Шашлычная ночь';
    window.__ready = true;
    loop();
  } catch (e) {
    console.error(e);
    $('loadmsg').textContent = 'Не удалось запустить: ' + e.message;
    window.__ready = 'error';
  }
})();

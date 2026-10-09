// ================================================================== co-op network status + diagnostics (menu, under the co-op panel)
import { netCheck, netWarm, routesInfo } from './net.js';
{
  const st = document.createElement('style');
  st.textContent = '#netRoutes{font-size:13px;opacity:.72;margin-top:4px;line-height:1.45}#netRoutes a{color:var(--gold);pointer-events:auto;cursor:pointer;margin-left:10px;white-space:nowrap}'
    + '#coopMsg .chk{font-size:14px;line-height:1.55}#coopMsg textarea{display:block;width:100%;height:130px;margin-top:6px;font:11px/1.35 monospace;background:rgba(0,0,0,.4);color:var(--cream);border:1px solid rgba(255,255,255,.2);border-radius:8px;pointer-events:auto}';
  document.head.appendChild(st);
  const box = document.createElement('div'); box.id = 'netRoutes';
  box.innerHTML = '<span id="netRoutesTxt"></span><a id="netCheckBtn">Проверить сеть</a><a id="netLogBtn">Журнал связи</a>';
  $('netInfo').after(box);
}
const RN = { mqtt: 'MQTT', peerjs: 'PeerJS', netlify: 'Netlify', local: 'локальный тест' };
function routesText() {
  const r = routesInfo();
  const name = tr => tr === 'mqtt' ? `MQTT (${r.mqttUp}/${r.mqttTotal})` : RN[tr] || tr;
  if (r.role === 'host') return `Дача слушает: ${r.listening.map(name).join(', ') || '…'}${r.relay ? ` · через ретранслятор: ${r.relay}` : ''}`;
  if (r.role === 'client') return r.relay ? 'Подключено через ретранслятор MQTT (напрямую не пробилось)' : `Подключено напрямую (знакомство через ${RN[r.via] || r.via})`;
  if (!r.routes.length) return '';
  const turn = { own: 'свой TURN ✓', public: 'общий бесплатный TURN', none: 'без TURN' }[r.turn] || '';
  return `Связь: ${r.routes.map(tr => RN[tr] || tr).join(' + ')} (что быстрее)${turn && !r.routes.includes('local') ? ' · ' + turn : ''}`;
}
setInterval(() => { const el = $('netRoutesTxt'); if (!el) return; const t = routesText(); if (el.textContent !== t) el.textContent = t; }, 700);
let netChecking = false;
$('netCheckBtn').onclick = async () => {
  if (netChecking) return; netChecking = true; SFX_.init(); SFX_.play('ui');
  try { await netCheck(lines => coopMsg('<div class="chk">' + lines.map(esc).join('<br>') + '</div>')); }
  catch (e) { coopMsg('Проверка не удалась: ' + esc(e.message), true); }
  netChecking = false;
};
$('netLogBtn').onclick = async () => {
  const txt = netLog(); const a = $('netLogBtn');
  try { await navigator.clipboard.writeText(txt); a.textContent = 'Журнал скопирован ✓'; setTimeout(() => { a.textContent = 'Журнал связи'; }, 2500); }
  catch (e) { coopMsg('Скопируй журнал и пришли его:<textarea readonly>' + esc(txt) + '</textarea>'); }
};
// start talking to the servers as soon as the player heads for co-op, so hosting/joining is faster
['nameIn', 'codeIn'].forEach(id => $(id).addEventListener('focus', netWarm, { once: true }));
['hostBtn', 'joinBtn'].forEach(id => $(id).addEventListener('pointerenter', netWarm, { once: true }));

// Co-op networking. Host-authoritative: the host simulates everything, clients send input/actions and mirror snapshots.
// Transport: PeerJS (WebRTC data channels, free public broker + TURN), loaded from a CDN only when you host or join.
// `?nettest` swaps in a BroadcastChannel transport so two tabs on one machine can be tested without internet.

const PEER_URLS = ['https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'];
const PREFIX = 'shashlik-night-v1-';
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 4;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    const to = setTimeout(() => { s.remove(); rej(new Error('timeout')); }, 9000);
    s.onload = () => { clearTimeout(to); res(); }; s.onerror = () => { clearTimeout(to); s.remove(); rej(new Error('load failed')); };
    document.head.appendChild(s);
  });
}

// ---------------------------------------------------------------- local test transport
class Emitter { constructor() { this._h = {}; } on(e, f) { (this._h[e] = this._h[e] || []).push(f); return this; } emit(e, ...a) { (this._h[e] || []).forEach(f => f(...a)); } }
class FakeConn extends Emitter {
  constructor(peer, other) { super(); this.peer = other; this._p = peer; this.open = false; }
  send(d) { if (this.open) this._p._bc.postMessage({ k: 'data', from: this._p.id, to: this.peer, d: JSON.parse(JSON.stringify(d)) }); }
  close() { if (!this.open) return; this.open = false; this._p._bc.postMessage({ k: 'close', from: this._p.id, to: this.peer }); delete this._p._conns[this.peer]; this.emit('close'); }
}
class FakePeer extends Emitter {
  constructor(id) {
    super(); this.id = id || 'anon-' + Math.random().toString(36).slice(2, 9); this._conns = {}; this.destroyed = false;
    this._bc = new BroadcastChannel('shashlik-fakepeer');
    this._bc.onmessage = ({ data: m }) => {
      if (m.to !== this.id || this.destroyed) return;
      if (m.k === 'connect') { const c = new FakeConn(this, m.from); c.open = true; this._conns[m.from] = c; this._bc.postMessage({ k: 'ack', from: this.id, to: m.from }); this.emit('connection', c); setTimeout(() => c.emit('open'), 0); }
      else if (m.k === 'ack') { const c = this._conns[m.from]; if (c) { c.open = true; clearTimeout(c._to); c.emit('open'); } }
      else if (m.k === 'data') { const c = this._conns[m.from]; if (c) c.emit('data', m.d); }
      else if (m.k === 'close') { const c = this._conns[m.from]; if (c) { c.open = false; delete this._conns[m.from]; c.emit('close'); } }
    };
    setTimeout(() => this.emit('open', this.id), 30);
  }
  connect(id) {
    const c = new FakeConn(this, id); this._conns[id] = c;
    this._bc.postMessage({ k: 'connect', from: this.id, to: id });
    c._to = setTimeout(() => { delete this._conns[id]; this.emit('error', { type: 'peer-unavailable' }); }, 2500);
    return c;
  }
  destroy() { Object.values(this._conns).forEach(c => c.close()); this.destroyed = true; this._bc.close(); }
}

// ---------------------------------------------------------------- Netlify transport (own signaling via Netlify Functions + WebRTC)
const NL = { info: null, ice: null, api: '/api/signal', checked: false };
async function probeNetlify() {
  if (!/^https?:$/.test(location.protocol) || /[?&]peerjs/.test(location.search)) return null;
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('/api/ice', { cache: 'no-store', signal: ctl.signal });
    clearTimeout(to);
    if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return null;
    const j = await r.json(); return j && Array.isArray(j.iceServers) ? j : null;
  } catch (e) { return null; }
}
async function sig(body) {
  let r;
  try { r = await fetch(NL.api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: body.op === 'close' }); }
  catch (e) { const x = new Error('network'); x.type = 'network'; throw x; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const x = new Error(j.error || 'HTTP ' + r.status); x.status = r.status; x.code = j.code; throw x; }
  return j;
}
const waitIce = (pc, ms = 4500) => new Promise(res => {
  if (pc.iceGatheringState === 'complete') return res();
  let relay = false;
  const t = setTimeout(res, ms);
  pc.addEventListener('icecandidate', e => { if (e.candidate && / typ relay/.test(e.candidate.candidate) && !relay) { relay = true; setTimeout(() => { clearTimeout(t); res(); }, 400); } });
  pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
});
const NETLOG = [];
const nlog = (...a) => { const l = new Date().toISOString().slice(11, 19) + ' ' + a.join(' '); NETLOG.push(l); if (NETLOG.length > 80) NETLOG.shift(); if (/[?&]netdebug/.test(location.search)) console.log('[net]', l); };
class RtcConn extends Emitter {
  constructor(peerId, pc) {
    super(); this.peer = peerId; this.pc = pc; this.open = false; this.dc = null; this.closed = false;
    pc.addEventListener('connectionstatechange', () => {
      const st = pc.connectionState; nlog('pc', peerId.slice(-6), st);
      if (st === 'connecting') this.emit('stage', 'ice');
      if (st === 'failed' || st === 'closed') this._end(st === 'failed');
    });
    pc.addEventListener('iceconnectionstatechange', () => nlog('ice', peerId.slice(-6), pc.iceConnectionState));
  }
  _bind(dc) {
    this.dc = dc;
    const opened = () => { if (this.open || this.closed) return; this.open = true; nlog('dc open', this.peer.slice(-6)); this.emit('open'); };
    dc.onopen = opened;
    dc.onmessage = e => { let d; try { d = JSON.parse(e.data); } catch (x) { return; } this.emit('data', d); };
    dc.onclose = () => this._end(false);
    if (dc.readyState === 'open') setTimeout(opened, 0);
  }
  send(d) { if (this.dc && this.dc.readyState === 'open') this.dc.send(JSON.stringify(d)); }
  close() { this._end(false); }
  _end(failed) {
    if (this.closed) return; this.closed = true; const was = this.open; this.open = false;
    try { if (this.dc) this.dc.close(); } catch (e) { } try { this.pc.close(); } catch (e) { }
    if (failed && !was) this.emit('error', { type: 'webrtc' });
    this.emit('close');
  }
}
class NetlifyPeer extends Emitter {
  constructor(id) {
    super(); this.destroyed = false; this.conns = new Map(); this._pollT = null; this._idle = 0;
    this.ice = (NL.info && NL.info.iceServers) || [];
    if (id) { this.id = id; this.room = id.slice(PREFIX.length); this.isHost = true; this._hostStart(); }
    else { this.id = 'g' + Math.random().toString(36).slice(2, 12); this.isHost = false; setTimeout(() => this.emit('open', this.id), 0); }
  }
  async _hostStart() {
    try { await sig({ op: 'host', room: this.room, id: this.id }); }
    catch (e) { this.emit('error', { type: e.code === 'taken' ? 'unavailable-id' : 'network', message: e.message }); return; }
    if (this.destroyed) return;
    nlog('room registered', this.room);
    this.emit('open', this.id); this._hostPoll(300);
  }
  _hostPoll(ms) {
    clearTimeout(this._pollT); if (this.destroyed) return;
    this._pollT = setTimeout(async () => {
      let got = false;
      try {
        const j = await sig({ op: 'recv', room: this.room, id: this.id });
        for (const o of j.offers || []) { got = true; this._onOffer(o).catch(err => nlog('offer err', err && err.message)); }
      } catch (e) {
        if (e.code === 'missing') { try { await sig({ op: 'host', room: this.room, id: this.id }); nlog('room re-registered'); } catch (x) { } }
      }
      this._idle = got ? 0 : this._idle + 1;
      this._hostPoll(this._idle < 25 ? 1000 : document.hidden ? 3500 : 2000);
    }, ms);
  }
  async _onOffer(o) {
    if (this.destroyed) return;
    const old = this.conns.get(o.from);
    if (old && !old.closed) return; // duplicate re-send of an offer we already answered
    nlog('offer from', o.from.slice(-6));
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const conn = new RtcConn(o.from, pc); this.conns.set(o.from, conn);
    conn.on('close', () => { if (this.conns.get(o.from) === conn) this.conns.delete(o.from); });
    pc.ondatachannel = e => conn._bind(e.channel);
    this.emit('connection', conn);
    await pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIce(pc);
    await sig({ op: 'answer', room: this.room, id: this.id, to: o.from, sdp: pc.localDescription.sdp });
    nlog('answer sent', o.from.slice(-6));
  }
  connect(peerId) {
    const room = peerId.slice(PREFIX.length); this.room = room;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const conn = new RtcConn(peerId, pc); this.conns.set(peerId, conn);
    conn._bind(pc.createDataChannel('game', { ordered: true }));
    conn.on('error', e => this.emit('error', e));
    (async () => {
      try {
        await sig({ op: 'join', room });
        conn.emit('stage', 'room');
        await pc.setLocalDescription(await pc.createOffer());
        await waitIce(pc);
        if (conn.closed) return;
        const sdp = pc.localDescription.sdp;
        nlog('offer ready', 'relay:' + / typ relay/.test(sdp), 'srflx:' + / typ srflx/.test(sdp));
        let lastSend = 0, answered = false;
        while (!conn.closed && !answered && !this.destroyed) {
          if (Date.now() - lastSend > 4000) { await sig({ op: 'offer', room, id: this.id, sdp }); lastSend = Date.now(); conn.emit('stage', 'offer'); }
          await new Promise(r => setTimeout(r, 600));
          const j = await sig({ op: 'poll', room, id: this.id });
          if (j.answer) { answered = true; nlog('answer received'); conn.emit('stage', 'answer'); await pc.setRemoteDescription({ type: 'answer', sdp: j.answer }); }
          else if (j.room === false) { this.emit('error', { type: 'peer-unavailable' }); return; }
        }
      } catch (e) {
        nlog('connect err', e.code || e.type || '', e.message);
        this.emit('error', { type: e.code === 'missing' ? 'peer-unavailable' : 'network', message: e.message });
      }
    })();
    return conn;
  }
  reconnect() { }
  destroy() {
    if (this.destroyed) return; this.destroyed = true; clearTimeout(this._pollT);
    for (const c of [...this.conns.values()]) c.close();
    if (this.isHost) sig({ op: 'close', room: this.room, id: this.id }).catch(() => { });
  }
}

async function loadPeerJS() {
  if (window.Peer) return window.Peer;
  for (const u of PEER_URLS) { try { await loadScript(u); if (window.Peer) return window.Peer; } catch (e) { /* try next */ } }
  throw new Error('Не удалось загрузить модуль кооператива. Для игры по сети нужен интернет.');
}
// PeerJS wrapper that reuses our ICE servers (incl. TURN) when the Netlify functions provided them
function peerjsClass(P) {
  const ice = NL.info || NL.ice;   // without either, PeerJS keeps its defaults (Google STUN + free shared PeerJS TURN)
  if (!ice) return P;
  return class extends P { constructor(id, opts = {}) { super(id, Object.assign({}, opts, { config: { iceServers: ice.iceServers } })); } };
}
// Static hosting (GitHub Pages etc.): optional ice.json next to index.html with your own STUN/TURN servers
async function loadIceJson() {
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const r = await fetch('ice.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && Array.isArray(j.iceServers) && j.iceServers.length ? { iceServers: j.iceServers, turnKind: j.iceServers.some(s => s.username) ? 'own' : 'none', static: true } : null;
  } catch (e) { return null; }
}
async function transports() {
  if (/[?&]nettest/.test(location.search)) return ['local'];
  if (!NL.checked) { NL.checked = true; NL.info = await probeNetlify(); if (!NL.info) NL.ice = await loadIceJson(); }
  return NL.info ? ['netlify', 'peerjs'] : ['peerjs'];
}
async function peerClassFor(tr) {
  if (tr === 'local') return FakePeer;
  if (tr === 'netlify') return NetlifyPeer;
  return peerjsClass(await loadPeerJS());
}
export async function detectBackend() {
  const t = await transports();
  if (t[0] === 'local') return 'local';
  if (t[0] === 'netlify') return NL.info.turnKind === 'own' ? 'netlify+turn' : NL.info.turnKind === 'public' ? 'netlify+publicturn' : 'netlify';
  return NL.ice && NL.ice.turnKind === 'own' ? 'peerjs+turn' : 'peerjs';
}
export const netLog = () => NETLOG.join('\n');

const errText = (e, code) => {
  const t = e && e.type;
  if (t === 'peer-unavailable') return `Дачи с кодом ${code} нет. Проверь код и что хозяин ещё ждёт.`;
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Не удалось связаться с сервером кооператива. Проверь интернет.';
  if (t === 'browser-incompatible') return 'Этот браузер не поддерживает кооператив (WebRTC).';
  if (t === 'webrtc') return 'Соединение не пробилось через сеть (NAT/файрвол). Нужен TURN-сервер (см. README) или другая сеть.';
  return (e && e.message) || 'Проблема с соединением';
};
const newCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

export const NET = {
  role: null, code: null, peer: null, conns: new Map(), hostConn: null, myId: 'solo', backend: null,
  handlers: { data: () => { }, join: () => { }, leave: () => { }, status: () => { }, lost: () => { } },
  get on() { return !!this.role; },

  async host() {
    const order = await transports();
    const primary = order[0];
    const P = await peerClassFor(primary);
    this.backend = primary;
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = newCode();
      const ok = await new Promise(res => {
        const peer = new P(PREFIX + code, { debug: 0 });
        const fail = e => { peer.destroy(); res(e && e.type === 'unavailable-id' ? 'retry' : e); };
        peer.on('error', e => { if (!this.peer) fail(e); else nlog('host peer error', e && e.type); });
        peer.on('open', () => { this.peer = peer; this.code = code; res(true); });
        setTimeout(() => { if (!this.peer) fail({ type: 'network' }); }, 15000);
        peer.on('connection', conn => this._accept(conn));
        peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { } });
      });
      if (ok === true) {
        this.role = 'host'; this.myId = 'h';
        // also listen on the backup route (PeerJS cloud) with the same room code
        if (order[1]) this._backupHost(order[1], code);
        return code;
      }
      if (ok !== 'retry') throw new Error(errText(ok));
    }
    throw new Error('Не удалось создать комнату, попробуй ещё раз.');
  },
  async _backupHost(tr, code) {
    try {
      const P = await peerClassFor(tr);
      if (!this.role || this.code !== code) return;
      const peer = new P(PREFIX + code, { debug: 0 });
      peer.on('error', e => nlog('backup host error', e && e.type));
      peer.on('open', () => nlog('backup route ready'));
      peer.on('connection', conn => this._accept(conn));
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { } });
      this.peer2 = peer;
    } catch (e) { nlog('backup route unavailable', e.message); }
  },
  _accept(conn) {
    let pid = null;
    conn.on('open', () => {
      if (this.conns.size >= MAX_PLAYERS - 1) { try { conn.send({ t: 'full' }); } catch (e) { } setTimeout(() => conn.close(), 400); return; }
      const used = new Set([...this.conns.values()].map(c => c._pid));
      for (let i = 1; i < MAX_PLAYERS; i++) if (!used.has('p' + i)) { pid = 'p' + i; break; }
      conn._pid = pid; conn._seen = performance.now(); this.conns.set(pid, conn);
    });
    conn.on('data', d => {
      if (!pid) return; conn._seen = performance.now();
      if (d && d.t === 'hello') this.handlers.join(pid, d);
      else this.handlers.data(pid, d);
    });
    const gone = () => { if (pid && this.conns.get(pid) === conn) { this.conns.delete(pid); this.handlers.leave(pid); } };
    conn.on('close', gone); conn.on('error', gone);
  },

  async join(code, hello) {
    code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 4) throw new Error('Код комнаты: 4 символа.');
    const order = await transports();
    let best = null;
    for (let i = 0; i < order.length; i++) {
      const tr = order[i], last = i === order.length - 1;
      if (i > 0) this.handlers.status(`Пробуем запасной путь (${tr === 'peerjs' ? 'PeerJS' : tr})…`);
      try { return await this._joinVia(tr, code, hello, last ? 30000 : 22000); }
      catch (e) {
        nlog('join via', tr, 'failed:', e.kind || '', e.message);
        // keep the most informative reason: "no such room" only if every route says so
        if (!best || (e.kind !== 'load' && ((best.kind === 'missing' && e.kind !== 'missing') || e.kind === 'nat' || best.kind === 'load'))) best = e;
      }
    }
    throw new Error(best ? best.message : 'Проблема с соединением');
  },
  _joinVia(tr, code, hello, timeout) {
    return new Promise(async (res, rej) => {
      let P; try { P = await peerClassFor(tr); } catch (e) { const x = new Error(e.message); x.kind = 'load'; rej(x); return; }
      this.backend = tr;
      const peer = new P(undefined, { debug: 0 }); let done = false, stage = 'start';
      const STAGES = { room: 'Дача найдена, отправляем приглашение…', offer: 'Ждём ответа хозяина…', answer: 'Хозяин ответил, соединяемся…', ice: 'Пробиваем соединение через сеть…' };
      const fail = (e, kind) => {
        if (done) { this.handlers.lost(errText(e, code)); return; }
        done = true; clearTimeout(to); try { peer.destroy(); } catch (x) { }
        const err = new Error(errText(e, code)); err.kind = kind || (e && e.type === 'peer-unavailable' ? 'missing' : e && e.type === 'webrtc' ? 'nat' : 'net'); rej(err);
      };
      peer.on('error', e => fail(e));
      const to = setTimeout(() => {
        if (stage === 'answer' || stage === 'ice') fail({ message: `Хозяин ответил, но соединение не пробилось через сеть. Обычно это строгий NAT или файрвол: подключите свой TURN-сервер (см. README) или попробуйте другую сеть (например, мобильный интернет).` }, 'nat');
        else if (stage === 'offer' || stage === 'room') fail({ message: `Дача ${code} есть, но хозяин не отвечает. Вкладка хозяина должна быть открыта (не закрыта и не в спящем режиме).` }, 'host');
        else fail({ message: `Не достучаться до дачи ${code}. Проверь код и что хозяин ещё ждёт.` }, 'missing');
      }, timeout);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('stage', st => { stage = st; if (!done && STAGES[st]) this.handlers.status(STAGES[st]); });
        conn.on('open', () => {
          if (done) return;
          clearTimeout(to); done = true; this.peer = peer; this.hostConn = conn; this.role = 'client'; this.code = code; conn._seen = performance.now();
          conn.send(Object.assign({ t: 'hello' }, hello)); res(code);
        });
        conn.on('data', d => { conn._seen = performance.now(); this.handlers.data('h', d); });
        const lost = () => { if (this.hostConn === conn) { this.hostConn = null; this.handlers.lost('Хозяин закрыл дачу или пропала связь.'); } };
        conn.on('close', lost); conn.on('error', e => { if (!done) fail(e || { type: 'webrtc' }); else lost(); });
      });
    });
  },

  send(to, msg) {
    if (this.role === 'client') { if (this.hostConn && this.hostConn.open !== false) this.hostConn.send(msg); return; }
    const c = this.conns.get(to); if (c) try { c.send(msg); } catch (e) { }
  },
  broadcast(msg) { if (this.role !== 'host') return; for (const c of this.conns.values()) try { c.send(msg); } catch (e) { } },
  peers() { return [...this.conns.keys()]; },
  // drop silent peers (closed tabs don't always fire 'close')
  watchdog() {
    const now = performance.now();
    // if this tab itself was frozen (busy, background), don't blame the peers
    if (this._wd && now - this._wd > 3000) { for (const c of this.conns.values()) c._seen = now; if (this.hostConn) this.hostConn._seen = now; }
    this._wd = now;
    if (this.role === 'host') for (const [pid, c] of this.conns) { if (now - c._seen > 12000) { try { c.close(); } catch (e) { } this.conns.delete(pid); this.handlers.leave(pid); } }
    if (this.role === 'client' && this.hostConn && now - this.hostConn._seen > 12000) { const c = this.hostConn; this.hostConn = null; try { c.close(); } catch (e) { } this.handlers.lost('Пропала связь с хозяином.'); }
  },
  leave() {
    try { if (this.role === 'host') this.broadcast({ t: 'bye' }); } catch (e) { }
    try { for (const c of this.conns.values()) c.close(); if (this.hostConn) this.hostConn.close(); } catch (e) { }
    try { if (this.peer) this.peer.destroy(); } catch (e) { }
    try { if (this.peer2) this.peer2.destroy(); } catch (e) { }
    Object.assign(this, { role: null, code: null, peer: null, peer2: null, hostConn: null, myId: 'solo' }); this.conns = new Map();
  },
};

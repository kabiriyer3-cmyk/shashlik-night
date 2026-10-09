// Co-op networking. Host-authoritative: the host simulates everything, clients send input/actions and mirror snapshots.
// Every way to find each other runs in parallel and the first one that connects wins:
//   mqtt    - public MQTT brokers over WebSocket used as a "mailbox" for the WebRTC handshake (works on any static host)
//   peerjs  - free PeerJS cloud broker (loaded from a CDN on demand)
//   netlify - own signaling via Netlify Functions (only when deployed on Netlify)
// The game itself always goes browser-to-browser over a WebRTC data channel.
// `?nettest` swaps in a BroadcastChannel transport so two tabs on one machine can be tested without internet.
// Debug: `?net=mqtt` / `?net=peerjs` keeps only those routes, `?mqtt=wss://a,wss://b` overrides the brokers, `?netdebug` logs to console.

const PEER_URLS = ['https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js', 'https://fastly.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'];
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt', 'wss://mqtt.eclipseprojects.io/mqtt'];
const TOPIC = 'shashlik-night/v1/';
const PREFIX = 'shashlik-night-v1-';
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 4;
// STUN finds your public address, TURN relays traffic when two networks can't reach each other directly
const DEFAULT_ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];
const QS = new URLSearchParams(location.search);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    const to = setTimeout(() => { s.remove(); rej(new Error('timeout')); }, 9000);
    s.onload = () => { clearTimeout(to); res(); }; s.onerror = () => { clearTimeout(to); s.remove(); rej(new Error('load failed')); };
    document.head.appendChild(s);
  });
}

// ---------------------------------------------------------------- local test transport
class Emitter { constructor() { this._h = {}; } on(e, f) { (this._h[e] = this._h[e] || []).push(f); return this; } off(e, f) { this._h[e] = (this._h[e] || []).filter(x => x !== f); return this; } emit(e, ...a) { (this._h[e] || []).slice().forEach(f => f(...a)); } }
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
  let relay = false, srflx = false;
  const t = setTimeout(res, ms);
  const soon = d => { clearTimeout(t); setTimeout(res, d); };
  pc.addEventListener('icecandidate', e => {
    const c = e.candidate && e.candidate.candidate || '';
    if (/ typ relay/.test(c) && !relay) { relay = true; soon(400); }
    else if (/ typ srflx/.test(c) && !srflx && !relay) { srflx = true; setTimeout(() => { if (!relay) res(); }, 2500); }
  });
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

// ---------------------------------------------------------------- MQTT transport (public brokers as a mailbox for the WebRTC handshake)
const te = new TextEncoder(), td = new TextDecoder();
const cat = (...parts) => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const mStr = s => { const b = te.encode(s); return cat(new Uint8Array([b.length >> 8, b.length & 255]), b); };
const mLen = n => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return new Uint8Array(o); };
const mPkt = (h, ...body) => { const b = cat(...body); return cat(new Uint8Array([h]), mLen(b.length), b); };
class MqttClient extends Emitter {
  constructor(url) {
    super(); this.url = url; this.host = url.replace(/^wss?:\/\//, '').replace(/[:/].*$/, ''); this.ok = false; this.closed = false;
    this.subs = new Set(); this.pid = 1; this.buf = new Uint8Array(0); this.tries = 0; this.ms = 0; this._connect();
  }
  _connect() {
    if (this.closed) return;
    const t0 = performance.now(); let ws;
    try { ws = new WebSocket(this.url, 'mqtt'); } catch (e) { nlog('mqtt', this.host, 'bad url'); this._retry(); return; }
    ws.binaryType = 'arraybuffer'; this.ws = ws; this.buf = new Uint8Array(0);
    const to = setTimeout(() => { if (!this.ok) { nlog('mqtt', this.host, 'timeout'); try { ws.close(); } catch (e) { } } }, 8000);
    ws.onopen = () => ws.send(mPkt(0x10, mStr('MQTT'), new Uint8Array([4, 0x02, 0, 30]), mStr('sn' + rid())));
    ws.onmessage = e => { if (this.ws === ws && e.data instanceof ArrayBuffer) this._feed(new Uint8Array(e.data), t0); };
    ws.onerror = () => { };
    ws.onclose = () => {
      clearTimeout(to); clearInterval(this._ping); if (this.ws !== ws) return;
      const was = this.ok; this.ok = false; this.ws = null;
      nlog('mqtt', this.host, was ? 'lost' : 'unreachable'); if (was) this.emit('down');
      this._retry();
    };
  }
  _retry() {
    if (this.closed) return; this.tries++; this.emit('fail', this);
    if (this.tries >= 3 && !this.subs.size) { this.idle = true; return; }   // nobody needs it now; wake() brings it back
    setTimeout(() => this._connect(), Math.min(15000, 2000 * this.tries));
  }
  wake() { if (this.idle && !this.closed) { this.idle = false; this.tries = 0; this._connect(); } }
  _feed(chunk, t0) {
    const b = this.buf.length ? cat(this.buf, chunk) : chunk; let i = 0;
    for (;;) {
      if (b.length - i < 2) break;
      let len = 0, mul = 1, j = i + 1, okLen = false;
      while (j < b.length && j < i + 5) { const d = b[j++]; len += (d & 127) * mul; mul *= 128; if (!(d & 128)) { okLen = true; break; } }
      if (!okLen || b.length - j < len) break;
      this._packet(b[i], b.subarray(j, j + len), t0); i = j + len;
    }
    this.buf = b.slice(i);
  }
  _packet(h, p, t0) {
    const type = h >> 4;
    if (type === 2) {
      if (p[1] !== 0) { nlog('mqtt', this.host, 'refused', p[1]); try { this.ws.close(); } catch (e) { } return; }
      this.ok = true; this.tries = 0; this.ms = Math.round(performance.now() - t0); nlog('mqtt', this.host, 'up', this.ms + 'ms');
      for (const t of this.subs) this._sendSub(t);
      clearInterval(this._ping); this._ping = setInterval(() => this._send(new Uint8Array([0xC0, 0])), 15000);
      this.emit('up', this);
    } else if (type === 3) {
      const qos = (h >> 1) & 3, tl = (p[0] << 8) | p[1];
      const topic = td.decode(p.subarray(2, 2 + tl)); const off = 2 + tl + (qos ? 2 : 0);
      this.emit('msg', topic, td.decode(p.subarray(off)));
    }
  }
  _send(u8) { try { if (this.ws && this.ws.readyState === 1) this.ws.send(u8); } catch (e) { } }
  _sendSub(t) { const id = this.pid = (this.pid % 65000) + 1; this._send(mPkt(0x82, new Uint8Array([id >> 8, id & 255]), mStr(t), new Uint8Array([0]))); }
  sub(t) { this.subs.add(t); if (this.ok) this._sendSub(t); }
  unsub(t) { if (!this.subs.delete(t) || !this.ok) return; const id = this.pid = (this.pid % 65000) + 1; this._send(mPkt(0xA2, new Uint8Array([id >> 8, id & 255]), mStr(t))); }
  pub(t, str) { if (this.ok) this._send(mPkt(0x30, mStr(t), te.encode(str))); }
  close() { this.closed = true; clearInterval(this._ping); if (this.ws) { this._send(new Uint8Array([0xE0, 0])); try { this.ws.close(); } catch (e) { } } }
}
// all brokers at once: publish to every live one, de-duplicate on receive
class MqttBus extends Emitter {
  constructor(urls) {
    super(); this.subs = new Map(); this.seen = new Map();
    this.clients = urls.map(u => new MqttClient(u));
    for (const c of this.clients) {
      c.on('msg', (t, s) => this._msg(t, s));
      c.on('up', () => this.emit('up', c)); c.on('fail', () => this.emit('fail', c));
    }
  }
  get up() { return this.clients.filter(c => c.ok).length; }
  ready(ms = 9000) {
    this.clients.forEach(c => c.wake());
    return new Promise((res, rej) => {
      if (this.up) { res(); return; }
      const done = ok => { clearTimeout(to); this.off('up', onUp); this.off('fail', onFail); if (ok) res(); else rej(new Error('MQTT недоступен')); };
      const onUp = () => done(true);
      const onFail = () => { if (!this.up && this.clients.every(c => c.tries > 0)) done(false); };
      const to = setTimeout(() => done(false), ms);
      this.on('up', onUp); this.on('fail', onFail);
    });
  }
  sub(topic, fn) {
    let set = this.subs.get(topic);
    if (!set) { set = new Set(); this.subs.set(topic, set); this.clients.forEach(c => { c.sub(topic); c.wake(); }); }
    set.add(fn);
    return () => { set.delete(fn); if (!set.size && this.subs.get(topic) === set) { this.subs.delete(topic); this.clients.forEach(c => c.unsub(topic)); } };
  }
  pub(topic, obj) {
    const s = JSON.stringify(Object.assign({}, obj, { m: rid() })); let n = 0;
    for (const c of this.clients) if (c.ok) { c.pub(topic, s); n++; }
    return n;
  }
  _msg(topic, s) {
    let o; try { o = JSON.parse(s); } catch (e) { return; }
    if (!o || typeof o.m !== 'string' || this.seen.has(o.m)) return;
    this.seen.set(o.m, 1); if (this.seen.size > 600) this.seen.delete(this.seen.keys().next().value);
    const set = this.subs.get(topic); if (set) [...set].forEach(f => { try { f(o); } catch (e) { nlog('mqtt handler err', e.message); } });
  }
}
let BUS = null;
const brokerList = () => { const q = QS.get('mqtt'); return q ? q.split(',').map(x => x.trim()).filter(Boolean) : BROKERS; };
const bus = () => BUS || (BUS = new MqttBus(brokerList()));
const iceList = () => (NL.info && NL.info.iceServers) || (NL.ice && NL.ice.iceServers) || DEFAULT_ICE;
const T = (room, ...p) => TOPIC + room + '/' + p.join('/');
class MqttPeer extends Emitter {
  constructor(id) {
    super(); this.destroyed = false; this.conns = new Map(); this.offs = []; this.ice = iceList(); this.bus = bus();
    if (id) { this.id = id; this.room = id.slice(PREFIX.length); this.isHost = true; }
    else { this.id = 'q' + rid(); this.isHost = false; }
    this.bus.ready().then(() => {
      if (this.destroyed) return;
      if (this.isHost) this.offs.push(this.bus.sub(T(this.room, 'h'), m => this._hostMsg(m)));
      nlog('mqtt route ready', this.bus.up + '/' + this.bus.clients.length);
      this.emit('open', this.id);
    }, e => { if (!this.destroyed) this.emit('error', { type: 'network', message: e.message }); });
  }
  _hostMsg(m) {
    if (this.destroyed || typeof m.from !== 'string' || m.from.length > 40) return;
    const reply = o => this.bus.pub(T(this.room, 'g', m.from), Object.assign({ from: this.id }, o));
    if (m.t === 'knock') { reply({ t: 'here' }); return; }
    if (m.t === 'offer' && typeof m.sdp === 'string') {
      const old = this.conns.get(m.from);
      if (old && !old.closed) { if (old._answer) reply({ t: 'answer', sdp: old._answer }); return; }
      this._onOffer(m, reply).catch(e => nlog('mqtt offer err', e && e.message));
    }
  }
  async _onOffer(m, reply) {
    nlog('mqtt offer from', m.from.slice(-6));
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const conn = new RtcConn(m.from, pc); this.conns.set(m.from, conn);
    conn.on('close', () => { if (this.conns.get(m.from) === conn) this.conns.delete(m.from); });
    pc.ondatachannel = e => conn._bind(e.channel);
    this.emit('connection', conn);
    await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIce(pc);
    if (conn.closed || this.destroyed) return;
    conn._answer = pc.localDescription.sdp; reply({ t: 'answer', sdp: conn._answer });
    nlog('mqtt answer sent', m.from.slice(-6));
  }
  connect(peerId) {
    const room = peerId.slice(PREFIX.length);
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const conn = new RtcConn(peerId, pc); this.conns.set(peerId, conn);
    conn._bind(pc.createDataChannel('game', { ordered: true }));
    let here = false, answered = false, sdp = null;
    this.offs.push(this.bus.sub(T(room, 'g', this.id), async m => {
      if (m.t === 'here' && !here) { here = true; nlog('mqtt host found'); conn.emit('stage', 'room'); }
      if (m.t === 'answer' && typeof m.sdp === 'string' && !answered && !conn.closed) {
        answered = true; nlog('mqtt answer received'); conn.emit('stage', 'answer');
        try { await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); } catch (e) { nlog('mqtt answer err', e.message); }
      }
    }));
    (async () => {
      await pc.setLocalDescription(await pc.createOffer()); await waitIce(pc);
      sdp = pc.localDescription.sdp; nlog('mqtt offer ready', 'relay:' + / typ relay/.test(sdp), 'srflx:' + / typ srflx/.test(sdp));
    })().catch(e => nlog('mqtt offer err', e && e.message));
    (async () => {
      const t0 = Date.now(); let lastOffer = 0, lastKnock = 0;
      while (!conn.closed && !answered && !this.destroyed) {
        if (!here) {
          if (Date.now() - lastKnock > 1500) { this.bus.pub(T(room, 'h'), { t: 'knock', from: this.id }); lastKnock = Date.now(); }
          if (Date.now() - t0 > 14000) { nlog('mqtt: nobody answered the knock'); this.emit('error', { type: 'peer-unavailable' }); return; }
        } else if (sdp && Date.now() - lastOffer > 3500) { this.bus.pub(T(room, 'h'), { t: 'offer', from: this.id, sdp }); lastOffer = Date.now(); conn.emit('stage', 'offer'); }
        await sleep(300);
      }
    })().catch(e => { nlog('mqtt connect err', e && e.message); this.emit('error', { type: 'network', message: e && e.message }); });
    return conn;
  }
  reconnect() { }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.offs.forEach(f => f()); this.offs = []; for (const c of [...this.conns.values()]) c.close(); }
}

// ---------------------------------------------------------------- PeerJS (CDN) + static ice.json
let peerjsP = null;
function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  // all CDNs at once, first one wins
  return peerjsP || (peerjsP = new Promise((res, rej) => {
    let left = PEER_URLS.length;
    for (const u of PEER_URLS) loadScript(u).then(() => { if (window.Peer) res(window.Peer); else if (--left === 0) rej(); }, () => { if (--left === 0) rej(); });
  }).then(P => { nlog('peerjs loaded'); return P; }, () => { peerjsP = null; nlog('peerjs: CDN unreachable'); throw new Error('Не удалось загрузить модуль PeerJS (CDN недоступен).'); }));
}
// PeerJS wrapper that reuses our ICE servers (incl. TURN) when Netlify or ice.json provided them
function peerjsClass(P) {
  const ice = NL.info || NL.ice;   // without either, PeerJS keeps its defaults (Google STUN + free shared PeerJS TURN)
  if (!ice) return P;
  return class extends P { constructor(id, opts = {}) { super(id, Object.assign({}, opts, { config: { iceServers: ice.iceServers } })); } };
}
// static hosting (GitHub Pages etc.): optional ice.json next to index.html with your own STUN/TURN servers
async function loadIceJson() {
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const r = await fetch('ice.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && Array.isArray(j.iceServers) && j.iceServers.length ? { iceServers: j.iceServers, turnKind: j.iceServers.some(s => s.username) ? 'own' : 'none', static: true } : null;
  } catch (e) { return null; }
}
let routesP = null;
function transports() {
  return routesP || (routesP = (async () => {
    if (/[?&]nettest/.test(location.search)) return ['local'];
    if (!NL.checked) { NL.checked = true; NL.info = await probeNetlify(); if (!NL.info) NL.ice = await loadIceJson(); }
    let r = NL.info ? ['netlify', 'mqtt', 'peerjs'] : ['mqtt', 'peerjs'];
    const only = QS.get('net'); if (only) { const k = only.split(','); const f = r.filter(x => k.includes(x)); if (f.length) r = f; }
    nlog('routes', r.join('+'), NL.info ? 'turn:' + NL.info.turnKind : NL.ice ? 'ice.json' : 'default ice');
    return r;
  })().then(r => { NET._routes = r; return r; }));
}
async function peerClassFor(tr) {
  if (tr === 'local') return FakePeer;
  if (tr === 'netlify') return NetlifyPeer;
  if (tr === 'mqtt') return MqttPeer;
  return peerjsClass(await loadPeerJS());
}
export async function detectBackend() {
  const t = await transports();
  if (t[0] === 'local') return 'local';
  if (t[0] === 'netlify') return NL.info.turnKind === 'own' ? 'netlify+turn' : NL.info.turnKind === 'public' ? 'netlify+publicturn' : 'netlify';
  return 'multi';   // the game UI describes it via routesInfo()
}
export const netLog = () => [navigator.userAgent, 'page ' + location.href.split('#')[0], ...NETLOG].join('\n');
// for the UI: which routes exist and which are live right now
export function routesInfo() {
  return {
    routes: NET._routes || [], mqttUp: BUS ? BUS.up : 0, mqttTotal: brokerList().length,
    listening: NET.hosts.map(p => p.tr), via: NET.role === 'client' ? NET.backend : null, role: NET.role,
    turn: NL.info ? NL.info.turnKind : NL.ice ? (NL.ice.turnKind === 'own' ? 'own' : 'none') : 'public',
  };
}
// open connections early (e.g. when the player starts typing a code) so joining is quicker
export function netWarm() {
  transports().then(r => { if (r.includes('mqtt')) bus(); if (r.includes('peerjs')) loadPeerJS().catch(() => { }); });
}

const errText = (e, code) => {
  const t = e && e.type;
  if (t === 'peer-unavailable') return `Дачи с кодом ${code} нет. Проверь код и что хозяин ещё ждёт.`;
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Не удалось связаться с серверами кооператива. Нажми «Проверить сеть»: возможно, их режет провайдер (поможет VPN или другая сеть).';
  if (t === 'browser-incompatible') return 'Этот браузер не поддерживает кооператив (WebRTC).';
  if (t === 'webrtc') return 'Соединение не пробилось через сеть (NAT/файрвол). Нужен TURN-сервер (см. README) или другая сеть.';
  return (e && e.message) || 'Проблема с соединением';
};
const newCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
const KIND_RANK = { nat: 5, host: 4, missing: 3, net: 2, load: 1, gone: 0 };
const STAGES = { room: 'Дача найдена, отправляем приглашение…', offer: 'Ждём ответа хозяина…', answer: 'Хозяин ответил, соединяемся…', ice: 'Пробиваем соединение через сеть…' };
const STAGE_RANK = { start: 0, room: 1, offer: 2, answer: 3, ice: 4 };
// PeerJS doesn't report handshake progress, so read it off its RTCPeerConnection
function watchPeerjs(conn) {
  try {
    const pc = conn.peerConnection; if (!pc) return;
    pc.addEventListener('signalingstatechange', () => { if (pc.signalingState === 'stable') conn.emit('stage', 'answer'); });
    pc.addEventListener('iceconnectionstatechange', () => { nlog('peerjs ice', pc.iceConnectionState); if (pc.iceConnectionState === 'checking') conn.emit('stage', 'ice'); });
  } catch (e) { }
}

export const NET = {
  role: null, code: null, peer: null, hosts: [], conns: new Map(), hostConn: null, myId: 'solo', backend: null, _routes: null, _attempt: 0,
  handlers: { data: () => { }, join: () => { }, leave: () => { }, status: () => { }, lost: () => { } },
  get on() { return !!this.role; },

  async host() {
    const routes = await transports();
    let last = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = newCode();
      const r = await this._hostOn(routes, code);
      if (r === true) { this.role = 'host'; this.myId = 'h'; this.code = code; this.backend = this.hosts[0].tr; return code; }
      if (r !== 'retry') { last = r; break; }
    }
    throw new Error(last ? errText(last) : 'Не удалось создать комнату, попробуй ещё раз.');
  },
  // start every route at once: the room exists as soon as one of them listens, the others join in as extra ways in
  _hostOn(routes, code) {
    this.hosts = []; const my = ++this._attempt;
    return new Promise(res => {
      let settled = false, pending = routes.length, taken = false, err = null;
      const done = e => {
        if (e && e.type === 'unavailable-id') taken = true; else if (!err || err.type === 'load') err = e;
        if (--pending === 0 && !settled) { settled = true; res(taken ? 'retry' : err || { type: 'network' }); }
      };
      routes.forEach(async tr => {
        let P; try { P = await peerClassFor(tr); } catch (e) { nlog('host route', tr, 'not loaded'); done({ type: 'load', message: e.message }); return; }
        if (this._attempt !== my) return;
        const peer = new P(PREFIX + code, { debug: 0 }); let opened = false;
        const to = setTimeout(() => { if (!opened) { nlog('host route', tr, 'timeout'); try { peer.destroy(); } catch (e) { } done({ type: 'network' }); } }, 15000);
        peer.on('open', () => {
          if (opened) return; opened = true; clearTimeout(to);
          if (this._attempt !== my) { try { peer.destroy(); } catch (e) { } return; }
          nlog('host route', tr, 'listening'); this.hosts.push({ tr, peer });
          if (!settled) { settled = true; res(true); }
        });
        peer.on('error', e => { if (!opened) { clearTimeout(to); try { peer.destroy(); } catch (x) { } nlog('host route', tr, 'failed', e && e.type); done(e); } else nlog('host', tr, 'error', e && e.type); });
        peer.on('connection', conn => this._accept(conn, tr));
        peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { } });
      });
    });
  },
  _accept(conn, tr) {
    let pid = null;
    conn.on('open', () => {
      if (this.role !== 'host') { try { conn.close(); } catch (e) { } return; }
      if (this.conns.size >= MAX_PLAYERS - 1) { try { conn.send({ t: 'full' }); } catch (e) { } setTimeout(() => conn.close(), 400); return; }
      const used = new Set([...this.conns.values()].map(c => c._pid));
      for (let i = 1; i < MAX_PLAYERS; i++) if (!used.has('p' + i)) { pid = 'p' + i; break; }
      conn._pid = pid; conn._seen = performance.now(); this.conns.set(pid, conn); nlog('guest', pid, 'via', tr);
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
    const routes = await transports();
    nlog('join', code, 'via', routes.join('+'));
    const t0 = Date.now(); let msg = `Стучимся на дачу ${code}…`;
    const say = () => this.handlers.status(`${msg} ${Math.round((Date.now() - t0) / 1000)} с`);
    const ctx = { won: false, attempts: [], stage: 0 };
    ctx.status = st => { const r = STAGE_RANK[st] || 0; if (r >= ctx.stage && STAGES[st]) { ctx.stage = r; msg = STAGES[st]; say(); } };
    const tick = setInterval(() => { if (!ctx.won) say(); }, 1000);
    try {
      return await new Promise((res, rej) => {
        let pending = routes.length; const errs = [];
        routes.forEach(tr => this._joinVia(tr, code, hello, 35000, ctx).then(res, e => {
          nlog('join via', tr, 'failed:', e.kind || '', e.message); errs.push(e);
          if (--pending === 0 && !ctx.won) { errs.sort((a, b) => (KIND_RANK[b.kind] || 0) - (KIND_RANK[a.kind] || 0)); rej(new Error(errs[0] ? errs[0].message : 'Проблема с соединением')); }
        }));
      });
    } finally { clearInterval(tick); }
  },
  _joinVia(tr, code, hello, timeout, ctx) {
    return new Promise(async (res, rej) => {
      const stopped = kind => { const x = new Error('stopped'); x.kind = kind; return x; };
      let P; try { P = await peerClassFor(tr); } catch (e) { const x = new Error(e.message); x.kind = 'load'; rej(x); return; }
      if (ctx.won) { rej(stopped('gone')); return; }
      const peer = new P(undefined, { debug: 0 }); let done = false, stage = 'start', to = null;
      const att = { cancel: () => { if (done) return; done = true; clearTimeout(to); try { peer.destroy(); } catch (x) { } rej(stopped('gone')); } };
      ctx.attempts.push(att);
      const fail = (e, kind) => {
        if (done) { nlog(tr, 'late error', e && (e.type || e.message)); return; }   // once connected, only the P2P channel matters
        done = true; clearTimeout(to); try { peer.destroy(); } catch (x) { }
        const err = new Error(errText(e, code)); err.kind = kind || (e && e.type === 'peer-unavailable' ? 'missing' : e && e.type === 'webrtc' ? 'nat' : 'net'); rej(err);
      };
      peer.on('error', e => fail(e));
      to = setTimeout(() => {
        if (stage === 'answer' || stage === 'ice') fail({ message: `Хозяин ответил, но соединение не пробилось через сеть. Обычно это строгий NAT или файрвол: подключите свой TURN-сервер (см. README) или попробуйте другую сеть (например, мобильный интернет).` }, 'nat');
        else if (stage === 'offer' || stage === 'room') fail({ message: `Дача ${code} есть, но хозяин не отвечает. Вкладка хозяина должна быть открыта (не закрыта и не в спящем режиме).` }, 'host');
        else fail({ message: `Не достучаться до дачи ${code}. Проверь код и что хозяин ещё ждёт. Если не помогает, нажми «Проверить сеть».` }, 'missing');
      }, timeout);
      peer.on('open', () => {
        if (done) return;
        nlog(tr, 'ready, connecting');
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        if (tr === 'peerjs') watchPeerjs(conn);
        conn.on('stage', st => { if (done) return; if ((STAGE_RANK[st] || 0) >= (STAGE_RANK[stage] || 0)) stage = st; ctx.status(st); });
        conn.on('open', () => {
          if (done) return;
          if (ctx.won) { att.cancel(); return; }
          ctx.won = true; done = true; clearTimeout(to); ctx.attempts.forEach(a => { if (a !== att) a.cancel(); });
          this.peer = peer; this.hostConn = conn; this.role = 'client'; this.code = code; this.backend = tr; conn._seen = performance.now();
          nlog('joined via', tr);
          conn.send(Object.assign({ t: 'hello' }, hello)); res(code);
        });
        conn.on('data', d => { conn._seen = performance.now(); this.handlers.data('h', d); });
        const lost = () => { if (this.hostConn === conn) { this.hostConn = null; this.handlers.lost('Хозяин закрыл дачу или пропала связь.'); } };
        conn.on('close', lost); conn.on('error', e => { if (!done) fail(e || { type: 'webrtc' }); });
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
    for (const h of this.hosts) try { h.peer.destroy(); } catch (e) { }
    this._attempt++;
    Object.assign(this, { role: null, code: null, peer: null, hosts: [], hostConn: null, myId: 'solo' }); this.conns = new Map();
  },
};

// ---------------------------------------------------------------- "Проверить сеть": what works from this browser
function gather(iceServers, ms) {
  return new Promise(res => {
    const types = new Set(); let pc, t = null;
    const end = () => { clearTimeout(t); try { pc.close(); } catch (e) { } res(types); };
    try { pc = new RTCPeerConnection({ iceServers }); } catch (e) { res(types); return; }
    t = setTimeout(end, ms);
    pc.onicecandidate = e => { if (!e.candidate) { end(); return; } const m = / typ (\w+)/.exec(e.candidate.candidate); if (m) types.add(m[1]); };
    pc.createDataChannel('probe');
    pc.createOffer().then(o => pc.setLocalDescription(o)).catch(end);
  });
}
export async function netCheck(show) {
  const lines = []; const put = (i, s) => { lines[i] = s; show(lines.filter(Boolean)); };
  nlog('--- network check ---');
  put(0, 'Проверяем связь… (до 15 секунд)');
  const rs = await transports();
  const jobs = [];
  if (rs.includes('mqtt')) jobs.push((async () => {
    const b = bus(); await b.ready(9000).catch(() => { }); await sleep(1500);
    const st = b.clients.map(c => `${c.host.replace(/^(broker|test|mqtt)\./, '')} ${c.ok ? '✓' : '✗'}`).join(', ');
    put(1, `Почтовые серверы MQTT: ${b.up} из ${b.clients.length} ${b.up ? '✓' : '✗'} (${st})`);
    return { mqtt: b.up };
  })());
  if (rs.includes('peerjs')) jobs.push((async () => {
    let P; try { P = peerjsClass(await loadPeerJS()); } catch (e) { put(2, 'PeerJS: модуль не загрузился ✗ (CDN заблокирован?)'); return { peerjs: false }; }
    const t0 = performance.now();
    const ok = await new Promise(r => {
      let p; try { p = new P(undefined, { debug: 0 }); } catch (e) { r(false); return; }
      const to = setTimeout(() => { p.destroy(); r(false); }, 12000);
      p.on('open', () => { clearTimeout(to); p.destroy(); r(true); }); p.on('error', () => { clearTimeout(to); p.destroy(); r(false); });
    });
    put(2, ok ? `Сервер PeerJS: ответил за ${((performance.now() - t0) / 1000).toFixed(1)} с ✓` : 'Сервер PeerJS: не ответил за 12 с ✗ (он бывает перегружен, это не страшно, если MQTT работает)');
    return { peerjs: ok };
  })());
  if (rs.includes('netlify')) put(3, 'Свой сервер на Netlify: ✓');
  jobs.push((async () => {
    const ty = await gather(iceList(), 7000);
    put(4, `Внешний адрес (STUN): ${ty.has('srflx') ? '✓' : '✗ (UDP, похоже, закрыт)'}`);
    put(5, `Ретранслятор (TURN): ${ty.has('relay') ? '✓' : '✗ (если друг в другой сети, может не пробиться)'}`);
    return { srflx: ty.has('srflx'), relay: ty.has('relay') };
  })());
  const r = Object.assign({}, ...(await Promise.all(jobs)));
  const sig = r.mqtt || r.peerjs || rs.includes('netlify') || rs.includes('local');
  put(0, null);
  put(6, !sig ? '➜ Нет связи ни с одним сервером знакомств. Похоже, их режет провайдер или фильтр: попробуй VPN или другую сеть (например, мобильный интернет).'
    : !r.srflx && !r.relay ? '➜ Серверы знакомств доступны, но UDP закрыт. На одном компьютере и в одной Wi-Fi сети играть можно, через интернет вряд ли.'
    : !r.relay ? '➜ Основное работает. Если друг в другой сети и не подключается, нужен свой TURN (ice.json, см. README).'
    : '➜ Всё работает ✓ Если всё равно не подключается, нажми «Журнал связи» и пришли его.');
  nlog('check result', JSON.stringify(r));
  return r;
}

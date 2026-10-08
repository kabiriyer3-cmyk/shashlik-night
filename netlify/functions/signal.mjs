// Шашлычная ночь: matchmaking/signaling for co-op (Netlify Function + Netlify Blobs).
// Only used to find the host by room code and swap one WebRTC offer/answer per guest.
// Uses only strongly-consistent key reads (no list()), so nothing depends on edge-cache propagation.
import { getStore } from '@netlify/blobs';

const ROOM_TTL = 90_000;   // a room disappears 90 s after the host stops polling
const SIG_TTL = 120_000;   // unread offers/answers expire after 2 min
const MAX_BODY = 30_000;

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers });
const ROOM_RE = /^[A-Z0-9]{4}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method === 'GET') return json({ ok: true, service: 'shashlik-signal', v: 2 });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: 'too large' }, 413);
  let b; try { b = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
  const room = String(b.room || '').toUpperCase();
  const id = String(b.id || '');
  if (!ROOM_RE.test(room)) return json({ error: 'bad room', code: 'bad' }, 400);
  if (b.op !== 'join' && !ID_RE.test(id)) return json({ error: 'bad id', code: 'bad' }, 400);

  const store = getStore({ name: 'shashlik-signal', consistency: 'strong' });
  const get = k => store.get(k, { type: 'json', consistency: 'strong' });
  const now = Date.now();
  const rk = `room/${room}`;
  const live = r => r && now - r.t < ROOM_TTL;

  try {
    switch (b.op) {
      case 'host': { // create or refresh a room
        const r = await get(rk);
        if (live(r) && r.host !== id) return json({ error: 'taken', code: 'taken' }, 409);
        await store.setJSON(rk, { host: id, t: now, pending: live(r) ? (r.pending || []) : [] });
        return json({ ok: true });
      }
      case 'join': { // does the room exist?
        const r = await get(rk);
        if (!live(r)) return json({ error: 'no such room', code: 'missing' }, 404);
        return json({ host: r.host });
      }
      case 'offer': { // guest -> host (guest re-sends until answered, so a lost update self-heals)
        if (typeof b.sdp !== 'string' || !b.sdp) return json({ error: 'no sdp' }, 400);
        const r = await get(rk);
        if (!live(r)) return json({ error: 'no such room', code: 'missing' }, 404);
        await store.setJSON(`offer/${room}/${id}`, { sdp: b.sdp, t: now });
        if (!(r.pending || []).includes(id)) {
          const pending = (r.pending || []).filter(x => x !== id).slice(-8); pending.push(id);
          await store.setJSON(rk, Object.assign({}, r, { pending }));
        }
        return json({ ok: true });
      }
      case 'recv': { // host polls: keeps the room alive and collects new offers
        const r = await get(rk);
        if (!r || r.host !== id) return json({ error: 'room lost', code: 'missing' }, 404);
        const offers = [];
        for (const g of r.pending || []) {
          const o = await get(`offer/${room}/${g}`);
          if (o && now - o.t < SIG_TTL) offers.push({ from: g, sdp: o.sdp });
          await store.delete(`offer/${room}/${g}`);
        }
        if (offers.length || (r.pending || []).length || now - r.t > 15_000) {
          const fresh = await get(rk) || r; // re-read so a guest that just joined is not dropped
          const left = (fresh.pending || []).filter(g => !offers.some(o => o.from === g) && !(r.pending || []).includes(g));
          await store.setJSON(rk, { host: id, t: now, pending: left });
        }
        return json({ offers });
      }
      case 'answer': { // host -> guest
        const to = String(b.to || '');
        if (!ID_RE.test(to) || typeof b.sdp !== 'string') return json({ error: 'bad answer' }, 400);
        await store.setJSON(`answer/${room}/${to}`, { sdp: b.sdp, t: now });
        return json({ ok: true });
      }
      case 'poll': { // guest waits for its answer
        const a = await get(`answer/${room}/${id}`);
        if (a && now - a.t < SIG_TTL) { await store.delete(`answer/${room}/${id}`); return json({ answer: a.sdp }); }
        const r = await get(rk);
        return json({ answer: null, room: live(r) });
      }
      case 'close': {
        const r = await get(rk);
        if (r && r.host === id) await store.delete(rk);
        return json({ ok: true });
      }
    }
  } catch (e) {
    return json({ error: 'storage: ' + (e && e.message || e), code: 'storage' }, 500);
  }
  return json({ error: 'unknown op' }, 400);
};

export const config = { path: '/api/signal' };

// Шашлычная ночь: hands the browser its WebRTC ICE servers (STUN always, TURN when configured).
// TURN relays traffic for players behind strict networks (mobile carriers, office/school Wi-Fi).
// Configure ONE of these in Netlify → Site configuration → Environment variables:
//   Cloudflare:  CF_TURN_KEY_ID + CF_TURN_API_TOKEN          (Cloudflare Realtime TURN, has a free tier)
//   Metered:     METERED_DOMAIN (e.g. myapp.metered.live) + METERED_API_KEY
//   Any TURN:    TURN_URLS (comma separated) + TURN_USERNAME + TURN_CREDENTIAL
const env = k => (globalThis.Netlify && Netlify.env && Netlify.env.get(k)) || process.env[k] || '';
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' };

export default async () => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
  let turn = false;
  const errors = [];
  try {
    if (env('CF_TURN_KEY_ID') && env('CF_TURN_API_TOKEN')) {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env('CF_TURN_KEY_ID')}/credentials/generate-ice-servers`, {
        method: 'POST', headers: { authorization: `Bearer ${env('CF_TURN_API_TOKEN')}`, 'content-type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }),
      });
      if (!r.ok) throw new Error('cloudflare ' + r.status);
      const j = await r.json();
      const list = Array.isArray(j.iceServers) ? j.iceServers : [j.iceServers];
      for (const s of list) {
        const urls = [].concat(s.urls || []).filter(u => !/:53(\?|$)/.test(u)); // browsers block port 53
        if (urls.length) { iceServers.push(Object.assign({}, s, { urls })); if (s.username) turn = true; }
      }
    }
  } catch (e) { errors.push(String(e.message || e)); }
  try {
    if (env('METERED_DOMAIN') && env('METERED_API_KEY')) {
      const r = await fetch(`https://${env('METERED_DOMAIN')}/api/v1/turn/credentials?apiKey=${encodeURIComponent(env('METERED_API_KEY'))}`);
      if (!r.ok) throw new Error('metered ' + r.status);
      const list = await r.json();
      if (Array.isArray(list)) for (const s of list) { iceServers.push(s); if (s.username) turn = true; }
    }
  } catch (e) { errors.push(String(e.message || e)); }
  if (env('TURN_URLS') && env('TURN_USERNAME') && env('TURN_CREDENTIAL')) {
    iceServers.push({ urls: env('TURN_URLS').split(',').map(s => s.trim()).filter(Boolean), username: env('TURN_USERNAME'), credential: env('TURN_CREDENTIAL') });
    turn = true;
  }
  // No TURN of your own? Fall back to the free shared PeerJS relay so cross-network games still have a chance.
  let turnKind = turn ? 'own' : 'none';
  if (!turn && env('NO_PUBLIC_TURN') !== '1') {
    iceServers.push({ urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' });
    turnKind = 'public';
  }
  return new Response(JSON.stringify({ iceServers, turn: turnKind !== 'none', turnKind, signal: '/api/signal', errors }), { headers });
};

export const config = { path: '/api/ice' };

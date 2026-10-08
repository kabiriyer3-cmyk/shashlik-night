// All sound is synthesized: sizzle, crackle, crickets, Dima's guitar (Karplus-Strong), voices, dog.
export class SFX {
  constructor() { this.ctx = null; this.muted = false; this.vol = 0.8; this.levels = { master: 0.8, sfx: 1, amb: 0.8, music: 0.7, voice: 0.9 }; this.nextGuitar = 0; this.chordIdx = 0; this.guitarOn = true; }
  init() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : this.vol;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.bus = {};
    for (const k of ['sfx', 'amb', 'music', 'voice']) { const g = c.createGain(); g.gain.value = this.levels[k]; g.connect(this.master); this.bus[k] = g; }
    this.master.gain.value = this.muted ? 0 : this.levels.master;
    const len = c.sampleRate * 2; const nb = c.createBuffer(1, len, c.sampleRate); const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = nb;
    // sizzle loop
    this.sizG = c.createGain(); this.sizG.gain.value = 0;
    const s = c.createBufferSource(); s.buffer = nb; s.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3800; bp.Q.value = 0.6;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    s.connect(bp); bp.connect(hp); hp.connect(this.sizG); this.sizG.connect(this.bus.amb); s.start();
    this.sizMod = 0;
    // wind
    this.windG = c.createGain(); this.windG.gain.value = 0.035;
    const w = c.createBufferSource(); w.buffer = nb; w.loop = true; w.playbackRate.value = 0.5;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    w.connect(lp); lp.connect(this.windG); this.windG.connect(this.bus.amb); w.start();
    this.windLP = lp;
    // crickets bus
    this.crG = c.createGain(); this.crG.gain.value = 0; this.crG.connect(this.bus.amb);
    this.nextCricket = 0;
    // guitar spatial bus
    this.gPan = this.panner(); this.gBus = c.createGain(); this.gBus.gain.value = 0.55; this.gBus.connect(this.gPan); this.gPan.connect(this.bus.music);
    this.ksCache = new Map();
  }
  panner() {
    const p = this.ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.6; p.rolloffFactor = 1.1; p.maxDistance = 60; return p;
  }
  setPos(p, x, y, z) { if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.levels.master, this.ctx.currentTime, 0.05); }
  setLevel(k, v) { this.levels[k] = v; if (!this.ctx) return; const g = k === 'master' ? this.master : this.bus[k]; if (k === 'master' && this.muted) return; g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  listener(pos, fwd) {
    if (!this.ctx) return; const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  }
  env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  noiseBurst(t, dur, type, freq, q, peak, dest, rate = 1) {
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rate;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); this.env(g, t, 0.005, peak, dur);
    s.connect(f); f.connect(g); g.connect(dest || this.bus.sfx); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.1);
    return f;
  }
  tone(t, freq, dur, type = 'sine', peak = 0.2, dest, a = 0.005) {
    const c = this.ctx; const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    const g = c.createGain(); this.env(g, t, a, peak, dur); o.connect(g); g.connect(dest || this.bus.sfx); o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }
  play(name, pos) {
    if (!this.ctx || this.muted) return; const c = this.ctx, t = c.currentTime;
    let dest = this.bus.sfx;
    if (pos) { const p = this.panner(); this.setPos(p, pos.x, pos.y, pos.z); p.connect(this.bus.sfx); dest = p; }
    switch (name) {
      case 'place': this.noiseBurst(t, 0.6, 'bandpass', 3000, 0.7, 0.35, dest); this.tone(t, 1900, 0.15, 'triangle', 0.05, dest); break;
      case 'flip': this.tone(t, 2350, 0.25, 'sine', 0.06, dest); this.tone(t + 0.01, 3650, 0.18, 'sine', 0.04, dest); this.noiseBurst(t, 0.25, 'bandpass', 3500, 0.8, 0.12, dest); break;
      case 'take': this.tone(t, 1600, 0.12, 'triangle', 0.05, dest); this.tone(t + 0.04, 2400, 0.1, 'sine', 0.04, dest); break;
      case 'grab': this.noiseBurst(t, 0.12, 'lowpass', 900, 1, 0.12, dest); break;
      case 'fan': { const f = this.noiseBurst(t, 0.28, 'bandpass', 500, 1.2, 0.14, dest); f.frequency.exponentialRampToValueAtTime(1600, t + 0.25); break; }
      case 'spray': this.noiseBurst(t, 0.35, 'highpass', 4500, 0.6, 0.22, dest); this.noiseBurst(t + 0.05, 0.9, 'bandpass', 2500, 0.5, 0.18, dest); break;
      case 'coal': for (let i = 0; i < 14; i++) this.noiseBurst(t + i * 0.035 + Math.random() * 0.02, 0.05, 'bandpass', 600 + Math.random() * 900, 2, 0.15, dest); break;
      case 'flare': { const f = this.noiseBurst(t, 0.9, 'lowpass', 250, 0.8, 0.4, dest); f.frequency.exponentialRampToValueAtTime(2200, t + 0.4); this.tone(t, 70, 0.5, 'sine', 0.3, dest, 0.02); break; }
      case 'coin': this.tone(t, 1318, 0.25, 'square', 0.04, dest); this.tone(t + 0.08, 1760, 0.4, 'square', 0.04, dest); this.tone(t + 0.08, 2637, 0.3, 'sine', 0.05, dest); break;
      case 'perfect': [523, 659, 784, 1046].forEach((f, i) => this.tone(t + i * 0.07, f, 0.35, 'triangle', 0.09, dest)); break;
      case 'bad': this.tone(t, 220, 0.35, 'sawtooth', 0.05, dest); this.tone(t + 0.15, 165, 0.45, 'sawtooth', 0.05, dest); break;
      case 'ui': this.tone(t, 900, 0.06, 'triangle', 0.06); break;
      case 'deny': this.tone(t, 180, 0.12, 'square', 0.04); break;
      case 'levelup': [392, 523, 659, 784, 1046, 1318].forEach((f, i) => { this.tone(t + i * 0.09, f, 0.5, 'triangle', 0.1); this.tone(t + i * 0.09, f * 2, 0.3, 'sine', 0.03); }); break;
      case 'achieve': [784, 988, 1175, 1568].forEach((f, i) => this.tone(t + i * 0.06, f, 0.4, 'sine', 0.08)); break;
      case 'bark': for (let k = 0; k < 2; k++) { const tt = t + k * 0.22; const o = this.tone(tt, 420, 0.12, 'sawtooth', 0.18, dest, 0.01); o.frequency.exponentialRampToValueAtTime(260, tt + 0.12); this.noiseBurst(tt, 0.1, 'bandpass', 1200, 1.5, 0.12, dest); } break;
      case 'yelp': { const o = this.tone(t, 1300, 0.35, 'triangle', 0.15, dest); o.frequency.exponentialRampToValueAtTime(650, t + 0.35); break; }
      case 'whistle': { const o = this.tone(t, 1800, 0.5, 'sine', 0.08, dest, 0.03); o.frequency.linearRampToValueAtTime(2600, t + 0.25); o.frequency.linearRampToValueAtTime(1500, t + 0.5); break; }
      case 'clink': this.tone(t, 3100, 0.5, 'sine', 0.05, dest); this.tone(t + 0.02, 4200, 0.4, 'sine', 0.03, dest); break;
    }
  }
  voice(pos, pitch, n = 5, mood = 0) {
    if (!this.ctx || this.muted) return; const c = this.ctx; let t = c.currentTime;
    const p = this.panner(); this.setPos(p, pos.x, pos.y, pos.z); p.connect(this.bus.voice);
    for (let i = 0; i < n; i++) {
      const dur = 0.07 + Math.random() * 0.09;
      const o = c.createOscillator(); o.type = 'sawtooth';
      const f0 = pitch * (1 + (Math.random() - 0.5) * 0.25 + mood * 0.15 * (i / n));
      o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (0.9 + Math.random() * 0.25), t + dur);
      const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 500 + Math.random() * 600; f1.Q.value = 4;
      const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1300 + Math.random() * 1200; f2.Q.value = 5;
      const g = c.createGain(); this.env(g, t, 0.02, 0.22, dur);
      o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(p); o.start(t); o.stop(t + dur + 0.1);
      t += dur + 0.02 + Math.random() * 0.05;
    }
  }
  ks(midi) {
    if (this.ksCache.has(midi)) return this.ksCache.get(midi);
    const c = this.ctx, sr = c.sampleRate, f = 440 * Math.pow(2, (midi - 69) / 12);
    const N = Math.round(sr / f), len = Math.floor(sr * 2.6);
    const b = c.createBuffer(1, len, sr), d = b.getChannelData(0);
    const ring = new Float32Array(N); for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0, prev = 0; const decay = 0.9962 - (midi - 40) * 0.00004;
    for (let i = 0; i < len; i++) {
      const cur = ring[idx]; const nxt = ring[(idx + 1) % N];
      const v = decay * 0.5 * (cur + nxt); ring[idx] = v; d[i] = cur * 0.6 + prev * 0.4; prev = cur; idx = (idx + 1) % N;
    }
    this.ksCache.set(midi, b); return b;
  }
  pluck(t, midi, vel) {
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = this.ks(midi);
    const g = c.createGain(); g.gain.value = vel; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400 + vel * 2000;
    s.connect(lp); lp.connect(g); g.connect(this.gBus); s.start(t); s.stop(t + 2.6);
  }
  strum(t, notes, down = true, vel = 0.25, spread = 0.016) {
    const ns = down ? notes : [...notes].reverse();
    ns.forEach((m, i) => this.pluck(t + i * spread, m, vel * (0.8 + Math.random() * 0.3)));
  }
  update(dt, st) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const target = Math.min(0.5, st.sizzle * 0.22);
    this.sizMod += (Math.random() - 0.5) * 0.4; this.sizMod *= 0.9;
    this.sizG.gain.setTargetAtTime(this.muted ? 0 : Math.max(0, target * (1 + this.sizMod)), t, 0.08);
    // crackle pops
    if (Math.random() < dt * (1 + st.heat * 7)) {
      const tt = t + Math.random() * 0.05;
      this.noiseBurst(tt, 0.02 + Math.random() * 0.03, 'bandpass', 1500 + Math.random() * 3500, 3, 0.05 + Math.random() * 0.12 * st.heat, this.bus.amb);
    }
    this.windG.gain.setTargetAtTime(0.02 + 0.03 * st.wind, t, 0.5);
    this.crG.gain.setTargetAtTime(st.night * 0.6, t, 1.0);
    if (st.night > 0.05 && t > this.nextCricket) {
      const f = 4300 + Math.random() * 600; const tt = t + 0.02;
      for (let k = 0; k < 3; k++) this.tone(tt + k * 0.045, f, 0.025, 'sine', 0.05, this.crG, 0.004);
      this.nextCricket = t + 0.35 + Math.random() * 0.9;
    }
    // Dima's guitar: Am Dm E Am (dvorovaya progression) in a 6/8-ish boom-chk pattern
    if (st.guitarPos) this.setPos(this.gPan, st.guitarPos.x, st.guitarPos.y, st.guitarPos.z);
    this.gBus.gain.setTargetAtTime(st.guitarOn ? 0.55 : 0.0, t, 0.3);
    if (this.nextGuitar < t) this.nextGuitar = t + 0.1;
    while (this.nextGuitar < t + 0.6) {
      const CH = [[45, 52, 57, 60, 64], [45, 52, 57, 60, 64], [50, 57, 62, 65], [50, 57, 62, 65], [40, 47, 52, 56, 59, 64], [40, 47, 52, 56, 59, 64], [45, 52, 57, 60, 64], [48, 52, 55, 60, 64]];
      const ch = CH[this.chordIdx % CH.length]; const T0 = this.nextGuitar; const beat = 0.36;
      if (st.guitarOn) {
        this.pluck(T0, ch[0], 0.5);
        this.strum(T0 + beat, ch.slice(1), true, 0.18);
        this.strum(T0 + beat * 1.5, ch.slice(2), false, 0.12);
        this.pluck(T0 + beat * 2, ch[1] , 0.38);
        this.strum(T0 + beat * 3, ch.slice(1), true, 0.17);
        this.strum(T0 + beat * 3.5, ch.slice(2), false, 0.11);
      }
      this.nextGuitar += beat * 4; this.chordIdx++;
    }
  }
}

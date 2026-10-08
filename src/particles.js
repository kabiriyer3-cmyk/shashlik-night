import * as THREE from 'three';

const VS = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
uniform float uScale; varying float vAlpha; varying vec3 vColor;
void main(){
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(-mv.z, 0.05);
  vAlpha = aAlpha; vColor = aColor;
}`;
const FS = `
uniform float uSoft; uniform vec3 uTint; varying float vAlpha; varying vec3 vColor;
void main(){
  vec2 p = gl_PointCoord - 0.5; float d = length(p);
  float a = smoothstep(0.5, 0.5 - uSoft, d);
  if (a <= 0.001) discard;
  gl_FragColor = vec4(vColor * uTint, a * vAlpha);
}`;

export class Particles {
  constructor(scene, max, { additive = false, soft = 0.5, order = 10 } = {}) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.size0 = new Float32Array(max); this.size1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3); this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.posA = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeA = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaA = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.colA = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posA); g.setAttribute('aSize', this.sizeA); g.setAttribute('aAlpha', this.alphaA); g.setAttribute('aColor', this.colA);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 400 }, uSoft: { value: soft }, uTint: { value: new THREE.Color(1, 1, 1) } }
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = order;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, alpha = 1, drag = 0.5, grav = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.age[i] = 0; this.size0[i] = s0; this.size1[i] = s1;
    this.c0.set(c0, i * 3); this.c1.set(c1, i * 3); this.a0[i] = alpha; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt, wind = [0, 0]) {
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.kill(i); continue; }
      const k = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] = this.v[i * 3] * k + wind[0] * dt; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k + this.grav[i] * dt; this.v[i * 3 + 2] = this.v[i * 3 + 2] * k + wind[1] * dt;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      i++;
    }
    const P = this.posA.array, S = this.sizeA.array, A = this.alphaA.array, C = this.colA.array;
    for (let j = 0; j < this.n; j++) {
      const t = this.age[j] / this.life[j];
      P[j * 3] = this.p[j * 3]; P[j * 3 + 1] = this.p[j * 3 + 1]; P[j * 3 + 2] = this.p[j * 3 + 2];
      S[j] = this.size0[j] + (this.size1[j] - this.size0[j]) * t;
      A[j] = this.a0[j] * Math.min(1, t * 6) * (1 - t) * (1 - t);
      for (let c = 0; c < 3; c++) C[j * 3 + c] = this.c0[j * 3 + c] + (this.c1[j * 3 + c] - this.c0[j * 3 + c]) * t;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.posA.needsUpdate = this.sizeA.needsUpdate = this.alphaA.needsUpdate = this.colA.needsUpdate = true;
  }
  kill(i) {
    const l = --this.n; if (i === l) return;
    for (let c = 0; c < 3; c++) { this.p[i * 3 + c] = this.p[l * 3 + c]; this.v[i * 3 + c] = this.v[l * 3 + c]; this.c0[i * 3 + c] = this.c0[l * 3 + c]; this.c1[i * 3 + c] = this.c1[l * 3 + c]; }
    this.life[i] = this.life[l]; this.age[i] = this.age[l]; this.size0[i] = this.size0[l]; this.size1[i] = this.size1[l]; this.a0[i] = this.a0[l]; this.drag[i] = this.drag[l]; this.grav[i] = this.grav[l];
  }
}

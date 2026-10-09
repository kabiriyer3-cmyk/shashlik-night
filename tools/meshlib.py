"""Tiny procedural mesh + GLB export library (numpy only).
Everything the game shows is built here from math: no asset files."""
import numpy as np, struct, json, io
from PIL import Image

F32 = np.float32

# ---------------------------------------------------------------- color utils
def srgb2lin(c):
    c = np.asarray(c, np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])

# ---------------------------------------------------------------- noise
def _hash(ix, iy, iz, seed):
    h = (ix * 374761393 + iy * 668265263 + iz * 1442695040888963407 + seed * 1274126177 + 0x9E3779B9)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return ((h & 0xFFFF).astype(np.float64) / 65535.0) * 2 - 1

def vnoise(p, seed=0, period=None):
    p = np.asarray(p, np.float64)
    i = np.floor(p).astype(np.int64)
    f = p - i
    u = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                ix, iy, iz = i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz
                if period is not None:
                    if period[0]: ix = ix % period[0]
                    if period[1]: iy = iy % period[1]
                    if period[2]: iz = iz % period[2]
                w = (u[..., 0] if dx else 1 - u[..., 0]) * (u[..., 1] if dy else 1 - u[..., 1]) * (u[..., 2] if dz else 1 - u[..., 2])
                out = out + w * _hash(ix, iy, iz, seed)
    return out

def fbm(p, octaves=4, lac=2.0, gain=0.5, seed=0, period=None):
    p = np.asarray(p, np.float64)
    amp, tot, norm = 1.0, 0, 0
    per = period
    for o in range(octaves):
        tot = tot + amp * vnoise(p, seed + o * 17, per)
        norm += amp
        p = p * lac
        amp *= gain
        if per is not None:
            per = tuple(int(x * lac) if x else None for x in per)
    return tot / norm

def noise2d_tile(w, h, freq, octaves=4, seed=0, gain=0.5):
    """Tileable fbm texture in [-1,1], shape (h,w)."""
    ys, xs = np.mgrid[0:h, 0:w]
    p = np.stack([xs / w * freq, ys / h * freq, np.zeros_like(xs, dtype=float)], -1)
    return fbm(p, octaves, 2.0, gain, seed, (freq, freq, None))

# ---------------------------------------------------------------- mesh
class Mesh:
    def __init__(self, P, I, N=None, UV=None, C=None, J=None, W=None):
        self.P = np.asarray(P, np.float64).reshape(-1, 3)
        self.I = np.asarray(I, np.int64).reshape(-1)
        self.N = None if N is None else np.asarray(N, np.float64).reshape(-1, 3)
        self.UV = None if UV is None else np.asarray(UV, np.float64).reshape(-1, 2)
        self.C = None if C is None else np.asarray(C, np.float64).reshape(-1, 3)
        self.J = None if J is None else np.asarray(J, np.int64).reshape(-1, 4)
        self.W = None if W is None else np.asarray(W, np.float64).reshape(-1, 4)
        if self.N is None:
            self.recompute_normals()

    @property
    def n(self):
        return len(self.P)

    def copy(self):
        c = lambda a: None if a is None else a.copy()
        return Mesh(self.P.copy(), self.I.copy(), c(self.N), c(self.UV), c(self.C), c(self.J), c(self.W))

    def recompute_normals(self, seams=None):
        P, I = self.P, self.I.reshape(-1, 3)
        fn = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]])
        N = np.zeros_like(P)
        for k in range(3):
            np.add.at(N, I[:, k], fn)
        if seams is not None:  # weld normals of coincident vertices
            key = np.round(P / 1e-5).astype(np.int64)
            _, inv = np.unique(key, axis=0, return_inverse=True)
            inv = inv.reshape(-1)
            acc = np.zeros((inv.max() + 1, 3))
            np.add.at(acc, inv, N)
            N = acc[inv]
        l = np.linalg.norm(N, axis=1, keepdims=True)
        self.N = N / np.maximum(l, 1e-12)
        return self

    def weld_normals(self):
        return self.recompute_normals(seams=True)

    def transform(self, M):
        M = np.asarray(M, np.float64)
        P = np.c_[self.P, np.ones(self.n)] @ M.T
        self.P = P[:, :3]
        R = np.linalg.inv(M[:3, :3]).T
        N = self.N @ R.T
        self.N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
        if np.linalg.det(M[:3, :3]) < 0:
            I = self.I.reshape(-1, 3)
            self.I = I[:, [0, 2, 1]].reshape(-1)
        return self

    def t(self, x=0, y=0, z=0):
        return self.transform(T(x, y, z))

    def s(self, x=1, y=None, z=None):
        y = x if y is None else y
        z = x if z is None else z
        return self.transform(S(x, y, z))

    def r(self, x=0, y=0, z=0):
        return self.transform(Ry(y) @ Rx(x) @ Rz(z))

    def color(self, rgb):
        rgb = np.asarray(rgb, np.float64)
        self.C = np.tile(rgb[:3], (self.n, 1))
        return self

    def bone(self, j):
        self.J = np.zeros((self.n, 4), np.int64)
        self.J[:, 0] = j
        self.W = np.zeros((self.n, 4))
        self.W[:, 0] = 1
        return self

    def flip(self):
        I = self.I.reshape(-1, 3)
        self.I = I[:, [0, 2, 1]].reshape(-1)
        self.N = -self.N
        return self

    def displace(self, amp, freq, seed=0, octaves=3, along_normal=True):
        d = fbm(self.P * freq, octaves, seed=seed)
        if along_normal:
            self.P = self.P + self.N * (d * amp)[:, None]
        return self

    def select_faces(self, mask_fn):
        """Keep faces whose 3 vertices all pass mask_fn(P) -> bool array."""
        m = mask_fn(self.P)
        I = self.I.reshape(-1, 3)
        keep = m[I].all(1)
        I = I[keep]
        used = np.unique(I)
        remap = -np.ones(self.n, np.int64)
        remap[used] = np.arange(len(used))
        sub = lambda a: None if a is None else a[used]
        return Mesh(self.P[used], remap[I].reshape(-1), self.N[used], sub(self.UV), sub(self.C), sub(self.J), sub(self.W))


def merge(meshes):
    meshes = [m for m in meshes if m is not None and m.n > 0]
    P, I, N, UV, C, J, W = [], [], [], [], [], [], []
    off = 0
    anyuv = any(m.UV is not None for m in meshes)
    anyc = any(m.C is not None for m in meshes)
    anyj = any(m.J is not None for m in meshes)
    for m in meshes:
        P.append(m.P); N.append(m.N); I.append(m.I + off)
        if anyuv: UV.append(m.UV if m.UV is not None else np.zeros((m.n, 2)))
        if anyc: C.append(m.C if m.C is not None else np.ones((m.n, 3)))
        if anyj:
            J.append(m.J if m.J is not None else np.zeros((m.n, 4), np.int64))
            W.append(m.W if m.W is not None else np.tile([1, 0, 0, 0], (m.n, 1)))
        off += m.n
    return Mesh(np.vstack(P), np.concatenate(I), np.vstack(N),
                np.vstack(UV) if anyuv else None, np.vstack(C) if anyc else None,
                np.vstack(J) if anyj else None, np.vstack(W) if anyj else None)

# ---------------------------------------------------------------- matrices
def T(x, y, z):
    M = np.eye(4); M[:3, 3] = [x, y, z]; return M

def S(x, y, z):
    return np.diag([x, y, z, 1.0])

def Rx(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]])

def Ry(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]])

def Rz(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])

def look_frame(d, up=(0, 1, 0)):
    """Rotation whose +Y axis points along d."""
    d = np.asarray(d, float); d = d / np.linalg.norm(d)
    up = np.asarray(up, float)
    if abs(np.dot(up, d)) > 0.95: up = np.array([1.0, 0, 0])
    x = np.cross(d, up); x /= np.linalg.norm(x)
    z = np.cross(x, d)
    M = np.eye(4); M[:3, 0] = x; M[:3, 1] = d; M[:3, 2] = z
    return M

# ---------------------------------------------------------------- primitives
def grid(Pgrid, closed_u=False, uv=None, weld=True):
    """Pgrid: (nv, nu, 3). Builds quads. If closed_u, last column connects to first (seam duplicated for UVs)."""
    nv, nu, _ = Pgrid.shape
    if closed_u:
        Pgrid = np.concatenate([Pgrid, Pgrid[:, :1]], 1)
        nu += 1
    P = Pgrid.reshape(-1, 3)
    idx = np.arange(nv * nu).reshape(nv, nu)
    a = idx[:-1, :-1].ravel(); b = idx[:-1, 1:].ravel(); c = idx[1:, 1:].ravel(); d = idx[1:, :-1].ravel()
    I = np.stack([a, d, b, b, d, c], 1).ravel()
    if uv is None:
        us, vs = np.meshgrid(np.linspace(0, 1, nu), np.linspace(0, 1, nv))
        uv = np.stack([us, vs], -1).reshape(-1, 2)
    m = Mesh(P, I, UV=uv)
    # drop degenerate triangles (poles)
    Ii = m.I.reshape(-1, 3)
    area = np.linalg.norm(np.cross(P[Ii[:, 1]] - P[Ii[:, 0]], P[Ii[:, 2]] - P[Ii[:, 0]]), axis=1)
    m.I = Ii[area > 1e-14].ravel()
    if weld: m.weld_normals()
    else: m.recompute_normals()
    return m

def lathe(prof, seg=16, sx=1.0, sz=1.0, phase=0.0):
    """prof: list of (r, y). Revolve around Y. Outward-facing when prof goes bottom->top."""
    prof = np.asarray(prof, float)
    th = np.linspace(0, 2 * np.pi, seg, endpoint=False) + phase
    r = prof[:, 0][:, None]; y = prof[:, 1][:, None]
    G = np.stack([r * np.cos(th) * sx, np.repeat(y, seg, 1), r * np.sin(th) * sz], -1)
    return grid(G, closed_u=True)

def sphere(r=1.0, seg=16, rings=10, sx=1, sy=1, sz=1):
    a = np.linspace(-np.pi / 2, np.pi / 2, rings + 1)
    prof = np.c_[np.cos(a) * r, np.sin(a) * r]
    prof[0, 0] = prof[-1, 0] = 0
    m = lathe(prof, seg)
    return m.s(sx, sy, sz)

def superellipsoid(a, b, c, e1=0.5, e2=0.5, seg=16, rings=12):
    """Rounded box-like blob. e<1 boxier."""
    v = np.linspace(-np.pi / 2, np.pi / 2, rings + 1)
    u = np.linspace(-np.pi, np.pi, seg, endpoint=False)
    V, U = np.meshgrid(v, u, indexing='ij')
    sp = lambda w, e: np.sign(w) * np.abs(w) ** e
    x = a * sp(np.cos(V), e1) * sp(np.cos(U), e2)
    z = c * sp(np.cos(V), e1) * sp(np.sin(U), e2)
    y = b * sp(np.sin(V), e1)
    G = np.stack([x, y, z], -1)
    G[0, :, 0] = G[0, :, 2] = 0; G[-1, :, 0] = G[-1, :, 2] = 0
    return grid(G, closed_u=True)

def cylinder(r0, r1, h, seg=16, caps=True, y0=0.0):
    side = lathe([(r0, y0), (r1, y0 + h)], seg)
    side.recompute_normals(seams=True)
    parts = [side]
    if caps:
        for (r, y, up) in ((r0, y0, False), (r1, y0 + h, True)):
            if r <= 0: continue
            th = np.linspace(0, 2 * np.pi, seg, endpoint=False)
            P = np.vstack([[0, y, 0], np.c_[np.cos(th) * r, np.full(seg, y), -np.sin(th) * r]])
            I = []
            for k in range(seg):
                a, b = 1 + k, 1 + (k + 1) % seg
                I += [0, a, b] if up else [0, b, a]
            uv = np.r_[[[0.5, 0.5]], np.c_[0.5 + 0.5 * np.cos(th), 0.5 + 0.5 * np.sin(th)]]
            parts.append(Mesh(P, I, N=np.tile([0, 1 if up else -1, 0], (seg + 1, 1)), UV=uv))
    return merge(parts)

def box(sx, sy, sz, uvscale=1.0):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    faces = [((1, 0, 0), (0, 0, -1), (0, 1, 0), sz, sy, hx), ((-1, 0, 0), (0, 0, 1), (0, 1, 0), sz, sy, hx),
             ((0, 1, 0), (1, 0, 0), (0, 0, -1), sx, sz, hy), ((0, -1, 0), (1, 0, 0), (0, 0, 1), sx, sz, hy),
             ((0, 0, 1), (1, 0, 0), (0, 1, 0), sx, sy, hz), ((0, 0, -1), (-1, 0, 0), (0, 1, 0), sx, sy, hz)]
    P, N, UV, I = [], [], [], []
    for k, (n, u, v, w, h, d) in enumerate(faces):
        n, u, v = map(np.array, (n, u, v))
        c = n * d
        for (a, b) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            P.append(c + u * a * w / 2 + v * b * h / 2); N.append(n)
            UV.append(((a + 1) / 2 * w * uvscale, (b + 1) / 2 * h * uvscale))
        o = k * 4
        I += [o, o + 1, o + 2, o, o + 2, o + 3]
    return Mesh(P, I, N=N, UV=UV)

def quad(w, h):
    P = [(-w / 2, 0, 0), (w / 2, 0, 0), (w / 2, h, 0), (-w / 2, h, 0)]
    return Mesh(P, [0, 1, 2, 0, 2, 3], N=[(0, 0, 1)] * 4, UV=[(0, 0), (1, 0), (1, 1), (0, 1)])

def torus(R, r, seg=24, tseg=8, arc=2 * np.pi):
    u = np.linspace(0, arc, seg + (0 if arc >= 2 * np.pi - 1e-6 else 1), endpoint=arc < 2 * np.pi - 1e-6)
    v = np.linspace(0, 2 * np.pi, tseg, endpoint=False)
    U, V = np.meshgrid(u, v, indexing='ij')
    x = (R + r * np.cos(V)) * np.cos(U)
    z = (R + r * np.cos(V)) * np.sin(U)
    y = r * np.sin(V)
    return grid(np.stack([x, y, z], -1), closed_u=True).flip()

def frames(path):
    path = np.asarray(path, float)
    tg = np.gradient(path, axis=0)
    tg /= np.maximum(np.linalg.norm(tg, axis=1, keepdims=True), 1e-12)
    n = np.cross(tg[0], [0, 1, 0] if abs(tg[0][1]) < 0.9 else [1, 0, 0]); n /= np.linalg.norm(n)
    Ns = [n]
    for i in range(1, len(path)):
        n = Ns[-1] - tg[i] * np.dot(Ns[-1], tg[i])
        if np.linalg.norm(n) < 1e-9: n = Ns[-1]
        Ns.append(n / np.linalg.norm(n))
    Ns = np.array(Ns)
    Bs = np.cross(tg, Ns)
    return tg, Ns, Bs

def tube(path, radii, seg=10, ex=1.0, ey=1.0, cap=True, ref=None):
    """Tube along path with per-point radius. ex/ey ellipse scale. ref: optional fixed side vector."""
    path = np.asarray(path, float)
    radii = np.broadcast_to(np.asarray(radii, float), (len(path),))
    tg, Ns, Bs = frames(path)
    if ref is not None:
        ref = np.asarray(ref, float)
        Ns = ref - tg * (tg @ ref)[:, None]; Ns /= np.linalg.norm(Ns, axis=1, keepdims=True)
        Bs = np.cross(tg, Ns)
    th = np.linspace(0, 2 * np.pi, seg, endpoint=False)
    G = path[:, None, :] + radii[:, None, None] * (np.cos(th)[None, :, None] * Ns[:, None, :] * ex - np.sin(th)[None, :, None] * Bs[:, None, :] * ey)
    m = grid(G, closed_u=True)
    # per-vertex arc-length parameter stored in UV.y (meters)
    L = np.r_[0, np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))]
    us = np.linspace(0, 1, seg + 1)
    m.UV = np.stack(np.meshgrid(us, L), -1).reshape(-1, 2)
    parts = [m]
    if cap:
        for end, sgn in ((0, -1), (-1, 1)):
            if radii[end] < 1e-6: continue
            c = path[end]
            ring = G[end]
            P = np.vstack([c, ring])
            I = []
            for k in range(seg):
                a, b = 1 + k, 1 + (k + 1) % seg
                I += [0, a, b] if sgn < 0 else [0, b, a]
            cm = Mesh(P, I, N=np.tile(tg[end] * sgn, (seg + 1, 1)), UV=np.tile([0.5, L[end]], (seg + 1, 1)))
            parts.append(cm)
    out = merge(parts)
    return out

def capsule_path(p0, p1, r0, r1, n=8, endcap=4):
    """Helper: path + radii for a limb with rounded ends."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0; L = np.linalg.norm(d); dn = d / L
    pts, rs = [], []
    for k in range(endcap):
        a = (endcap - k) / endcap * np.pi / 2
        pts.append(p0 - dn * r0 * np.sin(a) * 0.9); rs.append(r0 * np.cos(a) + 1e-4)
    for k in range(n + 1):
        t = k / n
        pts.append(p0 + d * t); rs.append(r0 + (r1 - r0) * t)
    for k in range(1, endcap + 1):
        a = k / endcap * np.pi / 2
        pts.append(p1 + dn * r1 * np.sin(a) * 0.9); rs.append(r1 * np.cos(a) + 1e-4)
    return np.array(pts), np.array(rs)

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

def chain_weights(t, bounds, bones, width):
    """Blend weights along a scalar parameter. bounds: k-1 boundaries for k bones."""
    t = np.asarray(t, float)
    k = len(bones)
    s = [np.ones_like(t)] + [smoothstep(b - width, b + width, t) for b in bounds] + [np.zeros_like(t)]
    J = np.zeros((len(t), 4), np.int64); W = np.zeros((len(t), 4))
    ws = np.stack([s[i] - s[i + 1] for i in range(k)], 1)
    order = np.argsort(-ws, axis=1)[:, :4]
    for c in range(min(4, k)):
        J[:, c] = np.array(bones)[order[:, c]]
        W[:, c] = np.take_along_axis(ws, order[:, c:c + 1], 1)[:, 0]
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
    return J, W

# ---------------------------------------------------------------- GLB export
class GLB:
    def __init__(self):
        self.bin = bytearray()
        self.j = {"asset": {"version": "2.0", "generator": "shashlik-forge.py"}, "scene": 0, "scenes": [{"nodes": []}],
                  "nodes": [], "meshes": [], "accessors": [], "bufferViews": [], "materials": [],
                  "textures": [], "images": [], "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
                  "skins": [], "animations": [], "extensionsUsed": ["KHR_mesh_quantization"]}

    def _view(self, data, target=None):
        while len(self.bin) % 4: self.bin += b'\0'
        off = len(self.bin)
        self.bin += data
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target: v["target"] = target
        self.j["bufferViews"].append(v)
        return len(self.j["bufferViews"]) - 1

    def acc(self, arr, ctype, typ, target=None, minmax=False, normalized=False):
        arr = np.ascontiguousarray(arr)
        view = self._view(arr.tobytes(), target)
        count = arr.shape[0]
        a = {"bufferView": view, "componentType": ctype, "count": int(count), "type": typ}
        if normalized: a["normalized"] = True
        if minmax:
            flat = arr.reshape(count, -1)
            a["min"] = [float(x) for x in flat.min(0)]
            a["max"] = [float(x) for x in flat.max(0)]
        self.j["accessors"].append(a)
        return len(self.j["accessors"]) - 1

    def image(self, img, fmt="JPEG", quality=86):
        b = io.BytesIO()
        if fmt == "JPEG": img.convert("RGB").save(b, "JPEG", quality=quality)
        elif fmt == "PNG8": img.quantize(colors=96, method=Image.Quantize.FASTOCTREE).save(b, "PNG", optimize=True); fmt = "PNG"
        else: img.save(b, "PNG", optimize=True)
        v = self._view(b.getvalue())
        self.j["images"].append({"bufferView": v, "mimeType": "image/jpeg" if fmt == "JPEG" else "image/png"})
        self.j["textures"].append({"sampler": 0, "source": len(self.j["images"]) - 1})
        return len(self.j["textures"]) - 1

    def material(self, name, color=(1, 1, 1), alpha=1.0, metal=0.0, rough=0.8, tex=None, emissive=None,
                 mode="OPAQUE", cutoff=0.5, double=False, normal_tex=None, srgb=True):
        c = list(srgb2lin(color[:3])) if srgb else list(color[:3])
        pbr = {"baseColorFactor": [float(x) for x in c] + [float(alpha)], "metallicFactor": float(metal), "roughnessFactor": float(rough)}
        if tex is not None: pbr["baseColorTexture"] = {"index": tex}
        m = {"name": name, "pbrMetallicRoughness": pbr, "doubleSided": bool(double)}
        if emissive is not None: m["emissiveFactor"] = [float(x) for x in srgb2lin(emissive)]
        if normal_tex is not None: m["normalTexture"] = {"index": normal_tex}
        if mode != "OPAQUE": m["alphaMode"] = mode
        if mode == "MASK": m["alphaCutoff"] = cutoff
        self.j["materials"].append(m)
        return len(self.j["materials"]) - 1

    def mesh(self, name, prims):
        out = []
        for (m, mat) in prims:
            if m is None or m.n == 0: continue
            has_tex = 'baseColorTexture' in self.j['materials'][mat]['pbrMetallicRoughness']
            Nq = np.round(np.clip(m.N, -1, 1) * 127).astype(np.int8)
            attrs = {"POSITION": self.acc(m.P.astype(F32), 5126, "VEC3", 34962, minmax=True),
                     "NORMAL": self.acc(Nq, 5120, "VEC3", 34962, normalized=True)}
            if m.UV is not None and has_tex: attrs["TEXCOORD_0"] = self.acc(m.UV.astype(F32), 5126, "VEC2", 34962)
            if m.C is not None:
                c = np.clip(m.C, 0, 1)
                if not getattr(m, 'raw_color', False): c = srgb2lin(c)
                attrs["COLOR_0"] = self.acc(np.round(c * 255).astype(np.uint8), 5121, "VEC3", 34962, normalized=True)
            if m.J is not None:
                W = m.W / np.maximum(m.W.sum(1, keepdims=True), 1e-9)
                Wq = np.round(W * 255).astype(np.int64)
                diff = 255 - Wq.sum(1)
                am = np.argmax(Wq, 1)
                Wq[np.arange(len(Wq)), am] += diff
                attrs["JOINTS_0"] = self.acc(m.J.astype(np.uint8), 5121, "VEC4", 34962)
                attrs["WEIGHTS_0"] = self.acc(Wq.astype(np.uint8), 5121, "VEC4", 34962, normalized=True)
            idx = m.I.astype(np.uint16 if m.n < 65535 else np.uint32)
            ia = self.acc(idx, 5123 if idx.dtype == np.uint16 else 5125, "SCALAR", 34963)
            out.append({"attributes": attrs, "indices": ia, "material": mat})
        self.j["meshes"].append({"name": name, "primitives": out})
        return len(self.j["meshes"]) - 1

    def node(self, name, mesh=None, children=None, t=None, r=None, s=None, skin=None, root=False, extras=None):
        n = {"name": name}
        if mesh is not None: n["mesh"] = mesh
        if children: n["children"] = list(children)
        if t is not None: n["translation"] = [float(x) for x in t]
        if r is not None: n["rotation"] = [float(x) for x in r]
        if s is not None: n["scale"] = [float(x) for x in s]
        if skin is not None: n["skin"] = skin
        if extras: n["extras"] = extras
        self.j["nodes"].append(n)
        k = len(self.j["nodes"]) - 1
        if root: self.j["scenes"][0]["nodes"].append(k)
        return k

    def skin(self, joints, ibms, skeleton):
        a = self.acc(np.asarray(ibms, F32).reshape(-1, 16), 5126, "MAT4")
        self.j["skins"].append({"joints": list(joints), "inverseBindMatrices": a, "skeleton": skeleton})
        return len(self.j["skins"]) - 1

    def animation(self, name, channels):
        samplers, chans = [], []
        cache = {}
        for (node, path, times, values) in channels:
            key = (len(times), float(times[-1]))
            if key not in cache:
                cache[key] = self.acc(np.asarray(times, F32), 5126, "SCALAR", minmax=True)
            ia = cache[key]
            oa = self.acc(np.asarray(values, F32), 5126, "VEC4" if path == "rotation" else "VEC3")
            samplers.append({"input": ia, "output": oa, "interpolation": "LINEAR"})
            chans.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": path}})
        self.j["animations"].append({"name": name, "samplers": samplers, "channels": chans})

    def save(self, path):
        j = {k: v for k, v in self.j.items() if v != [] or k in ("scenes",)}
        while len(self.bin) % 4: self.bin += b'\0'
        j["buffers"] = [{"byteLength": len(self.bin)}]
        js = json.dumps(j, separators=(",", ":")).encode()
        while len(js) % 4: js += b' '
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, total))
            f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack("<II", len(self.bin), 0x004E4942)); f.write(self.bin)
        return total

# ---------------------------------------------------------------- quaternions
def quat_euler(x, y, z):
    """q = Ry * Rx * Rz (apply Z, then X, then Y in parent frame). Returns (x,y,z,w)."""
    def qa(ax, a):
        s = np.sin(a / 2); return np.array([ax[0] * s, ax[1] * s, ax[2] * s, np.cos(a / 2)])
    def mul(a, b):
        ax, ay, az, aw = a; bx, by, bz, bw = b
        return np.array([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                         aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz])
    return mul(mul(qa((0, 1, 0), y), qa((1, 0, 0), x)), qa((0, 0, 1), z))

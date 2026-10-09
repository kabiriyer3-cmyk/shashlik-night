"""Environment + props: mangal, skewers, ingredients, trees, grass, furniture."""
import numpy as np
from meshlib import *

def vcol(m, base, amt=0.08, freq=20, seed=0):
    base = np.asarray(base, float)
    n = fbm(m.P * freq, 3, seed=seed)
    m.C = np.clip(base[None, :] * (1 + amt * n)[:, None], 0, 1)
    return m

# ---------------------------------------------------------------- ground
def ground(R=95.0):
    rs = np.r_[np.linspace(0, 16, 17), np.geomspace(17, R, 26)]
    th = np.linspace(0, 2 * np.pi, 72, endpoint=False)
    Rg, Tg = np.meshgrid(rs, th, indexing='ij')
    X, Z = Rg * np.cos(Tg), Rg * np.sin(Tg)
    p = np.stack([X / 18, Z / 18, np.zeros_like(X)], -1)
    hill = fbm(p, 4, seed=91) * 7 + 3
    Y = smoothstep(16, 45, Rg) * hill + smoothstep(40, R, Rg) * 6
    m = grid(np.stack([X, Y, Z], -1), closed_u=True)
    m.flip()
    m.UV = np.c_[m.P[:, 0], m.P[:, 2]] / 3.0
    r = np.linalg.norm(m.P[:, [0, 2]], axis=1)
    n = fbm(m.P * 0.15, 3, seed=92)
    c = np.ones((m.n, 3)) * (0.92 + 0.12 * n)[:, None]
    far = smoothstep(14, 40, r)[:, None]
    c = c * (1 - far) + far * np.array([0.78, 0.85, 0.72]) * c
    m.C = np.clip(c, 0, 1)
    return m

def ground_height(x, z):
    """Matches ground(): flat inside r<16."""
    return 0.0

def dirt_patch(size=7.5):
    return quad(size, size).t(0, -size / 2, 0).r(x=-np.pi / 2).t(0, 0.012, 0)

# ---------------------------------------------------------------- mangal
MANGAL_TOP = 0.78
def mangal():
    L, D, H = 0.90, 0.32, 0.20
    yb = MANGAL_TOP - H
    th = 0.006
    walls = [box(L, H, th).t(0, yb + H / 2, D / 2), box(L, H, th).t(0, yb + H / 2, -D / 2),
             box(th, H, D).t(L / 2, yb + H / 2, 0), box(th, H, D).t(-L / 2, yb + H / 2, 0),
             box(L, th, D).t(0, yb, 0)]
    body = merge(walls)
    body.UV = np.c_[body.P[:, 0] + body.P[:, 2], body.P[:, 1]] * 2.2
    rim_pts = np.array([(-L / 2, MANGAL_TOP, D / 2), (L / 2, MANGAL_TOP, D / 2), (L / 2, MANGAL_TOP, -D / 2), (-L / 2, MANGAL_TOP, -D / 2), (-L / 2, MANGAL_TOP, D / 2)])
    rims = []
    for k in range(4):
        a, b = rim_pts[k], rim_pts[k + 1]
        rims.append(tube(np.linspace(a, b, 2), 0.0055, seg=6, cap=True))
    # notches (little dark teeth on top of long walls)
    legs = []
    for sx in (1, -1):
        for sz in (1, -1):
            x, z = sx * (L / 2 - 0.015), sz * (D / 2 - 0.015)
            l1 = box(0.035, yb + 0.02, 0.004).t(x, (yb + 0.02) / 2, z + sz * 0.0155)
            l2 = box(0.004, yb + 0.02, 0.035).t(x + sx * 0.0155, (yb + 0.02) / 2, z)
            ft = box(0.05, 0.006, 0.05).t(x + sx * 0.01, 0.003, z + sz * 0.01)
            legs += [l1, l2, ft]
    legm = merge(legs + rims)
    legm.UV = np.c_[legm.P[:, 0] + legm.P[:, 2], legm.P[:, 1]] * 2.2
    holes = []
    for sz in (1, -1):
        for k in range(9):
            x = -0.36 + k * 0.09
            c = cylinder(0.011, 0.011, 0.002, 12, True, 0).r(x=np.pi / 2).t(x, yb + 0.045, sz * (D / 2 + 0.002))
            holes.append(c)
    for sx in (1, -1):
        for k in range(3):
            c = cylinder(0.011, 0.011, 0.002, 12, True, 0).r(z=np.pi / 2).t(sx * (L / 2 + 0.002), yb + 0.045, -0.09 + k * 0.09)
            holes.append(c)
    return merge([body, legm]), merge(holes)

def coals(seed=3):
    rng = np.random.default_rng(seed)
    L, D = 0.86, 0.29
    yb = MANGAL_TOP - 0.20
    parts = []
    for layer in range(2):
        nx, nz = (15, 5) if layer < 1 else (11, 4)
        for i in range(nx):
            for j in range(nz):
                if layer == 2 and rng.random() < 0.35: continue
                x = -L / 2 + (i + 0.5) / nx * L + rng.normal(0, 0.008)
                z = -D / 2 + (j + 0.5) / nz * D + rng.normal(0, 0.008)
                y = yb + 0.02 + layer * 0.03 + rng.normal(0, 0.004)
                a = rng.uniform(0.017, 0.028)
                a *= 1.15
                m = superellipsoid(a, a * rng.uniform(0.6, 0.85), a * rng.uniform(0.8, 1.2), rng.uniform(0.3, 0.6), rng.uniform(0.3, 0.6), 7, 5)
                m.displace(0.004, 90, seed=int(rng.integers(1e6)), octaves=2)
                m.r(rng.uniform(0, 3), rng.uniform(0, 3), rng.uniform(0, 3)).t(x, y, z)
                glow = np.clip(rng.uniform(0.35, 1.0) * (0.75 + 0.5 * fbm(m.P * 70, 2, seed=i * 31 + j)), 0, 1)
                ash = np.clip(0.25 + 0.6 * np.clip(m.N[:, 1], 0, 1) * rng.uniform(0.2, 1.0) + 0.3 * fbm(m.P * 120, 2, seed=j), 0, 1)
                if layer == 1: ash = np.clip(ash + 0.2, 0, 1)
                m.C = np.c_[glow, ash, np.zeros(m.n)]
                parts.append(m)
    bed = box(L, 0.004, D).t(0, yb + 0.006, 0)
    bed.C = np.tile([0.6, 0.6, 0], (bed.n, 1))
    parts.append(bed)
    out = merge(parts)
    out.raw_color = True
    return out

# ---------------------------------------------------------------- skewer + ingredients
def skewer():
    blade = box(0.0026, 0.011, 0.56).t(0, 0, 0.02)
    P = blade.P
    tip = P[:, 2] < -0.2
    P[tip, 1] *= 0.0
    P[tip, 0] *= 0.3
    blade.weld_normals() if False else None
    neck = box(0.011, 0.0026, 0.03).t(0, 0, 0.315)
    ring = torus(0.02, 0.0032, 22, 6).r(z=np.pi / 2).t(0, 0, 0.352)
    return merge([blade, neck, ring])

RAW = {'pork': (0.74, 0.31, 0.29), 'chicken': (0.93, 0.74, 0.64), 'lamb': (0.62, 0.27, 0.24)}

def chunk_pork(seed, res=(12, 9)):
    rng = np.random.default_rng(seed)
    a, b, c = rng.uniform(0.018, 0.024, 3)
    m = superellipsoid(a, b, c, rng.uniform(0.45, 0.65), rng.uniform(0.45, 0.65), *res)
    m.displace(0.0035, 70, seed=seed)
    m.r(rng.uniform(-0.3, 0.3), rng.uniform(0, 6.28), rng.uniform(-0.3, 0.3))
    base = np.array(RAW['pork'])
    n = fbm(m.P * 60 + seed, 3, seed=seed)
    col = base[None, :] * (1 + 0.12 * n[:, None])
    fat = smoothstep(0.15, 0.35, fbm(m.P * np.array([30, 140, 30]) + seed * 3, 2, seed=seed + 1))
    col = col * (1 - fat[:, None]) + np.array([0.94, 0.85, 0.77])[None, :] * fat[:, None]
    spice = rng.random(m.n) < 0.05
    col[spice] = np.array([0.30, 0.16, 0.08])
    m.C = np.clip(col, 0, 1)
    return m

def chunk_chicken(seed, res=(12, 9)):
    rng = np.random.default_rng(seed)
    a, b, c = rng.uniform(0.018, 0.024), rng.uniform(0.015, 0.02), rng.uniform(0.018, 0.025)
    m = superellipsoid(a, b, c, 0.75, 0.7, *res)
    m.displace(0.004, 50, seed=seed)
    m.r(rng.uniform(-0.4, 0.4), rng.uniform(0, 6.28), 0)
    base = np.array(RAW['chicken'])
    n = fbm(m.P * 50, 3, seed=seed)
    col = base[None, :] * (1 + 0.07 * n[:, None])
    skin = smoothstep(0.1, 0.3, fbm(m.P * 40 + 5, 2, seed=seed + 2))
    col = col * (1 - skin[:, None]) + np.array([0.96, 0.86, 0.62])[None, :] * skin[:, None]
    spice = rng.random(m.n) < 0.06
    col[spice] = np.array([0.75, 0.30, 0.10])  # paprika
    m.C = np.clip(col, 0, 1)
    return m

def lyulya(seed):
    rng = np.random.default_rng(seed)
    zs = np.linspace(-0.12, 0.12, 20)
    rr = 0.021 * np.clip(np.sqrt(1 - (zs / 0.125) ** 6), 0.15, 1) + 0.001
    m = tube(np.stack([np.zeros_like(zs), np.zeros_like(zs), zs], 1), rr, seg=14, ref=(1, 0, 0))
    m.displace(0.0028, 90, seed=seed)
    base = np.array(RAW['lamb'])
    n = fbm(m.P * 90, 3, seed=seed)
    col = base[None, :] * (1 + 0.15 * n[:, None])
    herb = rng.random(m.n) < 0.06
    col[herb] = np.array([0.22, 0.42, 0.14])
    fat = rng.random(m.n) < 0.05
    col[fat] = np.array([0.92, 0.82, 0.75])
    m.C = np.clip(col, 0, 1)
    return m

def onion(seed):
    rng = np.random.default_rng(seed)
    arc = rng.uniform(2.0, 3.4)
    parts = []
    for R in (0.012, 0.017, 0.022):
        t = torus(R, 0.0028, 14, 6, arc=arc).r(x=np.pi / 2)
        parts.append(t)
    m = merge(parts).r(z=rng.uniform(0, 6.28)).t(0, 0, 0)
    m.color((0.92, 0.86, 0.9))
    m.C[:, 0] *= 0.98
    return m

def pepper(seed, red=True):
    rng = np.random.default_rng(seed)
    m = superellipsoid(0.024, 0.022, 0.0045, 0.6, 0.6, 12, 8)
    m.P[:, 2] += 9 * m.P[:, 0] ** 2
    m.weld_normals()
    m.r(z=rng.uniform(0, 6.28))
    m.color((0.80, 0.08, 0.05) if red else (0.20, 0.55, 0.10))
    return m

def tomato(seed):
    m = sphere(0.019, 14, 10, 1, 0.88, 1)
    m.color((0.86, 0.14, 0.07))
    top = m.P[:, 1] > 0.0162
    m.C[top] = (0.25, 0.45, 0.12)
    return m

def mushroom(seed):
    cap = sphere(0.02, 14, 10).select_faces(lambda P: P[:, 1] > -0.002).s(1, 0.7, 1)
    under = cylinder(0.02, 0.02, 0.001, 14, True, -0.001)
    stem = cylinder(0.008, 0.009, 0.02, 10, True, -0.02)
    m = merge([cap.color((0.86, 0.78, 0.66)), under.color((0.75, 0.62, 0.52)), stem.color((0.93, 0.9, 0.84))])
    return m.r(z=np.pi / 2)

def zucchini(seed):
    m = cylinder(0.02, 0.02, 0.012, 16, True, -0.006).r(x=np.pi / 2)
    r = np.linalg.norm(m.P[:, :2], axis=1)
    m.C = np.where((r > 0.017)[:, None], np.array([0.18, 0.38, 0.12])[None, :], np.array([0.88, 0.9, 0.7])[None, :])
    return m

# ---------------------------------------------------------------- containers
def enamel_bucket(fill='pork'):
    prof = [(0, 0.0), (0.11, 0.0), (0.115, 0.006), (0.145, 0.26), (0.152, 0.266), (0.142, 0.268), (0.137, 0.262), (0.107, 0.01), (0, 0.01)]
    b = lathe(prof, 28)
    b.C = np.where((b.P[:, 1] > 0.248)[:, None], np.array([0.12, 0.22, 0.55])[None, :], np.array([0.94, 0.94, 0.91])[None, :])
    # blue flower decal (simple dots)
    ang = np.arctan2(b.P[:, 2], b.P[:, 0])
    dec = (np.abs(ang - 1.57) < 0.25) & (np.abs(b.P[:, 1] - 0.14) < 0.035) & (np.linalg.norm(b.P[:, [0, 2]], axis=1) > 0.125)
    b.C[dec] = (0.15, 0.3, 0.7)
    handle = tube(np.array([(0.15, 0.24, 0), (0.12, 0.36, 0), (0, 0.42, 0), (-0.12, 0.36, 0), (-0.15, 0.24, 0)]), 0.0025, seg=6).color((0.4, 0.4, 0.42))
    heap = [cylinder(0.135, 0.135, 0.002, 24, True, 0.19).color((0.45, 0.22, 0.13))]
    rng = np.random.default_rng(5)
    for k in range(36):
        r = 0.11 * np.sqrt(rng.random()); a = rng.uniform(0, 6.28)
        y = 0.2 + 0.05 * (1 - r / 0.11) + rng.uniform(0, 0.02)
        ch = (chunk_pork(500 + k, (8, 6)) if fill == 'pork' else chunk_chicken(600 + k, (8, 6))).r(rng.uniform(0, 6), 0, rng.uniform(0, 6))
        heap.append(ch.t(np.cos(a) * r, y, np.sin(a) * r))
    for k in range(6):
        r = 0.09 * np.sqrt(rng.random()); a = rng.uniform(0, 6.28)
        heap.append(onion(700 + k).r(np.pi / 2 * rng.random(), 0, 0).t(np.cos(a) * r, 0.25, np.sin(a) * r))
    return merge([b, handle] + heap)

def enamel_bowl(fill='chicken'):
    prof = [(0, 0.0), (0.12, 0.0), (0.2, 0.095), (0.212, 0.1), (0.2, 0.102), (0.19, 0.098), (0.115, 0.008), (0, 0.008)]
    b = lathe(prof, 32)
    b.C = np.where((b.P[:, 1] > 0.093)[:, None], np.array([0.7, 0.12, 0.1])[None, :], np.array([0.95, 0.95, 0.92])[None, :])
    rng = np.random.default_rng(8)
    heap = []
    for k in range(34):
        r = 0.15 * np.sqrt(rng.random()); a = rng.uniform(0, 6.28)
        y = 0.04 + 0.05 * (1 - r / 0.15) + rng.uniform(0, 0.02)
        f = chunk_chicken(800 + k, (8, 6)) if fill == 'chicken' else lyulya(820 + k)
        heap.append(f.r(rng.uniform(0, 6), 0, rng.uniform(0, 6)).t(np.cos(a) * r, y + 0.02, np.sin(a) * r))
    return merge([b] + heap)

def lamb_plate():
    plate = lathe([(0, 0), (0.12, 0), (0.16, 0.02), (0.165, 0.022), (0.158, 0.024), (0.115, 0.006), (0, 0.006)], 28).color((0.95, 0.95, 0.93))
    rng = np.random.default_rng(12)
    parts = [plate]
    for k in range(4):
        ly = lyulya(900 + k).r(0, k * 0.4 + 0.1, 0).t(rng.uniform(-0.04, 0.04), 0.03 + (k // 2) * 0.03, -0.05 + k * 0.035)
        parts.append(ly)
    for k in range(8):
        parts.append(superellipsoid(0.01, 0.002, 0.02, 0.8, 0.8, 6, 4).r(y=rng.uniform(0, 6)).t(rng.uniform(-0.12, 0.12), 0.01, rng.uniform(-0.12, 0.12)).color((0.25, 0.5, 0.18)))
    return merge(parts)

def serving_stool():
    seat, top = log_seat(0.45, 0.17)
    seat.r(z=-np.pi / 2); seat.P[:, 1] -= seat.P[:, 1].min(); seat.P[:, 0] -= seat.P[:, 0].mean(); seat.P[:, 2] -= seat.P[:, 2].mean()
    top.r(z=-np.pi / 2)
    top.P[:, 0] -= top.P[:, 0].mean(); top.P[:, 2] -= top.P[:, 2].mean(); top.P[:, 1] = 0.4495
    top.UV = np.c_[top.P[:, 0] / 0.34 + 0.5, top.P[:, 2] / 0.34 + 0.5]; top.N[:] = (0, 1, 0)
    plate = lathe([(0, 0), (0.16, 0), (0.21, 0.025), (0.215, 0.028), (0.207, 0.03), (0.155, 0.007), (0, 0.007)], 32).t(0, 0.45, 0)
    plate.C = np.where((plate.P[:, 1] > 0.471)[:, None], np.array([0.12, 0.22, 0.55])[None, :], np.array([0.95, 0.95, 0.92])[None, :])
    return seat, top, plate

def veg_crate():
    wood = []
    for y in (0.02, 0.08):
        for sz in (1, -1):
            wood.append(box(0.42, 0.04, 0.012).t(0, y + 0.02, sz * 0.14))
        for sx in (1, -1):
            wood.append(box(0.012, 0.04, 0.28).t(sx * 0.21, y + 0.02, 0))
    wood.append(box(0.42, 0.01, 0.28).t(0, 0.005, 0))
    for sx in (1, -1):
        for sz in (1, -1):
            wood.append(box(0.02, 0.12, 0.02).t(sx * 0.2, 0.06, sz * 0.13))
    w = vcol(merge(wood), (0.72, 0.58, 0.40), 0.12, 30)
    rng = np.random.default_rng(14)
    items = []
    for k in range(26):
        x, z = rng.uniform(-0.17, 0.17), rng.uniform(-0.11, 0.11)
        y = 0.05 + rng.uniform(0, 0.06)
        kind = k % 4
        if kind == 0: it = sphere(0.035, 12, 8, 1, 0.9, 1).color((0.85, 0.12, 0.06))
        elif kind == 1:
            it = superellipsoid(0.035, 0.045, 0.035, 0.8, 0.9, 12, 8).color((0.80, 0.08, 0.05) if k % 8 == 1 else (0.2, 0.55, 0.1))
        elif kind == 2:
            it = sphere(0.033, 12, 8, 1, 0.95, 1)
            it.P[:, 1] += np.clip(it.P[:, 1], 0, 1) ** 2 * 6
            it.weld_normals(); it.color((0.72, 0.48, 0.22))
        else: it = mushroom(k).s(1.6).r(z=-np.pi / 2)
        items.append(it.r(rng.uniform(0, 1), rng.uniform(0, 6), 0).t(x, y, z))
    return merge([w] + items)

# ---------------------------------------------------------------- furniture & props
def plank_top(w, d, y, th=0.035, n=4):
    planks = []
    for k in range(n):
        z = -d / 2 + (k + 0.5) * d / n
        planks.append(box(w, th, d / n - 0.008).t(0, y - th / 2, z))
    m = merge(planks)
    m.UV = np.c_[m.P[:, 0] / w, (m.P[:, 2] + d / 2) / d]
    return m

def prep_table():
    top = plank_top(0.95, 0.52, 0.72, 0.03, 4)
    legs = []
    for sx in (1, -1):
        for sz in (1, -1):
            legs.append(cylinder(0.012, 0.012, 0.69, 8, True, 0).r(z=sx * 0.06, x=-sz * 0.04).t(sx * 0.40, 0, sz * 0.21))
        legs.append(cylinder(0.008, 0.008, 0.44, 6, True, -0.22).r(x=np.pi / 2).t(sx * 0.41, 0.25, 0))
    return top, merge(legs).color((0.62, 0.63, 0.66))

def picnic_table():
    top = plank_top(1.7, 0.85, 0.75, 0.04, 5)
    wood = []
    for sx in (1, -1):
        for sz in (1, -1):
            wood.append(box(0.06, 0.82, 0.05).r(x=sz * 0.28).t(sx * 0.7, 0.36, sz * 0.18))
        wood.append(box(0.06, 0.05, 0.75).t(sx * 0.7, 0.68, 0))
    wood.append(box(1.3, 0.05, 0.05).t(0, 0.25, 0))
    w = merge(wood)
    w.UV = np.c_[w.P[:, 0] + w.P[:, 2], w.P[:, 1]]
    rng = np.random.default_rng(21)
    props = []
    Y = 0.75
    for (x, z) in ((-0.55, 0.22), (-0.15, 0.25), (0.3, -0.22), (0.6, 0.2)):
        props.append(lathe([(0, 0), (0.08, 0), (0.12, 0.018), (0.125, 0.02), (0.118, 0.022), (0.075, 0.005), (0, 0.005)], 24).t(x, Y, z).color((0.96, 0.96, 0.94)))
    # bread loaf + slices
    loaf = superellipsoid(0.13, 0.06, 0.07, 0.6, 0.6, 16, 10).t(0, Y + 0.05, 0)
    vcol(loaf, (0.62, 0.36, 0.16), 0.1, 30)
    loaf.C[loaf.P[:, 1] > Y + 0.09] *= 1.25
    props.append(loaf.r(y=0.4).t(-0.25, 0, -0.18) if False else loaf.t(-0.3, 0, -0.18))
    for k in range(4):
        sl = superellipsoid(0.05, 0.045, 0.008, 0.7, 0.5, 12, 6).r(x=-1.35).t(-0.05 + k * 0.035, Y + 0.012 + k * 0.004, -0.2)
        props.append(vcol(sl, (0.92, 0.82, 0.62), 0.05))
    for k in range(5):
        cu = tube(*capsule_path((0, 0, -0.08), (0, 0, 0.08), 0.018, 0.017, 6, 3), seg=10)
        props.append(vcol(cu.r(y=rng.uniform(-0.5, 0.5)).t(0.05 + k * 0.035, Y + 0.018, 0.0 + k * 0.01), (0.15, 0.38, 0.12), 0.15, 40))
    for k in range(4):
        props.append(tomato(k).s(1.9).t(0.30 + k * 0.05, Y + 0.035, 0.12 - k * 0.02))
    for k in range(9):
        props.append(tube(np.array([(0, 0, 0), (0.03, 0.01, 0.1), (0.05, 0.03, 0.16)]), [0.003, 0.002, 0.004], seg=4).r(y=k * 0.15).t(-0.6 + k * 0.01, Y + 0.004, -0.1).color((0.2, 0.45, 0.12)))
    # bottles
    def bottle(col, h=0.3):
        prof = [(0, 0), (0.036, 0), (0.038, 0.01), (0.038, h * 0.62), (0.03, h * 0.72), (0.014, h * 0.82), (0.013, h * 0.98), (0.015, h), (0, h)]
        return lathe(prof, 18).color(col)
    glass = [bottle((0.10, 0.25, 0.10)).t(0.1, Y, -0.25), bottle((0.35, 0.18, 0.06), 0.33).t(0.18, Y, -0.3),
             bottle((0.9, 0.12, 0.08), 0.22).t(-0.7, Y, 0.0)]
    for (x, z) in ((-0.45, 0.32), (0.05, 0.33), (0.48, -0.32), (0.75, 0.0)):
        props.append(lathe([(0, 0), (0.028, 0), (0.038, 0.1), (0.036, 0.1), (0.026, 0.004), (0, 0.004)], 16).t(x, Y, z).color((0.96, 0.96, 0.96)))
    # lantern
    lan_frame = merge([cylinder(0.05, 0.05, 0.02, 12, True, 0), cylinder(0.04, 0.02, 0.04, 12, True, 0.18),
                       torus(0.025, 0.003, 12, 4).r(x=np.pi / 2).t(0, 0.24, 0)]).t(0.0, Y, 0.05).color((0.15, 0.15, 0.15))
    lan_glass = cylinder(0.04, 0.04, 0.16, 14, True, 0.02).t(0.0, Y, 0.05)
    return top, w, merge(props), merge(glass), lan_frame, lan_glass

def camp_chair(color):
    tubes = []
    T_ = lambda a, b: tube(np.array([a, b]), 0.011, seg=6)
    for sx in (1, -1):
        tubes += [T_((sx * 0.26, 0, 0.26), (sx * 0.26, 0.62, -0.05)), T_((sx * 0.26, 0, -0.24), (sx * 0.26, 0.62, 0.2)),
                  T_((sx * 0.26, 0.62, 0.25), (sx * 0.26, 0.62, -0.22)), T_((sx * 0.26, 0.4, -0.22), (sx * 0.27, 1.0, -0.36))]
    tubes += [T_((-0.26, 0.42, 0.22), (0.26, 0.42, 0.22)), T_((-0.26, 0.42, -0.2), (0.26, 0.42, -0.2)), T_((-0.27, 1.0, -0.36), (0.27, 1.0, -0.36))]
    frame = merge(tubes).color((0.25, 0.26, 0.28))
    us = np.linspace(-0.25, 0.25, 10); vs = np.linspace(0, 1, 10)
    U, V = np.meshgrid(us, vs, indexing='ij')
    seat = np.stack([U, 0.43 - 0.05 * np.sin(V * np.pi) - 0.02 * np.cos(U / 0.25 * np.pi / 2) * 0, -0.2 + V * 0.42], -1)
    seatm = grid(seat.transpose(1, 0, 2))
    back = np.stack([U, 0.44 + V * 0.56, -0.21 - V * 0.15 + 0.04 * np.sin(V * np.pi)], -1)
    backm = grid(back.transpose(1, 0, 2))
    fab = merge([seatm, seatm.copy().flip().t(0, -0.004, 0), backm, backm.copy().flip().t(0, 0, -0.004)])
    vcol(fab, color, 0.1, 25)
    arms = merge([box(0.06, 0.02, 0.4).t(sx * 0.26, 0.635, 0.02) for sx in (1, -1)]).color((0.12, 0.12, 0.12))
    return merge([frame, arms]), fab

def log_seat(length=1.3, r=0.215):
    side = lathe([(r, -length / 2), (r, length / 2)], 18).r(z=np.pi / 2).t(0, r, 0)
    side.displace(0.012, 6, seed=3)
    side.UV = np.c_[np.arctan2(side.P[:, 2], side.P[:, 1] - r) / np.pi * 2, side.P[:, 0] * 1.2]
    caps = []
    for sx in (1, -1):
        c = cylinder(r * 0.97, r * 0.97, 0.001, 18, True, 0).r(z=-sx * np.pi / 2).t(sx * length / 2, r, 0)
        caps.append(c)
    cm = merge(caps)
    cm.UV = np.c_[cm.P[:, 2] / (2 * r) + 0.5, (cm.P[:, 1] - r) / (2 * r) + 0.5]
    return side, cm

def firewood():
    rng = np.random.default_rng(31)
    sides, ends = [], []
    rows = [(5, 0.0), (4, 0.09), (3, 0.18), (2, 0.27)]
    for (n, y) in rows:
        for k in range(n):
            x = (k - (n - 1) / 2) * 0.1
            r = rng.uniform(0.04, 0.05); L = rng.uniform(0.38, 0.45)
            s, e = log_seat(L, r)
            s.r(y=np.pi / 2 + rng.normal(0, 0.06)); e.r(y=np.pi / 2)
            s.t(x, y, 0); e.t(x, y, 0)
            sides.append(s); ends.append(e)
    return merge(sides), merge(ends)

def stump_axe():
    side, top = log_seat(0.42, 0.26)
    side.r(z=-np.pi / 2).t(0, 0.21 - 0.26, 0)
    side.P[:, 1] -= side.P[:, 1].min(); side.P[:, 0] -= side.P[:, 0].mean(); side.P[:, 2] -= side.P[:, 2].mean()
    top.r(z=-np.pi / 2)
    top.P[:, 1] = 0.42 - 0.0005 + (top.P[:, 1] - top.P[:, 1].mean()) * 0
    sp = top.P.copy()
    top.P[:, 0], top.P[:, 2] = sp[:, 0] - sp[:, 0].mean(), sp[:, 2] - sp[:, 2].mean()
    top.UV = np.c_[top.P[:, 0] / 0.5 + 0.5, top.P[:, 2] / 0.5 + 0.5]
    top.N[:] = (0, 1, 0)
    handle = tube(np.array([(0.02, 0.43, 0.0), (0.12, 0.62, 0.04), (0.24, 0.80, 0.07)]), [0.016, 0.015, 0.018], seg=8)
    vcol(handle, (0.62, 0.45, 0.25), 0.08)
    head = box(0.13, 0.03, 0.018).r(z=-1.05).t(0.03, 0.42, 0.0)
    head.color((0.25, 0.25, 0.27))
    return side, top, handle, head

def charcoal_bag():
    b = box(0.34, 0.48, 0.16).t(0, 0.24, 0)
    b.UV = np.c_[(b.P[:, 0] + 0.17) / 0.34, b.P[:, 1] / 0.48]
    lumps = []
    rng = np.random.default_rng(41)
    for k in range(10):
        m = superellipsoid(0.03, 0.022, 0.03, 0.4, 0.4, 8, 6).r(rng.uniform(0, 3), rng.uniform(0, 3), 0).t(rng.uniform(-0.12, 0.12), 0.48 + rng.uniform(0, 0.02), rng.uniform(-0.05, 0.05))
        lumps.append(m)
    fold = box(0.36, 0.03, 0.17).t(0, 0.47, 0)
    return b, vcol(merge(lumps), (0.06, 0.055, 0.05), 0.2, 50), vcol(fold, (0.6, 0.46, 0.3), 0.05)

def trash_bag():
    m = superellipsoid(0.2, 0.26, 0.18, 0.8, 0.8, 18, 12).t(0, 0.25, 0)
    m.displace(0.03, 6, seed=4)
    knot = sphere(0.04, 10, 6).t(0, 0.53, 0)
    tie = merge([cylinder(0.02, 0.05, 0.08, 10, True, 0.47)])
    return merge([m, knot, tie]).color((0.05, 0.05, 0.06))

def tent():
    d = superellipsoid(1.15, 1.1, 1.35, 0.85, 0.9, 30, 18).select_faces(lambda P: P[:, 1] > -0.02)
    d.P[:, 1] = np.maximum(d.P[:, 1], 0)
    d.weld_normals()
    c = np.tile([0.85, 0.42, 0.10], (d.n, 1))
    fly = np.abs(d.P[:, 1] - 0.75) < 0.06
    c[fly] = (0.25, 0.25, 0.28)
    door = (d.P[:, 2] > 0.6) & (np.abs(d.P[:, 0]) < 0.45) & (d.P[:, 1] < 0.85)
    c[door] = (0.18, 0.16, 0.15)
    d.C = c * (1 + 0.04 * fbm(d.P * 8, 2)[:, None])
    poles = []
    for a in (0.6, -0.6):
        ts = np.linspace(-np.pi / 2, np.pi / 2, 18)
        pts = np.stack([np.sin(ts) * 1.17, np.cos(ts) * 1.12, np.sin(ts) * 1.37 * np.tan(a) * 0.6], 1)
        poles.append(tube(pts, 0.012, seg=6))
    return d, merge(poles).color((0.15, 0.15, 0.16))

def guitar():
    c1, R1 = np.array([0.0, 0.0]), 0.19
    c2, R2 = np.array([0.25, 0.0]), 0.145
    cc = np.array([0.12, 0.0])
    th = np.linspace(0, 2 * np.pi, 64, endpoint=False)
    rs = []
    for t in th:
        d = np.array([np.cos(t), np.sin(t)]); best = 0
        for (o, R) in ((c1, R1), (c2, R2)):
            oc = cc - o; b = d @ oc; disc = b * b - (oc @ oc - R * R)
            if disc >= 0: best = max(best, -b + np.sqrt(disc))
        rs.append(best)
    rs = np.array(rs)
    rs = np.convolve(np.r_[rs[-2:], rs, rs[:2]], np.ones(5) / 5, 'valid')
    pts = cc + np.c_[np.cos(th) * rs, np.sin(th) * rs]
    hz = 0.05
    P, I = [], []
    n = len(pts)
    P.append((cc[0], cc[1], hz)); P += [(x, y, hz) for x, y in pts]
    for k in range(n): I += [0, 1 + k, 1 + (k + 1) % n]
    front = Mesh(P, I, N=[(0, 0, 1)] * (n + 1))
    back = front.copy().t(0, 0, -2 * hz).flip()
    G = np.stack([np.c_[pts, np.full(n, -hz)], np.c_[pts, np.full(n, hz)]], 0)
    side = grid(G, closed_u=True)
    if np.mean(np.sum(side.N[:, :2] * (side.P[:, :2] - cc), 1)) < 0: side.flip()
    front.color((0.86, 0.66, 0.38)); back.color((0.42, 0.2, 0.09)); side.color((0.42, 0.2, 0.09))
    hole = cylinder(0.045, 0.045, 0.001, 24, True, 0).r(x=np.pi / 2).t(0.17, 0, hz + 0.001).color((0.04, 0.03, 0.02))
    rose = torus(0.05, 0.004, 24, 4).r(x=np.pi / 2).t(0.17, 0, hz + 0.0012).color((0.2, 0.1, 0.05))
    bridge = box(0.02, 0.1, 0.008).t(-0.06, 0, hz + 0.004).color((0.1, 0.06, 0.03))
    neck = box(0.5, 0.05, 0.025).t(0.62, 0, 0.03).color((0.45, 0.25, 0.12))
    fret = box(0.48, 0.052, 0.006).t(0.6, 0, 0.046).color((0.12, 0.08, 0.06))
    headst = box(0.17, 0.07, 0.018).t(0.94, 0, 0.03).color((0.2, 0.1, 0.05))
    strings = [box(1.0, 0.0012, 0.0012).t(0.44, -0.02 + k * 0.008, 0.052) for k in range(6)]
    metal = merge(strings + [cylinder(0.005, 0.005, 0.03, 6, True, 0).r(x=np.pi / 2).t(0.9 + (k % 3) * 0.045, (1 if k < 3 else -1) * 0.045, 0.03) for k in range(6)]).color((0.8, 0.8, 0.75))
    return merge([front, back, side, hole, rose, bridge, neck, fret, headst]), metal

def cup():
    return lathe([(0, 0), (0.028, 0), (0.038, 0.1), (0.036, 0.1), (0.026, 0.004), (0, 0.004)], 16).color((0.96, 0.96, 0.96))

def mug():
    m = lathe([(0, 0), (0.04, 0), (0.042, 0.09), (0.044, 0.095), (0.038, 0.095), (0.036, 0.006), (0, 0.006)], 18)
    m.C = np.where((m.P[:, 1] > 0.088)[:, None], np.array([0.1, 0.2, 0.5])[None, :], np.array([0.94, 0.94, 0.9])[None, :])
    h = torus(0.025, 0.006, 12, 6, arc=np.pi * 1.2).r(x=np.pi / 2, z=-np.pi * 0.6).t(0.042, 0.05, 0).color((0.94, 0.94, 0.9))
    tea = cylinder(0.036, 0.036, 0.001, 16, True, 0.08).color((0.35, 0.15, 0.05))
    return merge([m, h, tea])

def fp_arm():
    fist = superellipsoid(0.042, 0.038, 0.048, 0.55, 0.6, 14, 10)
    knuckles = tube(np.array([(-0.032, 0.022, -0.03), (0, 0.03, -0.045), (0.032, 0.02, -0.03)]), 0.017, seg=8)
    thumb = tube(*capsule_path((-0.03, -0.01, -0.02), (-0.015, 0.012, -0.05), 0.014, 0.012, 4, 3), seg=8)
    hand = vcol(merge([fist, knuckles, thumb]), (0.88, 0.68, 0.55), 0.04, 30)
    path = np.array([(0.0, -0.005, 0.03), (0.02, -0.04, 0.16), (0.05, -0.09, 0.32), (0.07, -0.13, 0.5)])
    wrist = tube(path[:2], [0.035, 0.038], seg=12)
    vcol(wrist, (0.88, 0.68, 0.55), 0.03)
    sleeve = tube(path[1:], [0.05, 0.056, 0.06], seg=14)
    sleeve.UV = np.c_[sleeve.UV[:, 0] * 2, sleeve.UV[:, 1] * 4]
    cuff = tube(path[1:3] * [1, 1, 1], [0.052, 0.05], seg=14)
    return merge([hand, wrist]), sleeve

def cardboard():
    b = box(0.26, 0.2, 0.005).t(0, 0.1, 0)
    b.C = np.tile([0.66, 0.5, 0.32], (b.n, 1))
    return b

def spray_bottle():
    body = lathe([(0, 0), (0.034, 0), (0.036, 0.01), (0.036, 0.13), (0.02, 0.16), (0.016, 0.17), (0, 0.17)], 16).color((0.2, 0.45, 0.85))
    headm = merge([box(0.03, 0.04, 0.07).t(0, 0.19, 0.01), cylinder(0.006, 0.006, 0.02, 8, True, 0).r(x=np.pi / 2).t(0, 0.2, 0.045),
                   box(0.012, 0.04, 0.012).r(x=0.3).t(0, 0.16, 0.035)]).color((0.94, 0.94, 0.94))
    return merge([body, headm])

def rock(seed):
    rng = np.random.default_rng(seed)
    m = superellipsoid(1, 0.6, 0.8, 0.8, 0.8, 14, 10)
    m.displace(0.25, 1.5, seed=seed, octaves=4)
    return vcol(m.s(rng.uniform(0.2, 0.5)), (0.45, 0.44, 0.42), 0.2, 4)

# ---------------------------------------------------------------- vegetation
def leaf_cards(centers, sizes, crown_c, rng, normal_bias=0.75):
    quads = []
    for c, s in zip(centers, sizes):
        q = quad(s, s).t(0, -s / 2, 0).r(rng.uniform(0, 6.28), rng.uniform(0, 6.28), rng.uniform(0, 6.28)).t(*c)
        out = q.P - crown_c
        out /= np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-6)
        nrm = q.N * (1 - normal_bias) + out * normal_bias
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
        q.N = nrm
        back = q.copy(); back.I = back.I.reshape(-1, 3)[:, [0, 2, 1]].ravel()
        quads += [q, back]
    return merge(quads)

def bez(p0, p1, p2, n):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2

def birch(seed, H=11.0):
    rng = np.random.default_rng(seed)
    n = 22
    t = np.linspace(0, 1, n)
    lean = rng.normal(0, 0.035, 2)
    path = np.stack([lean[0] * H * t ** 1.5 + 0.06 * np.sin(t * 5 + seed), H * t, lean[1] * H * t ** 1.5 + 0.06 * np.cos(t * 4 + seed)], 1)
    r0 = rng.uniform(0.12, 0.17)
    rad = r0 * (1 - t) ** 0.9 + 0.012 + 0.07 * np.exp(-t * H * 2.5)
    trunk = tube(path, rad, seg=10, cap=False)
    trunk.UV = np.c_[trunk.UV[:, 0] * 2, trunk.UV[:, 1] / 1.1]
    yv = trunk.P[:, 1]
    dark = 0.35 + 0.65 * smoothstep(0.0, 1.8, yv + 0.4 * fbm(trunk.P * 3, 2, seed=seed))
    trunk.C = np.tile(dark[:, None], (1, 3))
    branches, centers, sizes = [], [], []
    nb = 15
    crown_c = np.array([path[-1, 0] * 0.7, H * 0.72, path[-1, 2] * 0.7])
    for i in range(nb):
        hb = H * rng.uniform(0.35, 0.93)
        k = np.interp(hb, path[:, 1], np.arange(n))
        p0 = np.array([np.interp(k, np.arange(n), path[:, j]) for j in range(3)])
        phi = i * 2.39996 + rng.normal(0, 0.3)
        out = np.array([np.cos(phi), 0, np.sin(phi)])
        L = rng.uniform(1.6, 3.2) * (1.0 - 0.45 * (hb / H - 0.35) / 0.6)
        el = rng.uniform(0.6, 1.0)
        p1 = p0 + out * L * 0.45 + np.array([0, 1, 0]) * L * 0.55 * el
        p2 = p0 + out * L * 0.95 + np.array([0, 1, 0]) * L * (0.15 * el - 0.05)
        pts = bez(p0, p1, p2, 6)
        br = tube(pts, np.linspace(0.04, 0.008, 6) * (r0 / 0.15), seg=5, cap=False)
        br.UV = np.c_[br.UV[:, 0], br.UV[:, 1] / 1.1]
        br.C = np.tile([0.5, 0.46, 0.42], (br.n, 1))
        branches.append(br)
        for tt in np.linspace(0.3, 1.0, 14):
            idx = tt * 5
            a = int(min(idx, 4)); f = idx - a
            c = pts[a] * (1 - f) + pts[a + 1] * f
            c = c + rng.normal(0, 0.3, 3) + np.array([0, -0.25 * tt, 0])
            centers.append(c); sizes.append(rng.uniform(0.6, 1.0))
    for k in range(22):
        c = path[-1] + rng.normal(0, 0.55, 3) + np.array([0, -0.4, 0])
        centers.append(c); sizes.append(rng.uniform(0.55, 0.85))
    leaves = leaf_cards(np.array(centers), sizes, crown_c, rng)
    leaves.C = None
    wood = merge([trunk] + branches)
    return wood, leaves

def spruce(seed, H=12.0):
    rng = np.random.default_rng(seed)
    n = 14
    t = np.linspace(0, 1, n)
    path = np.stack([np.full(n, 0.0) + rng.normal(0, 0.02) * t * H, H * t, np.zeros(n)], 1)
    rad = 0.22 * (1 - t) + 0.015 + 0.05 * np.exp(-t * H * 2)
    trunk = tube(path, rad, seg=8, cap=False)
    trunk.UV = np.c_[trunk.UV[:, 0] * 2, trunk.UV[:, 1] / 1.5]
    cards, brs = [], []
    y = 0.9
    crown = np.array([0, H * 0.45, 0])
    while y < H - 0.4:
        nbr = rng.integers(6, 8)
        off = rng.uniform(0, 6.28)
        frac = (H - y) / H
        for b in range(nbr):
            phi = off + b / nbr * 2 * np.pi + rng.normal(0, 0.15)
            out = np.array([np.cos(phi), 0, np.sin(phi)])
            L = frac * 2.7 + 0.35 + rng.normal(0, 0.12)
            p0 = np.array([0, y, 0])
            pts = bez(p0, p0 + out * L * 0.5 + [0, -L * 0.18, 0], p0 + out * L + [0, -L * 0.05, 0], 4)
            if L > 0.9:
                brs.append(tube(pts, np.linspace(0.03, 0.006, 4), seg=4, cap=False))
            side = np.cross([0, 1, 0], out)
            for c in range(2):
                dirv = (pts[-1] - pts[0]); dirv /= np.linalg.norm(dirv)
                tilt = (c - 0.5) * 0.6 + rng.normal(0, 0.1)
                sv = side * np.cos(tilt) + np.array([0, 1, 0]) * np.sin(tilt)
                nv = np.cross(sv, dirv); nv /= np.linalg.norm(nv)
                if nv[1] < 0: nv = -nv
                w = L * 0.75 + 0.2
                q = quad(w, L * 1.05)
                M = np.eye(4); M[:3, 0] = sv; M[:3, 1] = dirv; M[:3, 2] = nv; M[:3, 3] = p0 - dirv * 0.05
                q.transform(M)
                outn = q.P - crown; outn[:, 1] *= 0.4
                outn /= np.linalg.norm(outn, axis=1, keepdims=True)
                q.N = (q.N * 0.4 + outn * 0.6); q.N /= np.linalg.norm(q.N, axis=1, keepdims=True)
                bk = q.copy(); bk.I = bk.I.reshape(-1, 3)[:, [0, 2, 1]].ravel()
                cards += [q, bk]
        y += rng.uniform(0.45, 0.6)
    for k in range(4):
        a = k * np.pi / 2
        q = quad(0.6, 1.0).r(y=a).t(0, H - 0.8, 0)
        bk = q.copy(); bk.I = bk.I.reshape(-1, 3)[:, [0, 2, 1]].ravel()
        cards += [q, bk]
    wood = merge([trunk] + brs)
    wood.C = None
    return wood, merge(cards)

def bush(seed):
    rng = np.random.default_rng(seed)
    centers = rng.normal(0, 1, (40, 3)) * [0.6, 0.35, 0.6] + [0, 0.55, 0]
    centers[:, 1] = np.abs(centers[:, 1])
    sizes = rng.uniform(0.5, 0.8, 40)
    return leaf_cards(centers, sizes, np.array([0, 0.3, 0]), rng, 0.85)

def grass_clump(seed, flowers=False):
    rng = np.random.default_rng(seed)
    parts = []
    nbl = 7
    for b in range(nbl):
        h = rng.uniform(0.16, 0.42); w = rng.uniform(0.008, 0.014)
        a = rng.uniform(0, 6.28); lean = rng.uniform(0.05, 0.4)
        base = rng.normal(0, 0.05, 2)
        d = np.array([np.cos(a), 0, np.sin(a)]); side = np.array([-d[2], 0, d[0]])
        rot = rng.uniform(-0.6, 0.6)
        side = side * np.cos(rot) + d * np.sin(rot)
        P, C, N = [], [], []
        dry = rng.random() < 0.18
        tip = np.array([0.62, 0.56, 0.30]) if dry else np.array([0.40, 0.52, 0.18]) * rng.uniform(0.85, 1.15)
        for k in range(4):
            t = k / 3
            c = np.array([base[0], 0, base[1]]) + d * lean * h * t * t + np.array([0, h * t, 0])
            ww = w * (1 - t) + 0.0005
            P += [c - side * ww, c + side * ww]
            col = np.array([0.10, 0.16, 0.05]) * (1 - t) + tip * t
            C += [col, col]; N += [(d * 0.3 + [0, 1, 0]) / 1.05] * 2
        I = []
        for k in range(3):
            o = k * 2
            I += [o, o + 1, o + 3, o, o + 3, o + 2]
        parts.append(Mesh(P, I, N=N, C=C))
    if flowers:
        for f in range(2):
            h = rng.uniform(0.25, 0.38); bx, bz = rng.normal(0, 0.05, 2)
            stem = tube(np.array([(bx, 0, bz), (bx + 0.01, h * 0.5, bz), (bx + 0.02, h, bz)]), 0.0018, seg=3, cap=False).color((0.2, 0.35, 0.1))
            petals = []
            for k in range(10):
                a = k / 10 * 2 * np.pi
                p = quad(0.008, 0.016).r(x=-np.pi / 2 + 0.25).r(y=a).t(bx + 0.02, h, bz)
                petals.append(p.color((0.97, 0.97, 0.95)))
            ctr = sphere(0.006, 8, 5, 1, 0.6, 1).t(bx + 0.02, h + 0.002, bz).color((0.95, 0.75, 0.1))
            parts += [stem, ctr] + petals
    return merge(parts)

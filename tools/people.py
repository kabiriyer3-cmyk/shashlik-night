"""Skinned humans + dog, with IK-authored animation clips."""
import numpy as np
from meshlib import *

A = np.radians(40)  # A-pose arm angle below horizontal
SH = np.array([0.18, 1.42, 0.0])
ARM_DIR = np.array([np.cos(A), -np.sin(A), 0.0])
EL = SH + ARM_DIR * 0.27
WR = EL + ARM_DIR * 0.25

BONES = [('Hips', -1, (0, 0.95, 0)), ('Spine', 0, (0, 1.07, 0)), ('Chest', 1, (0, 1.24, 0)), ('Neck', 2, (0, 1.47, 0)), ('Head', 3, (0, 1.56, 0)),
         ('ShoulderL', 2, (0.06, 1.42, 0)), ('UpperArmL', 5, tuple(SH)), ('ForeArmL', 6, tuple(EL)), ('HandL', 7, tuple(WR)),
         ('ShoulderR', 2, (-0.06, 1.42, 0)), ('UpperArmR', 9, tuple(SH * [-1, 1, 1])), ('ForeArmR', 10, tuple(EL * [-1, 1, 1])), ('HandR', 11, tuple(WR * [-1, 1, 1])),
         ('UpLegL', 0, (0.095, 0.92, 0)), ('LegL', 13, (0.095, 0.50, 0)), ('FootL', 14, (0.095, 0.085, 0)),
         ('UpLegR', 0, (-0.095, 0.92, 0)), ('LegR', 16, (-0.095, 0.50, 0)), ('FootR', 17, (-0.095, 0.085, 0))]
BI = {n: i for i, (n, _, _) in enumerate(BONES)}
LR = {'L': 'R', 'R': 'L'}

def mirror_bones(m):
    """Mirror mesh across X and remap L<->R bone indices."""
    m = m.copy().transform(S(-1, 1, 1))
    if m.J is not None:
        remap = np.arange(len(BONES))
        for n, i in BI.items():
            if n.endswith('L') and n[:-1] + 'R' in BI: remap[i] = BI[n[:-1] + 'R']
            if n.endswith('R') and n[:-1] + 'L' in BI: remap[i] = BI[n[:-1] + 'L']
        m.J = remap[m.J]
    return m

def vary(m, base, amt=0.07, freq=18, seed=0):
    base = np.asarray(base, float)
    n = fbm(m.P * freq, 3, seed=seed)
    m.C = np.clip(base[None, :] * (1 + amt * n)[:, None], 0, 1)
    return m

def interp_prof(prof, n=30):
    prof = np.array(prof, float)
    ys = np.linspace(prof[0, 0], prof[-1, 0], n)
    cols = [np.interp(ys, prof[:, 0], prof[:, k]) for k in range(prof.shape[1])]
    return np.stack(cols, 1)

def ring_body(prof, seg=22, bump=None):
    prof = interp_prof(prof, 34)
    th = np.linspace(0, 2 * np.pi, seg, endpoint=False)
    a = prof[:, 1:2]; b = prof[:, 2:3]; zc = prof[:, 3:4]; y = prof[:, 0:1]
    if bump is not None:
        a = a * bump(y); b = b * bump(y)
    G = np.stack([a * np.cos(th), np.repeat(y, seg, 1), zc + b * np.sin(th)], -1)
    m = grid(G, closed_u=True)
    m.UV = np.c_[m.UV[:, 0] * 4, m.P[:, 1] / 0.026]
    return m

def arm_part(r_scale=1.0, s0=-0.035, s1=0.52, extra=0.0, ref_up=True):
    """Tube along the A-pose arm from param s0 to s1 (meters from shoulder joint)."""
    ss = np.linspace(s0, s1, 16)
    def rad(s):
        return np.interp(s, [-0.07, 0.0, 0.08, 0.20, 0.27, 0.33, 0.45, 0.52], [0.045, 0.054, 0.052, 0.043, 0.039, 0.042, 0.034, 0.030]) * r_scale + extra
    path = SH[None, :] + ARM_DIR[None, :] * ss[:, None]
    m = tube(path, rad(ss), seg=12, cap=True, ref=(0, 0, 1))
    s = (m.P - SH) @ ARM_DIR
    m.J, m.W = chain_weights(s, [-0.03, 0.27, 0.52], [BI['ShoulderL'], BI['UpperArmL'], BI['ForeArmL'], BI['HandL']], 0.04)
    return m

def hand_part(skin):
    rot = Rz(-A)
    palm = superellipsoid(0.042, 0.016, 0.038, 0.5, 0.6, 12, 8).t(0.045, 0, 0)
    fingers = superellipsoid(0.04, 0.013, 0.036, 0.6, 0.5, 12, 8).r(z=-0.25).t(0.105, -0.01, 0)
    thumb = tube(*capsule_path((0.02, -0.004, 0.03), (0.06, -0.012, 0.055), 0.012, 0.01, 4, 3), seg=8)
    h = merge([palm, fingers, thumb]).transform(T(*WR) @ rot)
    vary(h, skin, 0.04)
    return h.bone(BI['HandL'])

def leg_part(r_scale=1.0, extra=0.0, y0=0.98, y1=0.07):
    ys = np.linspace(y0, y1, 18)
    rr = np.interp(-ys, [-0.98, -0.92, -0.75, -0.52, -0.42, -0.30, -0.12, -0.07],
                   [0.085, 0.088, 0.074, 0.056, 0.058, 0.052, 0.040, 0.040]) * r_scale + extra
    zz = np.interp(-ys, [-0.98, -0.5, -0.35, -0.07], [0.0, 0.01, -0.012, 0.0])
    path = np.stack([np.full_like(ys, 0.095), ys, zz], 1)
    m = tube(path, rr, seg=12, cap=True, ref=(1, 0, 0))
    m.J, m.W = chain_weights(-m.P[:, 1], [-0.94, -0.50, -0.10], [BI['Hips'], BI['UpLegL'], BI['LegL'], BI['FootL']], 0.045)
    return m

def head_parts(cfg):
    skin = cfg['skin']; hair = cfg['hair']
    HC = np.array([0, 1.675, 0.012])
    def headshape(sx=0.083, sy=0.108, sz=0.098, inflate=0.0, seg=22, rings=16):
        m = sphere(1, seg, rings)
        P = m.P.copy()
        low = np.clip(-P[:, 1], 0, 1)
        P[:, 0] *= 1 - 0.20 * low ** 1.4
        P[:, 2] *= 1 - 0.06 * low
        P[:, 2] += 0.10 * np.clip(P[:, 2], 0, 1) * low ** 2  # chin forward
        P[:, 2] -= 0.05 * np.clip(-P[:, 2], 0, 1) * np.clip(P[:, 1], 0, 1)  # cranium
        m.P = P * [sx + inflate, sy + inflate, sz + inflate] + HC
        m.weld_normals()
        return m
    head = headshape()
    vary(head, skin, 0.03, 30, 3)
    # cheeks/nose warmth
    warm = np.exp(-((head.P[:, 0] ** 2) / 0.003 + ((head.P[:, 1] - 1.655) ** 2) / 0.0006)) * (head.P[:, 2] > 0.06)
    head.C = np.clip(head.C * (1 - 0.06 * warm[:, None]) + np.array([0.05, 0, 0]) * warm[:, None], 0, 1)
    parts = [head]
    nose = superellipsoid(0.011, 0.021, 0.013, 0.7, 0.8, 10, 8).r(x=0.25).t(0, 1.66, 0.103)
    parts.append(vary(nose, np.asarray(skin) * [1.02, 0.97, 0.95], 0.02))
    for sx in (1, -1):
        ear = superellipsoid(0.008, 0.025, 0.016, 0.8, 0.8, 10, 8).r(y=sx * 0.3).t(sx * 0.082, 1.672, 0.0)
        parts.append(vary(ear, np.asarray(skin) * 0.95, 0.02))
        lid = sphere(0.0142, 12, 8).select_faces(lambda P: P[:, 1] > -0.002)
        parts.append(vary(lid.r(x=-0.15).t(sx * 0.033, 1.692, 0.077), np.asarray(skin) * 0.93, 0.01))
        brow = superellipsoid(0.017, 0.0035, 0.006, 0.6, 0.6, 8, 6).r(z=sx * -0.12).t(sx * 0.034, 1.714, 0.091)
        parts.append(brow.color(np.asarray(hair) * 0.8))
    lips = superellipsoid(0.021, 0.0055, 0.008, 0.7, 0.7, 12, 6).t(0, 1.618, 0.094)
    parts.append(lips.color(np.asarray(skin) * [0.82, 0.62, 0.6]))
    gloss = []
    for sx in (1, -1):
        gloss.append(sphere(0.0128, 12, 8).t(sx * 0.033, 1.69, 0.078).color((0.93, 0.92, 0.9)))
        gloss.append(sphere(0.0072, 10, 6).s(1, 1, 0.6).t(sx * 0.033, 1.69, 0.0898).color(cfg.get('eyes', (0.22, 0.14, 0.08))))
        gloss.append(sphere(0.0034, 8, 6).s(1, 1, 0.5).t(sx * 0.033, 1.69, 0.0935).color((0.02, 0.02, 0.02)))
    # hair
    style = cfg['hairstyle']
    if style != 'bald':
        inf = 0.010 if style != 'curly' else 0.016
        hm = headshape(inflate=inf, seg=28, rings=20)
        Ploc = (hm.P - HC) / [0.093, 0.118, 0.108]
        hm = hm.select_faces(lambda P: ((P - HC) / [0.093, 0.118, 0.108])[:, 1] > 0.32 * ((P - HC) / [0.093, 0.118, 0.108])[:, 2] - 0.14 + (0.5 if style == 'short_long' else 0) * 0)
        if style == 'curly':
            hm.displace(0.009, 70, seed=5, octaves=2)
        else:
            hm.displace(0.004, 40, seed=6, octaves=2)
        parts.append(vary(hm, hair, 0.12, 50, 4))
        if style in ('ponytail',):
            path = np.array([(0, 1.73, -0.09), (0, 1.70, -0.125), (0, 1.62, -0.14), (0, 1.54, -0.13), (0, 1.48, -0.115)])
            pt = tube(path, [0.022, 0.03, 0.028, 0.02, 0.006], seg=10)
            parts.append(vary(pt, hair, 0.12, 50, 5))
            parts.append(torus(0.018, 0.006, 12, 6).r(x=np.pi / 2 - 0.4).t(0, 1.715, -0.112).color((0.6, 0.1, 0.15)))
        if style == 'long':
            back = superellipsoid(0.098, 0.15, 0.05, 0.8, 0.8, 16, 12).t(0, 1.58, -0.06)
            back = back.select_faces(lambda P: P[:, 2] < -0.035)
            back.displace(0.005, 30, seed=8)
            parts.append(vary(back, hair, 0.1, 40, 9))
            for sx in (1, -1):
                side = tube(np.array([(sx * 0.07, 1.72, 0.02), (sx * 0.095, 1.62, 0.0), (sx * 0.1, 1.5, -0.02)]), [0.03, 0.028, 0.012], seg=8)
                parts.append(vary(side, hair, 0.1, 40, 10))
    if cfg.get('beard'):
        bm = headshape(inflate=0.006, seg=26, rings=18)
        bm = bm.select_faces(lambda P: (((P - HC) / [0.09, 0.114, 0.104])[:, 1] < -0.18) & (((P - HC) / [0.09, 0.114, 0.104])[:, 2] > -0.25)
                             & ~((np.abs(P[:, 0]) < 0.026) & (P[:, 1] > 1.605) & (P[:, 2] > 0.05)))
        bm.displace(0.006, 60, seed=11, octaves=2)
        parts.append(vary(bm, hair, 0.12, 60, 12))
        mus = tube(np.array([(-0.03, 1.626, 0.088), (0, 1.632, 0.1), (0.03, 1.626, 0.088)]), [0.005, 0.007, 0.005], seg=8)
        parts.append(vary(mus, hair, 0.1))
    if cfg.get('cap'):
        crown = sphere(1, 22, 12).select_faces(lambda P: P[:, 1] > -0.05)
        crown.P = crown.P * [0.097, 0.055, 0.113] + [0, 1.735, 0.0]
        crown.P[:, 1] += np.clip(crown.P[:, 2], 0, 1) * -0.25
        crown.weld_normals()
        visor = superellipsoid(0.07, 0.006, 0.05, 0.3, 0.6, 14, 6).r(x=0.18).t(0, 1.738, 0.11)
        parts.append(vary(merge([crown, visor]), cfg['cap'], 0.08, 40))
    if cfg.get('glasses'):
        for sx in (1, -1):
            gloss.append(torus(0.017, 0.0022, 18, 6).r(x=np.pi / 2).t(sx * 0.034, 1.69, 0.101).color((0.06, 0.05, 0.05)))
            gloss.append(tube(np.array([(sx * 0.051, 1.692, 0.1), (sx * 0.085, 1.695, 0.06), (sx * 0.088, 1.69, -0.01)]), 0.0022, seg=5).color((0.06, 0.05, 0.05)))
        gloss.append(tube(np.array([(-0.017, 1.693, 0.103), (0, 1.698, 0.106), (0.017, 1.693, 0.103)]), 0.002, seg=5).color((0.06, 0.05, 0.05)))
    body = merge(parts).bone(BI['Head'])
    gl = merge(gloss).bone(BI['Head'])
    return body, gl

def build_person(cfg):
    g = cfg.get('girth', 1.0)
    fem = cfg.get('female', False)
    skin, shirt, pants, shoes = map(np.asarray, (cfg['skin'], cfg['shirt'], cfg['pants'], cfg['shoes']))
    belly = cfg.get('belly', 0.0)
    prof = [(0.86, 0.165, 0.105, 0.0), (0.95, 0.172, 0.112, 0.0), (1.05, 0.155, 0.105 + belly * 0.6, 0.005 + belly * 0.5),
            (1.15, 0.160, 0.108 + belly, 0.012 + belly * 0.7), (1.25, 0.176, 0.114 + belly * 0.4, 0.016), (1.33, 0.186, 0.11, 0.012),
            (1.40, 0.18, 0.10, 0.0), (1.45, 0.14, 0.085, -0.005), (1.49, 0.08, 0.06, -0.01), (1.515, 0.05, 0.05, -0.01)]
    if fem:
        prof = [(0.86, 0.17, 0.11, 0.0), (0.95, 0.178, 0.115, 0.0), (1.05, 0.135, 0.095, 0.005), (1.15, 0.14, 0.098, 0.01),
                (1.24, 0.155, 0.118, 0.022), (1.31, 0.162, 0.112, 0.018), (1.39, 0.165, 0.095, 0.0), (1.45, 0.125, 0.08, -0.005),
                (1.49, 0.075, 0.058, -0.01), (1.515, 0.048, 0.048, -0.01)]
    prof = [(y, a * g, b * g, zc) for (y, a, b, zc) in prof]
    bump = None
    if cfg['top'] == 'puffer':
        bump = lambda y: 1.0 + 0.05 * np.abs(np.sin((y - 0.86) / 0.09 * np.pi))
        prof = [(y, a * 1.08, b * 1.1, zc) for (y, a, b, zc) in prof]
    torso = ring_body(prof, bump=bump)
    torso.J, torso.W = chain_weights(torso.P[:, 1], [1.0, 1.18, 1.49], [BI['Hips'], BI['Spine'], BI['Chest'], BI['Neck']], 0.05)
    out_vc, out_gloss, out_stripe = [], [], []
    top = cfg['top']
    if top == 'stripes':
        torso.C = None; out_stripe.append(torso)
    else:
        out_vc.append(vary(torso, shirt, 0.08, 14, 21))
    # neck
    neck = cylinder(0.047 * g ** 0.5, 0.045 * g ** 0.5, 0.2, 14, False, 1.42)
    neck.J, neck.W = chain_weights(neck.P[:, 1], [1.47, 1.58], [BI['Chest'], BI['Neck'], BI['Head']], 0.03)
    out_vc.append(vary(neck, skin, 0.02))
    if top in ('hoodie', 'puffer', 'tracksuit'):
        collar = torus(0.062 * g, 0.022, 20, 8).s(1.15, 1, 0.95).t(0, 1.475, -0.005)
        collar.J, collar.W = chain_weights(collar.P[:, 1], [1.49], [BI['Chest'], BI['Neck']], 0.02)
        out_vc.append(vary(collar, shirt * 0.92, 0.06))
        if top == 'hoodie':
            hood = superellipsoid(0.12 * g, 0.06, 0.06, 0.7, 0.7, 14, 8).t(0, 1.47, -0.085)
            out_vc.append(vary(hood.bone(BI['Chest']), shirt * 0.9, 0.08))
    if top == 'tracksuit':
        zip_ = box(0.006, 0.6, 0.004).t(0, 1.17, 0.0)
        # place zipper on front surface
        zip_.P[:, 2] += np.interp(zip_.P[:, 1], [y for (y, *_r) in prof], [b + zc for (_y, a, b, zc) in prof]) + 0.002
        zip_.J, zip_.W = chain_weights(zip_.P[:, 1], [1.0, 1.18], [BI['Hips'], BI['Spine'], BI['Chest']], 0.05)
        out_gloss.append(zip_.color((0.8, 0.8, 0.82)))
    # arms
    long_sleeve = top in ('hoodie', 'tracksuit', 'stripes', 'puffer', 'flannel')
    rs = g ** 0.7
    if long_sleeve:
        sl = arm_part(rs, -0.035, 0.5, 0.010 + (0.010 if top == 'puffer' else 0))
        if top == 'stripes':
            sl.UV = np.c_[sl.UV[:, 0] * 4, sl.UV[:, 1] / 0.026]
            out_stripe.append(sl); out_stripe.append(mirror_bones(sl))
        else:
            vary(sl, shirt, 0.08, 14, 22); out_vc += [sl, mirror_bones(sl)]
        cuff = arm_part(rs * 0.95, 0.47, 0.515, 0.008)
        vary(cuff, shirt * 0.85, 0.05); out_vc += [cuff, mirror_bones(cuff)]
        if top == 'tracksuit':
            for off in (0.006, -0.006):
                ss = np.linspace(0.0, 0.49, 14)
                path = SH + ARM_DIR * ss[:, None] + np.array([0, 1, 0]) * 0 
                up = np.cross([0, 0, 1], ARM_DIR)
                rad = np.interp(ss, [0.0, 0.08, 0.20, 0.27, 0.33, 0.45, 0.52], [0.054, 0.052, 0.043, 0.039, 0.042, 0.034, 0.030]) * rs + 0.013
                pth = path + up[None, :] * rad[:, None] + np.array([0, 0, off])
                st = tube(pth, 0.0035, seg=4, cap=False)
                st.J, st.W = chain_weights((st.P - SH) @ ARM_DIR, [-0.03, 0.27], [BI['ShoulderL'], BI['UpperArmL'], BI['ForeArmL']], 0.04)
                st.color((0.95, 0.95, 0.95)); out_vc += [st, mirror_bones(st)]
    else:
        arm = arm_part(rs)
        vary(arm, skin, 0.03); out_vc += [arm, mirror_bones(arm)]
        sl = arm_part(rs, -0.035, 0.13, 0.012)
        vary(sl, shirt, 0.08); out_vc += [sl, mirror_bones(sl)]
    if long_sleeve:
        wrist = arm_part(rs * 0.9, 0.45, 0.53)
        vary(wrist, skin, 0.03); out_vc += [wrist, mirror_bones(wrist)]
    h = hand_part(skin); out_vc += [h, mirror_bones(h)]
    # pelvis + legs
    pel = superellipsoid(0.172 * g, 0.105, 0.115 * g, 0.6, 0.8, 18, 10).t(0, 0.90, 0.0)
    pel.J, pel.W = chain_weights(pel.P[:, 1], [1.0], [BI['Hips'], BI['Spine']], 0.04)
    out_vc.append(vary(pel, pants, 0.06, 14, 23))
    leg = leg_part(g ** 0.8, 0.008 if cfg.get('loose') else 0.0)
    vary(leg, pants, 0.07, 12, 24)
    # knee/back crease shading
    out_vc += [leg, mirror_bones(leg)]
    if top == 'tracksuit':
        ys = np.linspace(0.9, 0.12, 16)
        rr = np.interp(-ys, [-0.92, -0.75, -0.52, -0.42, -0.30, -0.12], [0.088, 0.074, 0.056, 0.058, 0.052, 0.040]) * g ** 0.8 + 0.002
        for off in (0.006, -0.006):
            pth = np.stack([0.095 + rr, ys, np.full_like(ys, off)], 1)
            st = tube(pth, 0.0035, seg=4, cap=False)
            st.J, st.W = chain_weights(-st.P[:, 1], [-0.94, -0.50, -0.10], [BI['Hips'], BI['UpLegL'], BI['LegL'], BI['FootL']], 0.045)
            st.color((0.95, 0.95, 0.95)); out_vc += [st, mirror_bones(st)]
    shoe = superellipsoid(0.048, 0.042, 0.125, 0.45, 0.6, 14, 10).t(0.095, 0.05, 0.045)
    shoe.P[:, 1] = np.maximum(shoe.P[:, 1], 0.012)
    shoe.J, shoe.W = chain_weights(-shoe.P[:, 1], [-0.09], [BI['LegL'], BI['FootL']], 0.02)
    vary(shoe, shoes, 0.05)
    sole = superellipsoid(0.051, 0.011, 0.13, 0.3, 0.6, 14, 6).t(0.095, 0.011, 0.045).bone(BI['FootL'])
    sole.color(cfg.get('sole', (0.92, 0.9, 0.86)))
    out_vc += [shoe, mirror_bones(shoe), sole, mirror_bones(sole)]
    hb, hg = head_parts(cfg)
    out_vc.append(hb); out_gloss.append(hg)
    return merge(out_vc), merge(out_gloss) if out_gloss else None, merge(out_stripe) if out_stripe else None

# ------------------------------------------------------------------ rig / FK / IK
def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

def mat2q(M):
    m = M; tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0:
        s = np.sqrt(tr + 1.0) * 2; w = 0.25 * s; x = (m[2, 1] - m[1, 2]) / s; y = (m[0, 2] - m[2, 0]) / s; z = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2; w = (m[2, 1] - m[1, 2]) / s; x = 0.25 * s; y = (m[0, 1] + m[1, 0]) / s; z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2; w = (m[0, 2] - m[2, 0]) / s; x = (m[0, 1] + m[1, 0]) / s; y = 0.25 * s; z = (m[1, 2] + m[2, 1]) / s
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2; w = (m[1, 0] - m[0, 1]) / s; x = (m[0, 2] + m[2, 0]) / s; y = (m[1, 2] + m[2, 1]) / s; z = 0.25 * s
    q = np.array([x, y, z, w]); return q / np.linalg.norm(q)

def axis_angle_q(ax, a):
    ax = np.asarray(ax, float); ax = ax / np.linalg.norm(ax)
    return np.r_[ax * np.sin(a / 2), np.cos(a / 2)]

def fk(bones, q):
    Rw, Pw = [], []
    for i, (n, p, pos) in enumerate(bones):
        R = qmat(q[i])
        if p < 0:
            Rw.append(R); Pw.append(np.array(pos, float))
        else:
            Rw.append(Rw[p] @ R); Pw.append(Pw[p] + Rw[p] @ (np.array(pos) - np.array(bones[p][2])))
    return Rw, Pw

def solve_arm(q, side, target, pole):
    up_i, fo_i, ha_i, sh_i = BI['UpperArm' + side], BI['ForeArm' + side], BI['Hand' + side], BI['Shoulder' + side]
    Rw, Pw = fk(BONES, q)
    S0 = Pw[up_i]
    a = np.linalg.norm(np.array(BONES[fo_i][2]) - BONES[up_i][2]); b = np.linalg.norm(np.array(BONES[ha_i][2]) - BONES[fo_i][2])
    tv = np.asarray(target, float) - S0
    d = np.clip(np.linalg.norm(tv), abs(a - b) + 1e-3, a + b - 1e-3)
    tn = tv / np.linalg.norm(tv)
    cos_al = (a * a + d * d - b * b) / (2 * a * d); al = np.arccos(np.clip(cos_al, -1, 1))
    pv = np.asarray(pole, float) - S0
    pv = pv - tn * (pv @ tn); pv /= np.linalg.norm(pv)
    u = tn * np.cos(al) + pv * np.sin(al)
    E = S0 + u * a
    f = (S0 + tn * d - E); f /= np.linalg.norm(f)
    w = f - u * (u @ f); w /= np.linalg.norm(w)
    bend = np.arccos(np.clip(u @ f, -1, 1))
    r = np.array(BONES[fo_i][2]) - BONES[up_i][2]; r /= np.linalg.norm(r)
    z = np.array([0, 0, 1.0])
    Rd = np.stack([u, w, np.cross(u, w)], 1) @ np.stack([r, z, np.cross(r, z)], 1).T
    q[up_i] = mat2q(Rw[sh_i].T @ Rd)
    q[fo_i] = axis_angle_q(np.cross(r, z), bend)
    return q

def pose_quats(spec):
    """spec: dict with 'e': {bone:(x,y,z)}, 'ik': {'L':(target,pole) or callable(Rw,Pw)->(t,p)}"""
    q = [np.array([0, 0, 0, 1.0]) for _ in BONES]
    for n, e in spec.get('e', {}).items():
        q[BI[n]] = quat_euler(*e)
    for side, tp in spec.get('ik', {}).items():
        if callable(tp):
            Rw, Pw = fk(BONES, q); tp = tp(Rw, Pw)
        q = solve_arm(q, side, *tp)
        if 'h' + side in spec:  # hand euler applied after
            q[BI['Hand' + side]] = quat_euler(*spec['h' + side])
    return q

def head_point(Rw, Pw, local):
    i = BI['Head']; return Pw[i] + Rw[i] @ (np.asarray(local) - np.array(BONES[i][2]))

MOUTH = (0, 1.62, 0.1)

def seated_base(t, br_period=3.6, look=0.0):
    br = np.sin(t * 2 * np.pi / br_period)
    e = {'Spine': (0.05 + 0.012 * br, 0, 0), 'Chest': (0.03 - 0.012 * br, 0, 0), 'Neck': (0.04, 0, 0), 'Head': (0.02, look, 0),
         'UpLegL': (-1.50, 0.14, 0), 'LegL': (1.48, 0, 0), 'FootL': (0.02, 0, 0),
         'UpLegR': (-1.50, -0.14, 0), 'LegR': (1.48, 0, 0), 'FootR': (0.02, 0, 0)}
    return e

THIGH_L = np.array([0.13, 1.03, 0.30]); THIGH_R = THIGH_L * [-1, 1, 1]
POLE_L = np.array([0.6, 0.9, -0.3]); POLE_R = POLE_L * [-1, 1, 1]

def clip_specs():
    C = {}
    def sit_idle(t):
        look = 0.25 * np.sin(t * 2 * np.pi / 6.0) + 0.1 * np.sin(t * 2 * np.pi / 2.0)
        e = seated_base(t, 3.0, look)
        return {'e': e, 'ik': {'L': (THIGH_L + [0, 0.005 * np.sin(t * 2), 0], POLE_L), 'R': (THIGH_R + [0.02, 0, -0.02], POLE_R)}}
    C['sit_idle'] = (sit_idle, 6.0)

    def sit_talk(t):
        ph = t * 2 * np.pi / 3.0
        e = seated_base(t, 3.0, 0.15 * np.sin(ph))
        e['Head'] = (0.05 + 0.06 * np.sin(ph * 4), 0.15 * np.sin(ph), 0.04 * np.sin(ph * 2))
        e['Spine'] = (0.10, 0.08 * np.sin(ph), 0)
        tr = np.array([-0.24, 1.28, 0.32]) + [0.06 * np.sin(ph * 2), 0.06 * np.sin(ph * 3 + 1), 0.04 * np.cos(ph * 2)]
        tl = np.array([0.2, 1.2, 0.3]) + [0.04 * np.sin(ph * 2 + 2), 0.05 * np.sin(ph * 3), 0]
        return {'e': e, 'ik': {'L': (tl, POLE_L), 'R': (tr, POLE_R)}, 'hR': (0.3 * np.sin(ph * 3), 0, 0.4)}
    C['sit_talk'] = (sit_talk, 3.0)

    def sit_wave(t):
        ph = t * 2 * np.pi / 1.2
        e = seated_base(t, 2.0, 0.0)
        e['Head'] = (-0.05, 0, 0.05)
        e['Spine'] = (0.0, -0.1, 0)
        tr = np.array([-0.30, 1.78, 0.18]) + [0.08 * np.sin(ph), 0.01 * np.cos(ph * 2), 0]
        return {'e': e, 'ik': {'L': (THIGH_L, POLE_L), 'R': (tr, np.array([-0.8, 1.2, -0.4]))}, 'hR': (0, 0, 0.6 + 0.5 * np.sin(ph))}
    C['sit_wave'] = (sit_wave, 2.4)

    def sit_eat(t):
        ph = t * 2 * np.pi / 2.0
        bite = max(0, np.sin(ph)) ** 3
        e = seated_base(t, 2.0, 0.0)
        e['Spine'] = (0.14 + 0.05 * bite, 0, 0)
        e['Head'] = (0.12 + 0.12 * bite, 0, 0)
        e['Neck'] = (0.05, 0, 0)
        def tgt(Rw, Pw):
            m = head_point(Rw, Pw, MOUTH)
            return (m + [-0.24 + 0.03 * bite, -0.04, 0.17 - 0.06 * bite], POLE_R + [0, -0.5, 0])
        return {'e': e, 'ik': {'L': (THIGH_L, POLE_L), 'R': tgt}, 'hR': (0, 0.0, 0.0)}
    C['sit_eat'] = (sit_eat, 4.0)

    def sit_cheer(t):
        ph = t * 2 * np.pi / 0.8
        e = seated_base(t, 2.0, 0.0)
        e['Spine'] = (-0.12 + 0.05 * np.sin(ph), 0, 0)
        e['Head'] = (-0.2, 0, 0.0)
        b = 0.05 * np.sin(ph)
        return {'e': e, 'ik': {'L': ((0.32, 1.92 + b, 0.1), (1, 1.2, -0.5)), 'R': ((-0.32, 1.92 + b, 0.1), (-1, 1.2, -0.5))},
                'hL': (0.3, 0, -0.4), 'hR': (0.3, 0, 0.4)}
    C['sit_cheer'] = (sit_cheer, 2.4)

    def sit_disgust(t):
        ph = t * 2 * np.pi / 0.7
        e = seated_base(t, 2.0, 0.0)
        e['Spine'] = (-0.16, 0, 0)
        e['Head'] = (-0.1, 0.35 * np.sin(ph), 0)
        e['Neck'] = (-0.05, 0, 0)
        return {'e': e, 'ik': {'L': ((0.15, 1.38, 0.36), POLE_L), 'R': ((-0.15, 1.38, 0.36), POLE_R)}, 'hL': (0, 0, -1.2), 'hR': (0, 0, 1.2)}
    C['sit_disgust'] = (sit_disgust, 2.1)

    def sit_drink(t):
        u = t / 3.0
        lift = np.clip(np.sin(u * np.pi) * 1.6, 0, 1)
        e = seated_base(t, 2.0, 0.0)
        e['Head'] = (-0.3 * lift, 0, 0)
        e['Neck'] = (-0.1 * lift, 0, 0)
        def tgt(Rw, Pw):
            m = head_point(Rw, Pw, MOUTH)
            rest = np.array([0.2, 1.15, 0.28])
            return (rest * (1 - lift) + (m + [0.03, -0.03, 0.08]) * lift, POLE_L + [0, -0.6, 0])
        return {'e': e, 'ik': {'L': tgt, 'R': (THIGH_R, POLE_R)}, 'hL': (0, 0, -0.9 * lift)}
    C['sit_drink'] = (sit_drink, 3.0)

    def sit_laugh(t):
        ph = t * 2 * np.pi / 0.45
        e = seated_base(t, 2.0, 0.0)
        e['Spine'] = (-0.2 + 0.08 * np.sin(ph), 0, 0)
        e['Chest'] = (0.05 * np.sin(ph), 0, 0)
        e['Head'] = (-0.25 + 0.1 * np.sin(ph), 0.1, 0)
        return {'e': e, 'ik': {'L': ((0.09, 1.12, 0.16), POLE_L), 'R': ((-0.25, 1.30 + 0.05 * np.sin(ph * 0.5), 0.3), POLE_R)}}
    C['sit_laugh'] = (sit_laugh, 1.8)

    def sit_strum(t):
        ph = t * 2 * np.pi / 0.5
        e = seated_base(t, 3.0, 0.0)
        e['Spine'] = (0.10, 0.05, 0)
        e['Head'] = (0.25, 0.25 + 0.05 * np.sin(t * 1.3), 0.08)
        strum = 0.05 * np.sin(ph)
        chord = np.floor(t / 2.0) % 2
        return {'e': e, 'ik': {'R': ((-0.04, 1.15 + strum, 0.36), (-0.8, 1.4, -0.3)),
                               'L': ((0.42 - 0.03 * chord, 1.215 + 0.01 * chord, 0.34), (0.8, 0.8, -0.2))},
                'hR': (0.0, 0.0, 0.3), 'hL': (0.0, 0.0, -1.0)}
    C['sit_strum'] = (sit_strum, 4.0)

    # ---- standing clips for the other players' avatars
    REST_L = np.array([0.215, 0.86, 0.03]); REST_R = REST_L * [-1, 1, 1]
    SPOLE_L = np.array([0.35, 1.15, -0.6]); SPOLE_R = SPOLE_L * [-1, 1, 1]
    HOLD_R = np.array([-0.17, 1.13, 0.36]); HPOLE_R = np.array([-0.7, 0.9, -0.2])
    def legs_walk(e, ph):
        for side, off in (('L', 0.0), ('R', np.pi)):
            p = ph + off
            e['UpLeg' + side] = (-0.42 * np.sin(p), 0, 0)
            e['Leg' + side] = (0.08 + 0.75 * max(0.0, np.cos(p)) ** 1.4, 0, 0)
            e['Foot' + side] = (0.18 * np.sin(p) - 0.1 * max(0.0, np.cos(p)), 0, 0)
        e['Hips'] = (0, 0.07 * np.sin(ph), 0)
        e['Spine'] = (0.04, -0.09 * np.sin(ph), 0)
        e['Head'] = (0, 0.03 * np.sin(ph), 0)
        return e
    def stand_idle(t):
        br = np.sin(t * 2 * np.pi / 3.0)
        e = {'Spine': (0.02 + 0.01 * br, 0, 0), 'Chest': (-0.01 * br, 0, 0), 'Head': (0.02, 0.15 * np.sin(t * 2 * np.pi / 6), 0),
             'LegL': (0.04, 0, 0), 'LegR': (0.04, 0, 0)}
        return {'e': e, 'ik': {'L': (REST_L + [0, 0.004 * br, 0], SPOLE_L), 'R': (REST_R + [0, 0.004 * br, 0], SPOLE_R)}}
    C['stand_idle'] = (stand_idle, 6.0)
    def stand_walk(t):
        ph = t * 2 * np.pi / 1.0
        e = legs_walk({}, ph)
        return {'e': e, 'ik': {'L': (REST_L + [0.0, 0.02 * abs(np.sin(ph)), -0.13 * np.sin(ph)], SPOLE_L), 'R': (REST_R + [0.0, 0.02 * abs(np.sin(ph)), 0.13 * np.sin(ph)], SPOLE_R)}}
    C['stand_walk'] = (stand_walk, 1.0)
    def stand_hold(t):
        br = np.sin(t * 2 * np.pi / 3.0)
        e = {'Spine': (0.03, 0, 0), 'Head': (0.06, 0, 0), 'LegL': (0.04, 0, 0), 'LegR': (0.04, 0, 0)}
        return {'e': e, 'ik': {'L': (REST_L, SPOLE_L), 'R': (HOLD_R + [0, 0.005 * br, 0], HPOLE_R)}, 'hR': (0, 0, 0.2)}
    C['stand_hold'] = (stand_hold, 3.0)
    def stand_hold_walk(t):
        ph = t * 2 * np.pi / 1.0
        e = legs_walk({}, ph)
        return {'e': e, 'ik': {'L': (REST_L + [0, 0, -0.13 * np.sin(ph)], SPOLE_L), 'R': (HOLD_R + [0, 0.012 * abs(np.sin(ph)), 0], HPOLE_R)}, 'hR': (0, 0, 0.2)}
    C['stand_hold_walk'] = (stand_hold_walk, 1.0)
    def stand_fan(t):
        ph = t * 2 * np.pi / 0.3
        e = {'Spine': (0.32, 0, 0), 'Chest': (0.1, 0, 0), 'Head': (0.15, 0, 0), 'UpLegL': (-0.1, 0, 0), 'UpLegR': (-0.1, 0, 0), 'LegL': (0.2, 0, 0), 'LegR': (0.2, 0, 0)}
        def tgt(Rw, Pw):
            c = Pw[BI['Chest']]
            return (c + [-0.16 + 0.06 * np.sin(ph), -0.32 + 0.05 * np.cos(ph), 0.42], HPOLE_R)
        return {'e': e, 'ik': {'L': (REST_L + [0, 0.05, 0.12], SPOLE_L), 'R': tgt}, 'hR': (0.6 * np.sin(ph), 0, 0.3)}
    C['stand_fan'] = (stand_fan, 0.6)
    return C

def bake_clip(fn, dur, fps=20):
    n = int(round(dur * fps)); ts = np.linspace(0, dur, n + 1)
    vals = np.zeros((len(BONES), n + 1, 4))
    for k, t in enumerate(ts):
        tt = t if k < n else 0.0  # exact loop
        q = pose_quats(fn(tt))
        for i in range(len(BONES)):
            v = q[i]
            if k > 0 and np.dot(v, vals[i, k - 1]) < 0: v = -v
            vals[i, k] = v
    return ts, vals

# ------------------------------------------------------------------ dog
DBONES = [('DPelvis', -1, (0, 0.47, -0.24)), ('DSpine', 0, (0, 0.48, -0.02)), ('DChest', 1, (0, 0.49, 0.17)), ('DNeck', 2, (0, 0.56, 0.27)),
          ('DHead', 3, (0, 0.68, 0.36)), ('DJaw', 4, (0, 0.655, 0.41)), ('DEarL', 4, (0.045, 0.75, 0.355)), ('DEarR', 4, (-0.045, 0.75, 0.355)),
          ('DTail1', 0, (0, 0.52, -0.33)), ('DTail2', 8, (0, 0.60, -0.45)),
          ('DFLegL', 2, (0.075, 0.43, 0.19)), ('DFLeg2L', 10, (0.075, 0.24, 0.20)), ('DFPawL', 11, (0.075, 0.05, 0.21)),
          ('DFLegR', 2, (-0.075, 0.43, 0.19)), ('DFLeg2R', 13, (-0.075, 0.24, 0.20)), ('DFPawR', 14, (-0.075, 0.05, 0.21)),
          ('DBLegL', 0, (0.075, 0.45, -0.26)), ('DBLeg2L', 16, (0.075, 0.25, -0.31)), ('DBPawL', 17, (0.075, 0.06, -0.28)),
          ('DBLegR', 0, (-0.075, 0.45, -0.26)), ('DBLeg2R', 19, (-0.075, 0.25, -0.31)), ('DBPawR', 20, (-0.075, 0.06, -0.28))]
DI = {n: i for i, (n, _, _) in enumerate(DBONES)}

def dog_mesh():
    fur = np.array([0.72, 0.43, 0.20]); cream = np.array([0.93, 0.85, 0.70]); dark = np.array([0.25, 0.15, 0.08])
    def furcol(m, creamfn=None, seed=0):
        n = fbm(m.P * 25, 3, seed=seed)
        c = fur[None, :] * (1 + 0.12 * n)[:, None]
        if creamfn is not None:
            k = np.clip(creamfn(m.P), 0, 1)[:, None]
            c = c * (1 - k) + cream[None, :] * k
        m.C = np.clip(c, 0, 1)
        return m
    parts = []
    zs = np.linspace(-0.38, 0.30, 16)
    ys = np.interp(zs, [-0.38, -0.2, 0.0, 0.15, 0.30], [0.47, 0.48, 0.49, 0.47, 0.50])
    rr = np.interp(zs, [-0.38, -0.34, -0.22, -0.02, 0.15, 0.26, 0.30], [0.03, 0.075, 0.09, 0.085, 0.115, 0.10, 0.06])
    body = tube(np.stack([np.zeros_like(zs), ys, zs], 1), rr, seg=14, ex=0.82, ey=1.0, ref=(1, 0, 0))
    body.displace(0.006, 30, seed=3)
    body.J, body.W = chain_weights(body.P[:, 2], [-0.12, 0.09], [DI['DPelvis'], DI['DSpine'], DI['DChest']], 0.07)
    parts.append(furcol(body, lambda P: smoothstep(0.43, 0.38, P[:, 1]) + smoothstep(0.12, 0.26, P[:, 2]) * smoothstep(0.5, 0.42, P[:, 1]), 1))
    neck = tube(np.array([(0, 0.50, 0.22), (0, 0.58, 0.31), (0, 0.66, 0.37)]), [0.085, 0.07, 0.06], seg=12, ex=0.85, ref=(1, 0, 0))
    s = neck.P[:, 1]
    neck.J, neck.W = chain_weights(s, [0.53, 0.64], [DI['DChest'], DI['DNeck'], DI['DHead']], 0.03)
    parts.append(furcol(neck, lambda P: smoothstep(0.30, 0.36, P[:, 2] + (0.6 - P[:, 1]) * 0.4), 2))
    skull = superellipsoid(0.062, 0.058, 0.07, 0.8, 0.8, 14, 10).t(0, 0.705, 0.38)
    snout = superellipsoid(0.034, 0.028, 0.06, 0.7, 0.8, 12, 8).r(x=0.12).t(0, 0.675, 0.455)
    head = merge([skull, snout]).weld_normals()
    furcol(head, lambda P: smoothstep(0.42, 0.47, P[:, 2]) + smoothstep(0.68, 0.66, P[:, 1]) * 0.6, 4)
    parts.append(head.bone(DI['DHead']))
    blk = []
    blk.append(sphere(0.016, 10, 6).s(1.2, 0.85, 1).t(0, 0.69, 0.51).bone(DI['DHead']).color((0.03, 0.025, 0.025)))
    for sx in (1, -1):
        blk.append(sphere(0.011, 10, 6).t(sx * 0.034, 0.718, 0.433).bone(DI['DHead']).color((0.05, 0.03, 0.02)))
        ear = superellipsoid(0.016, 0.045, 0.03, 0.9, 0.9, 10, 8)
        ear.P[:, 0] *= 1 - 0.6 * np.clip((ear.P[:, 1] / 0.045), 0, 1)
        ear.P[:, 2] *= 1 - 0.6 * np.clip((ear.P[:, 1] / 0.045), 0, 1)
        ear = ear.r(z=-sx * 0.35, x=-0.25).t(sx * 0.045, 0.765, 0.355)
        ear.weld_normals()
        parts.append(furcol(ear, None, 5).bone(DI['DEar' + ('L' if sx > 0 else 'R')]))
    jaw = superellipsoid(0.028, 0.011, 0.05, 0.7, 0.8, 10, 6).t(0, 0.648, 0.45)
    parts.append(furcol(jaw, lambda P: np.ones(len(P)) * 0.8, 6).bone(DI['DJaw']))
    tongue = superellipsoid(0.016, 0.004, 0.03, 0.8, 0.8, 8, 6).t(0, 0.657, 0.46).bone(DI['DJaw']).color((0.85, 0.35, 0.4))
    blk.append(tongue)
    tail = tube(np.array([(0, 0.52, -0.34), (0, 0.57, -0.42), (0, 0.65, -0.48), (0, 0.72, -0.49)]), [0.026, 0.024, 0.018, 0.008], seg=8)
    tail.J, tail.W = chain_weights(tail.P[:, 1], [0.6], [DI['DTail1'], DI['DTail2']], 0.04)
    parts.append(furcol(tail, lambda P: smoothstep(0.66, 0.72, P[:, 1]), 7))
    for side, sx in (('L', 1), ('R', -1)):
        fl = tube(np.array([(sx * 0.075, 0.47, 0.19), (sx * 0.075, 0.33, 0.20), (sx * 0.075, 0.24, 0.20), (sx * 0.075, 0.12, 0.21), (sx * 0.075, 0.05, 0.21)]),
                  [0.045, 0.034, 0.027, 0.023, 0.022], seg=9)
        fl.J, fl.W = chain_weights(-fl.P[:, 1], [-0.44, -0.24, -0.06], [DI['DChest'], DI['DFLeg' + side], DI['DFLeg2' + side], DI['DFPaw' + side]], 0.03)
        parts.append(furcol(fl, lambda P: smoothstep(0.12, 0.06, P[:, 1]), 8))
        bl = tube(np.array([(sx * 0.075, 0.50, -0.25), (sx * 0.078, 0.38, -0.27), (sx * 0.075, 0.25, -0.31), (sx * 0.075, 0.14, -0.30), (sx * 0.075, 0.06, -0.28)]),
                  [0.06, 0.05, 0.03, 0.025, 0.023], seg=9)
        bl.J, bl.W = chain_weights(-bl.P[:, 1], [-0.47, -0.25, -0.07], [DI['DPelvis'], DI['DBLeg' + side], DI['DBLeg2' + side], DI['DBPaw' + side]], 0.03)
        parts.append(furcol(bl, lambda P: smoothstep(0.12, 0.06, P[:, 1]), 9))
        for (z, b) in ((0.225, 'DFPaw'), (-0.265, 'DBPaw')):
            paw = superellipsoid(0.027, 0.018, 0.04, 0.6, 0.7, 10, 6).t(sx * 0.075, 0.02, z)
            parts.append(paw.bone(DI[b + side]).color(cream * 0.95))
    collar = torus(0.068, 0.009, 18, 6).r(x=np.pi / 2 - 0.9).s(0.9, 1, 1).t(0, 0.585, 0.31).bone(DI['DNeck']).color((0.75, 0.1, 0.1))
    blk.append(collar)
    return merge(parts), merge(blk)

def dog_clips():
    C = {}
    base_t = np.array(DBONES[0][2])
    def legs(e, fl, fr, bl, br, k1=0.0, k2=0.0):
        e['DFLegL'] = (fl, 0, 0); e['DFLegR'] = (fr, 0, 0); e['DBLegL'] = (bl, 0, 0); e['DBLegR'] = (br, 0, 0)
        e['DFLeg2L'] = (max(0, -fl) * 0.8 + k1, 0, 0); e['DFLeg2R'] = (max(0, -fr) * 0.8 + k1, 0, 0)
        e['DBLeg2L'] = (-max(0, bl) * 0.6 - k2, 0, 0); e['DBLeg2R'] = (-max(0, br) * 0.6 - k2, 0, 0)
        return e
    def run(t):
        ph = t * 2 * np.pi / 0.42
        e = {}
        s = np.sin(ph)
        legs(e, -0.75 * s, -0.75 * np.sin(ph - 0.35), 0.75 * s, 0.75 * np.sin(ph - 0.35))
        e['DSpine'] = (0.10 * np.sin(ph + 1.5), 0, 0); e['DChest'] = (-0.05 * np.sin(ph + 1.5), 0, 0)
        e['DNeck'] = (-0.15 + 0.08 * np.sin(ph), 0, 0); e['DHead'] = (0.2 - 0.08 * np.sin(ph), 0, 0)
        e['DTail1'] = (-0.3, 0.2 * np.sin(ph), 0); e['DTail2'] = (-0.2, 0, 0)
        e['DEarL'] = (-0.4 + 0.2 * np.sin(ph), 0, -0.2); e['DEarR'] = (-0.4 + 0.2 * np.sin(ph), 0, 0.2)
        e['DJaw'] = (0.25, 0, 0)
        return e, base_t + [0, 0.035 * abs(np.sin(ph)), 0]
    C['dog_run'] = (run, 0.84)
    def walk(t):
        ph = t * 2 * np.pi / 0.9
        e = {}
        legs(e, -0.4 * np.sin(ph), -0.4 * np.sin(ph + np.pi), 0.4 * np.sin(ph + np.pi), 0.4 * np.sin(ph))
        e['DHead'] = (0.1 + 0.04 * np.sin(ph * 2), 0.1 * np.sin(ph), 0)
        e['DTail1'] = (-0.1, 0.5 * np.sin(ph * 2), 0)
        e['DJaw'] = (0.15, 0, 0)
        return e, base_t + [0, 0.01 * np.sin(ph * 2), 0]
    C['dog_walk'] = (walk, 1.8)
    def idle(t):
        e = {}
        legs(e, 0, 0, 0, 0)
        e['DTail1'] = (-0.2, 0.55 * np.sin(t * 2 * np.pi * 3), 0); e['DTail2'] = (0, 0.3 * np.sin(t * 2 * np.pi * 3 - 0.8), 0)
        e['DHead'] = (0.0, 0.35 * np.sin(t * 2 * np.pi / 4), 0.15 * np.sin(t * 2 * np.pi / 4))
        e['DJaw'] = (0.2 + 0.08 * np.sin(t * 2 * np.pi * 3), 0, 0)
        e['DChest'] = (0.015 * np.sin(t * 2 * np.pi * 3), 0, 0)
        return e, base_t
    C['dog_idle'] = (idle, 4.0)
    def sit(t):
        e = {}
        e['DPelvis'] = (-0.55, 0, 0)
        e['DFLegL'] = (0.55, 0, 0); e['DFLegR'] = (0.55, 0, 0)
        e['DBLegL'] = (-1.05, 0, 0); e['DBLegR'] = (-1.05, 0, 0)
        e['DBLeg2L'] = (2.0, 0, 0); e['DBLeg2R'] = (2.0, 0, 0)
        e['DBPawL'] = (-0.4, 0, 0); e['DBPawR'] = (-0.4, 0, 0)
        e['DNeck'] = (0.25, 0, 0); e['DHead'] = (0.25, 0, 0.3 * np.sin(t * 2 * np.pi / 2))
        e['DTail1'] = (0.9, 0.5 * np.sin(t * 2 * np.pi * 2.5), 0)
        e['DJaw'] = (0.25 + 0.1 * np.sin(t * 2 * np.pi * 3), 0, 0)
        e['DEarL'] = (0.2, 0, -0.1 * np.sin(t * 2 * np.pi / 2)); e['DEarR'] = (0.2, 0, 0.1 * np.sin(t * 2 * np.pi / 2))
        return e, base_t + [0, -0.17, 0.02]
    C['dog_sit'] = (sit, 2.0)
    def eat(t):
        e = {}
        legs(e, 0.15, 0.15, 0, 0)
        e['DNeck'] = (0.85, 0, 0); e['DHead'] = (0.45, 0.1 * np.sin(t * 2 * np.pi * 2), 0)
        e['DJaw'] = (0.3 * abs(np.sin(t * 2 * np.pi * 3)), 0, 0)
        e['DTail1'] = (-0.2, 0.6 * np.sin(t * 2 * np.pi * 3.5), 0)
        e['DChest'] = (0.1, 0, 0)
        return e, base_t + [0, -0.01, 0]
    C['dog_eat'] = (eat, 1.0)
    return C

def bake_dog(fn, dur, fps=24):
    n = int(round(dur * fps)); ts = np.linspace(0, dur, n + 1)
    rot = np.zeros((len(DBONES), n + 1, 4)); tr = np.zeros((n + 1, 3))
    for k, t in enumerate(ts):
        tt = t if k < n else 0.0
        e, root = fn(tt)
        for i, (nm, _, _) in enumerate(DBONES):
            v = quat_euler(*e.get(nm, (0, 0, 0)))
            if k > 0 and np.dot(v, rot[i, k - 1]) < 0: v = -v
            rot[i, k] = v
        tr[k] = root
    return ts, rot, tr

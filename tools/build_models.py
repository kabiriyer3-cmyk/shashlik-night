"""Builds assets.glb: every mesh, texture, skeleton and animation in the game."""
import sys, os, time, gzip, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
OUT = os.path.join(HERE, '..', 'build')
os.makedirs(OUT, exist_ok=True)
from meshlib import *
import textures as TX
import env as E
import people as PP

t0 = time.time()
g = GLB()
TEX = {}
TEX['ground'] = g.image(TX.ground(512), 'JPEG', 82)
TEX['dirt'] = g.image(TX.dirt_patch(192), 'PNG')
TEX['birch'] = g.image(TX.birch_bark(256, 512), 'JPEG', 85)
TEX['bark'] = g.image(TX.generic_bark(256, 256, (0.36, 0.25, 0.16), 21, 6), 'JPEG', 85)
TEX['spruce_bark'] = g.image(TX.generic_bark(256, 256, (0.30, 0.22, 0.17), 25, 3), 'JPEG', 85)
TEX['wood'] = g.image(TX.wood_planks(256), 'JPEG', 85)
TEX['metal'] = g.image(TX.metal_rust(256), 'JPEG', 85)
TEX['leaf_birch'] = g.image(TX.leaves(512, 'birch', 51), 'PNG8')
TEX['leaf_spruce'] = g.image(TX.leaves(512, 'spruce', 52), 'PNG8')
TEX['stripes'] = g.image(TX.stripes(16, 32), 'PNG')
TEX['flannel'] = g.image(TX.flannel(128), 'JPEG', 88)
TEX['label'] = g.image(TX.charcoal_label(256, 256), 'JPEG', 88)
TEX['wood_end'] = g.image(TX.wood_end(128), 'JPEG', 85)
print('textures', round(time.time() - t0, 1))

M = {}
M['vc'] = g.material('vc', (1, 1, 1), rough=0.85)
M['vc_cloth'] = g.material('vc_cloth', (1, 1, 1), rough=0.92)
M['vc_skin'] = g.material('vc_skin', (1, 1, 1), rough=0.62)
M['vc_gloss'] = g.material('vc_gloss', (1, 1, 1), rough=0.22)
M['vc_metal'] = g.material('vc_metal', (1, 1, 1), metal=0.8, rough=0.38)
M['skewer'] = g.material('skewer', (0.82, 0.82, 0.84), metal=1.0, rough=0.25)
M['mangal'] = g.material('mangal', (1, 1, 1), metal=0.6, rough=0.72, tex=TEX['metal'])
M['hole'] = g.material('hole', (0.02, 0.02, 0.02), rough=1.0, emissive=(1.0, 0.4, 0.08))
M['coal'] = g.material('coal', (1, 1, 1), rough=0.95, emissive=(1.0, 0.32, 0.05))
M['meat'] = g.material('meat', (1, 1, 1), rough=0.5)
M['ground'] = g.material('ground', (1, 1, 1), rough=0.95, tex=TEX['ground'])
M['dirt'] = g.material('dirt', (1, 1, 1), rough=0.98, tex=TEX['dirt'], mode='BLEND')
M['birch'] = g.material('birch', (1, 1, 1), rough=0.8, tex=TEX['birch'])
M['bark'] = g.material('bark', (1, 1, 1), rough=0.9, tex=TEX['bark'])
M['spruce_bark'] = g.material('spruce_bark', (1, 1, 1), rough=0.9, tex=TEX['spruce_bark'])
M['wood'] = g.material('wood', (1, 1, 1), rough=0.75, tex=TEX['wood'])
M['wood_end'] = g.material('wood_end', (1, 1, 1), rough=0.8, tex=TEX['wood_end'])
M['leaf_birch'] = g.material('leaf_birch', (1, 1, 1), rough=0.75, tex=TEX['leaf_birch'], mode='MASK', cutoff=0.45)
M['leaf_spruce'] = g.material('leaf_spruce', (1, 1, 1), rough=0.85, tex=TEX['leaf_spruce'], mode='MASK', cutoff=0.4)
M['grass'] = g.material('grass', (1, 1, 1), rough=0.85, double=True)
M['stripes'] = g.material('stripes', (1, 1, 1), rough=0.9, tex=TEX['stripes'])
M['flannel'] = g.material('flannel', (1, 1, 1), rough=0.92, tex=TEX['flannel'])
M['label'] = g.material('label', (1, 1, 1), rough=0.9, tex=TEX['label'])
M['glass'] = g.material('glass', (1, 1, 1), rough=0.08, metal=0.1)
M['lamp'] = g.material('lamp', (1.0, 0.85, 0.6), rough=0.3, emissive=(1.0, 0.72, 0.4))
M['fabric'] = g.material('fabric', (1, 1, 1), rough=0.95, double=True)

def add(name, prims, extras=None):
    mi = g.mesh(name, prims)
    return g.node(name, mesh=mi, root=True, extras=extras)

# ---- world
add('ground', [(E.ground(), M['ground'])])
add('dirt_patch', [(E.dirt_patch(7.5), M['dirt'])])
mb, mh = E.mangal()
add('mangal', [(mb, M['mangal']), (mh, M['hole'])])
add('coals', [(E.coals(), M['coal'])])
add('skewer', [(E.skewer(), M['skewer'])])
for k in range(4): add(f'pork_{k}', [(E.chunk_pork(10 + k), M['meat'])])
for k in range(4): add(f'chicken_{k}', [(E.chunk_chicken(20 + k), M['meat'])])
add('lyulya', [(E.lyulya(30), M['meat'])])
for k in range(2): add(f'onion_{k}', [(E.onion(40 + k), M['meat'])])
add('pepper_r', [(E.pepper(50, True), M['meat'])])
add('pepper_g', [(E.pepper(51, False), M['meat'])])
add('tomato', [(E.tomato(52), M['meat'])])
add('mushroom', [(E.mushroom(53), M['meat'])])
add('zucchini', [(E.zucchini(54), M['meat'])])
add('bucket_pork', [(E.enamel_bucket('pork'), M['vc_gloss'])])
add('bowl_chicken', [(E.enamel_bowl('chicken'), M['vc_gloss'])])
add('crate_veg', [(E.veg_crate(), M['vc'])])
add('plate_lamb', [(E.lamb_plate(), M['vc_gloss'])])
ss_, st_, sp_ = E.serving_stool()
add('serving_stool', [(ss_, M['bark']), (st_, M['wood_end']), (sp_, M['vc_gloss'])])
pt, pl = E.prep_table()
add('prep_table', [(pt, M['wood']), (pl, M['vc_metal'])])
top, w, props, glass, lf, lg = E.picnic_table()
add('picnic_table', [(top, M['wood']), (w, M['wood']), (props, M['vc']), (glass, M['glass']), (lf, M['vc_metal'])])
add('lantern_glass', [(lg, M['lamp'])])
for k, col in enumerate([(0.18, 0.42, 0.22), (0.15, 0.3, 0.55), (0.6, 0.15, 0.12)]):
    fr, fab = E.camp_chair(col)
    add(f'chair_{k}', [(fr, M['vc_metal']), (fab, M['fabric'])])
ls, lc = E.log_seat()
add('log_seat', [(ls, M['bark']), (lc, M['wood_end'])])
fs, fe = E.firewood()
add('firewood', [(fs, M['bark']), (fe, M['wood_end'])])
ss, st, sh, sa = E.stump_axe()
add('stump_axe', [(ss, M['bark']), (st, M['wood_end']), (sh, M['vc']), (sa, M['vc_metal'])])
bb, bl, bf = E.charcoal_bag()
add('charcoal_bag', [(bb, M['label']), (bl, M['vc']), (bf, M['vc'])])
add('trash_bag', [(E.trash_bag(), M['vc_gloss'])])
td, tp = E.tent()
add('tent', [(td, M['fabric']), (tp, M['vc_metal'])])
gb, gm = E.guitar()
add('guitar', [(gb, M['vc_gloss']), (gm, M['vc_metal'])])
add('cup', [(E.cup(), M['vc_gloss'])])
add('mug', [(E.mug(), M['vc_gloss'])])
fh, fsl = E.fp_arm()
add('fp_arm', [(fh, M['vc_skin']), (fsl, M['flannel'])])
add('cardboard', [(E.cardboard(), M['vc'])])
add('spray', [(E.spray_bottle(), M['vc_gloss'])])
for k in range(3): add(f'rock_{k}', [(E.rock(60 + k), M['vc'])])
print('props', round(time.time() - t0, 1))
for k, (sd, H) in enumerate([(101, 11.5), (102, 13.0), (103, 9.5)]):
    wd, lv = E.birch(sd, H)
    add(f'birch_{k}', [(wd, M['birch']), (lv, M['leaf_birch'])])
for k, (sd, H) in enumerate([(201, 13.0), (202, 10.0)]):
    wd, lv = E.spruce(sd, H)
    add(f'spruce_{k}', [(wd, M['spruce_bark']), (lv, M['leaf_spruce'])])
add('bush_0', [(E.bush(301), M['leaf_birch'])])
add('grass_0', [(E.grass_clump(401), M['grass'])])
add('grass_1', [(E.grass_clump(402, True), M['grass'])])
print('trees', round(time.time() - t0, 1))

# ---- people
FRIENDS = {
    'A': dict(name='Vasya', skin=(0.86, 0.66, 0.54), shirt=(0.10, 0.13, 0.30), pants=(0.10, 0.13, 0.30), shoes=(0.08, 0.08, 0.09), sole=(0.9, 0.9, 0.9),
              top='tracksuit', hair=(0.30, 0.19, 0.11), hairstyle='short', beard=True, cap=(0.22, 0.2, 0.18), girth=1.1, belly=0.03, eyes=(0.25, 0.32, 0.4)),
    'B': dict(name='Lena', skin=(0.94, 0.78, 0.68), shirt=(0.46, 0.56, 0.42), pants=(0.22, 0.30, 0.48), shoes=(0.92, 0.92, 0.9), top='hoodie',
              hair=(0.36, 0.18, 0.08), hairstyle='ponytail', female=True, girth=0.92, eyes=(0.3, 0.45, 0.25)),
    'C': dict(name='Dima', skin=(0.88, 0.70, 0.58), shirt=(1, 1, 1), pants=(0.12, 0.12, 0.13), shoes=(0.4, 0.4, 0.42), top='stripes',
              hair=(0.09, 0.07, 0.05), hairstyle='curly', glasses=True, girth=0.97),
    'D': dict(name='Katya', skin=(0.95, 0.80, 0.70), shirt=(0.78, 0.16, 0.12), pants=(0.12, 0.12, 0.14), shoes=(0.35, 0.22, 0.12), sole=(0.2, 0.15, 0.1),
              top='puffer', hair=(0.86, 0.72, 0.45), hairstyle='long', female=True, girth=0.9, eyes=(0.25, 0.4, 0.6)),
}

def add_rig(prefix, bones, prims, rootname):
    idx = []
    for i, (n, p, pos) in enumerate(bones):
        t = np.array(pos, float) - (np.array(bones[p][2], float) if p >= 0 else 0)
        idx.append(g.node(prefix + n, t=t))
    for i, (n, p, pos) in enumerate(bones):
        if p >= 0: g.j['nodes'][idx[p]].setdefault('children', []).append(idx[i])
    ibm = [np.linalg.inv(T(*pos)).T.reshape(-1) for (_, _, pos) in bones]
    sk = g.skin(idx, ibm, idx[0])
    mi = g.mesh(rootname + '_mesh', prims)
    mn = g.node(rootname + '_mesh', mesh=mi, skin=sk)
    g.node(rootname, children=[mn, idx[0]], root=True)
    return idx

FRIENDS['P'] = dict(name='Chef', skin=(0.90, 0.72, 0.60), shirt=(1, 1, 1), pants=(0.16, 0.16, 0.18), shoes=(0.12, 0.10, 0.09), sole=(0.16, 0.13, 0.10),
              top='hoodie', hair=(0.28, 0.18, 0.10), hairstyle='short', cap=(1, 1, 1), girth=1.0, eyes=(0.3, 0.3, 0.25))
rig_nodes = {}
for key, cfg in FRIENDS.items():
    vc, gl, stp = PP.build_person(cfg)
    prims = [(vc, M['vc_cloth'])]
    if gl is not None: prims.append((gl, M['vc_gloss']))
    if stp is not None: prims.append((stp, M['stripes']))
    rig_nodes[key] = add_rig(key + '_', PP.BONES, prims, 'friend' + key)
    print('friend', key, vc.n + (gl.n if gl is not None else 0) + (stp.n if stp is not None else 0), 'verts', round(time.time() - t0, 1))

for name, (fn, dur) in PP.clip_specs().items():
    ts, vals = PP.bake_clip(fn, dur, 30 if name.startswith('stand_') else 20)
    ch = [(rig_nodes['A'][i], 'rotation', ts, vals[i]) for i in range(len(PP.BONES))]
    g.animation(name, ch)
print('anims', round(time.time() - t0, 1))

dm, dblk = PP.dog_mesh()
dog_idx = add_rig('', PP.DBONES, [(dm, M['vc_cloth']), (dblk, M['vc_gloss'])], 'dog')
for name, (fn, dur) in PP.dog_clips().items():
    ts, rot, tr = PP.bake_dog(fn, dur)
    ch = [(dog_idx[i], 'rotation', ts, rot[i]) for i in range(len(PP.DBONES))]
    ch.append((dog_idx[0], 'translation', ts, tr))
    g.animation(name, ch)

glb = os.path.join(OUT, 'assets.glb')
size = g.save(glb)
raw = open(glb, 'rb').read()
gz = gzip.compress(raw, 9, mtime=0)
open(os.path.join(OUT, 'assets.glb.gz'), 'wb').write(gz)
print('gz', len(gz))
print('GLB bytes', size, 'time', round(time.time() - t0, 1))

# Round 19 spectre: a gaunt, clawed upper-body ghost built from Blender Studio's CC0 Human Base Meshes v1.4.1
# (GEO-body_male_realistic). Run: blender -b -Y <bundle.blend> --python build_spectre.py -- <out.glb> <previewdir>
import bpy, bmesh, sys, os, math, json, heapq
from collections import deque
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
OUT_GLB, PREV = argv[0], argv[1]
os.makedirs(PREV, exist_ok=True)
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
LOG = {}
V = Vector

def sm(a, b, x):
    t = (x - a) / (b - a)
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    return t * t * (3 - 2 * t)

def seg(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return a + ab * t, t

sc = bpy.context.scene
src = bpy.data.objects['GEO-body_male_realistic']
me = src.data.copy(); me.name = 'SpectreMesh'
obj = bpy.data.objects.new('Spectre', me)
sc.collection.objects.link(obj)
for o in list(bpy.data.objects):
    if o is not obj:
        bpy.data.objects.remove(o, do_unlink=True)

# ---------------------------------------------------------------- cut below the hips, drop loose bits
bm = bmesh.new(); bm.from_mesh(me)
ZC = 0.93
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < ZC and abs(v.co.x) < 0.27], context='VERTS')
bm.verts.ensure_lookup_table(); bm.verts.index_update()

def build_adj():
    return [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]

def comps_idx(sel, adj):
    sel = set(sel); seen = set(); out = []
    for i in sel:
        if i in seen: continue
        st = [i]; seen.add(i); c = []
        while st:
            x = st.pop(); c.append(x)
            for y in adj[x]:
                if y in sel and y not in seen:
                    seen.add(y); st.append(y)
        out.append(c)
    return sorted(out, key=len, reverse=True)

adj = build_adj()
isl = comps_idx(range(len(bm.verts)), adj)
LOG['islands'] = [len(c) for c in isl][:8]
small = [bm.verts[i] for c in isl if len(c) < 200 for i in c]
if small:
    bmesh.ops.delete(bm, geom=small, context='VERTS')
    bm.verts.ensure_lookup_table(); bm.verts.index_update()
    adj = build_adj()
co = [v.co.copy() for v in bm.verts]
N = len(co)
LOG['verts_after_cut'] = N

def cen(ix):
    return sum((co[i] for i in ix), V()) / len(ix)

# ---------------------------------------------------------------- A-pose landmarks (left; mirrored by side)
S0, E0, W0 = V((0.19, 0.0, 1.385)), V((0.275, 0.005, 1.11)), V((0.367, -0.05, 0.905))
L1, L2 = (E0 - S0).length, (W0 - E0).length
ZM = 1.4995                      # lip line

def arm_param(p):                # p mirrored to the left side
    c1, t1 = seg(p, S0, E0); c2, t2 = seg(p, E0, W0)
    if (p - c1).length <= (p - c2).length:
        return c1, t1 * L1, (p - c1).length
    return c2, L1 + t2 * L2, (p - c2).length

def jaw_w(p):
    ax = abs(p.x)
    if ax > 0.085 or p.y > 0.005 or p.z > 1.53 or p.z < 1.38: return 0.0
    hw = 0.0025 + max(0.0, ax - 0.026)
    return sm(ZM + hw, ZM - hw, p.z) * sm(0.0, -0.045, p.y) * sm(1.405, 1.455, p.z) * (1 - sm(0.065, 0.085, ax))

JAW = [jaw_w(c) for c in co]
# the lips touch, so a z threshold tears the lower lip: inside the mouth, split the jaw by which lip a vertex is
# geodesically nearer (the slit forces paths from one lip to the other round the corners or through the mouth bag)
MR = [i for i, c in enumerate(co) if abs(c.x) < 0.05 and 1.455 < c.z < 1.55 and -0.175 < c.y < -0.04]
MRS = set(MR)
def geod(seeds):
    D = {i: 0.0 for i in seeds}; hq = [(0.0, i) for i in seeds]
    while hq:
        d, i = heapq.heappop(hq)
        if d > D[i]: continue
        for j in adj[i]:
            if j in MRS:
                nd = d + (co[i] - co[j]).length
                if nd < D.get(j, 9.0):
                    D[j] = nd; heapq.heappush(hq, (nd, j))
    return D
DU = geod([i for i in MR if abs(co[i].x) < 0.01 and co[i].z > 1.515 and co[i].y < -0.15])
DL = geod([i for i in MR if abs(co[i].x) < 0.01 and co[i].z < 1.475 and co[i].y < -0.13])
for i in MR:
    c = co[i]; du, dl = DU.get(i, 9.0), DL.get(i, 9.0)
    m = (1 - sm(0.034, 0.05, abs(c.x))) * sm(1.455, 1.468, c.z) * (1 - sm(1.535, 1.55, c.z))
    JAW[i] += (sm(0.4, 0.6, du / (du + dl)) - JAW[i]) * m
LOG['jaw_mid'] = [(round(co[i].y, 4), round(co[i].z, 4), round(JAW[i], 2)) for i in sorted(MR, key=lambda i: co[i].z) if abs(co[i].x) < 0.0015 and co[i].y < -0.135]
ISARM = [0.0] * N
for i, c in enumerate(co):
    p = V((abs(c.x), c.y, c.z))
    if p.x > 0.15:
        _, a, r = arm_param(p)
        ISARM[i] = sm(0.03, 0.09, a) * (1 - sm(0.06, 0.085, r))

# ---------------------------------------------------------------- hands: fingers by connectivity, then multi-source BFS
HANDS = {}
LAB = [None] * N
U = [0.0] * N
HS = [0.0] * N
for side, tg in ((1, 'L'), (-1, 'R')):
    hand = [i for i, c in enumerate(co) if c.x * side > 0.3 and c.z < 0.93]
    W = cen([i for i in hand if 0.895 <= co[i].z < 0.915])
    T = cen([i for i in hand if co[i].z < 0.74])
    ax = (T - W).normalized()
    s = {i: (co[i] - W).dot(ax) for i in hand}
    for i in hand: HS[i] = s[i]
    fing = [c for c in comps_idx([i for i in hand if s[i] > 0.15], adj) if len(c) > 15]
    th = [c for c in comps_idx([i for i in hand if s[i] > 0.10], adj) if len(c) > 10 and max(s[i] for i in c) < 0.15]
    LOG['fingers_' + tg] = [len(c) for c in fing]; LOG['thumb_' + tg] = [len(c) for c in th]
    assert len(fing) == 4 and len(th) == 1, (len(fing), len(th))
    fing.sort(key=lambda c: cen(c).y)              # thumb side (front, -y) first
    names = ['index', 'middle', 'ring', 'pinky']
    lab = {}
    for i in hand:
        if -0.03 <= s[i] <= 0.06: lab[i] = 'palm'
    for n, c in zip(names, fing):
        for i in c: lab[i] = n
    for i in th[0]: lab[i] = 'thumb'
    region = set(i for i in hand if s[i] > -0.03)
    dq = deque(lab.keys())
    while dq:
        x = dq.popleft()
        for y in adj[x]:
            if y in region and y not in lab:
                lab[y] = lab[x]; dq.append(y)
    # palm normal (A-pose: palms face the thighs)
    med = V((-side, 0, 0))
    pn = (med - ax * med.dot(ax)).normalized()
    info = {'W': W, 'ax': ax, 'pn': pn, 'f': {}}
    for n in names + ['thumb']:
        R = [i for i in hand if lab.get(i) == n]
        bnd = [i for i in R if any(lab.get(j) == 'palm' for j in adj[i])]
        B = cen(bnd) if bnd else cen(R)
        tip_i = max(R, key=lambda i: (co[i] - W).length) if n == 'thumb' else max(R, key=lambda i: s[i])
        tip = co[tip_i].copy()
        d = (tip - B); Lf = d.length; d.normalize()
        u = {i: (co[i] - B).dot(d) / Lf for i in R}
        nb = 8
        cl = []
        for k in range(nb):
            ix = [i for i in R if k / nb <= u[i] < (k + 1) / nb]
            cl.append(cen(ix) if ix else B + d * Lf * (k + 0.5) / nb)
        def cl_at(t, cl=cl):
            x = t * nb - 0.5
            k = math.floor(x)
            if k < 0: return cl[0].copy()
            if k >= nb - 1: return cl[-1].copy()
            return cl[k].lerp(cl[k + 1], x - k)
        EL = 0.25 if n == 'thumb' else 0.48
        TX = 0.018
        for i in R:
            uu = u[i]
            c0 = cl_at(max(0.0, min(1.0, uu)))
            off = co[i] - c0
            along = off.dot(d); perp = off - d * along
            taper = (1 - 0.72 * sm(0.62, 1.02, uu)) * (1 - 0.22 * sm(0.05, 0.6, uu))
            co[i] = c0 + d * along + perp * taper + d * (Lf * EL * max(0.0, uu) + TX * sm(0.80, 1.02, uu))
            LAB[i] = (tg, n); U[i] = uu
        clnew = lambda t, cl_at=cl_at, d=d, Lf=Lf, EL=EL: cl_at(t) + d * Lf * EL * t
        tipn = tip + d * (Lf * EL + TX)
        if n == 'thumb':
            joints = [B, clnew(0.55), tipn - d * 0.004]
        else:
            joints = [B, clnew(0.45), clnew(0.75), tipn - d * 0.004]
        info['f'][n] = joints
        LOG.setdefault('flen_' + tg, {})[n] = round(Lf, 4)
    HANDS[tg] = info

# ---------------------------------------------------------------- gaunt: thin neck and torso, bony arms, sunken face
EYE = V((0.033, -0.122, 1.574))
DARK = [0.0] * N
for i in range(N):
    c = co[i]; sx = 1 if c.x >= 0 else -1
    p = V((abs(c.x), c.y, c.z))
    if LAB[i] is None and p.x > 0.15:                     # bony arms (not hands)
        cc, a, r = arm_param(p)
        w = sm(0.05, 0.11, a) * (1 - sm(L1 + L2 - 0.03, L1 + L2 + 0.01, a)) * (1 - sm(0.055, 0.08, r))
        if w > 0:
            p = cc + (p - cc) * (1 - 0.27 * w)
    if p.x < 0.205 and p.z < 1.40 and ISARM[i] < 0.5:      # narrow ribcage, slim waist, sunken belly
        wa = 1 - ISARM[i] * 2
        w = sm(1.40, 1.15, p.z) * wa
        ww = (1 - sm(1.30, 1.40, p.z)) * wa
        p.x *= 1 - 0.07 * ww - 0.05 * w
        p.y = -0.03 + (p.y + 0.03) * (1 - 0.08 * w)
        if p.y < -0.06:
            p.y += 0.016 * sm(-0.06, -0.12, p.y) * (1 - sm(0.0, 0.10, abs(p.z - 1.09)))
            p.y += 0.010 * sm(-0.07, -0.12, p.y) * (1 - sm(0.0, 0.06, abs(p.z - 1.28))) * sm(0.03, 0.08, p.x)
    if 1.36 < p.z < 1.50 and p.x < 0.09:                   # thin, stringy neck
        w = sm(1.36, 1.42, p.z) * (1 - sm(1.46, 1.50, p.z)) * (1 - sm(0.06, 0.09, p.x))
        ctr = V((0, -0.02, p.z))
        p = ctr + (p - ctr) * (1 - 0.15 * w)
    if p.z > 1.44:                                        # face
        d = (p - EYE).length                               # deep, dark eye pits
        if p.y > -0.175: p.y += 0.009 * (1 - sm(0.012, 0.034, d)) + 0.016 * (1 - sm(0.0115, 0.0145, d))
        DARK[i] = max(DARK[i], 1 - sm(0.0125, 0.0175, d))
        d = (p - V((0.052, -0.098, 1.508))).length         # hollow cheeks under the cheekbones
        w = 1 - sm(0.008, 0.036, d)
        if w > 0:
            dirv = V((-p.x, -0.04 - p.y, 0)).normalized()
            p += dirv * 0.016 * w
        d = (p - V((0.066, -0.07, 1.60))).length           # hollow temples
        p.x -= 0.008 * (1 - sm(0.006, 0.030, d))
    co[i] = V((p.x * sx, p.y, p.z))

for i, v in enumerate(bm.verts):
    v.co = co[i]
bm.to_mesh(me); bm.free()
try: me.shade_smooth()
except Exception: [setattr(p, 'use_smooth', True) for p in me.polygons]

def ao_bake(nray=40, dist=0.06):
    bvh = BVHTree.FromPolygons([v.co for v in me.vertices], [p.vertices[:] for p in me.polygons])
    dirs = []
    for k in range(nray):
        u1 = (k + 0.5) / nray; u2 = (k * 0.618034) % 1.0
        r = math.sqrt(u1); th = 2 * math.pi * u2
        dirs.append(V((r * math.cos(th), r * math.sin(th), math.sqrt(1 - u1))))
    up = V((0, 0, 1)); out = []
    for v in me.vertices:
        n = v.normal; q = up.rotation_difference(n); o = v.co + n * 0.0008
        occ = 0.0
        for dv in dirs:
            hit = bvh.ray_cast(o, q @ dv, dist)
            if hit[0] is not None: occ += 1.0 - 0.5 * hit[3] / dist
        out.append(1.0 - occ / nray)
    nb = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices; nb[a].append(b); nb[b].append(a)
    return [0.5 * out[i] + 0.5 * (sum(out[j] for j in nb[i]) / len(nb[i]) if nb[i] else out[i]) for i in range(len(out))]
# ---------------------------------------------------------------- per-vertex data: (ao, waist fade, hand mask, claw tip)
GH = []
for i, c in enumerate(co):
    fade = 1.0 if ISARM[i] > 0.5 or abs(c.x) > 0.25 else sm(ZC + 0.005, 1.13, c.z)
    hand = 1.0 if LAB[i] else (sm(-0.02, 0.03, HS[i]) if abs(c.x) > 0.3 and c.z < 0.95 else 0.0)
    claw = sm(0.55, 1.0, U[i]) if LAB[i] else 0.0
    GH.append((1.0, fade, hand, claw))
AO0 = ao_bake(48, 0.05)
AOL = ao_bake(48, 0.16)
DARK = [max(DARK[i], (1 - sm(0.12, 0.35, AOL[i])) if co[i].z > 1.42 else 0.0) for i in range(N)]
for i, v in enumerate(me.vertices):                  # mouth interior: inside the lips, facing into the cavity
    c = v.co
    if abs(c.x) < 0.042 and 1.468 < c.z < 1.548 and -0.147 < c.y < -0.045 and v.normal.y > -0.45:
        DARK[i] = max(DARK[i], (1 - sm(0.03, 0.042, abs(c.x))) * sm(-0.147, -0.138, c.y))
LOG['dark_verts'] = sum(1 for x in DARK if x > 0.5)
LOG['mid'] = sorted([(round(v.co.y, 4), round(v.co.z, 4), round(v.normal.y, 2), round(v.normal.z, 2), round(DARK[i], 2), round(AO0[i], 2), round(AOL[i], 2), round(JAW[i], 2)) for i, v in enumerate(me.vertices) if abs(v.co.x) < 0.004 and 1.43 < v.co.z < 1.57 and v.co.y > -0.18], key=lambda t: (t[1], t[0]))
if '--debug-stop' in argv: json.dump(LOG, open(os.path.join(PREV, 'build.json'), 'w'), indent=0, default=str); raise SystemExit
GH = [(min(AO0[i], 1 - 0.85 * DARK[i]),) + g[1:] for i, g in enumerate(GH)]
att = me.color_attributes.new('ghost', 'FLOAT_COLOR', 'POINT')
for i, g in enumerate(GH): att.data[i].color = g
dg = obj.vertex_groups.new(name='decim')
for i, c in enumerate(co):
    face = c.z > 1.44 and c.y < -0.05
    dg.add([i], 0.25 if face else 0.35 if LAB[i] else 1.0, 'REPLACE')

# ---------------------------------------------------------------- armature (A-pose)
ad = bpy.data.armatures.new('SpectreRig'); arm = bpy.data.objects.new('SpectreRig', ad)
sc.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
EB = ad.edit_bones
def add(name, h, t, parent=None, conn=False):
    b = EB.new(name); b.head = h; b.tail = t; b.roll = 0
    if parent:
        b.parent = EB[parent]; b.use_connect = conn
    return b
add('hips', V((0, -0.02, 0.95)), V((0, -0.02, 1.08)))
add('spine', V((0, -0.02, 1.08)), V((0, -0.03, 1.24)), 'hips', True)
add('chest', V((0, -0.03, 1.24)), V((0, -0.02, 1.42)), 'spine', True)
add('neck', V((0, -0.02, 1.42)), V((0, -0.03, 1.515)), 'chest', True)
add('head', V((0, -0.03, 1.515)), V((0, -0.03, 1.70)), 'neck', True)
add('jaw', V((0, -0.025, 1.535)), V((0, -0.13, 1.462)), 'head')
FINGER_BONES = []
for side, tg in ((1, 'L'), (-1, 'R')):
    M = lambda v: V((v.x * side, v.y, v.z))
    h = HANDS[tg]
    add('clavicle_' + tg, M(V((0.025, -0.02, 1.41))), M(S0), 'chest')
    add('upper_arm_' + tg, M(S0), M(E0), 'clavicle_' + tg, True)
    add('forearm_' + tg, M(E0), h['W'], 'upper_arm_' + tg, True)
    add('hand_' + tg, h['W'], h['f']['middle'][0], 'forearm_' + tg, True)
    for n, js in h['f'].items():
        par = 'hand_' + tg
        for k in range(len(js) - 1):
            nm = '%s_%d_%s' % (n, k + 1, tg)
            add(nm, js[k], js[k + 1], par, k > 0)
            par = nm; FINGER_BONES.append(nm)
bpy.ops.object.mode_set(mode='OBJECT')
for nm in FINGER_BONES + ['jaw']:
    ad.bones[nm].use_deform = False

for o in sc.objects: o.select_set(False)
obj.select_set(True); arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
for nm in FINGER_BONES + ['jaw']:
    ad.bones[nm].use_deform = True

# ---------------------------------------------------------------- custom weights: fingers, thumbs, jaw
VG = {g.name: g for g in obj.vertex_groups}
def vg(name):
    if name not in VG: VG[name] = obj.vertex_groups.new(name=name)
    return VG[name]
gid = {g.index: g for g in obj.vertex_groups}
zero = 0
for i, v in enumerate(me.vertices):
    ws = {gid[e.group].name: e.weight for e in v.groups if gid[e.group].name != 'decim'}
    tot = sum(ws.values())
    if tot < 1e-4:
        zero += 1
        p = co[i]; best = None
        for b in ad.bones:
            if not b.use_deform or b.name in FINGER_BONES or b.name == 'jaw': continue
            dd = (seg(p, b.head_local, b.tail_local)[0] - p).length
            if best is None or dd < best[0]: best = (dd, b.name)
        ws = {best[1]: 1.0}; tot = 1.0
    ws = {k: w / tot for k, w in ws.items()}
    if LAB[i]:
        tg, n = LAB[i]; u = U[i]
        if n == 'thumb':
            b0 = 1 - sm(-0.15, 0.08, u); b2 = sm(0.48, 0.62, u); bs = [1 - b0 - b2, b2]
        else:
            b0 = 1 - sm(-0.15, 0.05, u); b2 = sm(0.39, 0.51, u); b3 = sm(0.70, 0.80, u)
            bs = [1 - b0 - (b2 - b3) - b3, b2 - b3, b3]
        ws = {k: w * b0 for k, w in ws.items()}
        for k, bw in enumerate(bs):
            ws['%s_%d_%s' % (n, k + 1, tg)] = max(0.0, bw)
    wj = JAW[i]
    if wj > 0:
        ws = {k: w * (1 - wj) for k, w in ws.items()}; ws['jaw'] = wj
    for g in list(v.groups):
        nm = gid[g.group].name
        if nm != 'decim' and nm not in ws: gid[g.group].remove([i])
    for k, w in ws.items():
        vg(k).add([i], w, 'REPLACE')
    gid = {g.index: g for g in obj.vertex_groups}
LOG['heat_zero_weight_verts'] = zero

# ---------------------------------------------------------------- posing by world-space operations
REF = {}   # rest-space reference vectors: palm normal per hand, flex axis per finger bone
for tg in ('L', 'R'):
    REF['pn_' + tg] = HANDS[tg]['pn'].copy()
    for nm in FINGER_BONES:
        if nm.endswith('_' + tg):
            b = ad.bones[nm]
            d = (b.tail_local - b.head_local).normalized()
            REF['fx_' + nm] = d.cross(HANDS[tg]['pn']).normalized()

def order():
    out = []
    def rec(b):
        out.append(b)
        for c in b.children: rec(c)
    for b in ad.bones:
        if b.parent is None: rec(b)
    return out

def rot(axis, ang):
    return Matrix.Rotation(ang, 3, axis.normalized())

def pose(spec):
    rest = {b.name: b.matrix_local.copy() for b in ad.bones}
    posed = {}
    for b in order():
        Br = rest[b.name]
        if b.parent:
            Minh = posed[b.parent.name] @ rest[b.parent.name].inverted() @ Br
        else:
            Minh = Br.copy()
        Rin = Minh.to_3x3() @ Br.to_3x3().inverted()
        R = Matrix.Identity(3); tv = V((0, 0, 0))
        tg = b.name[-1] if b.name[-2:] in ('_L', '_R') else None
        for op in spec.get(b.name, []):
            cur = R @ Minh.to_3x3()
            d = cur.col[1].normalized()
            if op[0] == 'aim':
                R = d.rotation_difference(op[1].normalized()).to_matrix() @ R
            elif op[0] == 'palm':
                n = (R @ Rin @ REF['pn_' + tg]); t = op[1]
                n = (n - d * n.dot(d)).normalized(); t = (t - d * t.dot(d)).normalized()
                ang = math.atan2(n.cross(t).dot(d), n.dot(t))
                R = rot(d, ang) @ R
                LOG.setdefault('palm_twist', {})[b.name] = round(math.degrees(ang), 1)
            elif op[0] == 'flex':
                R = rot(R @ Rin @ REF['fx_' + b.name], op[1]) @ R
            elif op[0] == 'spread':
                R = rot(R @ Rin @ REF['pn_' + tg], op[1]) @ R
            elif op[0] == 'rot':
                R = rot(op[1], op[2]) @ R
            elif op[0] == 'move':
                tv = tv + op[1]
        h = Minh.translation.copy()
        Mp = Matrix.Translation(tv + h) @ R.to_4x4() @ Matrix.Translation(-h) @ Minh
        posed[b.name] = Mp
        pb = arm.pose.bones[b.name]
        if b.parent:
            Pp, Pr = posed[b.parent.name], rest[b.parent.name]
            pb.matrix_basis = (Pr.inverted() @ Br).inverted() @ Pp.inverted() @ Mp
        else:
            pb.matrix_basis = Br.inverted() @ Mp
    bpy.context.view_layer.update()
    return posed

def mir(side):
    return lambda x, y, z: V((x * side, y, z))

def claw_spec():
    sp = {'spine': [('aim', V((0, -0.07, 1)))], 'chest': [('aim', V((0, -0.12, 1)))],
          'neck': [('aim', V((0, -0.35, 1)))], 'head': [('aim', V((0, 0.06, 1)))],
          'jaw': [('rot', V((1, 0, 0)), 0.45), ('move', V((0, -0.026, -0.004)))]}
    for side, tg in ((1, 'L'), (-1, 'R')):
        M = mir(side)
        sp['clavicle_' + tg] = [('aim', M(1, 0.0, 0.22))]
        sp['upper_arm_' + tg] = [('aim', M(0.70, -0.55, -0.22))]
        sp['forearm_' + tg] = [('aim', M(-0.22, -0.72, 0.62))]
        sp['hand_' + tg] = [('aim', M(-0.03, -0.40, 1.0)), ('palm', V((0, -1, 0.25)))]
        for f, spr in (('index', -0.14), ('middle', -0.04), ('ring', 0.06), ('pinky', 0.16)):
            sp['%s_1_%s' % (f, tg)] = [('spread', spr * side), ('flex', 0.55)]
            sp['%s_2_%s' % (f, tg)] = [('flex', 0.95)]
            sp['%s_3_%s' % (f, tg)] = [('flex', 0.75)]
        sp['thumb_1_' + tg] = [('flex', 0.45)]
        sp['thumb_2_' + tg] = [('flex', 0.55)]
    return sp

def reach_spec():
    sp = {'head': [('rot', V((1, 0, 0)), -0.12)], 'jaw': [('rot', V((1, 0, 0)), 0.10), ('move', V((0, -0.006, 0)))]}
    for side, tg in ((1, 'L'), (-1, 'R')):
        M = mir(side)
        sp['clavicle_' + tg] = [('aim', M(1, -0.25, 0.15))]
        sp['upper_arm_' + tg] = [('aim', M(0.35, -1.0, 0.12))]
        sp['forearm_' + tg] = [('aim', M(0.06, -1.0, 0.16))]
        sp['hand_' + tg] = [('aim', M(0.0, -1.0, 0.40)), ('palm', V((0, -0.35, -1)))]
        for f, spr in (('index', -0.10), ('middle', -0.03), ('ring', 0.04), ('pinky', 0.10)):
            sp['%s_1_%s' % (f, tg)] = [('spread', spr * side), ('flex', -0.25)]
            sp['%s_2_%s' % (f, tg)] = [('flex', -0.25)]
        sp['thumb_1_' + tg] = [('flex', -0.2)]
    return sp

def clench_spec():
    sp = {}
    for tg in ('L', 'R'):
        for f in ('index', 'middle', 'ring', 'pinky'):
            sp['%s_1_%s' % (f, tg)] = [('flex', 0.30)]
            sp['%s_2_%s' % (f, tg)] = [('flex', 0.35)]
            sp['%s_3_%s' % (f, tg)] = [('flex', 0.30)]
        sp['thumb_1_' + tg] = [('flex', 0.25)]
        sp['thumb_2_' + tg] = [('flex', 0.25)]
    return sp

def scream_spec():
    return {'head': [('rot', V((1, 0, 0)), -0.14)], 'jaw': [('rot', V((1, 0, 0)), 0.24), ('move', V((0, -0.014, -0.003)))]}

def clear_pose():
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()

def ctx(o):
    return bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o])

# ---------------------------------------------------------------- claw pose becomes the rest pose
posed = pose(claw_spec())
for tg in ('L', 'R'):
    hb = ad.bones['hand_' + tg]
    REF['pn_' + tg] = (posed['hand_' + tg].to_3x3() @ hb.matrix_local.to_3x3().inverted()) @ REF['pn_' + tg]
    for nm in FINGER_BONES:
        if nm.endswith('_' + tg):
            b = ad.bones[nm]
            REF['fx_' + nm] = (posed[nm].to_3x3() @ b.matrix_local.to_3x3().inverted()) @ REF['fx_' + nm]
with ctx(obj):
    bpy.ops.object.modifier_apply(modifier=obj.modifiers[0].name)
bpy.context.view_layer.objects.active = arm
for o in sc.objects: o.select_set(o is arm)
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- decimate (face and hands protected), re-bind
tris0 = sum(len(p.vertices) - 2 for p in me.polygons)
TARGET = 9000
dm = obj.modifiers.new('dec', 'DECIMATE')
dm.decimate_type = 'COLLAPSE'; dm.ratio = min(1.0, TARGET / tris0)
dm.vertex_group = 'decim'; dm.vertex_group_factor = 1.0
dm.use_symmetry = True; dm.symmetry_axis = 'X'
with ctx(obj):
    bpy.ops.object.modifier_apply(modifier=dm.name)
obj.vertex_groups.remove(obj.vertex_groups['decim'])
am = obj.modifiers.new('Armature', 'ARMATURE'); am.object = arm
LOG['tris_before_decimate'] = tris0
LOG['tris'] = sum(len(p.vertices) - 2 for p in me.polygons)
LOG['verts'] = len(me.vertices)

# ---------------------------------------------------------------- ambient occlusion: min of the pre-pose cavity bake and the posed bake
AO = ao_bake()
att = me.color_attributes['ghost']
for i, a in enumerate(AO):
    c = att.data[i].color; att.data[i].color = (min(a, c[0]), c[1], c[2], c[3])
LOG['ao_min_mean'] = [round(min(AO), 3), round(sum(AO) / len(AO), 3)]
JG = obj.vertex_groups['jaw'].index
def _jw(v):
    for g in v.groups:
        if g.group == JG: return g.weight
    return 0.0
LOG['open_box'] = sorted([(round(v.co.x, 4), round(v.co.y, 4), round(v.co.z, 4), round(v.normal.y, 2), round(v.normal.z, 2), round(att.data[i].color[0], 2), round(_jw(v), 2)) for i, v in enumerate(me.vertices) if abs(v.co.x) < 0.03 and 1.40 < v.co.z < 1.49 and v.co.y < -0.12], key=lambda t: (t[2], t[0]))
LOG['mouth_faces'] = [(round(p.center.x, 3), round(p.center.y, 3), round(p.center.z, 3), round(p.area * 1e4, 2), [round(att.data[k].color[0], 2) for k in p.vertices]) for p in me.polygons if abs(p.center.x) < 0.02 and 1.445 < p.center.z < 1.49 and p.center.y < -0.17]
LOG['mid_posed'] = sorted([(round(v.co.y, 4), round(v.co.z, 4), round(v.normal.y, 2), round(v.normal.z, 2), round(att.data[i].color[0], 2), round(_jw(v), 2)) for i, v in enumerate(me.vertices) if abs(v.co.x) < 0.006 and 1.36 < v.co.z < 1.53 and v.co.y < -0.02], key=lambda t: (t[1], t[0]))

if '--debug-mouth' in argv: json.dump(LOG, open(os.path.join(PREV, 'build.json'), 'w'), indent=0, default=str); raise SystemExit

# ---------------------------------------------------------------- previews (workbench, AO greys)
pv = me.color_attributes.new('aoprev', 'FLOAT_COLOR', 'POINT')
for i, a in enumerate(AO):
    g = att.data[i].color; a = g[0]
    a = a ** 2.2
    pv.data[i].color = (a * (0.75 + 0.25 * g[2]), a * (0.85 + 0.1 * g[1]), a * (1 - 0.35 * g[2]), 1)
me.color_attributes.active_color = pv
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'VERTEX'
sc.view_settings.view_transform = 'Standard'
sc.render.resolution_x, sc.render.resolution_y = 560, 720
camd = bpy.data.cameras.new('pc'); cam = bpy.data.objects.new('pc', camd); sc.collection.objects.link(cam)
sc.camera = cam
def shot(name, loc, tgt, lens=50):
    cam.location = loc
    cam.rotation_euler = (V(tgt) - V(loc)).to_track_quat('-Z', 'Y').to_euler()
    camd.lens = lens
    sc.render.filepath = os.path.join(PREV, name + '.png')
    bpy.ops.render.render(write_still=True)
shot('claw_front', (0, -3.4, 1.35), (0, 0, 1.35))
shot('claw_34', (1.7, -2.7, 1.5), (0, 0, 1.35))
shot('claw_face', (0.12, -0.8, 1.58), (0, 0, 1.54), 60)
shot('face_side', (0.5, -0.75, 1.50), (0, -0.1, 1.53), 70)
shot('mouth_low', (0.0, -0.5, 1.40), (0, -0.1, 1.49), 75)
HP = arm.matrix_world @ ad.bones['middle_1_L'].head_local
LOG['hand_L_pos'] = [round(x, 3) for x in HP]
shot('claw_hand', HP + V((-0.12, -0.42, 0.04)), HP, 60)
EP = obj.matrix_world @ me.vertices[max(range(len(me.vertices)), key=lambda k: me.vertices[k].co.z)].co
LOG['head_top'] = [round(x, 3) for x in EP]
pose(reach_spec())
shot('reach_side', (2.9, -0.9, 1.4), (0, -0.25, 1.3))
clear_pose()
pose(clench_spec()); pose_scream = None
shot('clench_front', (0, -3.4, 1.35), (0, 0, 1.35))
clear_pose()
me.color_attributes.remove(pv)
me.color_attributes.active_color = me.color_attributes['ghost']
try:
    me.color_attributes.active_color_name = 'ghost'; me.color_attributes.default_color_name = 'ghost'
except Exception as e:
    LOG['color_name_err'] = str(e)

# ---------------------------------------------------------------- pose clips: reach, clench, scream (frame 0 rest, frame 10 pose)
ANIM = arm.animation_data_create()
for name, fn in (('reach', reach_spec), ('clench', clench_spec), ('scream', scream_spec)):
    act = bpy.data.actions.new(name); act.use_fake_user = True
    ANIM.action = act
    clear_pose()
    for pb in arm.pose.bones: pb.keyframe_insert('rotation_quaternion', frame=0); pb.keyframe_insert('location', frame=0)
    pose(fn())
    for pb in arm.pose.bones: pb.keyframe_insert('rotation_quaternion', frame=10); pb.keyframe_insert('location', frame=10)
    tr = ANIM.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, 0, act)
    ANIM.action = None
clear_pose()
LOG['actions'] = [a.name for a in bpy.data.actions]

# ---------------------------------------------------------------- export
for o in sc.objects: o.select_set(o in (obj, arm))
bpy.context.view_layer.objects.active = arm
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
LOG['gltf_props'] = [p for p in props if 'color' in p or 'anim' in p or 'skin' in p or 'influence' in p]
kw = dict(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_apply=False,
          export_texcoords=False, export_normals=True, export_tangents=False, export_materials='NONE',
          export_skins=True, export_morph=False, export_animations=True, export_yup=True,
          export_cameras=False, export_lights=False, export_extras=False)
opt = {'export_vertex_color': 'ACTIVE', 'export_all_vertex_colors': False,
       'export_active_vertex_color_when_no_material': True, 'export_colors': True,
       'export_animation_mode': 'NLA_TRACKS', 'export_all_influences': False,
       'export_optimize_animation_size': True, 'export_force_sampling': True,
       'export_frame_range': False, 'export_def_bones': False}
for k, v in opt.items():
    if k in props: kw[k] = v
LOG['export_kw'] = {k: v for k, v in kw.items() if k != 'filepath'}
bpy.ops.export_scene.gltf(**kw)
LOG['glb_bytes'] = os.path.getsize(OUT_GLB)
LOG['bones'] = [b.name for b in ad.bones]
json.dump(LOG, open(os.path.join(PREV, 'build.json'), 'w'), indent=1, default=str)

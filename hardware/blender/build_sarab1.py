"""SARAB-1 detailed 3D model for Blender, built from the shared part list.

Reads src/parts-data.js (written by hardware/build_model.py), so every size and position matches the
Tinkercad STLs and the foam cut list, then adds the detail the website and the renders need: bevelled
foam with real cut-outs, boards with their chips, pins and connectors, and the wiring from the firmware's
pin table. Textures come from hardware/blender/textures/ (drawn by textures.html).

Inside Blender: open this file in the Scripting tab and press Run Script. It builds into a scene called
SARAB-1 and leaves every other scene alone.
From a terminal, to rebuild the website model (assets/sarab1.glb) and hardware/blender/sarab1.blend:
  blender --background --factory-startup --python hardware/blender/build_sarab1.py -- --export
Units: 1 Blender unit = 1 mm, origin at the centre of the base, z up (same as the part list).
"""
import bpy, bmesh, json, math, os, re, sys
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TEXDIR = os.path.join(ROOT, 'hardware', 'blender', 'textures')
GLB = os.path.join(ROOT, 'assets', 'sarab1.glb')
BLEND = os.path.join(ROOT, 'hardware', 'blender', 'sarab1.blend')
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

_src = open(os.path.join(ROOT, 'src', 'parts-data.js'), encoding='utf-8').read()
PARTS = json.loads(re.search(r'export const PARTS = (\[.*\]);', _src, re.S).group(1))
P = {p['id']: p for p in PARTS}
PANEL_IDS = {'base', 'top_plate', 'wall_xp', 'wall_xn', 'wall_yp', 'wall_yn', 'port_usb', 'port_chg'}
sub_of = lambda p: 'panels' if p['id'] in PANEL_IDS else p['sub']

# ---------------------------------------------------------------- scene
BG = bpy.app.background
if BG:
    scn = bpy.context.scene
    scn.name = 'SARAB-1'
    for ob in list(scn.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
else:
    scn = bpy.data.scenes.get('SARAB-1') or bpy.data.scenes.new('SARAB-1')
    win = bpy.context.window or bpy.context.window_manager.windows[0]
    win.scene = scn
old = bpy.data.collections.get('SARAB-1')
if old:
    for ob in list(old.all_objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for c in list(old.children_recursive):
        bpy.data.collections.remove(c)
    bpy.data.collections.remove(old)
for store in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
    for d in list(store):
        if d.name.startswith('S1_') and d.users == 0:
            store.remove(d)
us = scn.unit_settings
us.system, us.scale_length, us.length_unit = 'METRIC', 0.001, 'MILLIMETERS'
COL = bpy.data.collections.new('SARAB-1')
scn.collection.children.link(COL)
DG = scn.view_layers[0].depsgraph


def evaluated_mesh(ob, name):
    DG.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(DG), preserve_all_data_layers=True, depsgraph=DG)
    me.name = name
    return me


# ---------------------------------------------------------------- materials
def lin(hexs):
    c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def mat(name, color, rough=0.5, metal=0.0, tex=None, coat=0.0, emit=None, strength=1.0, glow=0.0):
    m = bpy.data.materials.get('S1_' + name)
    if m:
        return m
    m = bpy.data.materials.new('S1_' + name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*lin(color), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = 0.04
    if emit:
        b.inputs['Emission Color'].default_value = (*lin(emit), 1)
        b.inputs['Emission Strength'].default_value = strength
    if tex:
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(os.path.join(TEXDIR, tex), check_existing=True)
        n.location = (-420, 260)
        nt.links.new(n.outputs['Color'], b.inputs['Base Color'])
        if glow:                                # a lit screen: the image also drives the emission
            nt.links.new(n.outputs['Color'], b.inputs['Emission Color'])
            b.inputs['Emission Strength'].default_value = glow
    m.diffuse_color = (*lin(color), 1)
    m.roughness, m.metallic = rough, metal
    return m


M = dict(
    foam=mat('foam', '#202326', 0.9, tex='foam.png'), decal=mat('decal', '#1E2226', 0.86, tex='decal.png'),
    deck=mat('deck', '#2D3238', 0.88), pillar=mat('pillar', '#3A4048', 0.88), alu=mat('alu', '#D3D8DC', 0.4, 1.0),
    pcb_blue=mat('pcb_blue', '#1C4FA0', 0.42), pcb_black=mat('pcb_black', '#141619', 0.45),
    plastic=mat('plastic', '#141619', 0.5), ic=mat('ic', '#1A1B1E', 0.34), metal=mat('metal', '#C9CED2', 0.28, 0.92),
    gold=mat('gold', '#D9B45A', 0.24, 1.0), solder=mat('solder', '#B9BEC3', 0.22, 1.0), ceramic=mat('ceramic', '#D9CCA8', 0.6),
    term=mat('term', '#2E8A62', 0.42), batt=mat('batt', '#A3AEB8', 0.34, 0.6), batt_top=mat('batt_top', '#A7B2BC', 0.38, 0.45, tex='battery.png'),
    solar=mat('solar', '#16294A', 0.12, tex='solar.png', coat=1.0), solar_back=mat('solar_back', '#141C28', 0.5),
    glass=mat('glass', '#050607', 0.06), screen=mat('oled_screen', '#020304', 0.25, tex='oled_ui.png', glow=1.6),
    esp32_top=mat('esp32_top', '#141619', 0.45, tex='esp32_pcb.png'), wroom_pcb=mat('wroom_pcb', '#121417', 0.4, tex='wroom.png'),
    wroom_can=mat('wroom_can', '#C9CED2', 0.34, 0.85, tex='wroom_can.png'), gps_top=mat('gps_top', '#1C4FA0', 0.42, tex='gps_pcb.png'),
    gps_can=mat('gps_can', '#C9CED2', 0.34, 0.85, tex='gps_can.png'), ina_top=mat('ina_top', '#1C4FA0', 0.42, tex='ina_pcb.png'),
    mpu_top=mat('mpu_top', '#1C4FA0', 0.42, tex='mpu_pcb.png'), chg_top=mat('chg_top', '#1C4FA0', 0.42, tex='chg_pcb.png'),
    oled_top=mat('oled_top', '#1C4FA0', 0.42, tex='oled_pcb.png'), inductor=mat('inductor', '#34373B', 0.5),
    led_red=mat('led_red', '#E8473B', 0.3, emit='#FF4A3D', strength=1.5), led_green=mat('led_green', '#3FBF6A', 0.3, emit='#46D877', strength=1.2),
    led_blue=mat('led_blue', '#4AA3FF', 0.3, emit='#5AB0FF', strength=1.2), led_amber=mat('led_amber', '#FFB347', 0.3, emit='#FFB347', strength=1.0),
    w_red=mat('wire_red', '#C9352D', 0.45), w_black=mat('wire_black', '#1B1D20', 0.45), w_yellow=mat('wire_yellow', '#E0B52C', 0.45),
    w_white=mat('wire_white', '#E6EAED', 0.45), w_blue=mat('wire_blue', '#2F6FD0', 0.45), w_coax=mat('wire_coax', '#111316', 0.5),
)

# ---------------------------------------------------------------- geometry helpers
FACES = {   # outward-facing corner order, then (u axis, sign) and (v axis, sign) for each face's UVs
    '+z': ([(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)], (0, 1), (1, 1)),
    '-z': ([(-1, 1, -1), (1, 1, -1), (1, -1, -1), (-1, -1, -1)], (0, 1), (1, -1)),
    '+x': ([(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)], (1, 1), (2, 1)),
    '-x': ([(-1, 1, -1), (-1, -1, -1), (-1, -1, 1), (-1, 1, 1)], (1, -1), (2, 1)),
    '-y': ([(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)], (0, 1), (2, 1)),
    '+y': ([(1, 1, -1), (-1, 1, -1), (-1, 1, 1), (1, 1, 1)], (0, -1), (2, 1)),
}


def box_mesh(name, s, slots=None, tile=None, at=(0, 0, 0), fit=()):
    """Box of size s centred on the origin. slots maps a face ('+z', '-y', ...) to a material slot.
    UVs repeat every `tile` mm (at world position `at`), or fit the whole texture to a face (faces in `fit`, or all if no tile)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    h = [s[0] / 2, s[1] / 2, s[2] / 2]
    for key, (corners, (ua, us_), (va, vs)) in FACES.items():
        vs_ = [bm.verts.new((c[0] * h[0], c[1] * h[1], c[2] * h[2])) for c in corners]
        f = bm.faces.new(vs_)
        f.material_index = (slots or {}).get(key, 0)
        for loop in f.loops:
            co = loop.vert.co
            if tile and key not in fit:
                loop[uv].uv = ((co[ua] + at[ua]) * us_ / tile, (co[va] + at[va]) * vs / tile)
            else:
                loop[uv].uv = ((co[ua] * us_ + h[ua]) / s[ua], (co[va] * vs + h[va]) / s[va])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    me = bpy.data.meshes.new('S1_' + name)
    bm.to_mesh(me)
    bm.free()
    return me


def plate_mesh(name, size, t, notch, tile):
    """Square plate with its four corners notched for the rails, UVs repeating every `tile` mm."""
    a, n = size / 2, notch
    ring = [(-a + n, -a), (a - n, -a), (a - n, -a + n), (a, -a + n), (a, a - n), (a - n, a - n),
            (a - n, a), (-a + n, a), (-a + n, a - n), (-a, a - n), (-a, -a + n), (-a + n, -a + n)]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    lo = [bm.verts.new((x, y, -t / 2)) for x, y in ring]
    hi = [bm.verts.new((x, y, t / 2)) for x, y in ring]
    faces = [bm.faces.new(hi), bm.faces.new(list(reversed(lo)))]
    for i in range(len(ring)):
        j = (i + 1) % len(ring)
        faces.append(bm.faces.new((lo[i], lo[j], hi[j], hi[i])))
    bm.normal_update()
    for f in faces:
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = ((co.x + co.y * (0 if abs(f.normal.z) > .5 else 1)) / tile, (co.y if abs(f.normal.z) > .5 else co.z) / tile)
    me = bpy.data.meshes.new('S1_' + name)
    bm.to_mesh(me)
    bm.free()
    return me


def cyl_mesh(name, r, h, segs=24, axis='z'):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r, depth=h)
    if axis == 'x':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    elif axis == 'y':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    me = bpy.data.meshes.new('S1_' + name)
    bm.to_mesh(me)
    bm.free()
    smooth_by_angle(me)
    return me


def boxes_mesh(name, items):
    """Many small boxes in one mesh, e.g. a row of header pins: items = [(centre, size), ...]."""
    bm = bmesh.new()
    for c, s in items:
        bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.LocRotScale(Vector(c), None, Vector(s)))
    me = bpy.data.meshes.new('S1_' + name)
    bm.to_mesh(me)
    bm.free()
    return me


def blob_mesh(name, items, r=0.8):
    bm = bmesh.new()
    for c in items:
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=6, radius=r, matrix=Matrix.LocRotScale(Vector(c), None, Vector((1, 1, 0.55))))
    me = bpy.data.meshes.new('S1_' + name)
    bm.to_mesh(me)
    bm.free()
    smooth_by_angle(me, 80)
    return me


def smooth_by_angle(me, deg=35):
    for p in me.polygons:
        p.use_smooth = True
    bm = bmesh.new()
    bm.from_mesh(me)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(deg):
            e.smooth = False
    bm.to_mesh(me)
    bm.free()


LAYERS = {}
ROOT_EMPTY = bpy.data.objects.new('SARAB1', None)
COL.objects.link(ROOT_EMPTY)
ROOT_EMPTY.empty_display_size = 20


def layer(name):
    if name not in LAYERS:
        e = bpy.data.objects.new('L_' + name, None)
        COL.objects.link(e)
        e.empty_display_size = 6
        e.parent = ROOT_EMPTY
        e['layer'] = name
        LAYERS[name] = e
    return LAYERS[name]


def put(name, me, loc, host, mats, bevel=0.0, segs=2, kind=None):
    """Adds an object for part `host` (its id in the part list): same subsystem and exploded-view layer."""
    ob = bpy.data.objects.new(name, me)
    COL.objects.link(ob)
    ob.location = loc
    for m in mats:
        me.materials.append(m)
    hp = P[host]
    ob['part'], ob['sub'], ob['layer'] = host, sub_of(hp), hp['layer']
    if kind:
        ob['kind'] = kind
    ob.parent = layer(hp['layer'])
    if bevel:
        for p in me.polygons:
            p.use_smooth = True
        md = ob.modifiers.new('Bevel', 'BEVEL')
        md.width, md.segments, md.limit_method = bevel, segs, 'ANGLE'
        md.angle_limit = math.radians(40)
        md.harden_normals = True
    return ob


BUILT = set()


def part_box(pid, mats, slots=None, bevel=0.0, segs=2, tile=None, fit=()):
    p = P[pid]
    BUILT.add(pid)
    return put(pid, box_mesh(pid, p['s'], slots, tile, p['c'], fit), p['c'], pid, mats, bevel, segs)


def cut(ob, cutters):
    """Drills holes: cutters = [(mesh, location), ...]. Applied right away so exporters see plain geometry."""
    tmp = []
    for i, (me, loc) in enumerate(cutters):
        c = bpy.data.objects.new(f'{ob.name}_cutter{i}', me)
        COL.objects.link(c)
        c.location = loc
        md = ob.modifiers.new(f'Cut{i}', 'BOOLEAN')
        md.operation, md.object, md.solver = 'DIFFERENCE', c, 'EXACT'
        tmp.append(c)
    bevels = [(m.width, m.segments) for m in ob.modifiers if m.type == 'BEVEL']
    for m in [m for m in ob.modifiers if m.type == 'BEVEL']:
        ob.modifiers.remove(m)
    old = ob.data
    name = old.name
    me = evaluated_mesh(ob, name + '_cut')
    for m in list(ob.modifiers):
        ob.modifiers.remove(m)
    ob.data = me
    bpy.data.meshes.remove(old)
    me.name = name
    while len(me.materials) and me.materials[-1] is None:     # the boolean leaves an unused empty slot
        me.materials.pop()
    for c in tmp:
        cm = c.data
        bpy.data.objects.remove(c)
        bpy.data.meshes.remove(cm)
    for w, sg in bevels:
        md = ob.modifiers.new('Bevel', 'BEVEL')
        md.width, md.segments, md.limit_method, md.angle_limit, md.harden_normals = w, sg, 'ANGLE', math.radians(40), True
        for p in ob.data.polygons:
            p.use_smooth = True


def wire(name, pts, r, m, host='deck1'):
    """A cable through the given points (mm), converted to a mesh. Hidden in the web model's exploded view."""
    cu = bpy.data.curves.new('S1_' + name, 'CURVE')
    cu.dimensions, cu.resolution_u, cu.bevel_depth, cu.bevel_resolution, cu.use_fill_caps = '3D', 10, r, 2, True
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    sp.use_smooth = True
    tmp = bpy.data.objects.new('tmp_' + name, cu)
    COL.objects.link(tmp)
    me = evaluated_mesh(tmp, 'S1_' + name)
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    ob = put(name, me, (0, 0, 0), host, [m], kind='cable')
    ob['sub'] = 'wiring'
    return ob


def chip(name, host, c, s, m=None, bevel=0.12):
    return put(name, box_mesh(name, s), c, host, [m or M['ic']], bevel, 1)


# ---------------------------------------------------------------- structure
FOAM_TILE = 46.0
base = put('base', plate_mesh('base', 100, 5, 8.5, FOAM_TILE), P['base']['c'], 'base', [M['foam']], 0.5, 2)
top = put('top_plate', plate_mesh('top_plate', 100, 5, 8.5, FOAM_TILE), P['top_plate']['c'], 'top_plate', [M['foam']], 0.5, 2)
BUILT.update(('base', 'top_plate', 'esp_mod', 'mpu_chip'))
cut(top, [(cyl_mesh('hole_ant', 2.5, 12), (0, 34.5, 111)), (cyl_mesh('hole_solar', 2.5, 12), (38, -38, 111))])

walls = {}
for wid in ('wall_xp', 'wall_xn', 'wall_yp', 'wall_yn'):
    if wid == 'wall_xp':     # the +X face carries the SARAB-1 print
        walls[wid] = part_box(wid, [M['foam'], M['decal']], {'+x': 1}, 0.5, 2, tile=FOAM_TILE, fit={'+x'})
    else:
        walls[wid] = part_box(wid, [M['foam']], None, 0.5, 2, tile=FOAM_TILE)
# openings from the cut list: USB on -X, charge port on +X, screen window on the front (-Y)
cut(walls['wall_xn'], [(box_mesh('cut_usb', (12, 12, 8)), (-47.5, 14, 54))])
cut(walls['wall_xp'], [(box_mesh('cut_chg', (12, 10, 5)), (47.5, -21, 8.5))])
cut(walls['wall_yn'], [(box_mesh('cut_screen', (26, 12, 16)), (0, -47.5, 73.5))])

for p in PARTS:
    if p['sub'] == 'rails':
        part_box(p['id'], [M['alu']], bevel=0.7, segs=3)
part_box('deck1', [M['deck']], bevel=0.4, tile=FOAM_TILE)
part_box('deck2', [M['deck']], bevel=0.4, tile=FOAM_TILE)
for p in PARTS:
    if p['sub'] == 'pillars':
        part_box(p['id'], [M['pillar']], bevel=0.3)

# ---------------------------------------------------------------- power: battery, charger, solar panel
part_box('battery', [M['batt'], M['batt_top']], {'+z': 1}, bevel=1.8, segs=4)
part_box('chg_pcb', [M['pcb_blue'], M['chg_top']], {'+z': 1}, bevel=0.2, segs=1)
usbc = part_box('chg_usb', [M['metal']], bevel=0.9, segs=3)
chip('chg_usb_mouth', 'chg_usb', (31.55, -21, 8.2), (0.2, 7.0, 1.6), M['plastic'], 0)
chip('chg_tp4056', 'chg_pcb', (9.0, -17.0, 7.2), (3.5, 3.0, 1.2))
chip('chg_boost', 'chg_pcb', (17.0, -25.5, 7.1), (2.5, 2.4, 1.0))
chip('chg_inductor', 'chg_pcb', (16.5, -16.7, 7.7), (5.2, 5.2, 2.2), M['inductor'], 0.4)
put('chg_inductor_top', cyl_mesh('chg_inductor_top', 2.0, 0.3), (16.5, -16.7, 8.95), 'chg_pcb', [M['ic']])
chip('chg_led_chrg', 'chg_pcb', (5.0, -24.2, 6.8), (1.0, 0.6, 0.4), M['led_red'], 0)
chip('chg_led_stdby', 'chg_pcb', (5.0, -25.6, 6.8), (1.0, 0.6, 0.4), M['led_green'], 0)
part_box('solar_back', [M['solar_back']], bevel=0.3)
part_box('solar_cells', [M['solar_back'], M['solar']], {'+z': 1}, bevel=0.25, segs=1)

# ---------------------------------------------------------------- flight computer: ESP32 DevKit V1 on deck 1
for hid in ('esp_hdr0', 'esp_hdr1', 'ina_hdr', 'mpu_hdr', 'gps_hdr'):
    part_box(hid, [M['plastic']], bevel=0.2, segs=1)
part_box('esp_pcb', [M['pcb_black'], M['esp32_top']], {'+z': 1}, bevel=0.2, segs=1)
put('esp_mod', box_mesh('esp_mod', (25.5, 18, 0.8), {'+z': 1}), (-1, 14, 53.0), 'esp_mod', [M['pcb_black'], M['wroom_pcb']], 0.15, 1)
put('esp_can', box_mesh('esp_can', (18, 16, 2.5), {'+z': 1}), (-4.75, 14, 54.65), 'esp_mod', [M['metal'], M['wroom_can']], 0.3, 2)
part_box('esp_usb', [M['metal']], bevel=0.7, segs=3)
chip('esp_usb_mouth', 'esp_usb', (-40.26, 14, 54.1), (0.2, 6.2, 1.4), M['plastic'], 0)
for nm, y in (('esp_btn_boot', 21.65), ('esp_btn_en', 6.35)):
    chip(nm, 'esp_pcb', (-29.05, y, 53.3), (4.2, 3.2, 1.4), M['metal'], 0.2)
    put(nm + '_cap', cyl_mesh(nm + '_cap', 1.05, 0.6), (-29.05, y, 54.3), 'esp_pcb', [M['ic']])
chip('esp_regulator', 'esp_pcb', (-23.15, 10.05, 53.2), (2.9, 3.0, 1.2))
chip('esp_usb_bridge', 'esp_pcb', (-23.15, 17.85, 53.05), (3.1, 3.6, 0.9))
chip('esp_led_power', 'esp_pcb', (-25.9, 12.75, 52.8), (0.9, 0.55, 0.4), M['led_red'], 0)
chip('esp_led_gpio2', 'esp_pcb', (-25.9, 15.35, 52.8), (0.9, 0.55, 0.4), M['led_blue'], 0)

# ---------------------------------------------------------------- INA219 (battery line) and MPU6050 on deck 1
part_box('ina_pcb', [M['pcb_blue'], M['ina_top']], {'+z': 1}, bevel=0.2, segs=1)
part_box('ina_term', [M['term']], bevel=0.5, segs=2)
for nm, x in (('ina_screw_vinp', 22.15), ('ina_screw_vinn', 27.85)):
    put(nm, cyl_mesh(nm, 1.5, 0.7), (x, 24, 58.95), 'ina_term', [M['metal']])
    chip(nm + '_slot', 'ina_term', (x, 24, 59.33), (2.4, 0.4, 0.1), M['ic'], 0)
    chip(nm + '_entry', 'ina_term', (x, 27.8, 53.2), (3.0, 0.15, 3.0), M['ic'], 0)
chip('ina_shunt', 'ina_pcb', (25.0, 15.25, 50.95), (5.2, 3.0, 0.7), M['ic'], 0.1)
for dx in (-2.85, 2.85):
    chip(f'ina_shunt_cap{"l" if dx < 0 else "r"}', 'ina_pcb', (25.0 + dx, 15.25, 50.98), (0.6, 3.0, 0.76), M['solder'], 0.05)
chip('ina_chip', 'ina_pcb', (19.85, 11.05, 51.05), (2.5, 2.6, 0.9))
part_box('mpu_pcb', [M['pcb_blue'], M['mpu_top']], {'+z': 1}, bevel=0.2, segs=1)
chip('mpu_chip', 'mpu_chip', tuple(P['mpu_chip']['c']), tuple(P['mpu_chip']['s']))

# ---------------------------------------------------------------- payload: GPS receiver on deck 2, patch antenna on top
part_box('gps_pad', [M['pillar']], bevel=0.3)
part_box('gps_pcb', [M['pcb_blue'], M['gps_top']], {'+z': 1}, bevel=0.2, segs=1)
part_box('gps_mod', [M['metal'], M['gps_can']], {'+z': 1}, bevel=0.3, segs=2)
put('gps_backup_cell', cyl_mesh('gps_backup_cell', 2.2, 1.4), (4.6, 5.3, 89.3), 'gps_pcb', [M['metal']])
chip('gps_ufl', 'gps_pcb', (3.9, 0.0, 89.2), (2.6, 2.6, 1.2), M['metal'], 0.15)
put('gps_ufl_plug', cyl_mesh('gps_ufl_plug', 1.0, 0.8), (3.9, 0.0, 90.2), 'gps_pcb', [M['metal']])
chip('gps_led_pps', 'gps_pcb', (5.2, -2.9, 88.8), (1.0, 0.6, 0.4), M['led_amber'], 0)
part_box('ant_base', [M['metal']], bevel=0.3)
part_box('ant_cer', [M['ceramic']], bevel=0.7, segs=3)
part_box('ant_patch', [M['metal']], bevel=0.1, segs=1)
put('ant_feed', cyl_mesh('ant_feed', 0.7, 0.5), (0, 32.0, 119.55), 'ant_patch', [M['solder']])

# ---------------------------------------------------------------- OLED status screen on the front face
part_box('oled_pcb', [M['pcb_blue'], M['oled_top']], {'-y': 1}, bevel=0.2, segs=1)
part_box('oled_glass', [M['glass']], bevel=0.25, segs=1)
scr = bmesh.new()
uvl = scr.loops.layers.uv.new('UVMap')
f = scr.faces.new([scr.verts.new(v) for v in ((-10.87, 0, -5.43), (10.87, 0, -5.43), (10.87, 0, 5.43), (-10.87, 0, 5.43))])
for loop, uvc in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
    loop[uvl].uv = uvc
me_scr = bpy.data.meshes.new('S1_oled_screen')
scr.to_mesh(me_scr)
scr.free()
put('oled_screen', me_scr, (0, -53.03, 73.5), 'oled_glass', [M['screen']], kind='screen')

# ---------------------------------------------------------------- header pins, jumper plugs and solder
ESP_LO = lambda i: (-31.78 + 2.54 * i, 1.45)      # 3V3 GND D15 D2 D4 RX2 TX2 D5 D18 D19 D21 RX0 TX0 D22 D23
ESP_HI = lambda i: (-31.78 + 2.54 * i, 26.55)     # VIN GND D13 D12 D14 D27 D26 D25 D33 D32 D35 D34 VN VP EN
MPU = lambda i: (-8.89 + 2.54 * i, -28.75)        # VCC GND SCL SDA XDA XCL AD0 INT
INA = lambda i: (18.65 + 2.54 * i, 4.0)           # VCC GND SCL SDA VIN- VIN+
GPS = lambda i: (-26.0, -3.81 + 2.54 * i)         # GND TX RX VCC
TOPS = {'esp_pcb': 52.6, 'ina_pcb': 50.6, 'mpu_pcb': 50.6, 'gps_pcb': 88.6}


def pins(name, host, xy_list):
    z0 = TOPS[host]
    put(name, boxes_mesh(name, [((x, y, z0 + 0.9), (0.64, 0.64, 2.6)) for x, y in xy_list]), (0, 0, 0), host, [M['gold']])


pins('esp_pins_lo', 'esp_pcb', [ESP_LO(i) for i in range(15)])
pins('esp_pins_hi', 'esp_pcb', [ESP_HI(i) for i in range(15)])
pins('ina_pins', 'ina_pcb', [INA(i) for i in range(6)])
pins('mpu_pins', 'mpu_pcb', [MPU(i) for i in range(8)])
pins('gps_pins', 'gps_pcb', [GPS(i) for i in range(4)])

PLUG = 10.0                                         # jumper (Dupont) housing height


def plugs(name, host, xy_list):
    z0 = TOPS[host]
    put(name, boxes_mesh(name, [((x, y, z0 + 0.4 + PLUG / 2), (2.45, 2.45, PLUG)) for x, y in xy_list]), (0, 0, 0), host, [M['plastic']])
    return z0 + 0.4 + PLUG


ZE = plugs('esp_plugs', 'esp_pcb', [ESP_HI(0), ESP_HI(1), ESP_LO(0), ESP_LO(1), ESP_LO(5), ESP_LO(6), ESP_LO(10), ESP_LO(13)])
ZM = plugs('mpu_plugs', 'mpu_pcb', [MPU(i) for i in range(4)])
ZI = plugs('ina_plugs', 'ina_pcb', [INA(i) for i in range(4)])
ZG = plugs('gps_plugs', 'gps_pcb', [GPS(i) for i in range(4)])
PADS = {'B+': (0.7, -13.3), 'B-': (0.7, -28.7), 'OUT+': (29.1, -12.9), 'OUT-': (29.1, -29.1), 'IN+': (21.0, -11.7), 'IN-': (21.0, -30.3)}
put('chg_solder', blob_mesh('chg_solder', [(x, y, 6.75) for x, y in PADS.values()], 0.85), (0, 0, 0), 'chg_pcb', [M['solder']])

# ---------------------------------------------------------------- wiring (firmware pin table, see HANDOFF.md)
W = M
e3 = lambda xy, z=ZE: (xy[0], xy[1], z)
# GPS: VCC->VIN, GND->GND, TX->RX2 (GPIO16), RX->TX2 (GPIO17), down the gap between deck 2 and the -X wall
for i, m, tgt, mid in ((3, W['w_red'], ESP_HI(0), (-39, 22, 67)), (0, W['w_black'], ESP_HI(1), (-38, 21, 67)),
                       (1, W['w_yellow'], ESP_LO(5), (-36, 5, 67)), (2, W['w_white'], ESP_LO(6), (-35, 5.8, 67.5))):
    gx, gy = GPS(i)
    hi_row = tgt[1] > 10
    wire(f'wire_gps_{i}', [(gx, gy, ZG), (gx - 4, gy * 1.1 + 0.6, ZG + 2.6), (-38.5, gy * 0.7 + 3.5, ZG + 1.1), (-43.2, gy * 0.5 + 6.5, 90),
                           (-43.2, gy * 0.4 + 10.5, 72), mid, (tgt[0] - (1.8 if hi_row else 3), tgt[1] - (0.6 if hi_row else -1.2), ZE + 3), e3(tgt)], 0.45, m)
# I2C sensors (MPU6050, INA219, OLED): VCC->3V3, GND->GND, SCL->D22 (GPIO22), SDA->D21 (GPIO21)
ESP_I2C = [ESP_LO(0), ESP_LO(1), ESP_LO(13), ESP_LO(10)]
COLS = [W['w_red'], W['w_black'], W['w_yellow'], W['w_blue']]
for i in range(4):
    mx, my = MPU(i)
    tx, ty = ESP_I2C[i]
    wire(f'wire_mpu_{i}', [(mx, my, ZM), (mx - 0.4, my + 4.5, ZM + 3.6), ((mx + tx) / 2, -12, 67 - i * 0.4), (tx + 1.6, -2.0, 66 - i * 0.3), e3((tx, ty))], 0.45, COLS[i])
    nx, ny = INA(i)
    wire(f'wire_ina_{i}', [(nx, ny, ZI), (nx - 1.6, ny - 3.0, ZI + 5), ((nx + tx) / 2, -1.6 + i * 0.5, 69 - i * 0.4), (tx + 2.4, ty - 2.6, 67.5 - i * 0.3), e3((tx + 0.35, ty))], 0.45, COLS[i])
    ox = -3.81 + 2.54 * [1, 0, 2, 3][i]
    wire(f'wire_oled_{i}', [(ox, -46.0, 79.0), (ox * 0.9, -40, 77), ((ox + tx) / 2, -20, 71 + i * 0.4), (tx - 1.4, -3.5, 67 + i * 0.3), e3((tx - 0.35, ty))], 0.45, COLS[i])
# power: battery + -> INA219 VIN+, INA219 VIN- -> charger B+, battery - -> charger B-, charger OUT -> ESP32 VIN / GND
wire('wire_batt_pos', [(13.3, 20, 11), (18, 30, 12), (21.5, 43.2, 22), (21.8, 43.2, 46), (22.15, 34, 53.5), (22.15, 28.4, 53.2)], 0.7, W['w_red'])
wire('wire_ina_to_chg', [(27.85, 28.4, 53.2), (28, 34, 53.5), (28.5, 43.2, 46), (28.5, 43.2, 22), (30, 37, 11), (20, 12, 9.5), (16, -10.5, 9), (5, -13.0, 7.8), (*PADS['B+'], 6.9)], 0.7, W['w_red'])
wire('wire_batt_neg', [(13.3, 16, 9.5), (17.5, 6, 9.2), (15, -8.0, 8.8), (4, -22, 8.4), (*PADS['B-'], 6.9)], 0.7, W['w_black'])
wire('wire_out_pos', [(*PADS['OUT+'], 6.9), (36, -8, 10), (43.2, -2, 22), (43.2, 4, 50), (37, 16, 66), (10, 31, 69.5), (-20, 31, 68), (-30, 28.5, 65.5), e3(ESP_HI(0))], 0.6, W['w_red'])
wire('wire_out_neg', [(*PADS['OUT-'], 6.9), (36, -27, 10), (43.2, -20, 22), (43.2, 1, 50), (36, 15, 66.5), (10, 30, 70), (-20, 30, 68.5), (-28, 28.4, 65.8), e3(ESP_HI(1))], 0.6, W['w_black'])
wire('wire_solar_pos', [(37.2, -37.6, 112.8), (37.2, -37.6, 105), (43.2, -33, 92), (43.2, -28, 30), (36, -14, 12), (24, -11.7, 8.0), (*PADS['IN+'], 6.9)], 0.5, W['w_red'])
wire('wire_solar_neg', [(38.8, -38.4, 112.8), (38.8, -38.4, 105), (43.2, -35, 92), (43.2, -31, 30), (37, -30, 12), (25, -30.3, 8.0), (*PADS['IN-'], 6.9)], 0.5, W['w_black'])
wire('wire_antenna', [(0, 34.5, 113.2), (0, 34.5, 106), (1.5, 24, 99), (3.0, 11, 93), (3.9, 2.4, 90.8), (3.9, 0.0, 90.6)], 0.8, W['w_coax'])

# ---------------------------------------------------------------- summary, viewport, export
tris = 0
DG.update()
for ob in COL.all_objects:
    if ob.type == 'MESH':
        ev = ob.evaluated_get(DG)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        ev.to_mesh_clear()
SUMMARY = {'objects': len([o for o in COL.all_objects if o.type == 'MESH']), 'triangles': tris, 'layers': sorted(LAYERS),
           'parts_missing': sorted(set(P) - BUILT - {'port_usb', 'port_chg'})}   # the two ports are real cut-outs now

if not BG:
    for area in (bpy.context.window or bpy.context.window_manager.windows[0]).screen.areas:
        if area.type == 'VIEW_3D':
            sp = area.spaces.active
            sp.shading.type = 'MATERIAL'
            sp.clip_start, sp.clip_end = 0.5, 20000
            r3d = sp.region_3d
            r3d.view_location = (0, 0, 58)
            r3d.view_distance = 420
            r3d.view_rotation = Matrix.Rotation(math.radians(40), 4, 'Z').to_quaternion() @ Matrix.Rotation(math.radians(64), 4, 'X').to_quaternion()

STL_GROUPS = [   # file, Tinkercad colour to set after import, materials (an object goes by its top-face material)
    ('01-panels-black', 'Black', {'foam', 'decal'}), ('02-decks-and-pillars-dark-grey', 'Dark grey', {'deck', 'pillar'}),
    ('03-corner-rails-silver', 'Light grey', {'alu'}), ('04-circuit-boards-blue', 'Blue', {'pcb_blue', 'gps_top', 'ina_top', 'mpu_top', 'chg_top', 'oled_top'}),
    ('05-chips-headers-screen-black', 'Black', {'pcb_black', 'esp32_top', 'wroom_pcb', 'ic', 'plastic', 'glass', 'inductor', 'solar_back', 'oled_screen'}),
    ('06-shields-and-connectors-silver', 'Silver', {'metal', 'wroom_can', 'gps_can', 'solder'}), ('07-pins-gold', 'Yellow', {'gold'}),
    ('08-antenna-ceramic-beige', 'Beige', {'ceramic'}), ('09-terminal-and-leds-green', 'Green', {'term', 'led_green'}),
    ('10-battery-grey', 'Grey', {'batt', 'batt_top'}), ('11-solar-cells-blue', 'Dark blue', {'solar'}),
    ('12-leds-red', 'Red', {'led_red', 'led_blue', 'led_amber'}),
]

if '--stl' in ARGS:     # detailed STLs for Tinkercad, one per colour; wiring is left out
    out = os.path.join(ROOT, 'hardware', 'stl-detailed')
    os.makedirs(out, exist_ok=True)
    DG.update()
    solids = [o for o in COL.all_objects if o.type == 'MESH' and o.get('kind') != 'cable']
    group_of = {}
    for o in solids:
        mats = [m for m in o.data.materials if m]
        key = mats[-1].name[3:] if mats else ''
        group_of[o.name] = next((g[0] for g in STL_GROUPS if key in g[2]), None)
    lost = sorted(n for n, g in group_of.items() if g is None)
    pts = [o.matrix_world @ Vector(c) for o in solids for c in o.evaluated_get(DG).bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    A = 0.2      # tiny cubes at the shared bounding-box corners keep every import lined up
    anchors = [bpy.data.objects.new(f'anchor{i}', boxes_mesh(f'anchor{i}', [(c, (A, A, A))])) for i, c in enumerate((lo + Vector((A, A, A)) / 2, hi - Vector((A, A, A)) / 2))]
    for a in anchors:
        COL.objects.link(a)
    for fname, colour, _ in STL_GROUPS:
        for ob in scn.objects:
            ob.select_set(group_of.get(ob.name) == fname or ob in anchors)
        bpy.ops.wm.stl_export(filepath=os.path.join(out, fname + '.stl'), export_selected_objects=True, apply_modifiers=True, ascii_format=False)
    for a in anchors:
        me = a.data
        bpy.data.objects.remove(a)
        bpy.data.meshes.remove(me)
    SUMMARY['stl'] = {'files': len(STL_GROUPS), 'unassigned': lost, 'bbox_mm': [round(v, 2) for v in (*lo, *hi)]}

if '--export' in ARGS:
    os.makedirs(os.path.dirname(GLB), exist_ok=True)
    for ob in scn.objects:
        ob.select_set(ob.name in COL.all_objects)
    bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', use_selection=True, export_apply=True, export_extras=True,
                              export_yup=True, export_cameras=False, export_lights=False, export_animations=False)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)
    bpy.ops.file.make_paths_relative()          # textures load from hardware/blender/textures wherever the repo lives
    bpy.ops.wm.save_mainfile(compress=True)
    SUMMARY['glb_bytes'] = os.path.getsize(GLB)
print('SARAB-1 build:', SUMMARY)

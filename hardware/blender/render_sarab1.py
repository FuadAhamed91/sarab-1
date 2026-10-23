"""Studio renders of SARAB-1 for the poster, the report and the README.

Needs the model from build_sarab1.py: run it in the same Blender session, or on the saved file:
  blender --background hardware/blender/sarab1.blend --python hardware/blender/render_sarab1.py -- hero exploded inside
Writes assets/renders/sarab1-<shot>.jpg. Cycles on a laptop CPU takes several minutes per shot;
add --test for a small Cycles check of the lighting, or --preview for a quick EEVEE draft. The studio (backdrop, lights, camera) lives in its own
collection, "S1 studio", so it never ends up in the website model.
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'renders')
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else globals().get('RENDER_ARGS', [])
SHOTS = [a for a in ARGS if not a.startswith('--')] or ['hero']
PREVIEW = '--preview' in ARGS          # quick EEVEE draft
TEST = '--test' in ARGS                # quick small Cycles render, for checking the lighting

scn = bpy.data.scenes['SARAB-1']
MODEL = bpy.data.collections['SARAB-1']
LAYER = {o['layer']: o for o in MODEL.all_objects if o.type == 'EMPTY' and 'layer' in o}
OFF = {  # exploded-view offsets in mm, the same as the website's (src/sat-model.js)
    'base': (0, 0, 0), 'deck1': (0, 0, 52), 'deck2': (0, 0, 98), 'top': (0, 0, 150),
    'wall_xp': (85, 0, 48), 'wall_xn': (-85, 0, 48), 'wall_yp': (0, 85, 48), 'wall_yn': (0, -85, 48),
    'rail_pp': (72, 72, 48), 'rail_pn': (72, -72, 48), 'rail_np': (-72, 72, 48), 'rail_nn': (-72, -72, 48)}
SHELL = [o for o in MODEL.all_objects if o.get('sub') in ('panels', 'rails') and o.get('part') not in ('base', 'top_plate')]
CABLES = [o for o in MODEL.all_objects if o.get('kind') == 'cable']


def lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


# ---------------------------------------------------------------- studio
old = bpy.data.collections.get('S1 studio')
if old:
    for ob in list(old.all_objects):
        data = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        if data is not None and data.users == 0:
            store = bpy.data.meshes if isinstance(data, bpy.types.Mesh) else bpy.data.lights if isinstance(data, bpy.types.Light) else bpy.data.cameras
            store.remove(data)
    bpy.data.collections.remove(old)
STUDIO = bpy.data.collections.new('S1 studio')
scn.collection.children.link(STUDIO)


def cyclorama():
    """Floor that curves up into a back wall: one seamless cream backdrop, curve on the +y side."""
    prof = [(-1800.0, 0.0)] + [(500 * math.sin(a), 500 - 500 * math.cos(a)) for a in (i * math.pi / 32 for i in range(17))] + [(500.0, 2200.0)]
    bm = bmesh.new()
    rows = [[bm.verts.new((x, y + 170, z)) for y, z in prof] for x in (-2600.0, 2600.0)]
    for i in range(len(prof) - 1):
        bm.faces.new((rows[0][i], rows[1][i], rows[1][i + 1], rows[0][i + 1]))
    me = bpy.data.meshes.new('S1_cyclorama')
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    m = bpy.data.materials.get('S1_backdrop') or bpy.data.materials.new('S1_backdrop')
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*lin('#F3ECDF'), 1)
    b.inputs['Roughness'].default_value = 0.95
    me.materials.append(m)
    ob = bpy.data.objects.new('S1_cyclorama', me)
    STUDIO.objects.link(ob)
    return ob


BACKDROP = cyclorama()


def sun(name, strength, angle_deg, color='#FFFFFF'):
    li = bpy.data.lights.new(name, 'SUN')
    li.energy, li.angle, li.color = strength, math.radians(angle_deg), lin(color)
    ob = bpy.data.objects.new(name, li)
    STUDIO.objects.link(ob)
    return ob


KEY, FILL, RIM = sun('S1_key', 3.0, 16, '#FFF6EA'), sun('S1_fill', 0.8, 45, '#EAF2FF'), sun('S1_rim', 2.6, 6)
cam_data = bpy.data.cameras.new('S1_camera')
CAM = bpy.data.objects.new('S1_camera', cam_data)
STUDIO.objects.link(CAM)
scn.camera = CAM
cam_data.clip_start, cam_data.clip_end = 5, 6000


def softbox():
    """Big glowing card behind the camera: the camera never sees it, but metal and glass reflect it."""
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0)
    me = bpy.data.meshes.new('S1_softbox')
    bm.to_mesh(me)
    bm.free()
    m = bpy.data.materials.get('S1_softbox') or bpy.data.materials.new('S1_softbox')
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (1, 1, 1, 1)
    b.inputs['Emission Color'].default_value = (1, 0.97, 0.93, 1)
    b.inputs['Emission Strength'].default_value = 1.6
    me.materials.append(m)
    ob = bpy.data.objects.new('S1_softbox', me)
    ob.scale = (1100, 700, 1)
    # only reflections see it; as a light it would flood the scene and wash the black foam out to grey
    ob.visible_camera = ob.visible_shadow = ob.visible_diffuse = ob.visible_transmission = ob.visible_volume_scatter = False
    STUDIO.objects.link(ob)
    return ob


SOFTBOX = softbox()

world = bpy.data.worlds.get('S1_world') or bpy.data.worlds.new('S1_world')
scn.world = world
try:
    world.use_nodes = True
except Exception:
    pass
nt = world.node_tree
nt.nodes.clear()
env = nt.nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(os.path.join(bpy.utils.system_resource('DATAFILES'), 'studiolights', 'world', 'studio.exr'), check_existing=True)
bg = nt.nodes.new('ShaderNodeBackground')
bg.inputs['Strength'].default_value = 0.6

solar = bpy.data.materials.get('S1_solar')        # tame the glass, so the cells don't vanish in the backdrop's reflection
if solar:
    sb = solar.node_tree.nodes.get('Principled BSDF')
    sb.inputs['Coat Weight'].default_value, sb.inputs['Roughness'].default_value, sb.inputs['Specular IOR Level'].default_value = 0.12, 0.45, 0.25
outn = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(env.outputs['Color'], bg.inputs['Color'])
nt.links.new(bg.outputs['Background'], outn.inputs['Surface'])


def aim(ob, direction):
    """Point a sun (it shines down its -Z) or the camera (it looks down its -Z) along `direction`."""
    ob.rotation_euler = (-Vector(direction)).to_track_quat('Z', 'Y').to_euler()


def from_angles(az, el):
    a, e = math.radians(az), math.radians(el)
    return Vector((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e)))


def stage(az, el, dist, target, lens):
    """Camera az degrees round from the front (-Y) towards +X, el degrees up; lights and backdrop follow it."""
    target = Vector(target)
    CAM.location = target + from_angles(az, el) * dist
    aim(CAM, target - CAM.location)
    cam_data.lens = lens
    BACKDROP.rotation_euler = (0, 0, math.radians(az))
    SOFTBOX.location = target + from_angles(az - 25, 38) * (dist * 1.6)
    aim(SOFTBOX, target - SOFTBOX.location)          # face-on to the cube; it glows on both sides
    aim(KEY, -from_angles(az - 48, 52))
    aim(FILL, -from_angles(az + 70, 22))
    aim(RIM, -from_angles(az + 165, 30))


def explode(k, shell_k=None):
    for name, e in LAYER.items():
        s = shell_k if shell_k is not None and (name.startswith('wall') or name.startswith('rail')) else k
        e.location = Vector(OFF[name]) * s


def setup_render(res):
    r = scn.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = res[0], res[1], 100
    r.image_settings.file_format, r.image_settings.color_mode, r.image_settings.quality = 'JPEG', 'RGB', 95
    vs = scn.view_settings
    try:
        vs.view_transform = 'AgX'
        vs.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass
    vs.exposure = 0.2
    if PREVIEW:
        r.engine = 'BLENDER_EEVEE'
        scn.eevee.taa_render_samples = 48
        scn.eevee.use_raytracing = True          # so metal reflects the backdrop, as it does in Cycles
    else:
        r.engine = 'CYCLES'
        c = scn.cycles
        c.device, c.samples, c.use_adaptive_sampling, c.adaptive_threshold = 'CPU', 24 if TEST else 64, True, 0.02
        c.use_denoising = True
        try:
            c.denoiser = 'OPENIMAGEDENOISE'
        except TypeError:
            pass


SHOT_SETUPS = {   # name: (resolution, camera az, el, distance, target, lens, explode, shell explode, hide shell, hide cables)
    'hero': ((2000, 1500), 38, 22, 520, (0, 0, 58), 70, 0, None, False, False),
    'exploded': ((1500, 2000), 36, 24, 700, (0, 0, 140), 70, 1, 1.75, True, True),
    'inside': ((2000, 1500), 30, 13, 500, (0, 0, 60), 70, 0, None, True, False),
}
done = []
try:
    os.makedirs(OUT, exist_ok=True)
    for shot in SHOTS:
        res, az, el, dist, target, lens, k, shell_k, no_shell, no_cables = SHOT_SETUPS[shot]
        if PREVIEW or TEST:
            res = (res[0] * 2 // 5, res[1] * 2 // 5)
        setup_render(res)
        stage(az, el, dist, target, lens)
        explode(k, shell_k)
        for o in SHELL:
            o.hide_render = no_shell
        for o in CABLES:
            o.hide_render = no_cables
        path = os.path.join(OUT, f'sarab1-{shot}{"-preview" if PREVIEW else "-test" if TEST else ""}.jpg')
        scn.render.filepath = path
        bpy.ops.render.render(write_still=True, scene=scn.name)
        done.append(path)
finally:   # leave the model assembled and fully visible
    explode(0)
    for o in SHELL + CABLES:
        o.hide_render = False
RESULT = {'rendered': done}
print('SARAB-1 renders:', RESULT)

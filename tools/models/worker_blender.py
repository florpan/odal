"""The worker built in Blender with bpy: same labourer as worker.ts, but with bevel
modifiers for rounded edges. Run inside Blender (Scripting tab, or through the
Blender MCP). Writes packages/client/public/models/worker-blender.glb.

Game coordinates are y-up facing +z; Blender is z-up, so L() maps (x, y, z) -> (x, -z, y)
and the exporter converts back with export_yup=True.
"""

import math
import os

import bpy

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else r'C:\Dev\odal\tools\models',
                   '..', '..', 'packages', 'client', 'public', 'models', 'worker-blender.glb')

COLOURS = {
    'Skin': (0.87, 0.62, 0.45),
    'Team': (0.8, 0.2, 0.18),
    'Leather': (0.42, 0.27, 0.15),
    'Trousers': (0.3, 0.3, 0.34),
    'Boots': (0.2, 0.14, 0.1),
    'Cap': (0.25, 0.2, 0.16),
    'Wood': (0.55, 0.38, 0.2),
    'Iron': (0.5, 0.52, 0.55),
    'Dark': (0.08, 0.06, 0.05),
}


def reset_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)


def material(name, rgb):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = 1.0
    m.diffuse_color = (*rgb, 1)
    return m


MATS = {}
PARTS = []


def finish(o, name, matname, loc, scale, rot=(0, 0, 0), bevel=0.02, segments=2):
    o.name = name
    o.location = loc
    o.scale = scale
    o.rotation_euler = rot
    o.data.materials.append(MATS[matname])
    if bevel:
        b = o.modifiers.new('Bevel', 'BEVEL')
        b.width = bevel
        b.segments = segments
        b.limit_method = 'ANGLE'
        b.angle_limit = math.radians(40)
    PARTS.append(o)
    return o


def cube(name, matname, loc, scale, rot=(0, 0, 0), bevel=0.02):
    bpy.ops.mesh.primitive_cube_add(size=1)
    return finish(bpy.context.active_object, name, matname, loc, scale, rot, bevel)


def cyl(name, matname, loc, scale, rot=(0, 0, 0), verts=12, bevel=0.015):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=0.5, depth=1)
    return finish(bpy.context.active_object, name, matname, loc, scale, rot, bevel)


def cone(name, matname, loc, scale, rot=(0, 0, 0), verts=12, r1=0.5, r2=0.0):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=1)
    return finish(bpy.context.active_object, name, matname, loc, scale, rot, bevel=0)


def ball(name, matname, loc, scale, segs=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=0.5)
    return finish(bpy.context.active_object, name, matname, loc, scale, bevel=0)


def L(x, y, z):
    return (x, -z, y)


def build():
    reset_scene()
    MATS.clear()
    PARTS.clear()
    for name, rgb in COLOURS.items():
        MATS[name] = material(name, rgb)

    leg_y = 0.08
    torso_y = leg_y + 0.22
    head_y = torso_y + 0.32 + 0.14

    for side in (-1, 1):
        x = side * 0.08
        cube(f'Boot{side}', 'Boots', L(x, 0.04, 0.02), (0.13, 0.17, 0.08), bevel=0.02)
        cube(f'Leg{side}', 'Trousers', L(x, leg_y + 0.1, 0), (0.12, 0.13, 0.24), bevel=0.02)

    cube('Tunic', 'Team', L(0, torso_y + 0.16, 0), (0.36, 0.24, 0.32), bevel=0.035)
    cube('Apron', 'Leather', L(0, torso_y + 0.13, 0.125), (0.24, 0.035, 0.26), bevel=0.012)
    cube('Strap', 'Leather', L(0, torso_y + 0.3, 0.115), (0.07, 0.03, 0.1), bevel=0.008)
    cube('Belt', 'Dark', L(0, torso_y + 0.05, 0), (0.37, 0.25, 0.045), bevel=0.01)
    cube('Pouch', 'Leather', L(-0.13, torso_y + 0.02, 0.11), (0.08, 0.05, 0.07), bevel=0.012)

    for side in (-1, 1):
        x = side * 0.21
        ry = side * 0.22
        cyl(f'Sleeve{side}', 'Team', L(x, torso_y + 0.26, 0), (0.11, 0.11, 0.13), rot=(0, ry, 0))
        cyl(f'Forearm{side}', 'Skin', L(x + side * 0.03, torso_y + 0.13, 0), (0.08, 0.08, 0.14), rot=(0, ry, 0))
        ball(f'Fist{side}', 'Skin', L(x + side * 0.045, torso_y + 0.05, 0), (0.1, 0.1, 0.1), segs=10, rings=6)

    ball('Head', 'Skin', L(0, head_y, 0), (0.3, 0.3, 0.28), segs=14, rings=9)
    cube('Nose', 'Skin', L(0, head_y - 0.03, 0.155), (0.05, 0.06, 0.05), bevel=0.012)
    for side in (-1, 1):
        cube(f'Eye{side}', 'Dark', L(side * 0.055, head_y + 0.02, 0.135), (0.035, 0.02, 0.05), bevel=0.006)
    cone('Cap', 'Cap', L(0, head_y + 0.1, -0.02), (0.34, 0.34, 0.09), r1=0.5, r2=0.42)
    cube('Peak', 'Cap', L(0, head_y + 0.07, 0.14), (0.22, 0.12, 0.025), bevel=0.008)

    # Axe over the right shoulder, leaning back (rotation about Blender x by -tilt).
    hand_x = 0.21 + 0.045
    tilt = 0.3
    cyl('Handle', 'Wood', L(hand_x, torso_y + 0.33, -0.08), (0.035, 0.035, 0.8), rot=(-tilt, 0, 0), verts=8, bevel=0)
    bpy.ops.mesh.primitive_cube_add(size=1)
    blade = bpy.context.active_object
    for v in blade.data.vertices:  # flare towards the edge (+x), thin it out
        if v.co.x > 0:
            v.co.y *= 0.3
            v.co.z *= 1.3
    finish(blade, 'AxeBlade', 'Iron', L(hand_x + 0.09, torso_y + 0.7, -0.2), (0.12, 0.045, 0.14), rot=(-tilt, 0, 0), bevel=0.006)
    cube('AxeNeck', 'Iron', L(hand_x + 0.025, torso_y + 0.7, -0.2), (0.07, 0.07, 0.09), rot=(-tilt, 0, 0), bevel=0.012)

    cube('HammerHandle', 'Wood', L(0.16, torso_y - 0.03, 0.06), (0.03, 0.03, 0.16), bevel=0.006)
    cube('HammerHead', 'Iron', L(0.16, torso_y + 0.06, 0.06), (0.05, 0.1, 0.05), bevel=0.01)

    bpy.ops.object.select_all(action='DESELECT')
    for o in PARTS:
        o.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.convert(target='MESH')  # applies the bevels
    bpy.ops.object.join()
    worker = bpy.context.active_object
    worker.name = 'worker'
    bpy.ops.object.shade_flat()
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return worker


def export(worker):
    out = os.path.normpath(OUT)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=True)
    tris = sum(len(p.vertices) - 2 for p in worker.data.polygons)
    print(f'wrote {out}: {tris} triangles, {os.path.getsize(out)} bytes')


if __name__ == '__main__':
    export(build())

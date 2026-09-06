"""Compose a Hexagon-pack decoration onto a grass tile and export it as one Odal terrain tile GLB.

A terrain's `visual.model` is a whole tile (top face at y=0, one hex wide), but the pack's hills and
mountains are props that sit on a tile. This joins hex_grass + the prop, forces a single material slot
(the pack shares one texture; a second slot would export as a second primitive) and scales flat-to-flat
to one hex. The texture goes out untouched.

    blender -b -P tools/models/kaykit_compose.py            # everything in JOBS
"""

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kaykit_prop as kp  # noqa: E402

HEX = kp.HEX
OUT = kp.OUT

JOBS = [
    ('hills_A', 'hex_hills_a.glb'),
    ('hills_B', 'hex_hills_b.glb'),
    ('hills_A_trees', 'hex_hills_a_trees.glb'),
    ('mountain_A_grass', 'hex_mountain_a.glb'),
    ('mountain_B_grass', 'hex_mountain_b.glb'),
    ('mountain_A_grass_trees', 'hex_mountain_a_trees.glb'),
]


def compose(deco, out):
    kp.reset_scene()
    bpy.ops.import_scene.gltf(filepath=os.path.join(HEX, 'tiles', 'base', 'hex_grass.gltf'))
    bpy.ops.import_scene.gltf(filepath=os.path.join(HEX, 'decoration', 'nature', deco + '.gltf'))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = os.path.splitext(out)[0]
    for poly in obj.data.polygons:
        poly.material_index = 0
    while len(obj.data.materials) > 1:
        obj.data.materials.pop(index=len(obj.data.materials) - 1)
    for v in obj.data.vertices:
        v.co *= 0.5  # flat-to-flat 2 -> 1 hex, top face stays at z=0
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    path = os.path.join(OUT, out)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_image_format='AUTO',
    )
    print(f'wrote {path}: {os.path.getsize(path)} bytes')


if __name__ == '__main__':
    for job in JOBS:
        compose(*job)

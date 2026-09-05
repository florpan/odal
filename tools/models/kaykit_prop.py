"""Convert static KayKit props (buildings, trees, rocks) into Odal model GLBs.

Each prop is imported, its meshes joined into one object, moved so the base sits at
y=0 and the footprint is centred on the origin, normalised, and exported as a GLB
with the texture embedded. Two normalisations:

  footprint  max horizontal extent = 1 unit; the renderer scales by the building's
             footprint in tiles (the miniature Hexagon tile set).
  scale:F    multiply by a fixed factor F, the same for every asset of a pack family so
             relative sizes are kept. CHARACTER_SCALE (1 / Rogue height) makes a KayKit
             person 1 tile tall; use it for nature, resources and props.
  height     height = 1 unit (legacy; a different factor per asset, avoid).

Run inside Blender, headless:

    blender -b -P tools/models/kaykit_prop.py -- footprint <in.gltf> <out.glb> [more in out pairs]

or through the Blender MCP: set JOBS = [(mode, in, out), ...] before exec()-ing.
"""

import os
import sys

import bpy
from mathutils import Vector

HEX = r'C:\Dev\KayKit\KayKit_Medieval_Hexagon_Pack_1.0\Assets\gltf'
FOREST = r'C:\Dev\KayKit\KayKit_Forest_Nature_Pack_1.0\Assets\gltf'
OUT = r'C:\Dev\odal\packages\client\public\models'

# KayKit characters are 2.18 units tall in their packs and one tile in Odal. Everything that
# shares their world (Forest Nature, Resource Bits, props) is scaled by this same factor.
CHARACTER_SCALE = 1 / 2.18

DEFAULT_JOBS = [
    ('footprint', os.path.join(HEX, 'buildings', 'red', 'building_home_A_red.gltf'), os.path.join(OUT, 'home_a_red.glb')),
    ('footprint', os.path.join(HEX, 'buildings', 'blue', 'building_home_A_blue.gltf'), os.path.join(OUT, 'home_a_blue.glb')),
    ('footprint', os.path.join(HEX, 'buildings', 'green', 'building_home_A_green.gltf'), os.path.join(OUT, 'home_a_green.glb')),
    ('footprint', os.path.join(HEX, 'buildings', 'yellow', 'building_home_A_yellow.gltf'), os.path.join(OUT, 'home_a_yellow.glb')),
    (f'scale:{CHARACTER_SCALE}', os.path.join(FOREST, 'Tree_1_C_Color1.gltf'), os.path.join(OUT, 'tree_1.glb')),
    (f'scale:{CHARACTER_SCALE}', os.path.join(FOREST, 'Tree_2_C_Color1.gltf'), os.path.join(OUT, 'tree_2.glb')),
    (f'scale:{CHARACTER_SCALE}', os.path.join(FOREST, 'Tree_3_C_Color1.gltf'), os.path.join(OUT, 'tree_3.glb')),
    (f'scale:{CHARACTER_SCALE}', os.path.join(FOREST, 'Tree_4_C_Color1.gltf'), os.path.join(OUT, 'tree_4.glb')),
]


def reset_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def convert(mode, src, out):
    reset_scene()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=src)
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == 'MESH']
    if not meshes:
        raise RuntimeError(f'no meshes in {src}')

    # Join into one object with world transforms applied.
    bpy.ops.object.select_all(action='DESELECT')
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = os.path.splitext(os.path.basename(out))[0]
    for o in imported:
        if o.type != 'MESH' and o.name in bpy.data.objects:
            bpy.data.objects.remove(o)

    # Centre the footprint on the origin, base at z=0 (Blender z-up), then normalise.
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    cx, cy, z0 = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs)
    for v in obj.data.vertices:
        v.co -= Vector((cx, cy, z0))
    extent = max(max(xs) - min(xs), max(ys) - min(ys))
    height = max(zs) - min(zs)
    if mode == 'footprint':
        s = 1 / extent
    elif mode.startswith('scale:'):
        s = float(mode.split(':', 1)[1])
    else:
        s = 1 / height
    for v in obj.data.vertices:
        v.co *= s

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_image_format='AUTO',
    )
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f'wrote {out}: {tris} tris, source footprint {extent:.2f} height {height:.2f} -> {mode} normalised '
          f'(now {extent * s:.2f} wide, {height * s:.2f} tall), {os.path.getsize(out)} bytes')


def parse_cli():
    if '--' not in sys.argv:
        return None
    argv = sys.argv[sys.argv.index('--') + 1:]
    mode = argv[0]
    pairs = argv[1:]
    return [(mode, pairs[i], pairs[i + 1]) for i in range(0, len(pairs) - 1, 2)]


if __name__ == '__main__':
    for job in parse_cli() or globals().get('JOBS') or DEFAULT_JOBS:
        convert(*job)

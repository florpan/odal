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
  hex[:deg]  a Hexagon-pack ground tile: kept centred with its top face at y=0 (the pack
             authors them that way, base below), scaled so flat-to-flat = 1 (one Odal hex),
             optionally rotated `deg` about the vertical axis first. Coast tiles are rotated so
             the water side is centred on +z (screen bottom); the renderer turns them from there.

Run inside Blender, headless:

    blender -b -P tools/models/kaykit_prop.py -- footprint <in.gltf> <out.glb> [more in out pairs]

or through the Blender MCP: set JOBS = [(mode, in, out), ...] before exec()-ing.
"""

import os
import sys

import bpy
from mathutils import Vector

# The EXTRA pack (itch.io, CC0 like the free one) is a superset of the free pack: same tiles and nature,
# plus units, more buildings, props and three alternate atlases (Summer, Fall, Winter) in its Textures dir.
HEX = r'C:\Dev\KayKit\KayKit_Medieval_Hexagon_Pack_1.0_EXTRA\Assets\gltf'
FOREST = r'C:\Dev\KayKit\KayKit_Forest_Nature_Pack_1.0\Assets\gltf'
OUT = r'C:\Dev\odal\packages\client\public\models'

# KayKit characters are 2.18 units tall in their packs and one tile in Odal. Everything that
# shares their world (Forest Nature, Resource Bits, props) is scaled by this same factor.
CHARACTER_SCALE = 1 / 2.18

# Colour nudges applied to a pack's palette texture at export, as sRGB bytes. The KayKit textures are
# flat-colour atlases, so a swatch is matched by value (within TOLERANCE) and replaced everywhere it is
# used: tiles, hill and mountain tops, building bases. The Hexagon pack's grass is a pale lime with red
# about equal to green, which reads yellow under any white light; this pulls it a little towards green.
# Keep the steps small: shadows and lighting are still to come and shift the overall feel too.
PALETTE = {
    (224, 227, 127): (196, 226, 116),  # grass
}
TOLERANCE = 6

DEFAULT_JOBS = [
    ('footprint', os.path.join(HEX, 'buildings', 'red', 'building_home_A_red.gltf'), os.path.join(OUT, 'home_a_red.glb')),
    ('footprint', os.path.join(HEX, 'buildings', 'blue', 'building_home_A_blue.gltf'), os.path.join(OUT, 'home_a_blue.glb')),
    ('footprint', os.path.join(HEX, 'buildings', 'green', 'building_home_A_green.gltf'), os.path.join(OUT, 'home_a_green.glb')),
    ('footprint', os.path.join(HEX, 'buildings', 'yellow', 'building_home_A_yellow.gltf'), os.path.join(OUT, 'home_a_yellow.glb')),
    (f'scale:{CHARACTER_SCALE}', os.path.join(FOREST, 'Tree_1_C_Color1.gltf'), os.path.join(OUT, 'tree_1.glb')),
    (f'scale:{CHARACTER_SCALE}', os.path.join(FOREST, 'Tree_2_C_Color1.gltf'), os.path.join(OUT, 'tree_2.glb')),
    (f'scale:{CHARACTER_SCALE}', os.path.join(FOREST, 'Tree_3_C_Color1.gltf'), os.path.join(OUT, 'tree_3.glb')),
    (f'scale:{CHARACTER_SCALE}', os.path.join(FOREST, 'Tree_4_C_Color1.gltf'), os.path.join(OUT, 'tree_4.glb')),
    # Ground tiles (terrain.json). Coast A-D have 1-4 consecutive water edges; their water is centred at
    # Blender 300/270/300/330 degrees, so rotate by 270 minus that to put it at 270 (= +z in glTF).
    ('hex', os.path.join(HEX, 'tiles', 'base', 'hex_grass.gltf'), os.path.join(OUT, 'hex_grass.glb')),
    ('hex', os.path.join(HEX, 'tiles', 'base', 'hex_water.gltf'), os.path.join(OUT, 'hex_water.glb')),
    ('hex:-30', os.path.join(HEX, 'tiles', 'coast', 'hex_coast_A.gltf'), os.path.join(OUT, 'hex_coast_1.glb')),
    ('hex:0', os.path.join(HEX, 'tiles', 'coast', 'hex_coast_B.gltf'), os.path.join(OUT, 'hex_coast_2.glb')),
    ('hex:-30', os.path.join(HEX, 'tiles', 'coast', 'hex_coast_C.gltf'), os.path.join(OUT, 'hex_coast_3.glb')),
    ('hex:-60', os.path.join(HEX, 'tiles', 'coast', 'hex_coast_D.gltf'), os.path.join(OUT, 'hex_coast_4.glb')),
] + [
    # Hexagon-pack decorations at tile scale (they sit on a tile; see kaykit_compose.py for whole-tile ones).
    ('scale:0.5', os.path.join(HEX, 'decoration', 'nature', f'{n}.gltf'), os.path.join(OUT, f'hex_{n.lower()}.glb'))
    for n in ['tree_single_A', 'tree_single_B', 'trees_A_small', 'trees_A_medium', 'trees_A_large', 'trees_B_small',
              'trees_B_medium', 'trees_B_large', 'rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D',
              'rock_single_E']
]


def remap_palette(images):
    """Replace PALETTE swatches in the given images (in place, packed so the export carries the change)."""
    if not PALETTE:
        return
    import numpy as np
    for img in images:
        px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)  # linear floats
        srgb = np.rint(np.clip(px[:, :3], 0, 1) ** (1 / 2.2) * 255)
        changed = 0
        for src, dst in PALETTE.items():
            mask = np.all(np.abs(srgb - np.array(src)) <= TOLERANCE, axis=1)
            n = int(mask.sum())
            if n:
                px[mask, :3] = (np.array(dst, dtype=np.float32) / 255) ** 2.2
                changed += n
        if changed:
            img.pixels = px.reshape(-1).tolist()
            img.pack()
            print(f'palette: {img.name}: {changed} texels remapped')


def images_of(obj):
    out = []
    for m in obj.data.materials:
        if not m or not m.node_tree:
            continue
        for node in m.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image and node.image not in out:
                out.append(node.image)
    return out


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
    # Hex tiles keep their authored origin (top face at z=0) and only get scaled and turned.
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    is_hex = mode == 'hex' or mode.startswith('hex:')
    cx, cy, z0 = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs)
    if not is_hex:
        for v in obj.data.vertices:
            v.co -= Vector((cx, cy, z0))
    extent = max(max(xs) - min(xs), max(ys) - min(ys))
    height = max(zs) - min(zs)
    if mode == 'footprint':
        s = 1 / extent
    elif mode.startswith('scale:'):
        s = float(mode.split(':', 1)[1])
    elif is_hex:
        s = 1 / (max(xs) - min(xs))  # flat-to-flat width becomes one hex
    else:
        s = 1 / height
    if is_hex and ':' in mode:
        import math
        from mathutils import Matrix
        rot = Matrix.Rotation(math.radians(float(mode.split(':', 1)[1])), 4, 'Z')
        for v in obj.data.vertices:
            v.co = rot @ v.co
    for v in obj.data.vertices:
        v.co *= s

    remap_palette(images_of(obj))
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

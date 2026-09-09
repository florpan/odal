"""Convert static KayKit props (buildings, trees, rocks) into Odal model GLBs.

Each prop is imported, its meshes joined into one object, moved so the base sits at
y=0 and the footprint is centred on the origin, normalised, and exported as a GLB
with the texture embedded. Two normalisations:

  footprint  max horizontal extent = 1 unit; the renderer scales by the building's
             footprint in tiles (the miniature Hexagon tile set).
  scale:F    multiply by a fixed factor F, the same for every asset of a pack family so
             relative sizes are kept. CHARACTER_SCALE (1 / Rogue height) makes a KayKit
             person 1 tile tall; use it for nature, resources and props.
  centre:F   like scale:F but centred on the origin in all three axes instead of standing
             on it: for things that fly (projectiles); the client sizes and turns them.
  height     height = 1 unit (legacy; a different factor per asset, avoid).
  hex[:deg]  a Hexagon-pack ground tile: kept centred with its top face at y=0 (the pack
             authors them that way, base below), scaled so flat-to-flat = 1 (one Odal hex),
             optionally rotated `deg` about the vertical axis first. Coast tiles are rotated so
             the water side is centred on +z (screen bottom); the renderer turns them from there.

A job may carry a fourth element, options: {'material': {'color': '#rrggbb', 'metallic': 0..1,
'roughness': 0..1}} replaces every material with one flat Principled material (the ore rocks: the
resource's own colour, shiny; the client turns low roughness into a specular material).

Run inside Blender, headless:

    blender -b -P tools/models/kaykit_prop.py                       # every DEFAULT_JOBS entry
    blender -b -P tools/models/kaykit_prop.py -- group ores          # one JOB_GROUPS entry
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

# The Hexagon pack's texture for every exported GLB. The pack ships one atlas ("hexagons_medieval.png",
# referenced by every model) and three seasonal recolours with the same layout in tiles/base. Summer is
# Odal's look (decided 2026-09-07); None keeps the pack's default. The client can still swap at runtime
# for comparison (?atlas=default|summer|fall|winter, see client render/models.ts).
ATLAS = os.path.join(HEX, 'tiles', 'base', 'hexagons_medieval_Summer.png')

# Colour nudges applied to a pack's palette texture at export, as sRGB bytes: {(r, g, b): (r, g, b)}. The
# KayKit textures are flat-colour atlases, so a swatch is matched by value (within TOLERANCE) and replaced
# everywhere it is used. Empty on purpose: a nudge of the Hexagon grass (224,227,127 -> 196,226,116) made
# the whole board lime, since tiles, hill tops and building bases share the atlas. Prefer the pack's own
# seasonal atlases (tiles/base/hexagons_medieval_{Summer,Fall,Winter}.png) over tinting.
PALETTE: dict[tuple[int, int, int], tuple[int, int, int]] = {}
TOLERANCE = 6

DEFAULT_JOBS = [
    # Hexagon-pack buildings, one per hex at the pack's own proportions (a house is small, a castle
    # fills the tile). Four team colours each; the tree refers to them as "<name>_{team}.glb".
] + [
    ('scale:0.5', os.path.join(HEX, 'buildings', c, f'building_{n}_{c}.gltf'), os.path.join(OUT, f'{n.lower()}_{c}.glb'))
    for n in ['townhall', 'home_A', 'windmill', 'blacksmith', 'barracks', 'tower_A', 'lumbermill', 'mine', 'market', 'castle']
    for c in ['red', 'blue', 'green', 'yellow']
] + [
    # The rest of the pack's team buildings, red only, as placeable test buildings until they get a role
    # (then: four colours and "{team}").
    ('scale:0.5', os.path.join(HEX, 'buildings', 'red', f'building_{n}_red.gltf'), os.path.join(OUT, f'{n.lower()}.glb'))
    for n in ['archeryrange', 'church', 'shrine', 'stables', 'workshop', 'watermill', 'well', 'tavern', 'tower_B',
              'tower_catapult', 'tower_cannon', 'watchtower', 'docks', 'shipyard', 'tent', 'home_B']
] + [
    # Neutral pieces: walls, gate, fences, a grain field, construction and ruin stages.
    ('scale:0.5', os.path.join(HEX, 'buildings', 'neutral', f'{n}.gltf'), os.path.join(OUT, f'{out}.glb'))
    for n, out in [('wall_straight', 'wall'), ('wall_straight_gate', 'gate'), ('wall_corner_A_outside', 'wall_corner'),
                   ('fence_wood_straight', 'fence_wood'), ('fence_stone_straight', 'fence_stone'),
                   ('building_grain', 'grain'), ('building_scaffolding', 'scaffolding'), ('building_destroyed', 'ruin'),
                   ('building_bridge_A', 'bridge')]
] + [
    # Projectiles: centred so the client can spin them; it scales the long axis to the projectile's `size`.
    ('centre:0.5', os.path.join(HEX, 'units', 'red', 'projectile_arrow_red_full.gltf'), os.path.join(OUT, 'arrow.glb')),
] + [
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

# Ore deposits: Forest Nature rocks in the resource's own colour (nodes.json), shiny so they read as
# metal next to the grey stone outcrops. Picked by Christer on 2026-09-09.
ORE = {'iron': ('#8a8f98', ['Rock_2_G', 'Rock_2_H']), 'gold': ('#f5c518', ['Rock_3_Q', 'Rock_3_R'])}
JOB_GROUPS = {
    'ores': [
        (f'scale:{CHARACTER_SCALE}', os.path.join(FOREST, f'{rock}_Color1.gltf'), os.path.join(OUT, f'ore_{res}_{i + 1}.glb'),
         {'material': {'color': colour, 'metallic': 0.85, 'roughness': 0.3}})
        for res, (colour, rocks) in ORE.items() for i, rock in enumerate(rocks)
    ],
    # Foliage sprinkled over the ground by terrain.visual.scatter (CONTENT.md): grass tufts and bushes
    # from Forest Nature at character scale, water plants from the Hexagon pack at tile scale. (Pebbles,
    # Rock_3 A-E, were tried and dropped: the ore, stone and cliffs are rock enough.)
    'foliage': [
        (f'scale:{CHARACTER_SCALE}', os.path.join(FOREST, f'{n}_Color1.gltf'), os.path.join(OUT, f'{n.lower()}.glb'))
        for n in ['Grass_1_A', 'Grass_1_B', 'Grass_2_A', 'Grass_2_B', 'Grass_2_C', 'Grass_2_D',
                  'Bush_1_A', 'Bush_1_B', 'Bush_2_A']
    ] + [
        ('scale:0.5', os.path.join(HEX, 'decoration', 'nature', f'{n}.gltf'), os.path.join(OUT, f'{n.lower()}.glb'))
        for n in ['waterplant_A', 'waterplant_B', 'waterplant_C']
    ],
}
DEFAULT_JOBS += [job for group in JOB_GROUPS.values() for job in group]


def srgb_to_linear(hex_colour):
    out = []
    for i in (1, 3, 5):
        c = int(hex_colour[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def flat_material(obj, spec):
    """One untextured Principled material for the whole object (colour as sRGB hex)."""
    mat = bpy.data.materials.new(obj.name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*srgb_to_linear(spec['color']), 1)
    bsdf.inputs['Metallic'].default_value = spec.get('metallic', 0)
    bsdf.inputs['Roughness'].default_value = spec.get('roughness', 0.5)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.material_index = 0


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


def use_atlas(obj):
    """Point every Hexagon-pack material of `obj` at ATLAS so the export embeds that image instead."""
    if not ATLAS:
        return
    atlas = None
    for m in obj.data.materials:
        if not m or not m.node_tree:
            continue
        for node in m.node_tree.nodes:
            if node.type != 'TEX_IMAGE' or not node.image:
                continue
            if not os.path.basename(node.image.filepath).lower().startswith('hexagons_medieval'):
                continue
            if atlas is None:
                atlas = bpy.data.images.load(ATLAS, check_existing=True)
                atlas.name = 'hexagons_medieval'
            node.image = atlas


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


def convert(mode, src, out, opts=None):
    opts = opts or {}
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
    # KayKit packs share one texture per pack; joined parts leave duplicate material slots that would
    # export as separate primitives. Keep slot 0 for every face when the slots all use the same image.
    imgs = {id(next((nd.image for nd in m.node_tree.nodes if nd.type == 'TEX_IMAGE' and nd.image), None))
            for m in obj.data.materials if m and m.node_tree}
    if len(obj.data.materials) > 1 and len(imgs) == 1:
        for poly in obj.data.polygons:
            poly.material_index = 0
        while len(obj.data.materials) > 1:
            obj.data.materials.pop(index=len(obj.data.materials) - 1)
    obj.name = os.path.splitext(os.path.basename(out))[0]
    # Joining removed the other mesh objects; drop whatever else the import brought (empties, lights).
    for o in [o for o in bpy.data.objects if o is not obj]:
        bpy.data.objects.remove(o)

    # Centre the footprint on the origin, base at z=0 (Blender z-up), then normalise.
    # Hex tiles keep their authored origin (top face at z=0) and only get scaled and turned.
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    is_hex = mode == 'hex' or mode.startswith('hex:')
    is_centred = mode.startswith('centre:')
    cx, cy, z0 = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs)
    if is_centred:
        z0 = (max(zs) + min(zs)) / 2
    if not is_hex:
        for v in obj.data.vertices:
            v.co -= Vector((cx, cy, z0))
    extent = max(max(xs) - min(xs), max(ys) - min(ys))
    height = max(zs) - min(zs)
    if mode == 'footprint':
        s = 1 / extent
    elif mode.startswith('scale:') or is_centred:
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

    # Textures go out as the pack ships them (ATLAS picks which of the pack's own atlases).
    # remap_palette(images_of(obj)) is kept as a tool for deliberate swatch swaps; not part of the export.
    use_atlas(obj)
    if 'material' in opts:
        flat_material(obj, opts['material'])
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
    if mode == 'group':
        return [job for name in argv[1:] for job in JOB_GROUPS[name]]
    pairs = argv[1:]
    return [(mode, pairs[i], pairs[i + 1]) for i in range(0, len(pairs) - 1, 2)]


if __name__ == '__main__':
    for job in parse_cli() or globals().get('JOBS') or DEFAULT_JOBS:
        convert(*job)

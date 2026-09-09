"""Turn a KayKit character into an Odal unit model: one GLB with the character mesh,
a flat "Team" material where the owner's colour goes, a prop in its hand, the
animation clips we use renamed to Odal's task names, and the whole thing scaled to
1 unit tall.

KayKit packs (CC0, Kay Lousberg, www.kaylousberg.com) ship characters and animations
as separate GLBs that share the Rig_Medium skeleton, so clips can be copied across.

Each Adventurer is textured from a 1024x1024 palette: 8 columns x 4 rows of vertical
gradient cells, and every face's UVs sit inside one cell. That makes two things cheap:
    --paint COL,ROW=#top[:#bottom]   recolour a cell (e.g. the Rogue's green shirt to brown)
    --team-cell COL,ROW              give every face in that cell the Team material
Cells count from the top-left, so the Rogue's shirt is 0,1 and its scarf, collar and cape 1,1.
Survey a character's cells before choosing: see the UV-cell listing in docs/PLAN.md.
    --drop MESH                      leave a mesh out (Rogue_Cape)
    --team MESH                      the whole mesh gets the Team material (the old way)
    --prop FILE[@BONE]               a pack prop (axe, bow, ...) held in BONE (default handslot.r).
                                     The prop becomes skinned geometry weighted to that bone, placed
                                     at the bone's rest frame as the pack authored it (UNITS entries
                                     can add a rotation for props that need turning, see prop()).
    --clip NAME=ACTION[+ACTION...]   an Odal clip from one action, or several played back to back
                                     (the archer's attack is the bow draw followed by the release)

Run inside Blender, headless. Every unit in UNITS, or one of them:

    blender -b -P tools/models/kaykit_character.py
    blender -b -P tools/models/kaykit_character.py -- --unit soldier

or an ad-hoc conversion:

    blender -b -P tools/models/kaykit_character.py -- <character.glb> <out.glb> \
        --anim <animations.glb> [--anim ...] --clip idle=Idle_A --clip walk=Walking_A ... \
        [--drop Rogue_Cape] [--paint 0,1=#9a7550:#5f4630] [--team-cell 1,1] \
        [--prop axe_1handed.gltf@handslot.r] [--team Rogue_Cape] [--team-color 0.8,0.2,0.18]

or through the Blender MCP by setting ARGS before exec()-ing this file.
"""

import json
import math
import os
import struct
import sys

import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion

PALETTE_COLS, PALETTE_ROWS = 8, 4

ADVENTURERS = r'C:\Dev\KayKit\KayKit_Adventurers_2.0'
CHARACTERS = os.path.join(ADVENTURERS, 'Characters', 'gltf')
PROPS = os.path.join(ADVENTURERS, 'Assets', 'gltf')
ANIMATIONS = r'C:\Dev\KayKit\KayKit_Character_Animations_1.1\Animations\gltf\Rig_Medium'
OUT = r'C:\Dev\odal\packages\client\public\models'


def anim(name):
    return os.path.join(ANIMATIONS, f'Rig_Medium_{name}.glb')


def prop(name, bone='handslot.r', rot=(0, 0, 0)):
    """A pack prop and the bone that holds it. `rot` (degrees, XYZ, in the prop's own frame) corrects
    props that do not fit the slot as authored. The slot's +Y is the grip axis (a sword's blade), +Z its
    up (a bow's limbs), and both slots share one frame (they are not mirrored), which is why the
    one-handed axe's head faces the body in the right hand and gets turned around."""
    return (os.path.join(PROPS, f'{name}.gltf'), bone, rot)


COMMON_CLIPS = {'idle': 'Idle_A', 'walk': 'Walking_A', 'hit': 'Hit_A', 'death': 'Death_A'}

# One entry per unit: the character, what to change on it, its prop and its clips. The roster and the
# palette cells behind `paint` / `team_cells` are in docs/PLAN.md ("Roster decided 2026-09-09").
UNITS = {
    'worker': {
        'character': 'Rogue',
        'drop': ['Rogue_Cape'],
        'paint': {(0, 1): ('#9a7550', '#5f4630')},  # shirt and sleeves: undyed wool instead of green
        'team_cells': [(1, 1)],  # scarf, collar and cuffs carry the owner's colour
        'props': [prop('axe_1handed', rot=(0, 180, 0))],  # no pickaxe in the pack: the axe does rock too
        'anims': ['General', 'MovementBasic', 'Tools', 'CombatMelee'],
        'clips': {**COMMON_CLIPS, 'chop': 'Chopping', 'mine': 'Pickaxing', 'build': 'Hammering',
                  'attack': 'Melee_1H_Attack_Chop'},
    },
    'soldier': {
        'character': 'Barbarian',
        'team_cells': [(6, 0)],  # kilt and bracers (1,3 is the necklace teeth)
        'props': [prop('axe_2handed')],
        'anims': ['General', 'MovementBasic', 'CombatMelee'],
        'clips': {**COMMON_CLIPS, 'attack': 'Melee_2H_Attack_Chop'},
    },
    'scout': {
        'character': 'Rogue_Hooded',
        'team_cells': [(1, 1)],  # hood, cape and scarf
        'props': [prop('dagger')],
        'anims': ['General', 'MovementBasic', 'CombatMelee'],
        'clips': {**COMMON_CLIPS, 'attack': 'Melee_1H_Attack_Stab'},
    },
    'knight': {
        'character': 'Knight',
        'team_cells': [(0, 1)],  # cape and tunic trim
        'props': [prop('sword_2handed')],
        'anims': ['General', 'MovementBasic', 'CombatMelee'],
        'clips': {**COMMON_CLIPS, 'attack': 'Melee_2H_Attack_Slice'},
    },
    'archer': {
        'character': 'Ranger',
        'team_cells': [(0, 1)],  # cape and tunic
        'props': [prop('bow_withString', 'handslot.l')],
        'anims': ['General', 'MovementBasic', 'CombatRanged'],
        'clips': {**COMMON_CLIPS, 'attack': 'Ranged_Bow_Draw+Ranged_Bow_Release'},
    },
    'mage': {
        'character': 'Mage',
        'team_cells': [(2, 1)],  # cape
        'props': [prop('staff')],
        'anims': ['General', 'MovementBasic', 'CombatRanged'],
        'clips': {**COMMON_CLIPS, 'attack': 'Ranged_Magic_Shoot'},
    },
}

TEAM_COLOR = (0.8, 0.2, 0.18)


def unit_args(name):
    u = UNITS[name]
    return {
        'name': name,
        'character': os.path.join(CHARACTERS, f'{u["character"]}.glb'),
        'out': os.path.join(OUT, f'{name}.glb'),
        'anims': [anim(a) for a in u['anims']],
        'clips': u['clips'],
        'drop': u.get('drop', []),
        'paint': u.get('paint', {}),
        'team_cells': u.get('team_cells', []),
        'team': u.get('team', []),
        'props': u.get('props', []),
        'team_color': TEAM_COLOR,
    }


def parse_cell(text):
    c, r = (int(x) for x in text.split(','))
    return (c, r)


def parse_hex(text):
    text = text.lstrip('#')
    return tuple(int(text[i:i + 2], 16) / 255 for i in (0, 2, 4))


def parse_cli():
    """A list of arg dicts to build, or None when the script runs without `--` (then: every unit)."""
    if '--' not in sys.argv:
        return None
    argv = sys.argv[sys.argv.index('--') + 1:]
    a = {'name': 'custom', 'anims': [], 'clips': {}, 'drop': [], 'paint': {}, 'team_cells': [], 'team': [],
         'props': [], 'team_color': TEAM_COLOR}
    units = []
    pos = []
    i = 0
    while i < len(argv):
        t = argv[i]
        if t == '--unit':
            units.append(argv[i + 1]); i += 2
        elif t == '--anim':
            a['anims'].append(argv[i + 1]); i += 2
        elif t == '--clip':
            k, v = argv[i + 1].split('=', 1); a['clips'][k] = v; i += 2
        elif t == '--drop':
            a['drop'].append(argv[i + 1]); i += 2
        elif t == '--paint':
            cell, colours = argv[i + 1].split('=', 1)
            top, _, bottom = colours.partition(':')
            a['paint'][parse_cell(cell)] = (top, bottom or top); i += 2
        elif t == '--team-cell':
            a['team_cells'].append(parse_cell(argv[i + 1])); i += 2
        elif t == '--team':
            a['team'].append(argv[i + 1]); i += 2
        elif t == '--team-color':
            a['team_color'] = tuple(float(x) for x in argv[i + 1].split(',')); i += 2
        elif t == '--prop':
            path, _, bone = argv[i + 1].partition('@')
            a['props'].append((path, bone or 'handslot.r', (0, 0, 0))); i += 2
        else:
            pos.append(t); i += 1
    if units:
        return [unit_args(u) for u in units]
    if len(pos) < 2:
        return None
    a['character'], a['out'] = pos[0], pos[1]
    if not a['clips']:
        a['clips'] = COMMON_CLIPS
    return [a]


def matches(name, patterns):
    return name in patterns or any(name.endswith(p) for p in patterns)


def reset_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials, bpy.data.images):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def find_action(name):
    """KayKit actions import as e.g. 'Walking_A' or 'Rig_Medium|Walking_A' (possibly with .001)."""
    for a in bpy.data.actions:
        base = a.name.split('|')[-1]
        base = base.split('.')[0] if base.split('.')[-1].isdigit() else base
        if base == name:
            return a
    return None


def uv_cell(mesh, poly, uv):
    """The palette cell (col, row from the top-left) a face's UVs sit in, by majority of its corners."""
    counts = {}
    for li in poly.loop_indices:
        u, v = uv[li].uv
        cell = (min(PALETTE_COLS - 1, max(0, int(u * PALETTE_COLS))),
                min(PALETTE_ROWS - 1, max(0, int((1 - v) * PALETTE_ROWS))))
        counts[cell] = counts.get(cell, 0) + 1
    return max(counts, key=counts.get)


def paint_cells(meshes, paint):
    """Overwrite palette cells of the character's texture with a top-to-bottom gradient (sRGB hex)."""
    images = {slot.material.node_tree.nodes['Image Texture'].image
              for m in meshes for slot in m.material_slots
              if slot.material and slot.material.use_nodes and 'Image Texture' in slot.material.node_tree.nodes}
    for img in images:
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)  # row 0 is the bottom of the image
        cw, ch = w // PALETTE_COLS, h // PALETTE_ROWS
        for (c, r), (top, bottom) in paint.items():
            t = np.linspace(1.0, 0.0, ch)[:, None]  # bottom row of the cell first
            grad = t * np.array(parse_hex(bottom)) + (1 - t) * np.array(parse_hex(top))
            y0, x0 = (PALETTE_ROWS - 1 - r) * ch, c * cw
            px[y0:y0 + ch, x0:x0 + cw, :3] = grad[:, None, :]
        img.pixels.foreach_set(px.ravel())
        img.update()
        img.pack()  # the exporter embeds the packed bytes; repack so it sees the new pixels


# glTF is y-up, Blender z-up: (x, y, z) -> (x, -z, y).
GLTF_TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def joint_rest(glb, bone):
    """Rest transform of joint `bone` in the character file's own coordinates (glTF, y-up), composed
    from its node chain. Read straight from the file: what the pack's users attach props to."""
    with open(glb, 'rb') as f:
        data = f.read()
    length = struct.unpack_from('<I', data, 12)[0]
    nodes = json.loads(data[20:20 + length])['nodes']
    parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
    i = next((i for i, n in enumerate(nodes) if n.get('name') == bone), None)
    if i is None:
        raise RuntimeError(f'{glb} has no joint {bone}')
    m = Matrix.Identity(4)
    while i is not None:
        n = nodes[i]
        t = Matrix.Translation(n.get('translation', (0, 0, 0)))
        q = n.get('rotation', (0, 0, 0, 1))
        r = Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
        s = Matrix.Diagonal((*n.get('scale', (1, 1, 1)), 1))
        m = t @ r @ s @ m
        i = parent.get(i)
    return m


def attach_prop(armature, character_file, path, bone, rot=(0, 0, 0)):
    """Import a pack prop and make it skinned geometry that follows `bone`: vertices turned by `rot`
    (degrees) in the prop's frame, moved to the bone's rest frame, one vertex group with full weight,
    an Armature modifier."""
    rest = joint_rest(character_file, bone) @ Euler([math.radians(d) for d in rot], 'XYZ').to_matrix().to_4x4()
    imported = import_glb(path)
    names = {o.name for o in imported}
    parts = [o for o in imported if o.type == 'MESH']
    if not parts:
        raise RuntimeError(f'no meshes in {path}')
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(parts) > 1:
        bpy.ops.object.join()
    held = bpy.context.active_object
    for o in [o for o in bpy.data.objects if o.name in names and o is not held]:
        bpy.data.objects.remove(o)
    # The bow carries a shape key that animates its string. With shape keys the export takes the key's
    # coordinates, not the vertices moved below, so the prop would stay at the origin: drop them.
    if held.data.shape_keys:
        held.shape_key_clear()
    world = GLTF_TO_BLENDER @ rest @ GLTF_TO_BLENDER.inverted()
    for v in held.data.vertices:
        v.co = world @ v.co
    held.name = os.path.splitext(os.path.basename(path))[0]
    held.parent = armature
    group = held.vertex_groups.new(name=bone)
    group.add([v.index for v in held.data.vertices], 1.0, 'REPLACE')
    held.modifiers.new('Armature', 'ARMATURE').object = armature
    return held


def build(args):
    reset_scene()
    objs = import_glb(args['character'])
    armature = next(o for o in objs if o.type == 'ARMATURE')
    # Only the rig's own meshes. The Adventurers files also carry a loose "Icosphere" (a palette
    # sampling helper spanning z -1..1) that would otherwise inflate the height measurement.
    meshes = [o for o in objs if o.type == 'MESH' and o.parent == armature]
    for o in objs:
        if o.type == 'MESH' and (o.parent != armature or matches(o.name, args['drop'])):
            if o in meshes:
                meshes.remove(o)
            bpy.data.objects.remove(o)
    armature.name = args['name']

    # Bring in the clips: import each animation file, keep its actions, drop its mannequin.
    wanted = {part for v in args['clips'].values() for part in v.split('+')}
    for path in args['anims']:
        imported = import_glb(path)
        for a in bpy.data.actions:
            a.use_fake_user = True
        # Remove directly: some imported objects are not in the view layer and would survive object.delete().
        for o in imported:
            bpy.data.objects.remove(o)
    for a in list(bpy.data.actions):
        base = a.name.split('|')[-1]
        if base not in wanted and a.name not in wanted:
            bpy.data.actions.remove(a)

    # Stash each wanted clip as an NLA track named after Odal's clip name, its actions as strips back
    # to back; the exporter (NLA_TRACKS mode) turns every track into one glTF animation with that name.
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = None
    for track in list(armature.animation_data.nla_tracks):
        armature.animation_data.nla_tracks.remove(track)
    missing = []
    for ours, theirs in args['clips'].items():
        actions = [find_action(t) for t in theirs.split('+')]
        if None in actions:
            missing.append(theirs)
            continue
        track = armature.animation_data.nla_tracks.new()
        track.name = ours
        track.mute = False
        start = int(actions[0].frame_range[0])
        for n, action in enumerate(actions):
            action.name = ours if n == 0 else f'{ours}.{n}'
            strip = track.strips.new(action.name, start, action)
            start = int(math.ceil(strip.frame_end)) + 1
    if missing:
        print('WARNING missing clips:', missing)

    # Recolour palette cells before the Team pass, so painted cells can still be team cells.
    if args['paint']:
        paint_cells(meshes, args['paint'])

    # Team colour: a flat material on whole meshes (--team) or on the faces of a palette cell
    # (--team-cell). A mesh that gets both keeps only Team.
    team = bpy.data.materials.new('Team')
    team.use_nodes = True
    bsdf = team.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*args['team_color'], 1)
    bsdf.inputs['Roughness'].default_value = 1.0
    team_cells = set(args['team_cells'])
    team_faces = 0
    for m in meshes:
        if matches(m.name, args['team']):
            m.data.materials.clear()
            m.data.materials.append(team)
            team_faces += len(m.data.polygons)
        elif team_cells and m.data.uv_layers.active:
            uv = m.data.uv_layers.active.data
            hits = [p for p in m.data.polygons if uv_cell(m.data, p, uv) in team_cells]
            if hits:
                m.data.materials.append(team)
                slot = len(m.data.materials) - 1
                for p in hits:
                    p.material_index = slot
                team_faces += len(hits)
    if (args['team'] or team_cells) and not team_faces:
        print('WARNING no face got the Team material; the owner colour will not show on this model')

    # Height of the character alone (a raised sword must not shrink the body), measured from the bind
    # pose straight from the vertex data (mesh objects sit under the armature at scale 1).
    zs = []
    for m in meshes:
        mw = m.matrix_world
        zs.extend((mw @ v.co).z for v in m.data.vertices)
    height = max(zs) - min(zs)

    # Props, after the team pass (their own textures must not be mistaken for palette cells).
    for path, bone, rot in args['props']:
        meshes.append(attach_prop(armature, args['character'], path, bone, rot))

    # Normalise height to 1 unit (feet stay at 0) by scaling the armature object; the props follow.
    armature.scale = (1 / height, 1 / height, 1 / height)
    bpy.context.view_layer.update()

    # Export the armature and its meshes only.
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = armature
    out = args['out']
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_nla_strips_merged_animation_name='',
        export_optimize_animation_size=True,
        export_skins=True,
        export_image_format='AUTO',
    )
    tris = sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in meshes)
    print(f'wrote {out}: {tris} triangles, {team_faces} team faces, {len(args["props"])} props, height was '
          f'{height:.3f}, clips {list(args["clips"])}, missing {missing}')
    return out


if __name__ == '__main__':
    jobs = parse_cli() or globals().get('ARGS') or [unit_args(u) for u in UNITS]
    if isinstance(jobs, dict):
        jobs = [jobs]
    for job in jobs:
        build(job)

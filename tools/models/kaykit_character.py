"""Turn a KayKit character into an Odal unit model: one GLB with the character mesh,
a flat "Team" material where the owner's colour goes, the animation clips we use
renamed to Odal's task names, and the whole thing scaled to 1 unit tall.

KayKit packs (CC0, Kay Lousberg, www.kaylousberg.com) ship characters and animations
as separate GLBs that share the Rig_Medium skeleton, so clips can be copied across.

Each Adventurer is textured from a 1024x1024 palette: 8 columns x 4 rows of vertical
gradient cells, and every face's UVs sit inside one cell. That makes two things cheap:
    --paint COL,ROW=#top[:#bottom]   recolour a cell (e.g. the Rogue's green shirt to brown)
    --team-cell COL,ROW              give every face in that cell the Team material
Cells count from the top-left, so the Rogue's shirt is 0,1 and its scarf, collar and cape 1,1.
Survey a character's cells before choosing: see the UV-cell listing in docs/PLAN.md § M3.
    --drop MESH                      leave a mesh out (Rogue_Cape)
    --team MESH                      the whole mesh gets the Team material (the old way)

Run inside Blender, headless:

    blender -b -P tools/models/kaykit_character.py -- <character.glb> <out.glb> \
        --anim <animations.glb> [--anim ...] --clip idle=Idle_A --clip walk=Walking_A ... \
        [--drop Rogue_Cape] [--paint 0,1=#9a7550:#5f4630] [--team-cell 1,1] \
        [--team Rogue_Cape] [--team-color 0.8,0.2,0.18]

or through the Blender MCP by setting ARGS before exec()-ing this file.
"""

import math
import os
import sys

import bpy
import numpy as np

PALETTE_COLS, PALETTE_ROWS = 8, 4

DEFAULT_ARGS = {
    'character': r'C:\Dev\KayKit\KayKit_Adventurers_2.0\Characters\gltf\Rogue.glb',
    'out': r'C:\Dev\odal\packages\client\public\models\worker.glb',
    'anims': [
        r'C:\Dev\KayKit\KayKit_Character_Animations_1.1\Animations\gltf\Rig_Medium\Rig_Medium_General.glb',
        r'C:\Dev\KayKit\KayKit_Character_Animations_1.1\Animations\gltf\Rig_Medium\Rig_Medium_MovementBasic.glb',
        r'C:\Dev\KayKit\KayKit_Character_Animations_1.1\Animations\gltf\Rig_Medium\Rig_Medium_Tools.glb',
        r'C:\Dev\KayKit\KayKit_Character_Animations_1.1\Animations\gltf\Rig_Medium\Rig_Medium_CombatMelee.glb',
    ],
    # Odal clip name -> KayKit action name. The renderer picks by task (see render/scene.ts).
    'clips': {
        'idle': 'Idle_A',
        'walk': 'Walking_A',
        'chop': 'Chopping',
        'mine': 'Pickaxing',
        'build': 'Hammering',
        'attack': 'Melee_Unarmed_Attack_Punch_A',
        'hit': 'Hit_A',
        'death': 'Death_A',
    },
    'drop': ['Rogue_Cape'],
    'paint': {(0, 1): ('#9a7550', '#5f4630')},  # shirt and sleeves: undyed wool instead of green
    'team_cells': [(1, 1)],  # scarf, collar and cuffs carry the owner's colour
    'team': [],
    'team_color': (0.8, 0.2, 0.18),
}


def parse_cell(text):
    c, r = (int(x) for x in text.split(','))
    return (c, r)


def parse_hex(text):
    text = text.lstrip('#')
    return tuple(int(text[i:i + 2], 16) / 255 for i in (0, 2, 4))


def parse_cli():
    if '--' not in sys.argv:
        return None
    argv = sys.argv[sys.argv.index('--') + 1:]
    a = dict(DEFAULT_ARGS)
    a['anims'] = []
    a['clips'] = {}
    a['drop'] = []
    a['paint'] = {}
    a['team_cells'] = []
    a['team'] = []
    pos = []
    i = 0
    while i < len(argv):
        t = argv[i]
        if t == '--anim':
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
        else:
            pos.append(t); i += 1
    if len(pos) >= 2:
        a['character'], a['out'] = pos[0], pos[1]
    if not a['clips']:
        a['clips'] = DEFAULT_ARGS['clips']
    # A character named on the command line gets exactly the options given, no Rogue defaults.
    if len(pos) < 2:
        for k in ('drop', 'paint', 'team_cells', 'team'):
            if not a[k]:
                a[k] = DEFAULT_ARGS[k]
    return a


def matches(name, patterns):
    return name in patterns or any(name.endswith(p) for p in patterns)


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
    armature.name = 'worker'

    # Bring in the clips: import each animation file, keep its actions, drop its mannequin.
    wanted = set(args['clips'].values())
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

    # Stash each wanted action as an NLA track named after Odal's clip name; the exporter
    # (NLA_TRACKS mode) turns every track into one glTF animation with that name.
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = None
    for track in list(armature.animation_data.nla_tracks):
        armature.animation_data.nla_tracks.remove(track)
    missing = []
    for ours, theirs in args['clips'].items():
        action = find_action(theirs)
        if action is None:
            missing.append(theirs)
            continue
        action.name = ours
        track = armature.animation_data.nla_tracks.new()
        track.name = ours
        track.strips.new(ours, int(action.frame_range[0]), action)
        track.mute = False
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

    # Normalise height to 1 unit (feet stay at 0) by scaling the armature object.
    # Measure the bind pose straight from the vertex data (mesh objects sit under the armature at scale 1).
    zs = []
    for m in meshes:
        mw = m.matrix_world
        zs.extend((mw @ v.co).z for v in m.data.vertices)
    height = max(zs) - min(zs)
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
    print(f'wrote {out}: {tris} triangles, {team_faces} team faces, height was {height:.3f}, '
          f'clips {list(args["clips"])}, missing {missing}')
    return out


if __name__ == '__main__':
    build(parse_cli() or globals().get('ARGS') or DEFAULT_ARGS)

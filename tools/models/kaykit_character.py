"""Turn a KayKit character into an Odal unit model: one GLB with the character mesh,
a flat "Team" material on the chosen meshes (the cape), the animation clips we use
renamed to Odal's task names, and the whole thing scaled to 1 unit tall.

KayKit packs (CC0, Kay Lousberg, www.kaylousberg.com) ship characters and animations
as separate GLBs that share the Rig_Medium skeleton, so clips can be copied across.

Run inside Blender, headless:

    blender -b -P tools/models/kaykit_character.py -- <character.glb> <out.glb> \
        --anim <animations.glb> [--anim ...] --clip idle=Idle_A --clip walk=Walking_A ... \
        [--team Rogue_Cape] [--team-color 0.8,0.2,0.18]

or through the Blender MCP by setting ARGS before exec()-ing this file.
"""

import math
import os
import sys

import bpy

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
    'team': ['Rogue_Cape'],
    'team_color': (0.8, 0.2, 0.18),
}


def parse_cli():
    if '--' not in sys.argv:
        return None
    argv = sys.argv[sys.argv.index('--') + 1:]
    a = dict(DEFAULT_ARGS)
    a['anims'] = []
    a['clips'] = {}
    a['team'] = []
    pos = []
    i = 0
    while i < len(argv):
        t = argv[i]
        if t == '--anim':
            a['anims'].append(argv[i + 1]); i += 2
        elif t == '--clip':
            k, v = argv[i + 1].split('=', 1); a['clips'][k] = v; i += 2
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
    if not a['team']:
        a['team'] = DEFAULT_ARGS['team']
    return a


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
    meshes = [o for o in objs if o.type == 'MESH']
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

    # Team colour: a flat material on the chosen meshes.
    team = bpy.data.materials.new('Team')
    team.use_nodes = True
    bsdf = team.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*args['team_color'], 1)
    bsdf.inputs['Roughness'].default_value = 1.0
    for m in meshes:
        if m.name in args['team'] or any(m.name.endswith(t) for t in args['team']):
            m.data.materials.clear()
            m.data.materials.append(team)

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
    print(f'wrote {out}: {tris} triangles, height was {height:.3f}, clips {list(args["clips"])}, missing {missing}')
    return out


if __name__ == '__main__':
    build(parse_cli() or globals().get('ARGS') or DEFAULT_ARGS)

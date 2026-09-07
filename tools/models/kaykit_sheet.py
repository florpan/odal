"""Contact sheets of the KayKit Medieval Hexagon pack: every glTF of a folder laid out in a grid with
its file name underneath, rendered to one PNG per group and saved as a .blend to walk around in.

    blender -b -P tools/models/kaykit_sheet.py                # every group in GROUPS
    blender -b -P tools/models/kaykit_sheet.py -- tiles props # only these groups

Output: C:\\Dev\\KayKit\\sheets\\<group>.png and <group>.blend (outside the repo; the packs are not in git).
Open a .blend in Blender to orbit the whole set, or just flip through the PNGs.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kaykit_prop as kp  # noqa: E402

HEX = kp.HEX
OUT = r'C:\Dev\KayKit\sheets'

# group name -> folders (relative to the pack's gltf dir) whose .gltf files go on one sheet
GROUPS = {
    'tiles': ['tiles/base', 'tiles/coast', 'tiles/coast/waterless', 'tiles/rivers', 'tiles/rivers/waterless',
              'tiles/roads'],
    'nature': ['decoration/nature'],
    'props': ['decoration/props'],
    'buildings': ['buildings/red', 'buildings/neutral'],
    'units': ['units/red'],
}
COLS = 8
SPACING = 3.2  # world units between cells (pack tiles are 2 wide)


def files_of(group):
    out = []
    for folder in GROUPS[group]:
        d = os.path.join(HEX, *folder.split('/'))
        for name in sorted(os.listdir(d)):
            if name.lower().endswith('.gltf'):
                out.append((folder + '/' + name[:-5], os.path.join(d, name)))
    return out


def import_one(path, cell):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    root = bpy.data.objects.new('cell', None)
    bpy.context.scene.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
    # Centre the footprint in the cell, base on the ground.
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    if pts:
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        centre = (lo + hi) / 2
        root.location = Vector((cell.x - centre.x, cell.y - centre.y, -lo.z))
        # Big things (trees, castles) shrink to fit the cell; small props are left alone.
        size = max(hi.x - lo.x, hi.y - lo.y, (hi.z - lo.z) * 0.6)
        if size > SPACING * 0.85:
            f = SPACING * 0.85 / size
            root.scale = (f, f, f)
            root.location = Vector((cell.x - centre.x * f, cell.y - centre.y * f, -lo.z * f))
    return root


def label(text, cell):
    curve = bpy.data.curves.new('label', type='FONT')
    curve.body = text.split('/')[-1]
    curve.size = 0.28
    curve.align_x = 'CENTER'
    obj = bpy.data.objects.new('label', curve)
    obj.location = (cell.x, cell.y - SPACING * 0.46, 0.02)
    obj.rotation_euler = (0, 0, 0)
    mat = bpy.data.materials.new('label')
    mat.diffuse_color = (0.02, 0.02, 0.02, 1)
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def sheet(group):
    kp.reset_scene()
    for coll in (bpy.data.curves, bpy.data.materials, bpy.data.images):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)
    files = files_of(group)
    rows = math.ceil(len(files) / COLS)
    for i, (name, path) in enumerate(files):
        cell = Vector(((i % COLS) * SPACING, -(i // COLS) * SPACING, 0))
        try:
            import_one(path, cell)
        except Exception as e:  # noqa: BLE001
            print(f'skip {name}: {e}')
        label(name, cell)

    # A light ground so the labels read, an ortho camera looking down at a slant, workbench render.
    w = COLS * SPACING
    h = rows * SPACING
    bpy.ops.mesh.primitive_plane_add(size=1, location=(w / 2 - SPACING / 2, -h / 2 + SPACING / 2, -0.01))
    ground = bpy.context.active_object
    ground.scale = (w + 2, h + 2, 1)
    gm = bpy.data.materials.new('ground')
    gm.diffuse_color = (0.82, 0.8, 0.74, 1)
    ground.data.materials.append(gm)

    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = max(w, h * 1.15) + 1
    cam = bpy.data.objects.new('cam', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    tilt = math.radians(35)
    cam.location = (w / 2 - SPACING / 2, -h / 2 + SPACING / 2 - 60 * math.sin(tilt), 60 * math.cos(tilt))
    cam.rotation_euler = (tilt, 0, 0)
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.display.shading.show_shadows = True
    aspect = (w + 2) / (h * 1.15 + 2)
    scene.render.resolution_x = 4096 if aspect >= 1 else max(1024, int(4096 * aspect))
    scene.render.resolution_y = 4096 if aspect < 1 else max(1024, int(4096 / aspect))
    scene.view_settings.view_transform = 'Standard'
    os.makedirs(OUT, exist_ok=True)
    scene.render.filepath = os.path.join(OUT, group + '.png')
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, group + '.blend'))
    print(f'sheet {group}: {len(files)} assets -> {scene.render.filepath}')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for g in argv or list(GROUPS):
        sheet(g)

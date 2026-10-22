"""Builds a dark-iron heater shield to match Knight_sword.glb.

Hammered iron face (textures baked from procedural noise), raised steel rim,
a cross-shaped ridge with flared ends like the sword's crossguard, a center boss and rivets.
The shield faces glTF +Z (forward), +Y is up, and the origin is where the forearm goes.

Run with:  blender --background --factory-startup --python tools/make_shield.py -- <output.glb>
"""
import math
import os
import sys
import tempfile

import bmesh
import bpy
from mathutils import Vector

OUT = sys.argv[sys.argv.index("--") + 1]

W = 0.56          # width (m)
TOP = 0.33        # top edge height above the center
SHOULDER = 0.05   # where the straight sides start curving in to the point
BOTTOM = -0.40    # the point at the bottom
CURVE = 0.07      # how far the sides bend back (the shield bulges forward)
THICK = 0.012
TEX = 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def bend(x):
    """Blender +Y is the back of the shield. The edges curve backwards."""
    return CURVE * (x / (W / 2)) ** 2


def outline(n=96):
    """Points around the heater shape (x, z), clockwise from top-left."""
    pts = []
    hw = W / 2
    # top edge: a gentle upward arch
    for i in range(24):
        t = i / 23
        x = -hw + t * W
        pts.append((x, TOP - 0.03 + 0.03 * math.sin(math.pi * t)))
    # right side: straight, then a curve down to the point
    for i in range(1, 8):
        pts.append((hw, TOP - 0.03 - (TOP - 0.03 - SHOULDER) * i / 7))
    for i in range(1, 25):
        t = i / 24
        p0, p1, p2 = Vector((hw, SHOULDER)), Vector((hw, -0.22)), Vector((0, BOTTOM))
        p = (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2
        pts.append((p.x, p.y))
    # left side: mirror of the right side, going back up
    right = pts[24:-1]
    for x, z in reversed(right):
        pts.append((-x, z))
    return pts


def mesh_object(name, verts, faces, uvs=None, material=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    if uvs:
        layer = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li, vi in zip(poly.loop_indices, poly.vertices):
                layer.data[li].uv = uvs[vi]
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    if material:
        me.materials.append(material)
    return obj


# ---------- Materials ----------
def principled(name, color, metallic, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


steel = principled("ShieldSteel", (0.11, 0.105, 0.1), 0.9, 0.42)
iron = bpy.data.materials.new("ShieldIron")
iron.use_nodes = True


def build_iron_nodes(mat):
    """Procedural hammered, scratched dark iron (baked to images further down)."""
    nt = mat.node_tree
    n, links = nt.nodes, nt.links
    bsdf = n["Principled BSDF"]
    coord = n.new("ShaderNodeTexCoord")

    grime = n.new("ShaderNodeTexNoise")
    grime.inputs["Scale"].default_value = 6
    grime.inputs["Detail"].default_value = 8
    links.new(coord.outputs["UV"], grime.inputs["Vector"])

    dents = n.new("ShaderNodeTexVoronoi")
    dents.feature = "SMOOTH_F1"
    dents.inputs["Scale"].default_value = 28
    links.new(coord.outputs["UV"], dents.inputs["Vector"])

    scratch_map = n.new("ShaderNodeMapping")
    scratch_map.inputs["Scale"].default_value = (1, 40, 1)
    scratch_map.inputs["Rotation"].default_value = (0, 0, 0.5)
    links.new(coord.outputs["UV"], scratch_map.inputs["Vector"])
    scratches = n.new("ShaderNodeTexNoise")
    scratches.inputs["Scale"].default_value = 30
    scratches.inputs["Detail"].default_value = 2
    links.new(scratch_map.outputs["Vector"], scratches.inputs["Vector"])

    color = n.new("ShaderNodeValToRGB")
    color.color_ramp.elements[0].position = 0.35
    color.color_ramp.elements[0].color = (0.025, 0.024, 0.023, 1)
    color.color_ramp.elements[1].position = 0.75
    color.color_ramp.elements[1].color = (0.09, 0.085, 0.08, 1)
    links.new(grime.outputs["Fac"], color.inputs["Fac"])

    scratch_ramp = n.new("ShaderNodeValToRGB")
    scratch_ramp.color_ramp.elements[0].position = 0.62
    scratch_ramp.color_ramp.elements[1].position = 0.7
    links.new(scratches.outputs["Fac"], scratch_ramp.inputs["Fac"])

    mix = n.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["B"].default_value = (0.2, 0.19, 0.18, 1)  # bright worn metal in scratches
    links.new(scratch_ramp.outputs["Color"], mix.inputs["Factor"])
    links.new(color.outputs["Color"], mix.inputs["A"])
    links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])

    rough = n.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value = 0.45
    rough.inputs["To Max"].default_value = 0.8
    links.new(grime.outputs["Fac"], rough.inputs["Value"])
    links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = 0.75

    bump = n.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.02
    links.new(dents.outputs["Distance"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


build_iron_nodes(iron)

# ---------- The plate (front face, back face and edge) ----------
ring0 = outline()
RINGS = 10
verts, faces, uvs = [], [], []
zmin, zmax = BOTTOM, TOP
for k in range(RINGS):
    s = 1 - k / RINGS
    for x, z in ring0:
        x2, z2 = x * s, z * s + (1 - s) * 0.05
        verts.append((x2, bend(x2), z2))
        uvs.append(((x2 + W / 2) / W, (z2 - zmin) / (zmax - zmin)))
center = len(verts)
verts.append((0, 0, 0.05))
uvs.append((0.5, (0.05 - zmin) / (zmax - zmin)))
N = len(ring0)
for k in range(RINGS - 1):
    for i in range(N):
        a, b = k * N + i, k * N + (i + 1) % N
        faces.append((a, b, b + N, a + N))
for i in range(N):
    faces.append(((RINGS - 1) * N + i, (RINGS - 1) * N + (i + 1) % N, center))
# back face: same points pushed back, faces reversed
front_count = len(verts)
verts += [(x, y + THICK, z) for x, y, z in verts]
uvs += uvs
faces += [tuple(reversed([v + front_count for v in f])) for f in faces[:]]
for i in range(N):  # edge
    a, b = i, (i + 1) % N
    faces.append((b, a, a + front_count, b + front_count))
plate = mesh_object("ShieldPlate", verts, faces, uvs, iron)


# ---------- Rim, cross ridge, boss and rivets (steel) ----------
def tube(name, points, radius, closed=False):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(points) - 1)
    for p, co in zip(sp.points, points):
        p.co = (*co, 1)
    sp.use_cyclic_u = closed
    obj = bpy.data.objects.new(name, cu)
    scene.collection.objects.link(obj)
    obj.data.materials.append(steel)
    return obj


rim_pts = [(x * 0.985, bend(x) - 0.004, z * 0.985 + 0.0007) for x, z in ring0]
tube("Rim", rim_pts, 0.014, closed=True)

ridge = [(0, -0.006, z) for z in [TOP - 0.05 + (BOTTOM + 0.08 - TOP + 0.05) * i / 30 for i in range(31)]]
tube("RidgeV", ridge, 0.015)
bar_z = 0.14
bar = [(x, bend(x) - 0.006, bar_z) for x in [-W / 2 + 0.06 + (W - 0.12) * i / 30 for i in range(31)]]
tube("RidgeH", bar, 0.015)


def primitive(kind, name, loc, scale, rot=(0, 0, 0), **kw):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    if kind == "sphere":
        bmesh.ops.create_uvsphere(bm, u_segments=kw.get("seg", 12), v_segments=kw.get("rings", 8), radius=1)
    elif kind == "cone":
        bmesh.ops.create_cone(bm, cap_ends=True, segments=kw.get("seg", 4), radius1=1, radius2=0, depth=2)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = kind == "sphere"
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    obj.location, obj.scale, obj.rotation_euler = loc, scale, rot
    me.materials.append(steel)
    return obj


# Center boss: a flattened octagonal dome where the cross meets.
primitive("sphere", "Boss", (0, -0.01, bar_z), (0.065, 0.035, 0.065), seg=8, rings=6)
# Flared spikes at the ends of the cross, echoing the sword's crossguard.
for name, loc, rot in [
    ("FlareL", (-W / 2 + 0.05, bend(-W / 2 + 0.05) - 0.006, bar_z), (0, math.pi / 2, 0)),
    ("FlareR", (W / 2 - 0.05, bend(W / 2 - 0.05) - 0.006, bar_z), (0, -math.pi / 2, 0)),
    ("FlareT", (0, -0.006, TOP - 0.045), (0, 0, 0)),
    ("FlareB", (0, -0.006, BOTTOM + 0.07), (math.pi, 0, 0)),
]:
    primitive("cone", name, loc, (0.032, 0.016, 0.05), rot, seg=4)
# Rivets around the rim.
for i in range(0, len(ring0), 6):
    x, z = ring0[i]
    x, z = x * 0.92, z * 0.92 + 0.004
    primitive("sphere", f"Rivet{i}", (x, bend(x) - 0.003, z), (0.009, 0.006, 0.009), seg=8, rings=5)

# ---------- Bake the procedural iron into real image textures ----------
scene.render.engine = "CYCLES"
scene.cycles.samples = 4
scene.cycles.device = "CPU"
tmp = tempfile.mkdtemp()


def bake(kind, colorspace):
    img = bpy.data.images.new(f"shield_{kind.lower()}", TEX, TEX)
    img.colorspace_settings.name = colorspace
    node = iron.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    iron.node_tree.nodes.active = node
    bpy.context.view_layer.objects.active = plate
    for o in scene.objects:
        o.select_set(o == plate)
    if kind == "DIFFUSE":
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=8)
    else:
        bpy.ops.object.bake(type=kind, margin=8)
    path = os.path.join(tmp, img.name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    iron.node_tree.nodes.remove(node)
    return img


color_img = bake("DIFFUSE", "sRGB")
rough_img = bake("ROUGHNESS", "Non-Color")
normal_img = bake("NORMAL", "Non-Color")

# Replace the procedural nodes with the baked images (what glTF understands).
nt = iron.node_tree
for node in list(nt.nodes):
    if node.type not in {"BSDF_PRINCIPLED", "OUTPUT_MATERIAL"}:
        nt.nodes.remove(node)
bsdf = nt.nodes["Principled BSDF"]
tc = nt.nodes.new("ShaderNodeTexImage"); tc.image = color_img
tr = nt.nodes.new("ShaderNodeTexImage"); tr.image = rough_img
tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = normal_img
nm = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(tc.outputs["Color"], bsdf.inputs["Base Color"])
nt.links.new(tr.outputs["Color"], bsdf.inputs["Roughness"])
nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
bsdf.inputs["Metallic"].default_value = 0.75

# Curves -> meshes so they export.
for obj in [o for o in scene.objects if o.type == "CURVE"]:
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    new = bpy.data.objects.new(obj.name, me)
    new.matrix_world = obj.matrix_world
    scene.collection.objects.link(new)
    bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True)
print("WROTE", OUT, os.path.getsize(OUT) // 1024, "KB")

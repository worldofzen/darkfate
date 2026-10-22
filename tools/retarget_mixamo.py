"""Copies Mixamo pack animations (made for "Y Bot") onto the Knight's own skeleton.

The Knight uses Unreal-style bone names (pelvis, spine_01, upperarm_l, ...), Mixamo uses
its own (Hips, Spine, LeftArm, ...). For every frame we measure how each Mixamo bone
has turned compared to its resting pose, and turn the matching Knight bone the same way.

Run with:
  blender --background --factory-startup --python tools/retarget_mixamo.py -- <pack folder> <knight.glb> <output.glb> [--report]
"""
import json
import os
import re
import sys

import bpy
from mathutils import Matrix, Quaternion

args = sys.argv[sys.argv.index("--") + 1:]
PACK, KNIGHT, OUT = args[0], args[1], args[2]
REPORT_ONLY = "--report" in args

# Mixamo bone -> Knight bone, and for each a "next bone" used to tell which way it points.
# (mixamo, knight, mixamo aim child, knight aim child)
BONES = [
    ("Hips", "pelvis", "Spine", "spine_01"),
    ("Spine", "spine_01", "Spine1", "spine_02"),
    ("Spine1", "spine_02", "Spine2", "spine_03"),
    ("Spine2", "spine_03", "Neck", "neck_01"),
    ("Neck", "neck_01", "Head", "head"),
    ("Head", "head", None, None),
]
for side, s in (("Left", "l"), ("Right", "r")):
    BONES += [
        (f"{side}Shoulder", f"clavicle_{s}", f"{side}Arm", f"upperarm_{s}"),
        (f"{side}Arm", f"upperarm_{s}", f"{side}ForeArm", f"lowerarm_{s}"),
        (f"{side}ForeArm", f"lowerarm_{s}", f"{side}Hand", f"hand_{s}"),
        (f"{side}Hand", f"hand_{s}", f"{side}HandMiddle1", f"middle_01_{s}"),
        (f"{side}UpLeg", f"thigh_{s}", f"{side}Leg", f"calf_{s}"),
        (f"{side}Leg", f"calf_{s}", f"{side}Foot", f"foot_{s}"),
        (f"{side}Foot", f"foot_{s}", f"{side}ToeBase", f"ball_{s}"),
        (f"{side}ToeBase", f"ball_{s}", None, None),
    ]
    for finger, f in (("Thumb", "thumb"), ("Index", "index"), ("Middle", "middle"), ("Ring", "ring"), ("Pinky", "pinky")):
        BONES += [
            (f"{side}Hand{finger}1", f"{f}_01_{s}", f"{side}Hand{finger}2", f"{f}_02_{s}"),
            (f"{side}Hand{finger}2", f"{f}_02_{s}", f"{side}Hand{finger}3", f"{f}_03_{s}"),
            (f"{side}Hand{finger}3", f"{f}_03_{s}", None, None),
        ]


# Clearer names for clips whose file names don't say which way they go, read from
# rename.json in the pack folder (worked out by running this script with --report).
RENAME_FILE = os.path.join(PACK, "rename.json")
RENAME = json.load(open(RENAME_FILE)) if os.path.exists(RENAME_FILE) else {}

# Clips to ALSO export mirrored left-to-right, read from mirror.json in the pack folder,
# e.g. {"drinking": "drinking_left"} adds a copy of "drinking" done with the other hand.
MIRROR_FILE = os.path.join(PACK, "mirror.json")
MIRROR = json.load(open(MIRROR_FILE)) if os.path.exists(MIRROR_FILE) else {}


def short_name(file_name):
    """'sword and shield idle (2).fbx' -> 'idle_2'"""
    name = os.path.splitext(file_name)[0].lower()
    for prefix in ("sword and shield ", "great sword ", "two handed sword "):
        name = name.replace(prefix, "")
    name = re.sub(r"\s*\((\d+)\)", r"_\1", name)
    name = re.sub(r"\s+", "_", name.strip())
    return RENAME.get(name, name)


def remove(objs):
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)


def import_new(fn):
    before = set(bpy.data.objects)
    fn()
    return [o for o in bpy.data.objects if o not in before]


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

# --- The Knight (target) ---
new = import_new(lambda: bpy.ops.import_scene.gltf(filepath=KNIGHT))
remove([o for o in new if o.type == "MESH" and len(o.data.polygons) < 500])  # bone-drawing helper shape
knight = next(o for o in bpy.data.objects if o.type == "ARMATURE")

# --- Y Bot (source): we only need its skeleton ---
new = import_new(lambda: bpy.ops.import_scene.fbx(filepath=os.path.join(PACK, "Y Bot.fbx")))
ybot = next(o for o in new if o.type == "ARMATURE")
remove([o for o in new if o.type == "MESH"])
prefix = ybot.data.bones[0].name.split(":")[0] + ":" if ":" in ybot.data.bones[0].name else ""

pairs = [(prefix + m, k, prefix + ma if ma else None, ka) for m, k, ma, ka in BONES
         if prefix + m in ybot.data.bones and k in knight.data.bones]
src_of = {k: m for m, k, _, _ in pairs}


def world_head(obj, name):
    return obj.matrix_world @ obj.data.bones[name].head_local


def rest_rot(obj, name):
    return (obj.matrix_world @ obj.data.bones[name].matrix_local).to_quaternion()


# How much to turn each Knight bone so its rest pose lines up with Y Bot's rest pose
# (e.g. the Knight's arms hang lower than Y Bot's T-pose).
align = {}
for m, k, ma, ka in pairs:
    if ma and ka and ma in ybot.data.bones and ka in knight.data.bones:
        d_src = (world_head(ybot, ma) - world_head(ybot, m)).normalized()
        d_tgt = (world_head(knight, ka) - world_head(knight, k)).normalized()
        align[k] = d_tgt.rotation_difference(d_src)
for m, k, ma, ka in pairs:  # bones without an aim child copy their parent's alignment
    if k not in align:
        parent = knight.data.bones[k].parent
        while parent and parent.name not in align:
            parent = parent.parent
        align[k] = align[parent.name].copy() if parent else Matrix().to_quaternion()

src_rest_inv = {m: rest_rot(ybot, m).inverted() for m, _, _, _ in pairs}
tgt_rest = {k: rest_rot(knight, k) for _, k, _, _ in pairs}
knight_world_inv = knight.matrix_world.to_quaternion().inverted()

hips = prefix + "Hips"
pelvis = knight.data.bones["pelvis"]
assert pelvis.parent is None, "expected pelvis to be a root bone"
hips_rest = world_head(ybot, hips)
pelvis_rest = world_head(knight, "pelvis")
height_ratio = pelvis_rest.z / hips_rest.z

order = []  # parents before children
def visit(bone):
    order.append(bone)
    for c in bone.children:
        visit(c)
for b in knight.data.bones:
    if b.parent is None:
        visit(b)


def other_side(name):
    """'mixamorig:LeftHand' -> 'mixamorig:RightHand' (and back)."""
    if "Left" in name:
        return name.replace("Left", "Right")
    return name.replace("Right", "Left")


def mirrored(q):
    """A world rotation reflected left-to-right (Y Bot's sideways axis is world X)."""
    return Quaternion((q.w, q.x, -q.y, -q.z))


def sample(action, mirror=False):
    """Returns per-frame rotations (armature space, as basis quaternions) and pelvis locations.
    With `mirror`, each bone copies the motion of its twin on the other side, reflected."""
    ybot.animation_data_create()
    ybot.animation_data.action = action
    if len(action.slots):
        ybot.animation_data.action_slot = action.slots[0]
    start, end = (int(round(v)) for v in action.frame_range)
    rots = {k: [] for _, k, _, _ in pairs}
    locs = []
    travel = None
    for f in range(start, end + 1):
        scene.frame_set(f)
        desired = {}
        for bone in order:
            k = bone.name
            if k in src_of:
                m = other_side(src_of[k]) if mirror else src_of[k]
                src_now = (ybot.matrix_world @ ybot.pose.bones[m].matrix).to_quaternion()
                turn = src_now @ src_rest_inv[m]  # how far this bone has turned from rest
                world = (mirrored(turn) if mirror else turn) @ align[k] @ tgt_rest[k]
                desired[k] = knight_world_inv @ world
            elif bone.parent:
                rel = (bone.parent.matrix_local.inverted() @ bone.matrix_local).to_quaternion()
                desired[k] = desired[bone.parent.name] @ rel
            else:
                desired[k] = bone.matrix_local.to_quaternion()
        for _, k, _, _ in pairs:
            bone = knight.data.bones[k]
            if bone.parent:
                rel = (bone.parent.matrix_local.inverted() @ bone.matrix_local).to_quaternion()
                basis = (desired[bone.parent.name] @ rel).inverted() @ desired[k]
            else:
                basis = bone.matrix_local.to_quaternion().inverted() @ desired[k]
            if rots[k] and rots[k][-1].dot(basis) < 0:
                basis.negate()  # keep the rotation from flipping between frames
            rots[k].append(basis)

        hips_now = ybot.matrix_world @ ybot.pose.bones[hips].matrix.translation
        moved = hips_now - hips_rest
        if mirror:
            moved.x = -moved.x
        head = pelvis_rest + moved * height_ratio
        head_arm = knight.matrix_world.inverted() @ head
        locs.append((pelvis.matrix_local.inverted() @ head_arm))
        if f == start:
            first = hips_now.copy()
        travel = hips_now - first
    return rots, locs, travel, end - start + 1


def make_action(name, rots, locs, frames):
    act = bpy.data.actions.new(name)
    slot = act.slots.new(id_type="OBJECT", name=knight.name)
    strip = act.layers.new("Layer").strips.new(type="KEYFRAME")
    bag = strip.channelbag(slot, ensure=True)

    def curve(path, index, values):
        fc = bag.fcurves.new(path, index=index)
        fc.keyframe_points.add(frames)
        fc.keyframe_points.foreach_set("co", [v for f in range(frames) for v in (f, values[f])])
        fc.keyframe_points.foreach_set("interpolation", [1] * frames)  # linear
        fc.update()

    for k, quats in rots.items():
        for i in range(4):
            curve(f'pose.bones["{k}"].rotation_quaternion', i, [q[i] for q in quats])
    for i in range(3):
        curve('pose.bones["pelvis"].location', i, [v[i] for v in locs])
    return act, slot


files = sorted(f for f in os.listdir(PACK) if f.lower().endswith(".fbx") and f != "Y Bot.fbx")
knight.animation_data_create()
for file_name in files:
    name = short_name(file_name)
    new = import_new(lambda: bpy.ops.import_scene.fbx(filepath=os.path.join(PACK, file_name)))
    src_arm = next(o for o in new if o.type == "ARMATURE")
    action = src_arm.animation_data.action
    remove(new)
    versions = [(name, False)] + ([(MIRROR[name], True)] if name in MIRROR else [])
    for clip_name, mirror in versions:
        rots, locs, travel, frames = sample(action, mirror)
        # Y Bot faces -Y in Blender, so "forward" travel is -Y.
        print(f"CLIP {clip_name:28s} frames={frames:4d} forward={-travel.y:6.2f}m sideways={travel.x:6.2f}m")
        if REPORT_ONLY:
            continue
        act, slot = make_action(clip_name, rots, locs, frames)
        track = knight.animation_data.nla_tracks.new()
        track.name = clip_name
        s = track.strips.new(clip_name, 0, act)
        s.action_slot = slot

if not REPORT_ONLY:
    knight.animation_data.action = None
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
    )
    print("WROTE", OUT, os.path.getsize(OUT) // 1024, "KB")

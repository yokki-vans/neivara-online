"""Deterministic clean-room GLB generator for Neivara Online.

All silhouettes and surfaces are built from project-original parametric meshes.
The script intentionally does not import third-party meshes or game assets.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


SEED = 7012026
random.seed(SEED)


@dataclass(frozen=True)
class Race:
    id: str
    label: str
    height: float
    breadth: float
    leg: float
    head: float
    skin: tuple[float, float, float, float]
    hair: tuple[float, float, float, float]
    primary: tuple[float, float, float, float]
    accent: tuple[float, float, float, float]
    ear: float


RACES = (
    Race("human", "Human", 1.0, 1.0, 1.0, 1.0, (0.58, 0.34, 0.22, 1), (0.08, 0.045, 0.025, 1), (0.14, 0.22, 0.31, 1), (0.71, 0.45, 0.17, 1), 0.14),
    Race("light_elf", "Light elf", 1.075, 0.86, 1.08, 0.95, (0.82, 0.70, 0.61, 1), (0.70, 0.73, 0.68, 1), (0.18, 0.43, 0.42, 1), (0.72, 0.66, 0.35, 1), 0.32),
    Race("dark_elf", "Dark elf", 1.045, 0.91, 1.06, 0.97, (0.23, 0.20, 0.35, 1), (0.76, 0.74, 0.82, 1), (0.20, 0.12, 0.32, 1), (0.36, 0.64, 0.72, 1), 0.38),
    Race("dwarf", "Dwarf", 0.76, 1.18, 0.72, 1.13, (0.66, 0.39, 0.23, 1), (0.38, 0.13, 0.045, 1), (0.22, 0.30, 0.20, 1), (0.76, 0.49, 0.16, 1), 0.13),
    Race("orc", "Orc", 1.12, 1.28, 1.04, 0.99, (0.22, 0.38, 0.19, 1), (0.055, 0.045, 0.035, 1), (0.34, 0.11, 0.075, 1), (0.43, 0.40, 0.29, 1), 0.16),
)
GENDERS = ("male", "female")
ARCHETYPES = ("warrior", "mage")
HUMANOID_ANIMATIONS = ("idle", "run", "attack", "cast", "hit", "death")
MONSTER_ANIMATIONS = ("idle", "run", "attack", "hit", "death")


def clean_scene() -> None:
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # Remove every data block, including fake-user animation actions. Keeping an
    # action from the previous export makes Blender attach unrelated clips to the
    # next GLB and silently bloats each subsequent model.
    for collection in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.materials, bpy.data.images, bpy.data.actions):
        for block in list(collection):
            collection.remove(block)


def color_material(name: str, rgba, metallic=0.0, roughness=0.62, texture: Path | None = None, emission=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    principled = nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = rgba
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    emission_color = principled.inputs.get("Emission Color") or principled.inputs.get("Emission")
    emission_strength = principled.inputs.get("Emission Strength")
    if emission_color is not None:
        emission_color.default_value = rgba
    if emission_strength is not None:
        emission_strength.default_value = emission
    if texture:
        image = bpy.data.images.load(str(texture), check_existing=True)
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.interpolation = "Linear"
        mat.node_tree.links.new(tex.outputs["Color"], principled.inputs["Base Color"])
    return mat


def write_weave_texture(path: Path, base, accent, motif: str) -> None:
    size = 128
    image = bpy.data.images.new(path.stem, width=size, height=size, alpha=True)
    pixels = []
    for y in range(size):
        for x in range(size):
            weave = 0.08 * (1 if (x // 3 + y // 2) % 2 else -1)
            if motif == "plate":
                mark = (x % 32 in (0, 1, 30, 31)) or (y % 32 in (0, 1, 30, 31))
            else:
                diamond = abs((x % 32) - 16) + abs((y % 32) - 16)
                mark = diamond in (10, 11) or (x + y) % 47 == 0
            source = accent if mark else base
            pixels.extend((max(0, min(1, source[0] + weave)), max(0, min(1, source[1] + weave)), max(0, min(1, source[2] + weave)), 1.0))
    image.pixels = pixels
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def mesh_object(name: str, vertices, faces, material=None, smooth=True):
    mesh = bpy.data.meshes.new(f"{name}_geometry")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if material:
        obj.data.materials.append(material)
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    uv = mesh.uv_layers.new(name="UVMap")
    bounds_x = [v[0] for v in vertices] or [0, 1]
    bounds_z = [v[2] for v in vertices] or [0, 1]
    dx = max(max(bounds_x) - min(bounds_x), 0.001)
    dz = max(max(bounds_z) - min(bounds_z), 0.001)
    for loop in mesh.loops:
        co = mesh.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((co.x - min(bounds_x)) / dx, (co.z - min(bounds_z)) / dz)
    return obj


def ring_form(name: str, rings, sides=12, material=None, phase=0.0, cap=True, detail=1):
    """Create a hand-shaped closed surface from elliptical profile rings."""
    verts = []
    for z, rx, ry, ox, oy in rings:
        for side in range(sides):
            angle = phase + math.tau * side / sides
            organic = 1 + 0.035 * math.sin(angle * 3 + z * 4.1)
            verts.append((ox + math.cos(angle) * rx * organic, oy + math.sin(angle) * ry * organic, z))
    faces = []
    for ring in range(len(rings) - 1):
        for side in range(sides):
            nxt = (side + 1) % sides
            a = ring * sides + side
            b = ring * sides + nxt
            c = (ring + 1) * sides + nxt
            d = (ring + 1) * sides + side
            faces.append((a, b, c, d))
    if cap:
        faces.append(tuple(range(sides - 1, -1, -1)))
        top = (len(rings) - 1) * sides
        faces.append(tuple(top + side for side in range(sides)))
    obj = mesh_object(name, verts, faces, material)
    if detail:
        subdivide_object(obj, detail)
    return obj


def oriented_segment(name: str, start, end, radius_start, radius_end, material, sides=10, bend=0.0, detail=1):
    start_v, end_v = Vector(start), Vector(end)
    direction = end_v - start_v
    length = direction.length
    direction.normalize()
    up = Vector((0, 0, 1))
    if abs(direction.dot(up)) > 0.92:
        up = Vector((0, 1, 0))
    axis_x = direction.cross(up).normalized()
    axis_y = direction.cross(axis_x).normalized()
    verts = []
    rings = 4
    for ring in range(rings):
        t = ring / (rings - 1)
        center = start_v.lerp(end_v, t) + axis_y * math.sin(t * math.pi) * bend
        radius = radius_start * (1 - t) + radius_end * t
        for side in range(sides):
            angle = math.tau * side / sides
            squash = 0.92 + 0.08 * math.cos(angle * 2)
            point = center + axis_x * math.cos(angle) * radius + axis_y * math.sin(angle) * radius * squash
            verts.append(tuple(point))
    faces = []
    for ring in range(rings - 1):
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((ring*sides+side, ring*sides+nxt, (ring+1)*sides+nxt, (ring+1)*sides+side))
    faces.extend((tuple(range(sides - 1, -1, -1)), tuple((rings - 1) * sides + side for side in range(sides))))
    obj = mesh_object(name, verts, faces, material)
    if detail:
        subdivide_object(obj, detail)
    return obj


def tapered_prism(name: str, points, depth: float, material, smooth=False, finish=True):
    """Extrude an authored front silhouette; useful for ears, plates, roofs and blades."""
    verts = [(x, -depth / 2, z) for x, z in points] + [(x, depth / 2, z) for x, z in points]
    count = len(points)
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for i in range(count):
        n = (i + 1) % count
        faces.append((i, n, count+n, count+i))
    obj = mesh_object(name, verts, faces, material, smooth=smooth)
    if finish:
        bevel_object(obj, max(0.004, min(0.028, abs(depth) * 0.16)), 2)
    return obj


def bevel_object(obj, width=0.025, segments=2):
    modifier = obj.modifiers.new("Hand-finished bevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def subdivide_object(obj, levels=1):
    """Apply deterministic Catmull-Clark refinement to authored control cages."""
    modifier = obj.modifiers.new("Sculpted surface refinement", "SUBSURF")
    modifier.subdivision_type = "CATMULL_CLARK"
    modifier.levels = levels
    modifier.render_levels = levels
    modifier.uv_smooth = "PRESERVE_BOUNDARIES"
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.select_set(False)


def decimate_object(obj, ratio=.65):
    """Collapse refined control cages to a web-friendly triangle budget."""
    modifier = obj.modifiers.new("Web topology reduction", "DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def bind_rigid(obj, armature, bone_name):
    group = obj.vertex_groups.new(name=bone_name)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    modifier = obj.modifiers.new("Neivara armature", "ARMATURE")
    modifier.object = armature
    # glTF's skin exporter expects the armature to be the mesh parent. Both
    # transforms are authored at identity, so this keeps the sculpt in place.
    obj.parent = armature


def create_armature(name: str, bones):
    data = bpy.data.armatures.new(f"{name}_skeleton")
    armature = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    created = {}
    for bone_name, head, tail, parent in bones:
        bone = data.edit_bones.new(bone_name)
        bone.head, bone.tail = head, tail
        bone.use_deform = True
        if parent:
            bone.parent = created[parent]
        created[bone_name] = bone
    bpy.ops.object.mode_set(mode="POSE")
    for pose in armature.pose.bones:
        pose.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.select_set(False)
    return armature


def key_rotation(armature, bone: str, frame: int, rotation=(0, 0, 0), location=None):
    pose = armature.pose.bones[bone]
    pose.rotation_euler = rotation
    pose.keyframe_insert(data_path="rotation_euler", frame=frame)
    if location is not None:
        pose.location = location
        pose.keyframe_insert(data_path="location", frame=frame)


def reset_pose(armature):
    for pose in armature.pose.bones:
        pose.rotation_euler = (0, 0, 0)
        pose.location = (0, 0, 0)


def make_action(armature, name, end_frame, keys):
    reset_pose(armature)
    action = bpy.data.actions.new(name)
    armature.animation_data_create()
    armature.animation_data.action = action
    keys(armature)
    action.frame_range = (0, end_frame)
    action.use_fake_user = True
    return action


def humanoid_animations(armature):
    def idle(a):
        for f, breath in ((0, 0), (28, -0.025), (56, 0)):
            key_rotation(a, "spine", f, (breath, 0, 0))
            key_rotation(a, "arm.L", f, (0.05 - breath, 0, 0.08))
            key_rotation(a, "arm.R", f, (0.05 - breath, 0, -0.08))
            key_rotation(a, "root", f, location=(0, 0, abs(breath) * 0.4))
    make_action(armature, "idle", 56, idle)

    def run(a):
        for f, swing in ((0, 0.72), (8, -0.72), (16, 0.72)):
            key_rotation(a, "thigh.L", f, (swing, 0, 0))
            key_rotation(a, "thigh.R", f, (-swing, 0, 0))
            key_rotation(a, "shin.L", f, (max(0, -swing) * 0.9, 0, 0))
            key_rotation(a, "shin.R", f, (max(0, swing) * 0.9, 0, 0))
            key_rotation(a, "arm.L", f, (-swing * 0.8, 0, 0.08))
            key_rotation(a, "arm.R", f, (swing * 0.8, 0, -0.08))
            key_rotation(a, "root", f, location=(0, 0, 0.05 if f == 8 else 0))
    make_action(armature, "run", 16, run)

    def attack(a):
        for f, shoulder, elbow, torso in ((0, 0.1, 0, 0), (9, -1.6, -0.7, -0.32), (15, 1.0, 0.25, 0.42), (26, 0.1, 0, 0)):
            key_rotation(a, "arm.R", f, (shoulder, 0.1, -0.2))
            key_rotation(a, "forearm.R", f, (elbow, 0, 0))
            key_rotation(a, "spine", f, (0, 0, torso))
    make_action(armature, "attack", 26, attack)

    def cast(a):
        for f, lift, spread in ((0, 0.1, 0.1), (18, -1.25, 0.58), (40, -1.05, 0.42), (52, 0.1, 0.1)):
            key_rotation(a, "arm.L", f, (lift, 0, spread))
            key_rotation(a, "arm.R", f, (lift, 0, -spread))
            key_rotation(a, "forearm.L", f, (-0.42 if f in (18, 40) else 0, 0, 0))
            key_rotation(a, "forearm.R", f, (-0.42 if f in (18, 40) else 0, 0, 0))
            key_rotation(a, "head", f, (-0.12 if f in (18, 40) else 0, 0, 0))
    make_action(armature, "cast", 52, cast)

    def hit(a):
        for f, lean in ((0, 0), (5, -0.28), (10, 0.16), (18, 0)):
            key_rotation(a, "spine", f, (lean, 0, 0))
            key_rotation(a, "head", f, (-lean * 0.5, 0, 0))
    make_action(armature, "hit", 18, hit)

    def death(a):
        for f, fall in ((0, 0), (18, 0.4), (36, 1.34), (52, 1.56)):
            key_rotation(a, "root", f, (fall, 0, -fall * 0.1), location=(0, 0.05 * fall, -0.24 * fall))
            key_rotation(a, "spine", f, (fall * 0.22, 0, 0))
    make_action(armature, "death", 52, death)
    armature.animation_data.action = bpy.data.actions.get("idle")


def humanoid_bones(race: Race):
    h = race.height
    hip = 0.93 * h
    shoulder = 1.68 * h
    breadth = race.breadth
    return (
        ("root", (0, 0, 0), (0, 0, 0.18*h), None),
        ("pelvis", (0, 0, hip*0.86), (0, 0, hip*1.04), "root"),
        ("spine", (0, 0, hip), (0, 0, shoulder), "pelvis"),
        ("neck", (0, 0, shoulder), (0, 0, 1.84*h), "spine"),
        ("head", (0, 0, 1.82*h), (0, 0, 2.14*h), "neck"),
        ("arm.L", (0.26*breadth, 0, shoulder), (0.65*breadth, 0, 1.35*h), "spine"),
        ("forearm.L", (0.65*breadth, 0, 1.35*h), (0.82*breadth, 0, 1.05*h), "arm.L"),
        ("hand.L", (0.82*breadth, 0, 1.05*h), (0.85*breadth, 0, 0.91*h), "forearm.L"),
        ("arm.R", (-0.26*breadth, 0, shoulder), (-0.65*breadth, 0, 1.35*h), "spine"),
        ("forearm.R", (-0.65*breadth, 0, 1.35*h), (-0.82*breadth, 0, 1.05*h), "arm.R"),
        ("hand.R", (-0.82*breadth, 0, 1.05*h), (-0.85*breadth, 0, 0.91*h), "forearm.R"),
        ("thigh.L", (0.18*breadth, 0, hip), (0.20*breadth, 0, 0.52*h), "pelvis"),
        ("shin.L", (0.20*breadth, 0, 0.52*h), (0.18*breadth, 0, 0.12*h), "thigh.L"),
        ("foot.L", (0.18*breadth, 0, 0.12*h), (0.18*breadth, -0.22*h, 0.04*h), "shin.L"),
        ("thigh.R", (-0.18*breadth, 0, hip), (-0.20*breadth, 0, 0.52*h), "pelvis"),
        ("shin.R", (-0.20*breadth, 0, 0.52*h), (-0.18*breadth, 0, 0.12*h), "thigh.R"),
        ("foot.R", (-0.18*breadth, 0, 0.12*h), (-0.18*breadth, -0.22*h, 0.04*h), "shin.R"),
    )


def make_humanoid(race: Race, gender: str, archetype: str, texture_dir: Path):
    clean_scene()
    h, b = race.height, race.breadth
    feminine = gender == "female"
    shoulder = b * (0.88 if feminine else 1.06)
    waist = b * (0.82 if feminine else 0.96)
    hip_width = b * (1.04 if feminine else 0.92)
    texture = texture_dir / f"{race.id}_{gender}_{archetype}.png"
    write_weave_texture(texture, race.primary, race.accent, "plate" if archetype == "warrior" else "weave")

    skin = color_material("Skin", race.skin, roughness=0.78)
    hair = color_material("Hair", race.hair, roughness=0.72)
    eye = color_material("Iris", (*race.accent[:3], 1), metallic=0.1, roughness=0.2)
    sclera = color_material("Eye white", (.78, .80, .75, 1), metallic=0.0, roughness=0.48)
    lip = color_material("Lips", tuple(max(0.03, channel * .54) for channel in race.skin[:3]) + (1,), roughness=.64)
    cloth = color_material("Outfit textile", race.primary, metallic=0.05, roughness=0.6, texture=texture)
    cloth_secondary = color_material("Outfit secondary", tuple(channel * .55 for channel in race.primary[:3]) + (1,), metallic=.04, roughness=.68)
    trim = color_material("Runic trim", race.accent, metallic=0.72 if archetype == "warrior" else 0.28, roughness=0.28)
    leather = color_material("Leather", (0.16, 0.075, 0.035, 1), metallic=0.0, roughness=0.82)
    steel = color_material("Forged alloy", (0.30, 0.34, 0.36, 1), metallic=0.86, roughness=0.24)

    armature = create_armature("Neivara humanoid rig", humanoid_bones(race))
    parts = []

    # A layered anatomical control cage gives the avatar a readable waist,
    # ribcage, pelvis and clavicle instead of a capsule-like torso.
    pelvis_z = .91*h
    pelvis = ring_form("Anatomical pelvis", [
        (.78*h, .20*hip_width, .145*b, 0, .008),
        (.86*h, .29*hip_width, .18*b, 0, .012),
        (.96*h, .31*hip_width, .18*b, 0, .008),
        (1.04*h, .24*waist, .15*b, 0, 0),
    ], 16, cloth_secondary, phase=.09)
    parts.append((pelvis, "pelvis"))
    chest_depth = .205*b if feminine else .185*b
    torso = ring_form("Sculpted torso", [
        (.94*h, .27*hip_width, .17*b, 0, .012),
        (1.05*h, .25*waist, .155*b, 0, 0),
        (1.18*h, .235*waist, .15*b, 0, -.006),
        (1.34*h, .31*shoulder, .175*b, 0, -.008),
        (1.49*h, .37*shoulder, chest_depth, 0, -.018 if feminine else 0),
        (1.62*h, .43*shoulder, .19*b, 0, 0),
        (1.70*h, .31*shoulder, .16*b, 0, 0),
        (1.75*h, .15*shoulder, .115*b, 0, 0),
    ], 18, cloth, phase=.10)
    parts.append((torso, "spine"))

    neck = ring_form("Neck", [
        (1.69*h, .105*b, .095*b, 0, 0), (1.75*h, .11*b, .10*b, 0, 0),
        (1.83*h, .092*b, .084*b, 0, 0), (1.89*h, .10*b, .09*b, 0, 0),
    ], 12, skin)
    parts.append((neck, "neck"))
    head = ring_form("Sculpted head and jaw", [
        (1.84*h, .105*b*race.head, .105*b, 0, -.018),
        (1.89*h, .165*b*race.head, .14*b, 0, -.025),
        (1.97*h, .215*b*race.head, .17*b, 0, -.030),
        (2.07*h, .245*b*race.head, .185*b, 0, -.025),
        (2.16*h, .235*b*race.head, .185*b, 0, -.010),
        (2.25*h, .215*b*race.head, .17*b, 0, .010),
        (2.32*h, .17*b*race.head, .14*b, 0, .015),
        (2.36*h, .09*b*race.head, .075*b, 0, .010),
    ], 18, skin, phase=.04)
    parts.append((head, "head"))

    # Face: sclera, irises, brows, a modeled bridge/nostril wedge and mouth.
    nose = tapered_prism("Nose and nostril plane", [
        (-.040*b, 2.13*h), (0, 2.20*h), (.040*b, 2.13*h),
        (.050*b, 2.015*h), (0, 1.985*h), (-.050*b, 2.015*h),
    ], .11*b, skin, True)
    nose.location.y = -.178*b
    parts.append((nose, "head"))
    mouth = tapered_prism("Mouth", [(-.075*b, 0), (0, .014*h), (.075*b, 0), (0, -.018*h)], .012*b, lip, True)
    mouth.location = (0, -.187*b, 1.955*h)
    parts.append((mouth, "head"))
    for side in (-1, 1):
        label = "L" if side > 0 else "R"
        eye_white = tapered_prism(f"Sclera {label}", [(-.070*b, 0), (0, .028*h), (.070*b, 0), (0, -.026*h)], .013*b, sclera, True)
        eye_white.location = (side*.095*b, -.191*b, 2.115*h)
        parts.append((eye_white, "head"))
        iris = tapered_prism(f"Iris {label}", [(-.020*b, 0), (0, .022*h), (.020*b, 0), (0, -.022*h)], .009*b, eye, True)
        iris.location = (side*.095*b, -.201*b, 2.115*h)
        parts.append((iris, "head"))
        brow = tapered_prism(f"Expressive brow {label}", [(-.078*b, -.008*h), (-.018*b, .018*h), (.075*b, .006*h), (.058*b, -.018*h), (-.055*b, -.020*h)], .018*b, hair, True)
        brow.location = (side*.095*b, -.194*b, 2.18*h)
        brow.rotation_euler[1] = side*.05
        parts.append((brow, "head"))
        ear_len = race.ear*b
        ear = tapered_prism(f"Sculpted ear {label}", [(0, -.075*h), (side*ear_len, .01*h), (side*.12*ear_len, .105*h), (side*.025*b, .035*h)], .065*b, skin, True)
        ear.location = (side*.205*b, .005*b, 2.105*h)
        parts.append((ear, "head"))

    # Hair is a crown plus overlapping bangs, temple locks and a back mass.
    long_hair = feminine or race.id in ("light_elf", "dark_elf")
    hair_length = .48*h if long_hair else .20*h
    hair_cap = ring_form("Layered hair crown", [
        (2.12*h, .248*b, .19*b, 0, .018), (2.24*h, .238*b, .18*b, 0, .025),
        (2.34*h, .185*b, .14*b, 0, .022), (2.39*h, .08*b, .065*b, 0, .012),
    ], 18, hair, phase=.13)
    parts.append((hair_cap, "head"))
    if race.id == "orc":
        for index in range(5):
            crest = tapered_prism(f"Orc mane blade {index}", [(-.045*b, 0), (0, (.22+.035*index)*h), (.05*b, 0), (0, -.07*h)], .085*b, hair, True)
            crest.location = (0, .03*b + index*.035*b, 2.27*h-index*.035*h)
            crest.rotation_euler[1] = -.12 + index*.06
            parts.append((crest, "head"))
    else:
        for index in range(5):
            bang = tapered_prism(f"Layered fringe {index}", [(-.045*b, 0), (0, -.13*h-(index%2)*.035*h), (.055*b, -.015*h), (.035*b, .07*h), (-.035*b, .07*h)], .035*b, hair, True)
            bang.location = ((index-2)*.075*b, -.185*b, 2.29*h-abs(index-2)*.012*h)
            parts.append((bang, "head"))
        for side in (-1, 1):
            lock = tapered_prism(f"Temple hair {'L' if side > 0 else 'R'}", [(0, 0), (side*.105*b, -.07*h), (side*.075*b, -hair_length), (side*.012*b, -hair_length*.82)], .075*b, hair, True)
            lock.location = (side*.175*b, -.005*b, 2.23*h)
            parts.append((lock, "head"))
        back_hair = tapered_prism("Back hair mass", [(-.18*b, .02*h), (-.22*b, -.22*h), (-.12*b, -hair_length), (0, -hair_length*.92), (.12*b, -hair_length), (.22*b, -.22*h), (.18*b, .02*h)], .11*b, hair, True)
        back_hair.location = (0, .15*b, 2.21*h)
        parts.append((back_hair, "head"))
    if race.id == "dwarf":
        beard_end = 1.57*h if gender == "male" else 1.73*h
        if gender == "male":
            beard = tapered_prism("Braided beard mantle", [(-.16*b, .03*h), (-.19*b, -.14*h), (-.08*b, -.40*h), (0, -.52*h), (.08*b, -.40*h), (.19*b, -.14*h), (.16*b, .03*h)], .09*b, hair, True)
            beard.location = (0, -.18*b, 1.99*h)
            parts.append((beard, "head"))
        for side in (-1, 1):
            braid = oriented_segment(f"Braided hair {'L' if side > 0 else 'R'}", (side*.13*b, -.16*b, 2.00*h), (side*.17*b, -.19*b, beard_end), .052*b, .025*b, hair, 9, .035)
            parts.append((braid, "head"))
    if race.id == "orc":
        for side in (-1, 1):
            tusk = tapered_prism(f"Lower tusk {'L' if side > 0 else 'R'}", [(-.025*b, 0), (0, .115*h), (.030*b, 0), (0, -.035*h)], .045*b, sclera, True)
            tusk.location = (side*.095*b, -.205*b, 1.94*h)
            parts.append((tusk, "head"))

    # Limbs overlap at the joints. Palms, thumbs, fingers, knee guards and
    # articulated boots keep the silhouette recognisably humanoid at game scale.
    shoulder_z = 1.65*h
    limb_specs = []
    for side, label in ((1, "L"), (-1, "R")):
        upper_start = (side*.29*shoulder, 0, shoulder_z)
        upper_end = (side*.60*shoulder, 0, 1.35*h)
        fore_end = (side*.77*shoulder, -.018*b, 1.07*h)
        palm_end = (side*.79*shoulder, -.035*b, .91*h)
        limb_specs.extend([
            (f"Deltoid and upper arm {label}", upper_start, upper_end, .145*b, .105*b, skin, f"arm.{label}"),
            (f"Anatomical forearm {label}", upper_end, fore_end, .115*b, .082*b, skin, f"forearm.{label}"),
            (f"Palm {label}", fore_end, palm_end, .095*b, .075*b, skin, f"hand.{label}"),
        ])
        for finger in range(3):
            finger_x = side*(.755*shoulder + finger*.018*b)
            finger_mesh = oriented_segment(f"Finger {label} {finger}", (finger_x, -.038*b, .965*h), (finger_x+side*.008*b, -.055*b, .885*h), .026*b, .018*b, skin, 7, .004)
            parts.append((finger_mesh, f"hand.{label}"))
        thumb = oriented_segment(f"Thumb {label}", (side*.76*shoulder, -.045*b, 1.00*h), (side*.83*shoulder, -.075*b, .955*h), .031*b, .020*b, skin, 7, .008)
        parts.append((thumb, f"hand.{label}"))
        elbow = ring_form(f"Elbow joint {label}", [(1.31*h,.105*b,.09*b,side*.60*shoulder,0),(1.35*h,.12*b,.10*b,side*.60*shoulder,0),(1.39*h,.10*b,.085*b,side*.60*shoulder,0)], 10, skin)
        parts.append((elbow, f"forearm.{label}"))

        thigh_start = (side*.17*hip_width, 0, pelvis_z)
        knee = (side*.18*hip_width, 0, .52*h)
        ankle = (side*.165*hip_width, 0, .14*h)
        limb_specs.extend([
            (f"Anatomical thigh {label}", thigh_start, knee, .19*b, .135*b, cloth_secondary, f"thigh.{label}"),
            (f"Calf and shin {label}", knee, ankle, .145*b, .095*b, leather if archetype == "mage" else steel, f"shin.{label}"),
        ])
        knee_guard = tapered_prism(f"Knee guard {label}", [(-.11*b,-.10*h),(-.14*b,.02*h),(0,.13*h),(.14*b,.02*h),(.11*b,-.10*h),(0,-.16*h)], .075*b, trim, True)
        knee_guard.location = (side*.18*hip_width, -.135*b, .53*h)
        parts.append((knee_guard, f"shin.{label}"))
        boot = oriented_segment(f"Sculpted boot {label}", ankle, (side*.165*hip_width,-.24*b,.075*h), .115*b, .15*b, leather, 12, .018)
        parts.append((boot, f"foot.{label}"))
        toe = tapered_prism(f"Armored toe {label}", [(-.14*b,-.055*h),(-.12*b,.055*h),(0,.09*h),(.13*b,.05*h),(.16*b,-.07*h),(0,-.12*h)], .28*b, leather, True)
        toe.location = (side*.165*hip_width,-.20*b,.105*h)
        parts.append((toe, f"foot.{label}"))
        cuff = ring_form(f"Boot cuff {label}", [(.12*h,.13*b,.11*b,side*.165*hip_width,0),(.18*h,.15*b,.13*b,side*.165*hip_width,0),(.23*h,.135*b,.115*b,side*.165*hip_width,0)], 11, trim)
        parts.append((cuff, f"shin.{label}"))
    for name, start, end, rs, re, mat, bone in limb_specs:
        parts.append((oriented_segment(name, start, end, rs, re, mat, 12, .022*b), bone))

    belt = ring_form("Layered belt", [(.96*h,.30*hip_width,.185*b,0,0),(1.015*h,.31*hip_width,.19*b,0,0),(1.07*h,.275*hip_width,.17*b,0,0)], 16, leather, phase=.08)
    parts.append((belt,"pelvis"))
    buckle = tapered_prism("Belt clasp", [(-.085*b,-.06*h),(-.11*b,.05*h),(0,.11*h),(.11*b,.05*h),(.085*b,-.06*h),(0,-.10*h)], .035*b, trim, True)
    buckle.location=(0,-.205*b,1.015*h); parts.append((buckle,"pelvis"))

    if archetype == "warrior":
        cuirass = ring_form("Segmented warrior cuirass", [
            (1.08*h,.255*waist,.16*b,0,0),(1.22*h,.27*shoulder,.17*b,0,-.006),
            (1.40*h,.36*shoulder,.20*b,0,-.012),(1.57*h,.42*shoulder,.215*b,0,0),
            (1.68*h,.31*shoulder,.17*b,0,0),
        ], 18, steel, phase=.13)
        parts.append((cuirass,"spine"))
        chest_rune = tapered_prism("Cuirass heraldry", [(-.10*b,-.10*h),(-.15*b,.08*h),(0,.22*h),(.15*b,.08*h),(.10*b,-.10*h),(0,-.19*h)], .035*b, trim, True)
        chest_rune.location=(0,-.225*b,1.43*h); parts.append((chest_rune,"spine"))
        for side,label in ((1,"L"),(-1,"R")):
            pauldron = tapered_prism(f"Layered pauldron {label}", [(-.22*b,-.11*h),(-.17*b,.10*h),(0,.20*h),(.22*b,.10*h),(.30*b,-.09*h),(.10*b,-.18*h),(-.12*b,-.17*h)], .34*b, trim, True)
            pauldron.location=(side*.43*shoulder,0,1.62*h); pauldron.rotation_euler[2]=side*.16
            parts.append((pauldron,f"arm.{label}"))
            bracer=oriented_segment(f"Engraved bracer {label}",(side*.61*shoulder,0,1.34*h),(side*.76*shoulder,-.01*b,1.08*h),.125*b,.095*b,steel,12,.018)
            parts.append((bracer,f"forearm.{label}"))
            tasset=tapered_prism(f"Hip tasset {label}",[(-.13*b,.08*h),(-.17*b,-.20*h),(-.10*b,-.43*h),(0,-.51*h),(.10*b,-.43*h),(.17*b,-.20*h),(.13*b,.08*h)],.075*b,trim,True)
            tasset.location=(side*.22*hip_width,-.14*b,.98*h); parts.append((tasset,"pelvis"))
        hand_x=-.79*shoulder
        grip=oriented_segment("Sword leather grip",(hand_x,-.04*b,.88*h),(hand_x,-.04*b,1.08*h),.042*b,.040*b,leather,9,.006)
        parts.append((grip,"hand.R"))
        guard=tapered_prism("Sword wing guard",[(-.24*b,-.035*h),(-.07*b,.055*h),(0,.02*h),(.07*b,.055*h),(.24*b,-.035*h),(.08*b,-.075*h),(-.08*b,-.075*h)],.075*b,trim,True)
        guard.location=(hand_x,-.04*b,1.08*h); parts.append((guard,"hand.R"))
        blade=tapered_prism("Forged longsword blade",[(-.075*b,0),(-.095*b,.63*h),(-.045*b,.82*h),(0,.96*h),(.045*b,.82*h),(.095*b,.63*h),(.075*b,0)],.055*b,steel,True)
        blade.location=(hand_x,-.04*b,1.10*h); parts.append((blade,"hand.R"))
        shield=tapered_prism("Heraldic shield",[(-.30*b,.25*h),(0,.34*h),(.30*b,.25*h),(.34*b,-.12*h),(0,-.45*h),(-.34*b,-.12*h)],.11*b,trim,True)
        shield.location=(.84*shoulder,.05*b,1.14*h); shield.rotation_euler[1]=-.15
        parts.append((shield,"hand.L"))
    else:
        robe = ring_form("Layered ritual robe", [
            (.12*h,.26*hip_width,.18*b,0,0),(.25*h,.36*hip_width,.22*b,0,0),
            (.48*h,.35*hip_width,.21*b,0,0),(.70*h,.31*hip_width,.19*b,0,0),
            (.92*h,.28*hip_width,.175*b,0,0),(1.10*h,.25*waist,.16*b,0,0),(1.28*h,.27*waist,.17*b,0,0),
        ], 18, cloth, phase=.08)
        parts.append((robe,"pelvis"))
        for side,label in ((1,"L"),(-1,"R")):
            front_panel=tapered_prism(f"Embroidered robe panel {label}",[(-.075*b,.12*h),(-.095*b,-.35*h),(-.080*b,-.78*h),(0,-.89*h),(.080*b,-.78*h),(.095*b,-.35*h),(.075*b,.12*h)],.035*b,trim,True)
            front_panel.location=(side*.105*b,-.21*b,1.06*h); parts.append((front_panel,"pelvis"))
            sleeve=oriented_segment(f"Wide mage sleeve {label}",(side*.30*shoulder,0,1.61*h),(side*.61*shoulder,0,1.34*h),.19*b,.15*b,cloth_secondary,12,.03)
            parts.append((sleeve,f"arm.{label}"))
        mantle=ring_form("Arcane mantle",[(1.48*h,.38*shoulder,.20*b,0,0),(1.60*h,.48*shoulder,.235*b,0,0),(1.72*h,.40*shoulder,.20*b,0,0),(1.79*h,.18*shoulder,.13*b,0,0)],16,trim,phase=.12)
        parts.append((mantle,"spine"))
        sash=tapered_prism("Rune sash",[(-.075*b,.20*h),(-.11*b,-.25*h),(-.05*b,-.65*h),(0,-.80*h),(.07*b,-.65*h),(.11*b,-.25*h),(.075*b,.20*h)],.035*b,trim,True)
        sash.location=(.20*b,-.205*b,1.02*h); sash.rotation_euler[2]=-.16; parts.append((sash,"pelvis"))
        staff_x=-.79*shoulder
        staff=oriented_segment("Carved focus staff",(staff_x,.06*b,.18*h),(staff_x,.06*b,1.91*h),.052*b,.038*b,leather,10,.022)
        parts.append((staff,"hand.R"))
        for side in (-1,0,1):
            focus=tapered_prism(f"Staff focus crystal {side}",[(-.075*b,-.12*h),(0,.25*h),(.075*b,-.12*h),(0,-.23*h)],.065*b,trim,True)
            focus.location=(staff_x+side*.11*b,.06*b,1.95*h+abs(side)*.03*h); focus.rotation_euler[2]=side*.28
            parts.append((focus,"hand.R"))
        collar_rune=tapered_prism("Mantle focus",[(-.08*b,-.05*h),(0,.13*h),(.08*b,-.05*h),(0,-.13*h)],.035*b,eye,True)
        collar_rune.location=(0,-.22*b,1.64*h); parts.append((collar_rune,"spine"))

    for obj, bone in parts:
        if len(obj.data.polygons) > 120:
            decimate_object(obj,.58)
        bind_rigid(obj, armature, bone)
    humanoid_animations(armature)
    bpy.context.scene["neivara_asset_type"] = "humanoid"
    bpy.context.scene["race"] = race.id
    bpy.context.scene["gender"] = gender
    bpy.context.scene["archetype"] = archetype
    return armature


def monster_rig(name: str, biped=False):
    if biped:
        bones = (
            ("root", (0,0,0), (0,0,.25), None), ("body", (0,0,.55), (0,0,1.45), "root"),
            ("head", (0,0,1.38), (0,-.1,1.82), "body"),
            ("limb.L", (.28,0,1.18), (.68,0,.62), "body"), ("limb.R", (-.28,0,1.18), (-.68,0,.62), "body"),
            ("leg.L", (.18,0,.65), (.25,0,.08), "root"), ("leg.R", (-.18,0,.65), (-.25,0,.08), "root"),
        )
    else:
        bones = (
            ("root", (0,0,0), (0,0,.2), None), ("body", (0,0,.48), (0,-.18,.82), "root"),
            ("head", (0,-.2,.74), (0,-.82,.72), "body"),
            ("limb.L", (.28,-.18,.52), (.50,-.12,.05), "body"), ("limb.R", (-.28,-.18,.52), (-.50,-.12,.05), "body"),
            ("leg.L", (.26,.22,.48), (.45,.48,.04), "body"), ("leg.R", (-.26,.22,.48), (-.45,.48,.04), "body"),
        )
    return create_armature(name, bones)


def monster_animations(armature):
    def cycle(name, end, values):
        def keys(a):
            for f, amount in values:
                key_rotation(a, "limb.L", f, (amount, 0, amount*.25))
                key_rotation(a, "limb.R", f, (-amount, 0, -amount*.25))
                key_rotation(a, "leg.L", f, (-amount, 0, 0))
                key_rotation(a, "leg.R", f, (amount, 0, 0))
                key_rotation(a, "body", f, (amount*.08, 0, 0))
        make_action(armature, name, end, keys)
    cycle("idle", 48, ((0,0),(24,.10),(48,0)))
    cycle("run", 16, ((0,.55),(8,-.55),(16,.55)))
    cycle("attack", 26, ((0,0),(10,-.65),(16,.72),(26,0)))
    cycle("hit", 16, ((0,0),(5,.46),(16,0)))
    def death(a):
        for f, amount in ((0,0),(20,.6),(38,1.5)):
            key_rotation(a, "root", f, (amount, 0, amount*.15), location=(0,0,-amount*.16))
    make_action(armature, "death", 38, death)
    armature.animation_data.action = bpy.data.actions.get("idle")


def make_monster(kind: str):
    clean_scene()
    palettes = {
        "thorn_prowler": ((.13,.25,.11,1), (.34,.20,.08,1), (.59,.47,.16,1)),
        "moss_mauler": ((.16,.25,.12,1), (.19,.13,.07,1), (.43,.62,.20,1)),
        "cave_shrieker": ((.15,.10,.20,1), (.27,.12,.22,1), (.52,.27,.70,1)),
        "ruin_sentinel": ((.29,.31,.27,1), (.16,.17,.15,1), (.70,.38,.13,1)),
        "bramble_boar": ((.26,.18,.10,1), (.29,.31,.12,1), (.67,.46,.16,1)),
        "ember_drake": ((.30,.09,.045,1), (.12,.07,.065,1), (.92,.31,.08,1)),
    }
    base, secondary, glow = palettes[kind]
    hide = color_material("Hide or shell", base, metallic=.12, roughness=.76)
    plate = color_material("Natural armor", secondary, metallic=.28, roughness=.52)
    rune = color_material("Living rune", glow, metallic=.35, roughness=.18, emission=.8)
    void = color_material("Eye socket", (.012,.016,.018,1), metallic=.05, roughness=.42)
    tooth = color_material("Fang and claw", (.64,.61,.48,1), metallic=.04, roughness=.62)
    biped = kind == "ruin_sentinel"
    rig = monster_rig(f"{kind} rig", biped)
    parts = []

    def add_quadruped_legs(prefix, material, front_radius=.12, rear_radius=.13, spread=.44):
        for side in (-1,1):
            label = "L" if side > 0 else "R"
            front=oriented_segment(f"{prefix} foreleg {label}",(side*.25,-.16,.54),(side*spread,-.20,.04),front_radius,.065,material,9,.05)
            rear=oriented_segment(f"{prefix} hindleg {label}",(side*.26,.25,.52),(side*(spread+.03),.40,.04),rear_radius,.075,material,9,.055)
            parts.extend(((front,f"limb.{label}"),(rear,f"leg.{label}")))
            for position, bone, suffix in (
                ((side*spread,-.24,.055),f"limb.{label}","front"),
                ((side*(spread+.03),.35,.055),f"leg.{label}","rear"),
            ):
                pad=ring_form(f"{prefix} {suffix} paw {label}",[(.015,.105,.14,position[0],position[1]),(.075,.13,.17,position[0],position[1]),(.14,.085,.12,position[0],position[1])],10,material,phase=.08)
                parts.append((pad,bone))
                for toe_index in (-1,0,1):
                    claw=tapered_prism(f"{prefix} {suffix} claw {label} {toe_index}",[(-.026,-.025),(-.018,.05),(0,.12),(.022,.05),(.028,-.025),(0,-.055)],.045,tooth,True)
                    claw.location=(position[0]+toe_index*.055,position[1]-.16,.09)
                    claw.rotation_euler[0]=-.46
                    parts.append((claw,bone))

    if kind == "thorn_prowler":
        parts.extend([
            (ring_form("Sinewed body", [(.38,.18,.25,0,0),(.54,.38,.28,0,.04),(.72,.33,.25,0,.04),(.84,.14,.16,0,-.02)], 13, hide), "body"),
            (ring_form("Prowler skull", [(.55,.18,.17,0,-.62),(.68,.28,.23,0,-.54),(.82,.20,.18,0,-.44)], 12, hide), "head"),
        ])
        for side in (-1,1):
            horn = tapered_prism(f"Crown thorn {side}", [(0,0),(side*.20,.34),(side*.10,-.07)], .10, plate, True)
            horn.location=(side*.13,-.57,.80); parts.append((horn,"head"))
        add_quadruped_legs("Prowler",hide,.12,.13,.44)
        for idx in range(5):
            thorn=tapered_prism(f"Back thorn {idx}",[(-.06,0),(0,.30),(.07,0)],.09,plate,True)
            thorn.location=(0,.08+.08*idx,.77+.03*math.sin(idx)); parts.append((thorn,"body"))
        muzzle=ring_form("Prowler muzzle",[(.49,.13,.11,0,-.78),(.59,.20,.15,0,-.74),(.69,.15,.12,0,-.67)],11,plate,phase=.06)
        parts.append((muzzle,"head"))
        for idx,(start,end) in enumerate((((0,.30,.55),(0,.73,.43)),((0,.73,.43),(0,1.05,.28)))):
            parts.append((oriented_segment(f"Vine tail {idx}",start,end,.12-idx*.025,.085-idx*.02,hide,10,.05),"body"))
    elif kind == "moss_mauler":
        parts.extend([
            (ring_form("Massive mossed body", [(.32,.25,.31,0,.19),(.56,.48,.42,0,.10),(.83,.42,.37,0,.02),(.98,.21,.23,0,-.04)], 14, hide),"body"),
            (ring_form("Heavy mauler chest", [(.37,.31,.28,0,-.23),(.69,.43,.36,0,-.20),(.94,.27,.25,0,-.16)], 13, hide),"body"),
            (ring_form("Broad mauler skull", [(.50,.23,.20,0,-.72),(.71,.36,.28,0,-.61),(.91,.25,.22,0,-.48)], 13, plate),"head"),
        ])
        add_quadruped_legs("Mauler",hide,.17,.19,.52)
        for side in (-1,1):
            antler=tapered_prism(f"Forked antler {side}",[(0,-.05),(side*.16,.18),(side*.13,.43),(side*.25,.62),(side*.08,.52),(-side*.02,.30)],.105,plate,True)
            antler.location=(side*.18,-.64,.86); parts.append((antler,"head"))
        for idx,(x,y,z,s) in enumerate(((-.23,.02,.92,.32),(.18,.12,.98,.36),(0,.32,.88,.30))):
            moss=ring_form(f"Living moss mantle {idx}",[(z-.12,s*.75,s*.45,x,y),(z+.05,s,s*.62,x,y),(z+.22,s*.45,s*.34,x,y)],10,rune,phase=.17*idx)
            parts.append((moss,"body"))
        muzzle=ring_form("Mauler muzzle",[(.49,.17,.14,0,-.88),(.62,.26,.20,0,-.82),(.75,.18,.15,0,-.72)],12,hide,phase=.03)
        parts.append((muzzle,"head"))
    elif kind == "cave_shrieker":
        parts.extend([
            (ring_form("Shrieker ribcage", [(.34,.15,.20,0,.12),(.51,.28,.31,0,.04),(.72,.24,.27,0,-.05),(.86,.11,.15,0,-.12)], 13, hide),"body"),
            (ring_form("Echo chamber skull", [(.40,.17,.15,0,-.54),(.57,.27,.20,0,-.48),(.73,.18,.15,0,-.41)], 12, plate),"head"),
        ])
        for side in (-1,1):
            label="L" if side>0 else "R"
            wing=tapered_prism(f"Veined wing {label}",[(0,0),(side*.48,.46),(side*1.08,.62),(side*.82,.18),(side*1.18,-.18),(side*.48,-.05)],.035,hide,True)
            wing.location=(side*.16,.04,.66); parts.append((wing,f"limb.{label}"))
            strut=oriented_segment(f"Wing finger {label}",(side*.18,.02,.68),(side*1.04,.03,1.18),.045,.018,plate,7,.04)
            parts.append((strut,f"limb.{label}"))
            claw=oriented_segment(f"Cave talon {label}",(side*.20,.20,.43),(side*.38,.33,.03),.085,.035,plate,8,.04)
            parts.append((claw,f"leg.{label}"))
            crest=tapered_prism(f"Listening crest {label}",[(0,-.08),(side*.32,.06),(side*.13,.29),(side*.03,.12)],.035,rune,True)
            crest.location=(side*.12,-.53,.69); parts.append((crest,"head"))
        jaw=tapered_prism("Resonant jaw",[(-.22,.02),(0,-.20),(.22,.02),(.12,.12),(-.12,.12)],.10,rune,True)
        jaw.location=(0,-.66,.48); parts.append((jaw,"head"))
        for idx in range(3):
            rib=tapered_prism(f"Sonic rib {idx}",[(-.22,0),(0,.16),(.22,0),(0,-.12)],.045,plate,True)
            rib.location=(0,-.29,.47+idx*.10); parts.append((rib,"body"))
        for side in (-1,1):
            label="L" if side>0 else "R"
            for tooth_index in range(3):
                fang=tapered_prism(f"Shrieker fang {label} {tooth_index}",[(-.020,0),(0,-.10),(.022,0),(0,.025)],.026,tooth,True)
                fang.location=(side*(.035+tooth_index*.040),-.705,.54); parts.append((fang,"head"))
    elif kind == "ruin_sentinel":
        parts.extend([
            (ring_form("Runestone torso", [(.62,.30,.23,0,0),(1.02,.42,.27,0,0),(1.42,.34,.23,0,0),(1.56,.20,.18,0,0)], 10, plate),"body"),
            (ring_form("Ancient helm", [(1.36,.19,.17,0,-.03),(1.57,.26,.21,0,-.03),(1.80,.18,.16,0,0)],10,hide),"head"),
        ])
        for side in (-1,1):
            arm=oriented_segment(f"Monolith arm {side}",(side*.31,0,1.28),(side*.67,-.02,.57),.18,.13,plate,9,.04)
            leg=oriented_segment(f"Monolith leg {side}",(side*.18,0,.69),(side*.25,0,.05),.20,.15,hide,9,.03)
            parts.extend(((arm,f"limb.{ 'L' if side>0 else 'R'}"),(leg,f"leg.{ 'L' if side>0 else 'R'}")))
            rune_plate=tapered_prism(f"Shoulder rune {side}",[(-.15,-.10),(-.08,.16),(.10,.21),(.18,-.06),(0,-.20)],.21,rune,True)
            rune_plate.location=(side*.38,-.18,1.28); parts.append((rune_plate,f"limb.{ 'L' if side>0 else 'R'}"))
        core=tapered_prism("Heart rune",[(-.10,0),(0,.18),(.10,0),(0,-.18)],.04,rune,True)
        core.location=(0,-.275,1.09); parts.append((core,"body"))
        visor=tapered_prism("Sentinel visor",[(-.19,-.035),(-.13,.06),(0,.09),(.13,.06),(.19,-.035),(.12,-.085),(-.12,-.085)],.035,void,True)
        visor.location=(0,-.22,1.62); parts.append((visor,"head"))
        for side in (-1,1):
            label="L" if side>0 else "R"
            eye=tapered_prism(f"Sentinel eye {label}",[(-.055,0),(0,.028),(.055,0),(0,-.026)],.018,rune,True)
            eye.location=(side*.085,-.245,1.625); parts.append((eye,"head"))
            foot=tapered_prism(f"Sentinel foot {label}",[(-.19,-.09),(-.16,.11),(0,.17),(.17,.10),(.21,-.10),(0,-.17)],.32,hide,True)
            foot.location=(side*.25,-.10,.12); parts.append((foot,f"leg.{label}"))
            for finger_index in range(3):
                finger=oriented_segment(f"Sentinel finger {label} {finger_index}",(side*(.64+finger_index*.028),-.03,.66),(side*(.67+finger_index*.03),-.09,.48),.045,.027,plate,7,.008)
                parts.append((finger,f"limb.{label}"))
        crest=tapered_prism("Sentinel helm crest",[(-.12,-.08),(-.06,.32),(0,.55),(.07,.31),(.13,-.08),(0,-.18)],.16,plate,True)
        crest.location=(0,.02,1.73); parts.append((crest,"head"))
    elif kind == "bramble_boar":
        parts.extend([
            (ring_form("Bristled boar body", [(.31,.22,.27,0,.20),(.52,.45,.34,0,.12),(.76,.42,.33,0,.02),(.89,.20,.20,0,-.08)],14,hide),"body"),
            (ring_form("Armored boar head", [(.38,.20,.18,0,-.67),(.57,.34,.26,0,-.57),(.77,.27,.22,0,-.46)],13,plate),"head"),
            (ring_form("Rooted snout", [(.41,.16,.14,0,-.90),(.54,.24,.18,0,-.84),(.66,.18,.14,0,-.75)],11,hide),"head"),
        ])
        add_quadruped_legs("Boar",hide,.135,.15,.46)
        for side in (-1,1):
            label="L" if side>0 else "R"
            for tier in (0,1):
                tusk=tapered_prism(f"Hook tusk {label} {tier}",[(0,0),(side*(.28+.05*tier),.11),(side*(.20+.04*tier),.30),(side*.06,.16)],.055,rune,True)
                tusk.location=(side*(.12+.07*tier),-.84,.47+.10*tier); parts.append((tusk,"head"))
        for idx in range(7):
            bristle=tapered_prism(f"Bramble quill {idx}",[(-.045,0),(0,.35+.05*(idx%2)),(.05,0)],.06,plate,True)
            bristle.location=(0,-.05+idx*.085,.78+.04*math.sin(idx*.8)); bristle.rotation_euler[1]=-.12+idx*.03; parts.append((bristle,"body"))
        for side in (-1,1):
            ear=tapered_prism(f"Boar leaf ear {side}",[(0,-.08),(side*.28,.02),(side*.08,.22),(side*.01,.08)],.065,hide,True)
            ear.location=(side*.22,-.55,.73); parts.append((ear,"head"))
        for side in (-1,1):
            nostril=tapered_prism(f"Boar nostril {side}",[(-.035,0),(0,.025),(.035,0),(0,-.025)],.015,void,True)
            nostril.location=(side*.075,-1.01,.55); parts.append((nostril,"head"))
    elif kind == "ember_drake":
        parts.extend([
            (ring_form("Scaled drake body", [(.29,.18,.24,0,.22),(.52,.35,.32,0,.11),(.78,.31,.29,0,0),(.94,.15,.18,0,-.11)],14,plate),"body"),
            (ring_form("Ember drake skull", [(.44,.17,.15,0,-.69),(.62,.28,.22,0,-.59),(.81,.20,.17,0,-.47)],13,hide),"head"),
        ])
        add_quadruped_legs("Drake",plate,.105,.12,.45)
        for side in (-1,1):
            label="L" if side>0 else "R"
            wing=tapered_prism(f"Ember sail {label}",[(0,0),(side*.36,.46),(side*.92,.70),(side*.72,.18),(side*1.02,-.12),(side*.38,.02)],.045,hide,True)
            wing.location=(side*.17,.13,.80); parts.append((wing,f"limb.{label}"))
            spar=oriented_segment(f"Drake wing spar {label}",(side*.18,.12,.82),(side*.91,.15,1.48),.05,.018,plate,8,.03)
            parts.append((spar,f"limb.{label}"))
            horn=tapered_prism(f"Drake crown horn {label}",[(0,0),(side*.18,.36),(side*.08,-.05)],.06,rune,True)
            horn.location=(side*.12,-.59,.80); parts.append((horn,"head"))
        tail_points=((0,.29,.53),(0,.73,.43),(0,1.10,.30),(0,1.38,.16))
        for idx in range(3):
            tail=oriented_segment(f"Articulated flame tail {idx}",tail_points[idx],tail_points[idx+1],.12-idx*.025,.09-idx*.025,hide,9,.045)
            parts.append((tail,"body"))
        flame=tapered_prism("Tail ember blade",[(-.11,-.08),(0,.35),(.13,-.08),(0,-.24)],.07,rune,True)
        flame.location=(0,1.40,.18); flame.rotation_euler[0]=math.pi/2; parts.append((flame,"body"))
        for idx in range(3):
            scale=tapered_prism(f"Ember chest scale {idx}",[(-.11,0),(0,.16),(.11,0),(0,-.14)],.028,rune,True)
            scale.location=(0,-.31,.48+idx*.12); parts.append((scale,"body"))
        jaw=tapered_prism("Drake jaw",[(-.20,.06),(-.16,-.10),(0,-.18),(.16,-.10),(.20,.06),(.10,.13),(-.10,.13)],.12,hide,True)
        jaw.location=(0,-.79,.52); parts.append((jaw,"head"))
        for side in (-1,1):
            for tooth_index in range(3):
                fang=tapered_prism(f"Drake fang {side} {tooth_index}",[(-.018,0),(0,-.09),(.020,0),(0,.022)],.025,tooth,True)
                fang.location=(side*(.035+tooth_index*.047),-.855,.55); parts.append((fang,"head"))

    # Every creature receives a modeled face; positions vary with its skull.
    if kind != "ruin_sentinel":
        face_layout={
            "thorn_prowler":(-.79,.70,.105),"moss_mauler":(-.88,.73,.14),
            "cave_shrieker":(-.64,.61,.105),"bramble_boar":(-.88,.66,.13),
            "ember_drake":(-.78,.68,.105),
        }
        eye_y,eye_z,eye_x=face_layout[kind]
        for side in (-1,1):
            label="L" if side>0 else "R"
            socket=tapered_prism(f"Eye socket {label}",[(-.07,-.025),(-.035,.045),(.055,.04),(.08,-.025),(.025,-.065),(-.04,-.06)],.025,void,True)
            socket.location=(side*eye_x,eye_y,eye_z); parts.append((socket,"head"))
            pupil=tapered_prism(f"Glowing eye {label}",[(-.026,0),(0,.030),(.026,0),(0,-.030)],.012,rune,True)
            pupil.location=(side*eye_x,eye_y-.022,eye_z); parts.append((pupil,"head"))
    for obj,bone in parts:
        bind_rigid(obj,rig,bone)
    monster_animations(rig)
    bpy.context.scene["neivara_asset_type"]="monster"
    return rig


def hewn_prism(name, center, size, material, bevel=.04, skew=.02):
    x,y,z=size; cx,cy,cz=center
    verts=[
        (cx-x/2+skew,cy-y/2,cz-z/2),(cx+x/2,cy-y/2+skew,cz-z/2),(cx+x/2-skew,cy+y/2,cz-z/2),(cx-x/2,cy+y/2-skew,cz-z/2),
        (cx-x/2,cy-y/2+skew,cz+z/2),(cx+x/2-skew,cy-y/2,cz+z/2),(cx+x/2,cy+y/2-skew,cz+z/2),(cx-x/2+skew,cy+y/2,cz+z/2),
    ]
    faces=[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(4,0,3,7)]
    obj=mesh_object(name,verts,faces,material,False); bevel_object(obj,bevel,2); return obj


def arch_ring(name, center, outer, inner, depth, material, segments=18):
    cx,cy,cz=center; verts=[]
    for front in (-depth/2,depth/2):
        for radius in (outer,inner):
            for i in range(segments+1):
                a=math.pi*i/segments
                verts.append((cx+math.cos(a)*radius,cy+front,cz+math.sin(a)*radius))
    stride=segments+1; faces=[]
    for side in range(segments):
        for layer in (0,):
            a=side; b=side+1; c=2*stride+side+1; d=2*stride+side
            faces.append((a,b,c,d))
            a=stride+side; b=3*stride+side; c=3*stride+side+1; d=stride+side+1
            faces.append((a,b,c,d))
        faces.append((side,stride+side,stride+side+1,side+1))
        faces.append((2*stride+side,2*stride+side+1,3*stride+side+1,3*stride+side))
    return mesh_object(name,verts,faces,material,False)


def make_architecture(kind: str):
    clean_scene()
    stone=color_material("Moss-dark foundation stone",(.20,.28,.27,1),metallic=.04,roughness=.88)
    pale=color_material("Warm carved limestone",(.52,.48,.36,1),metallic=.02,roughness=.76)
    plaster=color_material("Ochre lime plaster",(.39,.27,.17,1),metallic=.0,roughness=.92)
    wood=color_material("Dark structural timber",(.12,.052,.022,1),roughness=.90)
    roof_mat=color_material("Verdigris roof tile",(.14,.24,.22,1),metallic=.38,roughness=.54)
    copper=color_material("Weathered bronze",(.38,.19,.055,1),metallic=.72,roughness=.38)
    glass=color_material("Aether window",(.08,.55,.61,1),metallic=.20,roughness=.14,emission=.72)
    iron=color_material("Blackened iron",(.035,.045,.045,1),metallic=.78,roughness=.30)
    objs=[]

    def add_window(name, location, width=.46, height=.72, rotation=0):
        frame=tapered_prism(f"{name} carved frame",[(-width*.62,-height*.52),(-width*.55,height*.28),(0,height*.58),(width*.55,height*.28),(width*.62,-height*.52),(0,-height*.66)],.13,pale,True)
        frame.location=location; frame.rotation_euler[2]=rotation; objs.append(frame)
        pane=tapered_prism(f"{name} glowing pane",[(-width*.40,-height*.39),(-width*.36,height*.20),(0,height*.42),(width*.36,height*.20),(width*.40,-height*.39),(0,-height*.47)],.035,glass,True)
        pane.location=(location[0],location[1]-.08*math.cos(rotation),location[2]); pane.rotation_euler[2]=rotation; objs.append(pane)
        for side in (-1,1):
            mullion=hewn_prism(f"{name} mullion {side}",(location[0]+side*width*.18*math.cos(rotation),location[1]+side*width*.18*math.sin(rotation)-.09*math.cos(rotation),location[2]),(.045,.055,height*.74),wood,.012,.004)
            mullion.rotation_euler[2]=rotation; objs.append(mullion)

    def add_lantern(name, location, scale=1.0):
        post=oriented_segment(f"{name} post",(location[0],location[1],location[2]),(location[0],location[1],location[2]+1.45*scale),.055*scale,.042*scale,iron,8,.012)
        objs.append(post)
        arm=oriented_segment(f"{name} arm",(location[0],location[1],location[2]+1.35*scale),(location[0]+.34*scale,location[1],location[2]+1.48*scale),.040*scale,.025*scale,iron,8,.035)
        objs.append(arm)
        cage=tapered_prism(f"{name} lantern cage",[(-.12,-.16),(-.14,.10),(0,.24),(.14,.10),(.12,-.16),(0,-.24)],.18*scale,iron,True)
        cage.location=(location[0]+.38*scale,location[1],location[2]+1.22*scale); cage.scale=(scale,scale,scale); objs.append(cage)
        flame=tapered_prism(f"{name} aether flame",[(-.055,-.10),(0,.13),(.055,-.10),(0,-.15)],.08*scale,glass,True)
        flame.location=(location[0]+.38*scale,location[1]-.02,location[2]+1.22*scale); flame.scale=(scale,scale,scale); objs.append(flame)

    def add_door(name, location, width, height, rotation=0):
        door=hewn_prism(f"{name} timber door",location,(width,.16,height),wood,.045,.025)
        door.rotation_euler[2]=rotation; objs.append(door)
        for band in (-.28,0,.28):
            strap=hewn_prism(f"{name} iron strap {band}",(location[0],location[1]-.10,location[2]+band*height),(width*.88,.035,.055),iron,.012,.004)
            strap.rotation_euler[2]=rotation; objs.append(strap)
        handle=tapered_prism(f"{name} handle",[(-.045,-.06),(-.06,.05),(0,.09),(.06,.05),(.045,-.06),(0,-.09)],.035,copper,True)
        handle.location=(location[0]+width*.27,location[1]-.13,location[2]); handle.rotation_euler[2]=rotation; objs.append(handle)

    if kind=="sanctuary":
        # Closed octagonal sanctuary: walls, glazed lancets, buttresses, doors,
        # tiled roof ribs and a beacon make it read as a complete building.
        foundation=ring_form("Octagonal stepped foundation",[(0,2.72,2.72,0,0),(.20,2.72,2.72,0,0),(.38,2.50,2.50,0,0),(.48,2.42,2.42,0,0)],16,stone,phase=math.pi/16)
        objs.append(foundation)
        for i in range(8):
            a=math.tau*i/8; x,y=math.cos(a)*2.35,math.sin(a)*2.35
            wall=hewn_prism(f"Complete sanctuary wall {i}",(x,y,1.52),(.30,1.88,2.40),plaster,.065,.05)
            wall.rotation_euler[2]=a; objs.append(wall)
            lower_band=hewn_prism(f"Wall plinth {i}",(math.cos(a)*2.48,math.sin(a)*2.48,.69),(.26,1.92,.46),stone,.045,.025)
            lower_band.rotation_euler[2]=a; objs.append(lower_band)
            bx,by=math.cos(a)*2.58,math.sin(a)*2.58
            butt=tapered_prism(f"Flying buttress {i}",[(-.18,0),(-.28,1.65),(-.12,2.55),(.18,2.55),(.28,1.65),(.18,0)],.44,pale)
            butt.location=(bx,by,0); butt.rotation_euler[2]=a; objs.append(butt)
            if i not in (6,):
                add_window(f"Sanctuary lancet {i}",(math.cos(a)*2.54,math.sin(a)*2.54,1.72),.42,.72,a+math.pi/2)
        upper_band=ring_form("Sanctuary carved cornice",[(2.58,2.56,2.56,0,0),(2.70,2.62,2.62,0,0),(2.82,2.45,2.45,0,0)],16,pale,phase=math.pi/16)
        objs.append(upper_band)
        roof=ring_form("Faceted sanctuary roof",[(2.75,2.72,2.72,0,0),(3.18,2.40,2.40,0,0),(3.62,1.64,1.64,0,0),(3.94,.78,.78,0,0),(4.12,.18,.18,0,0)],24,roof_mat,phase=math.pi/24)
        objs.append(roof)
        for rib in range(12):
            a=math.tau*rib/12
            roof_rib=oriented_segment(f"Bronze roof rib {rib}",(math.cos(a)*2.53,math.sin(a)*2.53,2.84),(math.cos(a)*.18,math.sin(a)*.18,4.10),.055,.025,copper,8,.05)
            objs.append(roof_rib)
        objs.append(arch_ring("Grand entrance arch",(0,-2.62,1.15),1.35,.82,.38,pale,22))
        add_door("Sanctuary",(0,-2.56,1.18),1.30,2.12,0)
        for step in range(4): objs.append(hewn_prism(f"Entrance stair {step}",(0,-3.0-step*.34,.08+step*.10),(2.4-step*.2,.62,.18),pale,.025,.015))
        crystal=tapered_prism("Sanctuary beacon",[(-.22,0),(0,.88),(.22,0),(0,-.34)],.22,glass,True); crystal.location=(0,0,4.35); objs.append(crystal)
        add_lantern("Sanctuary west lantern",(-1.35,-3.05,.30),.72)
        add_lantern("Sanctuary east lantern",(.65,-3.05,.30),.72)
    elif kind=="gatehouse":
        base=hewn_prism("Gatehouse continuous foundation",(0,.04,.32),(4.35,1.78,.64),stone,.08,.06); objs.append(base)
        for side in (-1,1):
            tower=hewn_prism(f"Gate tower complete mass {side}",(side*1.62,0,2.15),(1.28,1.55,3.72),plaster,.09,.065); objs.append(tower)
            for corner in (-1,1):
                pier=hewn_prism(f"Gate tower {side} corner pier {corner}",(side*1.62+corner*.57,-.02,1.82),(.22,1.68,3.35),stone,.045,.025); objs.append(pier)
            add_window(f"Gate tower slit {side}",(side*1.62,-.82,2.28),.28,.58,0)
            roof=ring_form(f"Gate tower roof {side}",[(4.02,.88,.88,side*1.62,0),(4.34,.74,.74,side*1.62,0),(4.75,.12,.12,side*1.62,0)],12,roof_mat,phase=.12)
            objs.append(roof)
            banner=tapered_prism(f"Gate banner {side}",[(-.22,.12),(-.24,-.62),(0,-.90),(.24,-.62),(.22,.12),(0,.22)],.035,side and copper,True)
            banner.location=(side*1.62,-.83,3.22); objs.append(banner)
        objs.append(arch_ring("Gatehouse arch",(0,-.05,1.32),1.46,.86,.82,pale,20))
        beam=hewn_prism("Carved gate beam",(0,0,2.72),(2.2,.55,.34),wood,.05,.025); objs.append(beam)
        for bar in range(7):
            x=-.72+bar*.24
            objs.append(hewn_prism(f"Portcullis vertical {bar}",(x,-.47,1.28),(.045,.055,2.36),iron,.01,.003))
        for bar,z in enumerate((.52,1.22,1.92,2.52)):
            objs.append(hewn_prism(f"Portcullis crossbar {bar}",(0,-.48,z),(1.62,.055,.055),iron,.01,.003))
        add_lantern("Gate approach lantern",(-.52,-1.18,.35),.72)
    elif kind=="dwelling":
        foundation=hewn_prism("Cottage stone foundation",(0,0,.30),(2.90,2.42,.60),stone,.08,.06); objs.append(foundation)
        # Four complete walls with a deliberate front door opening.
        for side in (-1,1):
            objs.append(hewn_prism(f"Cottage side wall {side}",(side*1.31,0,1.42),(.28,2.18,2.22),plaster,.055,.035))
            add_window(f"Cottage side window {side}",(side*1.47,-.05,1.55),.38,.58,side*math.pi/2)
        objs.append(hewn_prism("Cottage rear wall",(0,1.06,1.42),(2.66,.26,2.22),plaster,.055,.035))
        for side in (-1,1):
            objs.append(hewn_prism(f"Cottage front wall wing {side}",(side*.91,-1.06,1.40),(.82,.26,2.18),plaster,.055,.035))
        objs.append(hewn_prism("Cottage front lintel",(0,-1.06,2.15),(1.12,.26,.68),plaster,.055,.035))
        # Timber frame communicates scale and removes the white-box read.
        for side in (-1,1):
            for x in (-1.18,-.52,.52,1.18):
                beam=hewn_prism(f"Front timber stud {side} {x}",(x,side*1.18,1.42),(.11,.10,2.25),wood,.022,.008); objs.append(beam)
            sill=hewn_prism(f"Wall timber sill {side}",(0,side*1.18,.72),(2.64,.11,.12),wood,.022,.008); objs.append(sill)
        for side in (-1,1):
            roof=tapered_prism(f"Swept tiled roof {side}",[(-1.62,-.04),(0,1.48),(1.62,-.04),(1.48,-.22),(-1.48,-.22)],1.72,roof_mat)
            roof.location=(0,side*.30,2.35); roof.rotation_euler[0]=side*.035; objs.append(roof)
        for row in range(4):
            for tile in range(9):
                x=-1.35+tile*.34; z=2.55+row*.28
                shingle=tapered_prism(f"Roof shingle {row} {tile}",[(-.16,-.10),(-.14,.12),(0,.18),(.14,.12),(.16,-.10),(0,-.16)],.055,roof_mat,True)
                shingle.location=(x,-.92+row*.17,z); shingle.rotation_euler[0]=-.48; objs.append(shingle)
        objs.append(arch_ring("Cottage door frame",(0,-1.13,.88),.82,.58,.20,wood,14))
        add_door("Cottage",(0,-1.09,1.00),.94,1.82,0)
        add_window("Cottage front window",(.92,-1.22,1.50),.34,.52,0)
        porch=hewn_prism("Cottage porch",(0,-1.52,.24),(2.05,.82,.32),pale,.05,.03); objs.append(porch)
        for side in (-1,1): add_lantern(f"Cottage lantern {side}",(side*.72,-1.44,.36),.52)
        chimney=ring_form("Twisted chimney",[(2.35,.22,.19,.72,.48),(3.35,.18,.16,.70,.50),(3.62,.25,.22,.68,.52)],9,stone,phase=.1); objs.append(chimney)
    elif kind=="bridge":
        for side in (-1,1):
            arch=arch_ring(f"Bridge load-bearing arch {side}",(0,side*.72,-1.64),2.55,2.10,.22,stone,26); objs.append(arch)
        for segment in range(9):
            x=(segment-4)*.62; z=.42+.35*(1-(x/2.7)**2)
            deck=hewn_prism(f"Bridge voussoir {segment}",(x,0,z),(.60,1.65,.24),pale,.045,.025); deck.rotation_euler[1]=-.08*x; objs.append(deck)
        for side in (-1,1):
            for post in range(6):
                x=-2.7+post*1.08; z=.88+.35*(1-(x/2.7)**2)
                objs.append(hewn_prism(f"Bridge baluster {side} {post}",(x,side*.76,z),(.17,.17,.72),stone,.035,.015))
            rail=oriented_segment(f"Curved bridge rail {side}",(-2.75,side*.76,1.19),(2.75,side*.76,1.19),.07,.07,copper,10,.32); objs.append(rail)
        for end in (-1,1):
            pier=hewn_prism(f"Bridge end pier {end}",(end*3.02,0,.58),(.58,2.04,1.16),stone,.07,.05); objs.append(pier)
            add_lantern(f"Bridge lantern {end}",(end*3.02,-.82,1.02),.58)
        for marker in range(7):
            x=-2.4+marker*.8; z=.64+.34*(1-(x/2.7)**2)
            inset=tapered_prism(f"Bridge roadway inset {marker}",[(-.24,-.10),(-.20,.10),(0,.16),(.22,.09),(.25,-.10),(0,-.16)],.055,stone,True)
            inset.location=(x,-.04,z+.13); inset.rotation_euler[0]=math.pi/2; objs.append(inset)
    bpy.context.scene["neivara_asset_type"]="architecture"
    return objs


def make_prop(kind: str):
    clean_scene()
    bark=color_material("Ancient bark",(.11,.052,.020,1),roughness=.94)
    bark_light=color_material("Cut bark",(.31,.16,.055,1),roughness=.88)
    leaf=color_material("Deep vale leaves",(.055,.25,.12,1),roughness=.78)
    leaf_light=color_material("Sunlit vale leaves",(.20,.46,.16,1),roughness=.72)
    moss=color_material("Soft moss",(.18,.34,.09,1),roughness=.96)
    stone=color_material("Vale stone",(.22,.29,.28,1),roughness=.88)
    stone_light=color_material("Broken stone face",(.42,.44,.35,1),roughness=.82)
    metal=color_material("Bronze",(.41,.22,.07,1),metallic=.75,roughness=.33)
    glow=color_material("Aether glow",(.08,.68,.73,1),metallic=.22,roughness=.16,emission=.85)
    cloth=color_material("Market canvas",(.46,.18,.08,1),roughness=.8)
    cloth_alt=color_material("Market canvas trim",(.12,.29,.28,1),roughness=.78)
    objs=[]
    if kind=="ancient_tree":
        trunk=ring_form("Gnarled bifurcated trunk",[(0,.48,.40,0,0),(.34,.53,.43,-.03,.02),(.86,.39,.33,.08,0),(1.42,.34,.29,-.07,.035),(2.02,.28,.24,.06,.01),(2.54,.20,.17,.10,-.02),(2.96,.13,.11,.04,0)],16,bark,phase=.14); objs.append(trunk)
        branch_data=(((1.48,.08,3.35),.17),((-1.35,.52,3.18),.16),((.50,-1.30,3.02),.15),((-.72,-.88,3.52),.13),((.92,.74,3.67),.13))
        for idx,(end,rad) in enumerate(branch_data):
            branch=oriented_segment(f"Twisting branch {idx}",(0.04,0,2.05+idx*.05),end,.21,rad,bark,12,.18); objs.append(branch)
            # Many overlapping clusters replace the previous candy-shaped crown.
            cluster_offsets=((0,0,.08),(.38,.10,.10),(-.30,.18,.18),(.12,-.34,.02),(-.18,-.28,-.08))
            for cluster_index,(ox,oy,oz) in enumerate(cluster_offsets):
                cx,cy,cz=end[0]+ox,end[1]+oy,end[2]+oz
                cluster=ring_form(f"Foliage cluster {idx} {cluster_index}",[(cz-.28,.34,.28,cx,cy),(cz-.08,.54,.39,cx+.04,cy-.02),(cz+.19,.47,.35,cx-.03,cy+.02),(cz+.38,.22,.18,cx,cy)],10,leaf if (idx+cluster_index)%2 else leaf_light,phase=.13*(idx+cluster_index))
                objs.append(cluster)
                for leaf_index in range(2):
                    card=tapered_prism(f"Leaf spray {idx} {cluster_index} {leaf_index}",[(-.10,-.05),(0,.28),(.11,-.05),(.04,-.22),(-.04,-.22)],.018,leaf_light,True)
                    card.location=(cx+(leaf_index-.5)*.20,cy-.35,cz+.05+leaf_index*.12); card.rotation_euler[2]=(leaf_index-.5)*.55; objs.append(card)
        for root in range(8):
            a=math.tau*root/8; length=1.15+(root%3)*.16; end=(math.cos(a)*length,math.sin(a)*length,.025)
            objs.append(oriented_segment(f"Exposed root {root}",(0,0,.38),end,.24,.065,bark,10,.07))
        for knot_index,(x,y,z) in enumerate(((.33,-.18,.72),(-.26,-.20,1.22),(.18,-.23,1.70))):
            knot=ring_form(f"Bark knot {knot_index}",[(z-.10,.12,.10,x,y),(z,.18,.14,x,y-.03),(z+.12,.10,.08,x,y)],9,bark_light,phase=.18)
            objs.append(knot)
        hanging=oriented_segment("Hanging lantern cord",(.74,-.52,3.22),(.74,-.52,2.42),.018,.012,metal,7,.01); objs.append(hanging)
        lantern=tapered_prism("Tree aether lantern",[(-.14,-.16),(-.16,.08),(0,.24),(.16,.08),(.14,-.16),(0,-.25)],.19,metal,True); lantern.location=(.74,-.52,2.25); objs.append(lantern)
        flame=tapered_prism("Tree lantern flame",[(-.06,-.11),(0,.14),(.06,-.11),(0,-.16)],.08,glow,True); flame.location=(.74,-.62,2.25); objs.append(flame)
    elif kind=="market_stall":
        for side in (-1,1):
            for depth in (-1,1): objs.append(oriented_segment(f"Carved stall post {side} {depth}",(side*.92,depth*.55,0),(side*.88,depth*.50,2.28),.085,.060,bark,10,.018))
        for depth in (-1,1): objs.append(oriented_segment(f"Stall roof beam {depth}",(-1.0,depth*.52,2.15),(1.0,depth*.52,2.15),.075,.075,bark,9,.025))
        counter=hewn_prism("Merchant counter slab",(0,-.18,.83),(2.12,.94,.20),bark_light,.05,.03); objs.append(counter)
        front=hewn_prism("Merchant counter front",(0,.18,.48),(1.94,.18,.74),bark,.045,.025); objs.append(front)
        for shelf_index,z in enumerate((.42,1.18)):
            shelf=hewn_prism(f"Display shelf {shelf_index}",(0,.47,z),(1.72,.32,.11),bark_light,.03,.015); objs.append(shelf)
        canopy=tapered_prism("Layered embroidered canopy",[(-1.22,-.14),(-1.02,.35),(-.42,.46),(0,.38),(.42,.46),(1.02,.35),(1.22,-.14),(.92,-.36),(-.92,-.36)],1.62,cloth,True); canopy.location=(0,0,2.18); objs.append(canopy)
        trim=tapered_prism("Canopy contrasting valance",[(-1.05,.08),(-.88,-.24),(-.60,-.08),(-.34,-.28),(0,-.10),(.34,-.28),(.60,-.08),(.88,-.24),(1.05,.08)],.08,cloth_alt,True); trim.location=(0,-.84,2.02); objs.append(trim)
        for idx in range(7):
            charm=tapered_prism(f"Hanging charm {idx}",[(-.035,0),(0,.13),(.04,0),(0,-.16)],.022,metal,True); charm.location=(-.78+idx*.26,-.88,1.91-(idx%2)*.08); objs.append(charm)
        for jar_index,(x,z,s) in enumerate(((-.62,1.34,.16),(-.28,1.30,.19),(.15,1.33,.15),(.49,1.31,.18))):
            jar=ring_form(f"Merchant jar {jar_index}",[(z-.16,s*.72,s*.62,x,.27),(z-.04,s,s*.82,x,.27),(z+.10,s*.85,s*.72,x,.27),(z+.17,s*.42,s*.36,x,.27)],10,stone_light if jar_index%2 else metal,phase=.12)
            objs.append(jar)
        for crate_index,x in enumerate((-.55,.48)):
            crate=hewn_prism(f"Reinforced goods crate {crate_index}",(x,-.05,.25),(.58,.55,.48),bark,.035,.025); objs.append(crate)
            for band in (-.19,.19): objs.append(hewn_prism(f"Crate band {crate_index} {band}",(x+band,-.35,.25),(.045,.025,.44),metal,.01,.003))
    elif kind=="waystone":
        # A broken rune arch and suspended crystal read as a magical waypoint,
        # not a generic obelisk.
        base=ring_form("Waystone circular footing",[(0,1.18,.96,0,0),(.16,1.10,.90,0,0),(.34,.82,.68,0,0),(.46,.66,.55,0,0)],14,stone,phase=.12); objs.append(base)
        arch=arch_ring("Broken runic waypoint arch",(0,0,.48),1.55,.96,.34,stone_light,28); objs.append(arch)
        for side in (-1,1):
            butt=tapered_prism(f"Rooted arch buttress {side}",[(-.30,-.14),(-.38,.55),(-.22,1.15),(0,1.52),(.24,1.10),(.35,.46),(.28,-.16),(0,-.30)],.48,stone,True)
            butt.location=(side*.94,.10,.28); butt.rotation_euler[2]=side*.09; objs.append(butt)
            root=oriented_segment(f"Waystone root {side}",(side*.82,.12,.34),(side*1.45,.38,.03),.18,.055,bark,10,.08); objs.append(root)
        crystal=tapered_prism("Suspended waypoint crystal",[(-.18,-.26),(-.24,.12),(0,.62),(.24,.12),(.18,-.26),(0,-.58)],.22,glow,True); crystal.location=(0,-.08,1.43); objs.append(crystal)
        for idx,a in enumerate((.18,.52,.86,1.20,1.54,1.88,2.22,2.56,2.90)):
            x=math.cos(a)*1.25; z=.48+math.sin(a)*1.25
            rune=tapered_prism(f"Arch rune {idx}",[(-.07,-.07),(0,.10),(.07,-.07),(0,-.12)],.028,glow,True); rune.location=(x,-.19,z); rune.rotation_euler[2]=a-math.pi/2; objs.append(rune)
        for shard_index,(x,y,z,s) in enumerate(((-.58,-.42,.48,.16),(.48,-.48,.42,.13),(-.34,.38,.38,.11),(.66,.25,.43,.14))):
            shard=tapered_prism(f"Orbiting crystal shard {shard_index}",[(-s*.4,-s),(0,s*1.6),(s*.4,-s),(0,-s*1.3)],s*.42,glow,True); shard.location=(x,y,z+1.0); shard.rotation_euler[2]=shard_index*.7; objs.append(shard)
    elif kind=="rock_cluster":
        boulders=((-0.62,.10,.82,.68),(.12,.24,1.0,.86),(.58,-.12,.66,.53),(-.10,-.50,.72,.48),(.82,.32,.48,.34),(-.82,-.36,.50,.31),(.32,-.52,.42,.28))
        for idx,(x,y,s,height) in enumerate(boulders):
            rock=ring_form(f"Irregular weathered boulder {idx}",[(0,.40*s,.32*s,x,y),(.12*height,.52*s,.41*s,x+.05*math.sin(idx),y-.03),(height*.52,.48*s,.36*s,x-.04,y+.02),(height,.25*s,.20*s,x+.02,y)],9+(idx%3),stone if idx%2 else stone_light,phase=.21*idx)
            rock.rotation_euler[2]=idx*.31; objs.append(rock)
            moss_pad=ring_form(f"Boulder moss patch {idx}",[(height*.63,.22*s,.17*s,x-.03,y-.02),(height*.73,.29*s,.22*s,x,y),(height*.80,.12*s,.09*s,x+.02,y)],8,moss,phase=.17*idx)
            objs.append(moss_pad)
        for crystal_index,(x,y,z,tilt) in enumerate(((-.28,-.18,.68,-.18),(.22,.04,.82,.16),(.54,-.28,.48,.30))):
            crystal=tapered_prism(f"Short aether crystal {crystal_index}",[(-.08,-.12),(0,.38),(.09,-.12),(0,-.20)],.09,glow,True); crystal.location=(x,y,z); crystal.rotation_euler[1]=tilt; objs.append(crystal)
        for grass_index in range(10):
            a=math.tau*grass_index/10; r=.75+(grass_index%3)*.16
            blade=tapered_prism(f"Grass blade {grass_index}",[(-.025,-.05),(0,.34+grass_index%2*.12),(.03,-.05),(0,-.10)],.012,leaf_light,True); blade.location=(math.cos(a)*r,math.sin(a)*r,.08); blade.rotation_euler[2]=a; objs.append(blade)
    if kind == "ancient_tree":
        for obj in objs:
            if len(obj.data.polygons) > 120:
                decimate_object(obj,.66)
    bpy.context.scene["neivara_asset_type"]="prop"
    return objs


def export_glb(filepath: Path, asset_name: str):
    filepath.parent.mkdir(parents=True,exist_ok=True)
    for obj in bpy.context.scene.objects: obj.select_set(obj.type in {"MESH","ARMATURE","EMPTY"})
    bpy.ops.export_scene.gltf(
        filepath=str(filepath), export_format="GLB", use_selection=True,
        export_animations=True, export_animation_mode="ACTIONS", export_skins=True,
        export_morph=False, export_yup=True, export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_extras=True,
        export_optimize_animation_size=True,
    )
    print(f"[neivara-assets] wrote {asset_name}: {filepath.stat().st_size} bytes")


def glb_stats(path: Path):
    data=path.read_bytes(); json_len=int.from_bytes(data[12:16],"little"); payload=json.loads(data[20:20+json_len].decode("utf8").rstrip(" \x00"))
    triangles=0
    for mesh in payload.get("meshes",[]):
        for primitive in mesh.get("primitives",[]):
            accessor=primitive.get("indices")
            if accessor is not None: triangles += payload["accessors"][accessor].get("count",0)//3
    return {
        "bytes":len(data),"sha256":hashlib.sha256(data).hexdigest(),"meshes":len(payload.get("meshes",[])),
        "triangles":triangles,"skins":len(payload.get("skins",[])),"animations":[a.get("name","") for a in payload.get("animations",[])],
        "embeddedTextures":len(payload.get("images",[])),
    }


def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--output",required=True); args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else None)
    root=Path(args.output).resolve()
    if root.exists(): shutil.rmtree(root)
    texture_dir=root/"textures"; texture_dir.mkdir(parents=True)
    assets=[]
    for race in RACES:
        for gender in GENDERS:
            for archetype in ARCHETYPES:
                asset_id=f"humanoid.{race.id}.{gender}.{archetype}"
                make_humanoid(race,gender,archetype,texture_dir)
                path=root/"humanoids"/race.id/f"{gender}-{archetype}.glb"; export_glb(path,asset_id)
                assets.append({"id":asset_id,"kind":"humanoid","race":race.id,"gender":gender,"archetype":archetype,"url":"./"+path.relative_to(root).as_posix(),"scale":1.0,"stats":glb_stats(path)})
    for monster in ("thorn_prowler","moss_mauler","cave_shrieker","ruin_sentinel","bramble_boar","ember_drake"):
        asset_id=f"monster.{monster}"; make_monster(monster); path=root/"monsters"/f"{monster}.glb"; export_glb(path,asset_id)
        assets.append({"id":asset_id,"kind":"monster","url":"./"+path.relative_to(root).as_posix(),"scale":1.0,"stats":glb_stats(path)})
    for architecture in ("sanctuary","gatehouse","dwelling","bridge"):
        asset_id=f"architecture.{architecture}"; make_architecture(architecture); path=root/"architecture"/f"{architecture}.glb"; export_glb(path,asset_id)
        assets.append({"id":asset_id,"kind":"architecture","url":"./"+path.relative_to(root).as_posix(),"scale":1.0,"stats":glb_stats(path)})
    for prop in ("ancient_tree","market_stall","waystone","rock_cluster"):
        asset_id=f"prop.{prop}"; make_prop(prop); path=root/"props"/f"{prop}.glb"; export_glb(path,asset_id)
        assets.append({"id":asset_id,"kind":"prop","url":"./"+path.relative_to(root).as_posix(),"scale":1.0,"stats":glb_stats(path)})
    # Textures are embedded into GLBs. Keep deterministic PNG sources beside the models for iteration.
    manifest={
        "version":"1.0.0","generator":"tools/generate_3d_assets.py","seed":SEED,
        "license":"Proprietary project-original clean-room assets; repository LICENSE applies",
        "coordinateSystem":"glTF 2.0, metres, Y-up at runtime","animationContract":{"humanoid":list(HUMANOID_ANIMATIONS),"monster":list(MONSTER_ANIMATIONS)},
        "assets":assets,
    }
    (root/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print(f"[neivara-assets] manifest: {len(assets)} assets")


if __name__=="__main__": main()

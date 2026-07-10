"""Build Neivara's 5 x 2 x 2 browser character roster from CC0 KayKit rigs.

The source characters provide the professionally authored topology, rig, facial
features, equipment and animation library.  This deterministic Blender pass
keeps only gameplay clips and equipped items, applies Neivara race palettes and
proportions, and adds small original race-signature meshes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path

import bpy


SOURCE_HASHES = {
    "Barbarian": "cefc311a0e10c7858b6141f5ada7e33268727564fb8ac1347aab97d000669cc6",
    "Knight": "60428e3abc09ba83e595d256e3af8c5c976b46cdae599f0802fc82b4a3445168",
    "Mage": "cf898585da33fab50c724d31605fb931eb2912e6d2280092141e98ca81ad507d",
    "Rogue": "e825437cd4d2ee9c1960b517a74a69101e33eb409ae7fa8cedc7134a998fbb7d",
}

BODY_PARTS = ("ArmLeft", "ArmRight", "Body", "Head", "LegLeft", "LegRight")
GEAR = {
    "Barbarian": {"1H_Axe", "Barbarian_Round_Shield", "Barbarian_Hat", "Barbarian_Cape"},
    "Knight": {"1H_Sword", "Badge_Shield", "Knight_Helmet", "Knight_Cape"},
    "Mage": {"1H_Wand", "Spellbook_open", "Mage_Hat", "Mage_Cape"},
    "Rogue": {"Knife", "Knife_Offhand", "Rogue_Cape"},
}
FEMALE_MAGE_ACCESSORIES = {"1H_Wand", "Spellbook_open"}


@dataclass(frozen=True)
class RaceStyle:
    skin_srgb: tuple[float, float, float]
    scale: tuple[float, float, float]
    signature: str | None = None


RACES = {
    "human": RaceStyle((0.93, 0.69, 0.52), (1.00, 1.00, 1.00)),
    "light_elf": RaceStyle((0.90, 0.84, 0.76), (0.94, 0.94, 1.10), "ears"),
    "dark_elf": RaceStyle((0.43, 0.35, 0.56), (0.96, 0.96, 1.07), "ears"),
    "dwarf": RaceStyle((0.76, 0.53, 0.34), (1.12, 1.08, 0.80)),
    "orc": RaceStyle((0.40, 0.59, 0.28), (1.18, 1.12, 1.07), "tusks"),
}
GENDERS = ("male", "female")
ARCHETYPES = ("warrior", "mage")


def arguments() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else None
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--source", required=True)
    return parser.parse_args(values)


def srgb_to_linear(channel: float) -> float:
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def without_suffix(name: str) -> str:
    return re.sub(r"\.\d{3}$", "", name)


def clear_blender() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for blocks in (
        bpy.data.actions,
        bpy.data.armatures,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def import_glb(path: Path) -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def delete_objects(objects: list[bpy.types.Object]) -> None:
    for obj in objects:
        if obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)


def choose_base(race: str, gender: str, archetype: str) -> str:
    if gender == "female":
        return "Rogue"
    if archetype == "mage":
        return "Mage"
    return "Barbarian" if race in {"dwarf", "orc"} else "Knight"


def prepare_base(source_root: Path, race: str, gender: str, archetype: str):
    base = choose_base(race, gender, archetype)
    imported = import_glb(source_root / f"{base}.glb")
    rig = next(obj for obj in imported if obj.type == "ARMATURE")
    body = {f"{base}_{part}" for part in BODY_PARTS}
    keep = body | GEAR[base]
    if gender == "female" and archetype == "mage":
        keep = body | {"Rogue_Cape"}
    delete_objects([obj for obj in imported if obj.type == "MESH" and without_suffix(obj.name) not in keep])

    if gender == "female" and archetype == "mage":
        append_mage_accessories(source_root, rig)

    rig.name = "NeivaraCharacterRig"
    rig.data.name = "NeivaraCharacterSkeleton"
    rig["neivara_race"] = race
    rig["neivara_gender"] = gender
    rig["neivara_archetype"] = archetype
    rig["source"] = "KayKit Adventurers 1.0 (CC0), adapted for Neivara"
    return base, rig


def append_mage_accessories(source_root: Path, target_rig: bpy.types.Object) -> None:
    imported = import_glb(source_root / "Mage.glb")
    accessories = [
        obj
        for obj in imported
        if obj.type == "MESH" and without_suffix(obj.name) in FEMALE_MAGE_ACCESSORIES
    ]
    for obj in accessories:
        world = obj.matrix_world.copy()
        obj.parent = target_rig
        obj.matrix_parent_inverse = target_rig.matrix_world.inverted()
        obj.matrix_world = world
        obj.name = f"Arcane_{without_suffix(obj.name)}"
        for modifier in obj.modifiers:
            if modifier.type == "ARMATURE":
                modifier.object = target_rig
    delete_objects([obj for obj in imported if obj not in accessories])


def trim_animations(rig: bpy.types.Object, base: str, archetype: str) -> None:
    attack = "Dualwield_Melee_Attack_Slice" if base == "Rogue" else "1H_Melee_Attack_Slice_Diagonal"
    if archetype == "mage":
        attack = "Spellcast_Shoot"
    rename = {
        "Idle": "idle",
        "Running_A": "run",
        attack: "attack",
        "Spellcast_Long": "cast",
        "Hit_A": "hit",
        "Death_B": "death",
    }
    animation_data = rig.animation_data
    if not animation_data:
        raise RuntimeError("KayKit source rig has no animation data")
    animation_data.action = None
    kept_actions: list[bpy.types.Action] = []
    for track in list(animation_data.nla_tracks):
        source_name = without_suffix(track.name)
        target_name = rename.get(source_name)
        if not target_name:
            animation_data.nla_tracks.remove(track)
            continue
        track.name = target_name
        for strip in track.strips:
            strip.name = target_name
            strip.action.name = target_name
            kept_actions.append(strip.action)
    if {action.name for action in kept_actions} != set(rename.values()):
        raise RuntimeError(f"Incomplete animation mapping: {[action.name for action in kept_actions]}")
    keep_ids = {action.as_pointer() for action in kept_actions}
    for action in list(bpy.data.actions):
        if action.as_pointer() not in keep_ids:
            bpy.data.actions.remove(action)


def recolor_and_pack_textures(
    output_root: Path,
    base: str,
    race: str,
    gender: str,
    archetype: str,
) -> None:
    images = [image for image in bpy.data.images if image.size[0] > 0 and image.size[1] > 0]
    primary = next(image for image in images if image.name.lower().startswith(base.lower()))
    target = tuple(srgb_to_linear(channel) for channel in RACES[race].skin_srgb)
    texture_path = output_root / "textures" / f"{race}_{gender}_{archetype}.png"
    texture_path.parent.mkdir(parents=True, exist_ok=True)

    for image in images:
        image.scale(256, 256)
        if image is primary:
            pixels = list(image.pixels)
            for y in range(192, 256):
                for x in range(0, 86):
                    offset = (y * 256 + x) * 4
                    red, green, blue = pixels[offset : offset + 3]
                    luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
                    shade = max(0.56, min(1.22, luminance / 0.79))
                    pixels[offset] = min(1.0, target[0] * shade)
                    pixels[offset + 1] = min(1.0, target[1] * shade)
                    pixels[offset + 2] = min(1.0, target[2] * shade)
            image.pixels[:] = pixels
            image.name = f"neivara_{race}_{gender}_{archetype}"
            image.filepath_raw = str(texture_path)
            image.file_format = "PNG"
            image.save()
        image.pack()


def flat_material(name: str, srgb: tuple[float, float, float], metallic: float = 0.0):
    linear = tuple(srgb_to_linear(channel) for channel in srgb)
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*linear, 1.0)
    material.metallic = metallic
    material.roughness = 0.5
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = (*linear, 1.0)
        metallic_input = principled.inputs.get("Metallic IOR Level") or principled.inputs.get("Metallic")
        if metallic_input:
            metallic_input.default_value = metallic
        principled.inputs["Roughness"].default_value = 0.5
    return material


def head_bounds():
    head = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH" and "_Head" in obj.name)
    corners = [head.matrix_world @ type(head.location)(corner) for corner in head.bound_box]
    return (
        min(point.x for point in corners),
        max(point.x for point in corners),
        min(point.y for point in corners),
        max(point.y for point in corners),
        min(point.z for point in corners),
        max(point.z for point in corners),
    )


def skinned_signature_mesh(
    name: str,
    rig: bpy.types.Object,
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    material: bpy.types.Material,
    texture_uv: tuple[float, float] | None = None,
) -> None:
    mesh = bpy.data.meshes.new(f"{name}Geometry")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    if texture_uv:
        uv_layer = mesh.uv_layers.new(name="RaceSignatureUV")
        for loop_uv in uv_layer.data:
            loop_uv.uv = texture_uv
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = rig
    obj.data.materials.append(material)
    group = obj.vertex_groups.new(name="head")
    group.add(list(range(len(vertices))), 1.0, "REPLACE")
    modifier = obj.modifiers.new(name="Neivara head skin", type="ARMATURE")
    modifier.object = rig


def head_skin_material() -> bpy.types.Material:
    head = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH" and "_Head" in obj.name)
    for material in head.data.materials:
        if not material or not material.use_nodes:
            continue
        if any(node.type == "TEX_IMAGE" for node in material.node_tree.nodes):
            return material
    if head.data.materials:
        return head.data.materials[0]
    raise RuntimeError("The source head has no skin material")


def add_elf_ears(rig: bpy.types.Object, skin: tuple[float, float, float]) -> None:
    min_x, max_x, min_y, max_y, min_z, max_z = head_bounds()
    radius = max(abs(min_x), abs(max_x))
    center_y = (min_y + max_y) * 0.5
    center_z = min_z + (max_z - min_z) * 0.53
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for sign in (-1.0, 1.0):
        base_x = sign * radius * 0.88
        tip_x = sign * (radius + (max_z - min_z) * 0.19)
        start = len(vertices)
        vertices.extend(
            [
                (base_x, center_y - 0.038, center_z - 0.078),
                (base_x, center_y - 0.038, center_z + 0.078),
                (tip_x, center_y - 0.025, center_z + 0.01),
                (base_x, center_y + 0.038, center_z - 0.078),
                (base_x, center_y + 0.038, center_z + 0.078),
                (tip_x, center_y + 0.025, center_z + 0.01),
            ]
        )
        faces.extend(
            [
                (start, start + 2, start + 1),
                (start + 3, start + 4, start + 5),
                (start, start + 3, start + 5, start + 2),
                (start + 1, start + 2, start + 5, start + 4),
                (start, start + 1, start + 4, start + 3),
            ]
        )
    skinned_signature_mesh("ElvenEars", rig, vertices, faces, head_skin_material(), (0.055, 0.90))


def add_orc_tusks(rig: bpy.types.Object) -> None:
    min_x, max_x, min_y, _max_y, min_z, max_z = head_bounds()
    center_x = (min_x + max_x) * 0.5
    height = max_z - min_z
    mouth_z = min_z + height * 0.31
    front_y = min_y - 0.035
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for sign in (-1.0, 1.0):
        x = center_x + sign * height * 0.105
        start = len(vertices)
        vertices.extend(
            [
                (x - 0.026, front_y, mouth_z),
                (x + 0.026, front_y, mouth_z),
                (x, front_y, mouth_z + height * 0.085),
                (x - 0.018, front_y + 0.04, mouth_z + 0.01),
                (x + 0.018, front_y + 0.04, mouth_z + 0.01),
            ]
        )
        faces.extend(
            [
                (start, start + 1, start + 2),
                (start + 3, start + 2, start + 4),
                (start, start + 2, start + 3),
                (start + 1, start + 4, start + 2),
                (start, start + 3, start + 4, start + 1),
            ]
        )
    material = flat_material("Orc tusk ivory", (0.88, 0.82, 0.66))
    skinned_signature_mesh("OrcTusks", rig, vertices, faces, material)


def export_character(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        if obj.type in {"MESH", "ARMATURE", "EMPTY"}:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_skins=True,
        export_morph=False,
        export_yup=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_optimize_animation_size=True,
    )


def glb_stats(path: Path) -> dict[str, object]:
    data = path.read_bytes()
    json_length = int.from_bytes(data[12:16], "little")
    document = json.loads(data[20 : 20 + json_length].decode("utf8").rstrip(" \x00"))
    triangles = 0
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            accessor = primitive.get("indices")
            if accessor is not None:
                triangles += document["accessors"][accessor].get("count", 0) // 3
    return {
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "meshes": len(document.get("meshes", [])),
        "triangles": triangles,
        "skins": len(document.get("skins", [])),
        "animations": [animation.get("name", "") for animation in document.get("animations", [])],
        "embeddedTextures": len(document.get("images", [])),
    }


def validate_sources(source_root: Path) -> None:
    for name, expected in SOURCE_HASHES.items():
        path = source_root / f"{name}.glb"
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != expected:
            raise RuntimeError(f"Unexpected source hash for {path}: {actual}")


def update_manifest(output_root: Path, entries: list[dict[str, object]]) -> None:
    path = output_root / "manifest.json"
    manifest = json.loads(path.read_text("utf8"))
    replacements = {entry["id"]: entry for entry in entries}
    manifest["assets"] = [replacements.get(asset["id"], asset) for asset in manifest["assets"]]
    if set(replacements) != {asset["id"] for asset in manifest["assets"] if asset["kind"] == "humanoid"}:
        raise RuntimeError("Manifest humanoid roster does not match the Blender build")
    manifest["generator"] = "tools/generate_3d_assets.py + tools/build_character_roster.py"
    manifest["license"] = "Mixed: project-original assets and KayKit Adventurers 1.0 (CC0 1.0)"
    manifest["sources"] = [
        {
            "name": "KayKit Adventurers 1.0",
            "author": "Kay Lousberg",
            "license": "CC0 1.0 Universal",
            "url": "https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0",
            "scope": "adapted humanoid topology, rigs, animations, clothing and equipment",
        }
    ]
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf8")


def main() -> None:
    args = arguments()
    output_root = Path(args.output).resolve()
    source_root = Path(args.source).resolve()
    validate_sources(source_root)
    entries: list[dict[str, object]] = []

    for race, style in RACES.items():
        for gender in GENDERS:
            for archetype in ARCHETYPES:
                clear_blender()
                base, rig = prepare_base(source_root, race, gender, archetype)
                trim_animations(rig, base, archetype)
                recolor_and_pack_textures(output_root, base, race, gender, archetype)
                if style.signature == "ears":
                    add_elf_ears(rig, style.skin_srgb)
                elif style.signature == "tusks":
                    add_orc_tusks(rig)
                rig.scale = style.scale
                output_path = output_root / "humanoids" / race / f"{gender}-{archetype}.glb"
                export_character(output_path)
                stats = glb_stats(output_path)
                asset_id = f"humanoid.{race}.{gender}.{archetype}"
                if sorted(stats["animations"]) != ["attack", "cast", "death", "hit", "idle", "run"]:
                    raise RuntimeError(f"{asset_id}: animation export contract failed: {stats['animations']}")
                entries.append(
                    {
                        "id": asset_id,
                        "kind": "humanoid",
                        "race": race,
                        "gender": gender,
                        "archetype": archetype,
                        "url": f"./humanoids/{race}/{gender}-{archetype}.glb",
                        "scale": 1.0,
                        "source": "KayKit Adventurers 1.0 (CC0), modified",
                        "stats": stats,
                    }
                )
                print(
                    f"[neivara-roster] {asset_id}: {stats['bytes']} bytes, "
                    f"{stats['triangles']} triangles, {stats['meshes']} meshes"
                )

    update_manifest(output_root, entries)
    print(f"[neivara-roster] wrote {len(entries)} production character variants")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)

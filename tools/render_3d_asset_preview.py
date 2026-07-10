"""Render one or more generated GLBs for visual QA (not used at runtime)."""

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--spacing", type=float, default=2.6)
    parser.add_argument("inputs", nargs="+")
    return parser.parse_args(values)


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def main():
    args = parse_args()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    model_objects = []
    count = len(args.inputs)
    for index, source in enumerate(args.inputs):
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(Path(source).resolve()))
        imported = [obj for obj in bpy.context.scene.objects if obj not in before]
        offset = (index - (count - 1) / 2) * args.spacing
        roots = [obj for obj in imported if obj.parent is None]
        for root in roots:
            root.location.x += offset
        model_objects.extend(obj for obj in imported if obj.type == "MESH")

    # Authored preview plinth (only a QA backdrop; never exported as a game asset).
    width = max(5.5, count * args.spacing + 1.5)
    verts = [(-width/2,-1.1,0),(width/2,-1.1,0),(width/2,1.1,0),(-width/2,1.1,0),(-width/2,-1.1,-.16),(width/2,-1.1,-.16),(width/2,1.1,-.16),(-width/2,1.1,-.16)]
    faces = [(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]
    mesh = bpy.data.meshes.new("Preview plinth geometry")
    mesh.from_pydata(verts, [], faces)
    plinth = bpy.data.objects.new("Preview plinth", mesh)
    bpy.context.collection.objects.link(plinth)
    mat = bpy.data.materials.new("Preview slate")
    mat.diffuse_color = (.035,.055,.07,1)
    mat.metallic = .25
    mat.roughness = .44
    plinth.data.materials.append(mat)

    world = bpy.context.scene.world or bpy.data.worlds.new("Preview world")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.012,.022,.032,1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = .33

    for name, location, energy, color, size in (
        ("Key", (-4,-5,7), 1250, (0.84,0.93,1.0), 4.0),
        ("Rim", (5,2,5), 980, (0.3,0.7,1.0), 3.0),
        ("Warm fill", (0,-1,2), 520, (1.0,0.54,0.25), 2.4),
    ):
        data=bpy.data.lights.new(name,"AREA"); data.energy=energy; data.color=color; data.shape="DISK"; data.size=size
        light=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(light); light.location=location; look_at(light,(0,0,1.2))

    camera_data=bpy.data.cameras.new("Preview camera")
    camera=bpy.data.objects.new("Preview camera",camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.view_layer.update()
    bounds=[]
    for obj in model_objects:
        bounds.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    min_x=min(point.x for point in bounds); max_x=max(point.x for point in bounds)
    min_z=min(point.z for point in bounds); max_z=max(point.z for point in bounds)
    center=((min_x+max_x)/2,0,(min_z+max_z)/2)
    camera_data.type="ORTHO"
    # Imported GLBs can contain armature roots whose evaluated bounds lag one
    # update behind their children. The generous review margin guarantees that
    # weapons, wings and outermost models are never cropped from contact sheets.
    camera_data.ortho_scale=max((max_z-min_z)*1.85,(max_x-min_x)/(1600/720)*3.0)
    camera.location=(center[0],-max(9.0,width*.80),center[2]+.12)
    look_at(camera,center)
    bpy.context.scene.camera=camera

    scene=bpy.context.scene
    scene.render.engine="BLENDER_EEVEE_NEXT"
    scene.render.resolution_x=1600
    scene.render.resolution_y=720
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"
    scene.render.filepath=str(Path(args.output).resolve())
    scene.render.film_transparent=False
    scene.render.image_settings.color_mode="RGBA"
    scene.view_settings.look="AgX - Medium High Contrast"
    scene.render.resolution_percentage=100
    scene.frame_set(1)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()

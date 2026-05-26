#!/usr/bin/env python3
"""
ALP Character Auto-Rigger (Blender headless)
Usage:
  blender --background --python rig_character.py -- <input.fbx> <output.fbx> <markers_json>

markers_json:
  {"chin":[x,y,z],"leftWrist":[x,y,z],"rightWrist":[x,y,z],
   "leftElbow":[x,y,z],"rightElbow":[x,y,z],
   "leftKnee":[x,y,z],"rightKnee":[x,y,z],"groin":[x,y,z]}
"""
import bpy, sys, json, os, math
from mathutils import Vector

# ── 유틸 ───────────────────────────────────────────────────────
def lv(a, b, t):
    return a + (b - a) * t

def get_args():
    argv = sys.argv
    idx = argv.index("--") + 1
    return argv[idx:]

# ── 씬 초기화 ──────────────────────────────────────────────────
def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

# ── 메시 임포트 ────────────────────────────────────────────────
def import_mesh(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        raise ValueError(f"Unsupported: {ext}")
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if not meshes:
        raise RuntimeError("No mesh found")
    # 가장 큰 메시 선택
    return max(meshes, key=lambda o: len(o.data.vertices))

# ── 마커 → 본 위치 계산 ────────────────────────────────────────
def compute_bones(m):
    chin        = Vector(m['chin'])
    lw          = Vector(m['leftWrist'])
    rw          = Vector(m['rightWrist'])
    le          = Vector(m['leftElbow'])
    re          = Vector(m['rightElbow'])
    lk          = Vector(m['leftKnee'])
    rk          = Vector(m['rightKnee'])
    groin       = Vector(m['groin'])

    up          = (chin - groin).normalized()
    h           = (chin - groin).length
    cx          = (groin.x + chin.x) * 0.5
    cy          = (groin.y + chin.y) * 0.5

    hips        = groin.copy()
    spine       = lv(hips, chin, 0.20)
    spine1      = lv(hips, chin, 0.45)
    spine2      = lv(hips, chin, 0.72)
    neck        = lv(hips, chin, 0.92)
    head        = chin + up * h * 0.12

    ls          = Vector([le.x * 0.45 + cx * 0.55, cy, spine2.z])
    rs          = Vector([re.x * 0.45 + cx * 0.55, cy, spine2.z])

    leg_ox      = abs(lk.x - cx) * 0.8
    lul         = Vector([cx - leg_ox, cy, hips.z - h * 0.02])
    rul         = Vector([cx + leg_ox, cy, hips.z - h * 0.02])

    lf          = Vector([lk.x, cy, lk.z * 0.10])
    rf          = Vector([rk.x, cy, rk.z * 0.10])
    toe_len     = h * 0.06
    lt          = lf + Vector([0, toe_len, -0.01])
    rt          = rf + Vector([0, toe_len, -0.01])

    # (head_pos, parent)
    return [
        ('Hips',          hips,  None),
        ('Spine',         spine, 'Hips'),
        ('Spine1',        spine1,'Spine'),
        ('Spine2',        spine2,'Spine1'),
        ('Neck',          neck,  'Spine2'),
        ('Head',          head,  'Neck'),
        ('LeftShoulder',  ls,    'Spine2'),
        ('LeftArm',       ls,    'LeftShoulder'),
        ('LeftForeArm',   le,    'LeftArm'),
        ('LeftHand',      lw,    'LeftForeArm'),
        ('RightShoulder', rs,    'Spine2'),
        ('RightArm',      rs,    'RightShoulder'),
        ('RightForeArm',  re,    'RightArm'),
        ('RightHand',     rw,    'RightForeArm'),
        ('LeftUpLeg',     lul,   'Hips'),
        ('LeftLeg',       lk,    'LeftUpLeg'),
        ('LeftFoot',      lf,    'LeftLeg'),
        ('LeftToeBase',   lt,    'LeftFoot'),
        ('RightUpLeg',    rul,   'Hips'),
        ('RightLeg',      rk,    'RightUpLeg'),
        ('RightFoot',     rf,    'RightLeg'),
        ('RightToeBase',  rt,    'RightFoot'),
    ]

# ── Armature 생성 ──────────────────────────────────────────────
def create_armature(bone_list):
    arm_data = bpy.data.armatures.new('Armature')
    arm_obj  = bpy.data.objects.new('Armature', arm_data)
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj

    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm_data.edit_bones
    created = {}

    for name, head_pos, parent_name in bone_list:
        b = eb.new(name)
        b.head = head_pos
        b.tail = head_pos + Vector([0, 0, 0.05])  # 임시 tail
        if parent_name and parent_name in created:
            b.parent = created[parent_name]
            b.use_connect = False
        created[name] = b

    # tail → 자식 head로 업데이트
    for name, head_pos, parent_name in bone_list:
        if parent_name and parent_name in created:
            created[parent_name].tail = head_pos

    bpy.ops.object.mode_set(mode='OBJECT')
    return arm_obj

# ── 자동 웨이트 ────────────────────────────────────────────────
def apply_weights(mesh_obj, arm_obj):
    bpy.ops.object.select_all(action='DESELECT')
    mesh_obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')

# ── FBX 내보내기 ───────────────────────────────────────────────
def export_fbx(out_path):
    bpy.ops.export_scene.fbx(
        filepath=out_path,
        use_selection=False,
        add_leaf_bones=False,
        bake_anim=False,
        use_armature_deform_only=True,
        axis_forward='-Z',
        axis_up='Y',
    )

# ── 메인 ───────────────────────────────────────────────────────
def main():
    args = get_args()
    inp, out, markers_json = args[0], args[1], args[2]
    markers = json.loads(markers_json)

    print(f"[rig] input={inp}")
    clear_scene()
    mesh_obj   = import_mesh(inp)
    bone_list  = compute_bones(markers)
    arm_obj    = create_armature(bone_list)
    apply_weights(mesh_obj, arm_obj)
    export_fbx(out)
    print(f"[rig] done → {out}")

main()

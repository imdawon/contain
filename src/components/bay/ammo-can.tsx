import {
  CuboidCollider,
  RigidBody,
  useFixedJoint,
  useRapier,
  useRevoluteJoint,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { cooks } from "@/lib/bay/cook";
import { CAN } from "@/lib/bay/parts";
import { note, registerBody, setBodyMass, unregisterBody } from "@/lib/bay/probe";
import { playEvent } from "@/lib/contain/audio";
import { useBay } from "@/store/bay-store";
import { useGrab } from "@/components/bay/grab";
import { useEffect } from "react";
import * as THREE from "three";

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _toCam = new THREE.Vector3();

type FaceName = "floor" | "left" | "right" | "back" | "front" | "lid";

const FACE_DEFS: { name: FaceName; n: [number, number, number]; p: [number, number, number]; lid?: boolean }[] = [
  { name: "floor", n: [0, -1, 0], p: [0, -CAN.h / 2, 0] },
  { name: "left", n: [-1, 0, 0], p: [-CAN.w / 2, 0, 0] },
  { name: "right", n: [1, 0, 0], p: [CAN.w / 2, 0, 0] },
  { name: "back", n: [0, 0, -1], p: [0, 0, -CAN.d / 2] },
  { name: "front", n: [0, 0, 1], p: [0, 0, CAN.d / 2] },
  { name: "lid", n: [0, 1, 0], p: [0, 0, 0], lid: true },
];

function ghost(mesh: THREE.Mesh | null, on: boolean) {
  if (!mesh) return;
  const mat = mesh.material;
  if (!Array.isArray(mat) && "opacity" in mat) {
    const m = mat as THREE.MeshStandardMaterial;
    m.transparent = on;
    m.opacity = on ? 0.18 : 1;
    m.depthWrite = !on;
    m.needsUpdate = true;
  }
}

const Q = [0, 0, 0, 1] as [number, number, number, number];

export function AmmoCan({ id, pos }: { id: string; pos: [number, number, number] }) {
  const body = useRef<RapierRigidBody>(null!);
  const lid = useRef<RapierRigidBody>(null!);
  const { world } = useRapier();
  const grabBody = useGrab(body, id);
  const grabLid = useGrab(lid, `${id}-lid`);
  const pressure = useRef(0);
  const latchGone = useRef(false);
  const hingeGone = useRef(false);
  const ventOnce = useRef(false);
  const massPinned = useRef(false);
  const cutaway = useBay((s) => s.cutaway);
  const faces = useRef<Record<FaceName, THREE.Mesh | null>>({
    floor: null,
    left: null,
    right: null,
    back: null,
    front: null,
    lid: null,
  });
  const ghosted = useRef<FaceName | null>(null);

  const { w, h, d, wall: t, lid: lh } = CAN;
  const bodyY = h / 2;
  const lidY = h + lh / 2;

  const hinge = useRevoluteJoint(body, lid, [
    [0, h / 2, -d / 2],
    [0, -lh / 2, -d / 2],
    [1, 0, 0],
    CAN.open,
  ]);
  const latch = useFixedJoint(body, lid, [
    [0, h / 2, d / 2],
    Q,
    [0, -lh / 2, d / 2],
    Q,
  ]);

  useEffect(() => {
    const sample = (ref: { current: RapierRigidBody | null }, extra: () => Record<string, string | number | boolean | null>) => () => {
      const rb = ref.current;
      if (!rb) return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, state: { missing: true } };
      const p = rb.translation();
      const r = rb.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      _e.setFromQuaternion(_q);
      return { x: p.x, y: p.y, z: p.z, rx: _e.x, ry: _e.y, rz: _e.z, state: extra() };
    };
    registerBody(
      id,
      "can-body",
      sample(body, () => ({
        pressure: Math.round(pressure.current * 100) / 100,
        cutaway: ghosted.current,
      })),
      () => body.current,
    );
    registerBody(
      `${id}-lid`,
      "can-lid",
      sample(lid, () => ({
        latch: latchGone.current ? (hingeGone.current ? "free" : "hinged") : "sealed",
        pressure: Math.round(pressure.current * 100) / 100,
      })),
      () => lid.current,
    );
    const part = (suffix: string, kind: string, local: [number, number, number]) => {
      registerBody(`${id}-${suffix}`, kind, () => {
        const rb = body.current;
        if (!rb) return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, state: { missing: true, parent: id } };
        const p = rb.translation();
        const r = rb.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        _e.setFromQuaternion(_q);
        _v.set(local[0], local[1], local[2]).applyQuaternion(_q);
        return {
          x: p.x + _v.x,
          y: p.y + _v.y,
          z: p.z + _v.z,
          rx: _e.x,
          ry: _e.y,
          rz: _e.z,
          state: { missing: false, parent: id },
        };
      });
    };
    part("hinge", "can-hinge", [0, h / 2, -d / 2]);
    part("latch", "can-latch", [0, h / 2, d / 2]);
    return () => {
      unregisterBody(id);
      unregisterBody(`${id}-lid`);
      unregisterBody(`${id}-hinge`);
      unregisterBody(`${id}-latch`);
    };
  }, [id]);

  useFrame((state, dt) => {
    const cap = Math.min(dt, 0.05);
    grabBody.tick(state.raycaster.ray, cap);
    grabLid.tick(state.raycaster.ray, cap);
    const b = body.current;
    const l = lid.current;
    if (!b || !l) return;
    if (!massPinned.current) {
      setBodyMass(b, CAN.bodyMass);
      setBodyMass(l, CAN.lidMass);
      massPinned.current = true;
    }
    const bp = b.translation();

    let gas = 0;
    let boomHit = false;
    for (const c of cooks.values()) {
      const p = c.pos;
      if (!p) continue;
      const inside =
        Math.abs(p[0] - bp.x) < w / 2 - 0.02 &&
        p[1] > bp.y - h / 2 &&
        p[1] < bp.y + h / 2 + 0.12 &&
        Math.abs(p[2] - bp.z) < d / 2 - 0.02;
      if (!inside) continue;
      if (c.phase === "cook" || c.phase === "boom") gas += c.kW * 0.12;
      if (c.phase === "boom") boomHit = true;
    }

    if (!latchGone.current) {
      pressure.current += gas * cap;
      if (boomHit && !ventOnce.current) {
        ventOnce.current = true;
        pressure.current += 1.6;
      }
    } else if (!hingeGone.current && gas > 0) {
      l.applyTorqueImpulse({ x: -gas * cap * 0.06, y: 0, z: 0 }, true);
    }

    if (!latchGone.current && pressure.current >= CAN.latch && latch.current) {
      latchGone.current = true;
      world.removeImpulseJoint(latch.current, true);
      useBay.getState().setLatch("hinged");
      note("latch-break", { id, pressure: pressure.current, lidY: l.translation().y });
      playEvent("lid", "nmc");
      l.applyTorqueImpulse({ x: -1.8, y: 0, z: 0 }, true);
    }

    let pick: FaceName | null = null;
    if (cutaway) {
      let best = -Infinity;
      const cam = state.camera.position;
      for (const f of FACE_DEFS) {
        const rb = f.lid ? l : b;
        const r = rb.rotation();
        const t = rb.translation();
        _q.set(r.x, r.y, r.z, r.w);
        _n.set(f.n[0], f.n[1], f.n[2]).applyQuaternion(_q);
        _p.set(f.p[0], f.p[1], f.p[2]).applyQuaternion(_q);
        _p.x += t.x;
        _p.y += t.y;
        _p.z += t.z;
        const score = _n.dot(_toCam.subVectors(cam, _p).normalize());
        if (score > best) {
          best = score;
          pick = f.name;
        }
      }
    }
    if (pick !== ghosted.current) {
      if (ghosted.current) ghost(faces.current[ghosted.current], false);
      ghosted.current = pick;
    }
    if (pick) ghost(faces.current[pick], true);

    if (latchGone.current && !hingeGone.current && boomHit && pressure.current >= CAN.hinge && hinge.current) {
      hingeGone.current = true;
      world.removeImpulseJoint(hinge.current, true);
      useBay.getState().setLatch("free");
      note("hinge-break", { id, pressure: pressure.current });
      playEvent("burst", "nmc");
      l.applyImpulse({ x: (Math.random() - 0.5) * 0.4, y: 0.6, z: (Math.random() - 0.5) * 0.4 }, true);
    }
  });

  const olive = 0x7a8458;
  const oliveLid = 0x8a9466;

  return (
    <group position={pos}>
      <RigidBody
        ref={body}
        position={[0, bodyY, 0]}
        colliders={false}
        mass={CAN.bodyMass}
        friction={0.7}
        restitution={0.06}
        linearDamping={1.4}
        angularDamping={1.4}
        ccd
      >
        <CuboidCollider args={[w / 2, t / 2, d / 2]} position={[0, -h / 2 + t / 2, 0]} />
        <CuboidCollider args={[t / 2, h / 2, d / 2]} position={[-w / 2 + t / 2, 0, 0]} />
        <CuboidCollider args={[t / 2, h / 2, d / 2]} position={[w / 2 - t / 2, 0, 0]} />
        <CuboidCollider args={[w / 2, h / 2, t / 2]} position={[0, 0, -d / 2 + t / 2]} />
        <CuboidCollider args={[w / 2, h / 2, t / 2]} position={[0, 0, d / 2 - t / 2]} />
        <group onPointerDown={grabBody.down}>
          <mesh ref={(el) => { faces.current.floor = el; }} position={[0, -h / 2 + t / 2, 0]}>
            <boxGeometry args={[w, t, d]} />
            <meshStandardMaterial color={olive} metalness={0.45} roughness={0.5} />
          </mesh>
          <mesh ref={(el) => { faces.current.left = el; }} position={[-w / 2 + t / 2, 0, 0]}>
            <boxGeometry args={[t, h, d]} />
            <meshStandardMaterial color={olive} metalness={0.45} roughness={0.5} />
          </mesh>
          <mesh ref={(el) => { faces.current.right = el; }} position={[w / 2 - t / 2, 0, 0]}>
            <boxGeometry args={[t, h, d]} />
            <meshStandardMaterial color={olive} metalness={0.45} roughness={0.5} />
          </mesh>
          <mesh ref={(el) => { faces.current.back = el; }} position={[0, 0, -d / 2 + t / 2]}>
            <boxGeometry args={[w, h, t]} />
            <meshStandardMaterial color={olive} metalness={0.45} roughness={0.5} />
          </mesh>
          <mesh ref={(el) => { faces.current.front = el; }} position={[0, 0, d / 2 - t / 2]}>
            <boxGeometry args={[w, h, t]} />
            <meshStandardMaterial color={olive} metalness={0.45} roughness={0.5} />
          </mesh>
        </group>
      </RigidBody>

      <RigidBody
        ref={lid}
        position={[0, lidY, 0]}
        colliders="cuboid"
        mass={CAN.lidMass}
        friction={0.4}
        restitution={0.1}
        linearDamping={0.8}
        angularDamping={0.9}
      >
        <mesh
          ref={(el) => {
            faces.current.lid = el;
          }}
          onPointerDown={grabLid.down}
        >
          <boxGeometry args={[w + 0.02, lh, d + 0.02]} />
          <meshStandardMaterial color={oliveLid} metalness={0.5} roughness={0.42} />
        </mesh>
        <mesh position={[0, lh / 2 + 0.012, 0]}>
          <boxGeometry args={[0.14, 0.02, 0.06]} />
          <meshStandardMaterial color={0xb8bcae} metalness={0.8} roughness={0.25} />
        </mesh>
      </RigidBody>
    </group>
  );
}

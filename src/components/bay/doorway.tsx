import {
  CuboidCollider,
  RigidBody,
  interactionGroups,
  useFixedJoint,
  useRapier,
  useRevoluteJoint,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useGrab } from "@/components/bay/grab";
import { markCover } from "@/lib/bay/cover";
import { COVER_G, CRATE_G, DUMMY_G, WORLD_G } from "@/lib/bay/groups";
import { DOOR } from "@/lib/bay/parts";
import { note, registerAssembly, registerBody, setBodyMass, unregisterAssembly, unregisterBody } from "@/lib/bay/probe";
import { playEvent } from "@/lib/contain/audio";
import { useBay } from "@/store/bay-store";

const Q = [0, 0, 0, 1] as [number, number, number, number];
const GROUPS = interactionGroups([WORLD_G, COVER_G], [WORLD_G, DUMMY_G, CRATE_G, COVER_G]);
const frameCol = 0x6a655c;
const panelCol = 0x5c5348;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

export function Doorway({ id, pos }: { id: string; pos: [number, number, number] }) {
  const frame = useRef<RapierRigidBody>(null!);
  const panel = useRef<RapierRigidBody>(null!);
  const { world } = useRapier();
  const grabFrame = useGrab(frame, id);
  const grabPanel = useGrab(panel, `${id}-panel`);
  const latchGone = useRef(false);
  const hingeGone = useRef(false);
  const massPinned = useRef(false);
  const tagged = useRef(false);
  const contactsOff = useRef(false);
  const selected = useBay((s) => s.selected === id || s.selected === `${id}-panel`);
  const { openW, h, frameT: t, depth, panelT, frameMass, panelMass } = DOOR;
  const jambX = openW / 2 + t / 2;
  const lintelY = h / 2 - t / 2;

  const hinge = useRevoluteJoint(frame, panel, [
    [-openW / 2, 0, 0],
    [-openW / 2, 0, 0],
    [0, 1, 0],
    DOOR.open,
  ]);
  const latch = useFixedJoint(frame, panel, [
    [openW / 2, 0, 0],
    Q,
    [openW / 2, 0, 0],
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
    registerBody(id, "door-frame", sample(frame, () => ({ cover: true, latch: latchGone.current ? (hingeGone.current ? "free" : "hinged") : "sealed" })), () => frame.current);
    registerBody(
      `${id}-panel`,
      "door-panel",
      sample(panel, () => ({
        cover: true,
        latch: latchGone.current ? (hingeGone.current ? "free" : "hinged") : "sealed",
      })),
      () => panel.current,
    );
    const part = (suffix: string, kind: string, local: [number, number, number]) => {
      registerBody(`${id}-${suffix}`, kind, () => {
        const rb = frame.current;
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
    part("hinge", "door-hinge", [-openW / 2, 0, 0]);
    part("latch", "door-latch", [openW / 2, 0, 0]);
    registerAssembly(id, [id, `${id}-panel`]);
    return () => {
      unregisterAssembly(id);
      unregisterBody(id);
      unregisterBody(`${id}-panel`);
      unregisterBody(`${id}-hinge`);
      unregisterBody(`${id}-latch`);
    };
  }, [id, openW]);

  useEffect(() => {
    const onBlast = (ev: Event) => {
      const { x, y, z, power } = (ev as CustomEvent<{ x: number; y: number; z: number; power: number }>).detail;
      const f = frame.current;
      if (!f || power < 4) return;
      const p = f.translation();
      const dist = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (dist > 2.6) return;
      const dump = (power * 0.4) / Math.max(0.22, dist);
      const l = panel.current;
      if (!latchGone.current && dump >= DOOR.latch && latch.current) {
        latchGone.current = true;
        world.removeImpulseJoint(latch.current, true);
        useBay.getState().setLatch("hinged");
        note("latch-break", { id, dist, dump, via: "door" });
        playEvent("lid", "nmc");
        l?.applyTorqueImpulse({ x: 0, y: dump * 0.35, z: 0 }, true);
      }
      if (latchGone.current && !hingeGone.current && dump >= DOOR.hinge && hinge.current) {
        hingeGone.current = true;
        unregisterAssembly(id);
        world.removeImpulseJoint(hinge.current, true);
        useBay.getState().setLatch("free");
        note("hinge-break", { id, dist, dump, via: "door" });
        playEvent("burst", "nmc");
      }
    };
    window.addEventListener("bay-blast", onBlast);
    return () => window.removeEventListener("bay-blast", onBlast);
  }, [id, world, hinge, latch]);

  useFrame((state, dt) => {
    const cap = Math.min(dt, 0.05);
    grabFrame.tick(state.raycaster.ray, cap);
    grabPanel.tick(state.raycaster.ray, cap);
    const f = frame.current;
    const l = panel.current;
    if (!f || !l) return;
    if (!tagged.current) {
      markCover(f, "doorway");
      markCover(l, "doorway");
      tagged.current = true;
    }
    if (!contactsOff.current) {
      hinge.current?.setContactsEnabled(false);
      latch.current?.setContactsEnabled(false);
      contactsOff.current = true;
    }
    if (!massPinned.current) {
      setBodyMass(f, frameMass);
      setBodyMass(l, panelMass);
      massPinned.current = true;
    }
  });

  const panelH = h - t - 0.04;
  const panelW = openW - 0.03;

  return (
    <group position={pos}>
      <RigidBody
        ref={frame}
        position={[0, h / 2, 0]}
        colliders={false}
        type="kinematicPosition"
        mass={frameMass}
        friction={0.7}
        restitution={0.04}
        collisionGroups={GROUPS}
        ccd
      >
        <CuboidCollider args={[t / 2, h / 2, depth / 2]} position={[-jambX, 0, 0]} collisionGroups={GROUPS} />
        <CuboidCollider args={[t / 2, h / 2, depth / 2]} position={[jambX, 0, 0]} collisionGroups={GROUPS} />
        <CuboidCollider args={[(openW + 2 * t) / 2, t / 2, depth / 2]} position={[0, lintelY, 0]} collisionGroups={GROUPS} />
        <group onPointerDown={grabFrame.down}>
          <mesh position={[-jambX, 0, 0]}>
            <boxGeometry args={[t, h, depth]} />
            <meshStandardMaterial color={selected ? 0xd4d7cf : frameCol} roughness={0.82} metalness={0.06} />
          </mesh>
          <mesh position={[jambX, 0, 0]}>
            <boxGeometry args={[t, h, depth]} />
            <meshStandardMaterial color={selected ? 0xd4d7cf : frameCol} roughness={0.82} metalness={0.06} />
          </mesh>
          <mesh position={[0, lintelY, 0]}>
            <boxGeometry args={[openW + 2 * t, t, depth]} />
            <meshStandardMaterial color={selected ? 0xd4d7cf : frameCol} roughness={0.82} metalness={0.06} />
          </mesh>
        </group>
      </RigidBody>

      <RigidBody
        ref={panel}
        position={[0, h / 2, 0]}
        colliders={false}
        mass={panelMass}
        friction={0.45}
        restitution={0.06}
        linearDamping={0.55}
        angularDamping={0.7}
        collisionGroups={GROUPS}
        ccd
      >
        <CuboidCollider args={[panelW / 2, panelH / 2, panelT / 2]} collisionGroups={GROUPS} />
        <mesh onPointerDown={grabPanel.down}>
          <boxGeometry args={[panelW, panelH, panelT]} />
          <meshStandardMaterial color={selected ? 0xd4d7cf : panelCol} roughness={0.78} metalness={0.08} />
        </mesh>
      </RigidBody>
    </group>
  );
}

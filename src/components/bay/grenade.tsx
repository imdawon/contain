import { BallCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { cooks, startCook } from "@/lib/bay/cook";
import { clearHeat, pulseHeat, setHeat } from "@/lib/bay/heat";
import { GRENADE } from "@/lib/bay/parts";
import { playEvent, reportFire } from "@/lib/contain/audio";
import { note, registerBody, setBodyMass, unregisterBody } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";
import { JetFire } from "@/components/bay/fx";
import { useGrab } from "@/components/bay/grab";
import type { Texture } from "three";
import * as THREE from "three";

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const olive = 0x4d5a38;
const oliveDark = 0x3a442c;
const brass = 0xb08a3c;
const spoonCol = 0x6a734c;

type Frag = { key: string; pos: [number, number, number]; vel: [number, number, number]; size: number };

function FragBit({ id, pos, vel, size }: Frag & { id: string }) {
  const r = useRef<RapierRigidBody>(null);
  const kicked = useRef(false);
  useEffect(() => {
    registerBody(
      id,
      "frag",
      () => {
        const b = r.current;
        if (!b) return { x: pos[0], y: pos[1], z: pos[2], rx: 0, ry: 0, rz: 0, state: { missing: true } };
        const p = b.translation();
        return { x: p.x, y: p.y, z: p.z, rx: 0, ry: 0, rz: 0, state: { missing: false } };
      },
      () => r.current,
    );
    return () => unregisterBody(id);
  }, [id, pos]);
  useFrame(() => {
    const b = r.current;
    if (!b || kicked.current) return;
    b.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
    b.setAngvel({ x: vel[2] * 2, y: vel[0] * 2, z: vel[1] * 2 }, true);
    kicked.current = true;
  });
  return (
    <RigidBody ref={r} position={pos} colliders="cuboid" mass={0.04} friction={0.7} restitution={0.12} linearDamping={0.18} angularDamping={0.22} ccd>
      <mesh>
        <boxGeometry args={[size, size * 0.7, size * 0.5]} />
        <meshStandardMaterial color={oliveDark} roughness={0.7} metalness={0.25} />
      </mesh>
    </RigidBody>
  );
}

export function Grenade({
  id,
  pos,
  rot,
  fireMap,
}: {
  id: string;
  pos: [number, number, number];
  rot?: [number, number, number];
  fireMap: Texture;
}) {
  const body = useRef<RapierRigidBody>(null);
  const boomOnce = useRef(false);
  const pinOnce = useRef(false);
  const tickAcc = useRef(0);
  const massPinned = useRef(false);
  const spoon = useRef<THREE.Mesh>(null);
  const selected = useBay((s) => s.selected === id);
  const grab = useGrab(body, id);
  const [frags, setFrags] = useState<Frag[]>([]);
  const [gone, setGone] = useState(false);
  const [armed, setArmed] = useState(false);
  const grooves = useMemo(() => [-0.028, -0.01, 0.008, 0.026], []);

  useEffect(() => {
    registerBody(
      id,
      "grenade",
      () => {
        const b = body.current;
        const c = cooks.get(id);
        if (!b) {
          return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, state: { missing: true, cook: "idle", kW: 0, t: 0, pin: 1 } };
        }
        const p = b.translation();
        const r = b.rotation();
        _q.set(r.x, r.y, r.z, r.w);
        _e.setFromQuaternion(_q);
        return {
          x: p.x,
          y: p.y,
          z: p.z,
          rx: _e.x,
          ry: _e.y,
          rz: _e.z,
          state: {
            missing: false,
            cook: c?.phase ?? "idle",
            kW: c ? Math.round(c.kW * 100) / 100 : 0,
            t: c ? Math.round(c.t * 100) / 100 : 0,
            pin: armed || c ? 0 : 1,
          },
        };
      },
      () => body.current,
    );
    return () => {
      unregisterBody(id);
      clearHeat(id);
      reportFire(id, 0, 0);
    };
  }, [id, armed]);

  useFrame((state, dt) => {
    const cap = Math.min(dt, 0.05);
    grab.tick(state.raycaster.ray, cap);
    const b = body.current;
    if (!b) return;
    if (!massPinned.current) {
      setBodyMass(b, GRENADE.mass);
      massPinned.current = true;
    }
    const cook = cooks.get(id);
    const p0 = b.translation();
    if (cook && cook.phase !== "dead") {
      setHeat(id, {
        x: p0.x,
        y: p0.y,
        z: p0.z,
        kW: cook.phase === "boom" ? 36 : 1.2,
      });
    } else {
      clearHeat(id);
    }
    if (cook && !pinOnce.current) {
      pinOnce.current = true;
      setArmed(true);
      playEvent("pin", "nmc");
    }
    if (spoon.current) {
      spoon.current.rotation.z = cook ? -1.15 : 0.12;
    }
    if (!cook || cook.phase === "dead") {
      if (cook?.phase === "dead") reportFire(id, 0, 0);
      return;
    }
    const p = b.translation();
    cook.pos = [p.x, p.y, p.z];
    if (cook.phase === "cook") {
      tickAcc.current += cap;
      if (tickAcc.current > 0.28) {
        tickAcc.current = 0;
        playEvent("tick", "nmc");
      }
      reportFire(id, 0.08, 0.04);
    }
    if (cook.phase === "boom" && !boomOnce.current) {
      boomOnce.current = true;
      pulseHeat(`${id}-blast`, { x: p.x, y: p.y, z: p.z, kW: 40 }, 2.8);
      const bits: Frag[] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + i * 0.07;
        const sp = 3.2 + (i % 3) * 0.7;
        bits.push({
          key: `${id}-frag-${i}`,
          pos: [p.x, p.y + 0.04, p.z],
          vel: [Math.cos(a) * sp, 2.1 + (i % 4) * 0.45, Math.sin(a) * sp],
          size: 0.026 + (i % 3) * 0.006,
        });
      }
      setFrags(bits);
      setGone(true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setEnabled(false);
      reportFire(id, 0.9, 1.2);
    }
  });

  function onDown(e: Parameters<typeof grab.down>[0]) {
    grab.down(e);
    if (useBay.getState().tool === "nail") {
      startCook(id, "frag", GRENADE.fuse, GRENADE.peak, GRENADE.boom);
      playEvent("puncture", "nmc");
      note("puncture", { id, via: "nail", kind: "grenade" });
    }
  }

  return (
    <>
      <RigidBody
        ref={body}
        position={pos}
        rotation={rot ?? [0, 0, 0]}
        colliders={false}
        mass={GRENADE.mass}
        restitution={0.12}
        friction={0.62}
        linearDamping={0.45}
        angularDamping={0.5}
        ccd
      >
        <BallCollider args={[GRENADE.radius]} />
        <group visible={!gone} onPointerDown={onDown}>
          <mesh castShadow>
            <sphereGeometry args={[GRENADE.radius, 18, 14]} />
            <meshStandardMaterial color={selected ? 0xd4d7cf : olive} roughness={0.62} metalness={0.18} />
          </mesh>
          {grooves.map((y) => (
            <mesh key={y} position={[0, y, 0]}>
              <torusGeometry args={[GRENADE.radius - 0.004, 0.004, 8, 20]} />
              <meshStandardMaterial color={oliveDark} roughness={0.7} metalness={0.12} />
            </mesh>
          ))}
          <mesh position={[0, GRENADE.radius + 0.018, 0]}>
            <cylinderGeometry args={[0.018, 0.022, 0.036, 10]} />
            <meshStandardMaterial color={oliveDark} roughness={0.5} metalness={0.3} />
          </mesh>
          <mesh ref={spoon} position={[0.028, GRENADE.radius + 0.01, 0]} rotation={[0, 0, 0.12]}>
            <boxGeometry args={[0.01, 0.07, 0.022]} />
            <meshStandardMaterial color={spoonCol} roughness={0.45} metalness={0.35} />
          </mesh>
          {!armed ? (
            <mesh position={[0.04, GRENADE.radius + 0.03, 0.016]} rotation={[0.4, 0.2, 0.6]}>
              <torusGeometry args={[0.016, 0.0035, 8, 14]} />
              <meshStandardMaterial color={brass} roughness={0.35} metalness={0.7} />
            </mesh>
          ) : null}
        </group>
        <JetFire cook={() => cooks.get(id)} map={fireMap} />
      </RigidBody>
      {frags.map((f) => (
        <FragBit key={f.key} id={f.key} pos={f.pos} vel={f.vel} size={f.size} />
      ))}
    </>
  );
}

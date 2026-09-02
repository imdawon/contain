import { CuboidCollider, CylinderCollider, RigidBody, interactionGroups, type RapierRigidBody } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useGrab } from "@/components/bay/grab";
import { CRATE_G, WAGON_G, WORLD_G } from "@/lib/bay/groups";
import { WAGON } from "@/lib/bay/parts";
import { registerBody, setBodyMass, unregisterBody } from "@/lib/bay/probe";
import { poseOf } from "@/lib/bay/sample";
import { useBay } from "@/store/bay-store";

const GROUPS = interactionGroups([WAGON_G], [WORLD_G, CRATE_G]);
const deckCol = 0x6a5340;
const iron = 0x3a3a38;
const spoke = 0x8a8478;

export function Wagon({
  id,
  pos,
  rot,
  grip,
  bounce,
  mass,
}: {
  id: string;
  pos: [number, number, number];
  rot?: [number, number, number];
  grip?: number;
  bounce?: number;
  mass?: number;
}) {
  const r = useRef<RapierRigidBody>(null);
  const visual = useRef<THREE.Group>(null);
  const grab = useGrab(r, id);
  const pinned = useRef(false);
  const selected = useBay((s) => s.selected === id);
  const [dw, dh, dd] = WAGON.deck;
  const kg = mass ?? WAGON.mass;
  const mu = grip ?? 0.22;
  const rest = bounce ?? 0.02;
  const wr = WAGON.wheelR;
  const wt = WAGON.wheelT;

  useEffect(() => {
    registerBody(id, "wagon", () => poseOf(r.current, { grip: mu, cart: true }), () => r.current, () => visual.current);
    return () => unregisterBody(id);
  }, [id, mu]);

  useFrame((state, dt) => {
    grab.tick(state.raycaster.ray, Math.min(dt, 0.05));
    const b = r.current;
    if (!b || pinned.current) return;
    setBodyMass(b, kg);
    pinned.current = true;
  });

  const axles: [number, number][] = [
    [-dw / 2 + 0.08, -dd / 2 + 0.16],
    [dw / 2 - 0.08, -dd / 2 + 0.16],
    [-dw / 2 + 0.08, dd / 2 - 0.16],
    [dw / 2 - 0.08, dd / 2 - 0.16],
  ];

  return (
    <RigidBody
      ref={r}
      position={pos}
      rotation={rot ?? [0, 0, 0]}
      colliders={false}
      mass={kg}
      friction={mu}
      restitution={rest}
      linearDamping={0.12}
      angularDamping={0.85}
      collisionGroups={GROUPS}
      ccd
    >
      {/* Deck sits above the axles so the hull is wheels, not a long box on the curve. */}
      <CuboidCollider args={[dw / 2, dh / 2, dd / 2]} position={[0, wr, 0]} collisionGroups={GROUPS} friction={mu} restitution={rest} />
      {axles.map(([x, z], i) => (
        <CylinderCollider key={`hub-${i}`} args={[wt / 2 + 0.01, wr]} rotation={[0, 0, Math.PI / 2]} position={[x, 0, z]} collisionGroups={GROUPS} friction={mu} restitution={rest} />
      ))}
      <group ref={visual}>
      <mesh onPointerDown={grab.down} position={[0, wr - dh / 2, 0]} frustumCulled={false}>
        <boxGeometry args={[dw, dh, dd]} />
        <meshStandardMaterial color={selected ? 0xd4d7cf : deckCol} roughness={0.82} metalness={0.06} />
      </mesh>
      <mesh position={[0, wr + 0.04, -dd / 2 + 0.04]} frustumCulled={false}>
        <boxGeometry args={[dw * 0.92, 0.16, 0.05]} />
        <meshStandardMaterial color={iron} roughness={0.55} metalness={0.28} />
      </mesh>
      <mesh position={[0, wr + 0.04, dd / 2 - 0.04]} frustumCulled={false}>
        <boxGeometry args={[dw * 0.92, 0.1, 0.05]} />
        <meshStandardMaterial color={iron} roughness={0.55} metalness={0.28} />
      </mesh>
      {axles.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]} rotation={[0, 0, Math.PI / 2]}>
          <mesh frustumCulled={false}>
            <cylinderGeometry args={[wr, wr, wt, 12]} />
            <meshStandardMaterial color={iron} roughness={0.48} metalness={0.32} />
          </mesh>
          <mesh frustumCulled={false}>
            <cylinderGeometry args={[wr * 0.35, wr * 0.35, wt + 0.02, 8]} />
            <meshStandardMaterial color={spoke} roughness={0.6} metalness={0.2} />
          </mesh>
        </group>
      ))}
      </group>
    </RigidBody>
  );
}

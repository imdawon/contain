import { CuboidCollider, RigidBody, interactionGroups, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import { CRATE_G, DUMMY_G, WAGON_G, WORLD_G } from "@/lib/bay/groups";
import { registerBody, unregisterBody } from "@/lib/bay/probe";
import { poseOf } from "@/lib/bay/sample";
import { useBay } from "@/store/bay-store";

const GROUPS = interactionGroups([WORLD_G], [WORLD_G, DUMMY_G, CRATE_G, WAGON_G]);
const dirt = 0xc9a15c;
const dirtHi = 0xe2c47a;
const dirtEdge = 0x6a4a2c;

export function Hill({
  id,
  pos,
  rot,
  size,
  grip,
}: {
  id: string;
  pos: [number, number, number];
  rot?: [number, number, number];
  size?: [number, number, number];
  grip?: number;
}) {
  const r = useRef<RapierRigidBody>(null);
  const selected = useBay((s) => s.selected === id);
  const [w, h, d] = size ?? [4, 0.4, 10];
  const mu = grip ?? 0.55;

  useEffect(() => {
    registerBody(
      id,
      "hill",
      () => poseOf(r.current, { hill: true, grip: mu, sx: w, sy: h, sz: d }),
      () => r.current,
    );
    return () => unregisterBody(id);
  }, [id, mu, w, h, d]);

  return (
    <RigidBody
      ref={r}
      type="fixed"
      position={pos}
      rotation={rot ?? [0, 0, 0]}
      colliders={false}
      friction={mu}
      restitution={0.02}
      collisionGroups={GROUPS}
    >
      <CuboidCollider args={[w / 2, h / 2, d / 2]} collisionGroups={GROUPS} friction={mu} restitution={0.02} />
      <mesh>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={selected ? 0xd4d7cf : dirt} roughness={0.9} metalness={0.03} />
      </mesh>
      <mesh position={[0, h / 2 + 0.008, 0]}>
        <boxGeometry args={[w * 0.98, 0.016, d * 0.98]} />
        <meshStandardMaterial color={dirtHi} roughness={0.92} metalness={0} />
      </mesh>
      <mesh position={[w / 2 + 0.004, 0, 0]}>
        <boxGeometry args={[0.03, h, d]} />
        <meshStandardMaterial color={dirtEdge} roughness={0.95} metalness={0} />
      </mesh>
      <mesh position={[-w / 2 - 0.004, 0, 0]}>
        <boxGeometry args={[0.03, h, d]} />
        <meshStandardMaterial color={dirtEdge} roughness={0.95} metalness={0} />
      </mesh>
    </RigidBody>
  );
}

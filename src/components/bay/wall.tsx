import { CuboidCollider, RigidBody, interactionGroups, type RapierRigidBody } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useGrab } from "@/components/bay/grab";
import { markCover } from "@/lib/bay/cover";
import { COVER_G, CRATE_G, DUMMY_G, WORLD_G } from "@/lib/bay/groups";
import { WALL } from "@/lib/bay/parts";
import { registerBody, setBodyMass, unregisterBody } from "@/lib/bay/probe";
import { poseOf } from "@/lib/bay/sample";
import { useBay } from "@/store/bay-store";

const GROUPS = interactionGroups([WORLD_G, COVER_G], [WORLD_G, DUMMY_G, CRATE_G, COVER_G]);
const concrete = 0x8a8478;

export function Wall({ id, pos }: { id: string; pos: [number, number, number] }) {
  const r = useRef<RapierRigidBody>(null);
  const grab = useGrab(r, id);
  const pinned = useRef(false);
  const tagged = useRef(false);
  const selected = useBay((s) => s.selected === id);
  const { w, h, d, mass } = WALL;

  useEffect(() => {
    registerBody(id, "wall", () => poseOf(r.current, { cover: true }), () => r.current);
    return () => unregisterBody(id);
  }, [id]);

  useFrame((state, dt) => {
    grab.tick(state.raycaster.ray, Math.min(dt, 0.05));
    const b = r.current;
    if (!b) return;
    if (!tagged.current) {
      markCover(b, "wall");
      tagged.current = true;
    }
    if (!pinned.current) {
      setBodyMass(b, mass);
      pinned.current = true;
    }
  });

  return (
    <group position={pos}>
      <RigidBody
        ref={r}
        position={[0, h / 2, 0]}
        colliders={false}
        mass={mass}
        friction={0.72}
        restitution={0.04}
        linearDamping={1.15}
        angularDamping={1.05}
        collisionGroups={GROUPS}
        ccd
      >
        <CuboidCollider args={[w / 2, h / 2, d / 2]} collisionGroups={GROUPS} />
        <mesh onPointerDown={grab.down}>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color={selected ? 0xd4d7cf : concrete} roughness={0.88} metalness={0.04} />
        </mesh>
      </RigidBody>
    </group>
  );
}

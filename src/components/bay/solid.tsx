import {
  BallCollider,
  CapsuleCollider,
  ConvexHullCollider,
  CuboidCollider,
  CylinderCollider,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useGrab } from "@/components/bay/grab";
import { note, registerBody, setBodyMass, unregisterBody } from "@/lib/bay/probe";
import { SOLID, type SolidShape } from "@/lib/bay/solids";
import { useBay } from "@/store/bay-store";

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

const HULL_GEO: Record<"tetra" | "octa" | "dodeca" | "ico", THREE.BufferGeometry> = {
  tetra: new THREE.TetrahedronGeometry(0.22),
  octa: new THREE.OctahedronGeometry(0.2),
  dodeca: new THREE.DodecahedronGeometry(0.2),
  ico: new THREE.IcosahedronGeometry(0.2),
};

function hullVerts(geo: THREE.BufferGeometry) {
  return Array.from(geo.getAttribute("position").array as ArrayLike<number>);
}

export function Solid({
  id,
  shape,
  pos,
}: {
  id: string;
  shape: SolidShape;
  pos: [number, number, number];
}) {
  const body = useRef<RapierRigidBody>(null);
  const grab = useGrab(body, id);
  const massPinned = useRef(false);
  const spec = SOLID[shape];
  const selected = useBay((s) => s.selected === id);

  useEffect(() => {
    registerBody(
      id,
      `solid-${shape}`,
      () => {
        const b = body.current;
        if (!b) return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, state: { missing: true, shape } };
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
          state: { missing: false, shape },
        };
      },
      () => body.current,
    );
    note("spawn", { kind: shape, id });
    return () => unregisterBody(id);
  }, [id, shape]);

  useFrame((state, dt) => {
    const cap = Math.min(dt, 0.05);
    grab.tick(state.raycaster.ray, cap);
    const b = body.current;
    if (!b) return;
    if (!massPinned.current) {
      setBodyMass(b, spec.mass);
      massPinned.current = true;
    }
  });

  const mat = (
    <meshStandardMaterial
      color={selected ? 0xd4d7cf : spec.color}
      metalness={0.18}
      roughness={0.55}
    />
  );

  return (
    <RigidBody
      ref={body}
      position={pos}
      colliders={false}
      mass={spec.mass}
      friction={spec.friction}
      restitution={spec.restitution}
      linearDamping={0.25}
      angularDamping={0.2}
      ccd
    >
      <group onPointerDown={grab.down}>
        <Shape shape={shape} mat={mat} />
      </group>
    </RigidBody>
  );
}

function Shape({ shape, mat }: { shape: SolidShape; mat: ReactNode }) {
  const hull = shape === "tetra" || shape === "octa" || shape === "dodeca" || shape === "ico" ? shape : null;
  const verts = useMemo(() => (hull ? hullVerts(HULL_GEO[hull]) : null), [hull]);

  if (shape === "cube") {
    return (
      <>
        <CuboidCollider args={[0.16, 0.16, 0.16]} />
        <mesh>
          <boxGeometry args={[0.32, 0.32, 0.32]} />
          {mat}
        </mesh>
      </>
    );
  }
  if (shape === "ball") {
    return (
      <>
        <BallCollider args={[0.16]} />
        <mesh>
          <sphereGeometry args={[0.16, 24, 16]} />
          {mat}
        </mesh>
      </>
    );
  }
  if (shape === "cylinder") {
    return (
      <>
        <CylinderCollider args={[0.16, 0.11]} />
        <mesh>
          <cylinderGeometry args={[0.11, 0.11, 0.32, 20]} />
          {mat}
        </mesh>
      </>
    );
  }
  if (shape === "capsule") {
    return (
      <>
        <CapsuleCollider args={[0.1, 0.08]} />
        <mesh>
          <capsuleGeometry args={[0.08, 0.2, 6, 12]} />
          {mat}
        </mesh>
      </>
    );
  }
  if (shape === "plank") {
    return (
      <>
        <CuboidCollider args={[0.42, 0.03, 0.09]} />
        <mesh>
          <boxGeometry args={[0.84, 0.06, 0.18]} />
          {mat}
        </mesh>
      </>
    );
  }
  if (hull && verts) {
    return (
      <>
        <ConvexHullCollider args={[verts]} />
        <mesh geometry={HULL_GEO[hull]}>{mat}</mesh>
      </>
    );
  }
  return null;
}

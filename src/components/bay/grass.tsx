import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GRASS } from "@/lib/bay/parts";
import { clearHeat, heatAt, setHeat } from "@/lib/bay/heat";
import { note, registerBody, unregisterBody } from "@/lib/bay/probe";
import { playEvent } from "@/lib/contain/audio";

type Phase = "idle" | "burn" | "ash";

type Cell = {
  x: number;
  z: number;
  phase: Phase;
  t: number;
};

const dummy = new THREE.Object3D();
const color = new THREE.Color();

export function Grass({ id, pos }: { id: string; pos: [number, number, number] }) {
  const { cols, rows, gap, ignite } = GRASS;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const litOnce = useRef(false);
  const cells = useMemo(() => {
    const list: Cell[] = [];
    const ox = ((cols - 1) * gap) / 2;
    const oz = ((rows - 1) * gap) / 2;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        list.push({
          x: i * gap - ox + (Math.random() - 0.5) * 0.04,
          z: j * gap - oz + (Math.random() - 0.5) * 0.04,
          phase: "idle",
          t: 0,
        });
      }
    }
    return list;
  }, [cols, rows, gap]);

  useEffect(() => {
    registerBody(id, "grass", () => {
      const burning = cells.filter((c) => c.phase === "burn").length;
      const ash = cells.filter((c) => c.phase === "ash").length;
      return {
        x: pos[0],
        y: pos[1],
        z: pos[2],
        rx: 0,
        ry: 0,
        rz: 0,
        state: { missing: false, burning, ash, n: cells.length },
      };
    });
    return () => {
      unregisterBody(id);
      for (let i = 0; i < cells.length; i++) clearHeat(`${id}-${i}`);
    };
  }, [id, cells, pos]);

  useLayoutEffect(() => {
    const fm = mesh.current;
    if (!fm) return;
    for (let i = 0; i < cells.length; i++) {
      dummy.position.set(cells[i].x, 0.07, cells[i].z);
      dummy.rotation.set(0, cells[i].x * 3.1, 0.15);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      fm.setMatrixAt(i, dummy.matrix);
      color.setHex(0xb8c86a);
      fm.setColorAt(i, color);
    }
    fm.instanceMatrix.needsUpdate = true;
    if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
  }, [cells]);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const fm = mesh.current;
    if (!fm) return;

    let burning = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const wx = pos[0] + c.x;
      const wz = pos[2] + c.z;
      if (c.phase === "idle") {
        if (heatAt(wx, 0.05, wz) >= ignite) {
          c.phase = "burn";
          c.t = 0;
          if (!litOnce.current) {
            litOnce.current = true;
            playEvent("ignite", "nmc");
            note("grass-ignite", { id });
          }
        }
      } else if (c.phase === "burn") {
        c.t += dt;
        burning += 1;
        setHeat(`${id}-${i}`, { x: wx, y: 0.08, z: wz, kW: 8 });
        if (c.t > 4.2) {
          c.phase = "ash";
          clearHeat(`${id}-${i}`);
        }
      }

      dummy.position.set(c.x, 0.07, c.z);
      dummy.rotation.set(0, c.x * 3.1, 0.15);
      dummy.scale.set(1, c.phase === "ash" ? 0.35 : 1, 1);
      dummy.updateMatrix();
      fm.setMatrixAt(i, dummy.matrix);
      if (c.phase === "idle") color.setHex(0xb8c86a);
      else if (c.phase === "burn") color.setRGB(1, 0.55 - Math.min(0.35, c.t * 0.1), 0.06);
      else color.setHex(0x3a342c);
      fm.setColorAt(i, color);
    }
    fm.instanceMatrix.needsUpdate = true;
    if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
    void burning;
  });

  const n = cols * rows;
  return (
    <group position={pos}>
      <instancedMesh ref={mesh} args={[undefined, undefined, n]} frustumCulled={false}>
        <boxGeometry args={[0.045, 0.14, 0.018]} />
        <meshStandardMaterial color={0xb8c86a} roughness={0.85} metalness={0} vertexColors />
      </instancedMesh>
    </group>
  );
}

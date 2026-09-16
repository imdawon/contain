import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { dummyScore } from "@/lib/bay/atd";
import { isVehicleKind } from "@/lib/bay/parts";
import { listSamplers } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";

function vehicleCrush() {
  let crush = 0;
  let dent = 0;
  let crushK = 0;
  for (const a of listSamplers().values()) {
    if (!isVehicleKind(a.kind)) continue;
    const state = a.sample()?.state ?? {};
    const d = Math.min(1, Math.max(0, Number(state.dent) || 0));
    const k = Math.min(1, Math.max(0, Number(state.crushK) || 0));
    dent += d;
    crushK += k;
    crush +=
      Math.round(d * 8_000) +
      Math.min(50_000, Math.round(Number(state.taken) || 0)) +
      Math.round(k * 18_000);
  }
  return { crush, dent, crushK };
}

/** In-canvas HUD. Pose from the camera each frame so a hidden-tab grab still sees it. */
export function ScorePlate() {
  const dummyId = useBay((s) => s.entities.find((e) => e.kind === "dummy")?.id ?? null);
  const canvas = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 768;
    c.height = 256;
    return c;
  }, []);
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  }, [canvas]);
  const mesh = useRef<THREE.Mesh>(null);
  const last = useRef(-1);
  const lastSub = useRef("");
  const offset = useMemo(() => new THREE.Vector3(), []);
  const camera = useThree((s) => s.camera);

  const paint = (score: number, sub: string) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(18, 16, 14, 0.82)";
    ctx.fillRect(16, 16, 736, 224);
    ctx.fillStyle = "#f4efe6";
    ctx.font = "800 108px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(score.toLocaleString("en-US"), 48, 148);
    ctx.fillStyle = "#e8dcc8";
    ctx.font = "700 32px ui-monospace, ui-sans-serif, sans-serif";
    ctx.fillText(sub, 48, 204);
    tex.needsUpdate = true;
  };

  useLayoutEffect(() => {
    last.current = -1;
    lastSub.current = "";
    paint(0, "CRUSH");
  }, [dummyId, canvas, tex]);

  useFrame(() => {
    const baking = Boolean((globalThis as { __bayBake?: unknown }).__bayBake);
    let score = 0;
    let snaps = 0;
    if (dummyId) {
      const d = dummyScore(dummyId);
      score += d.score;
      snaps = d.snaps;
    }
    const v = vehicleCrush();
    score += v.crush;
    const sub = snaps
      ? `${snaps} JOINT${snaps === 1 ? "" : "S"}`
      : v.dent > 0 || v.crushK > 0
        ? `CRUSH  K ${Math.round(v.crushK * 100)}  DENT ${Math.round(v.dent * 1000)}`
        : "CRUSH";
    if (score !== last.current || sub !== lastSub.current || baking) {
      last.current = score;
      lastSub.current = sub;
      paint(score, sub);
    }
    const m = mesh.current;
    if (!m) return;
    m.visible = true;
    m.quaternion.copy(camera.quaternion);
    offset.set(0, 0.82, -2.05).applyQuaternion(camera.quaternion);
    m.position.copy(camera.position).add(offset);
  }, 2);

  return (
    <mesh ref={mesh} renderOrder={20} frustumCulled={false}>
      <planeGeometry args={[0.22, 0.078]} />
      <meshBasicMaterial map={tex} transparent depthTest={false} toneMapped={false} />
    </mesh>
  );
}

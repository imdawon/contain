import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { dummyScore } from "@/lib/bay/atd";
import { useBay } from "@/store/bay-store";

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
  const camera = useThree((s) => s.camera);

  const paint = (score: number, snaps: number) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(18, 16, 14, 0.72)";
    ctx.fillRect(24, 24, 720, 208);
    ctx.fillStyle = "#f4efe6";
    ctx.font = "800 108px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(score.toLocaleString("en-US"), 56, 150);
    ctx.fillStyle = "#c8b8a0";
    ctx.font = "700 28px ui-monospace, ui-sans-serif, sans-serif";
    ctx.fillText(snaps ? `${snaps} JOINT${snaps === 1 ? "" : "S"}` : "POINTS", 56, 198);
    tex.needsUpdate = true;
  };

  useLayoutEffect(() => {
    last.current = -1;
    paint(0, 0);
  }, [dummyId, canvas, tex]);

  useFrame(() => {
    if (!dummyId) return;
    const { score, snaps } = dummyScore(dummyId);
    if (score !== last.current) {
      last.current = score;
      paint(score, snaps);
    }
    const m = mesh.current;
    if (!m) return;
    m.visible = true;
    m.quaternion.copy(camera.quaternion);
    const dir = new THREE.Vector3(0, 0.82, -2.05).applyQuaternion(camera.quaternion);
    m.position.copy(camera.position).add(dir);
  }, 2);

  if (!dummyId) return null;

  return (
    <mesh ref={mesh} renderOrder={20} frustumCulled={false}>
      <planeGeometry args={[0.16, 0.055]} />
      <meshBasicMaterial map={tex} transparent depthTest={false} toneMapped={false} />
    </mesh>
  );
}

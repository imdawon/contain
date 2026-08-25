import { useTexture } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

function prep(t: THREE.Texture, repeat: [number, number]) {
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export function useLabTextures() {
  const [cardboard, steel, concrete, fire] = useTexture([
    "/textures/cardboard.jpg",
    "/textures/steel.jpg",
    "/textures/concrete.jpg",
    "/textures/fire.jpg",
  ]);
  return useMemo(() => {
    prep(cardboard, [2.2, 2.2]);
    prep(steel, [1.6, 1.6]);
    prep(concrete, [6, 6]);
    fire.colorSpace = THREE.SRGBColorSpace;
    fire.wrapS = fire.wrapT = THREE.ClampToEdgeWrapping;
    return { cardboard, steel, concrete, fire };
  }, [cardboard, steel, concrete, fire]);
}

export function makeSmokeTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no 2d");
  ctx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 10; i++) {
    const x = 40 + Math.random() * 48;
    const y = 40 + Math.random() * 48;
    const r = 22 + Math.random() * 28;
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    const a = 0.12 + Math.random() * 0.18;
    g.addColorStop(0, `rgba(210,205,195,${a})`);
    g.addColorStop(0.55, `rgba(120,118,112,${a * 0.45})`);
    g.addColorStop(1, "rgba(40,40,38,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function makeSparkTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no 2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,230,1)");
  g.addColorStop(0.18, "rgba(255,210,80,0.9)");
  g.addColorStop(0.45, "rgba(255,90,20,0.35)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

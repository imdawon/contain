import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { useBay } from "@/store/bay-store";
import { placeActor } from "@/lib/bay/studio";

const _hit = new THREE.Vector3();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

/** Click the floor to drop the studio palette pick. */
export function StudioPlace() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const placeKind = useBay((s) => s.placeKind);
  useEffect(() => {
    const el = gl.domElement;
    const onDown = (ev: PointerEvent) => {
      const kind = useBay.getState().placeKind;
      if (!kind || ev.button !== 0 || useBay.getState().playing) return;
      const r = el.getBoundingClientRect();
      _ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      _ray.setFromCamera(_ndc, camera);
      const ok = _ray.ray.intersectPlane(_plane, _hit);
      if (!ok) return;
      ev.preventDefault();
      ev.stopPropagation();
      const y = ev.shiftKey ? Math.max(0.05, camera.position.y) : Math.max(0, _hit.y);
      placeActor(kind, _hit.x, y, _hit.z);
      useBay.getState().setPlaceKind(null);
    };
    el.addEventListener("pointerdown", onDown, true);
    return () => el.removeEventListener("pointerdown", onDown, true);
  }, [gl, camera, placeKind]);
  return null;
}

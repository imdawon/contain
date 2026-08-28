import { Beach } from "@/components/bay/arena-beach";
import { Grove } from "@/components/bay/arena-grove";
import { Keep } from "@/components/bay/arena-keep";
import { Mare } from "@/components/bay/arena-mare";
import { Green } from "@/components/bay/green";
import { ARENA_LOOK, sceneTheme } from "@/lib/bay/arena";
import { useBay } from "@/store/bay-store";

export function Arena() {
  const theme = useBay((s) => sceneTheme(s.scene));
  if (theme === "medieval") return <Keep />;
  if (theme === "beach") return <Beach />;
  if (theme === "forest") return <Grove />;
  if (theme === "space") return <Mare />;
  if (theme === "golf") return <Green />;
  return null;
}

export function ArenaLook() {
  const theme = useBay((s) => sceneTheme(s.scene));
  const look = theme ? ARENA_LOOK[theme] : null;
  const sky = look?.bg ?? "#8a7c6a";
  return (
    <>
      <color attach="background" args={[sky]} />
      <fog attach="fog" args={look ? [look.fog, look.fogNear, look.fogFar] : ["#8a7c6a", 90, 1400]} />
    </>
  );
}

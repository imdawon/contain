import { useEffect, useState } from "react";
import { punctureId, restageScene } from "@/lib/bay/actions";
import { note } from "@/lib/bay/probe";
import {
  PALETTE,
  captureScene,
  downloadScene,
  forgetStudio,
  listStudio,
  loadStudio,
  patchActor,
  placeActor,
  saveStudio,
  setCam,
  tieActors,
  untieActors,
} from "@/lib/bay/studio";
import { useBay } from "@/store/bay-store";
import { cn } from "@/lib/utils";

type Saved = { id: string; name: string; savedAt: number; n: number; ties: number };

function num(raw: string, fallback: number) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function Studio() {
  const entities = useBay((s) => s.entities);
  const selected = useBay((s) => s.selected);
  const scene = useBay((s) => s.scene);
  const placeKind = useBay((s) => s.placeKind);
  const setPlaceKind = useBay((s) => s.setPlaceKind);
  const setStudio = useBay((s) => s.setStudio);
  const moveAxis = useBay((s) => s.moveAxis);
  const setMoveAxis = useBay((s) => s.setMoveAxis);
  const select = useBay((s) => s.select);
  const removeEntity = useBay((s) => s.removeEntity);
  const ent = entities.find((e) => e.id === selected) ?? null;
  const [name, setName] = useState(scene?.name ?? "Studio");
  const [saved, setSaved] = useState<Saved[]>([]);
  const [tieA, setTieA] = useState("dummy-hips");
  const [tieB, setTieB] = useState("wagon");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setStudio(true);
    void listStudio().then(setSaved).catch(() => setSaved([]));
    return () => setStudio(false);
  }, [setStudio]);

  const refresh = () => void listStudio().then(setSaved).catch(() => setSaved([]));

  return (
    <aside className="pointer-events-auto absolute right-3 top-16 z-20 flex max-h-[calc(100dvh-8rem)] w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-3 overflow-y-auto rounded-[var(--radius-sm)] border border-border bg-surface/95 p-3 text-fg shadow-lg">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Studio</p>
        <button type="button" className="font-mono text-[10px] uppercase text-muted hover:text-fg" onClick={() => setStudio(false)} data-bay="studio-close">
          Close
        </button>
      </div>
      <p className="font-mono text-[10px] leading-snug text-muted">
        Stage is frozen until Play. Pick a kit, click the floor, then drag the RGB arrows (or hold X/Y/Z while grabbing). Reset restores this layout — it does not wipe it.
      </p>
      <div className="flex flex-wrap gap-1">
        {PALETTE.map((p) => (
          <button
            key={p.kind}
            type="button"
            data-bay={`place-${p.kind}`}
            onClick={() => {
              setPlaceKind(placeKind === p.kind ? null : p.kind);
              note("studio-pick", { kind: p.kind });
            }}
            className={cn(
              "h-8 rounded-[var(--radius-sm)] border px-2 font-mono text-[10px] uppercase tracking-[0.08em]",
              placeKind === p.kind ? "border-fg bg-raised text-fg" : "border-border bg-bg text-muted hover:text-fg",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        {(["x", "y", "z"] as const).map((ax) => (
          <button
            key={ax}
            type="button"
            data-bay={`axis-${ax}`}
            onClick={() => setMoveAxis(moveAxis === ax ? null : ax)}
            className={cn(
              "h-8 flex-1 rounded-[var(--radius-sm)] border font-mono text-[10px] uppercase",
              moveAxis === ax ? "border-fg bg-raised text-fg" : "border-border bg-bg text-muted",
            )}
          >
            {ax}
          </button>
        ))}
        <button type="button" data-bay="axis-free" onClick={() => setMoveAxis(null)} className="h-8 flex-1 border border-border font-mono text-[10px] uppercase text-muted">
          Free
        </button>
      </div>
      <label className="block font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
        Actors
        <select
          data-bay="studio-select"
          className="mt-1 h-9 w-full border border-border bg-bg px-2 text-fg"
          value={selected ?? ""}
          onChange={(e) => select(e.target.value || null)}
        >
          <option value="">—</option>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name ?? e.kind} ({e.id})
            </option>
          ))}
        </select>
      </label>
      {ent ? (
        <div className="grid grid-cols-3 gap-1">
          {(["pos", "rot", "vel"] as const).map((key) => (
            <label key={key} className="col-span-3 grid grid-cols-3 gap-1 font-mono text-[10px] uppercase text-muted">
              <span className="col-span-3">{key}</span>
              {(ent[key] ?? [0, 0, 0]).map((n, i) => (
                <input
                  key={i}
                  className="h-8 border border-border bg-bg px-1 text-fg"
                  defaultValue={Number(n).toFixed(3)}
                  onBlur={(ev) => {
                    const next = [...(ent[key] ?? [0, 0, 0])] as [number, number, number];
                    next[i] = num(ev.target.value, next[i]);
                    patchActor(ent.id, { [key]: next });
                  }}
                />
              ))}
            </label>
          ))}
          <label className="font-mono text-[10px] uppercase text-muted">
            mass
            <input className="mt-1 h-8 w-full border border-border bg-bg px-1 text-fg" defaultValue={ent.mass ?? ""} onBlur={(ev) => patchActor(ent.id, { mass: num(ev.target.value, ent.mass ?? 0) })} />
          </label>
          <label className="font-mono text-[10px] uppercase text-muted">
            fuse
            <input className="mt-1 h-8 w-full border border-border bg-bg px-1 text-fg" defaultValue={ent.fuse ?? ""} onBlur={(ev) => patchActor(ent.id, { fuse: num(ev.target.value, ent.fuse ?? 1.7) })} />
          </label>
          <label className="font-mono text-[10px] uppercase text-muted">
            grip
            <input className="mt-1 h-8 w-full border border-border bg-bg px-1 text-fg" defaultValue={ent.grip ?? ""} onBlur={(ev) => patchActor(ent.id, { grip: num(ev.target.value, ent.grip ?? 0) })} />
          </label>
          <label className="font-mono text-[10px] uppercase text-muted">
            bounce
            <input className="mt-1 h-8 w-full border border-border bg-bg px-1 text-fg" defaultValue={ent.bounce ?? ""} onBlur={(ev) => patchActor(ent.id, { bounce: num(ev.target.value, ent.bounce ?? 0) })} />
          </label>
          <label className="font-mono text-[10px] uppercase text-muted">
            cut
            <input className="mt-1 h-8 w-full border border-border bg-bg px-1 text-fg" defaultValue={ent.cut ?? ""} onBlur={(ev) => patchActor(ent.id, { cut: num(ev.target.value, ent.cut ?? 0.75) })} />
          </label>
          <label className="font-mono text-[10px] uppercase text-muted">
            grade
            <input className="mt-1 h-8 w-full border border-border bg-bg px-1 text-fg" defaultValue={ent.grade ?? ""} onBlur={(ev) => patchActor(ent.id, { grade: num(ev.target.value, ent.grade ?? 0) })} />
          </label>
          <label className="col-span-3 grid grid-cols-3 gap-1 font-mono text-[10px] uppercase text-muted">
            <span className="col-span-3">size</span>
            {(ent.size ?? [1, 1, 1]).map((n, i) => (
              <input
                key={i}
                className="h-8 border border-border bg-bg px-1 text-fg"
                defaultValue={Number(n).toFixed(3)}
                onBlur={(ev) => {
                  const next = [...(ent.size ?? [1, 1, 1])] as [number, number, number];
                  next[i] = num(ev.target.value, next[i]);
                  patchActor(ent.id, { size: next });
                }}
              />
            ))}
          </label>
          <button type="button" className="h-8 border border-border font-mono text-[10px] uppercase" onClick={() => patchActor(ent.id, { live: !ent.live, fixed: ent.fixed })}>
            {ent.live ? "Live dummy" : "Dead dummy"}
          </button>
          <button type="button" className="h-8 border border-border font-mono text-[10px] uppercase" onClick={() => patchActor(ent.id, { fixed: !ent.fixed })}>
            {ent.fixed ? "Fixed" : "Free"}
          </button>
          <button type="button" data-bay="studio-remove" className="col-span-3 h-9 border border-danger text-[10px] uppercase tracking-[0.12em] text-danger" onClick={() => removeEntity(ent.id)}>
            Remove
          </button>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-1">
        <input className="h-8 border border-border bg-bg px-1 font-mono text-[10px] text-fg" value={tieA} onChange={(e) => setTieA(e.target.value)} placeholder="dummy-hips" />
        <input className="h-8 border border-border bg-bg px-1 font-mono text-[10px] text-fg" value={tieB} onChange={(e) => setTieB(e.target.value)} placeholder="wagon" />
        <button type="button" data-bay="studio-tie" className="h-9 border border-border font-mono text-[10px] uppercase" onClick={() => tieActors(tieA, tieB)}>
          Tie
        </button>
        <button type="button" data-bay="studio-untie" className="h-9 border border-border font-mono text-[10px] uppercase" onClick={() => untieActors(tieA, tieB)}>
          Untie
        </button>
      </div>
      <p className="font-mono text-[10px] text-muted">{scene?.ties.length ?? 0} ties · restage to glue</p>
      <div className="grid grid-cols-3 gap-1 font-mono text-[10px] uppercase text-muted">
        <span className="col-span-3">cam offset</span>
        {(scene?.cam?.offset ?? [0, 2.2, -6.4]).map((n, i) => (
          <input
            key={i}
            className="h-8 border border-border bg-bg px-1 text-fg"
            defaultValue={Number(n).toFixed(2)}
            onBlur={(ev) => {
              const offset = [...(scene?.cam?.offset ?? [0, 2.2, -6.4])] as [number, number, number];
              offset[i] = num(ev.target.value, offset[i]);
              setCam({ offset });
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" data-bay="puncture" className="h-9 border border-border px-2 font-mono text-[10px] uppercase" onClick={() => punctureId()}>
          Pull pin
        </button>
        <button type="button" data-bay="reset" className="h-9 border border-border px-2 font-mono text-[10px] uppercase" onClick={() => void restageScene(captureScene(name))}>
          Restage
        </button>
        <button type="button" data-bay="studio-drop" className="h-9 border border-border px-2 font-mono text-[10px] uppercase" onClick={() => placeKind && placeActor(placeKind)}>
          Drop at cam
        </button>
      </div>
      <label className="font-mono text-[10px] uppercase text-muted">
        Name
        <input className="mt-1 h-9 w-full border border-border bg-bg px-2 text-fg" value={name} onChange={(e) => setName(e.target.value)} data-bay="studio-name" />
      </label>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          data-bay="studio-save"
          className="h-9 border border-fg bg-raised px-2 font-mono text-[10px] uppercase"
          onClick={() => {
            void saveStudio(name).then((r) => {
              setMsg(`saved ${r.id}`);
              refresh();
            });
          }}
        >
          Save IDB
        </button>
        <button
          type="button"
          data-bay="studio-download"
          className="h-9 border border-border px-2 font-mono text-[10px] uppercase"
          onClick={() => {
            const r = downloadScene(captureScene(name));
            setMsg(`file ${r.file}`);
          }}
        >
          Save file
        </button>
      </div>
      <label className="font-mono text-[10px] uppercase text-muted">
        IndexedDB
        <select
          data-bay="studio-load"
          className="mt-1 h-9 w-full border border-border bg-bg px-2 text-fg"
          defaultValue=""
          onChange={(e) => {
            const id = e.target.value;
            e.target.value = "";
            if (!id) return;
            void loadStudio(id).then(() => setMsg(`loaded ${id}`));
          }}
        >
          <option value="">Load…</option>
          {saved.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.n})
            </option>
          ))}
        </select>
      </label>
      {saved[0] ? (
        <button type="button" className="h-8 font-mono text-[10px] uppercase text-muted" onClick={() => void forgetStudio(saved[0]!.id).then(refresh)}>
          Forget last
        </button>
      ) : null}
      {msg ? <p className="font-mono text-[10px] text-ok">{msg}</p> : null}
    </aside>
  );
}

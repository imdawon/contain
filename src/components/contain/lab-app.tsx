import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Inspector } from "@/components/contain/inspector";
import { bindHarnessPipe, bindHarnessWindow, resetStage } from "@/lib/bay/harness";
import { ensureFuseClock } from "@/lib/bay/blast";
import { loadBay, loadRun, nextTrial, restageScene, saveBay } from "@/lib/bay/actions";
import { listLevels } from "@/lib/bay/level";
import { listSceneCards } from "@/lib/bay/scene";
import { getRun, runCard, RUNS } from "@/lib/bay/run";
import { note } from "@/lib/bay/probe";
import { punctureSelected } from "@/components/bay/pack";
import { isMuted, setMuted, unlockAudio } from "@/lib/contain/audio";
import { SOLID, SOLID_SHAPES } from "@/lib/bay/solids";
import { useBay, type Tool } from "@/store/bay-store";
import { cn } from "@/lib/utils";

const BayCanvas = lazy(() => import("@/components/bay/canvas"));

class StageErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }
  render() {
    if (this.state.message) {
      return (
        <div className="absolute inset-0 grid place-items-center bg-bg px-6 text-center">
          <p className="font-mono text-sm text-fg">{this.state.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function LabApp() {
  const [client, setClient] = useState(false);
  const tool = useBay((s) => s.tool);
  const muted = useBay((s) => s.muted);
  const latch = useBay((s) => s.latch);
  const entities = useBay((s) => s.entities);
  const spawn = useBay((s) => s.spawn);
  const setTool = useBay((s) => s.setTool);
  const toggleMuted = useBay((s) => s.toggleMuted);
  const trackId = useBay((s) => s.trackId);
  const setTrack = useBay((s) => s.setTrack);
  const cutaway = useBay((s) => s.cutaway);
  const toggleCutaway = useBay((s) => s.toggleCutaway);
  const levelId = useBay((s) => s.levelId);
  const runId = useBay((s) => s.runId);
  const trial = useBay((s) => s.trial);
  const scene = useBay((s) => s.scene);
  const inspect = useBay((s) => s.inspect);
  const run = runId ? getRun(runId) : null;
  const runLive = run ? runCard(run, trial) : null;

  useEffect(() => {
    setClient(true);
    bindHarnessWindow();
    ensureFuseClock();
    return bindHarnessPipe();
  }, []);
  useEffect(() => {
    setMuted(muted);
  }, [muted]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyX") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      toggleCutaway();
      note("cutaway", { on: useBay.getState().cutaway });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCutaway]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyN") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      nextTrial();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fuseOn = entities.some((e) => e.kind === "pack" || e.kind === "grenade" || e.kind === "charge");
  const nadeOn = entities.some((e) => e.kind === "grenade" || e.kind === "charge");
  const trackOpts = entities.flatMap((e) => {
    if (e.kind === "can") {
      return [
        { id: e.id, label: `${e.id} body` },
        { id: `${e.id}-lid`, label: `${e.id} lid` },
        { id: `${e.id}-hinge`, label: `${e.id} hinge` },
        { id: `${e.id}-latch`, label: `${e.id} latch` },
      ];
    }
    if (e.kind === "dummy") {
      return [
        { id: `${e.id}-hips`, label: `${e.id} hips` },
        { id: `${e.id}-chest`, label: `${e.id} chest` },
        { id: `${e.id}-head`, label: `${e.id} head` },
      ];
    }
    if (e.kind === "crate") {
      return [
        { id: `${e.id}-lid`, label: `${e.id} lid` },
        { id: `${e.id}-floor`, label: `${e.id} floor` },
      ];
    }
    if (e.kind === "doorway") {
      return [
        { id: e.id, label: `${e.id} frame` },
        { id: `${e.id}-panel`, label: `${e.id} door` },
        { id: `${e.id}-hinge`, label: `${e.id} hinge` },
        { id: `${e.id}-latch`, label: `${e.id} latch` },
      ];
    }
    return [{ id: e.id, label: `${e.id} ${e.kind}` }];
  });

  return (
    <div className="relative h-dvh overflow-hidden bg-bg text-fg">
      <section className="absolute inset-0">
        {client ? (
          <StageErrorBoundary>
            <Suspense
              fallback={
                <p className="absolute bottom-8 left-0 right-0 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                  Opening the bay
                </p>
              }
            >
              <BayCanvas />
            </Suspense>
          </StageErrorBoundary>
        ) : null}
      </section>

      {client && inspect ? <Inspector /> : null}

      {runLive ? (
        <div className="pointer-events-none absolute inset-x-0 top-[5.5rem] z-10 px-4 text-center md:top-28">
          <p className="font-display text-[1.65rem] leading-none tracking-[0.12em] text-fg md:text-5xl">
            {runLive.threat} <span className="text-muted">vs</span> {runLive.victim}
          </p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
            lv {runLive.lv} / {runLive.n}
          </p>
        </div>
      ) : null}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-5">
        <div>
          <p className="font-display text-4xl leading-none tracking-[0.18em] md:text-5xl">CONTAIN</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            {runLive ? `${runLive.name} · lv ${runLive.lv}` : scene ? scene.name : (listLevels().find((l) => l.id === levelId)?.name ?? "clip")}
          </p>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <div
            className={cn(
              "rounded-[var(--radius-sm)] border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em]",
              latch === "sealed"
                ? "border-ok text-ok"
                : latch === "hinged"
                  ? "border-accent text-fg"
                  : "border-danger text-danger",
            )}
          >
            {latch}
          </div>
          <button
            type="button"
            onClick={() => {
              unlockAudio();
              toggleMuted();
              setMuted(!isMuted());
            }}
            className="grid size-11 place-items-center rounded-[var(--radius-sm)] border border-border bg-surface text-muted hover:text-fg"
            aria-label={muted ? "Unmute" : "Mute"}
            data-bay="mute"
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
        </div>
      </header>

      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-border bg-surface/92 p-3 md:p-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              toggleCutaway();
              note("cutaway", { on: !cutaway });
            }}
            className={cn(
              "h-11 rounded-[var(--radius-sm)] border px-3 font-mono text-[11px] uppercase tracking-[0.14em]",
              cutaway ? "border-fg bg-raised text-fg" : "border-border bg-bg text-muted",
            )}
            title="Ghost the wall facing the camera (X)"
            data-bay="xray"
          >
            X-ray
          </button>
          {(["grab", "nail"] as Tool[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTool(t)}
              data-bay={t}
              className={cn(
                "h-11 rounded-[var(--radius-sm)] border px-3 font-mono text-[11px] uppercase tracking-[0.14em]",
                tool === t ? "border-fg bg-raised text-fg" : "border-border bg-bg text-muted",
              )}
            >
              {t}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              spawn("pack");
              note("spawn", { kind: "pack" });
            }}
            data-bay="pack"
            className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-3 text-sm hover:bg-raised"
          >
            Pack
          </button>
          <button
            type="button"
            onClick={() => {
              spawn("grenade");
              note("spawn", { kind: "grenade" });
            }}
            data-bay="grenade"
            className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-3 text-sm hover:bg-raised"
          >
            Grenade
          </button>
          <button
            type="button"
            onClick={() => {
              spawn("can");
              note("spawn", { kind: "can" });
            }}
            data-bay="can"
            className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-3 text-sm hover:bg-raised"
          >
            Can
          </button>
          <button
            type="button"
            onClick={() => {
              spawn("crate");
              note("spawn", { kind: "crate" });
            }}
            data-bay="crate"
            className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-3 text-sm hover:bg-raised"
          >
            Crate
          </button>
          <button
            type="button"
            onClick={() => {
              spawn("dummy");
              note("spawn", { kind: "dummy" });
            }}
            data-bay="dummy"
            className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-3 text-sm hover:bg-raised"
          >
            Dummy
          </button>
          <button
            type="button"
            onClick={() => {
              spawn("grass");
              note("spawn", { kind: "grass" });
            }}
            data-bay="grass"
            className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-3 text-sm hover:bg-raised"
          >
            Grass
          </button>
          <button
            type="button"
            onClick={() => {
              spawn("wall");
              note("spawn", { kind: "wall" });
            }}
            data-bay="wall"
            className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-3 text-sm hover:bg-raised"
          >
            Wall
          </button>
          <button
            type="button"
            onClick={() => {
              spawn("doorway");
              note("spawn", { kind: "doorway" });
            }}
            data-bay="doorway"
            className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-3 text-sm hover:bg-raised"
          >
            Door
          </button>
          <label className="flex items-center">
            <span className="sr-only">Drop a solid</span>
            <select
              defaultValue=""
              onChange={(e) => {
                const kind = e.target.value;
                if (!kind) return;
                spawn(kind as Parameters<typeof spawn>[0]);
                note("spawn", { kind });
                e.target.value = "";
              }}
              data-bay="solid"
              className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg"
            >
              <option value="" disabled>
                Solid
              </option>
              {SOLID_SHAPES.map((s) => (
                <option key={s} value={s}>
                  {SOLID[s].label}
                </option>
              ))}
            </select>
          </label>
          <Button
            className="h-11 font-display text-lg tracking-[0.12em]"
            data-bay="puncture"
            disabled={!fuseOn}
            onClick={() => {
              unlockAudio();
              punctureSelected();
            }}
          >
            {nadeOn ? "PULL PIN" : "PUNCTURE"}
          </Button>
          <button
            type="button"
            onClick={() => {
              resetStage();
            }}
            data-bay="reset"
            className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted hover:text-fg"
          >
            Reset
          </button>
          <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
            Run
            <select
              value={scene ? `scene:${scene.id}` : runId ? `run:${runId}` : `clip:${levelId}`}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("run:")) loadRun(v.slice(4), 1);
                else if (v.startsWith("scene:")) void restageScene(v.slice(6));
                else loadBay(v.slice(5));
              }}
              data-bay="run"
              className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-2 text-fg"
            >
              <optgroup label="vs">
                {RUNS.map((r) => (
                  <option key={r.id} value={`run:${r.id}`}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Scenes">
                {listSceneCards().map((s) => (
                  <option key={s.id} value={`scene:${s.id}`}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Gags">
                {listLevels()
                  .filter((l) => l.builtin)
                  .map((l) => (
                    <option key={l.id} value={`clip:${l.id}`}>
                      {l.name}
                    </option>
                  ))}
              </optgroup>
              {listLevels().some((l) => !l.builtin) ? (
                <optgroup label="Saved">
                  {listLevels()
                    .filter((l) => !l.builtin)
                    .map((l) => (
                      <option key={l.id} value={`clip:${l.id}`}>
                        {l.name}
                      </option>
                    ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <button
            type="button"
            onClick={() => nextTrial()}
            data-bay="next"
            disabled={!runLive || runLive.last}
            className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted hover:text-fg disabled:opacity-40"
            title="Next vs rung (N)"
          >
            Next
          </button>
          <button
            type="button"
            onClick={() => {
              const current = listLevels().find((l) => l.id === levelId);
              const next = window.prompt("Name this clip", current?.builtin ? `${current.name} copy` : (current?.name ?? "Clip"));
              if (!next) return;
              saveBay(next);
            }}
            data-bay="save"
            className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted hover:text-fg"
            title="Save the current arrangement as a clip"
          >
            Save
          </button>
          <label className="ml-auto flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
            Track
            <select
              value={trackId ?? ""}
              onChange={(e) => setTrack(e.target.value || null)}
              data-bay="track"
              className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-2 text-fg"
            >
              <option value="">free orbit</option>
              {trackOpts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

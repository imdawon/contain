import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Inspector } from "@/components/contain/inspector";
import { cooks } from "@/lib/bay/cook";
import { bindProbeWindow, note } from "@/lib/bay/probe";
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
  const selected = useBay((s) => s.selected);
  const entities = useBay((s) => s.entities);
  const spawn = useBay((s) => s.spawn);
  const reset = useBay((s) => s.reset);
  const setTool = useBay((s) => s.setTool);
  const toggleMuted = useBay((s) => s.toggleMuted);
  const trackId = useBay((s) => s.trackId);
  const setTrack = useBay((s) => s.setTrack);

  useEffect(() => {
    setClient(true);
    bindProbeWindow();
  }, []);
  useEffect(() => {
    setMuted(muted);
  }, [muted]);

  const packOn = selected ? entities.find((e) => e.id === selected)?.kind === "pack" : false;
  const trackOpts = entities.flatMap((e) =>
    e.kind === "can"
      ? [
          { id: e.id, label: `${e.id} body` },
          { id: `${e.id}-lid`, label: `${e.id} lid` },
          { id: `${e.id}-hinge`, label: `${e.id} hinge` },
          { id: `${e.id}-latch`, label: `${e.id} latch` },
        ]
      : [{ id: e.id, label: `${e.id} ${e.kind}` }],
  );

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

      {client ? <Inspector /> : null}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-5">
        <div>
          <p className="font-display text-4xl leading-none tracking-[0.18em] md:text-5xl">CONTAIN</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            v0 · hinged can · breakable latch
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
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
        </div>
      </header>

      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-border bg-surface/92 p-3 md:p-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
          {(["grab", "nail"] as Tool[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTool(t)}
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
            className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-3 text-sm hover:bg-raised"
          >
            Pack
          </button>
          <button
            type="button"
            onClick={() => {
              spawn("can");
              note("spawn", { kind: "can" });
            }}
            className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-3 text-sm hover:bg-raised"
          >
            Can
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
            disabled={!packOn}
            onClick={() => {
              unlockAudio();
              punctureSelected();
            }}
          >
            PUNCTURE
          </Button>
          <button
            type="button"
            onClick={() => {
              cooks.clear();
              note("reset", {});
              reset();
            }}
            className="h-11 rounded-[var(--radius-sm)] border border-border bg-bg px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted hover:text-fg"
          >
            Reset
          </button>
          <label className="ml-auto flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
            Track
            <select
              value={trackId ?? ""}
              onChange={(e) => setTrack(e.target.value || null)}
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

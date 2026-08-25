import { useEffect, useState, type ReactNode } from "react";
import { applyActor, snapshot, type ProbeObject, type ProbeSnap } from "@/lib/bay/probe";
import { useBay } from "@/store/bay-store";
import { cn } from "@/lib/utils";

function pickTarget(snap: ProbeSnap): ProbeObject | null {
  const id = snap.trackId ?? snap.selected;
  if (!id) return null;
  return snap.objects.find((o) => o.id === id) ?? null;
}

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function Inspector() {
  const trackId = useBay((s) => s.trackId);
  const selected = useBay((s) => s.selected);
  const setTrack = useBay((s) => s.setTrack);
  const [live, setLive] = useState<ProbeObject | null>(null);
  const [ids, setIds] = useState<{ id: string; kind: string }[]>([]);

  useEffect(() => {
    const tick = () => {
      const snap = snapshot();
      setLive(pickTarget(snap));
      setIds(snap.objects.map((o) => ({ id: o.id, kind: o.kind })));
    };
    tick();
    const t = window.setInterval(tick, 100);
    return () => window.clearInterval(t);
  }, [trackId, selected]);

  const focusId = trackId ?? selected;
  const airborne = live != null && live.y > 1.2;
  const speed = live?.vx != null ? Math.hypot(live.vx, live.vy ?? 0, live.vz ?? 0) : null;

  return (
    <aside className="pointer-events-auto absolute left-4 top-24 z-10 w-56 rounded-[var(--radius-md)] border border-border bg-surface/92 p-3 md:left-5 md:top-[6.5rem] md:w-64">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Inspect</p>
        {airborne ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-danger">airborne</p>
        ) : (
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{live?.editable ? "body" : "point"}</p>
        )}
      </div>
      <label className="mb-3 block">
        <span className="sr-only">Tracked object</span>
        <select
          value={focusId ?? ""}
          onChange={(e) => setTrack(e.target.value || null)}
          className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-bg px-2 font-mono text-[11px] text-fg"
        >
          <option value="">none</option>
          {ids.map((o) => (
            <option key={o.id} value={o.id}>
              {o.id} · {o.kind}
            </option>
          ))}
        </select>
      </label>

      {live ? (
        <div className="space-y-2">
          <Row>
            <NumField label="x" value={live.x} disabled={!live.editable} onCommit={(n) => applyActor(live.id, { x: n })} />
            <NumField label="y" value={live.y} disabled={!live.editable} onCommit={(n) => applyActor(live.id, { y: n })} />
            <NumField label="z" value={live.z} disabled={!live.editable} onCommit={(n) => applyActor(live.id, { z: n })} />
          </Row>
          <Row>
            <NumField label="vx" value={live.vx} disabled={!live.editable} onCommit={(n) => applyActor(live.id, { vx: n })} />
            <NumField label="vy" value={live.vy} disabled={!live.editable} onCommit={(n) => applyActor(live.id, { vy: n })} />
            <NumField label="vz" value={live.vz} disabled={!live.editable} onCommit={(n) => applyActor(live.id, { vz: n })} />
          </Row>
          <Row>
            <NumField label="mass" value={live.mass} disabled={!live.editable} step={0.1} onCommit={(n) => applyActor(live.id, { mass: n })} />
            <NumField
              label="μ"
              value={live.friction}
              disabled={!live.editable}
              step={0.05}
              onCommit={(n) => applyActor(live.id, { friction: n })}
            />
            <NumField
              label="e"
              value={live.restitution}
              disabled={!live.editable}
              step={0.05}
              onCommit={(n) => applyActor(live.id, { restitution: n })}
            />
          </Row>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            |v| {fmt(speed, 2)} · y {fmt(live.y, 2)}
            {live.state.latch != null ? ` · ${String(live.state.latch)}` : ""}
            {live.state.cook != null ? ` · ${String(live.state.cook)}` : ""}
          </p>
        </div>
      ) : (
        <p className="font-mono text-[11px] leading-relaxed text-muted">Track a part to read and edit xyz, mass, friction.</p>
      )}
    </aside>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-3 gap-1.5">{children}</div>;
}

function NumField({
  label,
  value,
  disabled,
  step = 0.01,
  onCommit,
}: {
  label: string;
  value: number | null;
  disabled?: boolean;
  step?: number;
  onCommit: (n: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const shown = editing ? text : fmt(value, 2);

  return (
    <label className="block">
      <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={shown}
        step={step}
        onFocus={() => {
          if (disabled || value == null) return;
          setEditing(true);
          setText(value.toFixed(2));
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (disabled) return;
          const n = Number(text);
          if (Number.isFinite(n)) onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={cn(
          "h-9 w-full rounded-[var(--radius-sm)] border border-border bg-bg px-1.5 font-mono text-[11px] tabular-nums text-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          "disabled:text-muted",
        )}
      />
    </label>
  );
}

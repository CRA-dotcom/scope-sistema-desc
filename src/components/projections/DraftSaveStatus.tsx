"use client";
import type { AutosaveStatus } from "@/hooks/useDebouncedAutosave";

type Props = {
  status: AutosaveStatus;
  retry: number;
  lastSavedAt: number | null;
};

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m}m`;
  return `hace ${Math.round(m / 60)}h`;
}

export function DraftSaveStatus({ status, retry, lastSavedAt }: Props) {
  if (status === "idle" || status === "pending") return null;

  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 100" />
        </svg>
        Guardando…
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-green-600">
        ✓ Guardado {lastSavedAt ? timeAgo(lastSavedAt) : ""}
      </span>
    );
  }

  // status === "error"
  if (retry > 0 && retry < 3) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-amber-600">
        ⟳ Reintentando ({retry}/3)…
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-sm text-red-600">
      ❌ No se pudo guardar. Revisa tu conexión.
    </span>
  );
}

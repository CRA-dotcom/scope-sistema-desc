"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useSearchParams, usePathname } from "next/navigation";

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.round(h / 24)}d`;
}

export function DraftPendingBanner() {
  const drafts = useQuery(api.functions.projectionDrafts.queries.listMyActiveDrafts, {});

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const currentDraftId = pathname?.includes("/proyecciones/nueva")
    ? searchParams.get("draftId")
    : null;

  const filteredDrafts = (drafts ?? []).filter((d) => d._id !== currentDraftId);
  if (filteredDrafts.length === 0) return null;

  const top = [...filteredDrafts].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);

  return (
    <div className="rounded-md border-l-4 border-blue-500 bg-blue-50 p-4">
      <h3 className="text-sm font-medium text-blue-900">Borradores de proyección pendientes</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {top.map((d) => (
          <li key={d._id}>
            <Link
              href={`/proyecciones/nueva?draftId=${d._id}`}
              className="text-blue-700 underline hover:text-blue-900"
            >
              Continuar borrador de <b>{d.clientName ?? "(sin cliente)"}</b>
              {d.year ? ` (${d.year})` : ""} — paso {d.step + 1}/4 · {timeAgo(d.updatedAt)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import { useSearchParams, usePathname } from "next/navigation";

export function DraftNavbarChip() {
  const drafts = useQuery(api.functions.projectionDrafts.queries.listMyActiveDrafts, {});
  const [open, setOpen] = useState(false);

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const currentDraftId = pathname?.includes("/proyecciones/nueva")
    ? searchParams.get("draftId")
    : null;

  const filteredDrafts = (drafts ?? []).filter((d) => d._id !== currentDraftId);
  if (filteredDrafts.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800 hover:bg-blue-200"
        aria-label={`${filteredDrafts.length} borradores de proyección pendientes`}
      >
        Borradores
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[10px] text-white">
          {filteredDrafts.length}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-md border bg-white p-2 shadow-lg">
          <ul className="space-y-1 text-sm">
            {filteredDrafts.slice(0, 5).map((d) => (
              <li key={d._id}>
                <Link
                  href={`/proyecciones/nueva?draftId=${d._id}`}
                  className="block rounded px-2 py-1 hover:bg-gray-100"
                  onClick={() => setOpen(false)}
                >
                  {d.clientName ?? "(sin cliente)"} {d.year ? `· ${d.year}` : ""} — paso {d.step + 1}/4
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

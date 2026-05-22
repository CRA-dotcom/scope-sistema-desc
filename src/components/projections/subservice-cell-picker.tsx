"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Doc } from "../../../convex/_generated/dataModel";

type Subservice = Pick<Doc<"subservices">, "_id" | "name" | "sortOrder">;

export function SubserviceCellPicker({
  current,
  options,
  onPick,
}: {
  current: Subservice | null;
  options: Subservice[];
  onPick: (id: Subservice["_id"] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const triggerLabel = current
    ? truncate(current.name, 18)
    : "Selecciona";

  return (
    <div
      ref={ref}
      className="relative inline-block w-full"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] transition-colors",
          current
            ? "border-border bg-secondary/50 text-foreground hover:bg-secondary"
            : "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20"
        )}
        title={current?.name ?? "Subservicio sin asignar"}
      >
        {!current && <AlertCircle size={10} className="flex-shrink-0" />}
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown size={10} className="flex-shrink-0 opacity-70" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg">
          {options
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((opt) => (
              <button
                key={opt._id}
                type="button"
                onClick={() => {
                  onPick(opt._id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-secondary"
              >
                <span className="truncate">{opt.name}</span>
                {current?._id === opt._id && (
                  <Check size={12} className="flex-shrink-0 text-accent" />
                )}
              </button>
            ))}

          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-secondary"
          >
            <AlertCircle size={12} className="flex-shrink-0" />
            Sin subservicio
          </button>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
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
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Reposition on open + on scroll/resize.
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (!triggerRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      setCoords({
        top: r.bottom + 4,
        left: r.left,
        width: Math.max(r.width, 220),
      });
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  // Click outside closes (covers both trigger area and portal popover).
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      const inTrigger = triggerRef.current?.contains(t);
      const inPopover = popoverRef.current?.contains(t);
      if (!inTrigger && !inPopover) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const triggerLabel = current ? truncate(current.name, 18) : "Selecciona";

  return (
    <div
      className="relative inline-block w-full"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
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

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: coords.width,
              zIndex: 9999,
            }}
            className="max-h-64 overflow-y-auto rounded-md border border-border bg-card py-1 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
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
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-secondary"
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
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary"
            >
              <AlertCircle size={12} className="flex-shrink-0" />
              Sin subservicio
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

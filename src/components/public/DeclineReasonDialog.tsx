"use client";
import { useState } from "react";
import { X } from "lucide-react";

export function DeclineReasonDialog({
  primaryColor,
  onSubmit,
  onCancel,
}: {
  primaryColor: string;
  onSubmit: (reason: string | undefined) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const max = 500;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">¿Por qué rechazas la cotización?</h3>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Tu respuesta es opcional. Nos ayuda a mejorar nuestra oferta.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, max))}
          rows={4}
          className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:outline-none resize-y"
          placeholder="Opcional"
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {reason.length}/{max}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary"
          >
            Cancelar
          </button>
          <button
            onClick={async () => {
              setSubmitting(true);
              await onSubmit(undefined);
            }}
            disabled={submitting}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary disabled:opacity-50"
          >
            Rechazar sin comentario
          </button>
          <button
            onClick={async () => {
              setSubmitting(true);
              await onSubmit(reason.trim() || undefined);
            }}
            disabled={submitting}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: primaryColor, color: "white" }}
          >
            {submitting ? "Enviando..." : "Enviar rechazo"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";
import { CheckCircle2, XCircle, Send, Clock, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type Quotation = {
  _id: string;
  status: "draft" | "sent" | "approved" | "rejected";
  sendCount?: number;
  lastSentAt?: number;
  tokenExpiresAt?: number;
  respondedAt?: number;
  declineReason?: string;
};

export function SendStatusPanel({
  quotation,
  successMeta,
}: {
  quotation: Quotation;
  successMeta?: { plaintextToken: string; appUrl: string } | null;
}) {
  const [copied, setCopied] = useState(false);

  if (quotation.status === "draft" && !quotation.sendCount) return null;

  const sendCount = quotation.sendCount ?? 0;
  const isSent = quotation.status === "sent";
  const isApproved = quotation.status === "approved";
  const isRejected = quotation.status === "rejected";

  const fmt = (ts?: number) =>
    ts
      ? new Date(ts).toLocaleString("es-MX", {
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  if (isApproved) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-emerald-400">
          <CheckCircle2 size={16} /> Aprobada por el cliente
        </div>
        <p className="mt-1 text-muted-foreground">
          {fmt(quotation.respondedAt)} · Enviada {sendCount} {sendCount === 1 ? "vez" : "veces"}
        </p>
      </div>
    );
  }

  if (isRejected) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-red-400">
          <XCircle size={16} /> Rechazada por el cliente
        </div>
        <p className="mt-1 text-muted-foreground">{fmt(quotation.respondedAt)}</p>
        {quotation.declineReason && (
          <blockquote className="mt-2 border-l-2 border-red-500/50 pl-3 italic text-muted-foreground">
            {quotation.declineReason}
          </blockquote>
        )}
      </div>
    );
  }

  if (isSent) {
    const link = successMeta
      ? `${successMeta.appUrl}/q/cotizacion/${successMeta.plaintextToken}`
      : null;
    return (
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-blue-400">
          <Send size={16} /> Enviada {sendCount > 1 && `${sendCount} veces`}
        </div>
        <p className="mt-1 text-muted-foreground">
          Último envío: {fmt(quotation.lastSentAt)} · Expira:{" "}
          <Clock size={12} className="inline" /> {fmt(quotation.tokenExpiresAt)}
        </p>
        {link && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
            <code className="flex-1 truncate text-xs">{link}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary"
            >
              <Copy size={12} /> {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        )}
        <Link
          href={`/configuracion/email-log?relatedId=${quotation._id}`}
          className="mt-2 inline-block text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Ver historial de emails
        </Link>
      </div>
    );
  }

  return null;
}

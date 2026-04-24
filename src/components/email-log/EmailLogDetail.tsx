"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc } from "../../../convex/_generated/dataModel";
import { Paperclip, RefreshCw, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmailStatusBadge } from "./EmailStatusBadge";
import { useOrganization } from "@clerk/nextjs";

export function EmailLogDetail({ log }: { log: Doc<"emailLog"> }) {
  const { membership } = useOrganization();
  const isAdmin = membership?.role === "org:admin";
  const events = useQuery(api.functions.email.queries.getEvents, {
    emailLogId: log._id,
  });
  const attachments = useQuery(api.functions.email.queries.getAttachmentUrls, {
    emailLogId: log._id,
  });
  const resendFromLog = useAction(api.functions.email.send.resendFromLog);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  async function handleResend() {
    setResending(true);
    setResendError(null);
    try {
      await resendFromLog({ id: log._id });
    } catch (e) {
      setResendError((e as Error).message);
    } finally {
      setResending(false);
    }
  }

  const lastBounceEvent = events?.find((e) => e.eventType === "bounced");

  return (
    <div className="mt-3 space-y-4 rounded-md border border-border bg-secondary/30 p-4">
      {log.status === "failed" && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <div className="flex items-center gap-2 text-destructive font-medium">
            <AlertTriangle size={16} /> Envío fallido
          </div>
          {log.errorMessage && (
            <p className="mt-1 text-destructive/80">{log.errorMessage}</p>
          )}
          {isAdmin && (
            <button
              onClick={handleResend}
              disabled={resending}
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={12} /> {resending ? "Reenviando..." : "Reenviar"}
            </button>
          )}
          {resendError && (
            <p className="mt-2 text-xs text-destructive">{resendError}</p>
          )}
        </div>
      )}

      {log.status === "bounced" && lastBounceEvent && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm">
          <p className="font-medium text-yellow-500">Email rebotado</p>
          {lastBounceEvent.metadata?.bounceReason && (
            <p className="mt-1 text-muted-foreground">
              Razón: {lastBounceEvent.metadata.bounceReason}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-xs text-muted-foreground">De:</span>{" "}
          {log.fromName ? `${log.fromName} <${log.fromEmail}>` : log.fromEmail}
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Para:</span> {log.toEmail}
        </div>
        {log.cc && log.cc.length > 0 && (
          <div>
            <span className="text-xs text-muted-foreground">CC:</span>{" "}
            {log.cc.join(", ")}
          </div>
        )}
        {log.replyTo && (
          <div>
            <span className="text-xs text-muted-foreground">Reply-To:</span>{" "}
            {log.replyTo}
          </div>
        )}
        {log.clientId && (
          <div>
            <span className="text-xs text-muted-foreground">Cliente:</span>{" "}
            <Link
              href={`/clientes/${log.clientId}`}
              className="text-accent hover:underline cursor-pointer"
            >
              Ver cliente
            </Link>
          </div>
        )}
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-2">{log.subject}</h4>
        {log.bodyHtml ? (
          <iframe
            srcDoc={log.bodyHtml}
            sandbox=""
            className="w-full h-96 rounded-md border border-border bg-white"
            title="Email body"
          />
        ) : (
          <p className="text-sm text-muted-foreground">(sin contenido HTML)</p>
        )}
      </div>

      {events && events.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Timeline
          </h5>
          <ul className="space-y-1 text-sm">
            {events.map((e) => (
              <li key={e._id} className="flex items-center gap-2">
                <EmailStatusBadge status={e.eventType} />
                <span className="text-xs text-muted-foreground">
                  {new Date(e.occurredAt).toLocaleString("es-MX")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {attachments && attachments.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Adjuntos
          </h5>
          <ul className="space-y-1">
            {attachments.map((att, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <Paperclip size={14} className="text-muted-foreground" />
                {att.url ? (
                  <a
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline cursor-pointer"
                  >
                    {att.filename}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{att.filename}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

"use client";
import { useState } from "react";
import { useAction } from "convex/react";
import DOMPurify from "isomorphic-dompurify";
import { api } from "../../../convex/_generated/api";
import { CheckCircle2 } from "lucide-react";
import Image from "next/image";
import { DeclineReasonDialog } from "./DeclineReasonDialog";
import { QuotationRespondedState } from "./QuotationRespondedState";
import { ExpiredState } from "./ExpiredState";
import { InvalidTokenState } from "./InvalidTokenState";

type Props = {
  token: string;
  quotation: { content: string; serviceName: string; tokenExpiresAt: number };
  client: { name: string; contactName?: string };
  issuingCompany: {
    name: string;
    logoStorageUrl: string | null;
    signatoryName?: string;
    primaryColor?: string;
    secondaryColor?: string;
    address?: unknown;
  } | null;
};

export function QuotationLandingContent({
  token,
  quotation,
  client,
  issuingCompany,
}: Props) {
  const acceptAction = useAction(api.functions.quotations.publicActions.acceptQuotation);
  const declineAction = useAction(api.functions.quotations.publicActions.declineQuotation);

  const [justResponded, setJustResponded] = useState<"approved" | "rejected" | "unknown" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<"expired" | "invalid" | null>(null);
  const [showDecline, setShowDecline] = useState(false);

  const primaryColor = issuingCompany?.primaryColor ?? "#1a1a2e";

  const handleAccept = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await acceptAction({ token });
      setJustResponded("approved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("expired")) setFatal("expired");
      else if (msg.includes("invalid_token")) setFatal("invalid");
      else if (msg.includes("already_responded")) setJustResponded("unknown");
      else setError("Hubo un problema. Intenta de nuevo o contacta a tu ejecutivo.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async (reason: string | undefined) => {
    setSubmitting(true);
    setError(null);
    try {
      await declineAction({ token, declineReason: reason });
      setJustResponded("rejected");
      setShowDecline(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("expired")) setFatal("expired");
      else if (msg.includes("invalid_token")) setFatal("invalid");
      else if (msg.includes("already_responded")) setJustResponded("unknown");
      else setError("Hubo un problema. Intenta de nuevo o contacta a tu ejecutivo.");
    } finally {
      setSubmitting(false);
    }
  };

  if (fatal === "expired") return <ExpiredState />;
  if (fatal === "invalid") return <InvalidTokenState />;
  if (justResponded === "approved" || justResponded === "rejected") {
    return <QuotationRespondedState status={justResponded} justNow respondedAt={Date.now()} />;
  }
  if (justResponded === "unknown") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">Esta cotización ya fue respondida</h1>
          <p className="text-sm text-muted-foreground">
            Si crees que es un error, contacta a tu ejecutivo.
          </p>
        </div>
      </div>
    );
  }

  const expiresDate = new Date(quotation.tokenExpiresAt).toLocaleDateString("es-MX", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="min-h-screen pb-28">
      <header className="border-b border-border px-6 py-4" style={{ borderBottomColor: `${primaryColor}30` }}>
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          {issuingCompany?.logoStorageUrl && (
            <Image
              src={issuingCompany.logoStorageUrl}
              alt={issuingCompany.name}
              width={48}
              height={48}
              className="rounded"
              unoptimized
            />
          )}
          <div>
            <p className="text-sm font-semibold" style={{ color: primaryColor }}>
              {issuingCompany?.name ?? "Cotización"}
            </p>
            {issuingCompany?.signatoryName && (
              <p className="text-xs text-muted-foreground">{issuingCompany.signatoryName}</p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(quotation.content, {
              USE_PROFILES: { html: true },
            }),
          }}
        />
      </main>

      <div
        className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur px-6 py-4"
        style={{ borderTopColor: `${primaryColor}30` }}
      >
        <div className="max-w-3xl mx-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">Vigencia: hasta el {expiresDate}</p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowDecline(true)}
              disabled={submitting}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary disabled:opacity-50"
            >
              Rechazar
            </button>
            <button
              onClick={handleAccept}
              disabled={submitting}
              className="flex items-center gap-2 rounded-md px-6 py-2 text-sm font-medium disabled:opacity-50"
              style={{ background: primaryColor, color: "white" }}
            >
              {submitting ? "Enviando..." : (<><CheckCircle2 size={16} /> Aceptar cotización</>)}
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-destructive text-center">{error}</p>}
      </div>

      {showDecline && (
        <DeclineReasonDialog
          primaryColor={primaryColor}
          onSubmit={handleDecline}
          onCancel={() => setShowDecline(false)}
        />
      )}
    </div>
  );
}

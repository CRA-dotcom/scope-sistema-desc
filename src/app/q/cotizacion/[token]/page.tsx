"use client";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { QuotationLandingContent } from "@/components/public/QuotationLandingContent";
import { QuotationRespondedState } from "@/components/public/QuotationRespondedState";
import { ExpiredState } from "@/components/public/ExpiredState";
import { InvalidTokenState } from "@/components/public/InvalidTokenState";

export default function PublicQuotationPage() {
  const params = useParams();
  const token = params.token as string;
  const result = useQuery(api.functions.quotations.publicQueries.getByToken, { token });

  if (result === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-accent" />
      </div>
    );
  }

  if (result.kind === "invalid") return <InvalidTokenState />;
  if (result.kind === "expired") return <ExpiredState />;
  if (result.kind === "already_responded") {
    return (
      <QuotationRespondedState
        status={result.status}
        respondedAt={result.respondedAt ?? undefined}
      />
    );
  }

  return (
    <QuotationLandingContent
      token={token}
      quotation={result.quotation}
      client={result.client}
      issuingCompany={result.issuingCompany}
    />
  );
}

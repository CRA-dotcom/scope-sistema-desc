"use client";

import { useState } from "react";
import { Id, Doc } from "../../../../convex/_generated/dataModel";
import { IssuingCompanyForm } from "./IssuingCompanyForm";
import { ServicesAssignmentEditor } from "./ServicesAssignmentEditor";
import { DangerZone } from "./DangerZone";
import { useUser } from "@clerk/nextjs";

type Tab = "info" | "services" | "danger";

export function IssuingCompanyDetailTabs({
  company,
}: {
  company: Doc<"issuingCompanies">;
}) {
  const { user } = useUser();
  const isAdmin =
    user?.organizationMemberships?.[0]?.role === "org:admin";
  const [tab, setTab] = useState<Tab>("info");

  const tabs: Array<{ id: Tab; label: string; adminOnly?: boolean }> = [
    { id: "info", label: "Información" },
    { id: "services", label: "Servicios que emite" },
    { id: "danger", label: "Zona de peligro", adminOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-border">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
              tab === t.id
                ? "border-b-2 border-accent text-accent"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "info" && (
        <IssuingCompanyForm
          mode="edit"
          initialData={{
            _id: company._id as Id<"issuingCompanies">,
            name: company.name,
            legalName: company.legalName,
            rfc: company.rfc,
            regimenFiscalCode: company.regimenFiscalCode,
            codigoPostal: company.codigoPostal,
            address: company.address,
            email: company.email,
            phone: company.phone,
            website: company.website,
            bankName: company.bankName,
            bankAccount: company.bankAccount,
            clabe: company.clabe,
            currency: company.currency,
            invoiceSerie: company.invoiceSerie,
            signatoryName: company.signatoryName,
            signatoryTitle: company.signatoryTitle,
            logoStorageId: company.logoStorageId,
          }}
        />
      )}
      {tab === "services" && (
        <ServicesAssignmentEditor
          companyId={company._id as Id<"issuingCompanies">}
        />
      )}
      {tab === "danger" && isAdmin && (
        <DangerZone
          companyId={company._id as Id<"issuingCompanies">}
          companyName={company.name}
          isActive={company.isActive}
          isDefault={company.isDefault}
        />
      )}
    </div>
  );
}

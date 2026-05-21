"use client";

/**
 * D2 §4.3 — `/configuracion/branding`
 *
 * Org-admin wrapper of the branding editor. Reuses `BrandingForm` (shared
 * with `/platform/orgs/[id]/branding`). All backend writes flow through
 * `orgBranding.mutations.upsert` (Phase 1 refactor: accepts `requireAdmin`
 * when caller omits `orgId`).
 *
 * Auth gate: `org:admin` only. Members get redirected back to
 * `/configuracion`.
 */

import Link from "next/link";
import { Palette, ChevronLeft, Loader2 } from "lucide-react";
import { useOrganization } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { BrandingForm, type BrandingFormValues } from "@/components/branding/BrandingForm";

export default function BrandingPage() {
  const { organization, membership, isLoaded } = useOrganization();
  const router = useRouter();
  const isAdmin = membership?.role === "org:admin";

  useEffect(() => {
    if (isLoaded && !isAdmin) {
      router.replace("/configuracion");
    }
  }, [isLoaded, isAdmin, router]);

  const branding = useQuery(
    api.functions.orgBranding.queries.getByOrgId,
    isLoaded && isAdmin ? {} : "skip"
  );

  const logoUrl = useQuery(
    api.functions.orgBranding.queries.getLogoUrl,
    branding?.logoStorageId ? { storageId: branding.logoStorageId } : "skip"
  );

  const upsertBranding = useMutation(
    api.functions.orgBranding.mutations.upsert
  );
  const generateUploadUrl = useMutation(
    api.functions.orgBranding.mutations.generateUploadUrl
  );

  if (!isLoaded || !isAdmin) return null;

  const handleSave = async (values: BrandingFormValues) => {
    // Org-admin path: omit `orgId` so the server uses the caller's own.
    await upsertBranding({
      companyName: values.companyName,
      logoStorageId: values.logoStorageId,
      primaryColor: values.primaryColor,
      secondaryColor: values.secondaryColor,
      accentColor: values.accentColor,
      fontFamily: values.fontFamily,
      headerText: values.headerText,
      footerText: values.footerText,
    });
  };

  const handleUpload = async (file: File): Promise<Id<"_storage">> => {
    const uploadUrl = await generateUploadUrl();
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!response.ok) {
      throw new Error("Error al subir el logo.");
    }
    const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
    return storageId;
  };

  // branding === undefined → loading; branding === null → no row yet
  if (branding === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2
          className="h-6 w-6 animate-spin text-accent"
          aria-label="Cargando branding"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} aria-hidden="true" /> Configuración
      </Link>

      <div className="flex items-center gap-3">
        <Palette className="text-accent" size={28} aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold">Branding</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Configuración visual aplicada a los documentos de{" "}
            {organization?.name ?? "tu organización"}.
          </p>
        </div>
      </div>

      <BrandingForm
        branding={branding}
        logoUrl={logoUrl}
        defaultCompanyName={organization?.name ?? undefined}
        onSave={handleSave}
        onUpload={handleUpload}
        mode="org"
      />
    </div>
  );
}

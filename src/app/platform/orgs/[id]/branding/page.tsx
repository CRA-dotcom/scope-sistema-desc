"use client";

import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, Save, Loader2, Upload, Image as ImageIcon } from "lucide-react";
import Link from "next/link";

const FONT_OPTIONS = [
  "IBM Plex Sans",
  "Inter",
  "Montserrat",
  "Roboto",
  "Open Sans",
] as const;

export default function BrandingPage() {
  const params = useParams();
  const orgInternalId = params.id as string;

  // Fetch org to get clerkOrgId
  const org = useQuery(
    api.functions.organizations.queries.getByIdForAdmin,
    { id: orgInternalId as Id<"organizations"> }
  );

  const clerkOrgId = org?.clerkOrgId;

  const branding = useQuery(
    api.functions.orgBranding.queries.getByOrgIdForAdmin,
    clerkOrgId ? { orgId: clerkOrgId } : "skip"
  );

  const logoUrl = useQuery(
    api.functions.orgBranding.queries.getLogoUrl,
    branding?.logoStorageId ? { storageId: branding.logoStorageId } : "skip"
  );

  const upsertBranding = useMutation(api.functions.orgBranding.mutations.upsert);
  const generateUploadUrl = useMutation(api.functions.orgBranding.mutations.generateUploadUrl);

  // Form state
  const [companyName, setCompanyName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#3B82F6");
  const [secondaryColor, setSecondaryColor] = useState("#1E293B");
  const [accentColor, setAccentColor] = useState("#8B5CF6");
  const [fontFamily, setFontFamily] = useState<string>("Inter");
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [logoStorageId, setLogoStorageId] = useState<Id<"_storage"> | undefined>(undefined);
  const [localLogoUrl, setLocalLogoUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize form from loaded data
  const initForm = useCallback(() => {
    if (branding) {
      setCompanyName(branding.companyName);
      setPrimaryColor(branding.primaryColor);
      setSecondaryColor(branding.secondaryColor);
      setAccentColor(branding.accentColor ?? "#8B5CF6");
      setFontFamily(branding.fontFamily);
      setHeaderText(branding.headerText ?? "");
      setFooterText(branding.footerText ?? "");
      setLogoStorageId(branding.logoStorageId);
    } else if (org && branding === null) {
      // No branding yet, set defaults
      setCompanyName(org.name);
    }
  }, [branding, org]);

  useEffect(() => {
    initForm();
  }, [initForm]);

  // Set logo preview URL
  useEffect(() => {
    if (logoUrl) {
      setLocalLogoUrl(logoUrl);
    }
  }, [logoUrl]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Solo se permiten archivos de imagen.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError("El archivo no puede exceder 2MB.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = await response.json();
      setLogoStorageId(storageId);
      setLocalLogoUrl(URL.createObjectURL(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir logo");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!clerkOrgId) return;

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      if (!companyName.trim()) {
        setError("El nombre de la empresa es requerido.");
        setSaving(false);
        return;
      }

      await upsertBranding({
        orgId: clerkOrgId,
        companyName: companyName.trim(),
        logoStorageId: logoStorageId,
        primaryColor,
        secondaryColor,
        accentColor: accentColor || undefined,
        fontFamily,
        headerText: headerText.trim() || undefined,
        footerText: footerText.trim() || undefined,
      });

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  // Loading state
  if (org === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (org === null) {
    return (
      <div className="py-20 text-center text-sm text-red-400">
        Organización no encontrada o sin permisos.
      </div>
    );
  }

  const effectiveLogoUrl = localLogoUrl;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href={`/platform/orgs/${orgInternalId}`}
          className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Branding</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {org.name} &mdash; Configuración visual de documentos
          </p>
        </div>
      </div>

      {/* Error / Success banners */}
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          Branding guardado correctamente.
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left Column: Form */}
        <div className="space-y-6">
          {/* Company Name */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Identidad</h2>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Nombre de la Empresa
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="Nombre de la empresa"
              />
            </div>

            {/* Logo Upload */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Logo
              </label>
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-border bg-secondary overflow-hidden">
                  {effectiveLogoUrl ? (
                    <img
                      src={effectiveLogoUrl}
                      alt="Logo"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <ImageIcon size={24} className="text-muted-foreground" />
                  )}
                </div>
                <div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
                  >
                    {uploading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Upload size={14} />
                    )}
                    {uploading ? "Subiendo..." : "Subir Logo"}
                  </button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    PNG, JPG o SVG. Max 2MB.
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
              </div>
            </div>
          </section>

          {/* Colors */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Colores</h2>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                  Primario
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-10 w-10 cursor-pointer rounded border border-border bg-transparent"
                  />
                  <input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs font-mono text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                  Secundario
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    className="h-10 w-10 cursor-pointer rounded border border-border bg-transparent"
                  />
                  <input
                    type="text"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    className="w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs font-mono text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                  Acento
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="h-10 w-10 cursor-pointer rounded border border-border bg-transparent"
                  />
                  <input
                    type="text"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs font-mono text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Typography & Text */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Tipografia y Texto</h2>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Fuente
              </label>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {FONT_OPTIONS.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Texto de Encabezado
              </label>
              <input
                type="text"
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="Texto que aparece en el encabezado de documentos"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Texto de Pie de Pagina
              </label>
              <input
                type="text"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="Texto que aparece en el pie de pagina"
              />
            </div>
          </section>
        </div>

        {/* Right Column: Preview */}
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Vista Previa</h2>
            <p className="text-xs text-muted-foreground">
              Ejemplo de como se veria el encabezado de un documento generado.
            </p>

            {/* Document Preview */}
            <div className="overflow-hidden rounded-lg border border-border bg-white shadow-lg">
              {/* Header */}
              <div
                className="flex items-center gap-4 px-6 py-4"
                style={{ backgroundColor: primaryColor }}
              >
                {effectiveLogoUrl ? (
                  <img
                    src={effectiveLogoUrl}
                    alt="Logo"
                    className="h-10 w-10 rounded object-contain bg-white/20 p-1"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-white/20">
                    <ImageIcon size={20} className="text-white/70" />
                  </div>
                )}
                <div>
                  <h3
                    className="text-base font-bold text-white"
                    style={{ fontFamily }}
                  >
                    {companyName || "Nombre de Empresa"}
                  </h3>
                  {headerText && (
                    <p
                      className="text-xs text-white/80"
                      style={{ fontFamily }}
                    >
                      {headerText}
                    </p>
                  )}
                </div>
              </div>

              {/* Accent bar */}
              <div className="h-1" style={{ backgroundColor: accentColor }} />

              {/* Body preview */}
              <div className="px-6 py-5 space-y-3">
                <div
                  className="h-3 w-3/4 rounded"
                  style={{ backgroundColor: secondaryColor, opacity: 0.15 }}
                />
                <div
                  className="h-3 w-full rounded"
                  style={{ backgroundColor: secondaryColor, opacity: 0.1 }}
                />
                <div
                  className="h-3 w-5/6 rounded"
                  style={{ backgroundColor: secondaryColor, opacity: 0.1 }}
                />
                <div
                  className="h-3 w-2/3 rounded"
                  style={{ backgroundColor: secondaryColor, opacity: 0.1 }}
                />
                <div className="pt-3">
                  <div
                    className="h-3 w-1/2 rounded"
                    style={{ backgroundColor: accentColor, opacity: 0.2 }}
                  />
                </div>
              </div>

              {/* Footer */}
              {footerText && (
                <div
                  className="border-t px-6 py-3"
                  style={{ borderColor: `${secondaryColor}20` }}
                >
                  <p
                    className="text-xs"
                    style={{ color: secondaryColor, fontFamily, opacity: 0.6 }}
                  >
                    {footerText}
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Color Swatches Summary */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Paleta Actual</h3>
            <div className="flex gap-3">
              <div className="text-center">
                <div
                  className="h-12 w-12 rounded-lg border border-border shadow-sm"
                  style={{ backgroundColor: primaryColor }}
                />
                <span className="mt-1 block text-xs text-muted-foreground">Primario</span>
              </div>
              <div className="text-center">
                <div
                  className="h-12 w-12 rounded-lg border border-border shadow-sm"
                  style={{ backgroundColor: secondaryColor }}
                />
                <span className="mt-1 block text-xs text-muted-foreground">Secundario</span>
              </div>
              <div className="text-center">
                <div
                  className="h-12 w-12 rounded-lg border border-border shadow-sm"
                  style={{ backgroundColor: accentColor }}
                />
                <span className="mt-1 block text-xs text-muted-foreground">Acento</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground" style={{ fontFamily }}>
              Fuente: {fontFamily}
            </p>
          </section>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pb-8">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          Guardar Branding
        </button>
      </div>
    </div>
  );
}

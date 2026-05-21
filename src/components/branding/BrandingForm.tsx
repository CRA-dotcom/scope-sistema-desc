"use client";

/**
 * D2 §4.3 — `BrandingForm`
 *
 * Reusable branding editor shared by:
 *   - `/configuracion/branding` (org-admin, edits own org — `mode="org"`)
 *   - `/platform/orgs/[id]/branding` (super-admin, edits any org — `mode="platform"`)
 *
 * The form encapsulates: identidad (companyName + logo), colors,
 * tipografía + textos, and an inline live preview (HTML/CSS only — see spec §8 Q2).
 *
 * Upload validation: PNG/JPG/SVG + max 1MB (spec §7 — more conservative than
 * the legacy 2MB super-admin cap to avoid bucket bloat with N orgs).
 *
 * The component is presentational + state-only — the parent decides how to
 * resolve the storageId to a URL and how to call the upsert mutation, so
 * org-admin (no `orgId` arg) and super-admin (must pass `orgId`) paths can
 * share the same UI without leaking auth semantics.
 */

import { Id } from "../../../convex/_generated/dataModel";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Save,
  Loader2,
  Upload,
  Image as ImageIcon,
} from "lucide-react";

const FONT_OPTIONS = [
  "IBM Plex Sans",
  "Inter",
  "Montserrat",
  "Roboto",
  "Open Sans",
] as const;

/** Client-side cap for logo uploads (spec §7). */
export const MAX_LOGO_BYTES = 1 * 1024 * 1024;

/** Hex regex enforced client-side (spec §4.3 validations). */
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export type BrandingFormValues = {
  companyName: string;
  logoStorageId?: Id<"_storage">;
  primaryColor: string;
  secondaryColor: string;
  accentColor?: string;
  fontFamily: string;
  headerText?: string;
  footerText?: string;
};

/** Shape returned by `orgBranding.getByOrgId` / `getByOrgIdForAdmin`. */
export type BrandingDoc = {
  companyName: string;
  logoStorageId?: Id<"_storage">;
  primaryColor: string;
  secondaryColor: string;
  accentColor?: string;
  fontFamily: string;
  headerText?: string;
  footerText?: string;
};

export interface BrandingFormProps {
  /** Existing branding doc (or null when org has no row yet). */
  branding: BrandingDoc | null | undefined;
  /** Resolved logo URL (parent uses `getLogoUrl` against branding.logoStorageId). */
  logoUrl: string | null | undefined;
  /** Initial company name fallback when no branding exists yet. */
  defaultCompanyName?: string;
  /** Caller persists the form. Args mirror `orgBranding.mutations.upsert`. */
  onSave: (values: BrandingFormValues) => Promise<void>;
  /** Caller generates a Convex storage upload URL + returns the storageId. */
  onUpload: (file: File) => Promise<Id<"_storage">>;
  /** Distinguishes copy / footer hints between org-admin and platform paths. */
  mode: "org" | "platform";
}

export function BrandingForm({
  branding,
  logoUrl,
  defaultCompanyName,
  onSave,
  onUpload,
  mode,
}: BrandingFormProps) {
  const [companyName, setCompanyName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#3B82F6");
  const [secondaryColor, setSecondaryColor] = useState("#1E293B");
  const [accentColor, setAccentColor] = useState("#8B5CF6");
  const [fontFamily, setFontFamily] = useState<string>("Inter");
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [logoStorageId, setLogoStorageId] = useState<
    Id<"_storage"> | undefined
  >(undefined);
  const [localLogoUrl, setLocalLogoUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize form from loaded branding doc.
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
    } else if (branding === null && defaultCompanyName) {
      setCompanyName(defaultCompanyName);
    }
  }, [branding, defaultCompanyName]);

  useEffect(() => {
    initForm();
  }, [initForm]);

  // Push the resolved logo URL into local state so the preview reacts.
  useEffect(() => {
    if (logoUrl) {
      setLocalLogoUrl(logoUrl);
    }
  }, [logoUrl]);

  const handleLogoUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Solo se permiten archivos de imagen.");
      return;
    }

    if (file.size > MAX_LOGO_BYTES) {
      setError("El logo no puede exceder 1MB.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const storageId = await onUpload(file);
      setLogoStorageId(storageId);
      setLocalLogoUrl(URL.createObjectURL(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir logo");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      if (!companyName.trim()) {
        setError("El nombre de la empresa es requerido.");
        setSaving(false);
        return;
      }
      if (!HEX_COLOR_REGEX.test(primaryColor)) {
        setError("El color primario debe ser un hex válido (#RRGGBB).");
        setSaving(false);
        return;
      }
      if (!HEX_COLOR_REGEX.test(secondaryColor)) {
        setError("El color secundario debe ser un hex válido (#RRGGBB).");
        setSaving(false);
        return;
      }
      if (accentColor && !HEX_COLOR_REGEX.test(accentColor)) {
        setError("El color de acento debe ser un hex válido (#RRGGBB).");
        setSaving(false);
        return;
      }

      await onSave({
        companyName: companyName.trim(),
        logoStorageId,
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

  const effectiveLogoUrl = localLogoUrl;

  return (
    <div className="space-y-6">
      {/* Error / Success banners */}
      {error && (
        <div
          className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
          role="alert"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          className="rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400"
          role="status"
        >
          Branding guardado correctamente.
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left Column: Form */}
        <div className="space-y-6">
          {/* Company Name + Logo */}
          <section
            className="rounded-lg border border-border bg-card p-6 space-y-4"
            aria-labelledby="branding-identidad-heading"
          >
            <h2
              id="branding-identidad-heading"
              className="text-lg font-semibold text-foreground"
            >
              Identidad
            </h2>

            <div>
              <label
                htmlFor="branding-companyName"
                className="mb-1.5 block text-sm font-medium text-muted-foreground"
              >
                Nombre de la Empresa
              </label>
              <input
                id="branding-companyName"
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
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={effectiveLogoUrl}
                      alt="Logo de la empresa"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <ImageIcon
                      size={24}
                      className="text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
                  >
                    {uploading ? (
                      <Loader2
                        size={14}
                        className="animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Upload size={14} aria-hidden="true" />
                    )}
                    {uploading ? "Subiendo..." : "Subir Logo"}
                  </button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    PNG, JPG o SVG. Max 1MB.
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                  aria-label="Subir logo de la empresa"
                  data-testid="branding-logo-input"
                />
              </div>
            </div>
          </section>

          {/* Colors */}
          <section
            className="rounded-lg border border-border bg-card p-6 space-y-4"
            aria-labelledby="branding-colores-heading"
          >
            <h2
              id="branding-colores-heading"
              className="text-lg font-semibold text-foreground"
            >
              Colores
            </h2>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="branding-color-primary"
                  className="mb-1.5 block text-sm font-medium text-muted-foreground"
                >
                  Primario
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="branding-color-primary"
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-10 w-10 cursor-pointer rounded border border-border bg-transparent"
                    aria-label="Color primario picker"
                  />
                  <input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs font-mono text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    aria-label="Color primario hex"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="branding-color-secondary"
                  className="mb-1.5 block text-sm font-medium text-muted-foreground"
                >
                  Secundario
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="branding-color-secondary"
                    type="color"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    className="h-10 w-10 cursor-pointer rounded border border-border bg-transparent"
                    aria-label="Color secundario picker"
                  />
                  <input
                    type="text"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    className="w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs font-mono text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    aria-label="Color secundario hex"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="branding-color-accent"
                  className="mb-1.5 block text-sm font-medium text-muted-foreground"
                >
                  Acento
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="branding-color-accent"
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="h-10 w-10 cursor-pointer rounded border border-border bg-transparent"
                    aria-label="Color acento picker"
                  />
                  <input
                    type="text"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-xs font-mono text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    aria-label="Color acento hex"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Typography & Text */}
          <section
            className="rounded-lg border border-border bg-card p-6 space-y-4"
            aria-labelledby="branding-tipografia-heading"
          >
            <h2
              id="branding-tipografia-heading"
              className="text-lg font-semibold text-foreground"
            >
              Tipografía y Texto
            </h2>

            <div>
              <label
                htmlFor="branding-font"
                className="mb-1.5 block text-sm font-medium text-muted-foreground"
              >
                Fuente
              </label>
              <select
                id="branding-font"
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
              <label
                htmlFor="branding-header"
                className="mb-1.5 block text-sm font-medium text-muted-foreground"
              >
                Texto de Encabezado
              </label>
              <input
                id="branding-header"
                type="text"
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="Texto que aparece en el encabezado de documentos"
              />
            </div>

            <div>
              <label
                htmlFor="branding-footer"
                className="mb-1.5 block text-sm font-medium text-muted-foreground"
              >
                Texto de Pie de Página
              </label>
              <input
                id="branding-footer"
                type="text"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="Texto que aparece en el pie de página"
              />
            </div>
          </section>
        </div>

        {/* Right Column: Preview */}
        <div className="space-y-6">
          <section
            className="rounded-lg border border-border bg-card p-6 space-y-4"
            aria-labelledby="branding-preview-heading"
          >
            <h2
              id="branding-preview-heading"
              className="text-lg font-semibold text-foreground"
            >
              Vista Previa
            </h2>
            <p className="text-xs text-muted-foreground">
              Ejemplo de cómo se vería el encabezado de un documento generado.
            </p>

            {/* Document Preview */}
            <div className="overflow-hidden rounded-lg border border-border bg-white shadow-lg">
              <div
                className="flex items-center gap-4 px-6 py-4"
                style={{ backgroundColor: primaryColor }}
              >
                {effectiveLogoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={effectiveLogoUrl}
                    alt="Vista previa del logo"
                    className="h-10 w-10 rounded object-contain bg-white/20 p-1"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-white/20">
                    <ImageIcon
                      size={20}
                      className="text-white/70"
                      aria-hidden="true"
                    />
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

              <div className="h-1" style={{ backgroundColor: accentColor }} />

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

              {footerText && (
                <div
                  className="border-t px-6 py-3"
                  style={{ borderColor: `${secondaryColor}20` }}
                >
                  <p
                    className="text-xs"
                    style={{
                      color: secondaryColor,
                      fontFamily,
                      opacity: 0.6,
                    }}
                  >
                    {footerText}
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-6 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              Paleta Actual
            </h3>
            <div className="flex gap-3">
              <div className="text-center">
                <div
                  className="h-12 w-12 rounded-lg border border-border shadow-sm"
                  style={{ backgroundColor: primaryColor }}
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Primario
                </span>
              </div>
              <div className="text-center">
                <div
                  className="h-12 w-12 rounded-lg border border-border shadow-sm"
                  style={{ backgroundColor: secondaryColor }}
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Secundario
                </span>
              </div>
              <div className="text-center">
                <div
                  className="h-12 w-12 rounded-lg border border-border shadow-sm"
                  style={{ backgroundColor: accentColor }}
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Acento
                </span>
              </div>
            </div>
            <p
              className="text-xs text-muted-foreground"
              style={{ fontFamily }}
            >
              Fuente: {fontFamily}
            </p>
            {mode === "org" && (
              <p className="text-xs text-muted-foreground/70">
                Estos ajustes aplican a todos los documentos generados por tu
                organización.
              </p>
            )}
          </section>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pb-8">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          data-testid="branding-save-btn"
          className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <Save size={16} aria-hidden="true" />
          )}
          Guardar Branding
        </button>
      </div>
    </div>
  );
}

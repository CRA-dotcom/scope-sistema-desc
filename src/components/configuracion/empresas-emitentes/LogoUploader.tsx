"use client";

import { useState, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Upload, X } from "lucide-react";

const MAX_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml"];

export function LogoUploader({
  companyId,
}: {
  companyId: Id<"issuingCompanies">;
  currentStorageId?: Id<"_storage">;
}) {
  const generateUploadUrl = useMutation(
    api.functions.issuingCompanies.mutations.generateUploadUrl
  );
  const setLogoFromStorage = useMutation(
    api.functions.issuingCompanies.mutations.setLogoFromStorage
  );
  const removeLogo = useMutation(
    api.functions.issuingCompanies.mutations.removeLogo
  );
  const currentUrl = useQuery(
    api.functions.issuingCompanies.queries.getLogoUrl,
    { id: companyId }
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > MAX_SIZE_BYTES) {
      setError("El archivo excede 2 MB");
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Solo PNG, JPEG o SVG");
      return;
    }
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl({ id: companyId });
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("Error subiendo el archivo");
      const { storageId } = (await res.json()) as {
        storageId: Id<"_storage">;
      };
      await setLogoFromStorage({ id: companyId, storageId });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setError(null);
    try {
      await removeLogo({ id: companyId });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      {currentUrl ? (
        <div className="flex items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentUrl}
            alt="Logo"
            className="h-24 w-24 rounded-md border border-border bg-secondary object-contain p-2"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary transition-colors cursor-pointer"
            >
              Reemplazar
            </button>
            <button
              type="button"
              onClick={handleRemove}
              className="rounded-md border border-destructive/20 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
            >
              <X size={14} className="inline mr-1" /> Quitar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-secondary/50 py-8 text-sm text-muted-foreground hover:border-accent hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
        >
          {uploading ? (
            <span>Subiendo...</span>
          ) : (
            <>
              <Upload size={18} />
              <span>Click para subir logo (PNG, JPEG, SVG, máx 2MB)</span>
            </>
          )}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

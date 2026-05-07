"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, X, RefreshCw, FileText, Image, Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileUploadValue = {
  storageId: string;
  filename: string;
};

export type FileConfig = {
  acceptedMimeTypes: string[];
  maxSizeMB: number;
  multiple: boolean;
};

export type FileUploadFieldProps = {
  /** Question metadata */
  questionId: string;
  questionText: string;
  fileConfig: FileConfig;
  required?: boolean;

  /**
   * Current value (storage ID + filename) — populated when re-editing a
   * previously answered file_upload question.
   */
  value?: FileUploadValue | null;

  /**
   * Caller-provided upload mechanic. The parent resolves authentication:
   *  - Internal (Clerk session): generates upload URL via authenticated mutation
   *  - Public (token): generates upload URL via token-validated mutation
   *
   * Receives the File and must return { storageId, filename }.
   */
  uploadFn: (file: File) => Promise<FileUploadValue>;

  /** Called after a successful upload or when the user clears the file. */
  onChange: (value: FileUploadValue | null) => void;

  /**
   * Optional: resolves a storageId to a signed download URL so the
   * component can render a preview / download link for existing uploads.
   */
  getDownloadUrlFn?: (storageId: string) => Promise<string | null>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

function humanMimeList(mimes: string[]): string {
  return mimes
    .map((m) => m.replace(/^(image|application|text)\//, "").toUpperCase())
    .join(", ");
}

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "success"; value: FileUploadValue; previewUrl?: string; sizeBytes: number; mimeType: string }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileUploadField({
  questionId,
  fileConfig,
  required,
  value,
  uploadFn,
  onChange,
  getDownloadUrlFn,
}: FileUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Initialise state from `value` prop (re-edit scenario)
  const [uploadState, setUploadState] = useState<UploadState>(() => {
    if (value) {
      return {
        status: "success",
        value,
        previewUrl: undefined,
        sizeBytes: 0,
        mimeType: "",
      };
    }
    return { status: "idle" };
  });

  // Resolve download URL lazily when getDownloadUrlFn is available and we
  // have a storageId but no local previewUrl yet.
  const resolveDownloadUrl = useCallback(
    async (storageId: string) => {
      if (!getDownloadUrlFn) return;
      try {
        const url = await getDownloadUrlFn(storageId);
        if (url) {
          setUploadState((prev) =>
            prev.status === "success"
              ? { ...prev, previewUrl: url }
              : prev
          );
        }
      } catch {
        // Non-fatal — preview just won't render
      }
    },
    [getDownloadUrlFn]
  );

  // Kick off URL resolution when we enter success state without a previewUrl
  const handleResolveUrl = useCallback(
    (storageId: string, previewUrl?: string) => {
      if (!previewUrl && getDownloadUrlFn) {
        void resolveDownloadUrl(storageId);
      }
    },
    [getDownloadUrlFn, resolveDownloadUrl]
  );

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  function validate(file: File): string | null {
    const maxBytes = fileConfig.maxSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      return `El archivo excede el límite de ${fileConfig.maxSizeMB} MB (tamaño: ${formatBytes(file.size)}).`;
    }
    if (
      fileConfig.acceptedMimeTypes.length > 0 &&
      !fileConfig.acceptedMimeTypes.includes(file.type)
    ) {
      return `Tipo de archivo no permitido. Tipos aceptados: ${humanMimeList(fileConfig.acceptedMimeTypes)}.`;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Upload flow
  // -------------------------------------------------------------------------

  async function handleFile(file: File) {
    const error = validate(file);
    if (error) {
      setUploadState({ status: "error", message: error });
      return;
    }

    setUploadState({ status: "uploading" });

    try {
      const result = await uploadFn(file);

      // Build a local object URL for immediate preview if image
      const previewUrl = isImageMime(file.type)
        ? URL.createObjectURL(file)
        : undefined;

      setUploadState({
        status: "success",
        value: result,
        previewUrl,
        sizeBytes: file.size,
        mimeType: file.type,
      });

      onChange(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al subir el archivo.";
      setUploadState({ status: "error", message });
    }
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Reset so re-selecting same file still fires onChange
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleClear() {
    // Revoke local object URL to avoid memory leaks
    if (uploadState.status === "success" && uploadState.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(uploadState.previewUrl);
    }
    setUploadState({ status: "idle" });
    onChange(null);
  }

  function handleReplace() {
    inputRef.current?.click();
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const acceptAttr =
    fileConfig.acceptedMimeTypes.length > 0
      ? fileConfig.acceptedMimeTypes.join(",")
      : undefined;

  // Hidden file input (shared across idle, error and replace flows)
  const hiddenInput = (
    <input
      ref={inputRef}
      id={`file-upload-${questionId}`}
      type="file"
      accept={acceptAttr}
      multiple={fileConfig.multiple}
      className="sr-only"
      onChange={handleInputChange}
      aria-required={required}
    />
  );

  // -------------------------------------------------------------------------
  // State: uploading
  // -------------------------------------------------------------------------
  if (uploadState.status === "uploading") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin text-accent" />
        <span>Subiendo...</span>
        {hiddenInput}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // State: success
  // -------------------------------------------------------------------------
  if (uploadState.status === "success") {
    const { value: uploaded, previewUrl, sizeBytes, mimeType } = uploadState;
    const isImg = mimeType ? isImageMime(mimeType) : false;

    // Lazily resolve download URL if it wasn't set from a local object URL
    if (!previewUrl && uploaded.storageId) {
      handleResolveUrl(uploaded.storageId, previewUrl);
    }

    return (
      <div className="rounded-md border border-border bg-card">
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Thumbnail or generic icon */}
          <div className="flex-shrink-0">
            {isImg && previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={uploaded.filename}
                className="h-12 w-12 rounded-md border border-border object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-secondary">
                {isImg ? (
                  <Image size={20} className="text-muted-foreground" />
                ) : (
                  <FileText size={20} className="text-muted-foreground" />
                )}
              </div>
            )}
          </div>

          {/* File info */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {uploaded.filename}
            </p>
            {sizeBytes > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatBytes(sizeBytes)}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReplace}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer"
              aria-label="Reemplazar archivo"
            >
              <RefreshCw size={12} />
              Reemplazar
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-1.5 rounded-md border border-destructive/20 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
              aria-label="Eliminar archivo"
            >
              <X size={12} />
              Eliminar
            </button>
          </div>
        </div>
        {hiddenInput}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // State: idle or error — show drop zone
  // -------------------------------------------------------------------------
  const errorMessage =
    uploadState.status === "error" ? uploadState.message : null;

  const hintParts: string[] = [];
  if (fileConfig.acceptedMimeTypes.length > 0) {
    hintParts.push(humanMimeList(fileConfig.acceptedMimeTypes));
  }
  hintParts.push(`máx ${fileConfig.maxSizeMB} MB`);
  const hintText = hintParts.join(" · ");

  return (
    <div className="space-y-1.5">
      <div
        role="button"
        tabIndex={0}
        aria-label="Zona de carga de archivo"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={[
          "flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed py-8 text-sm transition-colors",
          dragOver
            ? "border-accent bg-accent/5 text-foreground"
            : "border-border bg-secondary/50 text-muted-foreground hover:border-accent/60 hover:bg-secondary hover:text-foreground",
        ].join(" ")}
      >
        <Upload size={20} />
        <span className="font-medium">
          {dragOver ? "Suelta el archivo aquí" : "+ Subir archivo"}
        </span>
        {hintText && (
          <span className="text-xs text-muted-foreground">{hintText}</span>
        )}
      </div>
      {hiddenInput}
      {errorMessage && (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

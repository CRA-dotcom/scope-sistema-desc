"use client";

type QuestionType =
  | "text"
  | "textarea"
  | "select"
  | "number"
  | "date"
  | "file_upload";

export interface QuestionFieldProps {
  questionId: string;
  type: QuestionType | undefined;
  value: string;
  onChange: (v: string) => void;
  options?: string[];
  disabled?: boolean;
  placeholder?: string;
}

const baseInputClass =
  "w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:bg-slate-100 disabled:text-slate-500";

export function QuestionField({
  questionId,
  type,
  value,
  onChange,
  options,
  disabled,
  placeholder,
}: QuestionFieldProps) {
  switch (type) {
    case "textarea":
      return (
        <textarea
          id={questionId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          rows={4}
          className={baseInputClass}
        />
      );
    case "number":
      return (
        <input
          id={questionId}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={baseInputClass}
        />
      );
    case "date":
      return (
        <input
          id={questionId}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={baseInputClass}
        />
      );
    case "select":
      return (
        <select
          id={questionId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={baseInputClass}
        >
          <option value="">— Seleccione —</option>
          {(options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case "file_upload":
      // Defer to existing FileUploadField if available; for now fallback to text.
      return (
        <input
          id={questionId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="(carga de archivos no habilitada)"
          className={baseInputClass}
        />
      );
    case "text":
    default:
      return (
        <input
          id={questionId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={baseInputClass}
        />
      );
  }
}

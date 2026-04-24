type EmailType =
  | "quotation"
  | "quotation_reminder"
  | "contract"
  | "contract_reminder"
  | "deliverable"
  | "questionnaire"
  | "reminder"
  | "custom";

const LABELS: Record<EmailType, { label: string; cls: string }> = {
  quotation: { label: "Cotización", cls: "bg-accent/10 text-accent" },
  quotation_reminder: { label: "Recordatorio cot.", cls: "bg-accent/5 text-accent/70" },
  contract: { label: "Contrato", cls: "bg-accent/10 text-accent" },
  contract_reminder: { label: "Recordatorio contr.", cls: "bg-accent/5 text-accent/70" },
  deliverable: { label: "Entregable", cls: "bg-purple-500/10 text-purple-500" },
  questionnaire: { label: "Cuestionario", cls: "bg-sky-500/10 text-sky-500" },
  reminder: { label: "Recordatorio", cls: "bg-orange-500/10 text-orange-500" },
  custom: { label: "Otro", cls: "bg-muted text-muted-foreground" },
};

export function EmailTypeBadge({ type }: { type: string }) {
  const entry =
    (LABELS as Record<string, typeof LABELS.custom>)[type] ?? LABELS.custom;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${entry.cls}`}
    >
      {entry.label}
    </span>
  );
}

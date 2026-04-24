import { CircleDashed, Send, Check, MailOpen, MousePointer, AlertTriangle, X, Clock } from "lucide-react";

type Status =
  | "queued"
  | "sent"
  | "delivered"
  | "delivery_delayed"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained"
  | "failed";

const STYLES: Record<Status, { label: string; cls: string; Icon: typeof Send }> = {
  queued: { label: "En cola", cls: "bg-muted text-muted-foreground", Icon: CircleDashed },
  sent: { label: "Enviado", cls: "bg-blue-500/10 text-blue-500", Icon: Send },
  delivered: { label: "Entregado", cls: "bg-emerald-500/10 text-emerald-500", Icon: Check },
  delivery_delayed: { label: "Entrega retrasada", cls: "bg-yellow-500/10 text-yellow-500", Icon: Clock },
  opened: { label: "Abierto", cls: "bg-emerald-600/15 text-emerald-600", Icon: MailOpen },
  clicked: { label: "Clickeado", cls: "bg-emerald-700/20 text-emerald-700", Icon: MousePointer },
  bounced: { label: "Rebotado", cls: "bg-destructive/10 text-destructive", Icon: AlertTriangle },
  complained: { label: "Reportado spam", cls: "bg-destructive/20 text-destructive", Icon: AlertTriangle },
  failed: { label: "Falló", cls: "bg-destructive/10 text-destructive", Icon: X },
};

export function EmailStatusBadge({ status }: { status: string }) {
  const entry = (STYLES as Record<string, typeof STYLES.sent>)[status] ?? STYLES.queued;
  const { label, cls, Icon } = entry;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${cls}`}>
      <Icon size={10} /> {label}
    </span>
  );
}

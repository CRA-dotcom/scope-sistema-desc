"use client";

/**
 * D2 §4.5 — `/configuracion/notificaciones`
 *
 * Form for the org's `notificationEmail`, `reminderHourLocal`, and per-event
 * toggles. Uses inline banners for feedback (no toast library in this repo)
 * and the `sendTestNotification` action for the "Enviar prueba" button.
 *
 * Auth gate: `org:admin` only.
 */

import Link from "next/link";
import { Bell, ChevronLeft, Send, Save, Loader2 } from "lucide-react";
import { useOrganization } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function NotificacionesPage() {
  const { membership, isLoaded } = useOrganization();
  const router = useRouter();
  const isAdmin = membership?.role === "org:admin";

  useEffect(() => {
    if (isLoaded && !isAdmin) {
      router.replace("/configuracion");
    }
  }, [isLoaded, isAdmin, router]);

  const config = useQuery(
    api.functions.orgConfigs.queries.getByOrgId,
    isLoaded && isAdmin ? {} : "skip"
  );
  const updatePrefs = useMutation(
    api.functions.orgConfigs.mutations.updateNotificationPreferences
  );
  const sendTest = useAction(
    api.functions.orgConfigs.actions.sendTestNotification
  );

  const [email, setEmail] = useState("");
  const [hour, setHour] = useState<number>(9);
  const [onDeliverable, setOnDeliverable] = useState(true);
  const [onInvoicePaid, setOnInvoicePaid] = useState(true);
  const [onQuotationAccepted, setOnQuotationAccepted] = useState(true);

  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Hydrate form once config loads (re-runs when org changes).
  useEffect(() => {
    if (config === undefined || hydrated) return;
    setEmail(config?.notificationEmail ?? "");
    setHour(config?.notificationPreferences?.reminderHourLocal ?? 9);
    setOnDeliverable(
      config?.notificationPreferences?.notifyOnDeliverableGenerated ?? true
    );
    setOnInvoicePaid(
      config?.notificationPreferences?.notifyOnInvoicePaid ?? true
    );
    setOnQuotationAccepted(
      config?.notificationPreferences?.notifyOnQuotationAccepted ?? true
    );
    setHydrated(true);
  }, [config, hydrated]);

  if (!isLoaded || !isAdmin) return null;

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setInfo(null);
    const trimmed = email.trim();
    if (trimmed && !EMAIL_REGEX.test(trimmed)) {
      setError("Email inválido.");
      return;
    }
    if (hour < 0 || hour > 23 || !Number.isInteger(hour)) {
      setError("La hora debe estar entre 0 y 23.");
      return;
    }
    setSaving(true);
    try {
      await updatePrefs({
        notificationEmail: trimmed,
        reminderHourLocal: hour,
        notifyOnDeliverableGenerated: onDeliverable,
        notifyOnInvoicePaid: onInvoicePaid,
        notifyOnQuotationAccepted: onQuotationAccepted,
      });
      setSuccess("Preferencias guardadas.");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  };

  const handleTestSend = async () => {
    setError(null);
    setSuccess(null);
    setInfo(null);
    if (!email.trim()) {
      setError("Guarda un email destino antes de probar.");
      return;
    }
    setTesting(true);
    try {
      const res = await sendTest({});
      if (res.sent) {
        setSuccess(`Email enviado a ${email.trim()}.`);
      } else {
        setInfo(res.reason ?? "No se pudo enviar el email.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar prueba.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} aria-hidden="true" /> Configuración
      </Link>

      <div className="flex items-center gap-3">
        <Bell className="text-accent" size={28} aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold">Notificaciones</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Configura el email destino y cuándo recibir alertas.
          </p>
        </div>
      </div>

      <section
        className="rounded-lg border border-border bg-card p-6 space-y-4"
        aria-labelledby="notif-email-heading"
      >
        <h2 id="notif-email-heading" className="text-lg font-semibold">
          Email destino
        </h2>

        <div>
          <label
            htmlFor="notif-email"
            className="mb-1.5 block text-sm font-medium text-muted-foreground"
          >
            Email
          </label>
          <input
            id="notif-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ops@miempresa.mx"
            className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Recibe alertas operativas de la org. Default si no hay ejecutivo
            asignado al cliente.
          </p>
        </div>

        <div>
          <button
            type="button"
            onClick={handleTestSend}
            disabled={testing}
            data-testid="notif-test-btn"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-4 py-2 text-sm hover:bg-secondary/80 disabled:opacity-50"
          >
            {testing ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Send size={14} aria-hidden="true" />
            )}
            Enviar email de prueba
          </button>
        </div>
      </section>

      <section
        className="rounded-lg border border-border bg-card p-6 space-y-4"
        aria-labelledby="notif-recordatorios-heading"
      >
        <h2 id="notif-recordatorios-heading" className="text-lg font-semibold">
          Recordatorios diarios
        </h2>

        <div>
          <label
            htmlFor="notif-hour"
            className="mb-1.5 block text-sm font-medium text-muted-foreground"
          >
            Hora preferida (zona horaria de la org)
          </label>
          <select
            id="notif-hour"
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
            className="w-32 rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {Array.from({ length: 24 }, (_, i) => i).map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>
      </section>

      <section
        className="rounded-lg border border-border bg-card p-6 space-y-3"
        aria-labelledby="notif-eventos-heading"
      >
        <h2 id="notif-eventos-heading" className="text-lg font-semibold">
          Eventos
        </h2>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={onDeliverable}
            onChange={(e) => setOnDeliverable(e.target.checked)}
            data-testid="notif-toggle-deliverable"
            className="mt-1 h-4 w-4 rounded border-border bg-secondary"
          />
          <span>Email cuando se genera un entregable</span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={onInvoicePaid}
            onChange={(e) => setOnInvoicePaid(e.target.checked)}
            data-testid="notif-toggle-invoice"
            className="mt-1 h-4 w-4 rounded border-border bg-secondary"
          />
          <span>Email cuando se marca una factura como pagada</span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={onQuotationAccepted}
            onChange={(e) => setOnQuotationAccepted(e.target.checked)}
            data-testid="notif-toggle-quotation"
            className="mt-1 h-4 w-4 rounded border-border bg-secondary"
          />
          <span>Email cuando un cliente acepta cotización</span>
        </label>
      </section>

      {error && (
        <div
          className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
          role="alert"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          className="rounded border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400"
          role="status"
        >
          {success}
        </div>
      )}
      {info && (
        <div
          className="rounded border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400"
          role="status"
        >
          {info}
        </div>
      )}

      <div className="flex justify-end gap-2 pb-8">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !hydrated}
          data-testid="notif-save-btn"
          className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <Save size={16} aria-hidden="true" />
          )}
          Guardar cambios
        </button>
      </div>
    </div>
  );
}

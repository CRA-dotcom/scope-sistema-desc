"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Check, X, Loader2 } from "lucide-react";

export function ResendConfigForm() {
  const config = useQuery(api.functions.email.queries.getResendConfig, {});
  const upsert = useMutation(api.functions.email.mutations.upsertResendConfig);
  const testConnection = useAction(
    api.functions.email.send.testResendConnection
  );

  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (config?.configured) {
      setFromEmail(config.fromEmail ?? "");
      setFromName(config.fromName ?? "");
    }
  }, [config]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!apiKey.trim())
      e.apiKey = "API key es requerido (pégalo de nuevo si estás editando)";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail))
      e.fromEmail = "Email inválido";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleTest() {
    if (!apiKey.trim()) {
      setTestResult({ ok: false, error: "Pega un API key primero" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testConnection({ apiKey });
      setTestResult(res);
    } catch (err) {
      setTestResult({ ok: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setSaved(false);
    try {
      await upsert({
        apiKey: apiKey.trim(),
        fromEmail: fromEmail.trim(),
        fromName: fromName.trim() || undefined,
        webhookSigningSecret: webhookSecret.trim() || undefined,
      });
      setSaved(true);
    } catch (err) {
      setErrors({ submit: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  const input =
    "w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
  const errStyle = "text-xs text-destructive";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-card p-6 space-y-4"
    >
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Configuración
      </h3>

      {errors.submit && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {errors.submit}
        </div>
      )}

      {saved && (
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-500">
          Configuración guardada.
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">API Key *</label>
        <input
          type="password"
          className={input}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            config?.configured
              ? `(pega el API key — actual: ${config.apiKeyMasked ?? "****"})`
              : "re_live_..."
          }
        />
        {errors.apiKey && <p className={errStyle}>{errors.apiKey}</p>}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !apiKey.trim()}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
          >
            {testing ? <Loader2 size={12} className="animate-spin" /> : null}
            Probar conexión
          </button>
          {testResult?.ok === true && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
              <Check size={12} /> Conexión OK
            </span>
          )}
          {testResult?.ok === false && (
            <span className="inline-flex items-center gap-1 text-xs text-destructive">
              <X size={12} /> {testResult.error}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Email remitente *</label>
        <input
          type="email"
          className={input}
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          placeholder="cotizaciones@tu-empresa.mx"
        />
        {errors.fromEmail && <p className={errStyle}>{errors.fromEmail}</p>}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Nombre remitente</label>
        <input
          type="text"
          className={input}
          value={fromName}
          onChange={(e) => setFromName(e.target.value)}
          placeholder="Tu Empresa"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Webhook Signing Secret</label>
        <input
          type="password"
          className={input}
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
          placeholder={
            config?.hasWebhookSecret
              ? "(dejar en blanco para mantener el actual)"
              : "whsec_..."
          }
        />
        <p className="text-xs text-muted-foreground">
          Opcional pero recomendado. Sin esto, los webhooks de eventos de email
          fallarán a la verificación HMAC.
        </p>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-accent px-6 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
      >
        {loading ? "Guardando..." : "Guardar configuración"}
      </button>
    </form>
  );
}

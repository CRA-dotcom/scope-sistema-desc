"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { INDUSTRIES } from "../../../convex/lib/validators";

const BILLING_OPTIONS = [
  { value: "semanal" as const, label: "Semanal" },
  { value: "quincenal" as const, label: "Quincenal" },
  { value: "mensual" as const, label: "Mensual" },
];

type ClientData = {
  _id?: Id<"clients">;
  name: string;
  rfc: string;
  industry: string;
  annualRevenue: number;
  billingFrequency: "semanal" | "quincenal" | "mensual";
  contactEmail?: string;
  contactName?: string;
};

export function ClientForm({
  initialData,
  mode = "create",
}: {
  initialData?: ClientData;
  mode?: "create" | "edit";
}) {
  const router = useRouter();
  const createClient = useMutation(api.functions.clients.mutations.create);
  const updateClient = useMutation(api.functions.clients.mutations.update);

  const [form, setForm] = useState({
    name: initialData?.name ?? "",
    rfc: initialData?.rfc ?? "",
    industry: initialData?.industry ?? "",
    annualRevenue: initialData?.annualRevenue ?? 0,
    billingFrequency: initialData?.billingFrequency ?? ("mensual" as const),
    contactEmail: initialData?.contactEmail ?? "",
    contactName: initialData?.contactName ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  function validate() {
    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = "El nombre es obligatorio";
    if (!form.rfc.trim()) {
      newErrors.rfc = "El RFC es obligatorio";
    } else if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(form.rfc)) {
      newErrors.rfc = "Formato de RFC inválido";
    }
    if (!form.industry) newErrors.industry = "Selecciona una industria";
    if (form.annualRevenue <= 0)
      newErrors.annualRevenue = "La facturación debe ser mayor a 0";
    if (
      form.contactEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)
    ) {
      newErrors.contactEmail = "Email inválido";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      if (mode === "edit" && initialData?._id) {
        await updateClient({
          id: initialData._id,
          ...form,
          contactEmail: form.contactEmail || undefined,
          contactName: form.contactName || undefined,
        });
      } else {
        await createClient({
          ...form,
          contactEmail: form.contactEmail || undefined,
          contactName: form.contactName || undefined,
        });
      }
      router.push("/clientes");
    } catch (err) {
      setErrors({ submit: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      {errors.submit && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {errors.submit}
        </div>
      )}

      {/* Name */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Nombre / Razón Social</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Empresa S.A. de C.V."
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name}</p>
        )}
      </div>

      {/* RFC */}
      <div className="space-y-2">
        <label className="text-sm font-medium">RFC</label>
        <input
          type="text"
          value={form.rfc}
          onChange={(e) =>
            setForm({ ...form, rfc: e.target.value.toUpperCase() })
          }
          className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground uppercase placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="XAXX010101000"
          maxLength={13}
        />
        {errors.rfc && (
          <p className="text-xs text-destructive">{errors.rfc}</p>
        )}
      </div>

      {/* Industry */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Industria</label>
        <select
          value={form.industry}
          onChange={(e) => setForm({ ...form, industry: e.target.value })}
          className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
        >
          <option value="">Selecciona una industria</option>
          {INDUSTRIES.map((ind) => (
            <option key={ind} value={ind}>
              {ind}
            </option>
          ))}
        </select>
        {errors.industry && (
          <p className="text-xs text-destructive">{errors.industry}</p>
        )}
      </div>

      {/* Annual Revenue */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          Facturación Anual Proyectada (MXN)
        </label>
        <input
          type="number"
          value={form.annualRevenue || ""}
          onChange={(e) =>
            setForm({ ...form, annualRevenue: Number(e.target.value) })
          }
          className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="50000000"
          min={0}
        />
        {errors.annualRevenue && (
          <p className="text-xs text-destructive">{errors.annualRevenue}</p>
        )}
      </div>

      {/* Billing Frequency */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Frecuencia de Facturación</label>
        <div className="flex gap-4">
          {BILLING_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="radio"
                name="billingFrequency"
                value={opt.value}
                checked={form.billingFrequency === opt.value}
                onChange={() =>
                  setForm({ ...form, billingFrequency: opt.value })
                }
                className="accent-accent"
              />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Contact Email */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          Email de contacto (opcional)
        </label>
        <input
          type="email"
          value={form.contactEmail}
          onChange={(e) =>
            setForm({ ...form, contactEmail: e.target.value })
          }
          className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="contacto@empresa.com"
        />
        {errors.contactEmail && (
          <p className="text-xs text-destructive">{errors.contactEmail}</p>
        )}
      </div>

      {/* Contact Name */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          Nombre de contacto (opcional)
        </label>
        <input
          type="text"
          value={form.contactName}
          onChange={(e) =>
            setForm({ ...form, contactName: e.target.value })
          }
          className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Juan Pérez"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-accent px-6 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {loading
            ? "Guardando..."
            : mode === "edit"
              ? "Guardar Cambios"
              : "Crear Cliente"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-border px-6 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors cursor-pointer"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

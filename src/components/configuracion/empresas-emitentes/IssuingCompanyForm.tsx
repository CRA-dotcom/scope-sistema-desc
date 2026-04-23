"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { SAT_REGIMENES } from "../../../../convex/functions/issuingCompanies/helpers";
import { LogoUploader } from "./LogoUploader";

type IssuingCompanyData = {
  _id?: Id<"issuingCompanies">;
  name: string;
  legalName: string;
  rfc: string;
  regimenFiscalCode: string;
  codigoPostal: string;
  address: {
    street: string;
    exteriorNumber?: string;
    interiorNumber?: string;
    colonia?: string;
    city: string;
    state: string;
    country: string;
  };
  email: string;
  phone?: string;
  website?: string;
  bankName?: string;
  bankAccount?: string;
  clabe?: string;
  currency?: string;
  invoiceSerie?: string;
  signatoryName?: string;
  signatoryTitle?: string;
  logoStorageId?: Id<"_storage">;
};

const EMPTY: IssuingCompanyData = {
  name: "",
  legalName: "",
  rfc: "",
  regimenFiscalCode: "",
  codigoPostal: "",
  address: { street: "", city: "", state: "", country: "México" },
  email: "",
};

export function IssuingCompanyForm({
  initialData,
  mode = "create",
}: {
  initialData?: IssuingCompanyData;
  mode?: "create" | "edit";
}) {
  const router = useRouter();
  const createCompany = useMutation(api.functions.issuingCompanies.mutations.create);
  const updateCompany = useMutation(api.functions.issuingCompanies.mutations.update);

  const [form, setForm] = useState<IssuingCompanyData>(initialData ?? EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Nombre requerido";
    if (!form.legalName.trim()) e.legalName = "Razón social requerida";
    if (!form.rfc.trim()) e.rfc = "RFC requerido";
    else if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(form.rfc))
      e.rfc = "Formato de RFC inválido";
    if (!form.regimenFiscalCode) e.regimenFiscalCode = "Régimen requerido";
    if (!/^\d{5}$/.test(form.codigoPostal))
      e.codigoPostal = "Código postal de 5 dígitos";
    if (!form.address.street.trim()) e.street = "Calle requerida";
    if (!form.address.city.trim()) e.city = "Ciudad requerida";
    if (!form.address.state.trim()) e.state = "Estado requerido";
    if (!form.address.country.trim()) e.country = "País requerido";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Email inválido";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const payload = {
        name: form.name,
        legalName: form.legalName,
        rfc: form.rfc,
        regimenFiscalCode: form.regimenFiscalCode,
        codigoPostal: form.codigoPostal,
        address: form.address,
        email: form.email,
        phone: form.phone || undefined,
        website: form.website || undefined,
        bankName: form.bankName || undefined,
        bankAccount: form.bankAccount || undefined,
        clabe: form.clabe || undefined,
        currency: form.currency || undefined,
        invoiceSerie: form.invoiceSerie || undefined,
        signatoryName: form.signatoryName || undefined,
        signatoryTitle: form.signatoryTitle || undefined,
      };
      let id: Id<"issuingCompanies">;
      if (mode === "edit" && initialData?._id) {
        await updateCompany({ id: initialData._id, ...payload });
        id = initialData._id;
      } else {
        id = await createCompany(payload);
      }
      router.push(`/configuracion/empresas-emitentes/${id}`);
    } catch (err) {
      setErrors({ submit: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  const input =
    "w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
  const errStyle = "text-xs text-destructive";
  const sectionTitle =
    "text-sm font-semibold text-muted-foreground uppercase tracking-wide pb-2 border-b border-border";

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-8">
      {errors.submit && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {errors.submit}
        </div>
      )}

      <section className="space-y-4">
        <h3 className={sectionTitle}>Datos fiscales</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Nombre comercial *</label>
            <input
              type="text"
              className={input}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            {errors.name && <p className={errStyle}>{errors.name}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Razón social *</label>
            <input
              type="text"
              className={input}
              value={form.legalName}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
            />
            {errors.legalName && <p className={errStyle}>{errors.legalName}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">RFC *</label>
            <input
              type="text"
              className={`${input} uppercase`}
              maxLength={13}
              value={form.rfc}
              onChange={(e) =>
                setForm({ ...form, rfc: e.target.value.toUpperCase() })
              }
            />
            {errors.rfc && <p className={errStyle}>{errors.rfc}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Régimen fiscal *</label>
            <select
              className={`${input} cursor-pointer`}
              value={form.regimenFiscalCode}
              onChange={(e) =>
                setForm({ ...form, regimenFiscalCode: e.target.value })
              }
            >
              <option value="">Selecciona régimen</option>
              {SAT_REGIMENES.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.code} — {r.label}
                </option>
              ))}
            </select>
            {errors.regimenFiscalCode && (
              <p className={errStyle}>{errors.regimenFiscalCode}</p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Código postal *</label>
            <input
              type="text"
              className={input}
              maxLength={5}
              value={form.codigoPostal}
              onChange={(e) => setForm({ ...form, codigoPostal: e.target.value })}
            />
            {errors.codigoPostal && (
              <p className={errStyle}>{errors.codigoPostal}</p>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className={sectionTitle}>Dirección fiscal</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Calle *</label>
            <input
              type="text"
              className={input}
              value={form.address.street}
              onChange={(e) =>
                setForm({
                  ...form,
                  address: { ...form.address, street: e.target.value },
                })
              }
            />
            {errors.street && <p className={errStyle}>{errors.street}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Núm. exterior</label>
            <input
              type="text"
              className={input}
              value={form.address.exteriorNumber ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  address: { ...form.address, exteriorNumber: e.target.value },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Núm. interior</label>
            <input
              type="text"
              className={input}
              value={form.address.interiorNumber ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  address: { ...form.address, interiorNumber: e.target.value },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Colonia</label>
            <input
              type="text"
              className={input}
              value={form.address.colonia ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  address: { ...form.address, colonia: e.target.value },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Ciudad *</label>
            <input
              type="text"
              className={input}
              value={form.address.city}
              onChange={(e) =>
                setForm({
                  ...form,
                  address: { ...form.address, city: e.target.value },
                })
              }
            />
            {errors.city && <p className={errStyle}>{errors.city}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Estado *</label>
            <input
              type="text"
              className={input}
              value={form.address.state}
              onChange={(e) =>
                setForm({
                  ...form,
                  address: { ...form.address, state: e.target.value },
                })
              }
            />
            {errors.state && <p className={errStyle}>{errors.state}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">País *</label>
            <input
              type="text"
              className={input}
              value={form.address.country}
              onChange={(e) =>
                setForm({
                  ...form,
                  address: { ...form.address, country: e.target.value },
                })
              }
            />
            {errors.country && <p className={errStyle}>{errors.country}</p>}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className={sectionTitle}>Contacto</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Email *</label>
            <input
              type="email"
              className={input}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            {errors.email && <p className={errStyle}>{errors.email}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Teléfono</label>
            <input
              type="text"
              className={input}
              value={form.phone ?? ""}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Sitio web</label>
            <input
              type="url"
              className={input}
              value={form.website ?? ""}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className={sectionTitle}>Datos bancarios</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Banco</label>
            <input
              type="text"
              className={input}
              value={form.bankName ?? ""}
              onChange={(e) => setForm({ ...form, bankName: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Cuenta</label>
            <input
              type="text"
              className={input}
              value={form.bankAccount ?? ""}
              onChange={(e) => setForm({ ...form, bankAccount: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">CLABE</label>
            <input
              type="text"
              className={input}
              maxLength={18}
              value={form.clabe ?? ""}
              onChange={(e) => setForm({ ...form, clabe: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Moneda</label>
            <input
              type="text"
              className={input}
              placeholder="MXN"
              value={form.currency ?? ""}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className={sectionTitle}>Emisión y firma</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Serie de factura</label>
            <input
              type="text"
              className={input}
              value={form.invoiceSerie ?? ""}
              onChange={(e) =>
                setForm({ ...form, invoiceSerie: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Nombre del firmante</label>
            <input
              type="text"
              className={input}
              value={form.signatoryName ?? ""}
              onChange={(e) =>
                setForm({ ...form, signatoryName: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Cargo del firmante</label>
            <input
              type="text"
              className={input}
              value={form.signatoryTitle ?? ""}
              onChange={(e) =>
                setForm({ ...form, signatoryTitle: e.target.value })
              }
            />
          </div>
        </div>
      </section>

      {mode === "edit" && initialData?._id && (
        <section className="space-y-4">
          <h3 className={sectionTitle}>Logo</h3>
          <LogoUploader companyId={initialData._id} />
        </section>
      )}

      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-accent px-6 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {loading
            ? "Guardando..."
            : mode === "edit"
              ? "Guardar cambios"
              : "Crear empresa"}
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

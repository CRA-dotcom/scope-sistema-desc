"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Building2, Plus, Search, Star, CircleSlash, Check } from "lucide-react";
import { useState } from "react";
import { SetDefaultDialog } from "./SetDefaultDialog";
import { Id } from "../../../../convex/_generated/dataModel";

type Company = {
  _id: Id<"issuingCompanies">;
  name: string;
  rfc: string;
  regimenFiscalCode: string;
  regimenFiscalLabel?: string;
  isDefault: boolean;
  isActive: boolean;
  serviceCount: number;
  clientOverrideCount: number;
};

export function IssuingCompanyList() {
  const { user } = useUser();
  const isAdmin =
    user?.organizationMemberships?.[0]?.role === "org:admin";

  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [pendingDefault, setPendingDefault] = useState<Company | null>(null);

  const companies = useQuery(api.functions.issuingCompanies.queries.list, {
    includeInactive,
  });
  const currentDefault = companies?.find((c) => c.isDefault);

  const filtered = companies?.filter((c) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(term) ||
      c.rfc.toLowerCase().includes(term)
    );
  });

  if (companies === undefined) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-lg border border-border bg-card"
          />
        ))}
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center">
        <Building2 className="mx-auto mb-4 text-muted-foreground" size={48} />
        <p className="text-lg font-medium">
          No hay empresas emitentes configuradas
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin
            ? "Crea la primera empresa para emitir cotizaciones y contratos."
            : "Pide a un administrador que configure la primera empresa."}
        </p>
        {isAdmin && (
          <Link
            href="/configuracion/empresas-emitentes/nueva"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors cursor-pointer"
          >
            <Plus size={16} /> Crear primera empresa
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={16}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o RFC..."
            className="w-full rounded-md border border-border bg-secondary py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <button
          onClick={() => setIncludeInactive(!includeInactive)}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors cursor-pointer ${
            includeInactive
              ? "border-warning bg-warning/10 text-warning"
              : "border-border text-muted-foreground hover:bg-secondary"
          }`}
        >
          <CircleSlash size={14} /> Inactivas
        </button>
        {isAdmin && (
          <Link
            href="/configuracion/empresas-emitentes/nueva"
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors cursor-pointer"
          >
            <Plus size={16} /> Nueva
          </Link>
        )}
      </div>

      <div className="space-y-2">
        {filtered?.map((c) => (
          <div
            key={c._id}
            className="group relative rounded-lg border border-border bg-card p-4 transition-colors hover:border-accent/30"
          >
            <Link
              href={`/configuracion/empresas-emitentes/${c._id}`}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                  <Building2 className="text-accent" size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{c.name}</p>
                    {c.isDefault && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
                        <Star size={10} /> Default
                      </span>
                    )}
                    {!c.isActive && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        Inactiva
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    RFC: {c.rfc} &middot;{" "}
                    {c.regimenFiscalLabel ?? c.regimenFiscalCode} &middot;{" "}
                    {c.serviceCount} servicio(s)
                  </p>
                </div>
              </div>
            </Link>
            {isAdmin && !c.isDefault && c.isActive && (
              <button
                onClick={() => setPendingDefault(c)}
                className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-secondary transition-all cursor-pointer"
              >
                <Check size={12} className="inline mr-1" /> Marcar default
              </button>
            )}
          </div>
        ))}
      </div>

      {pendingDefault && currentDefault && (
        <SetDefaultDialog
          companyId={pendingDefault._id}
          newName={pendingDefault.name}
          currentName={currentDefault.name}
          onClose={() => setPendingDefault(null)}
        />
      )}
    </div>
  );
}

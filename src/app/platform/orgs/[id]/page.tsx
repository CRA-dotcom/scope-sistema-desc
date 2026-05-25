"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Suspense, useState, useEffect, useCallback } from "react";
import { ArrowLeft, Save, Loader2, Palette } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatLocalDateTime } from "@/lib/datetime";

type FeatureFlags = {
  advancedConfigVisible: boolean;
  customServicesVisible: boolean;
  seasonalityEditable: boolean;
  manualOverrideAllowed: boolean;
};

const defaultFeatureFlags: FeatureFlags = {
  advancedConfigVisible: false,
  customServicesVisible: false,
  seasonalityEditable: false,
  manualOverrideAllowed: false,
};

const featureFlagLabels: Record<keyof FeatureFlags, string> = {
  advancedConfigVisible: "Configuración avanzada visible",
  customServicesVisible: "Servicios personalizados visibles",
  seasonalityEditable: "Estacionalidad editable",
  manualOverrideAllowed: "Override manual permitido",
};

type TabId = "details" | "metrics" | "billing" | "audit";

const TAB_LABELS: Record<TabId, string> = {
  details: "Detalles",
  metrics: "Métricas",
  billing: "Billing",
  audit: "Audit",
};

const TAB_ORDER: TabId[] = ["details", "metrics", "billing", "audit"];

// Next 15: useSearchParams() must be rendered inside a Suspense boundary so
// the build can statically prerender the shell while deferring the
// param-dependent body to client-side hydration.
export default function OrgDetailPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Cargando…</div>}>
      <OrgDetailPageInner />
    </Suspense>
  );
}

function OrgDetailPageInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgId = params.id as string;

  const isNew = orgId === "new";

  const org = useQuery(
    api.functions.organizations.queries.getByIdForAdmin,
    isNew ? "skip" : { id: orgId as Id<"organizations"> }
  );

  // Active tab from `?tab=` (default details).
  const rawTab = searchParams.get("tab");
  const activeTab: TabId = (
    TAB_ORDER.includes(rawTab as TabId) ? rawTab : "details"
  ) as TabId;

  // Loading state.
  if (!isNew && org === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (!isNew && org === null) {
    return (
      <div className="py-20 text-center text-sm text-red-400">
        Organización no encontrada o sin permisos.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/platform"
          className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">
            {isNew ? "Nueva Organización" : org?.name}
          </h1>
          {!isNew && (
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {org?.clerkOrgId}
            </p>
          )}
        </div>
        {!isNew && (
          <Link
            href={`/platform/orgs/${orgId}/branding`}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary/80 transition-colors"
          >
            <Palette size={16} />
            Branding
          </Link>
        )}
      </div>

      {/* Tabs — only for existing orgs */}
      {!isNew && (
        <div className="border-b border-border">
          <nav className="-mb-px flex gap-1" aria-label="Tabs">
            {TAB_ORDER.map((t) => (
              <Link
                key={t}
                href={`/platform/orgs/${orgId}?tab=${t}`}
                scroll={false}
                aria-current={activeTab === t ? "page" : undefined}
                className={cn(
                  "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                  activeTab === t
                    ? "border-accent text-accent"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {TAB_LABELS[t]}
              </Link>
            ))}
          </nav>
        </div>
      )}

      {/* Tab content */}
      {isNew || activeTab === "details" ? (
        <DetailsTab isNew={isNew} org={org} router={router} />
      ) : activeTab === "metrics" && org ? (
        <OrgMetricsTab orgClerkId={org.clerkOrgId} />
      ) : activeTab === "billing" && org ? (
        <OrgBillingTab orgClerkId={org.clerkOrgId} />
      ) : activeTab === "audit" && org ? (
        <OrgAuditTab orgClerkId={org.clerkOrgId} />
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  DetailsTab — the existing form, untouched in behavior.                    */
/* ────────────────────────────────────────────────────────────────────────── */

type OrgRow = NonNullable<
  ReturnType<
    typeof useQuery<typeof api.functions.organizations.queries.getByIdForAdmin>
  >
>;

function DetailsTab({
  isNew,
  org,
  router,
}: {
  isNew: boolean;
  org: OrgRow | null | undefined;
  router: ReturnType<typeof useRouter>;
}) {
  const config = useQuery(
    api.functions.orgConfigs.queries.getByOrgIdForAdmin,
    isNew || !org ? "skip" : { orgId: org.clerkOrgId }
  );

  const allServices = useQuery(api.functions.services.queries.listAllForAdmin);

  const updateOrg = useMutation(api.functions.organizations.mutations.update);
  const createOrg = useMutation(api.functions.organizations.mutations.create);
  const updateStatus = useMutation(
    api.functions.organizations.mutations.updateStatus
  );
  const upsertConfig = useMutation(api.functions.orgConfigs.mutations.upsert);

  const [name, setName] = useState("");
  const [clerkOrgId, setClerkOrgId] = useState("");
  const [plan, setPlan] = useState<"basic" | "pro" | "enterprise">("basic");
  const [status, setStatus] = useState<"active" | "inactive" | "suspended">(
    "active"
  );
  const [assignedServiceIds, setAssignedServiceIds] = useState<string[]>([]);

  const [calculationMode, setCalculationMode] = useState<"weighted" | "fixed">(
    "weighted"
  );
  const [commissionMode, setCommissionMode] = useState<
    "proportional" | "fixed_monthly"
  >("proportional");
  const [seasonalityEnabled, setSeasonalityEnabled] = useState(true);
  const [featureFlags, setFeatureFlags] =
    useState<FeatureFlags>(defaultFeatureFlags);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const initForm = useCallback(() => {
    if (org) {
      setName(org.name);
      setClerkOrgId(org.clerkOrgId);
      setPlan(org.plan);
      setStatus(org.status);
      setAssignedServiceIds(
        (org.assignedServiceIds ?? []).map((id) => id as string)
      );
    }
    if (config) {
      setCalculationMode(config.calculationMode);
      setCommissionMode(config.commissionMode);
      setSeasonalityEnabled(config.seasonalityEnabled);
      setFeatureFlags(config.featureFlags);
    }
  }, [org, config]);

  useEffect(() => {
    initForm();
  }, [initForm]);

  const handleServiceToggle = (serviceId: string) => {
    setAssignedServiceIds((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  const handleFeatureFlagToggle = (flag: keyof FeatureFlags) => {
    setFeatureFlags((prev) => ({ ...prev, [flag]: !prev[flag] }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      if (isNew) {
        if (!name.trim() || !clerkOrgId.trim()) {
          setError("Nombre y Clerk Org ID son requeridos.");
          setSaving(false);
          return;
        }
        const newOrgId = await createOrg({
          clerkOrgId: clerkOrgId.trim(),
          name: name.trim(),
          plan,
        });

        await upsertConfig({
          orgId: clerkOrgId.trim(),
          calculationMode,
          commissionMode,
          seasonalityEnabled,
          featureFlags,
        });

        router.push(`/platform/orgs/${newOrgId}`);
        return;
      }

      if (!org) return;

      await updateOrg({
        id: org._id,
        name: name.trim(),
        plan,
        assignedServiceIds: assignedServiceIds as Id<"services">[],
      });

      if (status !== org.status) {
        await updateStatus({
          id: org._id,
          status,
        });
      }

      await upsertConfig({
        orgId: org.clerkOrgId,
        calculationMode,
        commissionMode,
        seasonalityEnabled,
        featureFlags,
      });

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const defaultServices = (allServices ?? []).filter((s) => s.isDefault);

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          Cambios guardados correctamente.
        </div>
      )}

      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          Información General
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
              Nombre
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="Nombre de la organizacion"
            />
          </div>

          {isNew && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Clerk Org ID
              </label>
              <input
                type="text"
                value={clerkOrgId}
                onChange={(e) => setClerkOrgId(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="org_xxxxxxxxx"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
              Plan
            </label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value as typeof plan)}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="basic">Basic</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>

          {!isNew && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                Estado
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="active">Activa</option>
                <option value="inactive">Inactiva</option>
                <option value="suspended">Suspendida</option>
              </select>
            </div>
          )}
        </div>
      </section>

      {!isNew && (
        <section className="rounded-lg border border-border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            Servicios Asignados
          </h2>
          <p className="text-sm text-muted-foreground">
            Selecciona los servicios disponibles para esta organizacion. Si no
            se selecciona ninguno, tendra acceso a todos los servicios por
            defecto.
          </p>

          {defaultServices.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              Cargando servicios...
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {defaultServices.map((service) => {
                const checked = assignedServiceIds.includes(
                  service._id as string
                );
                return (
                  <label
                    key={service._id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-4 py-3 hover:bg-secondary/50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        handleServiceToggle(service._id as string)
                      }
                      className="h-4 w-4 rounded border-border accent-accent"
                    />
                    <div>
                      <span className="text-sm font-medium text-foreground">
                        {service.name}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({service.type} - {service.defaultPct}%)
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Configuración</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
              Modo de cálculo
            </label>
            <select
              value={calculationMode}
              onChange={(e) =>
                setCalculationMode(e.target.value as typeof calculationMode)
              }
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="weighted">Ponderado (weighted)</option>
              <option value="fixed">Fijo (fixed)</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
              Modo de comisión
            </label>
            <select
              value={commissionMode}
              onChange={(e) =>
                setCommissionMode(e.target.value as typeof commissionMode)
              }
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="proportional">Proporcional</option>
              <option value="fixed_monthly">Fijo mensual</option>
            </select>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-3">
          <div
            role="switch"
            aria-checked={seasonalityEnabled}
            onClick={() => setSeasonalityEnabled(!seasonalityEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              seasonalityEnabled ? "bg-accent" : "bg-secondary"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                seasonalityEnabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </div>
          <span className="text-sm text-foreground">
            Estacionalidad habilitada
          </span>
        </label>
      </section>

      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Feature Flags</h2>
        <p className="text-sm text-muted-foreground">
          Controla que funcionalidades estan disponibles para esta
          organizacion.
        </p>

        <div className="space-y-3">
          {(Object.keys(featureFlagLabels) as (keyof FeatureFlags)[]).map(
            (flag) => (
              <label
                key={flag}
                className="flex cursor-pointer items-center gap-3"
              >
                <div
                  role="switch"
                  aria-checked={featureFlags[flag]}
                  onClick={() => handleFeatureFlagToggle(flag)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    featureFlags[flag] ? "bg-accent" : "bg-secondary"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      featureFlags[flag] ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </div>
                <span className="text-sm text-foreground">
                  {featureFlagLabels[flag]}
                </span>
              </label>
            )
          )}
        </div>
      </section>

      <div className="flex justify-end pb-8">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          {isNew ? "Crear Organización" : "Guardar Cambios"}
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Drill-down tabs                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

function OrgMetricsTab({ orgClerkId }: { orgClerkId: string }) {
  const details = useQuery(api.functions.superAdmin.metrics.getOrgDetails, {
    orgId: orgClerkId,
  });

  if (!details) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Stat
          label="Deliverables (mes)"
          value={details.monthTotals.deliverables}
        />
        <Stat
          label="Clientes activos"
          value={details.monthTotals.clientsActive}
        />
        <Stat
          label="Costo IA (USD)"
          value={`$${details.monthTotals.aiCostUsd.toFixed(2)}`}
        />
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-foreground">
          Top clientes (mes)
        </h2>
        {details.topClients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin deliverables este mes.
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="py-2">Cliente</th>
                <th className="py-2">Deliverables</th>
                <th className="py-2">Costo IA (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {details.topClients.map((c) => (
                <tr key={c.clientId}>
                  <td className="py-2 text-sm text-foreground">
                    {c.clientName}
                  </td>
                  <td className="py-2 text-sm">{c.deliverablesMonth}</td>
                  <td className="py-2 text-sm">
                    ${c.aiCostUsdMonth.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {details.distributionBySubservice.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">
            Distribución por subservicio
          </h2>
          <ul className="space-y-1">
            {details.distributionBySubservice.map((d) => (
              <li
                key={d.key}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-muted-foreground">{d.key}</span>
                <span className="font-medium text-foreground">{d.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function OrgBillingTab({ orgClerkId }: { orgClerkId: string }) {
  const data = useQuery(api.functions.superAdmin.billing.getUsage, {
    orgId: orgClerkId,
  });

  if (!data) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const row = data.rows[0];
  if (!row) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Sin datos de billing.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Stat
          label="Deliverables / Mes"
          value={`${row.deliverablesMonth} / ${row.deliverablesCap}`}
        />
        <Stat
          label="Clientes activos / Cap"
          value={`${row.clientsActive} / ${row.clientsCap}`}
        />
        <Stat
          label="A cobrar (MXN)"
          value={`$${row.billableMxn.toLocaleString("es-MX")}`}
        />
        <Stat
          label="Costo IA"
          value={`$${row.aiCostMxn.toFixed(0)} MXN · $${row.aiCostUsd.toFixed(2)} USD`}
        />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-xs text-muted-foreground">Margen estimado</div>
        <div className="mt-1 text-xl font-bold text-foreground">
          ${row.marginMxn.toLocaleString("es-MX")} MXN
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Info-only — no procesa pagos en beta. Plan: {row.plan}. Status:{" "}
          {row.status}.
        </p>
      </div>
    </div>
  );
}

function OrgAuditTab({ orgClerkId }: { orgClerkId: string }) {
  // documentEvents.queries.list is cursor-based but NOT a standard Convex
  // paginated query (returns { rows, cursor, isDone }), so we drive the
  // pagination manually with local accumulator state, same pattern as
  // /platform/audit/page.tsx.
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [accumulated, setAccumulated] = useState<
    Array<{
      _id: string;
      createdAt: number;
      severity: "info" | "warning" | "error";
      entityType: string;
      message: string;
    }>
  >([]);
  // Pagination guard: between the "Cargar más" click and the next Convex tick,
  // `result.rows` still points at the previous page (the cursor we already
  // appended). If we re-render eagerly we'd flash the same rows twice. When
  // `pendingMore` is true we suppress the result.rows append until the new
  // page lands and a useEffect clears the flag.
  const [pendingMore, setPendingMore] = useState(false);

  const result = useQuery(api.functions.documentEvents.queries.list, {
    orgId: orgClerkId,
    cursor,
    pageSize: 25,
  }) as
    | {
        rows: Array<{
          _id: string;
          createdAt: number;
          severity: "info" | "warning" | "error";
          entityType: string;
          message: string;
        }>;
        cursor: string | null;
        isDone: boolean;
      }
    | undefined;

  // Rows shown in the table = accumulated + current page (avoiding double-render
  // when cursor === undefined initial page). Mirrors /platform/audit/page.tsx.
  const rows =
    cursor === undefined
      ? (result?.rows ?? [])
      : pendingMore
        ? accumulated
        : [...accumulated, ...(result?.rows ?? [])];

  // When a new page lands (result is no longer undefined and `result.rows`
  // belongs to the new cursor), drop the pending flag.
  useEffect(() => {
    if (pendingMore && result !== undefined) {
      setPendingMore(false);
    }
    // We only care about the moment result becomes defined for the new cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const loadMore = () => {
    if (!result || result.isDone) return;
    setAccumulated((prev) => [...prev, ...result.rows]);
    setCursor(result.cursor ?? undefined);
    setPendingMore(true);
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      {result === undefined ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">
          Sin eventos para esta organización.
        </div>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30 text-left text-xs">
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Sev</th>
                <th className="px-4 py-2 font-medium">Entidad</th>
                <th className="px-4 py-2 font-medium">Mensaje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((ev) => (
                <tr key={ev._id} className="hover:bg-secondary/30">
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {formatLocalDateTime(ev.createdAt)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs",
                        ev.severity === "info" &&
                          "bg-muted text-muted-foreground",
                        ev.severity === "warning" &&
                          "bg-amber-500/10 text-amber-400",
                        ev.severity === "error" &&
                          "bg-red-500/10 text-red-400"
                      )}
                    >
                      {ev.severity}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground capitalize">
                    {ev.entityType}
                  </td>
                  <td className="px-4 py-2">{ev.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result && !result.isDone && (
            <button
              type="button"
              onClick={loadMore}
              className="w-full border-t border-border py-2.5 text-xs text-accent hover:bg-secondary/50"
            >
              Cargar más
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold text-foreground">{value}</div>
    </div>
  );
}

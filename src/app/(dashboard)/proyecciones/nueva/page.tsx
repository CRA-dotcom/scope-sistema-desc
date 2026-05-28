"use client";

import { Suspense, useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useConvex } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import {
  calculateProjection,
  generateEvenSeasonality,
} from "../../../../../convex/lib/projectionEngine";
import { SeasonalityChart } from "@/components/projections/seasonality-chart";
import { BudgetAllocationWidget } from "@/components/projections/budget-allocation-widget";
import { ServiceRow } from "@/components/projections/service-row";
import { SeasonalityOutliersGrid } from "@/components/projections/seasonality-outliers-grid";
import { ProjectionPeriodSelector } from "@/components/projections/projection-period-selector";
import { computeServiceAllocation } from "@/lib/projection-allocation";
import { formatCurrency } from "@/lib/utils";
import {
  type SeasonalityDelta,
  type SeasonalityOutlier,
  seasonalityDataFromDeltas,
  seasonalityFromOutliers,
  defaultDeltas,
} from "convex/lib/seasonality";
import {
  TrendingUp,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useOrgConfig } from "@/lib/useOrgConfig";
import { useAuth } from "@clerk/nextjs";
import { useProjectionDraftSave } from "@/hooks/useProjectionDraftSave";
import { DraftSaveStatus } from "@/components/projections/DraftSaveStatus";

export default function NuevaProyeccionWrapper() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-lg bg-card" />}>
      <NuevaProyeccionContent />
    </Suspense>
  );
}

const STEPS = [
  "Datos Básicos",
  "Ventas Mensuales",
  "Servicios",
  "Revisión",
];

const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

type ServiceFormState = {
  serviceId: string;
  serviceName: string;
  type: "base" | "comodin";
  minPct: number;
  maxPct: number;
  chosenPct: number;
  isActive: boolean;
  isCommission: boolean;
  // A1 — selected subservice for this parent. Obligatory when the parent has
  // subservices available; undefined otherwise (transitional path during seed).
  subserviceId?: Id<"subservices">;
};

function NuevaProyeccionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedClientId = searchParams.get("clientId");
  const preselectedPreviousProjectionId = searchParams.get("previousProjectionId");
  const rawDraftId = searchParams.get("draftId");
  // Convex IDs are alphanumeric strings; quick sanity check before passing
  // to the query (prevents Convex server validation error crash on garbage input)
  const explicitDraftId =
    rawDraftId && /^[a-z0-9]+$/i.test(rawDraftId)
      ? (rawDraftId as Id<"projectionDrafts">)
      : null;

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 1: Basic data
  const [clientId, setClientId] = useState(preselectedClientId ?? "");
  const [previousProjectionId, setPreviousProjectionId] = useState<string | null>(preselectedPreviousProjectionId);
  const [year, setYear] = useState(new Date().getFullYear());
  const [annualSales, setAnnualSales] = useState(0);
  const [totalBudget, setTotalBudget] = useState(0);
  const [commissionRate, setCommissionRate] = useState(0.02);

  // C2: Projection period
  const [startMonth, setStartMonth] = useState<number>(1); // 1-12, default Jan
  const [projectionMode, setProjectionMode] = useState<"rolling" | "fiscal">("rolling");

  // Derive monthCount and effectiveBudget live
  const monthCount = projectionMode === "fiscal" ? Math.max(1, 13 - startMonth) : 12;
  // 2026-05-12: dropped proration. effectiveBudget = totalBudget in both modes.
  const effectiveBudget = totalBudget;

  // Step 2: Seasonality outliers (sub-proyecto C)
  const [seasonalityOutliers, setSeasonalityOutliers] = useState<SeasonalityOutlier[]>([]);
  const [useSeasonality, setUseSeasonality] = useState(false);

  // Step 3: Services
  const [serviceStates, setServiceStates] = useState<ServiceFormState[]>([]);

  const { flags } = useOrgConfig();
  const { isLoaded, orgId } = useAuth();
  const convex = useConvex();
  const authReady = isLoaded && !!orgId;

  const clients = useQuery(
    api.functions.clients.queries.list,
    authReady ? {} : "skip"
  );
  const services = useQuery(
    api.functions.services.queries.listGlobal,
    authReady ? {} : "skip"
  );
  // A1: prefetch all subservices for the org once (instead of N queries per
  // parent). Filtered by activity + grouped per parent below.
  const allSubservices = useQuery(
    api.functions.subservices.queries.listAllForOrg,
    authReady ? {} : "skip"
  );
  const createProjection = useMutation(
    api.functions.projections.mutations.create
  );

  // Group active subservices by parentServiceId for the Step 2 dropdown.
  const subservicesByParent = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        _id: Id<"subservices">;
        name: string;
        defaultFrequency: string;
      }>
    >();
    if (!allSubservices) return map;
    for (const sub of allSubservices) {
      if (!sub.isActive) continue;
      const arr = map.get(sub.parentServiceId as string) ?? [];
      arr.push({
        _id: sub._id as Id<"subservices">,
        name: sub.name,
        defaultFrequency: sub.defaultFrequency,
      });
      map.set(sub.parentServiceId as string, arr);
    }
    return map;
  }, [allSubservices]);

  // True when the active service has subservices available but none picked.
  const missingSubserviceSelection = useMemo(() => {
    return serviceStates.some((s) => {
      if (!s.isActive) return false;
      const options = subservicesByParent.get(s.serviceId);
      if (!options || options.length === 0) return false;
      return !s.subserviceId;
    });
  }, [serviceStates, subservicesByParent]);

  const draftClientId = clientId
    ? (clientId as Id<"clients">)
    : undefined;
  const existingDraft = useQuery(
    api.functions.projectionDrafts.queries.getMyDraft,
    authReady ? { clientId: draftClientId } : "skip"
  );

  // For ?draftId=X explicit hydration: fetch the specific draft by _id directly.
  const explicitDraftFull = useQuery(
    api.functions.projectionDrafts.queries.getDraftById,
    authReady && explicitDraftId ? { id: explicitDraftId } : "skip"
  );

  const deleteDraft = useMutation(
    api.functions.projectionDrafts.mutations.deleteMyDraft
  );
  const upsertDraft = useMutation(
    api.functions.projectionDrafts.mutations.upsertDraft
  );

  const [draftDismissed, setDraftDismissed] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);

  // Initialize services when loaded
  const initialized = useRef(false);
  useEffect(() => {
    if (services && !initialized.current) {
      initialized.current = true;
      setServiceStates(
        services.map((s) => ({
          serviceId: s._id as string,
          serviceName: s.name,
          type: s.type,
          minPct: s.minPct,
          maxPct: s.maxPct,
          chosenPct: s.defaultPct,
          isCommission: s.isCommission ?? false,
          isActive: !(s.isCommission ?? false),
        }))
      );
    }
  }, [services]);

  // Calculate preview
  const seasonalityData = useSeasonality
    ? seasonalityFromOutliers(annualSales, seasonalityOutliers)
    : generateEvenSeasonality(annualSales);

  const preview =
    serviceStates.length > 0
      ? calculateProjection({
          annualSales,
          totalBudget,
          commissionRate,
          services: serviceStates,
          seasonalityData,
          startMonth,
          projectionMode,
          monthCount,
          effectiveBudget,
        })
      : null;

  // Live budget allocation for step 2 widget — hoisted to page level so the
  // submit-guard can read allocation.remaining without duplicating work.
  // Widget receives the pre-computed allocation as a prop (purely presentational).
  // Engine default is proportional; if a future step exposes commissionMode toggle,
  // propagate it here (replace "proportional" with the org-config value).
  const allocation = useMemo(
    () =>
      computeServiceAllocation(
        effectiveBudget,
        annualSales,
        commissionRate,
        serviceStates.map((s) => ({
          serviceId: s.serviceId,
          serviceName: s.serviceName,
          isActive: s.isActive,
          isCommission: s.isCommission,
          chosenPct: s.chosenPct,
          minPct: s.minPct,
          maxPct: s.maxPct,
        })),
        "proportional"
      ),
    [effectiveBudget, annualSales, commissionRate, serviceStates]
  );

  // Stable snapshot of wizard form state passed to the autosave hook.
  // Mirrors the `state` shape expected by upsertDraft (clientId is a separate
  // top-level arg to the mutation, not part of `state`).
  const formState = useMemo(
    () => ({
      step,
      year,
      annualSales,
      totalBudget,
      commissionRate,
      startMonth,
      projectionMode,
      useSeasonality,
      seasonalityOutliers,
      serviceStates: serviceStates.map((s) => ({
        serviceId: s.serviceId,
        chosenPct: s.chosenPct,
        isActive: s.isActive,
      })),
      previousProjectionId: previousProjectionId
        ? (previousProjectionId as Id<"projections">)
        : undefined,
    }),
    [
      step,
      year,
      annualSales,
      totalBudget,
      commissionRate,
      startMonth,
      projectionMode,
      useSeasonality,
      seasonalityOutliers,
      serviceStates,
      previousProjectionId,
    ]
  );

  const { status: saveStatus, retry: saveRetry, lastSavedAt } = useProjectionDraftSave(
    formState,
    draftClientId
  );

  // Shared hydration logic — applies any draft's `state` object to local form state.
  const applyDraftState = useCallback(
    (s: NonNullable<typeof existingDraft>["state"]) => {
      if (s.year !== undefined) setYear(s.year);
      if (s.annualSales !== undefined) setAnnualSales(s.annualSales);
      if (s.totalBudget !== undefined) setTotalBudget(s.totalBudget);
      if (s.commissionRate !== undefined) setCommissionRate(s.commissionRate);
      if (s.startMonth !== undefined) setStartMonth(s.startMonth);
      if (s.projectionMode !== undefined) setProjectionMode(s.projectionMode);
      if (s.useSeasonality !== undefined) setUseSeasonality(s.useSeasonality);
      // Sub-proyecto C: prefer the new outliers field if present.
      // For legacy drafts (only seasonalityDeltas present), derive outliers from
      // months with |deltaPercent| > 0.5 (the same threshold used in the chip UI).
      if (s.seasonalityOutliers !== undefined) {
        setSeasonalityOutliers(s.seasonalityOutliers);
      } else if (s.seasonalityDeltas !== undefined) {
        const derived: SeasonalityOutlier[] = s.seasonalityDeltas
          .filter((d) => Math.abs(d.deltaPercent) > 0.5)
          .map((d) => ({
            month: d.month,
            value: d.deltaPercent,
            unit: "percent" as const,
          }));
        setSeasonalityOutliers(derived);
      }
      if (s.serviceStates !== undefined) {
        // serviceStates from the draft only carries chosenPct/isActive — merge
        // those onto the freshly-loaded service catalogue so name/min/max stay live.
        setServiceStates((prev) =>
          prev.map((p) => {
            const draftRow = s.serviceStates!.find((d) => d.serviceId === p.serviceId);
            return draftRow
              ? { ...p, chosenPct: draftRow.chosenPct, isActive: draftRow.isActive }
              : p;
          })
        );
      }
      if (s.previousProjectionId !== undefined) {
        setPreviousProjectionId(s.previousProjectionId as string);
      }
      setStep(s.step);
      setDraftHydrated(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // setters are stable; no deps needed
  );

  function hydrateFromDraft() {
    if (!existingDraft) return;
    applyDraftState(existingDraft.state);
  }

  // Auto-hydrate when ?draftId=X is present and the full draft has loaded.
  // Also restore clientId from the draft so the form is fully populated.
  const explicitHydratedRef = useRef(false);
  useEffect(() => {
    if (
      explicitDraftId &&
      explicitDraftFull &&
      !explicitHydratedRef.current &&
      initialized.current // wait for services to be seeded first
    ) {
      explicitHydratedRef.current = true;
      if (explicitDraftFull.clientId) {
        setClientId(explicitDraftFull.clientId as string);
      }
      applyDraftState(explicitDraftFull.state);
    }
  }, [explicitDraftId, explicitDraftFull, applyDraftState]);

  async function discardDraft() {
    await deleteDraft({ clientId: draftClientId });
    setDraftDismissed(true);
  }

  async function handleSubmit() {
    if (!clientId) return;
    setLoading(true);
    setSubmitError(null);
    try {
      const projId = await createProjection({
        clientId: clientId as Id<"clients">,
        year,
        annualSales,
        totalBudget,
        commissionRate,
        seasonalityData,
        seasonalityOutliers: useSeasonality ? seasonalityOutliers : undefined,
        // Derive the legacy 12-entry deltas from the computed seasonalityData so
        // the engine and any non-outlier consumers see the same shape they always have.
        seasonalityDeltas: useSeasonality
          ? seasonalityData.map((m) => ({
              month: m.month,
              deltaPercent: (m.feFactor - 1) * 100,
            }))
          : undefined,
        seasonalityMode: useSeasonality ? "outliers" : "legacy",
        serviceConfigs: serviceStates.map((s) => ({
          serviceId: s.serviceId as Id<"services">,
          chosenPct: s.chosenPct,
          isActive: s.isActive,
          subserviceId: s.subserviceId,
        })),
        // C2: projection period fields
        startMonth,
        projectionMode,
        monthCount,
        effectiveBudget,
        // C4: continuation link
        previousProjectionId: previousProjectionId
          ? (previousProjectionId as Id<"projections">)
          : undefined,
      });

      if (process.env.NODE_ENV !== "production") {
        console.log("[wizard.submit] created", { projId });
      }

      // Defensive: verify the row is readable by this user/org before redirecting.
      const verify = await convex.query(
        api.functions.projections.queries.getById,
        { id: projId }
      );
      if (!verify) {
        setSubmitError(
          "Proyección creada pero no aparece en tu organización. Refresca la página o contacta soporte."
        );
        return; // Do NOT redirect.
      }

      // Clean up the draft now that the projection is real.
      try {
        await deleteDraft({ clientId: draftClientId });
      } catch (_) {
        // Best-effort; if the delete fails the cron / next session can clean it.
      }

      router.push(`/proyecciones/${projId}`);
    } catch (err) {
      setSubmitError((err as Error).message || "Error al crear la proyección");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/proyecciones"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={14} />
        Volver
      </Link>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <TrendingUp className="text-accent" size={28} />
          <h1 className="text-2xl font-bold">
            {clients?.find((c) => c._id === clientId)?.name
              ? `${clients.find((c) => c._id === clientId)!.name} — Nueva proyección`
              : "Nueva proyección"}
          </h1>
        </div>
        <DraftSaveStatus status={saveStatus} retry={saveRetry} lastSavedAt={lastSavedAt} />
      </div>

      {existingDraft && !draftHydrated && !draftDismissed && !explicitDraftId && (
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-4">
          <p className="text-sm">
            Tienes un borrador en curso (último guardado:{" "}
            {new Date(existingDraft.updatedAt).toLocaleString()}). ¿Quieres
            continuar donde lo dejaste o empezar de nuevo?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={hydrateFromDraft}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-primary hover:bg-accent/90 cursor-pointer"
            >
              Continuar borrador
            </button>
            <button
              onClick={discardDraft}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary cursor-pointer"
            >
              Empezar de nuevo
            </button>
          </div>
        </div>
      )}

      {/* Stale/deleted/cross-org draft notice */}
      {explicitDraftId && explicitDraftFull === null && (
        <div className="rounded-md border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-900">
          El borrador no existe o no tienes permiso para abrirlo. Empieza una nueva proyección desde cero.
        </div>
      )}

      {/* Re-edit banner: shown when the draft was seeded from a previousProjectionId */}
      {previousProjectionId && draftHydrated && (
        <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
          Re-editando proyección de <b>{clients?.find((c) => c._id === clientId)?.name ?? clientId}</b>{" "}
          ({year}). Al guardar, se sobrescribirá la versión actual y se borrarán los
          documentos downstream (cotizaciones, contratos, facturas, entregables).
        </div>
      )}

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <button
              onClick={() => {
                if (i < step) {
                  setStep(i);
                }
              }}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors",
                i === step
                  ? "bg-accent text-primary"
                  : i < step
                    ? "bg-accent/20 text-accent cursor-pointer"
                    : "bg-secondary text-muted-foreground"
              )}
            >
              {i < step ? <Check size={14} /> : i + 1}
            </button>
            <span
              className={cn(
                "text-sm",
                i === step ? "text-foreground font-medium" : "text-muted-foreground"
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div className="mx-2 h-px w-8 bg-border" />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div className="rounded-lg border border-border bg-card p-6">
        {step === 0 && (
          <div className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cliente</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none cursor-pointer"
              >
                <option value="">Selecciona un cliente</option>
                {clients?.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Año</label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Tasa de Comisión (%)</label>
                <input
                  type="number"
                  value={commissionRate * 100}
                  onChange={(e) =>
                    setCommissionRate(Number(e.target.value) / 100)
                  }
                  className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  step={0.5}
                  min={0}
                  max={100}
                />
                <p className="text-xs text-muted-foreground">
                  Solo aplica a conceptos de comisión, intermediación mercantil
                  o venta por comisión. NO aplica a servicios legales, marketing,
                  RH, etc. (Ejemplo: el rubro inmobiliario suele cobrar 3-5%.)
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Venta Anual Proyectada (MXN)
                </label>
                <input
                  type="number"
                  value={annualSales || ""}
                  onChange={(e) => setAnnualSales(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  placeholder="50,000,000"
                />
                <p className="text-xs text-muted-foreground">
                  Lo que factura el cliente al año (referencia para calcular el
                  tope de mercado por servicio).
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Presupuesto Total a Contratar (MXN)
                </label>
                <input
                  type="number"
                  value={totalBudget || ""}
                  onChange={(e) => setTotalBudget(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  placeholder="30,000,000"
                />
                <p className="text-xs text-muted-foreground">
                  Lo que el cliente nos contrata. Se distribuye entre los meses
                  del contrato.
                </p>
              </div>
            </div>
            {totalBudget > 0 && (
              <ProjectionPeriodSelector
                mode={projectionMode}
                onModeChange={setProjectionMode}
                startMonth={startMonth}
                onStartMonthChange={setStartMonth}
                year={year}
                totalBudget={totalBudget}
              />
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            {flags.seasonalityEditable ? (
              <>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useSeasonality}
                      onChange={(e) => setUseSeasonality(e.target.checked)}
                      className="accent-accent"
                    />
                    <span className="text-sm font-medium">
                      Aplicar estacionalidad personalizada
                    </span>
                  </label>
                </div>

                {useSeasonality ? (
                  <SeasonalityOutliersGrid
                    value={seasonalityOutliers}
                    onChange={setSeasonalityOutliers}
                    annualSales={annualSales}
                  />
                ) : (
                  <div className="rounded-md bg-secondary/50 p-4 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Sin estacionalidad personalizada.</span>{" "}
                      Tomamos la facturación del cliente ({formatCurrency(annualSales)}) y la repartimos en 12 meses
                      (~{formatCurrency(annualSales / 12)}/mes){" "}
                      <span className="font-medium">solo para calcular los factores de estacionalidad (FE).</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Esto NO es el monto que se cobra — eso lo define el presupuesto contratado{" "}
                      ({formatCurrency(totalBudget)}) ÷ {monthCount} meses{" "}
                      = ~{formatCurrency(monthCount > 0 ? totalBudget / monthCount : 0)}/mes.
                    </p>
                  </div>
                )}

                {useSeasonality && seasonalityData.length === 12 && (
                  <SeasonalityChart data={seasonalityData} />
                )}
              </>
            ) : (
              <div className="rounded-md bg-secondary/50 p-4 space-y-2">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Sin estacionalidad.</span>{" "}
                  Tomamos la facturación del cliente ({formatCurrency(annualSales)}) y la repartimos en 12 meses
                  (~{formatCurrency(annualSales / 12)}/mes){" "}
                  <span className="font-medium">solo para calcular los factores de estacionalidad (FE).</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Esto NO es el monto que se cobra — eso lo define el presupuesto contratado{" "}
                  ({formatCurrency(totalBudget)}) ÷ {monthCount} meses{" "}
                  = ~{formatCurrency(monthCount > 0 ? totalBudget / monthCount : 0)}/mes.
                </p>
                <p className="text-xs text-muted-foreground italic">
                  La estacionalidad está configurada por el administrador.
                </p>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col-reverse md:grid md:grid-cols-[1fr_220px] gap-6 items-start">
            {/* Service list */}
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Configura los servicios activos y sus porcentajes para esta
                proyección.
              </p>
              {allocation.perService.some((s) => s.marketStatus === "above") && (
                <div className="rounded-lg border border-red-400/40 bg-red-400/5 p-3">
                  <p className="text-sm">
                    <span className="font-medium">Hay áreas sobre el rango de mercado.</span>{" "}
                    Considera agregar o activar más servicios para distribuir
                    mejor el presupuesto.
                  </p>
                </div>
              )}
              <div className="space-y-3">
                {serviceStates.map((svc, i) => {
                  const svcAllocation =
                    allocation.perService.find((p) => p.serviceId === svc.serviceId) ?? null;
                  const subOptions = subservicesByParent.get(svc.serviceId) ?? [];
                  return (
                    <div key={svc.serviceId} className="space-y-2">
                      <ServiceRow
                        service={svc}
                        allocation={svcAllocation}
                        annualSales={annualSales}
                        commissionRate={commissionRate}
                        onToggleActive={(next) => {
                          const updated = [...serviceStates];
                          updated[i] = { ...updated[i], isActive: next };
                          setServiceStates(updated);
                        }}
                        onChangePct={(next) => {
                          const updated = [...serviceStates];
                          updated[i] = { ...updated[i], chosenPct: next };
                          setServiceStates(updated);
                        }}
                      />
                      {svc.isActive && (
                        <div className="ml-6 space-y-1">
                          {subOptions.length > 0 ? (
                            <>
                              <label className="text-xs text-muted-foreground">
                                Subservicio (obligatorio)
                              </label>
                              <select
                                value={svc.subserviceId ?? ""}
                                onChange={(e) => {
                                  const updated = [...serviceStates];
                                  const val = e.target.value;
                                  updated[i] = {
                                    ...updated[i],
                                    subserviceId: val
                                      ? (val as Id<"subservices">)
                                      : undefined,
                                  };
                                  setServiceStates(updated);
                                }}
                                required
                                aria-label={`Subservicio para ${svc.serviceName}`}
                                className="text-sm rounded-md border border-border bg-secondary px-2 py-1.5 focus:border-accent focus:outline-none cursor-pointer"
                              >
                                <option value="" disabled>
                                  — Selecciona subservicio —
                                </option>
                                {subOptions.map((o) => (
                                  <option key={o._id} value={o._id}>
                                    {o.name} · {o.defaultFrequency}
                                  </option>
                                ))}
                              </select>
                              {!svc.subserviceId && (
                                <p className="text-xs text-red-400">
                                  Selecciona un subservicio antes de continuar.
                                </p>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-amber-400">
                              Este servicio no tiene subservicios configurados
                              aún. Configúralos en{" "}
                              <Link
                                href="/configuracion/subservicios"
                                className="underline hover:no-underline"
                              >
                                /configuracion/subservicios
                              </Link>
                              .
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Budget allocation widget — sticky on md+, stacked on mobile */}
            <div className="md:sticky md:top-6">
              <BudgetAllocationWidget
                budget={effectiveBudget}
                annualSales={annualSales}
                commissionRate={commissionRate}
                services={serviceStates.map((s) => ({
                  serviceId: s.serviceId,
                  serviceName: s.serviceName,
                  isActive: s.isActive,
                  isCommission: s.isCommission,
                  chosenPct: s.chosenPct,
                }))}
                allocation={allocation}
              />
            </div>
          </div>
        )}

        {step === 3 && preview && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold">Resumen de Proyección</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-md bg-secondary/40 p-3 border border-dashed border-muted-foreground/20">
                <p className="text-xs text-muted-foreground">
                  Facturación anual del cliente
                </p>
                <p className="text-lg font-bold">
                  {formatCurrency(annualSales)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 italic">
                  Referencia, no se distribuye
                </p>
              </div>
              <div className="rounded-md bg-secondary p-3">
                <p className="text-xs text-muted-foreground">
                  Presupuesto contratado
                </p>
                <p className="text-lg font-bold">
                  {formatCurrency(totalBudget)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 italic">
                  Base de distribución
                </p>
              </div>
              <div className="rounded-md bg-secondary p-3">
                <p className="text-xs text-muted-foreground">
                  Total asignado a servicios
                </p>
                <p className="text-lg font-bold text-accent">
                  {formatCurrency(preview.grandTotal)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 italic">
                  Suma de los servicios contratados
                </p>
              </div>
            </div>

            {/* Service Summary */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Distribución por Servicio</h4>
              {preview.services
                .filter((s) => s.isActive)
                .map((svc) => (
                  <div
                    key={svc.serviceId}
                    className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2"
                  >
                    <span className="text-sm">{svc.serviceName}</span>
                    <span className="text-sm font-medium">
                      {formatCurrency(svc.annualAmount)}
                    </span>
                  </div>
                ))}
            </div>

            {/* Monthly Totals */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Totales Mensuales</h4>
              <div className="grid grid-cols-6 gap-2">
                {preview.monthlyTotals.map((mt) => (
                  <div
                    key={mt.month}
                    className="rounded-md bg-secondary/50 p-2 text-center"
                  >
                    <p className="text-xs text-muted-foreground">
                      {MONTH_NAMES[mt.month - 1]}
                    </p>
                    <p className="text-xs font-medium">
                      {formatCurrency(mt.total)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Buttons */}
      <div className="flex justify-between">
        <button
          onClick={() => {
            setStep((s) => Math.max(0, s - 1));
          }}
          disabled={step === 0}
          className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-30 cursor-pointer"
        >
          <ArrowLeft size={14} />
          Anterior
        </button>

        {step < 3 ? (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => {
                // Guard: if the autosave is in a terminal error state, warn before navigating.
                // The user can still proceed — the hook will retry on the next formState change.
                if (saveStatus === "error" && saveRetry >= 3) {
                  console.warn("[wizard.nav] autosave failed after 3 retries — proceeding anyway");
                }
                // Step 4 (clearPreClientDraft promotion): when the user advances from
                // step 0 (where they pick a client) to step 1, migrate any pre-client
                // draft (undefined-slot) to the client-specific slot and delete the
                // undefined-slot orphan.
                if (step === 0 && draftClientId) {
                  upsertDraft({
                    clientId: draftClientId,
                    state: formState as never,
                    clearPreClientDraft: true,
                  }).catch((e) =>
                    console.warn("[wizard.nav] clearPreClientDraft promotion failed (non-fatal):", e)
                  );
                }
                setStep((s) => s + 1);
              }}
              disabled={
                (step === 0 && (!clientId || annualSales <= 0 || totalBudget <= 0)) ||
                (step === 2 &&
                  (Math.abs(allocation.remaining) > 0.01 ||
                    missingSubserviceSelection))
              }
              title={
                step === 2 && Math.abs(allocation.remaining) > 0.01
                  ? "Asigna exactamente el presupuesto antes de continuar."
                  : step === 2 && missingSubserviceSelection
                    ? "Selecciona un subservicio para cada servicio activo antes de continuar."
                    : undefined
              }
              className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Siguiente
              <ArrowRight size={14} />
            </button>
            {step === 2 && Math.abs(allocation.remaining) > 0.01 && (
              <p className="text-xs text-muted-foreground">
                Asigna exactamente el presupuesto antes de continuar.
              </p>
            )}
            {step === 2 &&
              Math.abs(allocation.remaining) <= 0.01 &&
              missingSubserviceSelection && (
                <p className="text-xs text-muted-foreground">
                  Selecciona un subservicio para cada servicio activo.
                </p>
              )}
          </div>
        ) : (
          <div className="flex flex-col items-end gap-2">
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center gap-2 rounded-md bg-accent px-6 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? "Creando..." : "Crear Proyección"}
              <Check size={14} />
            </button>
            {submitError && (
              <p className="max-w-sm text-right text-xs text-red-400">
                {submitError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { Suspense, useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import {
  calculateProjection,
  generateEvenSeasonality,
} from "../../../../../convex/lib/projectionEngine";
import { SeasonalityChart } from "@/components/projections/seasonality-chart";
import { BudgetAllocationWidget } from "@/components/projections/budget-allocation-widget";
import { SeasonalityDeltaGrid } from "@/components/projections/seasonality-delta-grid";
import { computeServiceAllocation } from "@/lib/projection-allocation";
import { formatCurrency } from "@/lib/utils";
import {
  type SeasonalityDelta,
  seasonalityDataFromDeltas,
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
};

function NuevaProyeccionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedClientId = searchParams.get("clientId");

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  // Step 1: Basic data
  const [clientId, setClientId] = useState(preselectedClientId ?? "");
  const [year, setYear] = useState(new Date().getFullYear());
  const [annualSales, setAnnualSales] = useState(0);
  const [totalBudget, setTotalBudget] = useState(0);
  const [commissionRate, setCommissionRate] = useState(0.02);

  // Step 2: Seasonality deltas
  const [seasonalityDeltas, setSeasonalityDeltas] = useState<SeasonalityDelta[]>(defaultDeltas());
  const [useSeasonality, setUseSeasonality] = useState(false);

  // Step 3: Services
  const [serviceStates, setServiceStates] = useState<ServiceFormState[]>([]);

  const { flags } = useOrgConfig();
  const { isLoaded, orgId } = useAuth();
  const authReady = isLoaded && !!orgId;

  const clients = useQuery(
    api.functions.clients.queries.list,
    authReady ? {} : "skip"
  );
  const services = useQuery(
    api.functions.services.queries.listGlobal,
    authReady ? {} : "skip"
  );
  const createProjection = useMutation(
    api.functions.projections.mutations.create
  );

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
    ? seasonalityDataFromDeltas(annualSales, seasonalityDeltas)
    : generateEvenSeasonality(annualSales);

  const preview =
    serviceStates.length > 0
      ? calculateProjection({
          annualSales,
          totalBudget,
          commissionRate,
          services: serviceStates,
          seasonalityData,
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
        totalBudget,
        annualSales,
        commissionRate,
        serviceStates.map((s) => ({
          serviceId: s.serviceId,
          serviceName: s.serviceName,
          isActive: s.isActive,
          isCommission: s.isCommission,
          chosenPct: s.chosenPct,
        })),
        "proportional"
      ),
    [totalBudget, annualSales, commissionRate, serviceStates]
  );

  async function handleSubmit() {
    if (!clientId) return;
    setLoading(true);
    try {
      const projId = await createProjection({
        clientId: clientId as Id<"clients">,
        year,
        annualSales,
        totalBudget,
        commissionRate,
        seasonalityData,
        seasonalityDeltas: useSeasonality ? seasonalityDeltas : undefined,
        seasonalityMode: useSeasonality ? "delta_percent" : "legacy",
        serviceConfigs: serviceStates.map((s) => ({
          serviceId: s.serviceId as Id<"services">,
          chosenPct: s.chosenPct,
          isActive: s.isActive,
        })),
      });
      router.push(`/proyecciones/${projId}`);
    } catch (err) {
      alert((err as Error).message || "Error al crear la proyección");
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

      <div className="flex items-center gap-3">
        <TrendingUp className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Nueva Proyección</h1>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <button
              onClick={() => i < step && setStep(i)}
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
              </div>
            </div>
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
                  <SeasonalityDeltaGrid
                    value={seasonalityDeltas}
                    onChange={setSeasonalityDeltas}
                    annualSales={annualSales}
                  />
                ) : (
                  <div className="rounded-md bg-secondary/50 p-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      Sin estacionalidad: la venta anual del cliente se reparte
                      uniformemente como {formatCurrency(annualSales / 12)}/mes
                      (referencia para FE — no es la distribución del presupuesto).
                    </p>
                  </div>
                )}

                {useSeasonality && seasonalityData.length === 12 && (
                  <SeasonalityChart data={seasonalityData} />
                )}
              </>
            ) : (
              <div className="rounded-md bg-secondary/50 p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Sin estacionalidad: las ventas se distribuirán uniformemente
                  ({formatCurrency(annualSales / 12)}/mes).
                </p>
                <p className="text-xs text-muted-foreground mt-2 italic">
                  La estacionalidad está configurada por el administrador
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
              <div className="space-y-3">
                {serviceStates.map((svc, i) => (
                  <div
                    key={svc.serviceId}
                    className={cn(
                      "flex items-center gap-4 rounded-md border p-3 transition-colors",
                      svc.isActive
                        ? "border-accent/30 bg-accent/5"
                        : "border-border opacity-50"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={svc.isActive}
                      onChange={(e) => {
                        const updated = [...serviceStates];
                        updated[i] = {
                          ...updated[i],
                          isActive: e.target.checked,
                        };
                        setServiceStates(updated);
                      }}
                      className="accent-accent cursor-pointer"
                      disabled={svc.isCommission}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{svc.serviceName}</p>
                      <p className="text-xs text-muted-foreground">
                        {svc.type === "base" ? "Base" : "Comodín"} &middot;{" "}
                        {svc.isCommission
                          ? `= Tasa de comisión (${(commissionRate * 100).toFixed(1)}%)`
                          : `Rango: ${(svc.minPct * 100).toFixed(1)}% - ${(svc.maxPct * 100).toFixed(1)}%`}
                      </p>
                    </div>
                    {!svc.isCommission && svc.isActive && (
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={svc.minPct * 100}
                          max={svc.maxPct * 100}
                          step={0.5}
                          value={svc.chosenPct * 100}
                          onChange={(e) => {
                            const updated = [...serviceStates];
                            updated[i] = {
                              ...updated[i],
                              chosenPct: Number(e.target.value) / 100,
                            };
                            setServiceStates(updated);
                          }}
                          className="w-24 accent-accent cursor-pointer"
                        />
                        <span className="w-12 text-right text-sm font-medium">
                          {(svc.chosenPct * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                    {preview && svc.isActive && (
                      <span className="text-sm font-medium text-accent">
                        {formatCurrency(
                          preview.services.find(
                            (s) => s.serviceId === svc.serviceId
                          )?.annualAmount ?? 0
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Budget allocation widget — sticky on md+, stacked on mobile */}
            <div className="md:sticky md:top-6">
              <BudgetAllocationWidget
                budget={totalBudget}
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
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
          className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-30 cursor-pointer"
        >
          <ArrowLeft size={14} />
          Anterior
        </button>

        {step < 3 ? (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => setStep(step + 1)}
              disabled={
                (step === 0 && (!clientId || annualSales <= 0 || totalBudget <= 0)) ||
                (step === 2 && Math.abs(allocation.remaining) > 0.01)
              }
              title={
                step === 2 && Math.abs(allocation.remaining) > 0.01
                  ? "Asigna exactamente el presupuesto antes de continuar."
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
          </div>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 rounded-md bg-accent px-6 py-2 text-sm font-medium text-primary hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? "Creando..." : "Crear Proyección"}
            <Check size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

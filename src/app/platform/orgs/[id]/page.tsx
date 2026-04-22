"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Save, Loader2, Palette } from "lucide-react";
import Link from "next/link";

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

export default function OrgDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.id as string;

  const isNew = orgId === "new";

  const org = useQuery(
    api.functions.organizations.queries.getByIdForAdmin,
    isNew ? "skip" : { id: orgId as Id<"organizations"> }
  );

  const config = useQuery(
    api.functions.orgConfigs.queries.getByOrgIdForAdmin,
    isNew || !org ? "skip" : { orgId: org.clerkOrgId }
  );

  const allServices = useQuery(api.functions.services.queries.listAllForAdmin);

  const updateOrg = useMutation(api.functions.organizations.mutations.update);
  const createOrg = useMutation(api.functions.organizations.mutations.create);
  const updateStatus = useMutation(api.functions.organizations.mutations.updateStatus);
  const upsertConfig = useMutation(api.functions.orgConfigs.mutations.upsert);

  // Form state
  const [name, setName] = useState("");
  const [clerkOrgId, setClerkOrgId] = useState("");
  const [plan, setPlan] = useState<"basic" | "pro" | "enterprise">("basic");
  const [status, setStatus] = useState<"active" | "inactive" | "suspended">("active");
  const [assignedServiceIds, setAssignedServiceIds] = useState<string[]>([]);

  // Config state
  const [calculationMode, setCalculationMode] = useState<"weighted" | "fixed">("weighted");
  const [commissionMode, setCommissionMode] = useState<"proportional" | "fixed_monthly">("proportional");
  const [seasonalityEnabled, setSeasonalityEnabled] = useState(true);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>(defaultFeatureFlags);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Initialize form from loaded data
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

        // Also create config
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

      // Update org
      await updateOrg({
        id: org._id,
        name: name.trim(),
        plan,
        assignedServiceIds: assignedServiceIds as Id<"services">[],
      });

      // Update status if changed
      if (status !== org.status) {
        await updateStatus({
          id: org._id,
          status,
        });
      }

      // Upsert config
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

  // Loading state
  if (!isNew && org === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
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

  const defaultServices = (allServices ?? []).filter((s) => s.isDefault);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
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

      {/* Error / Success banners */}
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

      {/* Org Info Section */}
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

      {/* Service Assignment Section */}
      {!isNew && (
        <section className="rounded-lg border border-border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            Servicios Asignados
          </h2>
          <p className="text-sm text-muted-foreground">
            Selecciona los servicios disponibles para esta organizacion. Si no se
            selecciona ninguno, tendra acceso a todos los servicios por defecto.
          </p>

          {defaultServices.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              Cargando servicios...
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {defaultServices.map((service) => {
                const checked = assignedServiceIds.includes(service._id as string);
                return (
                  <label
                    key={service._id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-4 py-3 hover:bg-secondary/50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleServiceToggle(service._id as string)}
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

      {/* Config Section */}
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

        {/* Seasonality toggle */}
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

      {/* Feature Flags Section */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Feature Flags</h2>
        <p className="text-sm text-muted-foreground">
          Controla que funcionalidades estan disponibles para esta organizacion.
        </p>

        <div className="space-y-3">
          {(Object.keys(featureFlagLabels) as (keyof FeatureFlags)[]).map(
            (flag) => (
              <label key={flag} className="flex cursor-pointer items-center gap-3">
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

      {/* Save Button */}
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

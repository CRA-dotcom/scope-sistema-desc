"use client";

import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { UploadForm } from "./components/UploadForm";
import { PeriodsTable } from "./components/PeriodsTable";
import { ViewerDrawer } from "./components/ViewerDrawer";

export default function ClientFinanzasPage() {
  const params = useParams();
  const clientId = params.id as Id<"clients">;

  const client = useQuery(api.functions.clients.queries.getById, {
    id: clientId,
  });
  const rows = useQuery(
    api.functions.clientFinancialData.queries.listByClient,
    { clientId }
  );

  const [selectedId, setSelectedId] = useState<Id<"clientFinancialData"> | null>(
    null
  );

  if (client === undefined) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-secondary" />
        <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (client === null) {
    return (
      <div className="space-y-4">
        <Link
          href="/clientes"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft size={14} /> Volver a Clientes
        </Link>
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">Cliente no encontrado.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/clientes/${clientId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft size={14} /> Volver a {client.name}
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <FileSpreadsheet size={20} className="text-muted-foreground" />
          <h1 className="text-2xl font-semibold">
            Estados financieros — {client.name}
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Sube Excel del cliente. Claude extrae line items y los presenta para
          tu validación antes de inyectarlos al contexto de los entregables.
        </p>
      </div>

      <UploadForm clientId={clientId} />

      <PeriodsTable rows={rows ?? []} onSelect={setSelectedId} />

      {selectedId && (
        <ViewerDrawer
          id={selectedId}
          clientId={clientId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

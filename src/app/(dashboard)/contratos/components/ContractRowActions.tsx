"use client";

import { useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Doc } from "../../../../../convex/_generated/dataModel";

export function ContractRowActions({ contract }: { contract: Doc<"contracts"> }) {
  const cancel = useMutation(api.functions.contracts.mutations.cancelContract);

  const handleCancel = async () => {
    const reason = prompt("Razón de cancelación:") ?? "";
    if (!reason.trim()) return;
    if (!confirm(`¿Cancelar contrato de ${contract.serviceName}?`)) return;
    await cancel({ contractId: contract._id, reason });
  };

  return (
    <div className="flex items-center gap-3 text-xs">
      {contract.firmameSignUrl && (
        <a
          href={contract.firmameSignUrl}
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline cursor-pointer"
        >
          Ver
        </a>
      )}
      {contract.status === "sent" && (
        <button
          onClick={handleCancel}
          className="text-rose-400 hover:underline cursor-pointer"
        >
          Cancelar
        </button>
      )}
    </div>
  );
}

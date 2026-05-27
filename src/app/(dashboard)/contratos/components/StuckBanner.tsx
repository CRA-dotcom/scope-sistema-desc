"use client";

const DAY_MS = 24 * 3600 * 1000;

type ContractRow = {
  status: string;
  sentAt?: number;
};

export function StuckBanner({ contracts }: { contracts: ContractRow[] }) {
  const now = Date.now();
  const stuck = contracts.filter(
    (c) => c.status === "sent" && c.sentAt && (now - c.sentAt) / DAY_MS > 7
  );
  if (stuck.length === 0) return null;
  return (
    <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      {stuck.length} contrato{stuck.length === 1 ? "" : "s"} sin firmar por
      más de 7 días.
    </div>
  );
}

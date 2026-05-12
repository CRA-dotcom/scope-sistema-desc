"use client";

export type SectionNavItem = {
  id: string;
  label: string;
  answered: number;
  total: number;
};

export function SectionNav({ sections }: { sections: SectionNavItem[] }) {
  return (
    <>
      {/* Desktop: sticky sidebar */}
      <nav
        aria-label="Secciones del cuestionario"
        className="hidden lg:block sticky top-24 self-start w-64 shrink-0"
      >
        <ul className="space-y-1 text-sm">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="flex justify-between rounded px-3 py-2 hover:bg-slate-100"
              >
                <span className="truncate">{s.label}</span>
                <span className="text-slate-500 ml-2 shrink-0">
                  {s.answered}/{s.total}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Mobile: jump <select> */}
      <div className="lg:hidden mb-4">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Saltar a sección
        </label>
        <select
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          onChange={(e) => {
            const id = e.target.value;
            if (id) location.hash = id;
          }}
          defaultValue=""
        >
          <option value="">— Selecciona —</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} ({s.answered}/{s.total})
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

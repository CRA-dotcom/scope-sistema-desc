import { ExternalLink } from "lucide-react";

const STEPS: Array<{ n: number; title: string; body: React.ReactNode }> = [
  {
    n: 1,
    title: "Crea cuenta en Resend",
    body: (
      <>
        Ve a{" "}
        <a
          href="https://resend.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline inline-flex items-center gap-1"
        >
          resend.com <ExternalLink size={11} />
        </a>{" "}
        y crea una cuenta con el email de tu empresa.
      </>
    ),
  },
  {
    n: 2,
    title: "Agrega tu dominio",
    body: (
      <>
        Desde la sección <strong>Domains</strong> agrega el dominio desde el
        que quieres enviar (ej. <code>cotizaciones.tu-empresa.mx</code>).
      </>
    ),
  },
  {
    n: 3,
    title: "Configura los DNS records",
    body: (
      <>
        Resend te muestra records MX, TXT y CNAME. Agrégalos en tu proveedor
        de dominios (Cloudflare, GoDaddy, etc.). Puede tardar de minutos a
        varias horas en propagar.
      </>
    ),
  },
  {
    n: 4,
    title: "Verifica el dominio",
    body: (
      <>
        Vuelve a Resend y click &quot;Verify&quot;. Espera a que el dominio
        aparezca como <strong>Verified</strong>.
      </>
    ),
  },
  {
    n: 5,
    title: "Crea un API key y configura webhook",
    body: (
      <>
        En <strong>API Keys</strong> crea uno con permisos Full Access. En{" "}
        <strong>Webhooks</strong> agrega endpoint{" "}
        <code>&lt;tu-URL&gt;/webhooks/resend</code> (tu admin tiene esta URL)
        y copia el <strong>Signing Secret</strong>. Pega ambos valores en el
        formulario abajo.
      </>
    ),
  },
];

export function ResendSetupGuide() {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
        Cómo configurar Resend
      </h3>
      <ol className="space-y-4">
        {STEPS.map((s) => (
          <li key={s.n} className="flex gap-3">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent text-sm font-semibold">
              {s.n}
            </span>
            <div className="pt-0.5">
              <p className="text-sm font-medium">{s.title}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

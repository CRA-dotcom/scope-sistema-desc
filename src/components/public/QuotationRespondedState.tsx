import { CheckCircle2, XCircle } from "lucide-react";
import { PublicFooter } from "./PublicFooter";

export function QuotationRespondedState({
  status,
  respondedAt,
  justNow = false,
}: {
  status: "approved" | "rejected";
  respondedAt?: number | null;
  justNow?: boolean;
}) {
  const isApproved = status === "approved";
  const when = respondedAt
    ? new Date(respondedAt).toLocaleDateString("es-MX", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <div
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
            isApproved ? "bg-emerald-500/20" : "bg-muted/40"
          }`}
        >
          {isApproved ? (
            <CheckCircle2 className="text-emerald-400" size={28} />
          ) : (
            <XCircle className="text-muted-foreground" size={28} />
          )}
        </div>
        {justNow ? (
          isApproved ? (
            <>
              <h1 className="text-xl font-semibold">¡Gracias!</h1>
              <p className="text-sm text-muted-foreground">
                Hemos registrado tu aceptación. En breve recibirás el contrato para firmar en tu correo.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold">Respuesta registrada</h1>
              <p className="text-sm text-muted-foreground">
                Si cambias de opinión, contacta a tu ejecutivo.
              </p>
            </>
          )
        ) : (
          <>
            <h1 className="text-xl font-semibold">
              Esta cotización fue {isApproved ? "aprobada" : "rechazada"}
              {when ? ` el ${when}` : ""}
            </h1>
            <p className="text-sm text-muted-foreground">
              Contacta a tu ejecutivo si necesitas modificarla.
            </p>
          </>
        )}
        <PublicFooter />
      </div>
    </div>
  );
}

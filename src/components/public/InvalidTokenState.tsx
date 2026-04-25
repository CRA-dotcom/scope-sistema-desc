import { Search } from "lucide-react";
import { PublicFooter } from "./PublicFooter";

export function InvalidTokenState() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted/40">
          <Search className="text-muted-foreground" size={28} />
        </div>
        <h1 className="text-xl font-semibold">Link no válido</h1>
        <p className="text-sm text-muted-foreground">
          Verifica que copiaste el link correcto de tu correo o contacta a tu ejecutivo.
        </p>
        <PublicFooter />
      </div>
    </div>
  );
}

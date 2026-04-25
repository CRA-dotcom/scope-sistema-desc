import { Clock } from "lucide-react";
import { PublicFooter } from "./PublicFooter";

export function ExpiredState() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20">
          <Clock className="text-amber-400" size={28} />
        </div>
        <h1 className="text-xl font-semibold">Esta cotización expiró</h1>
        <p className="text-sm text-muted-foreground">
          Por favor contacta a tu ejecutivo para solicitar una nueva cotización.
        </p>
        <PublicFooter />
      </div>
    </div>
  );
}

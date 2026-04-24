"use client";

import Link from "next/link";
import { Mail, ChevronLeft } from "lucide-react";
import { EmailLogList } from "@/components/email-log/EmailLogList";

export default function EmailLogPage() {
  return (
    <div className="space-y-6">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} /> Configuración
      </Link>

      <div className="flex items-center gap-3">
        <Mail className="text-accent" size={28} />
        <h1 className="text-2xl font-bold">Email Log</h1>
      </div>

      <EmailLogList />
    </div>
  );
}

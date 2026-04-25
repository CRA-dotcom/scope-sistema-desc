import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cotización",
  robots: "noindex,nofollow",
};

export default function PublicQuotationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}

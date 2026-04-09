import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ImovelMap — Agenciamento de Imóveis",
  description: "Mapa público de imóveis e ferramentas de agenciamento para corretores"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

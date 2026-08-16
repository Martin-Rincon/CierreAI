import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CierreAI",
  description: "Encontrá la diferencia de tu cierre de caja.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}

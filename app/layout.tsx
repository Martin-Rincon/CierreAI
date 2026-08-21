import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CierreAI | Control de caja",
  description: "Asistente para conciliación y cierre de caja",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}

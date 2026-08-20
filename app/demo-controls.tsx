"use client";

import { useState, useTransition } from "react";
import { cargarEscenarioDemo } from "./actions";

export function DemoControls({ tieneMovimientos }: { tieneMovimientos: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cargar(esRestablecer: boolean) {
    if (tieneMovimientos && !window.confirm("Este cierre ya tiene movimientos. ¿Querés reemplazarlos por el escenario demo?")) return;
    setError(null);
    startTransition(async () => {
      try {
        await cargarEscenarioDemo(tieneMovimientos || esRestablecer);
      } catch {
        setError("No pudimos cargar el escenario demo. Probá de nuevo.");
      }
    });
  }

  return (
    <section className="mb-5 rounded-xl border border-dashed border-slate-300 bg-white/70 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
      <div><h2 className="text-sm font-bold text-slate-900">Modo demo</h2><p className="mt-1 text-xs leading-5 text-slate-600">Carga operaciones de ejemplo en el cierre de hoy. El análisis se ejecuta por separado.</p></div>
      <div className="mt-3 flex flex-col gap-2 sm:mt-0 sm:flex-row">
        <button type="button" disabled={pending} onClick={() => cargar(false)} className="rounded-lg border border-blue-300 bg-white px-3 py-2.5 text-sm font-bold text-blue-700 disabled:cursor-wait disabled:opacity-60">{pending ? "Cargando escenario…" : "Cargar escenario demo"}</button>
        <button type="button" disabled={pending} onClick={() => cargar(true)} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60">Restablecer escenario demo</button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </section>
  );
}

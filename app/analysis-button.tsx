"use client";

import { useState, useTransition } from "react";
import { analizarDiferencia } from "./actions";

export function AnalysisButton({ cierreId }: { cierreId: number }) {
  const [pending, startTransition] = useTransition();
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function analizar() {
    setError(null);
    setVisible(true);
    startTransition(async () => {
      try {
        await Promise.all([analizarDiferencia(cierreId), new Promise((resolve) => setTimeout(resolve, 500))]);
      } catch {
        setError("No pudimos completar el análisis. Tus movimientos siguen disponibles; probá nuevamente.");
      } finally {
        setVisible(false);
      }
    });
  }
  return <>
    {error && <p role="alert" className="mt-2 max-w-xs text-sm text-red-700">{error}</p>}
    <button type="button" onClick={analizar} disabled={pending} className="mt-5 w-full rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70 sm:mt-0 sm:w-auto">{pending ? "Analizando…" : "Analizar diferencia"}</button>
    {visible && <div role="status" aria-live="polite" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"><div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-4 size-9 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" /><h2 className="text-lg font-bold text-slate-950">Analizando cierre…</h2><ul className="mt-4 space-y-2 text-sm text-slate-600"><li>Revisando ventas</li><li>Comparando pagos</li><li>Verificando efectivo</li><li>Buscando posibles causas</li></ul></div></div>}
  </>;
}

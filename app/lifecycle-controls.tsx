"use client";

import { useState, useTransition } from "react";
import { finalizarCierreSeleccionado, reabrirCierreSeleccionado } from "./actions";

function pesos(centavos: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Math.abs(centavos) / 100);
}

export function LifecycleControls({ cierreId, diferencia, resuelto, finalizado }: { cierreId: number; diferencia: number; resuelto: boolean; finalizado: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const mensaje = finalizado
    ? "Este cierre volverá a estar editable. ¿Querés continuar?"
    : diferencia === 0
      ? "El cierre concilia correctamente. ¿Querés finalizarlo?"
      : resuelto
        ? "La diferencia está completamente explicada. ¿Querés finalizar el cierre?"
        : `Este cierre todavía tiene una diferencia de ${pesos(diferencia)} sin explicar. Podés finalizarlo igualmente, pero quedará registrado con una diferencia pendiente.`;

  function confirmar() {
    setError(null);
    const data = new FormData();
    data.set("cierre_id", String(cierreId));
    startTransition(async () => {
      try {
        if (finalizado) await reabrirCierreSeleccionado(data);
        else await finalizarCierreSeleccionado(data);
        setAbierto(false);
      } catch {
        setError("No pudimos actualizar el cierre. Probá nuevamente.");
      }
    });
  }

  return <div className="mt-4 sm:mt-0">
    <button type="button" onClick={() => setAbierto(true)} className={finalizado ? "w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 sm:w-auto" : "w-full rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-700 sm:w-auto"}>{finalizado ? "Reabrir cierre" : "Finalizar cierre"}</button>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {abierto && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="ciclo-title">
      <div className="my-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id="ciclo-title" className="text-xl font-bold text-slate-950">{finalizado ? "Reabrir cierre" : "Finalizar cierre"}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-700">{mensaje}</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={pending} onClick={() => setAbierto(false)} className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 disabled:opacity-60">Cancelar</button>
          <button type="button" disabled={pending} onClick={confirmar} className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60">{pending ? "Guardando…" : finalizado ? "Reabrir cierre" : "Finalizar cierre"}</button>
        </div>
      </div>
    </div>}
  </div>;
}

"use client";

import { useState, useTransition } from "react";
import { cargarGastoConResultado, type ResultadoCargaGasto } from "./actions";
import { LocalTimeInput } from "./local-time-input";

function pesos(centavos: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(centavos / 100);
}

export function ExpenseForm({ cierreId }: { cierreId: number }) {
  const [rechazo, setRechazo] = useState<ResultadoCargaGasto | null>(null);
  const [pending, startTransition] = useTransition();
  const [submissionId] = useState(() => crypto.randomUUID());

  function enviar(formData: FormData) {
    startTransition(async () => {
      const resultado = await cargarGastoConResultado(formData);
      if (!resultado.ok && resultado.tipo === "efectivo_insuficiente") setRechazo(resultado);
    });
  }

  return <>
    <form action={enviar} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="submission_id" value={submissionId} />
      <input type="hidden" name="cierre_id" value={cierreId} />
      <h3 className="mb-3 font-bold text-slate-900">Nuevo gasto</h3>
      <div className="space-y-3">
        <label className="block text-xs font-bold text-slate-600">Monto<span className="relative mt-1 block"><span className="absolute left-3 top-2.5 text-sm text-slate-500">$</span><input name="monto" inputMode="decimal" required pattern="[0-9]+([,.][0-9]{1,2})?" placeholder="0,00" className="block w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-7 pr-3 text-sm" /></span></label>
        <label className="block text-xs font-bold text-slate-600">Categoría<input name="categoria" required maxLength={100} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" /></label>
        <label className="block text-xs font-bold text-slate-600">Descripción (opcional)<input name="descripcion" maxLength={100} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" /></label>
        <label className="block text-xs font-bold text-slate-600">Medio de pago<select name="medio_pago" required className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="mercado_pago">Mercado Pago</option></select></label>
        <label className="block text-xs font-bold text-slate-600">Hora<LocalTimeInput /></label>
        <button type="submit" disabled={pending} className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60">{pending ? "Cargando…" : "Cargar"}</button>
      </div>
    </form>
    {rechazo && <CashInsufficientDialog rechazo={rechazo} onClose={() => setRechazo(null)} />}
  </>;
}

export function CashInsufficientDialog({ rechazo, onClose }: { rechazo: ResultadoCargaGasto; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="efectivo-insuficiente-title"><div className="my-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 id="efectivo-insuficiente-title" className="text-xl font-bold text-slate-950">No hay suficiente efectivo en caja</h2><p className="mt-2 text-sm leading-6 text-slate-600">El gasto supera el efectivo disponible según el efectivo inicial + ventas en efectivo − gastos en efectivo.</p><dl className="mt-4 space-y-2 rounded-xl bg-slate-50 p-4 text-sm"><div className="flex justify-between gap-4"><dt className="font-semibold text-slate-600">Efectivo disponible</dt><dd className="font-bold tabular-nums text-slate-950">{pesos(rechazo.efectivoDisponible)}</dd></div><div className="flex justify-between gap-4"><dt className="font-semibold text-slate-600">Gasto ingresado</dt><dd className="font-bold tabular-nums text-slate-950">{pesos(rechazo.gastoIngresado)}</dd></div></dl><p className="mt-4 text-sm text-slate-700">Revisá el monto del gasto o el efectivo inicial antes de continuar.</p><button type="button" autoFocus onClick={onClose} className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-700">Entendido</button></div></div>;
}

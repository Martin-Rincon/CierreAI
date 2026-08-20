"use client";

import { useState, useTransition } from "react";
import type { MovimientoInterpretado } from "@/lib/ia";
import { confirmarMovimientoIa, interpretarConIa } from "./actions";
import { SubmitButton } from "./submit-button";

const medios = { efectivo: "Efectivo", transferencia: "Transferencia", mercado_pago: "Mercado Pago" } as const;

function pesos(centavos: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(centavos / 100);
}

export function NaturalLanguageInput({ configurada }: { configurada: boolean }) {
  const [texto, setTexto] = useState("");
  const [movimiento, setMovimiento] = useState<MovimientoInterpretado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function interpretar() {
    setError(null);
    setMovimiento(null);
    startTransition(async () => {
      const resultado = await interpretarConIa(texto);
      if (resultado.ok) setMovimiento(resultado.movimiento);
      else setError(resultado.error);
    });
  }

  return <section className="mb-5 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm" aria-labelledby="carga-ia-title">
    <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
      <div>
        <h2 id="carga-ia-title" className="text-xl font-bold text-slate-950">Contale a CierreAI qué pasó</h2>
        <p className="mt-1 text-sm text-slate-600">Por ejemplo: “Vendí $12.500 por Mercado Pago a las 18:30”.</p>
        <textarea value={texto} onChange={(event) => setTexto(event.target.value)} maxLength={500} rows={4} placeholder="Escribí una venta, un gasto o un pago recibido…" className="mt-4 block w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
        <button type="button" onClick={interpretar} disabled={pending || !texto.trim() || !configurada} className="mt-3 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Interpretando…" : "Interpretar con IA"}</button>
        {!configurada && <p role="status" className="mt-3 text-sm text-amber-700">Las funciones de IA no están configuradas. La carga manual y la conciliación siguen disponibles.</p>}
        {error && <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p>}
      </div>
      {movimiento ? <article className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Esto entendí</p>
        <h3 className="mt-2 text-lg font-bold text-slate-950">{movimiento.tipo === "venta" ? "Venta" : movimiento.tipo === "gasto" ? "Gasto" : "Pago recibido"}</h3>
        <dl className="mt-3 space-y-1 text-sm text-slate-700"><div><dt className="inline font-semibold">Monto: </dt><dd className="inline">{pesos(movimiento.monto_centavos)}</dd></div><div><dt className="inline font-semibold">Medio: </dt><dd className="inline">{medios[movimiento.medio_pago]}</dd></div><div><dt className="inline font-semibold">Hora: </dt><dd className="inline">{movimiento.hora}</dd></div>{movimiento.tipo === "gasto" && <><div><dt className="inline font-semibold">Categoría: </dt><dd className="inline">{movimiento.categoria}</dd></div>{movimiento.descripcion && <div><dt className="inline font-semibold">Descripción: </dt><dd className="inline">{movimiento.descripcion}</dd></div>}</>}</dl>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap"><form action={confirmarMovimientoIa}><input type="hidden" name="submission_id" value={crypto.randomUUID()} /><input type="hidden" name="movimiento" value={JSON.stringify(movimiento)} /><SubmitButton idle="Confirmar y guardar" pending="Guardando…" className="w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white sm:w-auto" /></form><button type="button" onClick={() => setMovimiento(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-700">Editar o cancelar</button></div>
      </article> : <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">La interpretación aparecerá acá antes de guardar.</div>}
    </div>
  </section>;
}

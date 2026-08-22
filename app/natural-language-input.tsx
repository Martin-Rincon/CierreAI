"use client";

import { useRef, useState, useTransition } from "react";
import type { MovimientoInterpretado } from "@/lib/ia";
import { confirmarMovimientoIaConResultado, interpretarConIa, type ResultadoCargaGasto } from "./actions";
import { CashInsufficientDialog } from "./expense-form";
import { horaLocalActual } from "@/lib/hora-local";

const medios = { efectivo: "Efectivo", transferencia: "Transferencia", mercado_pago: "Mercado Pago" } as const;

function pesos(centavos: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(centavos / 100);
}

export function NaturalLanguageInput({ configurada, cierreId }: { configurada: boolean; cierreId: number }) {
  const [texto, setTexto] = useState("");
  const [movimiento, setMovimiento] = useState<MovimientoInterpretado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [pending, startTransition] = useTransition();
  const [, startConfirmTransition] = useTransition();
  const [rechazo, setRechazo] = useState<ResultadoCargaGasto | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function interpretar() {
    if (pending || movimiento) return;
    setError(null);
    setMovimiento(null);
    startTransition(async () => {
      const resultado = await interpretarConIa(texto, horaLocalActual());
      if (resultado.ok) setMovimiento(resultado.movimiento);
      else setError(resultado.error);
    });
  }

  function editar() {
    setMovimiento(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function confirmar(formData: FormData) {
    setConfirmando(true);
    startConfirmTransition(async () => {
      const resultado = await confirmarMovimientoIaConResultado(formData);
      setRechazo(resultado);
      setConfirmando(false);
    });
  }

  return <section className="mb-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="carga-ia-title">
    <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
      <div>
        <h3 id="carga-ia-title" className="text-lg font-bold text-slate-950">Contale a CierreAI qué pasó</h3>
        <p className="mt-1 text-sm text-slate-600">Por ejemplo: “Vendí $12.500 por Mercado Pago a las 18:30”.</p>
        <label htmlFor="movimiento-ia" className="sr-only">Venta, gasto o pago recibido</label><textarea ref={textareaRef} id="movimiento-ia" value={texto} onChange={(event) => setTexto(event.target.value)} maxLength={500} rows={4} placeholder="Escribí una venta, un gasto o un pago recibido…" className="mt-4 block w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
        <button type="button" onClick={interpretar} disabled={pending || confirmando || movimiento !== null || !texto.trim() || !configurada} className="mt-3 w-full rounded-xl border border-blue-300 bg-white px-5 py-3 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">{pending ? "Interpretando…" : "Interpretar con IA"}</button>
        {!configurada && <p role="status" className="mt-3 text-sm text-amber-700">Las funciones de IA no están configuradas. La carga manual y la conciliación siguen disponibles.</p>}
        {error && <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p>}
      </div>
      {movimiento ? <article className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Esto entendí</p>
        <h3 className="mt-2 text-lg font-bold text-slate-950">{movimiento.tipo === "venta" ? "Venta" : movimiento.tipo === "gasto" ? "Gasto" : "Pago recibido"}</h3>
        <dl className="mt-3 space-y-1 text-sm text-slate-700"><div><dt className="inline font-semibold">Monto: </dt><dd className="inline">{pesos(movimiento.monto_centavos)}</dd></div><div><dt className="inline font-semibold">Medio: </dt><dd className="inline">{medios[movimiento.medio_pago]}</dd></div><div><dt className="inline font-semibold">Hora: </dt><dd className="inline">{movimiento.hora}</dd></div>{movimiento.tipo === "gasto" && <><div><dt className="inline font-semibold">Categoría: </dt><dd className="inline">{movimiento.categoria}</dd></div>{movimiento.descripcion && <div><dt className="inline font-semibold">Descripción: </dt><dd className="inline">{movimiento.descripcion}</dd></div>}</>}</dl>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap"><form action={confirmar}><input type="hidden" name="cierre_id" value={cierreId} /><input type="hidden" name="submission_id" value={crypto.randomUUID()} /><input type="hidden" name="movimiento" value={JSON.stringify(movimiento)} /><button type="submit" disabled={confirmando} className="w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60 sm:w-auto">{confirmando ? "Guardando…" : "Confirmar y guardar"}</button></form><button type="button" onClick={editar} disabled={confirmando} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-60">Editar</button></div>
      </article> : <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">La interpretación aparecerá acá antes de guardar.</div>}
    </div>
    {rechazo && <CashInsufficientDialog rechazo={rechazo} onClose={() => setRechazo(null)} />}
  </section>;
}

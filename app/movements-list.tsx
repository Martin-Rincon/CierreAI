"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MedioPago, MovimientoDia } from "@/lib/types";
import { eliminarMovimientoSeleccionado } from "./actions";

const medios: Record<MedioPago, string> = { efectivo: "Efectivo", transferencia: "Transferencia", mercado_pago: "Mercado Pago" };

function pesos(centavos: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(centavos / 100);
}

function etiquetaTipo(tipo: MovimientoDia["tipo"]): string {
  return tipo === "venta" ? "Venta" : tipo === "gasto" ? "Gasto" : "Pago recibido";
}

export function MovementsList({ cierreId, movimientos, editable }: { cierreId: number; movimientos: MovimientoDia[]; editable: boolean }) {
  const router = useRouter();
  const [seleccionado, setSeleccionado] = useState<MovimientoDia | null>(null);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const eliminando = useRef(false);

  function limpiarFeedbackAnterior() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("mensaje") && !url.searchParams.has("actualizado")) return;
    url.searchParams.delete("mensaje");
    url.searchParams.delete("actualizado");
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
  }

  function abrir(movimiento: MovimientoDia) {
    limpiarFeedbackAnterior();
    setMensaje(""); setError(""); setSeleccionado(movimiento);
  }

  function eliminar() {
    if (!seleccionado || eliminando.current) return;
    eliminando.current = true;
    setError("");
    const data = new FormData();
    data.set("cierre_id", String(cierreId));
    data.set("tipo", seleccionado.tipo);
    data.set("movimiento_id", String(seleccionado.id));
    startTransition(async () => {
      try {
        await eliminarMovimientoSeleccionado(data);
        setSeleccionado(null);
        setMensaje("Movimiento eliminado correctamente.");
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "No pudimos eliminar el movimiento. Probá nuevamente.");
      } finally { eliminando.current = false; }
    });
  }

  return <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="movimientos-title">
    <div className="border-b border-slate-100 p-5 sm:flex sm:items-start sm:justify-between sm:gap-4"><div><h2 id="movimientos-title" className="text-xl font-bold text-slate-950">Movimientos del día</h2><p className="mt-1 text-sm text-slate-600">{movimientos.length} movimientos, ordenados del más reciente al más antiguo.</p></div>{mensaje && <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 sm:mt-0">{mensaje}</p>}</div>
    {movimientos.length === 0 ? <p className="p-5 text-sm text-slate-500">Todavía no hay movimientos cargados.</p> : <ul className="divide-y divide-slate-100">{movimientos.map((movimiento) => {
      const signo = movimiento.tipo === "gasto" ? "−" : "+";
      return <li key={`${movimiento.tipo}-${movimiento.id}`} className="flex items-center gap-3 px-4 py-3.5 sm:px-5"><time className="w-12 shrink-0 text-sm tabular-nums text-slate-500">{movimiento.hora}</time><div className="min-w-0 flex-1"><p className="font-semibold text-slate-900">{etiquetaTipo(movimiento.tipo)}</p>{movimiento.tipo === "gasto" ? <div className="text-xs text-slate-500"><p className="truncate"><span className="font-semibold text-slate-600">Categoría:</span> {movimiento.categoria}</p>{movimiento.descripcion && <p className="truncate"><span className="font-semibold text-slate-600">Descripción:</span> {movimiento.descripcion}</p>}<p>{medios[movimiento.medioPago]}</p></div> : <p className="truncate text-xs text-slate-500">{movimiento.detalle} · {medios[movimiento.medioPago]}</p>}</div><p className={`shrink-0 text-sm font-bold tabular-nums sm:text-base ${movimiento.tipo === "gasto" ? "text-red-600" : "text-slate-900"}`}>{signo}{pesos(movimiento.monto)}</p>{editable && <button type="button" onClick={() => abrir(movimiento)} aria-label={`Eliminar ${etiquetaTipo(movimiento.tipo).toLowerCase()} de ${pesos(movimiento.monto)}`} className="shrink-0 rounded-lg px-2 py-2 text-xs font-semibold text-slate-400 hover:bg-red-50 hover:text-red-700">Eliminar</button>}</li>;
    })}</ul>}
    {seleccionado && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="eliminar-movimiento-title" aria-busy={pending}><div className="my-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 id="eliminar-movimiento-title" className="text-xl font-bold text-slate-950">¿Eliminar este movimiento?</h2><p className="mt-2 text-sm leading-6 text-slate-600">Esta acción quitará el movimiento del cierre y recalculará los totales.</p><dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl bg-slate-50 p-4 text-sm"><dt className="font-semibold text-slate-500">Tipo</dt><dd className="font-bold text-slate-900">{etiquetaTipo(seleccionado.tipo)}</dd><dt className="font-semibold text-slate-500">Monto</dt><dd className="font-bold tabular-nums text-slate-900">{pesos(seleccionado.monto)}</dd><dt className="font-semibold text-slate-500">Medio</dt><dd className="text-slate-800">{medios[seleccionado.medioPago]}</dd><dt className="font-semibold text-slate-500">Hora</dt><dd className="text-slate-800">{seleccionado.hora}</dd>{seleccionado.tipo === "gasto" && seleccionado.detalle && <><dt className="font-semibold text-slate-500">Detalle</dt><dd className="min-w-0 break-words text-slate-800">{seleccionado.detalle}</dd></>}</dl>{error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" disabled={pending} onClick={() => setSeleccionado(null)} className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 disabled:opacity-60">Cancelar</button><button type="button" disabled={pending} onClick={eliminar} className="rounded-lg bg-red-700 px-4 py-3 text-sm font-bold text-white hover:bg-red-800 disabled:cursor-wait disabled:opacity-60">{pending ? "Eliminando…" : "Eliminar movimiento"}</button></div></div></div>}
  </section>;
}

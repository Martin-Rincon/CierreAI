"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cargarEscenarioDemo, empezarConMisDatos, restablecerEscenarioDemo, vaciarCierreSeleccionado } from "./actions";

type Confirmacion = "empezar" | "vaciar" | null;

export function DemoControls({ cierreId, fecha, tieneMovimientos, esDemo }: { cierreId: number; fecha: string; tieneMovimientos: boolean; esDemo: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState<Confirmacion>(null);
  const [empezandoConMisDatos, setEmpezandoConMisDatos] = useState(false);
  const vaciadoEnCurso = useRef(false);
  const operacionPendiente = pending || empezandoConMisDatos;

  function limpiarFeedbackAnterior() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("mensaje") && !url.searchParams.has("actualizado")) return;
    url.searchParams.delete("mensaje");
    url.searchParams.delete("actualizado");
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
  }

  function ejecutar(tarea: () => Promise<void>) {
    limpiarFeedbackAnterior();
    setError(null);
    startTransition(async () => {
      try { await tarea(); router.refresh(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos actualizar el cierre. Probá de nuevo."); }
    });
  }

  function cargar() {
    if (tieneMovimientos && !esDemo) {
      limpiarFeedbackAnterior();
      setError("Este cierre ya contiene datos. Para cargar el escenario demo primero tenés que vaciarlo.");
      return;
    }
    ejecutar(() => cargarEscenarioDemo(cierreId));
  }

  async function confirmarEmpezarConMisDatos() {
    if (vaciadoEnCurso.current || empezandoConMisDatos) return;
    vaciadoEnCurso.current = true;
    limpiarFeedbackAnterior();
    setEmpezandoConMisDatos(true);
    setError(null);
    try {
      const fechaResultado = await empezarConMisDatos(cierreId);
      const mensaje = "Cierre vacío. Ya podés cargar tus propios movimientos.";
      setConfirmacion(null);
      setEmpezandoConMisDatos(false);
      vaciadoEnCurso.current = false;
      router.replace(`/?fecha=${fechaResultado || fecha}&mensaje=${encodeURIComponent(mensaje)}&actualizado=${Date.now()}#carga`);
    } catch (cause) {
      vaciadoEnCurso.current = false;
      setEmpezandoConMisDatos(false);
      setError(cause instanceof Error ? cause.message : "No pudimos vaciar el cierre. Probá de nuevo.");
      setConfirmacion(null);
    }
  }

  function confirmar() {
    if (!confirmacion) return;
    if (confirmacion === "empezar") {
      void confirmarEmpezarConMisDatos();
      return;
    }
    if (vaciadoEnCurso.current || pending) return;
    vaciadoEnCurso.current = true;
    limpiarFeedbackAnterior();
    setError(null);
    startTransition(async () => {
      try {
        const fechaResultado = await vaciarCierreSeleccionado(cierreId);
        const mensaje = "Se vaciaron los datos del cierre.";
        const actualizado = Date.now();
        setConfirmacion(null);
        router.replace(`/?fecha=${fechaResultado || fecha}&mensaje=${encodeURIComponent(mensaje)}&actualizado=${actualizado}#carga`);
      } catch (cause) {
        vaciadoEnCurso.current = false;
        setError(cause instanceof Error ? cause.message : "No pudimos vaciar el cierre. Probá de nuevo.");
        setConfirmacion(null);
      }
    });
  }

  return <>
    <section className={`mb-3 rounded-xl border px-4 py-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 ${esDemo ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white/60"}`}>
      <div>{esDemo ? <><p className="text-xs font-bold uppercase tracking-wider text-amber-700">Escenario demo</p><h2 className="mt-1 text-sm font-bold text-amber-950">Estás usando datos de ejemplo</h2><p className="mt-1 text-xs leading-5 text-amber-800">No son datos reales. Podés restablecerlos o empezar con los tuyos.</p></> : <><h2 className="text-sm font-bold text-slate-800">Probar con datos de ejemplo</h2><p className="mt-1 text-xs leading-5 text-slate-500">Carga un escenario breve para recorrer la aplicación.</p></>}</div>
      <div className="mt-3 flex flex-col gap-2 sm:mt-0 sm:flex-row">
        {esDemo ? <><button type="button" disabled={pending} onClick={() => ejecutar(() => restablecerEscenarioDemo(cierreId))} className="rounded-lg border border-amber-400 bg-white px-3 py-2.5 text-sm font-bold text-amber-800 disabled:opacity-60">{pending ? "Procesando…" : "Restablecer escenario"}</button><button type="button" disabled={pending} onClick={() => setConfirmacion("empezar")} className="rounded-lg bg-amber-900 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-60">Empezar con mis datos</button></> : <button type="button" disabled={pending} onClick={cargar} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60">{pending ? "Cargando escenario…" : "Cargar datos de ejemplo"}</button>}
      </div>
      {error && <p role="alert" className="mt-3 w-full text-sm text-red-700">{error}</p>}
    </section>
    <div className="mb-5 text-right"><button type="button" disabled={pending} onClick={() => setConfirmacion("vaciar")} className="text-sm font-semibold text-red-700 underline decoration-red-300 underline-offset-4 disabled:opacity-60">Vaciar cierre</button></div>
    {confirmacion && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="vaciar-title" aria-busy={operacionPendiente}><div className="my-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 id="vaciar-title" className="text-xl font-bold text-slate-950">{confirmacion === "empezar" ? "Empezar con mis datos" : "Vaciar cierre"}</h2><p className="mt-3 text-sm leading-6 text-slate-700">{confirmacion === "empezar" ? "Se eliminarán los movimientos y análisis de ejemplo de este cierre para que puedas empezar desde cero. Esta acción no afecta otros cierres." : "Se eliminarán todas las ventas, gastos, pagos, análisis y el efectivo contado de este cierre. Esta acción no se puede deshacer y no afectará otros días."}</p>{operacionPendiente && <p role="status" className="mt-4 flex items-center gap-2 text-sm font-bold text-blue-700"><span className="size-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />Vaciando el cierre…</p>}<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" disabled={operacionPendiente} onClick={() => setConfirmacion(null)} className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60">Cancelar</button><button type="button" disabled={operacionPendiente} onClick={confirmar} className="rounded-lg bg-red-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60">{operacionPendiente ? "Vaciando…" : confirmacion === "empezar" ? "Vaciar y empezar" : "Vaciar cierre"}</button></div></div></div>}
  </>;
}

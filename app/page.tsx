import { randomUUID } from "node:crypto";
import Image from "next/image";
import { cierreFueAnalizado, fechaLocal, obtenerCausasCandidatas, obtenerCierresParaHistorico, obtenerCierresPendientes, obtenerMovimientosDelDia, obtenerResumenCierreActual, obtenerResumenCierrePorFecha } from "@/lib/data";
import type { CausaCandidataVista, CierreListado, MedioPago } from "@/lib/types";
import { cargarGasto, cargarPago, cargarVenta, confirmarCausa, descartarCausa, guardarEfectivoContado } from "./actions";
import { AnalysisButton } from "./analysis-button";
import { SubmitButton } from "./submit-button";
import { NaturalLanguageInput } from "./natural-language-input";
import { DemoControls } from "./demo-controls";
import { LifecycleControls } from "./lifecycle-controls";
import { explicacionDeterministica, iaConfigurada } from "@/lib/ia";
import { CsvImport } from "./csv-import";
import { MovementsList } from "./movements-list";

export const dynamic = "force-dynamic";

const etiquetasMedio: Record<MedioPago, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencias",
  mercado_pago: "Mercado Pago",
};

const iconosMedio: Record<MedioPago, React.ReactNode> = {
  efectivo: <CashIcon />,
  transferencia: <TransferIcon />,
  mercado_pago: <WalletIcon />,
};

function pesos(centavos: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(centavos / 100);
}

function pesosConSigno(centavos: number): string {
  return `${centavos >= 0 ? "+" : "−"}${pesos(Math.abs(centavos))}`;
}

function fechaLarga(fecha: string): string {
  const [year, month, day] = fecha.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(year, month - 1, day));
}

function fechaCorta(fecha: string): string {
  const [year, month, day] = fecha.split("-");
  return `${day}/${month}/${year}`;
}

function etiquetaEstado(cierre: CierreListado): string {
  if (cierre.finalizadoAt) return "Finalizado";
  if (cierre.estado === "conciliado") return "Conciliado";
  if (cierre.estado === "resuelto") return "Resuelto";
  if (cierre.estado === "con_diferencia") return "En curso · Con diferencia";
  return "En curso";
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ mensaje?: string; fecha?: string }> }) {
  const parametros = await searchParams;
  const hoy = fechaLocal();
  const fechaSeleccionada = /^\d{4}-\d{2}-\d{2}$/.test(parametros.fecha ?? "") ? parametros.fecha! : hoy;
  const [cierresHistoricos, pendientes] = await Promise.all([obtenerCierresParaHistorico(), obtenerCierresPendientes(hoy)]);
  const resumen = fechaSeleccionada === hoy ? await obtenerResumenCierreActual() : await obtenerResumenCierrePorFecha(fechaSeleccionada);
  if (!resumen) return <DashboardVacio fecha={fechaSeleccionada} cierres={cierresHistoricos} pendientes={pendientes} />;
  const { cierre } = resumen;
  const [movimientos, causas, analizado] = await Promise.all([
    obtenerMovimientosDelDia(cierre.id),
    obtenerCausasCandidatas(cierre.id, cierre.diferencia),
    cierreFueAnalizado(cierre.id),
  ]);
  const { mensaje } = parametros;
  const concilia = cierre.diferencia === 0;
  const resuelto = cierre.estado === "resuelto";
  const finalizado = cierre.finalizadoAt !== null;
  const editable = !finalizado;
  const horaActual = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 pb-12 pt-5 sm:px-6 lg:px-8">
      <header className="mb-7 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BrandIcon />
          <div>
            <p className="text-xl font-bold tracking-tight text-slate-950">CierreAI</p>
            <p className="text-xs font-medium text-slate-500">Control de caja</p>
          </div>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">
          {finalizado ? "Finalizado" : cierre.estado === "conciliado" ? "Conciliado" : cierre.estado === "resuelto" ? "Resuelto" : "En curso"}
        </span>
      </header>

      {pendientes.length > 0 && <AvisoPendiente pendientes={pendientes} />}
      <SelectorFecha fecha={fechaSeleccionada} cierres={cierresHistoricos} />

      <section className="mb-6">
        <p className="mb-1 text-sm font-semibold capitalize text-blue-700">
          {fechaLarga(cierre.fecha)}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
          Cierre del día
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">
          Compará lo que debería haber con lo que efectivamente registraste.
        </p>
      </section>

      {finalizado && <section className="mb-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-950">
        <h2 className="font-bold">Cierre finalizado</h2>
        <p className="mt-1 text-sm">Finalizado el {new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(`${cierre.finalizadoAt!.replace(" ", "T")}Z`))}. Se conserva toda la información en modo consulta.</p>
      </section>}

      <section
        aria-label="Resumen general del cierre"
        className="mb-5 grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid-cols-3"
      >
        <Total label="Total esperado" value={pesos(cierre.totalEsperado)} />
        <Total label="Total registrado" value={pesos(cierre.totalRegistrado)} />
        <Total
          label="Diferencia"
          value={pesos(cierre.diferencia)}
          tone={concilia || resuelto ? "success" : "danger"}
          prominent
        />
      </section>

      <section className="mb-5 grid gap-3 md:grid-cols-3" aria-label="Desglose por medio de pago">
        {resumen.desglose.map((item) => (
          <article
            key={item.medio}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
                {iconosMedio[item.medio]}
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  item.diferencia === 0
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-red-50 text-red-700"
                }`}
              >
                {item.diferencia === 0 ? "Concilia" : pesos(item.diferencia)}
              </span>
            </div>
            <h2 className="mb-4 font-bold text-slate-900">{etiquetasMedio[item.medio]}</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4 text-slate-500">
                <dt>Esperado</dt>
                <dd className="font-semibold tabular-nums text-slate-800">{pesos(item.esperado)}</dd>
              </div>
              <div className="flex justify-between gap-4 text-slate-500">
                <dt>Registrado</dt>
                <dd className="font-semibold tabular-nums text-slate-800">{pesos(item.registrado)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </section>

      <section className="mb-6" aria-label="Estado del cierre">
        {!resumen.tieneMovimientos ? (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-center">
            <h2 className="font-bold text-blue-950">Todavía no cargaste movimientos</h2>
            <p className="mt-1 text-sm text-blue-800">Elegí una forma de carga para empezar el cierre.</p>
          </div>
        ) : concilia ? (
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5 sm:flex sm:items-center sm:justify-between sm:gap-5">
            <div className="flex items-center gap-4"><div className="grid size-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><CheckIcon /></div><div><h2 className="text-lg font-bold text-emerald-950">Todo concilia</h2><p className="mt-0.5 text-sm text-emerald-800">No hay diferencias para revisar.</p></div></div>
            <LifecycleControls cierreId={cierre.id} diferencia={cierre.diferencia} resuelto={resuelto} finalizado={finalizado} />
          </div>
        ) : resuelto ? (
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5 shadow-sm sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div className="flex min-w-0 gap-4"><div className="grid size-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><CheckIcon /></div><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Diferencia explicada</p><p className="mt-1 text-2xl font-bold tabular-nums text-emerald-950">{pesos(cierre.diferencia)}</p><p className="mt-1 text-sm leading-5 text-emerald-800">La diferencia contable original sigue registrada y las causas confirmadas la explican completamente.</p></div></div>
            <LifecycleControls cierreId={cierre.id} diferencia={cierre.diferencia} resuelto={resuelto} finalizado={finalizado} />
          </div>
        ) : (
          <div className="rounded-2xl border border-red-300 bg-white p-5 shadow-md shadow-red-100/60 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div className="flex gap-4"><div className="grid size-11 shrink-0 place-items-center rounded-full bg-red-50 text-red-600"><AlertIcon /></div><div><p className="text-xs font-bold uppercase tracking-wider text-red-600">Diferencia</p><p className="mt-1 text-2xl font-bold tabular-nums text-red-700">{pesos(cierre.diferencia)}</p><p className="mt-1 text-sm leading-5 text-slate-600">Revisá qué movimientos pueden explicar este resultado.</p></div></div>
            {editable && <AnalysisButton cierreId={cierre.id} />}
          </div>
        )}

        {analizado && (causas.length > 0 ? <ResultadoAnalisis causas={causas} diferencia={cierre.diferencia} resuelto={resuelto} editable={editable} /> : <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-950">Análisis completado</h2><p className="mt-1 text-sm text-slate-600">No encontramos posibles causas con los criterios de búsqueda disponibles.</p></section>)}
        {!concilia && !resuelto && <div className="mt-4"><LifecycleControls cierreId={cierre.id} diferencia={cierre.diferencia} resuelto={resuelto} finalizado={finalizado} /></div>}
        {finalizado && !resumen.tieneMovimientos && <div className="mt-4"><LifecycleControls cierreId={cierre.id} diferencia={cierre.diferencia} resuelto={resuelto} finalizado={finalizado} /></div>}
      </section>

      {editable && <DemoControls cierreId={cierre.id} fecha={cierre.fecha} tieneMovimientos={resumen.tieneMovimientos} esDemo={cierre.esDemo} />}
      {!editable && cierre.esDemo && <p className="mb-5 inline-flex rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-amber-800">Escenario demo · Datos de ejemplo</p>}

      {editable && <div id="carga" className="mb-6 rounded-3xl border border-slate-200 bg-slate-100/60 p-3 sm:p-4">
        <div className="mb-4 px-2"><p className="text-xs font-bold uppercase tracking-wider text-blue-700">Alternativas de carga</p><h2 className="mt-1 text-xl font-bold text-slate-950">Carga rápida</h2><p className="mt-1 text-sm text-slate-600">Contá una operación con IA o importá varias desde un CSV.</p></div>
        {!cierre.esDemo && <NaturalLanguageInput configurada={iaConfigurada()} cierreId={cierre.id} />}

        <CsvImport cierreId={cierre.id} esDemo={cierre.esDemo} />
      </div>}

      {editable && !cierre.esDemo ? <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 sm:flex sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-950">Carga manual</h2>
            <p className="mt-1 text-sm text-slate-600">Registrá las operaciones a medida que ocurren.</p>
          </div>
          {mensaje && <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 sm:mt-0">{mensaje}</p>}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <FormularioMovimiento cierreId={cierre.id} titulo="Nueva venta" action={cargarVenta} horaActual={horaActual} />
          <FormularioMovimiento cierreId={cierre.id} titulo="Nuevo gasto" action={cargarGasto} horaActual={horaActual} gasto />
          <FormularioMovimiento cierreId={cierre.id} titulo="Pago recibido" action={cargarPago} horaActual={horaActual} />
        </div>
        <div className="mt-5 border-t border-slate-200 pt-5">
          <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
            <div><h3 className="font-bold text-slate-950">Efectivo contado</h3><p className="mt-1 text-sm text-slate-600">Ingresá el total contado en caja. Podés actualizarlo si volvés a contar.</p></div>
            <form action={guardarEfectivoContado} className="flex flex-col gap-2 sm:flex-row"><input type="hidden" name="cierre_id" value={cierre.id} /><CampoMonto defaultValue={cierre.efectivoContado == null ? "" : String(cierre.efectivoContado / 100)} label="Monto contado" /><SubmitButton idle="Guardar efectivo" pending="Guardando…" className="w-full self-end rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-700 sm:w-auto" /></form>
          </div>
        </div>
      </section> : null}

      <MovementsList cierreId={cierre.id} movimientos={movimientos} editable={editable} />

      <section className="mt-5 grid grid-cols-3 gap-2" aria-label="Actividad del día">
        <Count label="Ventas" value={resumen.cantidadVentas} />
        <Count label="Gastos" value={resumen.cantidadGastos} />
        <Count label="Pagos" value={resumen.cantidadMovimientosPago} />
      </section>
    </main>
  );
}

function SelectorFecha({ fecha, cierres }: { fecha: string; cierres: CierreListado[] }) {
  return <form method="get" className="mb-6 flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <label className="block flex-1 text-xs font-bold text-slate-600">Fecha del cierre<input type="date" name="fecha" defaultValue={fecha} list="fechas-existentes" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" /></label>
    <datalist id="fechas-existentes">{cierres.map((item) => <option key={item.fecha} value={item.fecha}>{etiquetaEstado(item)}</option>)}</datalist>
    <button type="submit" className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-700 sm:w-auto">Ver cierre</button>
    {cierres.length > 0 && <p className="w-full text-xs text-slate-500">{cierres.map((item) => `${fechaCorta(item.fecha)} · ${etiquetaEstado(item)}`).join("  |  ")}</p>}
  </form>;
}

function AvisoPendiente({ pendientes }: { pendientes: CierreListado[] }) {
  const reciente = pendientes[0];
  return <section className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-5 sm:flex sm:items-center sm:justify-between sm:gap-4"><div><h2 className="font-bold text-amber-950">Tenés un cierre sin finalizar del {fechaCorta(reciente.fecha)}</h2><p className="mt-1 text-sm text-amber-800">{reciente.estado === "conciliado" ? "Los movimientos están conciliados, pero el cierre todavía está abierto." : "El cierre todavía está abierto y tiene una diferencia para revisar."}</p>{pendientes.length > 1 && <p className="mt-1 text-xs text-amber-700">Hay {pendientes.length} cierres anteriores sin finalizar. Podés encontrarlos en el selector histórico.</p>}</div><a href={`/?fecha=${reciente.fecha}`} className="mt-3 inline-block rounded-lg bg-amber-900 px-4 py-2.5 text-sm font-bold text-white sm:mt-0">Continuar cierre</a></section>;
}

function DashboardVacio({ fecha, cierres, pendientes }: { fecha: string; cierres: CierreListado[]; pendientes: CierreListado[] }) {
  return <main className="mx-auto min-h-screen w-full max-w-6xl px-4 pb-12 pt-5 sm:px-6 lg:px-8">
    <header className="mb-7 flex items-center gap-3"><BrandIcon /><div><p className="text-xl font-bold text-slate-950">CierreAI</p><p className="text-xs text-slate-500">Control de caja</p></div></header>
    {pendientes.length > 0 && <AvisoPendiente pendientes={pendientes} />}
    <SelectorFecha fecha={fecha} cierres={cierres} />
    <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold text-slate-950">No existe un cierre para esta fecha</h1><p className="mt-2 text-sm text-slate-600">No se creó ningún registro al navegar a {fecha}. Elegí otra fecha para consultar un cierre existente.</p></section>
  </main>;
}

function ResultadoAnalisis({ causas, diferencia, resuelto, editable }: { causas: CausaCandidataVista[]; diferencia: number; resuelto: boolean; editable: boolean }) {
  const principal = causas.find((causa) => causa.esPrincipal);
  const ordenadas = principal ? [principal, ...causas.filter((causa) => causa.id !== principal.id)] : causas;
  return <section className="mt-5 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm" aria-labelledby="resultado-title">
    <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Revisión de la diferencia</p>
    <h2 id="resultado-title" className="mt-1 text-xl font-bold text-slate-950">{causas.length === 1 ? "Posible causa encontrada" : "Posibles causas encontradas"}</h2>
    <p className={`mt-2 text-sm ${resuelto ? "text-emerald-800" : "text-amber-800"}`}>{resuelto ? "Las causas confirmadas explican completamente la diferencia del cierre." : principal ? "Una causa posible explica por sí sola toda la diferencia. Revisá la evidencia antes de confirmarla." : "Ninguna causa explica por sí sola toda la diferencia. Revisá todas las posibilidades antes de confirmar."}</p>
    <div className="mt-4 space-y-3">{ordenadas.map((causa) => <CausaCard key={causa.id} causa={causa} diferencia={diferencia} editable={editable} />)}</div>
  </section>;
}

function CausaCard({ causa, diferencia, editable }: { causa: CausaCandidataVista; diferencia: number; editable: boolean }) {
  const entidad = causa.tipo === "venta_sin_pago" ? `Venta #${causa.referenciaId}` : causa.tipo === "pago_sin_venta" ? `Movimiento de pago #${causa.referenciaId}` : "Efectivo del cierre";
  const explicacion = causa.explicacionIa ?? explicacionDeterministica(causa);
  return <article className={`min-w-0 rounded-xl border p-4 ${causa.esPrincipal ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}>
    {causa.esPrincipal && <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-800">Explica exactamente la diferencia</p>}
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-950">{entidad}</h3><p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{pesos(causa.monto)}</p>{causa.medioPago && <p className="text-sm text-slate-600">{etiquetasMedio[causa.medioPago]} · {causa.hora}</p>}</div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{causa.estado === "pendiente" ? "Por revisar" : causa.estado === "confirmada" ? "Confirmada" : "Descartada"}</span></div>
    <p className="mt-3 text-sm text-slate-700">{explicacion} <strong>Efecto sobre el cierre: {pesosConSigno(causa.efecto)}.</strong></p>
    <details className="mt-3 rounded-lg border border-slate-200 bg-white text-sm"><summary className="cursor-pointer px-3 py-3 font-bold text-blue-700">Ver evidencia</summary><dl className="grid gap-2 border-t border-slate-100 px-3 pb-3 pt-3 text-slate-600 sm:grid-cols-2">
      <div><dt className="font-bold text-slate-800">Movimiento revisado</dt><dd>{entidad}</dd></div><div><dt className="font-bold text-slate-800">Monto</dt><dd>{pesos(causa.monto)}</dd></div>
      <div><dt className="font-bold text-slate-800">Medio y hora</dt><dd>{causa.medioPago ? `${etiquetasMedio[causa.medioPago]} · ${causa.hora}` : "Cálculo global de efectivo"}</dd></div><div><dt className="font-bold text-slate-800">Diferencia general</dt><dd>{pesos(diferencia)}</dd></div>
      <div className="sm:col-span-2"><dt className="font-bold text-slate-800">Criterio de búsqueda</dt><dd>{causa.tipo === "diferencia_efectivo" ? "Efectivo inicial + ventas en efectivo − gastos en efectivo, comparado con efectivo contado." : "Mismo cierre, medio y monto exacto; luego se priorizan la hora más cercana, la más temprana y el registro más antiguo."}</dd></div>
      <div className="sm:col-span-2"><dt className="font-bold text-slate-800">Resultado de la búsqueda</dt><dd>{causa.tipo === "diferencia_efectivo" ? "El efectivo esperado y el contado no coinciden." : causa.tipo === "venta_sin_pago" ? "No se encontró un pago compatible para esta venta." : "No se encontró una venta compatible para este pago recibido."}</dd></div>
      {causa.tipo === "diferencia_efectivo" && <><div><dt className="font-bold text-slate-800">Efectivo esperado</dt><dd>{causa.efectivoEsperado == null ? "Sin dato" : pesos(causa.efectivoEsperado)}</dd></div><div><dt className="font-bold text-slate-800">Efectivo contado</dt><dd>{causa.efectivoContado == null ? "Sin dato" : pesos(causa.efectivoContado)}</dd></div><div className="sm:col-span-2"><dt className="font-bold text-slate-800">Diferencia de efectivo</dt><dd>{pesosConSigno(causa.efecto)}</dd></div></>}
    </dl></details>
    {editable && causa.estado === "pendiente" && <div className="mt-3 flex flex-col gap-2 sm:flex-row"><form action={confirmarCausa}><input type="hidden" name="causa_id" value={causa.id} /><SubmitButton idle="Confirmar causa" pending="Confirmando…" className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 sm:w-auto" /></form><form action={descartarCausa}><input type="hidden" name="causa_id" value={causa.id} /><SubmitButton idle="Descartar" pending="Descartando…" className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 sm:w-auto" /></form></div>}
  </article>;
}

function FormularioMovimiento({ cierreId, titulo, action, horaActual, gasto = false }: { cierreId: number; titulo: string; action: (formData: FormData) => Promise<never>; horaActual: string; gasto?: boolean }) {
  return (
    <form action={action} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="submission_id" value={randomUUID()} />
      <input type="hidden" name="cierre_id" value={cierreId} />
      <h3 className="mb-3 font-bold text-slate-900">{titulo}</h3>
      <div className="space-y-3">
        <CampoMonto label="Monto" />
        {gasto && <><Campo label="Categoría" name="categoria" required /><Campo label="Descripción (opcional)" name="descripcion" /></>}
        <label className="block text-xs font-bold text-slate-600">Medio de pago<select name="medio_pago" required className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="mercado_pago">Mercado Pago</option></select></label>
        <label className="block text-xs font-bold text-slate-600">Hora<input type="time" name="hora" required defaultValue={horaActual} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" /></label>
        <SubmitButton idle="Cargar" pending="Cargando…" className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-700" />
      </div>
    </form>
  );
}

function CampoMonto({ label, defaultValue }: { label: string; defaultValue?: string }) {
  return <label className="block text-xs font-bold text-slate-600">{label}<span className="relative mt-1 block"><span className="absolute left-3 top-2.5 text-sm text-slate-500">$</span><input name="monto" inputMode="decimal" required pattern="[0-9]+([,.][0-9]{1,2})?" defaultValue={defaultValue} placeholder="0,00" className="block w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-7 pr-3 text-sm" /></span></label>;
}

function Campo({ label, name, required = false }: { label: string; name: string; required?: boolean }) {
  return <label className="block text-xs font-bold text-slate-600">{label}<input name={name} required={required} maxLength={100} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" /></label>;
}

function Total({ label, value, tone = "default", prominent = false }: { label: string; value: string; tone?: "default" | "success" | "danger"; prominent?: boolean }) {
  const toneClass = tone === "danger" ? "text-red-600" : tone === "success" ? "text-emerald-600" : "text-slate-950";
  return (
    <div className={`border-b border-slate-100 p-5 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${prominent ? tone === "danger" ? "bg-red-50/70" : "bg-emerald-50/70" : ""}`}>
      <dt className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className={`text-2xl font-bold tabular-nums tracking-tight ${toneClass}`}>{value}</dd>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/70 px-3 py-3 text-center">
      <p className="text-lg font-bold tabular-nums text-slate-900">{value}</p>
      <p className="text-xs font-medium text-slate-500">{label}</p>
    </div>
  );
}

function BrandIcon() { return <Image src="/icon.svg" alt="" width={40} height={40} priority className="size-10 rounded-xl shadow-lg shadow-blue-600/20" />; }
function CashIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="1.8"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9h.01M18 15h.01" strokeLinecap="round"/></svg>; }
function TransferIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="1.8"><path d="M5 8h14M15 4l4 4-4 4M19 16H5M9 20l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function WalletIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="1.8"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v11H6.5A2.5 2.5 0 0 1 4 15.5v-8Z"/><path d="M15 10h6v5h-6a2.5 2.5 0 0 1 0-5Z"/><circle cx="16" cy="12.5" r=".5" fill="currentColor"/></svg>; }
function CheckIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2.4"><path d="m6 12 4 4 8-9" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function AlertIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2"><path d="M12 8v5M12 17h.01" strokeLinecap="round"/><circle cx="12" cy="12" r="9"/></svg>; }

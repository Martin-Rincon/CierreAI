import { randomUUID } from "node:crypto";
import { obtenerMovimientosDelDia, obtenerResumenCierreActual } from "@/lib/data";
import type { MedioPago, MovimientoDia } from "@/lib/types";
import { cargarGasto, cargarPago, cargarVenta, guardarEfectivoContado } from "./actions";
import { SubmitButton } from "./submit-button";

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

function fechaLarga(fecha: string): string {
  const [year, month, day] = fecha.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(year, month - 1, day));
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ mensaje?: string }> }) {
  const resumen = obtenerResumenCierreActual();
  const { cierre } = resumen;
  const movimientos = obtenerMovimientosDelDia(cierre.id);
  const { mensaje } = await searchParams;
  const concilia = cierre.diferencia === 0;
  const horaActual = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 pb-12 pt-5 sm:px-6 lg:px-8">
      <header className="mb-7 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
            <MarkIcon />
          </div>
          <div>
            <p className="text-xl font-bold tracking-tight text-slate-950">CierreAI</p>
            <p className="text-xs font-medium text-slate-500">Control de caja</p>
          </div>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">
          Hoy
        </span>
      </header>

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

      <section
        aria-label="Resumen general del cierre"
        className="mb-5 grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid-cols-3"
      >
        <Total label="Total esperado" value={pesos(cierre.totalEsperado)} />
        <Total label="Total registrado" value={pesos(cierre.totalRegistrado)} />
        <Total
          label="Diferencia"
          value={pesos(cierre.diferencia)}
          tone={concilia ? "success" : "danger"}
        />
      </section>

      <section className="mb-5 grid gap-3 md:grid-cols-3" aria-label="Desglose por medio de pago">
        {resumen.desglose.map((item) => (
          <article
            key={item.medio}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="mb-5 flex items-center justify-between">
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

      <section id="carga" className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 sm:flex sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-950">Carga manual</h2>
            <p className="mt-1 text-sm text-slate-600">Registrá las operaciones a medida que ocurren.</p>
          </div>
          {mensaje && <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 sm:mt-0">{mensaje}</p>}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <FormularioMovimiento titulo="Nueva venta" action={cargarVenta} horaActual={horaActual} />
          <FormularioMovimiento titulo="Nuevo gasto" action={cargarGasto} horaActual={horaActual} gasto />
          <FormularioMovimiento titulo="Pago recibido" action={cargarPago} horaActual={horaActual} />
        </div>
      </section>

      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <h2 className="font-bold text-slate-950">Efectivo contado</h2>
            <p className="mt-1 text-sm text-slate-600">Podés cargarlo ahora y editarlo cada vez que vuelvas a contar la caja.</p>
          </div>
          <form action={guardarEfectivoContado} className="flex gap-2">
            <CampoMonto defaultValue={cierre.efectivoContado == null ? "" : String(cierre.efectivoContado / 100)} label="Monto contado" />
            <SubmitButton idle="Guardar" pending="Guardando…" className="self-end rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700" />
          </form>
        </div>
      </section>

      <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="movimientos-title">
        <div className="border-b border-slate-100 p-5">
          <h2 id="movimientos-title" className="text-xl font-bold text-slate-950">Movimientos del día</h2>
          <p className="mt-1 text-sm text-slate-600">{movimientos.length} movimientos, ordenados del más reciente al más antiguo.</p>
        </div>
        {movimientos.length === 0 ? <p className="p-5 text-sm text-slate-500">Todavía no hay movimientos cargados.</p> : (
          <ul className="divide-y divide-slate-100">
            {movimientos.map((movimiento) => <Movimiento key={`${movimiento.tipo}-${movimiento.id}`} movimiento={movimiento} />)}
          </ul>
        )}
      </section>

      {!resumen.tieneMovimientos ? (
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-center">
          <h2 className="font-bold text-blue-950">Todavía no cargaste movimientos</h2>
          <p className="mt-1 text-sm text-blue-800">Empezá registrando las operaciones del día.</p>
          <button className="mt-4 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">
            Cargar movimientos
          </button>
        </section>
      ) : concilia ? (
        <section className="flex items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="grid size-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
            <CheckIcon />
          </div>
          <div>
            <h2 className="font-bold text-emerald-950">Todo concilia</h2>
            <p className="mt-0.5 text-sm text-emerald-800">No hay diferencias para revisar.</p>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm sm:flex sm:items-center sm:justify-between sm:gap-6">
          <div className="flex gap-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-full bg-red-50 text-red-600">
              <AlertIcon />
            </div>
            <div>
              <h2 className="font-bold text-slate-950">Hay una diferencia para revisar</h2>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                Faltan <strong className="text-red-700">{pesos(Math.abs(cierre.diferencia))}</strong> entre lo esperado y lo registrado.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled
            title="Disponible en la etapa de conciliación"
            className="mt-5 w-full cursor-not-allowed rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white opacity-60 sm:mt-0 sm:w-auto"
          >
            Analizar diferencia
          </button>
        </section>
      )}

      <section className="mt-5 grid grid-cols-3 gap-2" aria-label="Actividad del día">
        <Count label="Ventas" value={resumen.cantidadVentas} />
        <Count label="Gastos" value={resumen.cantidadGastos} />
        <Count label="Pagos" value={resumen.cantidadMovimientosPago} />
      </section>
    </main>
  );
}

function FormularioMovimiento({ titulo, action, horaActual, gasto = false }: { titulo: string; action: (formData: FormData) => Promise<never>; horaActual: string; gasto?: boolean }) {
  return (
    <form action={action} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="submission_id" value={randomUUID()} />
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

function Movimiento({ movimiento }: { movimiento: MovimientoDia }) {
  const tipo = movimiento.tipo === "venta" ? "Venta" : movimiento.tipo === "gasto" ? "Gasto" : "Pago recibido";
  const signo = movimiento.tipo === "gasto" ? "−" : "+";
  return <li className="flex items-center gap-3 px-5 py-3.5"><time className="w-12 text-sm tabular-nums text-slate-500">{movimiento.hora}</time><div className="min-w-0 flex-1"><p className="font-semibold text-slate-900">{tipo}</p><p className="truncate text-xs text-slate-500">{movimiento.detalle} · {etiquetasMedio[movimiento.medioPago]}</p></div><p className={`font-bold tabular-nums ${movimiento.tipo === "gasto" ? "text-red-600" : "text-slate-900"}`}>{signo}{pesos(movimiento.monto)}</p></li>;
}

function Total({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "danger" }) {
  const toneClass = tone === "danger" ? "text-red-600" : tone === "success" ? "text-emerald-600" : "text-slate-950";
  return (
    <div className="border-b border-slate-100 p-5 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
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

function MarkIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 fill-none stroke-current" strokeWidth="2.2"><path d="M5 12.5 9.2 17 19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function CashIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="1.8"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9h.01M18 15h.01" strokeLinecap="round"/></svg>; }
function TransferIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="1.8"><path d="M5 8h14M15 4l4 4-4 4M19 16H5M9 20l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function WalletIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="1.8"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v11H6.5A2.5 2.5 0 0 1 4 15.5v-8Z"/><path d="M15 10h6v5h-6a2.5 2.5 0 0 1 0-5Z"/><circle cx="16" cy="12.5" r=".5" fill="currentColor"/></svg>; }
function CheckIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2.4"><path d="m6 12 4 4 8-9" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function AlertIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2"><path d="M12 8v5M12 17h.01" strokeLinecap="round"/><circle cx="12" cy="12" r="9"/></svg>; }

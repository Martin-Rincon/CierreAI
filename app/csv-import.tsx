"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MedioPago } from "@/lib/types";
import { confirmarImportacionCsv, previsualizarCsv } from "./actions";

type Preview = {
  movimientos: Array<{ tipo: "venta" | "gasto" | "pago"; montoCentavos: number; medioPago: MedioPago; hora: string; categoria: string }>;
  resumen: { ventas: number; gastos: number; pagos: number };
  tieneMovimientos: boolean;
};

const ejemplo = `tipo,monto,medio_pago,hora,categoria,descripcion\r\nventa,12500,mercado_pago,18:30,,\r\nventa,8500,efectivo,10:00,,\r\ngasto,5000,efectivo,14:00,flete,Entrega del día\r\npago,12500,mercado_pago,18:32,,\r\n`;
const CSV_MAX_BYTES = 1024 * 1024;
const medios: Record<MedioPago, string> = { efectivo: "Efectivo", transferencia: "Transferencia", mercado_pago: "Mercado Pago" };

function pesos(centavos: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(centavos / 100);
}

export function CsvImport({ cierreId, esDemo }: { cierreId: number; esDemo: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [contenido, setContenido] = useState("");
  const [bytes, setBytes] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errores, setErrores] = useState<string[]>([]);
  const [mensaje, setMensaje] = useState("");
  const [pending, startTransition] = useTransition();

  function limpiarFeedbackAnterior() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("mensaje") && !url.searchParams.has("actualizado")) return;
    url.searchParams.delete("mensaje");
    url.searchParams.delete("actualizado");
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
  }

  function descargarEjemplo() {
    const blob = new Blob(["\uFEFF", ejemplo], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url; enlace.download = "cierreai-ejemplo.csv"; enlace.click();
    URL.revokeObjectURL(url);
  }

  async function elegirArchivo(event: React.ChangeEvent<HTMLInputElement>) {
    const archivo = event.target.files?.[0];
    event.target.value = "";
    limpiarFeedbackAnterior();
    setErrores([]); setMensaje("");
    if (!archivo) return;
    if (!archivo.name.toLocaleLowerCase().endsWith(".csv")) { setErrores(["Seleccioná un archivo con extensión .csv."]); return; }
    if (archivo.size > CSV_MAX_BYTES) { setErrores(["El archivo supera el límite de 1 MB."]); return; }
    let texto: string;
    try { texto = new TextDecoder("utf-8", { fatal: true }).decode(await archivo.arrayBuffer()); }
    catch { setErrores(["El archivo no tiene una codificación UTF-8 válida."]); return; }
    setContenido(texto); setBytes(archivo.size);
    startTransition(async () => {
      const resultado = await previsualizarCsv(cierreId, texto, archivo.size);
      if (resultado.ok) setPreview(resultado);
      else setErrores(resultado.errores);
    });
  }

  function confirmar() {
    setErrores([]);
    startTransition(async () => {
      const resultado = await confirmarImportacionCsv(cierreId, contenido, bytes);
      if (!resultado.ok) { setErrores(resultado.errores); return; }
      setPreview(null); setContenido(""); setBytes(0);
      setMensaje(`Se importaron ${resultado.cantidad} movimientos correctamente.`);
      router.refresh();
    });
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="csv-title">
    <div className="sm:flex sm:items-center sm:justify-between sm:gap-5">
      <div><h3 id="csv-title" className="text-lg font-bold text-slate-950">Importar CSV</h3><p className="mt-1 text-sm text-slate-600">Cargá varias ventas, gastos y pagos usando el formato de ejemplo.</p></div>
      <div className="mt-4 flex flex-col gap-2 sm:mt-0 sm:flex-row">
        <button type="button" onClick={() => inputRef.current?.click()} disabled={pending || esDemo} className="rounded-xl border border-blue-300 bg-white px-4 py-3 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Procesando…" : "Importar CSV"}</button>
        <button type="button" onClick={descargarEjemplo} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700">Descargar CSV de ejemplo</button>
        <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={elegirArchivo} className="sr-only" aria-label="Seleccionar archivo CSV" />
      </div>
    </div>
    {esDemo && <p role="status" className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">Este cierre está usando datos de ejemplo. Empezá con tus datos antes de importar un CSV.</p>}
    {mensaje && <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{mensaje}</p>}
    {errores.length > 0 && <div role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"><p className="font-bold">No se puede importar el archivo:</p><ul className="mt-1 list-disc pl-5">{errores.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul></div>}
    {preview && <div role="dialog" aria-modal="true" aria-labelledby="csv-preview-title" className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/50 p-3 sm:p-6">
      <div className="my-auto w-full max-w-4xl rounded-2xl bg-white p-4 shadow-2xl sm:p-6">
        <h2 id="csv-preview-title" className="text-xl font-bold text-slate-950">Se encontraron {preview.movimientos.length} movimientos</h2>
        <p className="mt-2 text-sm text-slate-600">{preview.resumen.ventas} ventas · {preview.resumen.gastos} gastos · {preview.resumen.pagos} pagos</p>
        {preview.tieneMovimientos && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">Este cierre ya contiene movimientos. Los datos del CSV se agregarán a los existentes.</p>}
        <div className="mt-4 max-h-[55vh] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[640px] text-left text-sm"><thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600"><tr><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Monto</th><th className="px-3 py-2">Medio</th><th className="px-3 py-2">Hora</th><th className="px-3 py-2">Categoría</th></tr></thead><tbody className="divide-y divide-slate-100">{preview.movimientos.slice(0, 20).map((item, index) => <tr key={index}><td className="px-3 py-2 capitalize">{item.tipo}</td><td className="px-3 py-2 tabular-nums">{pesos(item.montoCentavos)}</td><td className="px-3 py-2">{medios[item.medioPago]}</td><td className="px-3 py-2">{item.hora}</td><td className="px-3 py-2">{item.categoria || "—"}</td></tr>)}</tbody></table>
        </div>
        {preview.movimientos.length > 20 && <p className="mt-2 text-sm font-semibold text-slate-600">+ {preview.movimientos.length - 20} movimientos más</p>}
        {errores.length > 0 && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{errores.join(" ")}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" disabled={pending} onClick={() => { setPreview(null); setErrores([]); }} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700">Cancelar</button><button type="button" disabled={pending} onClick={confirmar} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{pending ? "Importando…" : "Confirmar importación"}</button></div>
      </div>
    </div>}
  </section>;
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { run, transaction, type DbExecutor } from "@/lib/db";
import { cambiarEstadoCausa, cargarDatosEscenarioDemo, ejecutarConciliacion, finalizarCierre, guardarExplicacionCausa, obtenerCausasCandidatas, obtenerCierreParaCargaReal, obtenerDiferenciaCierre, reabrirCierre, restablecerDatosEscenarioDemo, vaciarDatosCierre } from "@/lib/data";
import { explicarCausa, interpretarMovimiento, validarMovimientoInterpretado, type MovimientoInterpretado, type ResultadoInterpretacion } from "@/lib/ia";
import { MEDIOS_PAGO, type MedioPago } from "@/lib/types";
import { CsvValidationError } from "@/lib/csv";
import { importarCsv, prepararImportacionCsv } from "@/lib/csv-import";

function texto(formData: FormData, campo: string): string {
  return String(formData.get(campo) ?? "").trim();
}

function monto(formData: FormData): number {
  const original = texto(formData, "monto");
  const numero = Number(original.replace(",", "."));
  if (!Number.isFinite(numero) || numero <= 0 || !/^\d+(?:[.,]\d{1,2})?$/.test(original)) {
    throw new Error("Ingresá un monto válido mayor que cero.");
  }
  return Math.round(numero * 100);
}

function medio(formData: FormData): MedioPago {
  const valor = texto(formData, "medio_pago") as MedioPago;
  if (!MEDIOS_PAGO.includes(valor)) throw new Error("Elegí un medio de pago válido.");
  return valor;
}

function hora(formData: FormData): string {
  const valor = texto(formData, "hora");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(valor)) throw new Error("Ingresá una hora válida.");
  return valor;
}

function submissionId(formData: FormData): string {
  const valor = texto(formData, "submission_id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor)) {
    throw new Error("La identificación del envío no es válida.");
  }
  return valor;
}

function cierreId(formData: FormData): number {
  const valor = Number(formData.get("cierre_id"));
  if (!Number.isSafeInteger(valor) || valor <= 0) throw new Error("El cierre seleccionado no es válido.");
  return valor;
}

async function actualizarTotales(cierreId: number, executor: DbExecutor): Promise<void> {
  await run(
    `UPDATE cierres SET
      total_esperado = efectivo_inicial
        + COALESCE((SELECT SUM(monto) FROM ventas WHERE cierre_id = ?), 0)
        - COALESCE((SELECT SUM(monto) FROM gastos WHERE cierre_id = ?), 0),
      total_registrado = COALESCE(efectivo_contado, 0)
        + COALESCE((SELECT SUM(monto) FROM movimientos_pago WHERE cierre_id = ? AND medio_pago != 'efectivo'), 0)
    WHERE id = ?`,
    [cierreId, cierreId, cierreId, cierreId], executor,
  );
  await run("UPDATE cierres SET diferencia = total_registrado - total_esperado WHERE id = ?", [cierreId], executor);
  await run("UPDATE cierres SET analizado = 0, estado = CASE WHEN diferencia = 0 THEN 'conciliado' ELSE 'con_diferencia' END WHERE id = ?", [cierreId], executor);
}

function terminarAccion(mensaje: string, fecha: string): never {
  revalidatePath("/");
  redirect(`/?fecha=${fecha}&mensaje=${encodeURIComponent(mensaje)}#carga`);
}

async function guardarMovimiento(id: number, movimiento: MovimientoInterpretado, submission: string, metodo: "ia" | "formulario"): Promise<string> {
  let fecha = "";
  await transaction(async (tx) => {
    const cierre = await obtenerCierreParaCargaReal(id, tx);
    fecha = cierre.fecha;
    if (movimiento.tipo === "venta") {
      await run("INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga, submission_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(submission_id) WHERE submission_id IS NOT NULL DO NOTHING", [cierre.id, movimiento.monto_centavos, movimiento.medio_pago, movimiento.hora, metodo, submission], tx);
    } else if (movimiento.tipo === "gasto") {
      await run("INSERT INTO gastos (cierre_id, monto, categoria, descripcion, medio_pago, hora, metodo_carga, submission_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(submission_id) WHERE submission_id IS NOT NULL DO NOTHING", [cierre.id, movimiento.monto_centavos, movimiento.categoria, movimiento.descripcion ?? "", movimiento.medio_pago, movimiento.hora, metodo, submission], tx);
    } else {
      await run("INSERT INTO movimientos_pago (cierre_id, monto, medio_pago, hora, metodo_carga, submission_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(submission_id) WHERE submission_id IS NOT NULL DO NOTHING", [cierre.id, movimiento.monto_centavos, movimiento.medio_pago, movimiento.hora, metodo, submission], tx);
    }
    await actualizarTotales(cierre.id, tx);
  });
  return fecha;
}

export async function cargarVenta(formData: FormData): Promise<never> {
  const fecha = await guardarMovimiento(cierreId(formData), { tipo: "venta", monto_centavos: monto(formData), medio_pago: medio(formData), hora: hora(formData) }, submissionId(formData), "formulario");
  terminarAccion("Venta cargada", fecha);
}

export async function cargarGasto(formData: FormData): Promise<never> {
  const categoria = texto(formData, "categoria");
  if (!categoria) throw new Error("Ingresá la categoría del gasto.");
  const fecha = await guardarMovimiento(cierreId(formData), { tipo: "gasto", monto_centavos: monto(formData), categoria, descripcion: texto(formData, "descripcion"), medio_pago: medio(formData), hora: hora(formData) }, submissionId(formData), "formulario");
  terminarAccion("Gasto cargado", fecha);
}

export async function cargarPago(formData: FormData): Promise<never> {
  const fecha = await guardarMovimiento(cierreId(formData), { tipo: "pago_recibido", monto_centavos: monto(formData), medio_pago: medio(formData), hora: hora(formData) }, submissionId(formData), "formulario");
  terminarAccion("Pago recibido cargado", fecha);
}

export async function guardarEfectivoContado(formData: FormData): Promise<never> {
  let fecha = "";
  await transaction(async (tx) => {
    const cierre = await obtenerCierreParaCargaReal(cierreId(formData), tx);
    fecha = cierre.fecha;
    await run("UPDATE cierres SET efectivo_contado = ? WHERE id = ?", [monto(formData), cierre.id], tx);
    await actualizarTotales(cierre.id, tx);
  });
  terminarAccion("Efectivo contado guardado", fecha);
}

export async function analizarDiferencia(cierreId: number): Promise<void> {
  await ejecutarConciliacion(cierreId);
  const diferenciaGeneral = await obtenerDiferenciaCierre(cierreId);
  const cierre = await obtenerCausasCandidatas(cierreId, diferenciaGeneral);
  await Promise.all(cierre.filter((causa) => causa.estado === "pendiente").map(async (causa) => {
    const criterioMatch = causa.tipo === "diferencia_efectivo" ? "Efectivo esperado comparado con efectivo contado" : "Mismo cierre, medio y monto exacto; menor distancia temporal";
    const resultadoAlgoritmo = causa.tipo === "diferencia_efectivo" ? "Los totales de efectivo no coinciden" : "No se encontró un movimiento compatible";
    const explicacion = await explicarCausa({ diferenciaGeneralCentavos: diferenciaGeneral, tipo: causa.tipo, entidad: causa.referenciaTipo ? `${causa.referenciaTipo} #${causa.referenciaId}` : "efectivo del cierre", montoCentavos: causa.monto, medio: causa.medioPago, hora: causa.hora, efectoCentavos: causa.efecto, criterioMatch, resultadoAlgoritmo });
    await guardarExplicacionCausa(causa.id, explicacion);
  }));
  revalidatePath("/");
}

export async function interpretarConIa(textoUsuario: string): Promise<ResultadoInterpretacion> {
  return interpretarMovimiento(textoUsuario);
}

export async function confirmarMovimientoIa(formData: FormData): Promise<never> {
  let bruto: unknown;
  try { bruto = JSON.parse(texto(formData, "movimiento")); } catch { throw new Error("La interpretación no es válida."); }
  const movimiento = validarMovimientoInterpretado(bruto);
  const fecha = await guardarMovimiento(cierreId(formData), movimiento, submissionId(formData), "ia");
  terminarAccion("Movimiento interpretado y guardado", fecha);
}

export async function finalizarCierreSeleccionado(formData: FormData): Promise<void> {
  await finalizarCierre(cierreId(formData));
  revalidatePath("/");
}

export async function reabrirCierreSeleccionado(formData: FormData): Promise<void> {
  await reabrirCierre(cierreId(formData));
  revalidatePath("/");
}

export async function confirmarCausa(formData: FormData): Promise<void> {
  await cambiarEstadoCausa(Number(formData.get("causa_id")), "confirmada");
  revalidatePath("/");
}

export async function descartarCausa(formData: FormData): Promise<void> {
  await cambiarEstadoCausa(Number(formData.get("causa_id")), "descartada");
  revalidatePath("/");
}

export async function cargarEscenarioDemo(id: number): Promise<void> {
  await cargarDatosEscenarioDemo(id);
  revalidatePath("/");
}

export async function restablecerEscenarioDemo(id: number): Promise<void> {
  await restablecerDatosEscenarioDemo(id);
  revalidatePath("/");
}

export async function empezarConMisDatos(id: number): Promise<string> {
  const fecha = await vaciarDatosCierre(id, true);
  revalidatePath("/");
  return fecha;
}

export async function vaciarCierreSeleccionado(id: number): Promise<string> {
  const fecha = await vaciarDatosCierre(id);
  revalidatePath("/");
  return fecha;
}

export type ResultadoPreviewCsv =
  | { ok: true; movimientos: Array<{ tipo: "venta" | "gasto" | "pago"; montoCentavos: number; medioPago: MedioPago; hora: string; categoria: string }>; resumen: { ventas: number; gastos: number; pagos: number }; tieneMovimientos: boolean }
  | { ok: false; errores: string[] };

function erroresCsv(error: unknown): string[] {
  if (error instanceof CsvValidationError) return error.errores;
  return [error instanceof Error ? error.message : "No se pudo procesar el CSV."];
}

export async function previsualizarCsv(cierre: number, contenido: string, bytes: number): Promise<ResultadoPreviewCsv> {
  try {
    const resultado = await prepararImportacionCsv(cierre, contenido, bytes);
    return {
      ok: true,
      movimientos: resultado.movimientos.map(({ tipo, montoCentavos, medioPago, hora, categoria }) => ({ tipo, montoCentavos, medioPago, hora, categoria })),
      resumen: resultado.resumen,
      tieneMovimientos: resultado.tieneMovimientos,
    };
  } catch (error) { return { ok: false, errores: erroresCsv(error) }; }
}

export async function confirmarImportacionCsv(cierre: number, contenido: string, bytes: number): Promise<{ ok: true; cantidad: number; fecha: string } | { ok: false; errores: string[] }> {
  try {
    const resultado = await importarCsv(cierre, contenido, bytes);
    revalidatePath("/");
    return { ok: true, ...resultado };
  } catch (error) { return { ok: false, errores: erroresCsv(error) }; }
}

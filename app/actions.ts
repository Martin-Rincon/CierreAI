"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { run, transaction } from "@/lib/db";
import { cambiarEstadoCausa, ejecutarConciliacion, obtenerOCrearCierreActual } from "@/lib/data";
import { MEDIOS_PAGO, type MedioPago } from "@/lib/types";

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

function actualizarTotales(cierreId: number): void {
  run(
    `UPDATE cierres SET
      total_esperado = efectivo_inicial
        + COALESCE((SELECT SUM(monto) FROM ventas WHERE cierre_id = ?), 0)
        - COALESCE((SELECT SUM(monto) FROM gastos WHERE cierre_id = ?), 0),
      total_registrado = COALESCE(efectivo_contado, 0)
        + COALESCE((SELECT SUM(monto) FROM movimientos_pago WHERE cierre_id = ? AND medio_pago != 'efectivo'), 0)
    WHERE id = ?`,
    cierreId, cierreId, cierreId, cierreId,
  );
  run("UPDATE cierres SET diferencia = total_registrado - total_esperado WHERE id = ?", cierreId);
  run("UPDATE cierres SET analizado = 0, estado = CASE WHEN diferencia = 0 THEN 'conciliado' ELSE 'con_diferencia' END WHERE id = ?", cierreId);
}

function finalizar(mensaje: string): never {
  revalidatePath("/");
  redirect(`/?mensaje=${encodeURIComponent(mensaje)}#carga`);
}

export async function cargarVenta(formData: FormData): Promise<never> {
  const cierre = obtenerOCrearCierreActual();
  transaction(() => {
    run("INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga, submission_id) VALUES (?, ?, ?, ?, 'formulario', ?) ON CONFLICT(submission_id) WHERE submission_id IS NOT NULL DO NOTHING", cierre.id, monto(formData), medio(formData), hora(formData), submissionId(formData));
    actualizarTotales(cierre.id);
  });
  finalizar("Venta cargada");
}

export async function cargarGasto(formData: FormData): Promise<never> {
  const categoria = texto(formData, "categoria");
  if (!categoria) throw new Error("Ingresá la categoría del gasto.");
  const cierre = obtenerOCrearCierreActual();
  transaction(() => {
    run("INSERT INTO gastos (cierre_id, monto, categoria, descripcion, medio_pago, hora, metodo_carga, submission_id) VALUES (?, ?, ?, ?, ?, ?, 'formulario', ?) ON CONFLICT(submission_id) WHERE submission_id IS NOT NULL DO NOTHING", cierre.id, monto(formData), categoria, texto(formData, "descripcion"), medio(formData), hora(formData), submissionId(formData));
    actualizarTotales(cierre.id);
  });
  finalizar("Gasto cargado");
}

export async function cargarPago(formData: FormData): Promise<never> {
  const cierre = obtenerOCrearCierreActual();
  transaction(() => {
    run("INSERT INTO movimientos_pago (cierre_id, monto, medio_pago, hora, metodo_carga, submission_id) VALUES (?, ?, ?, ?, 'formulario', ?) ON CONFLICT(submission_id) WHERE submission_id IS NOT NULL DO NOTHING", cierre.id, monto(formData), medio(formData), hora(formData), submissionId(formData));
    actualizarTotales(cierre.id);
  });
  finalizar("Pago recibido cargado");
}

export async function guardarEfectivoContado(formData: FormData): Promise<never> {
  const cierre = obtenerOCrearCierreActual();
  transaction(() => {
    run("UPDATE cierres SET efectivo_contado = ? WHERE id = ?", monto(formData), cierre.id);
    actualizarTotales(cierre.id);
  });
  finalizar("Efectivo contado guardado");
}

export async function analizarDiferencia(cierreId: number): Promise<void> {
  ejecutarConciliacion(cierreId);
  revalidatePath("/");
}

export async function confirmarCausa(formData: FormData): Promise<void> {
  cambiarEstadoCausa(Number(formData.get("causa_id")), "confirmada");
  revalidatePath("/");
}

export async function descartarCausa(formData: FormData): Promise<void> {
  cambiarEstadoCausa(Number(formData.get("causa_id")), "descartada");
  revalidatePath("/");
}

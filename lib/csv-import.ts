import { get, run, transaction, type DbExecutor } from "./db.ts";
import { obtenerCierreParaCargaReal, validarGastoEfectivo } from "./data.ts";
import { validarCsv, type CsvValidado } from "./csv.ts";

async function actualizarTotales(cierreId: number, tx: DbExecutor): Promise<void> {
  await run(`UPDATE cierres SET
    total_esperado = CASE WHEN efectivo_contado IS NULL THEN 0 ELSE efectivo_inicial END
      + COALESCE((SELECT SUM(monto) FROM ventas WHERE cierre_id = ? AND (medio_pago != 'efectivo' OR cierres.efectivo_contado IS NOT NULL)), 0)
      - COALESCE((SELECT SUM(monto) FROM gastos WHERE cierre_id = ? AND (medio_pago != 'efectivo' OR cierres.efectivo_contado IS NOT NULL)), 0),
    total_registrado = COALESCE(efectivo_contado, 0)
      + COALESCE((SELECT SUM(monto) FROM movimientos_pago WHERE cierre_id = ? AND medio_pago != 'efectivo'), 0)
    WHERE id = ?`, [cierreId, cierreId, cierreId, cierreId], tx);
  await run("UPDATE cierres SET diferencia = total_registrado - total_esperado WHERE id = ?", [cierreId], tx);
  await run("UPDATE cierres SET analizado = 0, estado = CASE WHEN diferencia = 0 THEN 'conciliado' ELSE 'con_diferencia' END WHERE id = ?", [cierreId], tx);
}

export async function prepararImportacionCsv(cierreId: number, contenido: string, bytes?: number): Promise<CsvValidado & { tieneMovimientos: boolean }> {
  const cierre = await obtenerCierreParaCargaReal(cierreId);
  const validado = validarCsv(contenido, bytes);
  const existente = await get<{ id: number }>("SELECT id FROM csv_importaciones WHERE cierre_id = ? AND fingerprint = ?", [cierre.id, validado.fingerprint]);
  if (existente) throw new Error("Este CSV ya fue importado en este cierre.");
  const conteo = await get<{ total: number }>(`SELECT
    (SELECT COUNT(*) FROM ventas WHERE cierre_id = ?)
    + (SELECT COUNT(*) FROM gastos WHERE cierre_id = ?)
    + (SELECT COUNT(*) FROM movimientos_pago WHERE cierre_id = ?) AS total`, [cierre.id, cierre.id, cierre.id]);
  return { ...validado, tieneMovimientos: Number(conteo?.total ?? 0) > 0 };
}

export async function importarCsv(cierreId: number, contenido: string, bytes?: number): Promise<{ cantidad: number; fecha: string }> {
  const validado = validarCsv(contenido, bytes);
  let fecha = "";
  await transaction(async (tx) => {
    const cierre = await obtenerCierreParaCargaReal(cierreId, tx);
    fecha = cierre.fecha;
    const registro = await run(`INSERT INTO csv_importaciones (cierre_id, fingerprint, cantidad_movimientos)
      VALUES (?, ?, ?) ON CONFLICT(cierre_id, fingerprint) DO NOTHING`, [cierre.id, validado.fingerprint, validado.movimientos.length], tx);
    if (registro.rowsAffected === 0) throw new Error("Este CSV ya fue importado en este cierre.");
    for (const movimiento of validado.movimientos) {
      if (movimiento.tipo === "venta") {
        await run("INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, ?, ?, ?, 'csv')", [cierre.id, movimiento.montoCentavos, movimiento.medioPago, movimiento.hora], tx);
      } else if (movimiento.tipo === "gasto") {
        if (movimiento.medioPago === "efectivo") await validarGastoEfectivo(cierre.id, movimiento.montoCentavos, tx);
        await run("INSERT INTO gastos (cierre_id, monto, categoria, descripcion, medio_pago, hora, metodo_carga) VALUES (?, ?, ?, ?, ?, ?, 'csv')", [cierre.id, movimiento.montoCentavos, movimiento.categoria, movimiento.descripcion, movimiento.medioPago, movimiento.hora], tx);
      } else {
        await run("INSERT INTO movimientos_pago (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, ?, ?, ?, 'csv')", [cierre.id, movimiento.montoCentavos, movimiento.medioPago, movimiento.hora], tx);
      }
    }
    await actualizarTotales(cierre.id, tx);
  });
  return { cantidad: validado.movimientos.length, fecha };
}

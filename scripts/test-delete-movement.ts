import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "cierreai-delete-movement-"));
const databaseFile = path.join(temporaryDirectory, "test.db").replaceAll("\\", "/");
process.env.TURSO_DATABASE_URL = `file:${databaseFile}`;
delete process.env.TURSO_AUTH_TOKEN;

const { closeDatabase, get, run } = await import("../lib/db.ts");
const { eliminarMovimiento } = await import("../lib/data.ts");
const { importarCsv } = await import("../lib/csv-import.ts");

async function crearCierre(fecha: string): Promise<number> {
  return Number((await run("INSERT INTO cierres (fecha, efectivo_inicial) VALUES (?, 0)", [fecha])).lastInsertRowid);
}

async function agregar(cierreId: number) {
  const venta = Number((await run("INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, 10000, 'efectivo', '10:00', 'formulario')", [cierreId])).lastInsertRowid);
  const gasto = Number((await run("INSERT INTO gastos (cierre_id, monto, categoria, descripcion, medio_pago, hora, metodo_carga) VALUES (?, 2000, 'Flete', 'Entrega', 'efectivo', '11:00', 'formulario')", [cierreId])).lastInsertRowid);
  const pago = Number((await run("INSERT INTO movimientos_pago (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, 8000, 'transferencia', '12:00', 'formulario')", [cierreId])).lastInsertRowid);
  return { venta, gasto, pago };
}

async function total(tabla: string, cierreId: number): Promise<number> {
  return Number((await get<{ total: number }>(`SELECT COUNT(*) AS total FROM ${tabla} WHERE cierre_id = ?`, [cierreId]))?.total ?? 0);
}

try {
  const cierreVenta = await crearCierre("2003-01-01");
  const idsVenta = await agregar(cierreVenta);
  await eliminarMovimiento(cierreVenta, "venta", idsVenta.venta);
  assert.equal(await total("ventas", cierreVenta), 0, "1. elimina únicamente la venta seleccionada");
  assert.equal(await total("gastos", cierreVenta), 1);
  assert.equal(await total("movimientos_pago", cierreVenta), 1);

  const cierreGasto = await crearCierre("2003-01-02");
  const idsGasto = await agregar(cierreGasto);
  await eliminarMovimiento(cierreGasto, "gasto", idsGasto.gasto);
  assert.equal(await total("gastos", cierreGasto), 0, "2. elimina únicamente el gasto seleccionado");

  const cierrePago = await crearCierre("2003-01-03");
  const idsPago = await agregar(cierrePago);
  await run("UPDATE cierres SET efectivo_contado = 7000 WHERE id = ?", [cierrePago]);
  await eliminarMovimiento(cierrePago, "pago", idsPago.pago);
  assert.equal(await total("movimientos_pago", cierrePago), 0, "3. elimina únicamente el pago seleccionado");
  assert.deepEqual(await get("SELECT total_esperado, total_registrado, diferencia, estado FROM cierres WHERE id = ?", [cierrePago]), { total_esperado: 8000, total_registrado: 7000, diferencia: -1000, estado: "con_diferencia" }, "4. recalcula totales, diferencia y estado");

  const analizado = await crearCierre("2003-01-04");
  const idsAnalizado = await agregar(analizado);
  await run("UPDATE ventas SET conciliada = 1 WHERE cierre_id = ?", [analizado]);
  await run("UPDATE movimientos_pago SET conciliado = 1 WHERE cierre_id = ?", [analizado]);
  await run("INSERT INTO causas_candidatas (cierre_id, tipo, referencia_tipo, referencia_id, monto, efecto, tipo_match, estado) VALUES (?, 'venta_sin_pago', 'venta', ?, 10000, -10000, 'test', 'confirmada')", [analizado, idsAnalizado.venta]);
  await run("UPDATE cierres SET analizado = 1, estado = 'resuelto' WHERE id = ?", [analizado]);
  await eliminarMovimiento(analizado, "gasto", idsAnalizado.gasto);
  assert.equal(await total("causas_candidatas", analizado), 0, "5. elimina todas las causas derivadas anteriores");
  assert.deepEqual(await get("SELECT analizado, estado FROM cierres WHERE id = ?", [analizado]), { analizado: 0, estado: "con_diferencia" });
  assert.equal(Number((await get<{ total: number }>("SELECT COUNT(*) AS total FROM ventas WHERE cierre_id = ? AND conciliada = 1", [analizado]))?.total), 0);
  assert.equal(Number((await get<{ total: number }>("SELECT COUNT(*) AS total FROM movimientos_pago WHERE cierre_id = ? AND conciliado = 1", [analizado]))?.total), 0, "5b. invalida coincidencias previas");

  const finalizado = await crearCierre("2003-01-05");
  const idsFinalizado = await agregar(finalizado);
  await run("UPDATE cierres SET finalizado_at = CURRENT_TIMESTAMP WHERE id = ?", [finalizado]);
  await assert.rejects(eliminarMovimiento(finalizado, "venta", idsFinalizado.venta), /finalizado/, "6. rechaza cierres finalizados");
  assert.equal(await total("ventas", finalizado), 1);

  const doble = await crearCierre("2003-01-06");
  const idsDoble = await agregar(doble);
  await eliminarMovimiento(doble, "venta", idsDoble.venta);
  await eliminarMovimiento(doble, "venta", idsDoble.venta);
  assert.equal(await total("ventas", doble), 0, "7. una segunda solicitud es idempotente y no borra otro movimiento");
  assert.equal(await total("gastos", doble), 1);

  const otro = await crearCierre("2003-01-07");
  const idsOtro = await agregar(otro);
  await eliminarMovimiento(doble, "pago", idsDoble.pago);
  assert.equal(await total("ventas", otro), 1);
  assert.equal(await total("gastos", otro), 1);
  assert.equal(await total("movimientos_pago", otro), 1, "8. no afecta otros cierres");
  assert.ok(idsOtro.venta > 0);

  const csv = await crearCierre("2003-01-08");
  const contenidoCsv = "tipo,monto,medio_pago,hora,categoria,descripcion\nventa,100,efectivo,10:00,,";
  await importarCsv(csv, contenidoCsv);
  const ventaCsv = await get<{ id: number }>("SELECT id FROM ventas WHERE cierre_id = ? AND metodo_carga = 'csv'", [csv]);
  await eliminarMovimiento(csv, "venta", Number(ventaCsv?.id));
  assert.equal(await total("csv_importaciones", csv), 1, "9. conserva el fingerprint histórico al borrar una fila CSV");
  await assert.rejects(importarCsv(csv, contenidoCsv), /ya fue importado/, "9b. el CSV no puede reimportarse silenciosamente");

  console.log("OK: 9 casos de eliminación, recálculo, invalidación, aislamiento e historial CSV superados.");
  await closeDatabase();
} finally {
  try { fs.rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EPERM")) throw error;
  }
}

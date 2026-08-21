import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "cierreai-lifecycle-"));
const databaseFile = path.join(temporaryDirectory, "test.db").replaceAll("\\", "/");
process.env.TURSO_DATABASE_URL = `file:${databaseFile}`;
delete process.env.TURSO_AUTH_TOKEN;

const { closeDatabase, get, run } = await import("../lib/db.ts");
const { finalizarCierre, obtenerCierreEditable, obtenerCierresPendientes, obtenerOCrearCierreActual, reabrirCierre } = await import("../lib/data.ts");

try {
  const ayerConciliado = Number((await run("INSERT INTO cierres (fecha, efectivo_inicial, diferencia, estado) VALUES ('2000-01-01', 0, 0, 'conciliado')")).lastInsertRowid);
  await obtenerOCrearCierreActual();
  assert.equal((await get<{ finalizado_at: string | null }>("SELECT finalizado_at FROM cierres WHERE id = ?", [ayerConciliado]))?.finalizado_at, null, "1. cambiar de fecha no finaliza el cierre anterior");
  assert.equal((await get<{ estado: string; finalizado_at: string | null }>("SELECT estado, finalizado_at FROM cierres WHERE id = ?", [ayerConciliado]))?.finalizado_at, null, "2. un cierre conciliado puede seguir abierto");

  const ayerResuelto = Number((await run("INSERT INTO cierres (fecha, efectivo_inicial, diferencia, estado) VALUES ('2000-01-02', 0, -100, 'resuelto')")).lastInsertRowid);
  assert.equal((await get<{ finalizado_at: string | null }>("SELECT finalizado_at FROM cierres WHERE id = ?", [ayerResuelto]))?.finalizado_at, null, "3. un cierre resuelto puede seguir abierto");

  await finalizarCierre(ayerConciliado);
  assert.ok((await get<{ finalizado_at: string | null }>("SELECT finalizado_at FROM cierres WHERE id = ?", [ayerConciliado]))?.finalizado_at, "4. se puede finalizar un cierre conciliado");
  await finalizarCierre(ayerResuelto);
  assert.ok((await get<{ finalizado_at: string | null }>("SELECT finalizado_at FROM cierres WHERE id = ?", [ayerResuelto]))?.finalizado_at, "5. se puede finalizar un cierre resuelto");

  const sinExplicar = Number((await run("INSERT INTO cierres (fecha, efectivo_inicial, diferencia, estado) VALUES ('2000-01-03', 0, -2500, 'con_diferencia')")).lastInsertRowid);
  await finalizarCierre(sinExplicar);
  const conservaDiferencia = await get<{ diferencia: number; finalizado_at: string | null }>("SELECT diferencia, finalizado_at FROM cierres WHERE id = ?", [sinExplicar]);
  assert.ok(conservaDiferencia?.finalizado_at);
  assert.equal(conservaDiferencia?.diferencia, -2500, "6. finalizar con diferencia no explicada conserva la diferencia");

  await assert.rejects(obtenerCierreEditable(sinExplicar), /finalizado/, "7. un cierre finalizado rechaza cargas normales");
  await run("INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, 1000, 'efectivo', '10:00', 'formulario')", [sinExplicar]);
  await reabrirCierre(sinExplicar);
  assert.equal((await get<{ total: number }>("SELECT COUNT(*) AS total FROM ventas WHERE cierre_id = ?", [sinExplicar]))?.total, 1, "8. reabrir conserva los datos");
  assert.equal((await obtenerCierreEditable(sinExplicar)).id, sinExplicar, "8. reabrir vuelve a permitir modificaciones");

  const pendientes = await obtenerCierresPendientes("2000-01-04");
  assert.ok(pendientes.some((item) => item.fecha === "2000-01-03"), "9. detecta un cierre pendiente de ayer");
  assert.ok(!pendientes.some((item) => item.fecha === "2000-01-01"), "10. un cierre finalizado de ayer no aparece pendiente");

  const vacioUno = Number((await run("INSERT INTO cierres (fecha, efectivo_inicial) VALUES ('2000-01-10', 0)")).lastInsertRowid);
  const vacioDos = Number((await run("INSERT INTO cierres (fecha, efectivo_inicial, efectivo_contado, total_esperado, total_registrado, diferencia) VALUES ('2000-01-11', 0, 0, 0, 0, 0)")).lastInsertRowid);
  const conVenta = Number((await run("INSERT INTO cierres (fecha, efectivo_inicial) VALUES ('2000-01-12', 0)")).lastInsertRowid);
  await run("INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, 100, 'efectivo', '10:00', 'formulario')", [conVenta]);
  const conGasto = Number((await run("INSERT INTO cierres (fecha, efectivo_inicial) VALUES ('2000-01-13', 0)")).lastInsertRowid);
  await run("INSERT INTO gastos (cierre_id, monto, categoria, medio_pago, hora, metodo_carga) VALUES (?, 100, 'Prueba', 'efectivo', '10:00', 'formulario')", [conGasto]);
  const conPago = Number((await run("INSERT INTO cierres (fecha, efectivo_inicial) VALUES ('2000-01-14', 0)")).lastInsertRowid);
  await run("INSERT INTO movimientos_pago (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, 100, 'transferencia', '10:00', 'formulario')", [conPago]);
  await run("INSERT INTO cierres (fecha, efectivo_inicial, efectivo_contado) VALUES ('2000-01-15', 0, 100)");
  await run("INSERT INTO cierres (fecha, efectivo_inicial) VALUES ('2000-01-16', 100)");
  const finalizadoConActividad = Number((await run("INSERT INTO cierres (fecha, efectivo_inicial, finalizado_at) VALUES ('2000-01-17', 100, CURRENT_TIMESTAMP)")).lastInsertRowid);

  const pendientesConActividad = await obtenerCierresPendientes("2000-02-01");
  const fechasPendientes = pendientesConActividad.map((item) => item.fecha);
  assert.ok(!fechasPendientes.includes("2000-01-10"), "11. un cierre vacío no genera aviso");
  assert.ok(!fechasPendientes.includes("2000-01-11"), "12. varios cierres vacíos y valores cero no incrementan el contador");
  assert.ok(fechasPendientes.includes("2000-01-12"), "13. una venta genera aviso");
  assert.ok(fechasPendientes.includes("2000-01-13"), "14. un gasto genera aviso");
  assert.ok(fechasPendientes.includes("2000-01-14"), "15. un pago recibido genera aviso");
  assert.ok(fechasPendientes.includes("2000-01-15"), "16. efectivo contado relevante genera aviso");
  assert.ok(fechasPendientes.includes("2000-01-16"), "17. efectivo inicial relevante genera aviso");
  assert.ok(!fechasPendientes.includes("2000-01-17"), "18. un cierre finalizado nunca genera aviso");
  assert.equal((await get<{ id: number }>("SELECT id FROM cierres WHERE id = ?", [vacioUno]))?.id, vacioUno, "19. el cierre vacío sigue existiendo");
  assert.equal((await get<{ id: number }>("SELECT id FROM cierres WHERE id = ?", [vacioDos]))?.id, vacioDos);
  assert.equal((await get<{ finalizado_at: string | null }>("SELECT finalizado_at FROM cierres WHERE id = ?", [finalizadoConActividad]))?.finalizado_at == null, false, "20. no altera lifecycle ni otros cierres");

  console.log("OK: 20 casos de lifecycle y avisos limitados a cierres con actividad real superados.");
  await closeDatabase();
} finally {
  try { fs.rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EPERM")) throw error;
  }
}

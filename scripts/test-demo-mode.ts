import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "cierreai-demo-mode-"));
const databaseFile = path.join(temporaryDirectory, "test.db").replaceAll("\\", "/");
process.env.TURSO_DATABASE_URL = `file:${databaseFile}`;
delete process.env.TURSO_AUTH_TOKEN;

const { closeDatabase, get, run } = await import("../lib/db.ts");
const { cargarDatosEscenarioDemo, obtenerCierreEditable, restablecerDatosEscenarioDemo, vaciarDatosCierre } = await import("../lib/data.ts");
const { coordinarVaciado } = await import("../lib/vaciar-flow.ts");

async function crearCierre(fecha: string, extra = ""): Promise<number> {
  return Number((await run(`INSERT INTO cierres (fecha, efectivo_inicial${extra ? `, ${extra}` : ""}) VALUES (?, 0${extra ? ", 1" : ""})`, [fecha])).lastInsertRowid);
}

async function cantidades(id: number) {
  return get<{ ventas: number; gastos: number; pagos: number; causas: number }>(`SELECT
    (SELECT COUNT(*) FROM ventas WHERE cierre_id = ?) AS ventas,
    (SELECT COUNT(*) FROM gastos WHERE cierre_id = ?) AS gastos,
    (SELECT COUNT(*) FROM movimientos_pago WHERE cierre_id = ?) AS pagos,
    (SELECT COUNT(*) FROM causas_candidatas WHERE cierre_id = ?) AS causas`, [id, id, id, id]);
}

async function agregarDatosCompletos(id: number): Promise<void> {
  await run("INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, 1000, 'transferencia', '10:00', 'formulario')", [id]);
  await run("INSERT INTO gastos (cierre_id, monto, categoria, medio_pago, hora, metodo_carga) VALUES (?, 200, 'Prueba', 'efectivo', '10:10', 'formulario')", [id]);
  await run("INSERT INTO movimientos_pago (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, 1000, 'transferencia', '10:02', 'formulario')", [id]);
  await run("INSERT INTO causas_candidatas (cierre_id, tipo, referencia_tipo, referencia_id, monto, efecto, tipo_match) VALUES (?, 'venta_sin_pago', 'venta', 1, 1000, -1000, 'test')", [id]);
  await run("UPDATE cierres SET efectivo_contado = 500, analizado = 1, total_esperado = 800, total_registrado = 1500, diferencia = 700, estado = 'con_diferencia' WHERE id = ?", [id]);
}

try {
  const demo = await crearCierre("2001-01-01");
  await cargarDatosEscenarioDemo(demo);
  assert.deepEqual(await cantidades(demo), { ventas: 4, gastos: 1, pagos: 2, causas: 0 }, "1. cargar demo en un cierre vacío funciona");
  await cargarDatosEscenarioDemo(demo);
  assert.deepEqual(await cantidades(demo), { ventas: 4, gastos: 1, pagos: 2, causas: 0 }, "2. cargar demo dos veces no duplica datos");
  assert.equal((await get<{ es_demo: number }>("SELECT es_demo FROM cierres WHERE id = ?", [demo]))?.es_demo, 1, "3. el cierre demo queda identificado en la base");

  const otro = await crearCierre("2001-01-02");
  await run("INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, 777, 'efectivo', '09:00', 'formulario')", [otro]);
  await vaciarDatosCierre(demo, true);
  assert.deepEqual(await cantidades(demo), { ventas: 0, gastos: 0, pagos: 0, causas: 0 }, "4. empezar con mis datos elimina los datos del cierre actual");
  const demoVacio = await get<{ efectivo_contado: number | null; analizado: number; es_demo: number; total_esperado: number; total_registrado: number; diferencia: number; finalizado_at: string | null }>("SELECT efectivo_contado, analizado, es_demo, total_esperado, total_registrado, diferencia, finalizado_at FROM cierres WHERE id = ?", [demo]);
  assert.deepEqual(demoVacio, { efectivo_contado: null, analizado: 0, es_demo: 0, total_esperado: 0, total_registrado: 0, diferencia: 0, finalizado_at: null }, "5. cargar demo y empezar con mis datos deja el cierre vacío, editable y fuera de demo");
  assert.equal((await obtenerCierreEditable(demo)).id, demo);
  assert.equal((await cantidades(otro))?.ventas, 1, "6. otros cierres permanecen intactos");
  await vaciarDatosCierre(demo);
  assert.deepEqual(await cantidades(demo), { ventas: 0, gastos: 0, pagos: 0, causas: 0 }, "6b. repetir el vaciado es seguro e idempotente");

  await agregarDatosCompletos(demo);
  await vaciarDatosCierre(demo);
  assert.deepEqual(await cantidades(demo), { ventas: 0, gastos: 0, pagos: 0, causas: 0 }, "7. vaciar cierre real elimina ventas, gastos, pagos y causas");
  assert.deepEqual(await get("SELECT efectivo_contado, analizado, es_demo FROM cierres WHERE id = ?", [demo]), { efectivo_contado: null, analizado: 0, es_demo: 0 });

  const finalizado = await crearCierre("2001-01-03");
  await run("UPDATE cierres SET finalizado_at = CURRENT_TIMESTAMP WHERE id = ?", [finalizado]);
  await assert.rejects(vaciarDatosCierre(finalizado), /finalizado/, "8. vaciar un cierre finalizado es rechazado");

  const real = await crearCierre("2001-01-04");
  await run("INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, 900, 'efectivo', '11:00', 'formulario')", [real]);
  await assert.rejects(cargarDatosEscenarioDemo(real), /primero tenés que vaciarlo/, "9. demo sobre datos reales es rechazado");
  assert.deepEqual(await cantidades(real), { ventas: 1, gastos: 0, pagos: 0, causas: 0 });

  const restaurable = await crearCierre("2001-01-05");
  await cargarDatosEscenarioDemo(restaurable);
  await run("DELETE FROM ventas WHERE cierre_id = ? AND id = (SELECT MIN(id) FROM ventas WHERE cierre_id = ?)", [restaurable, restaurable]);
  await restablecerDatosEscenarioDemo(restaurable);
  assert.deepEqual(await cantidades(restaurable), { ventas: 4, gastos: 1, pagos: 2, causas: 0 }, "10. restablecer devuelve el demo original");
  await assert.rejects(restablecerDatosEscenarioDemo(real), /no está usando/, "10. restablecer se rechaza fuera de demo");

  const rollback = await crearCierre("2001-01-06");
  await agregarDatosCompletos(rollback);
  await run(`CREATE TRIGGER impedir_vaciado BEFORE UPDATE ON cierres WHEN NEW.id = ${rollback} BEGIN SELECT RAISE(ABORT, 'fallo forzado'); END`);
  await assert.rejects(vaciarDatosCierre(rollback), /fallo forzado/);
  assert.deepEqual(await cantidades(rollback), { ventas: 1, gastos: 1, pagos: 1, causas: 1 }, "11. un fallo revierte todas las eliminaciones");
  await run("DROP TRIGGER impedir_vaciado");

  let resolverRespuesta!: (fecha: string) => void;
  const respuestaLenta = new Promise<string>((resolve) => { resolverRespuesta = resolve; });
  const control = { enCurso: false };
  const eventos: string[] = [];
  let ejecuciones = 0;
  const primera = coordinarVaciado(control, async () => { ejecuciones += 1; return respuestaLenta; }, (fecha) => { eventos.push(`cerrar:${fecha}`); eventos.push(`navegar:${fecha}`); }, () => eventos.push("error"));
  const segunda = coordinarVaciado(control, async () => { ejecuciones += 1; return "duplicada"; }, () => eventos.push("feedback-duplicado"), () => eventos.push("error-duplicado"));
  assert.equal(control.enCurso, true, "12. una respuesta lenta mantiene el estado pending");
  assert.equal(ejecuciones, 1, "13. un doble submit ejecuta una sola operación");
  assert.deepEqual(eventos, [], "14. no cierra ni navega antes de recibir respuesta");
  resolverRespuesta("2001-01-06");
  await Promise.all([primera, segunda]);
  assert.equal(control.enCurso, false, "15. libera el lock después de completar");
  assert.deepEqual(eventos, ["cerrar:2001-01-06", "navegar:2001-01-06"], "16. cierra y navega una sola vez al recibir éxito");

  console.log("OK: 16 casos de demo, vaciado idempotente, respuesta lenta y doble submit superados.");
  await closeDatabase();
} finally {
  try { fs.rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EPERM")) throw error;
  }
}

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "cierreai-csv-"));
const databaseFile = path.join(temporaryDirectory, "test.db").replaceAll("\\", "/");
process.env.TURSO_DATABASE_URL = `file:${databaseFile}`;
delete process.env.TURSO_AUTH_TOKEN;

const { closeDatabase, get, run } = await import("../lib/db.ts");
const { CSV_MAX_BYTES, validarCsv } = await import("../lib/csv.ts");
const { importarCsv, prepararImportacionCsv } = await import("../lib/csv-import.ts");

const encabezado = "tipo,monto,medio_pago,hora,categoria,descripcion";
const valido = `${encabezado}\nventa,12500.50,mercado_pago,18:30,,\ngasto,5000,efectivo,14:00,flete,Entrega del día\npago,12500,mp,18:32,,`;

async function crearCierre(fecha: string): Promise<number> {
  return Number((await run("INSERT INTO cierres (fecha, efectivo_inicial) VALUES (?, 0)", [fecha])).lastInsertRowid);
}

async function cantidad(id: number): Promise<number> {
  return Number((await get<{ total: number }>(`SELECT
    (SELECT COUNT(*) FROM ventas WHERE cierre_id = ?) +
    (SELECT COUNT(*) FROM gastos WHERE cierre_id = ?) +
    (SELECT COUNT(*) FROM movimientos_pago WHERE cierre_id = ?) AS total`, [id, id, id]))?.total ?? 0);
}

try {
  const parseado = validarCsv(valido);
  assert.deepEqual(parseado.resumen, { ventas: 1, gastos: 1, pagos: 1 }, "1. CSV válido reconoce los tres tipos");
  assert.equal(parseado.movimientos[0].montoCentavos, 1_250_050, "2. convierte pesos y decimales a centavos sin float");
  assert.equal(validarCsv(valido.replaceAll("\n", "\r\n")).movimientos.length, 3, "3. acepta CRLF");
  assert.equal(validarCsv(`\uFEFF${valido}`).movimientos.length, 3, "4. acepta BOM UTF-8");
  assert.equal(validarCsv(`${encabezado}\nventa,100,efectivo,10:00,,"texto, con coma"`).movimientos.length, 1, "5. acepta comas dentro de campos citados");
  assert.throws(() => validarCsv(`${encabezado}\ncobro,100,efectivo,10:00,,`), /tipo desconocido 'cobro'/, "6. rechaza tipo inválido");
  assert.throws(() => validarCsv(`${encabezado}\nventa,12.500.00,efectivo,10:00,,`), /monto inválido/, "7. rechaza monto inválido o ambiguo");
  assert.throws(() => validarCsv(`${encabezado}\nventa,100,efectivo,25:00,,`), /hora inválida/, "8. rechaza hora inválida");
  assert.throws(() => validarCsv(`${encabezado}\ngasto,100,efectivo,10:00,,`), /requieren categoría/, "9. exige categoría en gastos");
  assert.throws(() => validarCsv(`${encabezado}\nventa,100,tarjeta,10:00,,`), /medio de pago inválido/, "10. rechaza medio inválido");

  const invalido = await crearCierre("2002-01-01");
  await assert.rejects(importarCsv(invalido, `${encabezado}\nventa,100,efectivo,10:00,,\ngasto,50,efectivo,11:00,,`), /requieren categoría/);
  assert.equal(await cantidad(invalido), 0, "11. una fila inválida impide toda persistencia");

  const importado = await crearCierre("2002-01-02");
  assert.equal((await importarCsv(importado, valido)).cantidad, 3);
  assert.equal(await cantidad(importado), 3, "12. una importación válida persiste todas las filas");
  const metodos = await get<{ total: number }>(`SELECT
    (SELECT COUNT(*) FROM ventas WHERE cierre_id = ? AND metodo_carga = 'csv') +
    (SELECT COUNT(*) FROM gastos WHERE cierre_id = ? AND metodo_carga = 'csv') +
    (SELECT COUNT(*) FROM movimientos_pago WHERE cierre_id = ? AND metodo_carga = 'csv') AS total`, [importado, importado, importado]);
  assert.equal(Number(metodos?.total), 3, "13. persiste metodo_carga csv");

  const finalizado = await crearCierre("2002-01-03");
  await run("UPDATE cierres SET finalizado_at = CURRENT_TIMESTAMP WHERE id = ?", [finalizado]);
  await assert.rejects(importarCsv(finalizado, valido), /finalizado/, "14. rechaza cierre finalizado");
  const demo = await crearCierre("2002-01-04");
  await run("UPDATE cierres SET es_demo = 1 WHERE id = ?", [demo]);
  await assert.rejects(importarCsv(demo, valido), /Empezar con mis datos/, "15. rechaza cierre demo");

  const existente = await crearCierre("2002-01-05");
  await run("INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, 999, 'efectivo', '09:00', 'formulario')", [existente]);
  assert.equal((await prepararImportacionCsv(existente, valido)).tieneMovimientos, true);
  await importarCsv(existente, valido);
  assert.equal(await cantidad(existente), 4, "16. agrega sobre datos reales sin reemplazarlos");

  await assert.rejects(importarCsv(importado, valido), /ya fue importado/, "17. rechaza el mismo CSV dos veces en un cierre");
  assert.equal(await cantidad(importado), 3, "17b. el duplicado no agrega filas");
  const otro = await crearCierre("2002-01-06");
  await importarCsv(otro, valido);
  assert.equal(await cantidad(otro), 3, "18. otro cierre puede importar el mismo CSV");

  const rollback = await crearCierre("2002-01-07");
  await run(`CREATE TRIGGER fallo_csv BEFORE INSERT ON gastos WHEN NEW.cierre_id = ${rollback} BEGIN SELECT RAISE(ABORT, 'fallo forzado'); END`);
  await assert.rejects(importarCsv(rollback, valido), /fallo forzado/);
  assert.equal(await cantidad(rollback), 0, "19. una falla intermedia revierte todos los movimientos");
  assert.equal(Number((await get<{ total: number }>("SELECT COUNT(*) AS total FROM csv_importaciones WHERE cierre_id = ?", [rollback]))?.total), 0, "19b. también revierte el fingerprint");
  await run("DROP TRIGGER fallo_csv");

  assert.throws(() => validarCsv(`${encabezado}\nventa,1,efectivo,10:00,,`, CSV_MAX_BYTES + 1), /1 MB/, "20. limita el tamaño");
  const demasiadas = [encabezado, ...Array.from({ length: 1001 }, () => "venta,1,efectivo,10:00,,")].join("\n");
  assert.throws(() => validarCsv(demasiadas), /1000 filas/, "20b. limita la cantidad de filas");
  assert.equal(validarCsv(`${encabezado}\nventa,"12500,50",transfer,10:00,,`).movimientos[0].montoCentavos, 1_250_050, "20c. acepta decimal con coma cuando está citado inequívocamente");

  console.log("OK: 20 casos de parseo, validación, seguridad, atomicidad y duplicados CSV superados.");
  await closeDatabase();
} finally {
  try { fs.rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EPERM")) throw error;
  }
}

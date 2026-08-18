import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("data/cierreai.db");
const cierre = database.prepare("SELECT id FROM cierres ORDER BY fecha DESC LIMIT 1").get();
assert.ok(cierre, "Debe existir al menos un cierre para ejecutar la verificación.");

const submissionId = randomUUID();
const insert = database.prepare(`
  INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga, submission_id)
  VALUES (?, 1, 'efectivo', '00:00', 'formulario', ?)
  ON CONFLICT(submission_id) WHERE submission_id IS NOT NULL DO NOTHING
`);

database.exec("BEGIN IMMEDIATE");
try {
  insert.run(cierre.id, submissionId);
  insert.run(cierre.id, submissionId);
  const row = database.prepare("SELECT COUNT(*) AS total FROM ventas WHERE submission_id = ?").get(submissionId);
  assert.equal(row.total, 1, "Dos envíos con la misma identificación deben crear una sola venta.");
  database.exec("ROLLBACK");
  console.log("OK: dos submits idénticos generan exactamente una venta y la prueba no persiste datos.");
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
}

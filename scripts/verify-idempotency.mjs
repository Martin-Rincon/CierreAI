import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "cierreai-libsql-"));
const databaseFile = path.join(temporaryDirectory, "test.db").replaceAll("\\", "/");
process.env.TURSO_DATABASE_URL = `file:${databaseFile}`;
delete process.env.TURSO_AUTH_TOKEN;

const { closeDatabase, get, run, transaction } = await import("../lib/db.ts");

try {
  const cierre = await run("INSERT INTO cierres (fecha, efectivo_inicial) VALUES (?, 0)", ["2099-01-01"]);
  const cierreId = Number(cierre.lastInsertRowid);
  const submissionId = randomUUID();

  await transaction(async (tx) => {
    const sql = `INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga, submission_id)
      VALUES (?, 1, 'efectivo', '00:00', 'formulario', ?)
      ON CONFLICT(submission_id) WHERE submission_id IS NOT NULL DO NOTHING`;
    await run(sql, [cierreId, submissionId], tx);
    await run(sql, [cierreId, submissionId], tx);
  });

  const row = await get("SELECT COUNT(*) AS total FROM ventas WHERE submission_id = ?", [submissionId]);
  assert.equal(Number(row?.total), 1, "Dos envíos iguales deben crear una sola venta.");

  const rollbackId = randomUUID();
  await assert.rejects(transaction(async (tx) => {
    await run("INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga, submission_id) VALUES (?, 100, 'efectivo', '10:00', 'formulario', ?)", [cierreId, rollbackId], tx);
    await run("INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, -1, 'efectivo', '10:01', 'formulario')", [cierreId], tx);
  }), "Una violación de integridad debe abortar la transacción completa.");
  const rolledBack = await get("SELECT COUNT(*) AS total FROM ventas WHERE submission_id = ?", [rollbackId]);
  assert.equal(Number(rolledBack?.total), 0, "La transacción fallida no debe persistir escrituras parciales.");
  await closeDatabase();

  const reopened = createClient({ url: `file:${databaseFile}` });
  const persisted = await reopened.execute({ sql: "SELECT COUNT(*) AS total FROM ventas WHERE submission_id = ?", args: [submissionId] });
  assert.equal(Number(persisted.rows[0]?.total), 1, "La venta debe persistir después de cerrar y reabrir libSQL.");
  reopened.close();
  console.log("OK: idempotencia y persistencia libSQL local después de una reapertura.");
} finally {
  try {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EPERM")) throw error;
    // En Windows el binding nativo puede liberar el archivo recién al terminar el proceso.
  }
}

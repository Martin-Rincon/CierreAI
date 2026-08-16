import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const dataDirectory = path.join(process.cwd(), "data");
const databasePath = path.join(dataDirectory, "cierreai.db");

type DatabaseGlobal = typeof globalThis & {
  __cierreAiDatabase?: DatabaseSync;
};

function openDatabase(): DatabaseSync {
  fs.mkdirSync(dataDirectory, { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  return database;
}

const databaseGlobal = globalThis as DatabaseGlobal;
const database = databaseGlobal.__cierreAiDatabase ?? openDatabase();

if (process.env.NODE_ENV !== "production") {
  databaseGlobal.__cierreAiDatabase = database;
}

function migrate(): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS cierres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL UNIQUE,
      efectivo_inicial INTEGER NOT NULL CHECK (efectivo_inicial >= 0),
      efectivo_contado INTEGER CHECK (efectivo_contado >= 0),
      total_esperado INTEGER NOT NULL DEFAULT 0,
      total_registrado INTEGER NOT NULL DEFAULT 0,
      diferencia INTEGER NOT NULL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'conciliado', 'con_diferencia', 'resuelto'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cierre_id INTEGER NOT NULL REFERENCES cierres(id) ON DELETE CASCADE,
      monto INTEGER NOT NULL CHECK (monto > 0),
      medio_pago TEXT NOT NULL
        CHECK (medio_pago IN ('efectivo', 'transferencia', 'mercado_pago')),
      hora TEXT NOT NULL CHECK (hora GLOB '[0-2][0-9]:[0-5][0-9]'),
      conciliada INTEGER NOT NULL DEFAULT 0 CHECK (conciliada IN (0, 1)),
      metodo_carga TEXT NOT NULL
        CHECK (metodo_carga IN ('ia', 'formulario', 'csv'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS gastos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cierre_id INTEGER NOT NULL REFERENCES cierres(id) ON DELETE CASCADE,
      monto INTEGER NOT NULL CHECK (monto > 0),
      categoria TEXT NOT NULL,
      descripcion TEXT NOT NULL DEFAULT '',
      medio_pago TEXT NOT NULL
        CHECK (medio_pago IN ('efectivo', 'transferencia', 'mercado_pago')),
      hora TEXT NOT NULL CHECK (hora GLOB '[0-2][0-9]:[0-5][0-9]'),
      metodo_carga TEXT NOT NULL
        CHECK (metodo_carga IN ('ia', 'formulario', 'csv'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS movimientos_pago (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cierre_id INTEGER NOT NULL REFERENCES cierres(id) ON DELETE CASCADE,
      monto INTEGER NOT NULL CHECK (monto > 0),
      medio_pago TEXT NOT NULL
        CHECK (medio_pago IN ('efectivo', 'transferencia', 'mercado_pago')),
      hora TEXT NOT NULL CHECK (hora GLOB '[0-2][0-9]:[0-5][0-9]'),
      conciliado INTEGER NOT NULL DEFAULT 0 CHECK (conciliado IN (0, 1)),
      metodo_carga TEXT NOT NULL
        CHECK (metodo_carga IN ('ia', 'formulario', 'csv'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS causas_candidatas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cierre_id INTEGER NOT NULL REFERENCES cierres(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK (
        tipo IN ('venta_sin_pago', 'pago_sin_venta', 'diferencia_efectivo', 'gasto_sospechoso')
      ),
      referencia_tipo TEXT CHECK (
        referencia_tipo IS NULL OR referencia_tipo IN ('venta', 'movimiento_pago')
      ),
      referencia_id INTEGER,
      monto INTEGER NOT NULL CHECK (monto >= 0),
      tipo_match TEXT NOT NULL,
      explicacion_ia TEXT,
      estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'confirmada', 'descartada'))
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_ventas_cierre_medio
      ON ventas(cierre_id, medio_pago, hora);
    CREATE INDEX IF NOT EXISTS idx_gastos_cierre_medio
      ON gastos(cierre_id, medio_pago, hora);
    CREATE INDEX IF NOT EXISTS idx_movimientos_cierre_medio
      ON movimientos_pago(cierre_id, medio_pago, hora);
    CREATE INDEX IF NOT EXISTS idx_causas_cierre
      ON causas_candidatas(cierre_id, estado);
  `);
}

function localDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function seedIfEmpty(): void {
  const row = database.prepare("SELECT COUNT(*) AS total FROM cierres").get() as {
    total: number;
  };

  if (row.total > 0) return;

  database.exec("BEGIN IMMEDIATE;");
  try {
    const cierreResult = database
      .prepare(`
        INSERT INTO cierres (
          fecha, efectivo_inicial, efectivo_contado,
          total_esperado, total_registrado, diferencia, estado
        ) VALUES (?, 2000000, 3050000, 6830000, 5580000, -1250000, 'con_diferencia')
      `)
      .run(localDate());
    const cierreId = Number(cierreResult.lastInsertRowid);

    const insertVenta = database.prepare(`
      INSERT INTO ventas (cierre_id, monto, medio_pago, hora, conciliada, metodo_carga)
      VALUES (?, ?, ?, ?, 0, 'formulario')
    `);
    insertVenta.run(cierreId, 850000, "efectivo", "10:00");
    insertVenta.run(cierreId, 1250000, "mercado_pago", "11:15");
    insertVenta.run(cierreId, 1600000, "transferencia", "13:20");
    insertVenta.run(cierreId, 700000, "efectivo", "15:00");
    insertVenta.run(cierreId, 930000, "mercado_pago", "16:45");

    database
      .prepare(`
        INSERT INTO gastos (
          cierre_id, monto, categoria, descripcion, medio_pago, hora, metodo_carga
        ) VALUES (?, 500000, 'Flete', 'Flete del día', 'efectivo', '14:00', 'formulario')
      `)
      .run(cierreId);

    const insertMovimiento = database.prepare(`
      INSERT INTO movimientos_pago (
        cierre_id, monto, medio_pago, hora, conciliado, metodo_carga
      ) VALUES (?, ?, ?, ?, 0, 'formulario')
    `);
    insertMovimiento.run(cierreId, 1600000, "transferencia", "13:22");
    insertMovimiento.run(cierreId, 930000, "mercado_pago", "16:46");

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

migrate();
seedIfEmpty();

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return database.prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return database.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return database.prepare(sql).run(...params);
}

export { databasePath };

import { all, get, run } from "@/lib/db";
import type {
  Cierre,
  EstadoCierre,
  MedioPago,
  MovimientoDia,
  ResumenCierre,
} from "@/lib/types";

interface CierreRow {
  id: number;
  fecha: string;
  efectivo_inicial: number;
  efectivo_contado: number | null;
  total_esperado: number;
  total_registrado: number;
  diferencia: number;
  estado: EstadoCierre;
}

interface TotalesRow {
  ventas_efectivo: number;
  ventas_transferencia: number;
  ventas_mercado_pago: number;
  gastos_efectivo: number;
  gastos_transferencia: number;
  gastos_mercado_pago: number;
  pagos_transferencia: number;
  pagos_mercado_pago: number;
  cantidad_ventas: number;
  cantidad_gastos: number;
  cantidad_pagos: number;
}

interface MovimientoRow {
  id: number;
  tipo: "venta" | "gasto" | "pago";
  monto: number;
  medio_pago: MedioPago;
  hora: string;
  detalle: string;
}

function fechaLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function obtenerOCrearCierreActual(): CierreRow {
  const fecha = fechaLocal();
  let cierre = get<CierreRow>("SELECT * FROM cierres WHERE fecha = ?", fecha);
  if (!cierre) {
    run("INSERT INTO cierres (fecha, efectivo_inicial) VALUES (?, 0)", fecha);
    cierre = get<CierreRow>("SELECT * FROM cierres WHERE fecha = ?", fecha);
  }
  if (!cierre) throw new Error("No se pudo crear el cierre del día actual.");
  return cierre;
}

export function obtenerResumenCierreActual(): ResumenCierre {
  const row = obtenerOCrearCierreActual();

  const totales = get<TotalesRow>(
    `
      SELECT
        COALESCE((SELECT SUM(monto) FROM ventas WHERE cierre_id = ? AND medio_pago = 'efectivo'), 0) AS ventas_efectivo,
        COALESCE((SELECT SUM(monto) FROM ventas WHERE cierre_id = ? AND medio_pago = 'transferencia'), 0) AS ventas_transferencia,
        COALESCE((SELECT SUM(monto) FROM ventas WHERE cierre_id = ? AND medio_pago = 'mercado_pago'), 0) AS ventas_mercado_pago,
        COALESCE((SELECT SUM(monto) FROM gastos WHERE cierre_id = ? AND medio_pago = 'efectivo'), 0) AS gastos_efectivo,
        COALESCE((SELECT SUM(monto) FROM gastos WHERE cierre_id = ? AND medio_pago = 'transferencia'), 0) AS gastos_transferencia,
        COALESCE((SELECT SUM(monto) FROM gastos WHERE cierre_id = ? AND medio_pago = 'mercado_pago'), 0) AS gastos_mercado_pago,
        COALESCE((SELECT SUM(monto) FROM movimientos_pago WHERE cierre_id = ? AND medio_pago = 'transferencia'), 0) AS pagos_transferencia,
        COALESCE((SELECT SUM(monto) FROM movimientos_pago WHERE cierre_id = ? AND medio_pago = 'mercado_pago'), 0) AS pagos_mercado_pago,
        (SELECT COUNT(*) FROM ventas WHERE cierre_id = ?) AS cantidad_ventas,
        (SELECT COUNT(*) FROM gastos WHERE cierre_id = ?) AS cantidad_gastos,
        (SELECT COUNT(*) FROM movimientos_pago WHERE cierre_id = ?) AS cantidad_pagos
    `,
    row.id,
    row.id,
    row.id,
    row.id,
    row.id,
    row.id,
    row.id,
    row.id,
    row.id,
    row.id,
    row.id,
  );

  if (!totales) throw new Error("No se pudieron calcular los totales del cierre.");

  const cierre: Cierre = {
    id: row.id,
    fecha: row.fecha,
    efectivoInicial: row.efectivo_inicial,
    efectivoContado: row.efectivo_contado,
    totalEsperado: row.total_esperado,
    totalRegistrado: row.total_registrado,
    diferencia: row.diferencia,
    estado: row.estado,
  };

  const efectivoEsperado =
    cierre.efectivoInicial + totales.ventas_efectivo - totales.gastos_efectivo;
  const valores: Record<MedioPago, [number, number]> = {
    efectivo: [efectivoEsperado, cierre.efectivoContado ?? 0],
    transferencia: [totales.ventas_transferencia - totales.gastos_transferencia, totales.pagos_transferencia],
    mercado_pago: [totales.ventas_mercado_pago - totales.gastos_mercado_pago, totales.pagos_mercado_pago],
  };

  return {
    cierre,
    desglose: (Object.entries(valores) as [MedioPago, [number, number]][]).map(
      ([medio, [esperado, registrado]]) => ({
        medio,
        esperado,
        registrado,
        diferencia: registrado - esperado,
      }),
    ),
    cantidadVentas: totales.cantidad_ventas,
    cantidadGastos: totales.cantidad_gastos,
    cantidadMovimientosPago: totales.cantidad_pagos,
    tieneMovimientos:
      totales.cantidad_ventas + totales.cantidad_gastos + totales.cantidad_pagos > 0,
  };
}

export function obtenerMovimientosDelDia(cierreId: number): MovimientoDia[] {
  const rows = all<MovimientoRow>(
    `SELECT id, 'venta' AS tipo, monto, medio_pago, hora, 'Venta' AS detalle
       FROM ventas WHERE cierre_id = ?
     UNION ALL
     SELECT id, 'gasto', monto, medio_pago, hora,
       CASE WHEN descripcion = '' THEN categoria ELSE categoria || ' · ' || descripcion END
       FROM gastos WHERE cierre_id = ?
     UNION ALL
     SELECT id, 'pago', monto, medio_pago, hora, 'Pago recibido'
       FROM movimientos_pago WHERE cierre_id = ?
     ORDER BY hora DESC, id DESC`,
    cierreId, cierreId, cierreId,
  );
  return rows.map((row) => ({
    id: row.id, tipo: row.tipo, monto: row.monto, medioPago: row.medio_pago,
    hora: row.hora, detalle: row.detalle,
  }));
}

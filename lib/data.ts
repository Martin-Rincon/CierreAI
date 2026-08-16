import { get } from "@/lib/db";
import type {
  Cierre,
  EstadoCierre,
  MedioPago,
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
  pagos_transferencia: number;
  pagos_mercado_pago: number;
  cantidad_ventas: number;
  cantidad_gastos: number;
  cantidad_pagos: number;
}

function fechaLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function obtenerResumenCierreActual(): ResumenCierre {
  const row = get<CierreRow>("SELECT * FROM cierres WHERE fecha = ?", fechaLocal());

  if (!row) {
    throw new Error("No se encontró el cierre del día actual.");
  }

  const totales = get<TotalesRow>(
    `
      SELECT
        COALESCE((SELECT SUM(monto) FROM ventas WHERE cierre_id = ? AND medio_pago = 'efectivo'), 0) AS ventas_efectivo,
        COALESCE((SELECT SUM(monto) FROM ventas WHERE cierre_id = ? AND medio_pago = 'transferencia'), 0) AS ventas_transferencia,
        COALESCE((SELECT SUM(monto) FROM ventas WHERE cierre_id = ? AND medio_pago = 'mercado_pago'), 0) AS ventas_mercado_pago,
        COALESCE((SELECT SUM(monto) FROM gastos WHERE cierre_id = ? AND medio_pago = 'efectivo'), 0) AS gastos_efectivo,
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
    transferencia: [totales.ventas_transferencia, totales.pagos_transferencia],
    mercado_pago: [totales.ventas_mercado_pago, totales.pagos_mercado_pago],
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

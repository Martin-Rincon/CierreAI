export const MEDIOS_PAGO = [
  "efectivo",
  "transferencia",
  "mercado_pago",
] as const;

export type MedioPago = (typeof MEDIOS_PAGO)[number];
export type MetodoCarga = "ia" | "formulario" | "csv";
export type EstadoCierre =
  | "pendiente"
  | "conciliado"
  | "con_diferencia"
  | "resuelto";

export interface Cierre {
  id: number;
  fecha: string;
  efectivoInicial: number;
  efectivoContado: number | null;
  totalEsperado: number;
  totalRegistrado: number;
  diferencia: number;
  estado: EstadoCierre;
}

export interface ResumenMedio {
  medio: MedioPago;
  esperado: number;
  registrado: number;
  diferencia: number;
}

export interface ResumenCierre {
  cierre: Cierre;
  desglose: ResumenMedio[];
  cantidadVentas: number;
  cantidadGastos: number;
  cantidadMovimientosPago: number;
  tieneMovimientos: boolean;
}

export type TipoMovimiento = "venta" | "gasto" | "pago";

export interface MovimientoDia {
  id: number;
  tipo: TipoMovimiento;
  monto: number;
  medioPago: MedioPago;
  hora: string;
  detalle: string;
}

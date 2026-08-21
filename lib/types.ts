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
  finalizadoAt: string | null;
}

export interface CierreListado {
  fecha: string;
  estado: EstadoCierre;
  finalizadoAt: string | null;
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

export type EstadoCausa = "pendiente" | "confirmada" | "descartada";

export interface CausaCandidataVista {
  id: number;
  tipo: "venta_sin_pago" | "pago_sin_venta" | "diferencia_efectivo";
  referenciaTipo: "venta" | "movimiento_pago" | null;
  referenciaId: number | null;
  monto: number;
  efecto: number;
  estado: EstadoCausa;
  medioPago: MedioPago | null;
  hora: string | null;
  esPrincipal: boolean;
  explicacionExacta: boolean;
  efectivoEsperado: number | null;
  efectivoContado: number | null;
  explicacionIa: string | null;
}

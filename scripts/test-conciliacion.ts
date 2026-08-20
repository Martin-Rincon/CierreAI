import assert from "node:assert/strict";
import { conciliarCierre, determinarEstadoCierre, type EntradaConciliacion } from "../lib/conciliacion.ts";

const base: EntradaConciliacion = { cierreId: 1, efectivoInicial: 0, efectivoContado: 0, ventas: [], gastos: [], movimientosPago: [] };
const venta = (id: number, monto: number, hora = "10:00", medioPago: "transferencia" | "mercado_pago" | "efectivo" = "transferencia") => ({ id, cierreId: 1, monto, hora, medioPago });
const pago = venta;

let resultado = conciliarCierre({ ...base, ventas: [venta(1, 100)], movimientosPago: [pago(10, 100, "10:02")] });
assert.deepEqual(resultado.matches.map((m) => [m.venta.id, m.movimiento.id]), [[1, 10]], "1. venta y pago deben conciliar");

resultado = conciliarCierre({ ...base, ventas: [venta(1, 100)] });
assert.equal(resultado.causasCandidatas[0]?.tipo, "venta_sin_pago", "2. debe detectar venta sin pago");

resultado = conciliarCierre({ ...base, movimientosPago: [pago(10, 100)] });
assert.equal(resultado.causasCandidatas[0]?.tipo, "pago_sin_venta", "3. debe detectar pago sin venta");

resultado = conciliarCierre({ ...base, ventas: [venta(1, 100), venta(2, 100)], movimientosPago: [pago(10, 100), pago(11, 100)] });
assert.equal(new Set(resultado.matches.map((m) => m.movimiento.id)).size, 2, "4. cada pago debe usarse una sola vez");

resultado = conciliarCierre({ ...base, ventas: [venta(1, 100, "10:00")], movimientosPago: [pago(10, 100, "09:30"), pago(11, 100, "10:05")] });
assert.equal(resultado.matches[0]?.movimiento.id, 11, "5. debe elegir la hora más cercana");

resultado = conciliarCierre({ ...base, ventas: [venta(1, 100, "10:00")], movimientosPago: [pago(12, 100, "10:10"), pago(11, 100, "09:50"), pago(10, 100, "09:50")] });
assert.equal(resultado.matches[0]?.movimiento.id, 10, "6. empate: hora más temprana y luego id menor");

resultado = conciliarCierre({ ...base, efectivoInicial: 1000, efectivoContado: 1300, ventas: [venta(1, 500, "10:00", "efectivo")], gastos: [venta(2, 100, "11:00", "efectivo")] });
assert.equal(resultado.diferenciaEfectivo, -100, "7. debe calcular diferencia de efectivo");
assert.equal(resultado.causasCandidatas[0]?.tipo, "diferencia_efectivo");

const entrada = { ...base, ventas: [venta(1, 12500, "11:15", "mercado_pago")] };
assert.deepEqual(conciliarCierre(entrada), conciliarCierre(entrada), "8. dos ejecuciones deben ser idénticas y no duplicar causas");
assert.equal(conciliarCierre(entrada).causasCandidatas.length, 1);

assert.notDeepEqual(conciliarCierre(entrada), conciliarCierre({ ...entrada, movimientosPago: [pago(10, 12500, "11:16", "mercado_pago")] }), "9. cambiar la entrada debe cambiar el resultado");

assert.equal(determinarEstadoCierre(-7500, [-12500, 5000]), "resuelto", "Caso A: efectos opuestos explican -7500");
assert.equal(determinarEstadoCierre(-12500, [-12500]), "resuelto", "Caso B: venta sin pago explica -12500");
assert.equal(determinarEstadoCierre(-12500, [-5000]), "con_diferencia", "Caso C: explicación parcial no resuelve");
assert.equal(determinarEstadoCierre(5000, [5000]), "resuelto", "Caso D: pago sin venta explica +5000");

const efectivoConSobrante = conciliarCierre({ ...base, efectivoInicial: 25500, efectivoContado: 30500 });
assert.equal(efectivoConSobrante.causasCandidatas[0]?.efecto, 5000, "La diferencia de efectivo conserva su signo positivo");
assert.equal(conciliarCierre(entrada).causasCandidatas[0]?.efecto, -12500, "La venta sin pago conserva su efecto negativo");

console.log("OK: motor determinístico y 4 casos de resolución firmada superados.");

const demo = conciliarCierre({
  cierreId: 5, efectivoInicial: 0, efectivoContado: 2_550_000,
  ventas: [
    { id: 1, cierreId: 5, monto: 3_050_000, medioPago: "efectivo", hora: "10:00" },
    { id: 2, cierreId: 5, monto: 1_600_000, medioPago: "transferencia", hora: "11:00" },
    { id: 3, cierreId: 5, monto: 930_000, medioPago: "mercado_pago", hora: "12:00" },
    { id: 4, cierreId: 5, monto: 1_250_000, medioPago: "mercado_pago", hora: "13:00" },
  ],
  gastos: [{ id: 5, cierreId: 5, monto: 500_000, medioPago: "efectivo", hora: "10:30" }],
  movimientosPago: [
    { id: 6, cierreId: 5, monto: 1_600_000, medioPago: "transferencia", hora: "11:02" },
    { id: 7, cierreId: 5, monto: 930_000, medioPago: "mercado_pago", hora: "12:02" },
  ],
});
assert.equal(demo.diferenciaEfectivo, 0, "Demo: el efectivo debe conciliar");
assert.equal(demo.matches.length, 2, "Demo: transferencia y Mercado Pago deben conciliar");
assert.deepEqual(demo.causasCandidatas.map(({ tipo, monto, efecto }) => ({ tipo, monto, efecto })), [
  { tipo: "venta_sin_pago", monto: 1_250_000, efecto: -1_250_000 },
], "Demo: solo la venta de $12.500 debe quedar sin pago");
assert.equal(determinarEstadoCierre(-1_250_000, [demo.causasCandidatas[0].efecto]), "resuelto");
console.log("OK: escenario demo procesado por el motor normal con diferencia -$12.500.");

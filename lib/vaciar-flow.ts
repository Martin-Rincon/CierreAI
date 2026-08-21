export interface ControlVaciado {
  enCurso: boolean;
}

export async function coordinarVaciado<T>(
  control: ControlVaciado,
  operacion: () => Promise<T>,
  completar: (resultado: T) => void,
  fallar: (error: unknown) => void,
): Promise<void> {
  if (control.enCurso) return;
  control.enCurso = true;
  try {
    const resultado = await operacion();
    control.enCurso = false;
    completar(resultado);
  } catch (error) {
    control.enCurso = false;
    fallar(error);
  }
}

/*
 * Resolución de render: el lienzo del juego puede tener menos píxeles que la
 * vista (la calidad adaptativa de motor.ts lo achica en teléfonos que no dan
 * abasto). Se dibuja igual en píxeles virtuales, con una escala de base en el
 * contexto; lo que recorta por pantalla pregunta aquí el tamaño de la vista
 * en vez de leer `canvas.width`.
 */

/** Tamaño de la vista (píxeles virtuales) de cada lienzo escalado. */
const vistas = new WeakMap<object, { w: number; h: number }>();

/** El lienzo `c` muestra una vista de `w`×`h` píxeles virtuales (los que no se registran van 1:1). */
export function fijarVista(c: object, w: number, h: number): void {
  const v = vistas.get(c);
  if (v) {
    v.w = w;
    v.h = h;
  } else vistas.set(c, { w, h });
}

/** Ancho de la vista en píxeles virtuales. */
export function anchoVista(g: CanvasRenderingContext2D): number {
  return vistas.get(g.canvas)?.w ?? g.canvas.width;
}

/** Alto de la vista en píxeles virtuales. */
export function altoVista(g: CanvasRenderingContext2D): number {
  return vistas.get(g.canvas)?.h ?? g.canvas.height;
}

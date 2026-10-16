// Señales baratas para decidir cuánto adorno puede pagar el equipo de la visita.

type NavExtra = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
};

function nav(): NavExtra | null {
  return typeof navigator === 'undefined' ? null : (navigator as NavExtra);
}

/** Pocos núcleos o poca memoria: teléfonos de gama media/baja y notebooks viejos. */
export function isModestDevice(): boolean {
  const n = nav();
  if (!n) return false;
  const cores = n.hardwareConcurrency ?? 8;
  const memory = n.deviceMemory ?? 8;
  return cores <= 4 || memory <= 4 || isSlowConnection();
}

/** Ahorro de datos activado o red 2G/3G: no vale la pena bajar videos de 14 MB. */
export function isSlowConnection(): boolean {
  const c = nav()?.connection;
  if (!c) return false;
  return !!c.saveData || /(^|-)(2g|3g)$/.test(c.effectiveType ?? '');
}

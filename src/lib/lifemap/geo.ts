// Small spherical helpers for the life map: distances, great-circle arcs, and
// slicing a polyline to a fraction of its length (how trails "ink in").

export type LngLat = [number, number];

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function km(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The great-circle route from a to b as a polyline. Short hops stay straight;
 * long ones (an ocean crossing, Quebec to Wisconsin) get enough points to bow
 * along the curve of the earth, on the globe and on the flat map alike.
 */
export function arc(a: LngLat, b: LngLat): LngLat[] {
  const d = km(a, b);
  if (d < 60) return [a, b];
  const n = Math.min(96, Math.max(8, Math.ceil(d / 70)));
  const [l1, p1] = [rad(a[0]), rad(a[1])];
  const [l2, p2] = [rad(b[0]), rad(b[1])];
  const delta = d / R_KM;
  const out: LngLat[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * delta) / Math.sin(delta);
    const B = Math.sin(f * delta) / Math.sin(delta);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    out.push([deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  out[0] = a;
  out[n] = b;
  return out;
}

/** Cumulative lengths along a polyline, in km, starting at 0. */
export function cumulative(line: LngLat[]): number[] {
  const acc = [0];
  for (let i = 1; i < line.length; i++) acc.push(acc[i - 1] + km(line[i - 1], line[i]));
  return acc;
}

/** The point a fraction t (0..1) of the way along a polyline. */
export function along(line: LngLat[], cum: number[], t: number): LngLat {
  if (t <= 0 || line.length < 2) return line[0];
  const total = cum[cum.length - 1];
  if (t >= 1 || total === 0) return line[line.length - 1];
  const target = total * t;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < target) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const f = (target - cum[i - 1]) / seg;
  const a = line[i - 1];
  const b = line[i];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** The first fraction t of a polyline: the part the pen has drawn so far. */
export function slice(line: LngLat[], cum: number[], t: number): LngLat[] {
  if (t >= 1) return line;
  if (t <= 0) return [line[0], line[0]];
  const total = cum[cum.length - 1];
  const target = total * t;
  const out: LngLat[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    if (cum[i] < target) {
      out.push(line[i]);
      continue;
    }
    out.push(along(line, cum, t));
    break;
  }
  return out.length > 1 ? out : [line[0], line[0]];
}

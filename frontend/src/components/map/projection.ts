/** Проєкції карти неба (UC-02 AC2) та допоміжні обчислення області перегляду */
import { TILE_DEC, TILE_RA, tileId } from "@/context/tiles";

export type Projection = "equirect" | "stereo";

export interface EqView {
  ra0: number; // центр, градуси
  dec0: number;
  scale: number; // пікселів на градус у центрі
  proj: Projection;
}

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

export const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
export const wrap360 = (a: number) => ((a % 360) + 360) % 360;

/** Початковий масштаб заповнює область карти (RA повторюється по колу) */
export const baseScale = (w: number, h: number) => Math.max(1e-3, Math.max(w / 360, h / 180));

export function startView(w: number, h: number, proj: Projection = "equirect"): EqView {
  return { ra0: 180, dec0: 0, scale: baseScale(w, h), proj };
}

export interface Pt {
  x: number;
  y: number;
  ok: boolean;
}

/** Небесні координати → пікселі. RA зростає ліворуч, як на зоряних картах */
export function project(v: EqView, w: number, h: number, ra: number, dec: number): Pt {
  if (v.proj === "equirect") {
    const dra = wrap180(ra - v.ra0);
    return { x: w / 2 - dra * v.scale, y: h / 2 - (dec - v.dec0) * v.scale, ok: true };
  }
  const d0 = v.dec0 * D2R;
  const d = dec * D2R;
  const dra = (ra - v.ra0) * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(dra);
  if (cosc < -0.2) return { x: 0, y: 0, ok: false };
  const k = 2 / (1 + cosc);
  const X = k * Math.cos(d) * Math.sin(dra);
  const Y = k * (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(dra));
  const s = v.scale * R2D;
  return { x: w / 2 - X * s, y: h / 2 - Y * s, ok: true };
}

/** Пікселі → небесні координати */
export function unproject(v: EqView, w: number, h: number, x: number, y: number): { ra: number; dec: number } {
  if (v.proj === "equirect") {
    return {
      ra: wrap360(v.ra0 - (x - w / 2) / v.scale),
      dec: Math.max(-90, Math.min(90, v.dec0 - (y - h / 2) / v.scale)),
    };
  }
  const s = v.scale * R2D;
  const X = -(x - w / 2) / s;
  const Y = -(y - h / 2) / s;
  const rho = Math.hypot(X, Y);
  if (rho < 1e-9) return { ra: v.ra0, dec: v.dec0 };
  const c = 2 * Math.atan(rho / 2);
  const d0 = v.dec0 * D2R;
  const dec = Math.asin(Math.cos(c) * Math.sin(d0) + (Y * Math.sin(c) * Math.cos(d0)) / rho) * R2D;
  const ra = v.ra0 + Math.atan2(X * Math.sin(c), rho * Math.cos(d0) * Math.cos(c) - Y * Math.sin(d0) * Math.sin(c)) * R2D;
  return { ra: wrap360(ra), dec };
}

/** Горизонтальна (азимутальна) проєкція: зеніт у центрі, північ угорі, схід ліворуч */
export function projectHorizon(alt: number, az: number, w: number, h: number, R: number): Pt {
  const r = ((90 - alt) / 90) * R;
  const a = az * D2R;
  return { x: w / 2 - r * Math.sin(a), y: h / 2 - r * Math.cos(a), ok: alt > 0 };
}

export function horizonRadius(w: number, h: number) {
  return Math.max(10, Math.min(w, h) / 2 - 28);
}

export function clampView(v: EqView, w: number, h: number): EqView {
  const minS = baseScale(w, h);
  const scale = Math.min(minS * 60, Math.max(minS, v.scale));
  let dec0 = Math.max(-90, Math.min(90, v.dec0));
  if (v.proj === "equirect") {
    // верх і низ неба не виходять за межі вікна: порожніх смуг немає
    const limit = Math.max(0, 90 - h / (2 * scale));
    dec0 = Math.max(-limit, Math.min(limit, dec0));
  }
  return { ...v, scale, ra0: wrap360(v.ra0), dec0 };
}


/** Масштабування з утриманням точки під курсором */
export function zoomAt(v: EqView, w: number, h: number, factor: number, px: number, py: number): EqView {
  const before = unproject(v, w, h, px, py);
  const nv = clampView({ ...v, scale: v.scale * factor }, w, h);
  const after = unproject(nv, w, h, px, py);
  return clampView({ ...nv, ra0: nv.ra0 + wrap180(before.ra - after.ra), dec0: nv.dec0 + (before.dec - after.dec) }, w, h);
}

export function pan(v: EqView, dx: number, dy: number): EqView {
  const cosd = v.proj === "stereo" ? Math.max(0.15, Math.cos(v.dec0 * D2R)) : 1;
  return { ...v, ra0: wrap360(v.ra0 + dx / v.scale / cosd), dec0: Math.max(-90, Math.min(90, v.dec0 + dy / v.scale)) };
}

/** Тайли каталогу, що потрапляють в область перегляду (для догрузки слабких зір) */
export function tilesInView(v: EqView, w: number, h: number): string[] {
  const ids = new Set<string>();
  const N = 14;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const p = unproject(v, w, h, (w * i) / N, (h * j) / N);
      if (Number.isNaN(p.ra) || Number.isNaN(p.dec)) continue;
      const ti = Math.min(11, Math.floor(wrap360(p.ra) / TILE_RA));
      const tj = Math.min(5, Math.floor((p.dec + 90) / TILE_DEC));
      ids.add(tileId(ti, tj));
    }
  }
  // Полюси в кадрі — вся смуга схилень
  const top = unproject(v, w, h, w / 2, 0).dec;
  const bottom = unproject(v, w, h, w / 2, h).dec;
  for (const [dec, tj] of [[top, 5], [bottom, 0]] as const) {
    if (Math.abs(dec) > 75) for (let ti = 0; ti < 12; ti++) ids.add(tileId(ti, tj));
  }
  return [...ids];
}

export const ALL_TILES = Array.from({ length: 72 }, (_, k) => tileId(k % 12, Math.floor(k / 12)));

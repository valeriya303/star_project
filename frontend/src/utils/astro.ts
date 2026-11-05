import * as Astronomy from "astronomy-engine";

/** Місце спостереження. Координати тримаються лише в пам'яті сеансу (DS-5) */
export interface Place {
  lat: number;
  lon: number;
  name: string;
  source: "lviv" | "manual" | "device";
}

/** Львів за замовчуванням (UC-07, крок 2) */
export const LVIV: Place = { lat: 49.8397, lon: 24.0297, name: "Львів", source: "lviv" };
export const LVIV_TZ = "Europe/Kyiv";

const D2R = Math.PI / 180;

/** Місцевий зоряний час, градуси (клієнт — astronomy-engine, AR-1) */
export function lstDeg(date: Date, lon: number): number {
  const gast = Astronomy.SiderealTime(date); // години
  return (((gast * 15 + lon) % 360) + 360) % 360;
}

/** Горизонтальні координати: висота й азимут (від півночі через схід), градуси */
export function altAz(ra: number, dec: number, lat: number, lst: number) {
  const h = (lst - ra) * D2R;
  const phi = lat * D2R;
  const d = dec * D2R;
  const sinAlt = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(h);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / D2R;
  const az =
    (Math.atan2(-Math.sin(h) * Math.cos(d), Math.sin(d) * Math.cos(phi) - Math.cos(d) * Math.sin(phi) * Math.cos(h)) / D2R +
      360) % 360;
  return { alt, az };
}

export function quickVisibility(ra: number, dec: number, date: Date, place: Place) {
  const { alt, az } = altAz(ra, dec, place.lat, lstDeg(date, place.lon));
  const maxAlt = 90 - Math.abs(place.lat - dec);
  return { alt, az, above: alt > 0, neverRises: maxAlt < 0, circumpolar: Math.abs(dec) > 90 - Math.abs(place.lat) && Math.sign(dec) === Math.sign(place.lat) };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatRA(deg: number): string {
  const totalSec = Math.round((((deg % 360) + 360) % 360) / 15 * 3600);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h % 24)}h ${pad(m)}m ${pad(s)}s`;
}

export function formatDec(deg: number): string {
  const sign = deg < 0 ? "−" : "+";
  const total = Math.round(Math.abs(deg) * 3600);
  const d = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${sign}${pad(d)}° ${pad(m)}′ ${pad(s)}″`;
}

export function formatPlace(p: Place): string {
  const lat = `${Math.abs(p.lat).toFixed(4).replace(".", ",")}° ${p.lat >= 0 ? "пн. ш." : "пд. ш."}`;
  const lon = `${Math.abs(p.lon).toFixed(4).replace(".", ",")}° ${p.lon >= 0 ? "сх. д." : "зх. д."}`;
  return `${p.name} (${lat}, ${lon})`;
}

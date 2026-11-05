import type { Filters } from "@/types/filters";
import { FAST_PM_MAS } from "@/types/filters";
import type { Star } from "@/types/star";
import { parseNum } from "./format";
import type { ServerFilter } from "@/api/endpoints";

export const pmTotal = (s: Star) => (s.pmRa != null && s.pmDec != null ? Math.hypot(s.pmRa, s.pmDec) : null);

export interface FilterErrors {
  vmag?: string;
  dist?: string;
  bv?: string;
  pm?: string;
}

function range(minS: string, maxS: string, name: keyof FilterErrors, errors: FilterErrors, nonNeg = false) {
  const lo = parseNum(minS);
  const hi = parseNum(maxS);
  if (lo === undefined || hi === undefined) errors[name] = "Введіть число";
  else if (nonNeg && ((lo !== null && lo < 0) || (hi !== null && hi < 0))) errors[name] = "Значення не може бути від'ємним";
  else if (lo !== null && hi !== null && lo > hi) errors[name] = "Нижня межа перевищує верхню";
  return [lo ?? null, hi ?? null] as const;
}

/** Перевірка діапазонів (UC-04 EX3) */
export function validateFilters(f: Filters): FilterErrors {
  const errors: FilterErrors = {};
  if (f.vmagMin > f.vmagMax) errors.vmag = "Нижня межа перевищує верхню";
  range(f.distMin, f.distMax, "dist", errors, true);
  range(f.bvMin, f.bvMax, "bv", errors);
  range(f.pmMin, f.pmMax, "pm", errors, true);
  return errors;
}

export interface FilterResult {
  stars: Star[];
  excludedNoDistance: number;
}

/** Відбір зір, що одночасно задовольняють усі активні умови (UC-04 AC1) */
export function filterStars(stars: Star[], f: Filters): FilterResult {
  const [dLo, dHi] = [parseNum(f.distMin) ?? null, parseNum(f.distMax) ?? null];
  const [bLo, bHi] = [parseNum(f.bvMin) ?? null, parseNum(f.bvMax) ?? null];
  let pLo = parseNum(f.pmMin) ?? null;
  const pHi = parseNum(f.pmMax) ?? null;
  if (f.fastOnly) pLo = Math.max(pLo ?? 0, FAST_PM_MAS);
  const distActive = dLo !== null || dHi !== null;
  const classes = f.classes.length ? new Set<string>(f.classes) : null;
  let excluded = 0;
  const out: Star[] = [];
  for (const s of stars) {
    if (s.vmag < f.vmagMin || s.vmag > f.vmagMax) continue;
    if (classes && (!s.sp || !classes.has(s.sp))) continue;
    if (bLo !== null || bHi !== null) {
      if (s.bv == null || (bLo !== null && s.bv < bLo) || (bHi !== null && s.bv > bHi)) continue;
    }
    if (pLo !== null || pHi !== null) {
      const pm = pmTotal(s);
      if (pm == null || (pLo !== null && pm < pLo) || (pHi !== null && pm > pHi)) continue;
    }
    if (distActive) {
      // EX2: невідома відстань не прирівнюється до нуля — запис виключається й рахується
      if (s.distLy == null) {
        excluded++;
        continue;
      }
      if ((dLo !== null && s.distLy < dLo) || (dHi !== null && s.distLy > dHi)) continue;
    }
    out.push(s);
  }
  return { stars: out, excludedNoDistance: excluded };
}

/** Ті самі умови для серверного підрахунку по всьому каталогу */
export function toServerFilter(f: Filters): ServerFilter {
  const n = (s: string) => parseNum(s) ?? undefined;
  let pmMin = n(f.pmMin);
  if (f.fastOnly) pmMin = Math.max(pmMin ?? 0, FAST_PM_MAS);
  return {
    vmag_min: f.vmagMin, vmag_max: f.vmagMax, dist_min_ly: n(f.distMin), dist_max_ly: n(f.distMax),
    classes: f.classes.join(",") || undefined, bv_min: n(f.bvMin), bv_max: n(f.bvMax), pm_min: pmMin, pm_max: n(f.pmMax),
  };
}

export function describeFilters(f: Filters): string[] {
  const out: string[] = [];
  const c = (x: number) => String(x).replace(".", ",");
  out.push(`Vmag ${c(f.vmagMin)} … ${c(f.vmagMax)}`);
  if (f.classes.length) out.push(`Клас ${f.classes.join(", ")}`);
  if (f.distMin || f.distMax) out.push(`Відстань ${f.distMin || "0"} … ${f.distMax || "∞"} св. р.`);
  if (f.bvMin || f.bvMax) out.push(`B–V ${f.bvMin || "−∞"} … ${f.bvMax || "∞"}`);
  if (f.pmMin || f.pmMax) out.push(`Власний рух ${f.pmMin || "0"} … ${f.pmMax || "∞"} мс/рік`);
  if (f.fastOnly) out.push(`Швидкі (≥ ${FAST_PM_MAS} мс/рік)`);
  return out;
}

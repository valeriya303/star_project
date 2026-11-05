/** Робота з місцевим часом у вибраному часовому поясі (UC-07 AC3, EX3) */

const pad = (n: number) => String(n).padStart(2, "0");

function partsIn(instant: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    second: "2-digit", hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(instant)) p[x.type] = x.value;
  return p;
}

/** Зсув часового поясу (хвилини) у заданий момент */
export function tzOffsetMinutes(instant: Date, tz: string): number {
  const p = partsIn(instant, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

export function formatOffset(min: number): string {
  const sign = min >= 0 ? "+" : "−";
  const a = Math.abs(min);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ":" + pad(a % 60) : ""}`;
}

export function nowIn(tz: string): { date: string; time: string } {
  const p = partsIn(new Date(), tz);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export type Resolved =
  | { kind: "ok"; instant: Date; offset: number }
  | { kind: "nonexistent" }
  | { kind: "ambiguous"; options: { instant: Date; offset: number; fold: 0 | 1 }[] }
  | { kind: "invalid" };

/** Перетворює місцеві дату й час у вибраному поясі на однозначний момент */
export function resolveLocal(date: string, time: string, tz: string): Resolved {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return { kind: "invalid" };
  const [y, mo, d] = [+dm[1], +dm[2], +dm[3]];
  const [h, mi] = [+tm[1], +tm[2]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return { kind: "invalid" };
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let offsets: number[];
  try {
    offsets = [...new Set([tzOffsetMinutes(new Date(guess - 86400000), tz), tzOffsetMinutes(new Date(guess + 86400000), tz),
      tzOffsetMinutes(new Date(guess), tz)])];
  } catch {
    return { kind: "invalid" };
  }
  const valid: { instant: Date; offset: number }[] = [];
  for (const off of offsets) {
    const inst = new Date(guess - off * 60000);
    const p = partsIn(inst, tz);
    if (+p.year === y && +p.month === mo && +p.day === d && +p.hour === h && +p.minute === mi && tzOffsetMinutes(inst, tz) === off) {
      if (!valid.some((v) => v.instant.getTime() === inst.getTime())) valid.push({ instant: inst, offset: off });
    }
  }
  if (valid.length === 0) return { kind: "nonexistent" };
  if (valid.length === 1) return { kind: "ok", ...valid[0] };
  valid.sort((a, b) => a.instant.getTime() - b.instant.getTime());
  return { kind: "ambiguous", options: valid.map((v, i) => ({ ...v, fold: i as 0 | 1 })) };
}

export function timezones(): string[] {
  try {
    const list = Intl.supportedValuesOf("timeZone");
    // Деякі браузери повертають застарілу назву Europe/Kiev
    return list.includes("Europe/Kyiv") ? list : ["Europe/Kyiv", ...list];
  } catch {
    return ["Europe/Kyiv", "UTC"];
  }
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("uk-UA");
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" });

const REGION_UK: Record<string, string> = {
  Europe: "Європа", America: "Америка", Asia: "Азія", Africa: "Африка", Australia: "Австралія",
  Pacific: "Тихий океан", Atlantic: "Атлантичний океан", Indian: "Індійський океан",
  Antarctica: "Антарктида", Arctic: "Арктика",
};

const POPULAR_TZ: Record<string, string> = {
  "Europe/Kyiv": "Україна",
  UTC: "Всесвітній час",
  "Europe/Warsaw": "Польща",
  "Europe/Berlin": "Німеччина",
  "Europe/London": "Велика Британія",
  "America/New_York": "США, східне узбережжя",
  "Asia/Tokyo": "Японія",
};

/** Часові пояси для списку: популярні вгорі, решта за регіонами, зі зсувом від UTC на поточний момент */
export function timezoneOptions(): { value: string; label: string; meta: string; hint?: string; group: string }[] {
  const now = new Date();
  const off = (tz: string) => {
    try {
      return formatOffset(tzOffsetMinutes(now, tz));
    } catch {
      return "";
    }
  };
  const all = timezones();
  const popular = Object.keys(POPULAR_TZ).filter((z) => z === "UTC" || all.includes(z));
  const rest = all
    .filter((z) => !popular.includes(z))
    .map((z) => ({ z, region: REGION_UK[z.split("/")[0]] ?? "Інші" }))
    .sort((a, b) => a.region.localeCompare(b.region, "uk") || a.z.localeCompare(b.z));
  return [
    ...popular.map((z) => ({ value: z, label: z.replace(/_/g, " "), meta: off(z), hint: POPULAR_TZ[z], group: "Найуживаніші" })),
    ...rest.map(({ z, region }) => ({ value: z, label: z.replace(/_/g, " "), meta: off(z), group: region })),
  ];
}

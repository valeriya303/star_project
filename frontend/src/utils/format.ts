/** Число з десятковою комою (укр. формат) */
export const fmt = (n: number, digits = 1) => n.toFixed(digits).replace(".", ",").replace("-", "−");

export const fmtInt = (n: number) => n.toLocaleString("uk-UA");

/** Розбір числа з комою або крапкою; "" → null; NaN → undefined */
export function parseNum(s: string): number | null | undefined {
  const t = s.trim().replace(",", ".").replace("−", "-");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export const MISSING = "Дані відсутні";

export const starTitle = (s: { name: string | null; hip: number }) => s.name ?? (s.hip > 0 ? `HIP ${s.hip}` : `№ ${-s.hip}`);

export const ROLE_LABELS: Record<string, string> = {
  GUEST: "Гість",
  OBSERVER: "Спостерігач",
  MODERATOR: "Модератор",
  DG_ADMIN: "DG Admin",
  SYSTEM: "Система",
};

export const BRIGHTNESS_SCALE = ["", "ледь помітна", "слабка", "помірна", "яскрава", "дуже яскрава"];
export const CONDITIONS_SCALE = ["", "дуже погані (хмарно)", "погані", "задовільні", "добрі", "відмінні (ясне темне небо)"];

export const LICENSE_LINKS: Record<string, string> = {
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
};

export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

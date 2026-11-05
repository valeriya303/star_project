/** Колір зорі для карти (F11). Сервер обчислює його під час імпорту за B–V (AD-05) */
export const NO_COLOR = 0xd9d9d9;

export const rgbToCss = (rgb: number) => `#${rgb.toString(16).padStart(6, "0")}`;

/** Легенда кольорів за показником B–V */
export const COLOR_LEGEND: { bv: string; label: string; color: string }[] = [
  { bv: "< 0", label: "блакитні (O, B)", color: "#a9c4ff" },
  { bv: "0…0,6", label: "білі (A, F)", color: "#f4f3ff" },
  { bv: "0,6…1,4", label: "жовті й помаранчеві (G, K)", color: "#ffd9a8" },
  { bv: "> 1,4", label: "червонуваті (M)", color: "#ffb36b" },
];

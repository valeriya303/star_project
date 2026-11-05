export type SpectralClass = "O" | "B" | "A" | "F" | "G" | "K" | "M";

export const SPECTRAL_CLASSES: SpectralClass[] = ["O", "B", "A", "F", "G", "K", "M"];

/** Поріг «швидкої зорі», мс дуги/рік */
export const FAST_PM_MAS = 500;

export const VMAG_LIMITS: [number, number] = [-2, 15];
/** Межа першого рівня даних: яскраві зорі завантажуються одразу (AD-06) */
export const BRIGHT_TIER_VMAG = 6.5;

/** Значення полів фільтра — рядки, щоб перевіряти введення (UC-04 EX3) */
export interface Filters {
  vmagMin: number;
  vmagMax: number;
  distMin: string; // св. р.; "" = без обмеження
  distMax: string;
  bvMin: string;
  bvMax: string;
  pmMin: string; // мс/рік
  pmMax: string;
  classes: SpectralClass[]; // порожній = усі
  fastOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  vmagMin: -2,
  vmagMax: 6.5,
  distMin: "",
  distMax: "",
  bvMin: "",
  bvMax: "",
  pmMin: "",
  pmMax: "",
  classes: [],
  fastOnly: false,
};

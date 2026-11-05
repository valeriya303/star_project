/** Зоря на карті (стовпцевий набір /stars/compact) */
export interface Star {
  hip: number;
  name: string | null;
  ra: number; // градуси 0–360 (ICRS)
  dec: number; // градуси −90…+90
  vmag: number;
  bv: number | null;
  pmRa: number | null; // μα*, мс дуги/рік
  pmDec: number | null;
  distLy: number | null;
  sp: string | null; // спектральний клас O…M
  color: number; // RGB, обчислено під час імпорту (AD-05)
  con: string | null; // скорочення сузір'я IAU
}

/** Короткий опис зорі з пошуку */
export interface StarSummary {
  hip: number;
  name: string | null;
  alt_names: string[];
  hd: number | null;
  ra: number;
  dec: number;
  vmag: number;
  bv: number | null;
  sp_type: string | null;
  constellation: string | null;
  constellation_uk: string | null;
  distance_deg?: number;
  pm_total?: number | null;
  unavailable?: boolean;
  /** Назва, за якою зорю знайдено (якщо вона іншою мовою, ніж основна) */
  matched_name?: string;
  matched_lang?: string;
  matched_lang_label?: string;
}

export interface Lineage {
  source: string;
  source_url: string;
  license: string;
  import_date: string;
  source_id: string;
  hip: number | null;
  origin?: string;
  source_version?: string;
  batch_id?: string;
  checksum_sha256?: string;
  profile?: string;
  transformations?: string[];
  quality_warnings?: string[];
}

export interface StarDetails extends StarSummary {
  bd: string | null;
  coordinate_system: string;
  epoch: string;
  vi: number | null;
  parallax_mas: number | null;
  parallax_error_mas: number | null;
  dist_pc: number | null;
  dist_ly: number | null;
  pm_ra: number | null;
  pm_dec: number | null;
  pm_total: number | null;
  tangential_velocity_kms: number | null;
  fast: boolean;
  sp_class: string | null;
  color_hex: string;
  missing: string[];
  lineage: Lineage;
}

export interface Constellation {
  id: string;
  abbr: string;
  name: string;
  latin: string;
  english: string;
  lines: [number, number][];
  description?: string;
  stars_count?: number;
}

export interface TimeRef {
  utc: string;
  local: string;
  label: string;
}

export interface VisibilityResult {
  hip: number;
  moment_local: string;
  moment_utc: string;
  timezone: string;
  location_source: string;
  place_label: string;
  altitude: number;
  azimuth: number;
  compass: string;
  above_horizon: boolean;
  case: "normal" | "circumpolar" | "never_rises";
  rise: TimeRef | null;
  transit: TimeRef | null;
  set: TimeRef | null;
  transit_altitude: number;
  text: string;
  disclaimer: string;
}

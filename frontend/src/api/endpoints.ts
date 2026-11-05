import { api } from "./client";
import type { Constellation, StarDetails, StarSummary, Lineage, VisibilityResult, Star } from "@/types/star";
import type {
  ConsentCode, ConsentRecord, ConsentText, JournalEntry, Photo, Profile, Reward, LevelInfo, StarList, Stats, User,
} from "@/types/userData";

export interface AuthResponse {
  token: string;
  user: User;
}

const qs = (p: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  return s.toString();
};

export const authApi = {
  register: (email: string, password: string) =>
    api<{ message: string; user: User }>("/auth/register", { method: "POST", json: { email, password } }),
  login: (email: string, password: string) =>
    api<AuthResponse>("/auth/login", { method: "POST", json: { email, password } }),
  logout: () => api<void>("/auth/logout", { method: "POST" }),
  me: () => api<User>("/auth/me"),
  forgotPassword: (email: string) => api<void>("/auth/forgot-password", { method: "POST", json: { email } }),
  resetPassword: (token: string, password: string) =>
    api<void>("/auth/reset-password", { method: "POST", json: { token, password } }),
};

export interface CompactColumns {
  hip: number[];
  ra: number[];
  dec: number[];
  vmag: number[];
  bv: (number | null)[];
  pm_ra: (number | null)[];
  pm_dec: (number | null)[];
  dist_ly: (number | null)[];
  sp: (string | null)[];
  color: number[];
  con: (string | null)[];
  name: (string | null)[];
}

export function columnsToStars(c: CompactColumns): Star[] {
  const out: Star[] = new Array(c.hip.length);
  for (let i = 0; i < c.hip.length; i++) {
    out[i] = {
      hip: c.hip[i], name: c.name[i], ra: c.ra[i], dec: c.dec[i], vmag: c.vmag[i], bv: c.bv[i],
      pmRa: c.pm_ra[i], pmDec: c.pm_dec[i], distLy: c.dist_ly[i], sp: c.sp[i], color: c.color[i], con: c.con[i],
    };
  }
  return out;
}

export interface ServerFilter {
  vmag_min?: number;
  vmag_max?: number;
  dist_min_ly?: number;
  dist_max_ly?: number;
  classes?: string;
  bv_min?: number;
  bv_max?: number;
  pm_min?: number;
  pm_max?: number;
}

export const starsApi = {
  compact: (p: { vmag_min?: number; vmag_max: number; ra_min?: number; ra_max?: number; dec_min?: number; dec_max?: number }) =>
    api<{ count: number; version_id: string; columns: CompactColumns }>(`/stars/compact?${qs(p)}`),
  count: (f: ServerFilter) =>
    api<{ count: number; excluded_no_distance: number; items: StarSummary[] }>(`/stars?${qs({ ...f, limit: 1 })}`),
  get: (hip: number) => api<StarDetails>(`/stars/${hip}`),
  lineage: (hip: number) => api<Lineage>(`/stars/${hip}/lineage`),
  /** Автодоповнення: назва, HIP/HD або «RA Dec» */
  search: (q: string, limit = 10) =>
    api<{ mode: string; items: StarSummary[] }>(`/stars/search?${qs({ q, limit })}`),
  byId: (catalog: "HIP" | "HD", id: string) => api<{ items: StarSummary[] }>(`/stars/by-id?${qs({ catalog, id })}`),
  cone: (ra: number, dec: number, radius: number, limit = 100) =>
    api<{ items: StarSummary[] }>(`/stars/cone?${qs({ ra, dec, radius, limit })}`),
  fast: (limit = 25) => api<{ threshold_mas: number; items: StarSummary[] }>(`/stars/fast?${qs({ limit })}`),
};

export interface VisibilityParams {
  hip: number;
  date: string;
  time: string;
  timezone: string;
  fold?: number | null;
  location_source: "lviv" | "manual" | "device";
  latitude?: number;
  longitude?: number;
  guest_consent?: boolean;
}

export const skyApi = {
  constellations: () => api<Constellation[]>("/constellations"),
  constellation: (abbr: string) => api<Constellation>(`/constellations/${abbr}`),
  visibility: (p: VisibilityParams) => api<VisibilityResult>("/astro/visibility", { method: "POST", json: p }),
  aboutData: () => api<AboutData>("/about-data"),
};

export interface AboutData {
  catalog: {
    status: string; source: string; source_url: string; origin: string; source_version: string; license: string;
    file_name: string; batch_id: string; imported_at: string; checksum_sha256: string; profile: string;
    stats: Record<string, number>; transformations: Record<string, number>;
  }[];
  sky_culture: {
    status: string; source: string; source_url: string; source_version: string; license: string; batch_id: string;
    imported_at: string; constellations: number; star_names: number;
  }[];
  boundaries: string;
  calculations: string;
}

export const listsApi = {
  list: () => api<StarList[]>("/lists"),
  get: (id: string) => api<StarList>(`/lists/${id}`),
  create: (name: string) => api<StarList>("/lists", { method: "POST", json: { name } }),
  rename: (id: string, name: string) => api<StarList>(`/lists/${id}`, { method: "PATCH", json: { name } }),
  remove: (id: string) => api<void>(`/lists/${id}`, { method: "DELETE" }),
  addStar: (id: string, hip: number) => api<StarList>(`/lists/${id}/stars/${hip}`, { method: "PUT" }),
  removeStar: (id: string, hip: number) => api<void>(`/lists/${id}/stars/${hip}`, { method: "DELETE" }),
};

export type JournalInput = Omit<JournalEntry, "star_name" | "created_at" | "updated_at" | "observer_area">;

export const journalApi = {
  list: () => api<{ is_public: boolean; entries: JournalEntry[] }>("/journal"),
  create: (e: JournalInput) => api<JournalEntry>("/journal", { method: "POST", json: e }),
  update: (id: string, e: JournalInput) => api<JournalEntry>(`/journal/${id}`, { method: "PUT", json: e }),
  remove: (id: string) => api<void>(`/journal/${id}`, { method: "DELETE" }),
  publicList: () => api<{ user_id: string; display_name: string; entries: number }[]>("/public/journals"),
  publicOne: (userId: string) =>
    api<{ display_name: string; entries: JournalEntry[] }>(`/public/journals/${userId}`),
};

export interface PhotoOptions {
  constellations: string[];
  licenses: { id: string; title: string; url: string }[];
  max_bytes: number;
  min_width: number;
  min_height: number;
}

export interface PhotoMeta {
  title: string;
  constellation: string;
  date_taken: string;
  author: string;
  anonymous: boolean;
  license: string;
  description: string;
  rights_confirmed: boolean;
  keep_gps: boolean;
}

export interface PersonCard {
  id: string;
  name: string;
  also_known_as: string[];
  public_photos: number;
  journal_public: boolean;
  journal_entries: number;
  top_constellations: string[];
  last_activity: string | null;
}

export interface PersonProfile extends PersonCard {
  photos: Photo[];
  journal: JournalEntry[] | null;
}

/** Пошук спостерігачів: лише ті, хто щось оприлюднив (знімки за C-02 або журнал за C-04) */
export const communityApi = {
  people: (q = "") => api<{ total: number; items: PersonCard[] }>(`/community/people?${qs({ q: q || undefined })}`),
  person: (id: string) => api<PersonProfile>(`/community/people/${id}`),
};

export const photosApi = {
  options: () => api<PhotoOptions>("/photos/options"),
  mine: () => api<Photo[]>("/photos"),
  upload: (file: File, meta: PhotoMeta) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("metadata", JSON.stringify(meta));
    return api<Photo>("/photos", { method: "POST", body: fd });
  },
  edit: (id: string, meta: Partial<PhotoMeta>) => api<Photo>(`/photos/${id}`, { method: "PATCH", json: meta }),
  submit: (id: string, choice: { author?: string; anonymous?: boolean; license?: string }) =>
    api<Photo>(`/photos/${id}/submit`, { method: "POST", json: choice }),
  withdraw: (id: string) => api<Photo>(`/photos/${id}/withdraw`, { method: "POST" }),
  republish: (id: string) => api<Photo>(`/photos/${id}/republish`, { method: "POST" }),
  remove: (id: string) => api<void>(`/photos/${id}`, { method: "DELETE" }),
  gallery: (constellation?: string) => api<Photo[]>(`/gallery?${qs({ constellation })}`),
  complain: (id: string, reason: string, comment: string) =>
    api<{ message: string }>(`/gallery/${id}/complaints`, { method: "POST", json: { reason, comment } }),
};

export interface Complaint {
  id: string;
  reason: string;
  reason_label: string;
  comment: string;
  created_at: string;
  photo: Photo | null;
  is_own: boolean;
}

export interface Decision {
  id: string;
  photo_id: string;
  photo_version: number;
  decision: "approve" | "reject";
  reason: string;
  previous_status: string;
  new_status: string;
  by_me: boolean;
  created_at: string;
}

export const moderationApi = {
  queue: () => api<Photo[]>("/moderation/queue"),
  approve: (id: string, version: number) =>
    api<{ published: boolean; reward: Reward | null }>(`/moderation/photos/${id}/approve`, { method: "POST", json: { version } }),
  reject: (id: string, version: number, reason: string) =>
    api<unknown>(`/moderation/photos/${id}/reject`, { method: "POST", json: { version, reason } }),
  decisions: () => api<Decision[]>("/moderation/decisions"),
  complaints: () => api<Complaint[]>("/moderation/complaints"),
  resolve: (id: string, action: "uphold" | "dismiss") =>
    api<unknown>(`/moderation/complaints/${id}`, { method: "POST", json: { action } }),
};

export interface ConsentState {
  current: Partial<Record<ConsentCode, ConsentRecord | null>>;
  per_object: ConsentRecord[];
  history: ConsentRecord[];
  texts: ConsentText[];
}

export const consentApi = {
  texts: () => api<ConsentText[]>("/consents/texts"),
  mine: () => api<ConsentState>("/consents"),
  grant: (code: ConsentCode, version: string, related_object_id?: string) =>
    api<ConsentRecord>("/consents", {
      method: "POST",
      json: { consent_code: code, consent_version: version, channel: "web", related_object_id },
    }),
  revoke: (code: ConsentCode, related_object_id?: string) =>
    api<{ revoked: number }>("/consents/revoke", { method: "POST", json: { consent_code: code, related_object_id } }),
};

export const meApi = {
  profile: () => api<Profile>("/me/profile"),
  update: (p: Pick<Profile, "name" | "city" | "equipment" | "bio">) =>
    api<Profile>("/me/profile", { method: "PATCH", json: p }),
  avatar: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api<Profile>("/me/avatar", { method: "POST", body: fd });
  },
  deleteAvatar: () => api<Profile>("/me/avatar", { method: "DELETE" }),
  stats: () => api<Stats>("/me/stats"),
  rewards: () =>
    api<LevelInfo & { daily_limit: number; points_per_photo: number; history: Reward[] }>("/me/rewards"),
  export: () => api<Record<string, unknown>>("/me/export"),
  deleteAccount: (mode: "delete" | "anonymize", confirm_email: string) =>
    api<{ message: string; steps: { step: number; action: string; data: string; result: string }[] }>("/me", {
      method: "DELETE",
      json: { mode, confirm_email },
    }),
};

// ------------------------------------------------------------------ DG Admin
export interface QualityReport {
  report_id: string;
  import_date: string;
  source: string;
  source_version: string;
  file_name: string;
  total_records: number;
  accepted: number;
  accepted_with_warnings: number;
  rejected: number;
  violations: Record<string, { count: number; records: number }>;
  status: string;
  duration_seconds: number;
  batch_id: string;
  profile: string;
  checksum_sha256: string;
  import_warnings: { rule_id: string; message: string }[];
  transformations: Record<string, number>;
  issues?: { row: number; field: string; rule_id: string; level: string; message: string }[];
  issues_truncated?: boolean;
}

export interface CatalogVersion {
  id: string;
  batch_id: string;
  status: string;
  profile: string;
  source: string;
  source_url: string;
  origin: string;
  source_version: string;
  license: string;
  file_name: string;
  checksum_sha256: string;
  imported_at: string;
  activated_at: string | null;
  report: QualityReport;
}

export interface SkyVersion {
  id: string;
  batch_id: string;
  status: string;
  source: string;
  source_url: string;
  source_version: string;
  license: string;
  file_name: string;
  imported_at: string;
  report: Record<string, unknown>;
}

export interface AuditItem {
  audit_id: string;
  timestamp_utc: string;
  actor_id: string | null;
  actor_role: string;
  event_code: string;
  event_name: string;
  object_type: string;
  object_id: string | null;
  result: string;
  failure_reason: string | null;
  masked_ip: string | null;
  details: Record<string, unknown>;
  record_hash: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  role: string;
  created_at: string;
  last_active_at: string;
}

export const adminApi = {
  importCatalog: (file: File, meta: Record<string, string>) => {
    const fd = new FormData();
    fd.append("file", file);
    for (const [k, v] of Object.entries(meta)) fd.append(k, v);
    return api<CatalogVersion>("/admin/catalog/imports", { method: "POST", body: fd });
  },
  versions: () => api<CatalogVersion[]>("/admin/catalog/versions"),
  version: (id: string) => api<CatalogVersion>(`/admin/catalog/versions/${id}`),
  confirm: (id: string) => api<CatalogVersion>(`/admin/catalog/versions/${id}/confirm`, { method: "POST" }),
  cancel: (id: string) => api<CatalogVersion>(`/admin/catalog/versions/${id}/cancel`, { method: "POST" }),
  importSky: (file: File, meta: Record<string, string>) => {
    const fd = new FormData();
    fd.append("file", file);
    for (const [k, v] of Object.entries(meta)) fd.append(k, v);
    return api<SkyVersion>("/admin/constellations/imports", { method: "POST", body: fd });
  },
  skyVersions: () => api<SkyVersion[]>("/admin/constellations/versions"),
  skyConfirm: (id: string) => api<SkyVersion>(`/admin/constellations/versions/${id}/confirm`, { method: "POST" }),
  skyCancel: (id: string) => api<SkyVersion>(`/admin/constellations/versions/${id}/cancel`, { method: "POST" }),
  audit: (f: Record<string, string | number>) =>
    api<{ total: number; page: number; page_size: number; items: AuditItem[]; events: Record<string, string>; empty_message: string | null }>(
      `/admin/audit?${qs(f)}`,
    ),
  verify: () => api<{ valid: boolean; checked: number; broken_at: string | null }>("/admin/audit/verify"),
  users: (q = "") => api<AdminUser[]>(`/admin/users?${qs({ q })}`),
  setRole: (id: string, role: string) => api<{ id: string; role: string }>(`/admin/users/${id}/role`, { method: "PATCH", json: { role } }),
  retentionOps: () => api<{ id: string; title: string }[]>("/admin/retention/operations"),
  retentionRun: (operations: string[], dry_run: boolean, as_of?: string) =>
    api<{ dry_run: boolean; as_of: string; results: Record<string, Record<string, unknown>> }>("/admin/retention/run", {
      method: "POST",
      json: { operations, dry_run, as_of },
    }),
  policies: () =>
    api<{
      roles: string[];
      rbac: { action: string; data: string; guest: string; observer: string; moderator: string; admin: string }[];
      abac: { id: string; rule: string; on_violation: string }[];
      settings: Record<string, number>;
      note: string;
    }>("/admin/policies"),
};

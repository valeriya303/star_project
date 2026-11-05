export type Role = "OBSERVER" | "MODERATOR" | "DG_ADMIN";

export interface User {
  id: string;
  email: string;
  role: Role;
  display_name: string;
}

export interface StarList {
  id: string;
  name: string;
  is_favorites: boolean;
  hips: number[];
  stars?: import("./star").StarSummary[];
}

export interface JournalEntry {
  observation_id: string;
  star_id: number;
  star_name: string | null;
  observed_at: string; // YYYY-MM-DD
  brightness_rating: number; // 1–5
  conditions_rating: number; // 1–5
  note: string;
  observer_latitude?: number | null;
  observer_longitude?: number | null;
  observer_area?: string;
  created_at: string;
  updated_at: string;
}

export type PhotoStatus = "internal" | "submitted" | "approved" | "rejected";

export interface Photo {
  id: string;
  title: string;
  constellation: string;
  constellation_uk: string;
  date_taken: string;
  author: string;
  anonymous: boolean;
  license: string;
  description: string;
  width_px: number;
  height_px: number;
  published_at: string | null;
  thumb_url: string;
  full_url: string;
  // для автора та модератора
  version?: number;
  status?: PhotoStatus;
  status_label?: string;
  is_public?: boolean;
  hidden_reason?: string | null;
  reject_reason?: string | null;
  file_name?: string;
  file_format?: string;
  file_size_bytes?: number;
  created_at?: string;
  submitted_at?: string | null;
  decided_at?: string | null;
  retention_days_left?: number | null;
  author_name?: string;
  gps_stored?: boolean;
  gps_removed?: boolean;
  publication_consent?: boolean;
  is_own?: boolean;
  /** Публічний профіль автора (лише для неанонімних опублікованих знімків) */
  author_profile_id?: string | null;
}

export type ConsentCode = "C-01" | "C-02" | "C-03" | "C-04";

export interface ConsentText {
  code: ConsentCode;
  version: string;
  title: string;
  text: string;
  purpose: string;
  accept_label: string;
  decline_label: string;
  scope: "function" | "object";
}

export interface ConsentRecord {
  consent_id: string;
  consent_code: ConsentCode;
  consent_version: string;
  status: "granted" | "revoked";
  granted_at: string | null;
  revoked_at: string | null;
  channel: string;
  purpose: string;
  related_object_id: string | null;
  updated_at: string;
  is_current_version: boolean;
  object_title?: string | null;
}

export interface Reward {
  id: string;
  photo_id: string | null;
  photo_version: number | null;
  points: number;
  status: "credited" | "limit_reached";
  reason: string;
  created_at: string;
}

export interface LevelInfo {
  points: number;
  level_name: string;
  prev_min: number;
  next: number | null;
}

export interface Stats extends LevelInfo {
  journal_entries: number;
  unique_stars: number;
  lists: number;
  photos: number;
  published_photos: number;
}

export interface Profile {
  id: string;
  email: string;
  role: Role;
  name: string;
  city: string;
  equipment: string;
  bio: string;
  avatar_url: string | null;
  created_at: string;
}

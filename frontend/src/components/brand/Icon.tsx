import type { ReactNode } from "react";

/** Лінійні іконки в єдиному стилі (24×24, обведення 1,6) */
export type IconName =
  | "map" | "search" | "info" | "horizon" | "gallery" | "bookmark" | "journal" | "camera" | "shield" | "lock" | "help" | "book" | "pin" | "clock" | "eye"
  | "chevron" | "check" | "upload" | "trash" | "edit" | "send" | "undo" | "star" | "calendar" | "plus"
  | "external" | "globe" | "spark" | "x" | "layers";

const PATHS: Record<IconName, ReactNode> = {
  map: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  info: (
    <>
      <path d="M12 3.5l2.3 5.2 5.7.6-4.3 3.8 1.2 5.6L12 15.8l-4.9 2.9 1.2-5.6L4 9.3l5.7-.6z" />
    </>
  ),
  horizon: (
    <>
      <path d="M3 17h18" />
      <path d="M5.5 17a6.5 6.5 0 0 1 13 0" />
      <path d="M12 6V4M6.3 8.3 5 7M17.7 8.3 19 7" />
      <path d="M7 20.5h10" />
    </>
  ),
  gallery: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="m3.5 16 4.5-4.5 4 4 2.5-2.5 6 6" />
      <circle cx="15.5" cy="9.5" r="1.4" />
    </>
  ),
  bookmark: (
    <>
      <path d="M7 3.5h10a1 1 0 0 1 1 1v16l-6-3.8-6 3.8v-16a1 1 0 0 1 1-1z" />
      <path d="m12 7.5.9 1.9 2 .2-1.5 1.4.4 2L12 12l-1.8 1 .4-2-1.5-1.4 2-.2z" />
    </>
  ),
  journal: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="1.8" />
      <path d="M9 3.5v17M12 8h4M12 11.5h4M12 15h2.5" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5L16 6.5h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="10" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  chevron: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  upload: (
    <>
      <path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9" />
      <path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M10 4h4M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12" />
      <path d="M10 11v5.5M14 11v5.5" />
    </>
  ),
  edit: (
    <>
      <path d="M4.5 19.5 5.3 15.7 15.6 5.4a1.9 1.9 0 0 1 2.7 0l.3.3a1.9 1.9 0 0 1 0 2.7L8.3 18.7z" />
      <path d="m13.8 7.2 3 3" />
    </>
  ),
  send: <path d="M20.5 3.5 10 14M20.5 3.5l-6.5 17-4-6.5-6.5-4z" />,
  undo: (
    <>
      <path d="M8.5 5 4.5 9l4 4" />
      <path d="M4.5 9h10a5 5 0 0 1 0 10H11" />
    </>
  ),
  star: <path d="M12 2.5c.8 6.3 3.2 8.7 9.5 9.5-6.3.8-8.7 3.2-9.5 9.5-.8-6.3-3.2-8.7-9.5-9.5 6.3-.8 8.7-3.2 9.5-9.5z" />,
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  external: (
    <>
      <path d="M13.5 4.5h6v6M19.5 4.5 11 13" />
      <path d="M17 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5a13 13 0 0 1 0 17M12 3.5a13 13 0 0 0 0 17" />
    </>
  ),
  spark: (
    <>
      <path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.3 6.3l2.2 2.2M15.5 15.5l2.2 2.2M6.3 17.7l2.2-2.2M15.5 8.5l2.2-2.2" />
    </>
  ),
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  layers: (
    <>
      <path d="m12 4 8.5 4.5L12 13 3.5 8.5z" />
      <path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
    </>
  ),
};

interface Props {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
}

export default function Icon({ name, size = 20, className, title }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" className={className} role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true} aria-label={title}>
      {PATHS[name]}
    </svg>
  );
}

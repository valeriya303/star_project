import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

import Icon from "@/components/brand/Icon";
import "./Select.css";

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  /** Другорядний текст праворуч (кількість, скорочення, зсув UTC) */
  meta?: string;
  /** Пояснення під назвою */
  hint?: string;
  /** Назва групи; опції з однаковою групою йдуть разом */
  group?: string;
  disabled?: boolean;
}

interface Props<V extends string> {
  value: V | "";
  onChange: (v: V) => void;
  options: SelectOption<V>[];
  placeholder?: string;
  /** Поле пошуку всередині списку (для довгих переліків: 88 сузір'їв, часові пояси) */
  searchable?: boolean;
  searchPlaceholder?: string;
  id?: string;
  "aria-label"?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  error?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  /** Мінімальна ширина випадного списку, px */
  menuWidth?: number;
  /** Текст, коли пошук нічого не знайшов */
  emptyText?: string;
}

interface Pos {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  above: boolean;
}

const norm = (s: string) => s.toLocaleLowerCase("uk").replace(/[’'ʼ]/g, "'");

/**
 * Випадний список у стилі проєкту замість системного <select>.
 * Відкривається в порталі (не обрізається панелями), підтримує клавіатуру:
 * ↑ ↓ Home End — вибір, Enter — підтвердити, Esc — закрити, літери — швидкий перехід.
 */
export default function Select<V extends string>(p: Props<V>) {
  const {
    value, onChange, options, placeholder = "Оберіть…", searchable, searchPlaceholder = "Пошук…",
    size = "md", error, disabled, icon, menuWidth = 0, emptyText = "Нічого не знайдено",
  } = p;
  const autoId = useId();
  const listId = `${autoId}-list`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const typed = useRef({ text: "", t: 0 });

  const selected = options.find((o) => o.value === value) ?? null;

  const shown = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return options;
    return options.filter((o) => norm(`${o.label} ${o.meta ?? ""} ${o.hint ?? ""} ${o.value}`).includes(q));
  }, [options, query]);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, menuWidth), vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    const below = vh - r.bottom - 12;
    const aboveSpace = r.top - 12;
    const above = below < 240 && aboveSpace > below;
    const maxHeight = Math.max(160, Math.min(360, above ? aboveSpace : below));
    setPos({ left, width, maxHeight, above, top: above ? r.top - 6 : r.bottom + 6 });
  }, [menuWidth]);

  function openMenu() {
    if (disabled) return;
    place();
    setQuery("");
    const i = options.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : options.findIndex((o) => !o.disabled));
    setOpen(true);
  }

  const close = useCallback((focus = true) => {
    setOpen(false);
    if (focus) triggerRef.current?.focus();
  }, []);

  function choose(o: SelectOption<V> | undefined) {
    if (!o || o.disabled) return;
    if (o.value !== value) onChange(o.value);
    close();
  }

  // Закриття кліком поза списком, перепозиціювання при прокрутці/зміні розміру
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    const onMove = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      place();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, close, place]);

  useLayoutEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  // активний елемент завжди видно
  useEffect(() => {
    if (!open || active < 0) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  // При зміні пошукового запиту — перший доступний варіант
  useEffect(() => {
    if (!open || !query) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- синхронізація активного рядка з фільтром
    setActive(shown.findIndex((o) => !o.disabled));
  }, [query, open, shown]);

  function step(dir: 1 | -1, from = active) {
    if (!shown.length) return;
    let i = from;
    for (let n = 0; n < shown.length; n++) {
      i = (i + dir + shown.length) % shown.length;
      if (!shown[i].disabled) {
        setActive(i);
        return;
      }
    }
  }

  function onKey(e: KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        step(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        step(-1);
        break;
      case "Home":
        if (!searchable) {
          e.preventDefault();
          step(1, -1);
        }
        break;
      case "End":
        if (!searchable) {
          e.preventDefault();
          step(-1, shown.length);
        }
        break;
      case "Enter":
        e.preventDefault();
        choose(shown[active]);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // не закривати модальне вікно під списком
        close();
        break;
      case "Tab":
        close(false);
        break;
      default:
        if (!searchable && e.key.length === 1) {
          const now = Date.now();
          typed.current = { text: (now - typed.current.t < 700 ? typed.current.text : "") + norm(e.key), t: now };
          const i = shown.findIndex((o) => !o.disabled && norm(o.label).startsWith(typed.current.text));
          if (i >= 0) setActive(i);
        }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={p.id}
        className={[
          "select", `select--${size}`, open && "select--open", error && "select--error", !selected && "select--empty", p.className,
        ].filter(Boolean).join(" ")}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={p["aria-label"]}
        aria-invalid={error || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKey}
      >
        {icon && <span className="select__icon">{icon}</span>}
        <span className="select__value">{selected ? selected.label : placeholder}</span>
        {selected?.meta && <span className="select__meta">{selected.meta}</span>}
        <Icon name="chevron" size={16} className="select__chevron" />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          className={"select-menu" + (pos.above ? " select-menu--above" : "")}
          style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}
          onKeyDown={onKey}
        >
          {searchable && (
            <div className="select-menu__search">
              <Icon name="search" size={15} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                aria-controls={listId}
                aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              />
            </div>
          )}
          <ul id={listId} role="listbox" className="select-menu__list" aria-label={p["aria-label"]}>
            {shown.length === 0 && <li className="select-menu__empty">{emptyText}</li>}
            {shown.map((o, i) => {
              const header = o.group && o.group !== shown[i - 1]?.group ? o.group : null;
              return (
                <li key={o.value || `__empty-${i}`} role="presentation">
                  {header && <div className="select-menu__group" role="presentation">{header}</div>}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    data-index={i}
                    aria-selected={o.value === value}
                    aria-disabled={o.disabled || undefined}
                    className={[
                      "select-menu__option",
                      i === active && "select-menu__option--active",
                      o.value === value && "select-menu__option--selected",
                      o.disabled && "select-menu__option--disabled",
                    ].filter(Boolean).join(" ")}
                    onMouseEnter={() => !o.disabled && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                  >
                    <span className="select-menu__check" aria-hidden="true">
                      {o.value === value && <Icon name="check" size={14} />}
                    </span>
                    <span className="select-menu__text">
                      <span className="select-menu__label">{o.label}</span>
                      {o.hint && <span className="select-menu__hint">{o.hint}</span>}
                    </span>
                    {o.meta && <span className="select-menu__meta">{o.meta}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}

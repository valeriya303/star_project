import { useEffect, useRef, useState } from "react";

import { starsApi } from "@/api/endpoints";
import type { StarSummary } from "@/types/star";
import { starTitle } from "@/utils/format";
import "./StarPicker.css";

interface Props {
  label: string;
  value: StarSummary | null;
  onChange: (s: StarSummary | null) => void;
  error?: string;
  placeholder?: string;
  id?: string;
}

/** Вибір зорі з автодоповненням (F3): назва, HIP/HD або «RA Dec» */
export default function StarPicker({ label, value, onChange, error, placeholder, id = "star-picker" }: Props) {
  const [text, setText] = useState(value ? `${starTitle(value)} · HIP ${value.hip}` : "");
  const [items, setItems] = useState<StarSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- синхронізація з зовнішнім значенням
    if (value) setText(`${starTitle(value)} · HIP ${value.hip}`);
  }, [value]);

  function search(q: string) {
    setText(q);
    onChange(null);
    window.clearTimeout(timer.current);
    if (q.trim().length < 1) {
      setItems([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      try {
        const r = await starsApi.search(q, 8);
        setItems(r.items);
        setActive(0);
        setOpen(true);
      } catch {
        setItems([]);
      }
    }, 200);
  }

  function pick(s: StarSummary) {
    onChange(s);
    setText(`${starTitle(s)} · HIP ${s.hip}`);
    setOpen(false);
  }

  return (
    <div className="field picker">
      <label className="field__label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className={"field__input" + (error ? " field__input--error" : "")}
        value={text}
        placeholder={placeholder ?? "Назва, HIP або HD"}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onChange={(e) => search(e.target.value)}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Enter") { e.preventDefault(); pick(items[active]); }
        }}
      />
      {open && items.length > 0 && (
        <ul className="picker__list" id={`${id}-list`} role="listbox">
          {items.map((s, i) => (
            <li key={s.hip} role="option" aria-selected={i === active}>
              <button type="button" className={"picker__item" + (i === active ? " picker__item--active" : "")} onMouseDown={() => pick(s)}>
                <strong>{starTitle(s)}</strong>
                {s.matched_name && <span className="match-note">знайдено як «{s.matched_name}» · {s.matched_lang_label}</span>}
                <span className="muted">
                  HIP {s.hip}{s.hd ? ` · HD ${s.hd}` : ""}{s.constellation_uk ? ` · ${s.constellation_uk}` : ""} · {s.vmag.toFixed(2).replace(".", ",")}m
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && items.length === 0 && text.trim() && <span className="field__hint">Нічого не знайдено</span>}
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}

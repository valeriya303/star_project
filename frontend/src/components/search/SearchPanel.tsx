import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { starsApi } from "@/api/endpoints";
import { ApiError } from "@/api/client";
import Icon from "@/components/brand/Icon";
import Term from "@/components/help/Term";
import Select from "@/components/ui/Select";
import type { StarSummary } from "@/types/star";
import { fmt, parseNum, starTitle } from "@/utils/format";
import "@/components/ui/StarPicker.css";
import "./SearchPanel.css";

type Mode = "name" | "id" | "coords";

interface Props {
  onPick: (s: StarSummary) => void;
}

/** UC-03: пошук за назвою (з автодоповненням), HIP/HD або координатами з радіусом */
export default function SearchPanel({ onPick }: Props) {
  const [mode, setMode] = useState<Mode>("name");
  const [q, setQ] = useState("");
  const [catalog, setCatalog] = useState<"HIP" | "HD">("HIP");
  const [idValue, setIdValue] = useState("");
  const [ra, setRa] = useState("");
  const [dec, setDec] = useState("");
  const [radius, setRadius] = useState("2");
  const [results, setResults] = useState<StarSummary[] | null>(null);
  const [suggest, setSuggest] = useState<StarSummary[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function changeMode(m: Mode) {
    setMode(m);
    setResults(null);
    setErrors({});
    setSuggest([]);
  }

  // F3: підказки під час введення назви
  function onType(v: string) {
    setQ(v);
    window.clearTimeout(timer.current);
    if (v.trim().length < 2) {
      setSuggest([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      try {
        setSuggest((await starsApi.search(v, 6)).items);
      } catch {
        setSuggest([]);
      }
    }, 200);
  }

  async function run(ev?: FormEvent) {
    ev?.preventDefault();
    setErrors({});
    setSuggest([]);
    const e: Record<string, string> = {};
    let call: (() => Promise<StarSummary[]>) | null = null;
    if (mode === "name") {
      if (!q.trim()) e.q = "Введіть назву зорі або її частину";
      else call = async () => (await starsApi.search(q.trim(), 20)).items;
    } else if (mode === "id") {
      if (!/^\d+$/.test(idValue.trim())) e.id = "Ідентифікатор — ціле додатне число";
      else call = async () => (await starsApi.byId(catalog, idValue.trim())).items;
    } else {
      const a = parseNum(ra);
      const d = parseNum(dec);
      const r = parseNum(radius);
      if (a == null || a < 0 || a >= 360) e.ra = "0° ≤ α < 360°";
      if (d == null || d < -90 || d > 90) e.dec = "−90° ≤ δ ≤ 90°";
      if (r == null || r <= 0 || r > 180) e.radius = "0° < r ≤ 180°";
      if (!Object.keys(e).length) call = async () => (await starsApi.cone(a!, d!, r!, 100)).items;
    }
    setErrors(e);
    if (!call) return; // EX2
    setBusy(true);
    try {
      setResults(await call());
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setErrors(err.byField());
      else setErrors({ _: err instanceof Error ? err.message : "Помилка пошуку" });
    } finally {
      setBusy(false);
    }
  }

  async function fastStars() {
    setBusy(true);
    try {
      setResults((await starsApi.fast(25)).items);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="search">
      <div className="search__head">
        <h2 className="search__title">Знайти зорю</h2>
        <p className="muted xsmall">Оберіть спосіб пошуку</p>
      </div>
      <div className="segmented search__modes" role="tablist" aria-label="Спосіб пошуку">
        {([["name", "Назва"], ["id", "Номер"], ["coords", "Координати"]] as const).map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} aria-pressed={mode === m} onClick={() => changeMode(m)}>{label}</button>
        ))}
      </div>

      <form className="search__form" onSubmit={run} noValidate>
        {mode === "name" && (
          <div className="field picker">
            <input className={"field__input search__input" + (errors.q ? " field__input--error" : "")} placeholder="Вега, Betelgeuse, Polarstern…"
              value={q} onChange={(e) => onType(e.target.value)} aria-label="Назва зорі" autoComplete="off" />
            {errors.q && <span className="field__error">{errors.q}</span>}
            {!errors.q && (
              <span className="field__hint search__langs">
                <Icon name="globe" size={12} /> 8 мов: укр., англ., пол., нім., фр., ісп., італ., чес. Можна латиницею чи з неправильною розкладкою
              </span>
            )}
            {suggest.length > 0 && (
              <ul className="picker__list">
                {suggest.map((s) => (
                  <li key={s.hip}>
                    <button type="button" className="picker__item" onClick={() => { setSuggest([]); setQ(starTitle(s)); onPick(s); }}>
                      <strong>{starTitle(s)}</strong>
                      {s.matched_name && <span className="match-note">знайдено як «{s.matched_name}» · {s.matched_lang_label}</span>}
                      <span className="muted">HIP {s.hip}{s.constellation_uk ? ` · ${s.constellation_uk}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {mode === "id" && (
          <p className="muted xsmall">Номер зорі в каталозі <Term id="hip">HIP</Term> або <Term id="hd">HD</Term></p>
        )}
        {mode === "id" && (
          <div className="search__row">
            <Select<"HIP" | "HD"> size="sm" className="search__select" value={catalog} onChange={setCatalog} aria-label="Каталог"
              menuWidth={230}
              options={[
                { value: "HIP", label: "HIP", hint: "Hipparcos" },
                { value: "HD", label: "HD", hint: "Henry Draper" },
              ]} />
            <div className="field">
              <input className={"field__input search__input" + (errors.id ? " field__input--error" : "")} inputMode="numeric" placeholder="32349"
                value={idValue} onChange={(e) => setIdValue(e.target.value)} aria-label="Номер у каталозі" />
              {errors.id && <span className="field__error">{errors.id}</span>}
            </div>
          </div>
        )}
        {mode === "coords" && (
          <>
            <p className="muted xsmall">
              <Term id="ra">α</Term> і <Term id="dec">δ</Term> у градусах (<Term id="icrs">ICRS</Term>). Приклад для Сіріуса: α 101,29, δ −16,72
            </p>
            <div className="search__grid">
              <CoordInput label="α (RA), °" value={ra} onChange={setRa} error={errors.ra} />
              <CoordInput label="δ (Dec), °" value={dec} onChange={setDec} error={errors.dec} />
              <CoordInput label="Радіус, °" value={radius} onChange={setRadius} error={errors.radius} />
            </div>
          </>
        )}
        <div className="search__actions">
          <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>{busy ? "Пошук…" : "Знайти"}</button>
          <button type="button" className="btn btn--outline btn--sm" onClick={fastStars} disabled={busy}
            title="Зорі з найбільшим власним рухом">Швидкі зорі</button>
        </div>
        {errors._ && <p className="status-error small">{errors._}</p>}
      </form>

      {results && (
        <div className="search__results" aria-live="polite">
          {results.length === 0 ? (
            <p className="muted small">За вашим запитом зір не знайдено</p>
          ) : (
            results.map((s) => (
              <button key={s.hip} type="button" className="suggest" onClick={() => onPick(s)}>
                <strong>{starTitle(s)}</strong>
                {s.matched_name && <span className="match-note">знайдено як «{s.matched_name}» · {s.matched_lang_label}</span>}
                <span className="muted">
                  HIP {s.hip}{s.hd ? ` · HD ${s.hd}` : ""}{s.constellation_uk ? ` · ${s.constellation_uk}` : ""} · {fmt(s.vmag, 2)}m
                  {s.distance_deg != null ? ` · ${fmt(s.distance_deg, 2)}° від точки` : ""}
                  {s.pm_total != null ? ` · ${Math.round(s.pm_total)} мс/рік` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function CoordInput(p: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <label className="field">
      <span className="field__hint">{p.label}</span>
      <input className={"field__input search__input" + (p.error ? " field__input--error" : "")} inputMode="decimal"
        value={p.value} onChange={(e) => p.onChange(e.target.value)} />
      {p.error && <span className="field__error">{p.error}</span>}
    </label>
  );
}

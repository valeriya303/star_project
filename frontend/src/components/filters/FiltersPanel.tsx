import { useState } from "react";

import Term from "@/components/help/Term";
import RangeSlider from "@/components/ui/RangeSlider";
import { DEFAULT_FILTERS, FAST_PM_MAS, SPECTRAL_CLASSES, VMAG_LIMITS } from "@/types/filters";
import type { Filters, SpectralClass } from "@/types/filters";
import { describeFilters, validateFilters } from "@/utils/filterStars";
import type { FilterErrors } from "@/utils/filterStars";
import { fmtInt } from "@/utils/format";
import "./FiltersPanel.css";

interface Props {
  applied: Filters;
  onApply: (f: Filters) => void;
  found: number;
  catalog: { count: number; excluded_no_distance: number } | null;
  excludedNoDistance: number;
}

const SPECTRAL_HINT: Record<SpectralClass, string> = {
  O: "блакитні, > 30 000 K", B: "блакитно-білі", A: "білі", F: "жовтувато-білі", G: "жовті (як Сонце)",
  K: "помаранчеві", M: "червоні, < 3 700 K",
};

/** UC-04: фільтрація за характеристиками з явним застосуванням умов */
export default function FiltersPanel({ applied, onApply, found, catalog, excludedNoDistance }: Props) {
  const [draft, setDraft] = useState<Filters>(applied);
  const [errors, setErrors] = useState<FilterErrors>({});

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleClass(c: SpectralClass) {
    const has = draft.classes.includes(c);
    set("classes", has ? draft.classes.filter((x) => x !== c) : [...draft.classes, c]);
  }

  function apply() {
    const e = validateFilters(draft);
    setErrors(e);
    if (Object.keys(e).length > 0) return; // EX3: попередній результат залишається чинним
    onApply(draft);
  }

  function reset() {
    setDraft(DEFAULT_FILTERS);
    setErrors({});
    onApply(DEFAULT_FILTERS);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const distActive = applied.distMin !== "" || applied.distMax !== "";

  return (
    <div className="filters">
      <h2 className="filters__title">Фільтри</h2>

      <span className="field__label filters__label"><Term id="vmag">Видима зоряна величина (Vmag)</Term></span>
      <RangeSlider
        label="Діапазон"
        min={VMAG_LIMITS[0]}
        max={VMAG_LIMITS[1]}
        step={0.5}
        value={[draft.vmagMin, draft.vmagMax]}
        onChange={([a, b]) => setDraft((d) => ({ ...d, vmagMin: a, vmagMax: b }))}
        error={errors.vmag}
      />
      <p className="muted filters__hint">Менше значення — яскравіша зоря. Неозброєним оком видно до ≈ 6m.</p>

      <div className="field">
        <span className="field__label filters__label"><Term id="spectral">Спектральний клас</Term></span>
        <div className="filters__classes">
          {SPECTRAL_CLASSES.map((c) => (
            <button
              key={c}
              type="button"
              title={SPECTRAL_HINT[c]}
              aria-pressed={draft.classes.includes(c)}
              className={"class-dot" + (draft.classes.includes(c) ? " class-dot--active" : "")}
              onClick={() => toggleClass(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <RangeInputs label={<Term id="ly">Відстань, св. р.</Term>} aria="Відстань, світлових років" a={draft.distMin} b={draft.distMax} error={errors.dist}
        onA={(v) => set("distMin", v)} onB={(v) => set("distMax", v)} />
      <RangeInputs label={<Term id="bv">Показник кольору B–V</Term>} aria="Показник кольору B–V" a={draft.bvMin} b={draft.bvMax} error={errors.bv}
        onA={(v) => set("bvMin", v)} onB={(v) => set("bvMax", v)} />
      <RangeInputs label={<><Term id="pm">Власний рух</Term>, <Term id="mas">мс</Term>/рік</>} aria="Власний рух, мс на рік" a={draft.pmMin} b={draft.pmMax} error={errors.pm}
        onA={(v) => set("pmMin", v)} onB={(v) => set("pmMax", v)} />

      <label className="filters__check">
        <input type="checkbox" checked={draft.fastOnly} onChange={(e) => set("fastOnly", e.target.checked)} />
        Лише швидкі зорі (від {FAST_PM_MAS} мс/рік)
      </label>

      <div className="filters__buttons">
        <button type="button" className="btn btn--primary btn--sm" onClick={apply} disabled={!dirty}>
          Застосувати
        </button>
        <button type="button" className="btn btn--outline btn--sm" onClick={reset}>
          Скинути фільтри
        </button>
      </div>

      <div className="filters__result" aria-live="polite">
        <div className="chips">
          {describeFilters(applied).map((t) => <span key={t} className="chip chip--accent">{t}</span>)}
        </div>
        <p className="small">
          На карті: <strong>{fmtInt(found)}</strong>
          {catalog && <> · у каталозі: <strong>{fmtInt(catalog.count)}</strong></>}
        </p>
        {distActive && (excludedNoDistance > 0 || (catalog?.excluded_no_distance ?? 0) > 0) && (
          <p className="muted xsmall">
            Виключено через відсутню або ненадійну відстань: {fmtInt(catalog?.excluded_no_distance ?? excludedNoDistance)}
          </p>
        )}
        {found === 0 && <p className="status-error small">Жодна зоря не відповідає заданим умовам</p>}
      </div>
    </div>
  );
}

function RangeInputs(p: { label: React.ReactNode; aria: string; a: string; b: string; onA: (v: string) => void; onB: (v: string) => void; error?: string }) {
  return (
    <div className="field">
      <span className="field__label filters__label">{p.label}</span>
      <div className="field__row">
        <input className={"field__input filters__num" + (p.error ? " field__input--error" : "")} inputMode="decimal"
          placeholder="від" value={p.a} onChange={(e) => p.onA(e.target.value)} aria-label={`${p.aria}: від`} />
        <input className={"field__input filters__num" + (p.error ? " field__input--error" : "")} inputMode="decimal"
          placeholder="до" value={p.b} onChange={(e) => p.onB(e.target.value)} aria-label={`${p.aria}: до`} />
      </div>
      {p.error && <span className="field__error">{p.error}</span>}
    </div>
  );
}

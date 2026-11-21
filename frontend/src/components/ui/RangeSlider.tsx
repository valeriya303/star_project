import "./RangeSlider.css";

interface Props {
  label: string;
  min: number;
  max: number;
  step: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  error?: string;
}

const f = (n: number) => n.toFixed(1).replace(".", ",").replace("-", "−");

export default function RangeSlider({ label, min, max, step, value, onChange, error }: Props) {
  const [lo, hi] = value;
  const span = max - min || 1;
  const loPct = ((lo - min) / span) * 100;
  const hiPct = ((hi - min) / span) * 100;
  // коли повзунки зійшлися біля правого краю, лівий має бути зверху, інакше його не зрушити
  const loOnTop = lo >= max - span * 0.1 && lo === hi;

  return (
    <div className="range">
      <div className="range__head">
        <span>{label}</span>
        <span className="range__values">
          {f(lo)} … {f(hi)}
        </span>
      </div>

      <div className="range__track">
        <div className="range__rail" aria-hidden="true" />
        <div
          className="range__fill"
          aria-hidden="true"
          style={{ left: `${loPct}%`, width: `${Math.max(hiPct - loPct, 0)}%` }}
        />
        <input
          type="range"
          className={"range__input range__input--lo" + (loOnTop ? " range__input--top" : "")}
          min={min}
          max={max}
          step={step}
          value={lo}
          aria-label={label + ": від"}
          onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
        />
        <input
          type="range"
          className="range__input range__input--hi"
          min={min}
          max={max}
          step={step}
          value={hi}
          aria-label={label + ": до"}
          onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
        />
      </div>
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}

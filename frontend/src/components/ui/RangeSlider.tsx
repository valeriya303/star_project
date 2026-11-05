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

  return (
    <div className="range">
      <div className="range__head">
        <span>{label}</span>
        <span className="range__values">
          {f(lo)} … {f(hi)}
        </span>
      </div>

      <div className="range__inputs">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={lo}
          aria-label={label + ": від"}
          onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
        />
        <input
          type="range"
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

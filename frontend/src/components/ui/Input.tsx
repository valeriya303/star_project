import type { InputHTMLAttributes } from "react";
import "./Input.css";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export default function Input({ label, error, hint, id, ...rest }: InputProps) {
  const inputId = id ?? rest.name;

  return (
    <div className="field">
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className={"field__input" + (error ? " field__input--error" : "")}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-err` : undefined}
        {...rest}
      />
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span id={`${inputId}-err`} className="field__error">{error}</span>}
    </div>
  );
}

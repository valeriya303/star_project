import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { authApi } from "@/api/endpoints";
import Tabs from "@/components/ui/Tabs";
import { useAuth } from "@/context/AuthContext";
import type { User } from "@/types/userData";
import "./AuthForm.css";

export type AuthMode = "login" | "register" | "forgot";

interface Errors {
  email?: string;
  password?: string;
  confirm?: string;
  _?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AuthFormProps {
  initialMode?: AuthMode;
  onSuccess?: (user: User) => void;
}

const TITLES: Record<AuthMode, { title: string; text: string }> = {
  login: { title: "З поверненням", text: "Увійдіть, щоб працювати зі списками, журналом і знімками." },
  register: { title: "Створення акаунта", text: "Потрібні лише email і пароль. Решту даних профілю ви додаєте за бажанням." },
  forgot: { title: "Відновлення пароля", text: "Вкажіть email — ми надішлемо посилання для зміни пароля." },
};

/** UC-01: реєстрація та вхід */
export default function AuthForm({ initialMode = "login", onSuccess }: AuthFormProps) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  function validate(): Errors {
    const e: Errors = {};
    if (!EMAIL_RE.test(email.trim())) e.email = "Введіть коректну електронну адресу";
    if (mode !== "forgot" && password.length < 8) e.password = "Пароль має містити щонайменше 8 символів";
    if (mode === "register" && confirm !== password) e.confirm = "Паролі не збігаються";
    return e;
  }

  async function handleSubmit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    setInfo("");
    if (Object.keys(e).length > 0) return; // EX3
    setBusy(true);
    try {
      if (mode === "register") {
        await register(email.trim(), password);
        // UC-01 крок 9: форма входу з повідомленням про успішну реєстрацію
        setMode("login");
        setPassword("");
        setConfirm("");
        setInfo("Обліковий запис створено. Увійдіть, щоб продовжити.");
      } else if (mode === "forgot") {
        await authApi.forgotPassword(email.trim());
        setInfo("Якщо такий обліковий запис існує, ми надіслали інструкції для зміни пароля.");
      } else {
        const user = await login(email.trim(), password);
        onSuccess?.(user);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "EMAIL_TAKEN") setErrors({ email: err.message }); // EX2
        else if (err.status === 422) setErrors(err.byField());
        else setErrors({ _: err.message }); // EX1: «Неправильний email або пароль»
      } else setErrors({ _: "Не вдалося виконати запит" });
    } finally {
      setBusy(false);
    }
  }

  function handleModeChange(next: AuthMode) {
    setMode(next);
    setErrors({});
    setInfo("");
    setPassword("");
    setConfirm("");
  }

  const head = TITLES[mode];

  return (
    <div className="auth-form panel">
      {mode !== "forgot" && (
        <Tabs
          tabs={[
            { value: "login", label: "Вхід" },
            { value: "register", label: "Реєстрація" },
          ]}
          active={mode}
          onChange={handleModeChange}
        />
      )}

      <div className="auth-form__head">
        <h2 className="auth-form__title">{head.title}</h2>
        <p className="auth-form__lead">{head.text}</p>
      </div>

      <form className="auth-form__form" onSubmit={handleSubmit} noValidate>
        <Field label="Електронна пошта" id="email" error={errors.email}>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={"field__input" + (errors.email ? " field__input--error" : "")}
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!errors.email}
          />
        </Field>

        {mode !== "forgot" && (
          <Field label="Пароль" id="password" error={errors.password}
            hint={mode === "register" ? "Щонайменше 8 символів" : undefined}>
            <div className="auth-form__pass">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className={"field__input" + (errors.password ? " field__input--error" : "")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!errors.password}
              />
              <button type="button" className="auth-form__eye" onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Приховати пароль" : "Показати пароль"} aria-pressed={showPassword}>
                {showPassword ? "Сховати" : "Показати"}
              </button>
            </div>
          </Field>
        )}

        {mode === "register" && (
          <Field label="Повторіть пароль" id="confirm" error={errors.confirm}>
            <input
              id="confirm"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              className={"field__input" + (errors.confirm ? " field__input--error" : "")}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={!!errors.confirm}
            />
          </Field>
        )}

        {mode === "login" && (
          <button type="button" className="link-btn auth-form__forgot" onClick={() => handleModeChange("forgot")}>
            Забули пароль?
          </button>
        )}

        {errors._ && <p className="auth-form__alert auth-form__alert--error" role="alert">{errors._}</p>}
        {info && <p className="auth-form__alert auth-form__alert--ok" role="status">{info}</p>}

        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "Зачекайте…" : mode === "login" ? "Увійти" : mode === "register" ? "Створити акаунт" : "Надіслати посилання"}
        </button>

        {mode === "forgot" && (
          <button type="button" className="btn btn--outline" onClick={() => handleModeChange("login")}>
            Повернутися до входу
          </button>
        )}

        {mode === "register" && (
          <p className="auth-form__legal">
            Email використовується лише для входу в систему. Згоди на геолокацію, публікацію знімків і публічність
            журналу надаються окремо й лише за вашим рішенням.{" "}
            <Link to="/privacy">Політика конфіденційності</Link>
          </p>
        )}
      </form>
    </div>
  );
}

function Field(p: { label: string; id: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={p.id}>{p.label}</label>
      {p.children}
      {p.hint && !p.error && <span className="field__hint">{p.hint}</span>}
      {p.error && <span className="field__error">{p.error}</span>}
    </div>
  );
}

import { Link, useLocation, useNavigate } from "react-router-dom";

import AuthForm from "@/components/auth/AuthForm";
import type { AuthMode } from "@/components/auth/AuthForm";
import { GUEST_FEATURES, MEMBER_FEATURES, PROTECTED_SECTIONS } from "@/components/auth/access";
import FeatureList from "@/components/auth/FeatureList";
import Icon from "@/components/brand/Icon";
import Logo from "@/components/brand/Logo";
import type { User } from "@/types/userData";
import "./AuthPage.css";

/** Стартова сторінка: що доступно без входу і що відкривається після входу (DG-2) */
export default function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: string; mode?: AuthMode } | null;
  const from = state?.from;
  const section = from ? PROTECTED_SECTIONS[from] : undefined;

  function onSuccess(user: User) {
    if (from) return navigate(from, { replace: true });
    navigate(user.role === "DG_ADMIN" ? "/admin" : user.role === "MODERATOR" ? "/moderation" : "/map", { replace: true });
  }

  return (
    <div className="auth">
      <section className="auth__intro">
        <Logo size={56} className="auth__logo" />
        <h1 className="auth__title">Інтерактивний локатор<br />зоряних каталогів</h1>
        <p className="auth__text">
          Карта зір каталогу Hipparcos із лініями сузір'їв, пошуком, фільтрами та розрахунком видимості
          для будь-якого місця й часу.
        </p>

        <div className="auth__columns">
          <div className="auth__col">
            <h2 className="auth__col-title">Без входу</h2>
            <FeatureList items={GUEST_FEATURES} />
          </div>
          <div className="auth__col auth__col--member">
            <h2 className="auth__col-title"><Icon name="lock" size={14} /> Після входу</h2>
            <FeatureList items={MEMBER_FEATURES} tone="accent" />
          </div>
        </div>

        <div className="auth__cta">
          <Link to="/map" className="btn btn--outline auth__guest">Відкрити карту без входу →</Link>
          <Link to="/community" className="auth__link">Галерея спільноти</Link>
          <Link to="/help" className="auth__link">Як користуватися?</Link>
        </div>
      </section>

      <div className="auth__form-wrap">
        {section && (
          <p className="auth__notice" role="status">
            Щоб відкрити розділ «{section.title}», увійдіть або створіть акаунт.
          </p>
        )}
        <AuthForm key={state?.mode ?? "login"} initialMode={state?.mode ?? "login"} onSuccess={onSuccess} />
        <p className="auth__privacy">
          Ваші координати не зберігаються на сервері, а журнал і знімки залишаються приватними, доки ви не надасте згоду.{" "}
          <Link to="/privacy">Детальніше</Link> · <Link to="/about-data">Про дані</Link>
        </p>
      </div>
    </div>
  );
}

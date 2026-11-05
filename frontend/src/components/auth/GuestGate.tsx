import { Link, useLocation } from "react-router-dom";

import Logo from "@/components/brand/Logo";
import { GUEST_FEATURES, PROTECTED_SECTIONS } from "./access";
import FeatureList from "./FeatureList";
import "./GuestGate.css";

/** Пояснення для Гостя замість переадресування: що це за розділ і навіщо входити (UC-06 EX1, AP-07) */
export default function GuestGate() {
  const { pathname } = useLocation();
  const section = PROTECTED_SECTIONS[pathname] ?? { title: "Цей розділ", text: "Ця функція доступна після входу." };

  return (
    <div className="gate">
      <section className="panel gate__card">
        <Logo size={44} withText={false} />
        <p className="gate__eyebrow">Потрібен вхід</p>
        <h1 className="gate__title">{section.title}</h1>
        <p className="gate__text">{section.text}</p>
        <div className="gate__actions">
          <Link to="/" state={{ from: pathname, mode: "login" }} className="btn btn--primary">Увійти</Link>
          <Link to="/" state={{ from: pathname, mode: "register" }} className="btn btn--outline">Створити акаунт</Link>
        </div>
        <p className="gate__note muted">Реєстрація безкоштовна й потребує лише email. Інші дані — за вашим бажанням.</p>
      </section>

      <section className="gate__free">
        <h2 className="gate__subtitle">Без входу вже доступно</h2>
        <FeatureList items={GUEST_FEATURES} />
        <Link to="/map" className="gate__link">Перейти до карти →</Link>
      </section>
    </div>
  );
}

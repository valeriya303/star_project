import { NavLink, Link } from "react-router-dom";

import Icon from "@/components/brand/Icon";
import Logo from "@/components/brand/Logo";
import { useAuth } from "@/context/AuthContext";
import { ROLE_LABELS } from "@/utils/format";
import "./Header.css";

const linkClass = ({ isActive }: { isActive: boolean }) => "header__link" + (isActive ? " header__link--active" : "");

export default function Header() {
  const { role, user } = useAuth();
  const guest = role === "GUEST";
  const personal = role === "OBSERVER" || role === "MODERATOR";

  // Пункти меню відповідають матриці RBAC (DG-2). Для Гостя особисті розділи позначено замком
  const items = [
    { to: "/map", label: "Карта", show: true, locked: false },
    { to: "/community", label: "Спільнота", show: true, locked: false },
    { to: "/lists", label: "Списки", show: guest || personal, locked: guest },
    { to: "/journal", label: "Журнал", show: guest || personal, locked: guest },
    { to: "/gallery", label: "Мої знімки", show: guest || personal, locked: guest },
    { to: "/moderation", label: "Модерація", show: role === "MODERATOR", locked: false },
    { to: "/admin", label: "Адміністрування", show: role === "DG_ADMIN", locked: false },
    { to: "/help", label: "Довідка", show: true, locked: false },
  ];

  return (
    <header className="header">
      <Link to="/map" className="header__logo" aria-label="Star — на головну">
        <Logo size={34} />
      </Link>

      <nav className="header__nav" aria-label="Головне меню">
        {items.filter((i) => i.show).map((item) => (
          <NavLink key={item.to} to={item.to} className={linkClass}
            title={item.locked ? "Доступно після входу" : undefined}>
            {item.label}
            {item.locked && <Icon name="lock" size={13} className="header__lock" title="потрібен вхід" />}
          </NavLink>
        ))}
      </nav>

      {guest ? (
        <div className="header__auth">
          <Link to="/" state={{ mode: "login" }} className="header__link">Увійти</Link>
          <Link to="/" state={{ mode: "register" }} className="btn btn--primary btn--sm">Реєстрація</Link>
        </div>
      ) : (
        <NavLink to="/profile" className={(s) => linkClass(s) + " header__profile"}>
          <span className="header__avatar" aria-hidden="true">
            {(user?.display_name || user?.email || "?").charAt(0).toUpperCase()}
          </span>
          <span className="header__who">
            <span>{user?.display_name || user?.email.split("@")[0]}</span>
            <span className="header__role">{ROLE_LABELS[role]}</span>
          </span>
        </NavLink>
      )}
    </header>
  );
}

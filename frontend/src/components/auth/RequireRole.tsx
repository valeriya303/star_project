import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "@/context/AuthContext";
import type { Role } from "@/types/userData";
import { ROLE_LABELS } from "@/utils/format";
import GuestGate from "./GuestGate";

interface Props {
  roles: Role[];
  children: ReactNode;
}

/** Обмеження інтерфейсу за роллю. Права однаково перевіряються на сервері (AD-03) */
export default function RequireRole({ roles, children }: Props) {
  const { user, ready } = useAuth();
  if (!ready) return <p className="muted">Завантаження…</p>;
  if (!user) return <GuestGate />;
  if (!roles.includes(user.role)) {
    return (
      <div className="panel box" style={{ maxWidth: 560, margin: "2rem auto" }}>
        <h1 className="page-title">Розділ недоступний для вашої ролі</h1>
        <p className="muted">
          Ви увійшли як «{ROLE_LABELS[user.role]}». Цей розділ доступний ролям:{" "}
          {roles.map((r) => ROLE_LABELS[r]).join(", ")}.
        </p>
        <Link to="/map">Повернутися до карти</Link>
      </div>
    );
  }
  return <>{children}</>;
}

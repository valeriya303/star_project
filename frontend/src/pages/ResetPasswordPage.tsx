import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { authApi } from "@/api/endpoints";
import Input from "@/components/ui/Input";
import "./AuthPage.css";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Пароль має містити щонайменше 8 символів");
    try {
      await authApi.resetPassword(params.get("token") ?? "", password);
      setMsg("Пароль змінено. Усі попередні сесії завершено.");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    }
  }

  return (
    <div className="auth">
      <form className="auth-form panel" onSubmit={submit} style={{ gridColumn: "1 / -1", justifySelf: "center" }}>
        <h1 className="page-title">Новий пароль</h1>
        <Input label="Новий пароль" name="password" type="password" autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)} error={error} />
        {msg && <p className="status-ok small">{msg}</p>}
        <button type="submit" className="btn btn--primary">Зберегти</button>
        <Link to="/">До входу</Link>
      </form>
    </div>
  );
}

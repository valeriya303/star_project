import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ApiError, fileUrl } from "@/api/client";
import { consentApi, meApi } from "@/api/endpoints";
import type { ConsentState } from "@/api/endpoints";
import GuestGate from "@/components/auth/GuestGate";
import ConsentDialog from "@/components/consent/ConsentDialog";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Tabs from "@/components/ui/Tabs";
import { useAuth } from "@/context/AuthContext";
import { usePlace } from "@/context/LocationContext";
import type { ConsentCode, Profile, Reward, Stats, LevelInfo } from "@/types/userData";
import { ROLE_LABELS, downloadJson } from "@/utils/format";
import { fmtDateTime } from "@/utils/time";
import "./ProfilePage.css";

type Tab = "profile" | "consents" | "rewards" | "data";

function ProfileView() {
  const { user, logout, canUsePersonal } = useAuth();
  const location = useLocation();
  const initialTab = (location.state as { tab?: Tab } | null)?.tab ?? "profile";
  const [tab, setTab] = useState<Tab>(initialTab);

  const tabs: { value: Tab; label: string }[] = [{ value: "profile", label: "Профіль" }];
  if (canUsePersonal) tabs.push({ value: "consents", label: "Мої згоди" }, { value: "rewards", label: "Винагороди" });
  tabs.push({ value: "data", label: "Мої дані" });

  return (
    <div className="profile">
      <div className="page-head">
        <h1 className="profile__title">Профіль</h1>
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
      </div>
      {tab === "profile" && <ProfileTab onLogout={logout} />}
      {tab === "consents" && canUsePersonal && <ConsentsTab />}
      {tab === "rewards" && canUsePersonal && <RewardsTab />}
      {tab === "data" && user && <DataTab email={user.email} />}
    </div>
  );
}

// ------------------------------------------------------------------ профіль
function ProfileTab({ onLogout }: { onLogout: () => Promise<void> }) {
  const { refresh } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: "", city: "", equipment: "", bio: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    meApi.profile().then(setProfile).catch(() => undefined);
    meApi.stats().then(setStats).catch(() => undefined);
  }, []);

  if (!profile) return <p className="muted">Завантаження…</p>;
  const shownName = profile.name || profile.email.split("@")[0];

  async function handleAvatar(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!["image/jpeg", "image/png"].includes(f.type)) return setError("Аватарка: лише JPG або PNG");
    if (f.size > 5 * 1024 * 1024) return setError("Аватарка більша за 5 МБ");
    try {
      setProfile(await meApi.avatar(f));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося завантажити");
    }
  }

  async function handleSave(ev: FormEvent) {
    ev.preventDefault();
    try {
      setProfile(await meApi.update(draft));
      await refresh();
      setEditing(false);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? Object.values(err.byField())[0] ?? err.message : "Помилка");
    }
  }

  const avatar = profile.avatar_url
    ? <img className="avatar" src={fileUrl(profile.avatar_url)} alt="Аватарка" />
    : <div className="avatar avatar--empty">{shownName.charAt(0).toUpperCase()}</div>;

  const statItems = stats ? [
    { label: "Записів у журналі", value: stats.journal_entries },
    { label: "Різних зір", value: stats.unique_stars },
    { label: "Списків", value: stats.lists },
    { label: "Знімків (опубліковано)", value: `${stats.photos} (${stats.published_photos})` },
  ] : [];

  return (
    <div className="profile__layout">
      {editing ? (
        <form className="panel profile__card" onSubmit={handleSave} noValidate>
          <div className="profile__avatar-row">
            {avatar}
            <div className="profile__avatar-btns">
              <label className="btn btn--outline btn--sm">
                Змінити фото
                <input type="file" accept="image/jpeg,image/png" onChange={handleAvatar} hidden />
              </label>
              {profile.avatar_url && (
                <button type="button" className="link-btn" onClick={async () => setProfile(await meApi.deleteAvatar())}>Видалити фото</button>
              )}
            </div>
          </div>
          <Input label="Ім'я (необов'язково)" name="name" maxLength={50} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Input label="Електронна пошта" name="email" value={profile.email} disabled readOnly />
          <Input label="Місто (необов'язково)" name="city" maxLength={80} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
          <Input label="Обладнання" name="equipment" maxLength={120} placeholder="Бінокль, телескоп…" value={draft.equipment} onChange={(e) => setDraft({ ...draft, equipment: e.target.value })} />
          <div className="field">
            <label className="field__label" htmlFor="bio">Про себе</label>
            <textarea id="bio" className="field__input field__input--area" maxLength={300} value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} />
          </div>
          <p className="muted xsmall">Ми зберігаємо лише поля, які ви заповнили (мінімізація даних).</p>
          {error && <p className="profile__error">{error}</p>}
          <div className="profile__btns">
            <button type="submit" className="btn btn--primary">Зберегти</button>
            <button type="button" className="btn btn--outline" onClick={() => setEditing(false)}>Скасувати</button>
          </div>
        </form>
      ) : (
        <div className="panel profile__card">
          <div className="profile__avatar-row">
            {avatar}
            <div>
              <p className="profile__name">{shownName}</p>
              <p className="muted">{ROLE_LABELS[profile.role]}{stats ? ` · ${stats.level_name} · ${stats.points} балів` : ""}</p>
            </div>
          </div>
          <Field label="Електронна пошта" value={profile.email} />
          <Field label="Місто" value={profile.city} />
          <Field label="Обладнання" value={profile.equipment} />
          <Field label="Про себе" value={profile.bio} />
          <Field label="Зареєстровано" value={fmtDateTime(profile.created_at)} />
          {error && <p className="profile__error">{error}</p>}
          <div className="profile__btns">
            <button className="btn btn--primary" onClick={() => { setDraft({ name: profile.name, city: profile.city, equipment: profile.equipment, bio: profile.bio }); setEditing(true); }}>Редагувати</button>
            <button className="btn btn--outline" onClick={() => void onLogout()}>Вийти</button>
          </div>
        </div>
      )}
      <div className="profile__stats">
        {statItems.map((s) => (
          <div key={s.label} className="panel profile__stat">
            <span className="profile__num">{s.value}</span>
            <span className="muted">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="profile__label">{label}</p>
      <p className="profile__value">{value}</p>
    </div>
  );
}

// ------------------------------------------------------------------ UC-13 «Мої згоди»
function ConsentsTab() {
  const { place, resetToLviv } = usePlace();
  const [state, setState] = useState<ConsentState | null>(null);
  const [ask, setAsk] = useState<ConsentCode | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => setState(await consentApi.mine()), []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- завантаження згод
    void load();
  }, [load]);

  async function revoke(code: ConsentCode, related?: string) {
    setMsg("");
    try {
      await consentApi.revoke(code, related);
      if (code === "C-01" && place.source === "device") resetToLviv(); // припинення використання геолокації
      setMsg(code === "C-02" ? "Згоду відкликано. Знімок приховано від інших користувачів" : "Згоду відкликано");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Помилка");
    }
  }

  if (!state) return <p className="muted">Завантаження…</p>;
  const fn = state.texts.filter((t) => t.scope === "function");

  return (
    <div className="stack">
      <p className="muted small">
        Кожна згода надається окремо й може бути відкликана так само просто. Відмова від згоди не блокує функцій, яким вона не потрібна.
        Відкликання C-01 не скасовує дозволу в налаштуваннях браузера — його можна вимкнути там окремо.
      </p>
      {msg && <p className="notice small" role="status">{msg}</p>}
      <div className="consents">
        {fn.map((t) => {
          const c = state.current[t.code];
          return (
            <article key={t.code} className="panel box">
              <div className="row">
                <h2 className="box__title">{t.title}</h2>
                <span className="spacer" />
                <span className={"tag " + (c ? "tag--ok" : "")}>{c ? "Надано" : "Не надано"}</span>
              </div>
              <p className="small">{t.text}</p>
              <p className="muted xsmall">
                {t.code} · редакція {t.version}
                {c && ` · надано ${fmtDateTime(c.granted_at!)} · канал: ${c.channel}`}
              </p>
              <div className="row">
                {c ? (
                  <button type="button" className="btn btn--outline btn--sm" onClick={() => revoke(t.code)}>Відкликати згоду</button>
                ) : (
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => setAsk(t.code)}>{t.accept_label}</button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <section className="panel box">
        <h2 className="box__title">Згоди щодо знімків</h2>
        {state.per_object.length === 0 ? (
          <p className="muted small">Чинних згод на публікацію знімків (C-02) чи збереження GPS (C-03) немає.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Згода</th><th>Знімок</th><th>Надано</th><th /></tr></thead>
              <tbody>
                {state.per_object.map((c) => (
                  <tr key={c.consent_id}>
                    <td>{c.consent_code === "C-02" ? "Публікація знімка" : "Збереження GPS"}</td>
                    <td>{c.object_title ?? c.related_object_id}</td>
                    <td>{c.granted_at ? fmtDateTime(c.granted_at) : "—"}</td>
                    <td><button type="button" className="link-btn" onClick={() => revoke(c.consent_code, c.related_object_id ?? undefined)}>Відкликати</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel box">
        <h2 className="box__title">Історія рішень</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Код</th><th>Статус</th><th>Редакція</th><th>Надано</th><th>Відкликано</th><th>Об'єкт</th></tr></thead>
            <tbody>
              {state.history.map((c) => (
                <tr key={c.consent_id}>
                  <td>{c.consent_code}</td>
                  <td>{c.status === "granted" ? "надано" : "відкликано"}</td>
                  <td>{c.consent_version}</td>
                  <td>{c.granted_at ? fmtDateTime(c.granted_at) : "—"}</td>
                  <td>{c.revoked_at ? fmtDateTime(c.revoked_at) : "—"}</td>
                  <td className="mono">{c.related_object_id?.slice(0, 8) ?? "—"}</td>
                </tr>
              ))}
              {state.history.length === 0 && <tr><td colSpan={6} className="muted">Ще не було жодних рішень</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {ask && (
        <ConsentDialog code={ask} onDecline={() => setAsk(null)} onAccept={async (t) => {
          await consentApi.grant(t.code, t.version);
          setAsk(null);
          setMsg("Згоду надано");
          await load();
        }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ UC-12 AC1
function RewardsTab() {
  const [data, setData] = useState<(LevelInfo & { daily_limit: number; points_per_photo: number; history: Reward[] }) | null>(null);
  useEffect(() => {
    meApi.rewards().then(setData).catch(() => undefined);
  }, []);
  if (!data) return <p className="muted">Завантаження…</p>;
  return (
    <div className="stack">
      <div className="profile__stats">
        <div className="panel profile__stat"><span className="profile__num">{data.points}</span><span className="muted">балів</span></div>
        <div className="panel profile__stat"><span className="profile__num" style={{ fontSize: "1.6rem" }}>{data.level_name}</span>
          <span className="muted">{data.next ? `до наступного рівня ${data.next - data.points}` : "максимальний рівень"}</span></div>
      </div>
      <p className="muted small">Бали нараховує система за схвалені модератором знімки: {data.points_per_photo} за знімок, не більше {data.daily_limit} нарахувань на добу. Повторна обробка того самого схвалення балів не додає.</p>
      <div className="panel box table-wrap">
        <table className="table">
          <thead><tr><th>Дата</th><th>Бали</th><th>Підстава</th><th>Знімок</th></tr></thead>
          <tbody>
            {data.history.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.created_at)}</td>
                <td className={r.status === "credited" ? "status-ok" : "muted"}>{r.status === "credited" ? `+${r.points}` : "0"}</td>
                <td>{r.reason}</td>
                <td className="mono">{r.photo_id?.slice(0, 8)} · v{r.photo_version}</td>
              </tr>
            ))}
            {data.history.length === 0 && <tr><td colSpan={4} className="muted">Нарахувань ще не було</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ DG-7 / DG-8
function DataTab({ email }: { email: string }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"delete" | "anonymize" | "">("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<{ step: number; action: string; data: string; result: string }[] | null>(null);

  async function doDelete() {
    setError("");
    try {
      const r = await meApi.deleteAccount(mode as "delete" | "anonymize", confirmEmail);
      setSteps(r.steps);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.byField())[0] ?? e.message : "Помилка");
    }
  }

  return (
    <div className="stack">
      <section className="panel box">
        <h2 className="box__title">Доступ до моїх даних</h2>
        <p className="small">Завантажте копію всіх даних, які система зберігає про вас: профіль, списки, журнал, метадані знімків, винагороди та історію згод.</p>
        <div><button type="button" className="btn btn--outline btn--sm" onClick={async () => downloadJson("star-my-data.json", await meApi.export())}>Завантажити JSON</button></div>
      </section>
      <section className="panel box">
        <h2 className="box__title">Видалення облікового запису</h2>
        <p className="small">
          Будуть завершені всі сесії, видалено email, пароль, профіль і згоди. Для списків, журналу, знімків і досягнень можна обрати
          повне видалення або анонімізацію (ім'я замінюється на «Анонімний спостерігач», координати й нотатки вилучаються). Ідентифікатор у журналі аудиту буде знеособлено.
        </p>
        <div><button type="button" className="btn btn--danger btn--sm" onClick={() => setOpen(true)}>Видалити обліковий запис</button></div>
      </section>

      {open && (
        <Modal title={steps ? "Обліковий запис видалено" : "Видалити обліковий запис?"} onClose={() => { if (steps) { void logout(); navigate("/map"); } else setOpen(false); }}>
          {steps ? (
            <>
              <ol className="small">
                {steps.map((s) => <li key={s.step}><strong>{s.action}</strong> ({s.data}): {s.result}</li>)}
              </ol>
              <div className="modal__actions">
                <button type="button" className="btn btn--primary btn--sm" onClick={() => { void logout(); navigate("/map"); }}>Готово</button>
              </div>
            </>
          ) : (
            <>
              <div className="stack">
                <label className="checkbox"><input type="radio" name="mode" checked={mode === "delete"} onChange={() => setMode("delete")} />
                  <span><strong>Видалити все</strong> — списки, журнал, знімки й досягнення буде видалено повністю</span></label>
                <label className="checkbox"><input type="radio" name="mode" checked={mode === "anonymize"} onChange={() => setMode("anonymize")} />
                  <span><strong>Анонімізувати</strong> — опубліковані знімки залишаться без імені автора (відповідно до ліцензії), записи журналу — без нотаток і координат</span></label>
              </div>
              <Input label={`Для підтвердження введіть ${email}`} name="confirm-email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} />
              {error && <p className="status-error small">{error}</p>}
              <div className="modal__actions">
                <button type="button" className="btn btn--outline btn--sm" onClick={() => setOpen(false)}>Скасувати</button>
                <button type="button" className="btn btn--danger btn--sm" disabled={!mode || confirmEmail.trim().toLowerCase() !== email} onClick={doDelete}>Видалити назавжди</button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const { user, ready } = useAuth();
  if (!ready) return <p className="muted">Завантаження…</p>;
  if (!user) return <GuestGate />;
  return <ProfileView key={user.id} />;
}

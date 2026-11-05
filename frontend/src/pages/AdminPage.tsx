import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import { adminApi } from "@/api/endpoints";
import type { AdminUser, AuditItem, CatalogVersion, QualityReport, SkyVersion } from "@/api/endpoints";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Tabs from "@/components/ui/Tabs";
import { useAuth } from "@/context/AuthContext";
import { ROLE_LABELS, fmtInt } from "@/utils/format";
import type { Role } from "@/types/userData";
import { fmtDateTime } from "@/utils/time";
import "./AdminPage.css";

type Tab = "import" | "sky" | "versions" | "audit" | "roles" | "retention" | "policies";

const RULES: Record<string, string> = {
  "QR-01": "Структура файлу", "QR-02": "Обов'язкові колонки / значення", "QR-03": "Діапазон RA", "QR-04": "Діапазон Dec",
  "QR-05": "Зоряна величина", "QR-06": "Відстань", "QR-07": "Запис Сонця", "QR-08": "Унікальність HIP",
  "QR-09": "Показник кольору", "QR-10": "Типи значень", "QR-11": "Версія каталогу",
};

/** Службові функції DG Admin */
export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("import");
  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Адміністрування даних</h1>
      </div>
      <Tabs small active={tab} onChange={setTab} tabs={[
        { value: "import", label: "Імпорт каталогу" }, { value: "sky", label: "Лінії сузір'їв" },
        { value: "versions", label: "Версії та звіти" }, { value: "audit", label: "Журнал аудиту" },
        { value: "roles", label: "Ролі" }, { value: "retention", label: "Очищення даних" },
        { value: "policies", label: "Політики доступу" },
      ]} />
      {tab === "import" && <ImportTab />}
      {tab === "sky" && <SkyTab />}
      {tab === "versions" && <VersionsTab />}
      {tab === "audit" && <AuditTab />}
      {tab === "roles" && <RolesTab />}
      {tab === "retention" && <RetentionTab />}
      {tab === "policies" && <PoliciesTab />}
    </div>
  );
}

// ------------------------------------------------------------------ UC-14
function ImportTab() {
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState({
    profile: "hipparcos",
    source: "Hipparcos Star Astronomy Catalog (Kaggle)",
    source_url: "https://www.kaggle.com/datasets/konivat/hipparcos-star-catalog",
    origin: "ESA, The Hipparcos and Tycho Catalogues (1997), CDS I/239",
    source_version: "",
    license: "CC0: Public Domain",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState<CatalogVersion | null>(null);
  const [done, setDone] = useState("");

  function setProfile(p: string) {
    setMeta(p === "hyg"
      ? { profile: "hyg", source: "HYG Database", source_url: "https://github.com/astronexus/HYG-Database", origin: "astronexus/HYG-Database", source_version: "v4.1", license: "CC BY-SA 4.0" }
      : { ...meta, profile: "hipparcos" });
  }

  async function upload() {
    if (!file) return setError("Оберіть CSV-файл");
    setBusy(true);
    setError("");
    setDone("");
    try {
      setVersion(await adminApi.importCatalog(file, meta));
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}${e.code ? ` (${e.code})` : ""}` : "Помилка імпорту");
    } finally {
      setBusy(false);
    }
  }

  async function decide(confirm: boolean) {
    if (!version) return;
    try {
      const v = confirm ? await adminApi.confirm(version.id) : await adminApi.cancel(version.id);
      setDone(confirm ? "Нову версію каталогу активовано. Попередня версія збережена для відновлення." : "Імпорт скасовано, чинний каталог не змінено.");
      setVersion({ ...version, status: v.status });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Помилка");
    }
  }

  const set = (k: keyof typeof meta, v: string) => setMeta((m) => ({ ...m, [k]: v }));

  return (
    <div className="admin__grid">
      <section className="panel box">
        <h2 className="box__title">Новий імпорт (CSV)</h2>
        <div className="field">
          <label className="field__label" htmlFor="profile">Профіль імпорту</label>
          <Select id="profile" size="lg" value={meta.profile} onChange={setProfile}
            options={[
              { value: "hipparcos", label: "Hipparcos (Kaggle)", hint: "RAdeg/DEdeg у градусах, паралакс Plx" },
              { value: "hyg", label: "HYG Database v4", hint: "ra у годинах, відстань dist у парсеках" },
            ]} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="csv">Файл</label>
          <input id="csv" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <Input label="Назва джерела" name="source" value={meta.source} onChange={(e) => set("source", e.target.value)} />
        <Input label="Адреса отримання (сторінка завантаження)" name="source_url" value={meta.source_url} onChange={(e) => set("source_url", e.target.value)} />
        <Input label="Першоджерело" name="origin" value={meta.origin} onChange={(e) => set("origin", e.target.value)} />
        <Input label="Версія джерела або дата завантаження" name="source_version" placeholder="kaggle-hipparcos-main-2026-10"
          value={meta.source_version} onChange={(e) => set("source_version", e.target.value)} />
        <Input label="Ліцензія" name="license" value={meta.license} onChange={(e) => set("license", e.target.value)} />
        {error && <p className="status-error small">{error}</p>}
        <button type="button" className="btn btn--primary btn--sm" onClick={upload} disabled={busy}>
          {busy ? "Перевірка якості…" : "Перевірити та підготувати версію"}
        </button>
        <p className="muted xsmall">Чинний каталог не змінюється до підтвердження. Також доступний CLI: python -m app.cli import-catalog.</p>
      </section>

      <section className="panel box">
        <h2 className="box__title">Звіт про якість імпорту</h2>
        {!version ? <p className="muted small">Звіт з'явиться після перевірки файлу.</p> : (
          <>
            <ReportView report={version.report} />
            {done && <p className="notice notice--ok small">{done}</p>}
            {version.status === "pending" && (
              <div className="row">
                <button type="button" className="btn btn--primary btn--sm" onClick={() => decide(true)}
                  disabled={version.report.accepted + version.report.accepted_with_warnings === 0}>
                  Підтвердити: активувати {fmtInt(version.report.accepted + version.report.accepted_with_warnings)} записів
                </button>
                <button type="button" className="btn btn--outline btn--sm" onClick={() => decide(false)}>Скасувати імпорт</button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function ReportView({ report }: { report: QualityReport }) {
  return (
    <div className="stack">
      <dl className="kv admin__kv">
        <div><dt>report_id</dt><dd>{report.report_id}</dd></div>
        <div><dt>import_date</dt><dd>{fmtDateTime(report.import_date)}</dd></div>
        <div><dt>source / source_version</dt><dd>{report.source} · {report.source_version}</dd></div>
        <div><dt>file_name</dt><dd>{report.file_name}</dd></div>
        <div><dt>total_records</dt><dd>{fmtInt(report.total_records)}</dd></div>
        <div><dt>accepted</dt><dd className="status-ok">{fmtInt(report.accepted)}</dd></div>
        <div><dt>accepted_with_warnings</dt><dd>{fmtInt(report.accepted_with_warnings)}</dd></div>
        <div><dt>rejected</dt><dd className={report.rejected ? "status-error" : ""}>{fmtInt(report.rejected)}</dd></div>
        <div><dt>status</dt><dd>{report.status}</dd></div>
        <div><dt>duration_seconds</dt><dd>{report.duration_seconds}</dd></div>
        <div><dt>SHA-256</dt><dd className="mono">{report.checksum_sha256}</dd></div>
      </dl>
      <p className="muted xsmall">Перевірка: total_records = accepted + accepted_with_warnings + rejected
        ({fmtInt(report.accepted + report.accepted_with_warnings + report.rejected)}).</p>
      {report.import_warnings?.map((w) => <p key={w.rule_id} className="notice small">{w.rule_id}: {w.message}</p>)}
      {Object.keys(report.violations).length > 0 && (
        <table className="table">
          <thead><tr><th>Правило</th><th>Опис</th><th>Порушень</th><th>Записів</th></tr></thead>
          <tbody>
            {Object.entries(report.violations).map(([k, v]) => (
              <tr key={k}><td>{k}</td><td>{RULES[k]}</td><td>{fmtInt(v.count)}</td><td>{fmtInt(v.records)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {report.transformations && Object.keys(report.transformations).length > 0 && (
        <p className="small">Перетворення: {Object.entries(report.transformations).map(([k, v]) => `${k} — ${fmtInt(v)}`).join("; ")}</p>
      )}
      {report.issues && report.issues.length > 0 && (
        <details>
          <summary className="small">Проблемні рядки ({report.issues.length}{report.issues_truncated ? "+" : ""})</summary>
          <div className="table-wrap admin__issues">
            <table className="table">
              <thead><tr><th>Рядок</th><th>Поле</th><th>Правило</th><th>Рівень</th><th>Причина</th></tr></thead>
              <tbody>
                {report.issues.map((i, n) => (
                  <tr key={n}><td>{i.row}</td><td>{i.field}</td><td>{i.rule_id}</td>
                    <td className={i.level === "error" ? "status-error" : ""}>{i.level === "error" ? "помилка" : "попередження"}</td><td>{i.message}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ UC-18
function SkyTab() {
  const [file, setFile] = useState<File | null>(null);
  const [ver, setVer] = useState("");
  const [result, setResult] = useState<SkyVersion | null>(null);
  const [list, setList] = useState<SkyVersion[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => setList(await adminApi.skyVersions()), []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- завантаження версій
    void load();
  }, [load]);

  async function upload() {
    setError("");
    if (!file) return setError("Оберіть index.json");
    try {
      setResult(await adminApi.importSky(file, { source_version: ver }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Помилка");
    }
  }

  return (
    <div className="admin__grid">
      <section className="panel box">
        <h2 className="box__title">Імпорт Stellarium Sky Cultures</h2>
        <p className="muted small">Файл index.json культури «modern»: лінії сузір'їв за Hipparcos ID, межі IAU, власні назви зір. HIP звіряються з чинним каталогом.</p>
        <input type="file" accept=".json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Input label="Версія набору" name="skyver" value={ver} placeholder="stellarium-master-2026-11" onChange={(e) => setVer(e.target.value)} />
        {error && <p className="status-error small">{error}</p>}
        <button type="button" className="btn btn--primary btn--sm" onClick={upload}>Перевірити</button>
        {result && (
          <div className="stack">
            <pre className="mono admin__pre">{JSON.stringify(result.report, null, 2)}</pre>
            {result.status === "pending" && (
              <div className="row">
                <button type="button" className="btn btn--primary btn--sm" onClick={async () => { setResult(await adminApi.skyConfirm(result.id)); await load(); }}>Підтвердити</button>
                <button type="button" className="btn btn--outline btn--sm" onClick={async () => { setResult(await adminApi.skyCancel(result.id)); await load(); }}>Скасувати</button>
              </div>
            )}
          </div>
        )}
      </section>
      <section className="panel box table-wrap">
        <h2 className="box__title">Версії даних сузір'їв</h2>
        <table className="table">
          <thead><tr><th>Статус</th><th>Версія</th><th>Сузір'їв</th><th>HIP знайдено / ні</th><th>Імпорт</th></tr></thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id}><td>{v.status}</td><td>{v.source_version}</td><td>{String(v.report.constellations ?? "")}</td>
                <td>{String(v.report.hip_matched ?? "")} / {String(v.report.hip_unmatched ?? "")}</td><td>{fmtDateTime(v.imported_at)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ версії
function VersionsTab() {
  const [list, setList] = useState<CatalogVersion[]>([]);
  const [open, setOpen] = useState<CatalogVersion | null>(null);
  useEffect(() => {
    adminApi.versions().then(setList).catch(() => undefined);
  }, []);
  return (
    <div className="stack">
      <section className="panel box table-wrap">
        <p className="muted small">Зберігаються поточна та попередня версії каталогу разом зі звітами (DG-7).</p>
        <table className="table">
          <thead><tr><th>Статус</th><th>Партія</th><th>Джерело / версія</th><th>Прийнято</th><th>Відхилено</th><th>Імпорт</th><th /></tr></thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id}>
                <td><span className={"tag " + (v.status === "active" ? "tag--ok" : "")}>{v.status}</span></td>
                <td className="mono">{v.batch_id}</td>
                <td>{v.source} · {v.source_version}</td>
                <td>{fmtInt((v.report.accepted ?? 0) + (v.report.accepted_with_warnings ?? 0))}</td>
                <td>{fmtInt(v.report.rejected ?? 0)}</td>
                <td>{fmtDateTime(v.imported_at)}</td>
                <td><button type="button" className="link-btn" onClick={async () => setOpen(await adminApi.version(v.id))}>Звіт</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {open && <section className="panel box"><ReportView report={open.report} /></section>}
    </div>
  );
}

// ------------------------------------------------------------------ UC-15
function AuditTab() {
  const [f, setF] = useState({ date_from: "", date_to: "", actor_id: "", event_code: "", result: "", object_id: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: AuditItem[]; events: Record<string, string>; empty_message: string | null } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [verify, setVerify] = useState<string>("");

  const load = useCallback(async (p: number, filters: typeof f) => {
    setErrors({});
    const params: Record<string, string | number> = { page: p, page_size: 50 };
    for (const [k, v] of Object.entries(filters)) if (v) params[k] = k.startsWith("date") ? new Date(v).toISOString() : v;
    try {
      setData(await adminApi.audit(params));
      setPage(p);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErrors(e.byField());
      else setErrors({ _: e instanceof Error ? e.message : "Помилка" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- перше завантаження журналу
    void load(1, { date_from: "", date_to: "", actor_id: "", event_code: "", result: "", object_id: "" });
  }, [load]);

  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const pages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;

  return (
    <div className="stack">
      <section className="panel box">
        <div className="admin__filters">
          <Input label="Від" name="af" type="datetime-local" value={f.date_from} onChange={(e) => set("date_from", e.target.value)} error={errors.date_from} />
          <Input label="До" name="at" type="datetime-local" value={f.date_to} onChange={(e) => set("date_to", e.target.value)} error={errors.date_to} />
          <Input label="Користувач (actor_id)" name="aa" value={f.actor_id} onChange={(e) => set("actor_id", e.target.value)} />
          <div className="field">
            <label className="field__label" htmlFor="ae">Тип події</label>
            <Select id="ae" size="lg" value={f.event_code} onChange={(v) => set("event_code", v)} searchable menuWidth={360}
              searchPlaceholder="Код або назва події"
              options={[{ value: "", label: "Усі події" }, ...Object.entries(data?.events ?? {}).map(([k, v]) => ({ value: k, label: v, meta: k }))]} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="ar">Результат</label>
            <Select id="ar" size="lg" value={f.result} onChange={(v) => set("result", v)}
              options={[
                { value: "", label: "Усі результати" },
                { value: "SUCCESS", label: "Успішно", meta: "SUCCESS" },
                { value: "DENIED", label: "Відмовлено в доступі", meta: "DENIED" },
                { value: "ERROR", label: "Помилка", meta: "ERROR" },
              ]} />
          </div>
          <Input label="Ідентифікатор об'єкта" name="ao" value={f.object_id} onChange={(e) => set("object_id", e.target.value)} />
        </div>
        <div className="row">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => load(1, f)}>Застосувати фільтри</button>
          <button type="button" className="btn btn--outline btn--sm" onClick={async () => {
            const r = await adminApi.verify();
            setVerify(r.valid ? `Ланцюжок хешів цілісний: перевірено ${fmtInt(r.checked)} записів` : `Порушення цілісності на записі ${r.broken_at}`);
          }}>Перевірити цілісність</button>
          {verify && <span className="small">{verify}</span>}
        </div>
        {errors._ && <p className="status-error small">{errors._}</p>}
        <p className="muted xsmall">Журнал лише для читання. Паролі, токени, email, точні координати й вміст нотаток не зберігаються.</p>
      </section>

      <section className="panel box table-wrap">
        {data && data.total === 0 && <p className="muted">{data.empty_message}</p>}
        {data && data.total > 0 && (
          <>
            <table className="table admin__audit">
              <thead><tr><th>timestamp_utc</th><th>event_code</th><th>actor</th><th>object</th><th>result</th><th>failure_reason</th><th>masked_ip</th><th>details</th></tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.audit_id}>
                    <td>{fmtDateTime(r.timestamp_utc)}</td>
                    <td title={r.event_name}>{r.event_code}<br /><span className="muted xsmall">{r.event_name}</span></td>
                    <td><span className="mono">{r.actor_id ?? "—"}</span><br /><span className="muted xsmall">{ROLE_LABELS[r.actor_role] ?? r.actor_role}</span></td>
                    <td>{r.object_type}<br /><span className="mono">{r.object_id ?? ""}</span></td>
                    <td className={r.result === "SUCCESS" ? "status-ok" : "status-error"}>{r.result}</td>
                    <td>{r.failure_reason ?? ""}</td>
                    <td>{r.masked_ip ?? ""}</td>
                    <td className="mono">{Object.keys(r.details).length ? JSON.stringify(r.details) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <button type="button" className="btn btn--outline btn--sm" disabled={page <= 1} onClick={() => load(page - 1, f)}>←</button>
              <span className="small">Сторінка {page} з {pages} · записів {fmtInt(data.total)}</span>
              <button type="button" className="btn btn--outline btn--sm" disabled={page >= pages} onClick={() => load(page + 1, f)}>→</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ ролі
function RolesTab() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [msg, setMsg] = useState("");
  const load = useCallback(async (s: string) => setUsers(await adminApi.users(s)), []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- завантаження користувачів
    void load("");
  }, [load]);

  return (
    <section className="panel box table-wrap">
      <div className="row">
        <input className="field__input admin__search" placeholder="Пошук за email" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn btn--outline btn--sm" onClick={() => load(q)}>Знайти</button>
        {msg && <span className="small">{msg}</span>}
      </div>
      <table className="table">
        <thead><tr><th>Email</th><th>Роль</th><th>Зареєстровано</th><th>Остання активність</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>
                <Select<Role> size="sm" className="admin__role" value={u.role as Role} disabled={u.id === user?.id} aria-label={`Роль ${u.email}`}
                  menuWidth={260}
                  options={[
                    { value: "OBSERVER", label: "Спостерігач", hint: "Особисті списки, журнал, знімки" },
                    { value: "MODERATOR", label: "Модератор", hint: "Черга знімків і скарг" },
                    { value: "DG_ADMIN", label: "Адміністратор даних", hint: "Імпорт, аудит, ролі, зберігання" },
                  ]}
                  onChange={async (role) => {
                    try {
                      await adminApi.setRole(u.id, role);
                      setMsg(`Роль ${u.email} змінено`);
                      await load(q);
                    } catch (err) {
                      setMsg(err instanceof Error ? err.message : "Помилка");
                    }
                  }} />
              </td>
              <td>{fmtDateTime(u.created_at)}</td>
              <td>{fmtDateTime(u.last_active_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted xsmall">Змінити власну роль неможливо (AP-06). Кожна зміна фіксується в аудиті (AUD-14).</p>
    </section>
  );
}

// ------------------------------------------------------------------ DG-7
function RetentionTab() {
  const [ops, setOps] = useState<{ id: string; title: string }[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [asOf, setAsOf] = useState("");
  const [result, setResult] = useState<{ dry_run: boolean; as_of: string; results: Record<string, Record<string, unknown>> } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminApi.retentionOps().then((o) => { setOps(o); setSel(o.map((x) => x.id)); }).catch(() => undefined);
  }, []);

  async function run(dry: boolean) {
    setError("");
    try {
      setResult(await adminApi.retentionRun(sel, dry, asOf ? new Date(asOf).toISOString() : undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Помилка");
    }
  }

  return (
    <div className="admin__grid">
      <section className="panel box">
        <h2 className="box__title">Ручний запуск очищення</h2>
        <p className="muted small">Система перевіряє строки зберігання (табл. 2.33) і видаляє або анонімізує записи, строк яких минув. Спершу перегляньте результат без змін.</p>
        {ops.map((o) => (
          <label key={o.id} className="checkbox">
            <input type="checkbox" checked={sel.includes(o.id)} onChange={(e) => setSel((s) => e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id))} />
            <span>{o.title}</span>
          </label>
        ))}
        <Input label="Дата перевірки (для демонстрації можна вказати майбутню)" name="asof" type="datetime-local" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        {error && <p className="status-error small">{error}</p>}
        <div className="row">
          <button type="button" className="btn btn--outline btn--sm" onClick={() => run(true)}>Переглянути (без змін)</button>
          <button type="button" className="btn btn--danger btn--sm" onClick={() => run(false)}>Виконати очищення</button>
        </div>
      </section>
      <section className="panel box">
        <h2 className="box__title">Результат</h2>
        {!result ? <p className="muted small">Ще не запускалося.</p> : (
          <>
            <p className="small">{result.dry_run ? "Перегляд без змін" : "Очищення виконано"} · станом на {fmtDateTime(result.as_of)}</p>
            <table className="table">
              <thead><tr><th>Операція</th><th>Записів</th><th>Примітка</th></tr></thead>
              <tbody>
                {Object.entries(result.results).map(([k, v]) => (
                  <tr key={k}><td>{ops.find((o) => o.id === k)?.title ?? k}</td><td>{String(v.affected)}</td>
                    <td className="small">{[v.note, v.action, v.notified != null ? `повідомлено: ${v.notified}, видалено: ${v.deleted}` : null].filter(Boolean).join("; ")}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ політики
function PoliciesTab() {
  const [p, setP] = useState<Awaited<ReturnType<typeof adminApi.policies>> | null>(null);
  useEffect(() => {
    adminApi.policies().then(setP).catch(() => undefined);
  }, []);
  if (!p) return <p className="muted">Завантаження…</p>;
  return (
    <div className="stack">
      <section className="panel box table-wrap">
        <h2 className="box__title">Матриця прав доступу (RBAC)</h2>
        <table className="table">
          <thead><tr><th>Дія / ресурс</th><th>Дані</th>{p.roles.map((r) => <th key={r}>{r}</th>)}</tr></thead>
          <tbody>
            {p.rbac.map((r) => (
              <tr key={r.action}><td>{r.action}</td><td>{r.data}</td><td>{r.guest}</td><td>{r.observer}</td><td>{r.moderator}</td><td>{r.admin}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="muted xsmall">✅ — дозволено, ❌ — заборонено, 🔸 — лише власні дані.</p>
      </section>
      <section className="panel box table-wrap">
        <h2 className="box__title">Атрибутні умови (ABAC)</h2>
        <table className="table">
          <thead><tr><th>ID</th><th>Умова</th><th>При порушенні</th></tr></thead>
          <tbody>{p.abac.map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.rule}</td><td>{r.on_violation}</td></tr>)}</tbody>
        </table>
      </section>
      <section className="panel box">
        <h2 className="box__title">Налаштування правил</h2>
        <dl className="kv">{Object.entries(p.settings).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <p className="muted xsmall">{p.note}</p>
      </section>
    </div>
  );
}

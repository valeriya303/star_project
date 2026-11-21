import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import { Link } from "react-router-dom";

import { ApiError, fileUrl } from "@/api/client";
import { consentApi, meApi, photosApi } from "@/api/endpoints";
import type { PhotoMeta, PhotoOptions } from "@/api/endpoints";
import Icon from "@/components/brand/Icon";
import type { IconName } from "@/components/brand/Icon";
import ConsentDialog from "@/components/consent/ConsentDialog";
import Term from "@/components/help/Term";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import type { SelectOption } from "@/components/ui/Select";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import { useConsentTexts } from "@/hooks/useConsentTexts";
import type { LevelInfo, Photo, Reward } from "@/types/userData";
import { LICENSE_LINKS } from "@/utils/format";
import { imageSize, sniffImage } from "@/utils/image";
import { fmtDate, fmtDateTime, todayIso } from "@/utils/time";
import "./GalleryPage.css";

type Rewards = LevelInfo & { daily_limit: number; points_per_photo: number; history: Reward[] };
type Filter = "all" | "internal" | "submitted" | "public" | "rejected";

const emptyMeta = (author: string): PhotoMeta => ({
  title: "", constellation: "", date_taken: todayIso(), author, anonymous: false, license: "",
  description: "", rights_confirmed: false, keep_gps: false,
});

/** Стан знімка для показу: назва, іконка, колір і до якого фільтра належить */
function statusOf(p: Photo): { key: Filter; label: string; icon: IconName; tone: "muted" | "warn" | "ok" | "bad" } {
  if (p.status === "approved") {
    return p.is_public
      ? { key: "public", label: "Опубліковано", icon: "globe", tone: "ok" }
      : { key: "public", label: p.hidden_reason === "complaint_upheld" ? "Приховано за скаргою" : "Схвалено, приховано", icon: "eye", tone: "warn" };
  }
  if (p.status === "submitted") return { key: "submitted", label: "На модерації", icon: "clock", tone: "warn" };
  if (p.status === "rejected") return { key: "rejected", label: "Відхилено", icon: "x", tone: "bad" };
  return { key: "internal", label: "Приватний", icon: "lock", tone: "muted" };
}

const FLOW: { key: Exclude<Filter, "all" | "rejected">; title: string; text: ReactNode; icon: IconName; hint?: boolean }[] = [
  { key: "internal", title: "Завантаження", text: "Знімок бачите лише ви", icon: "upload" },
  { key: "submitted", title: "Подання й модерація", text: "Ваша згода C-02 і перевірка модератором", icon: "shield", hint: true },
  { key: "public", title: "Публікація", text: "Знімок у галереї спільноти, +50 балів", icon: "globe" },
];

/** UC-10 (завантаження), UC-22 (подання), UC-24 (публікація), UC-12 (винагороди) */
export default function GalleryPage() {
  const { user } = useAuth();
  const { constellations } = useCatalog();
  const texts = useConsentTexts();
  const defaultAuthor = user?.display_name || user?.email.split("@")[0] || "";

  const [options, setOptions] = useState<PhotoOptions | null>(null);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileDims, setFileDims] = useState<{ width: number; height: number } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [meta, setMeta] = useState<PhotoMeta>(() => emptyMeta(defaultAuthor));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [info, setInfo] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [submitFor, setSubmitFor] = useState<Photo | null>(null);
  const [republishFor, setRepublishFor] = useState<Photo | null>(null);
  const [editFor, setEditFor] = useState<Photo | null>(null);
  const [confirm, setConfirm] = useState<{ photo: Photo; kind: "delete" | "hide" } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLElement>(null);
  const libraryRef = useRef<HTMLElement>(null);

  const ukName = useMemo(() => new Map(constellations.map((c) => [c.latin, c.name])), [constellations]);
  const conOptions = useMemo<SelectOption[]>(
    () => (options?.constellations ?? [])
      .map((l) => ({ value: l, label: ukName.get(l) ?? l, hint: l }))
      .sort((a, b) => a.label.localeCompare(b.label, "uk")),
    [options, ukName],
  );

  const load = useCallback(async () => {
    const [p, r] = await Promise.all([photosApi.mine(), meApi.rewards()]);
    setPhotos(p);
    setRewards(r);
  }, []);

  useEffect(() => {
    photosApi.options().then(setOptions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- завантаження знімків
    void load();
  }, [load]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const set = <K extends keyof PhotoMeta>(k: K, v: PhotoMeta[K]) => setMeta((m) => ({ ...m, [k]: v }));

  // Попередня перевірка в браузері (QR-12…QR-14); остаточна — на сервері
  async function pick(f: File | null) {
    if (!f) return;
    setInfo(null);
    const e: Record<string, string> = {};
    let dims: { width: number; height: number } | null = null;
    const mime = await sniffImage(f);
    if (!mime) e.file = "Допускаються лише JPEG та PNG (QR-12)";
    else if (f.size > (options?.max_bytes ?? 10485760)) e.file = "Файл більший за 10 МБ (QR-13)";
    else {
      try {
        dims = await imageSize(f);
        if (dims.width < 800 || dims.height < 600) e.file = `Роздільна здатність ${dims.width}×${dims.height}; потрібно щонайменше 800×600 (QR-14)`;
      } catch {
        e.file = "Не вдалося прочитати зображення";
      }
    }
    setErrors(e);
    if (e.file) {
      clearFile();
      return;
    }
    setFile(f);
    setFileDims(dims);
    setPreview(URL.createObjectURL(f));
    if (!meta.title) set("title", f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 200));
  }

  function clearFile() {
    setFile(null);
    setFileDims(null);
    setPreview(null);
  }

  function startUpload() {
    uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    fileInput.current?.click();
  }

  /** Крок «Шлях знімка»: фільтрує бібліотеку і прокручує до неї; повторний тап знімає фільтр */
  function pickStep(key: Filter) {
    const next: Filter = filter === key ? "all" : key;
    setFilter(next);
    if (next !== "all") libraryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleSubmit() {
    const e: Record<string, string> = {};
    if (!file) e.file = "Оберіть файл знімка";
    if (!meta.title.trim()) e.title = "Вкажіть назву (QR-17)";
    if (!meta.constellation) e.constellation = "Оберіть сузір'я (QR-15)";
    if (!meta.date_taken) e.date_taken = "Вкажіть дату зйомки (QR-17)";
    else if (meta.date_taken > todayIso()) e.date_taken = "Дата зйомки не може бути пізнішою за поточну (QR-16)";
    if (!meta.anonymous && !meta.author.trim()) e.author = "Вкажіть автора або оберіть «Анонімно» (QR-17)";
    if (!meta.license) e.license = "Оберіть ліцензію (QR-18)";
    if (!meta.rights_confirmed) e.rights_confirmed = "Підтвердьте права на знімок (QR-19)";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const p = await photosApi.upload(file!, meta);
      setInfo({
        tone: "ok",
        text: p.gps_removed
          ? "Знімок збережено як приватний. GPS-координати видалено з файлу. Тепер його можна подати на публікацію."
          : "Знімок збережено як приватний. Тепер його можна подати на публікацію.",
      });
      clearFile();
      setMeta(emptyMeta(defaultAuthor));
      setFilter("all");
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setErrors(err.byField());
      else setErrors({ _: err instanceof Error ? err.message : "Не вдалося завантажити" });
    } finally {
      setBusy(false);
    }
  }

  async function run(f: () => Promise<unknown>, ok?: string) {
    setInfo(null);
    try {
      await f();
      await load();
      if (ok) setInfo({ tone: "ok", text: ok });
    } catch (e) {
      setInfo({ tone: "error", text: e instanceof Error ? e.message : "Помилка" });
    }
  }

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, internal: 0, submitted: 0, public: 0, rejected: 0 };
    for (const p of photos ?? []) {
      c.all++;
      c[statusOf(p).key]++;
    }
    return c;
  }, [photos]);

  const shown = (photos ?? []).filter((p) => filter === "all" || statusOf(p).key === filter);
  const c03 = texts("C-03");
  const licenseOptions: SelectOption[] = (options?.licenses ?? []).map((l) => {
    const [label, hint] = l.title.split(" — ");
    return { value: l.id, label, hint };
  });

  return (
    <div className="studio">
      {/* ---------- Банер з рівнем ---------- */}
      <section className="studio__hero">
        <svg className="studio__deco" viewBox="0 0 420 200" aria-hidden="true">
          <polyline points="20,160 90,120 150,140 210,70 290,90 360,30 400,55" />
          {[[20, 160, 3], [90, 120, 4], [150, 140, 2.5], [210, 70, 5], [290, 90, 3.5], [360, 30, 4.5], [400, 55, 2.5]].map(([x, y, r]) => (
            <circle key={x} cx={x} cy={y} r={r} />
          ))}
        </svg>
        <div className="studio__intro">
          <p className="studio__eyebrow"><Icon name="camera" size={14} /> Особиста астрогалерея</p>
          <h1 className="studio__title">Мої знімки</h1>
          <p className="studio__lead">
            Завантажуйте фотографії сузір'їв. Спершу знімок приватний. Його бачать інші, лише якщо ви самі подасте його на публікацію
            і модератор його схвалить.
          </p>
          <div className="studio__cta">
            <button type="button" className="btn btn--primary btn--sm" onClick={startUpload}>
              <Icon name="upload" size={16} /> Завантажити знімок
            </button>
            <Link to="/community" className="btn btn--outline btn--sm"><Icon name="gallery" size={16} /> Галерея спільноти</Link>
            <Link to="/help#guide-photos" className="studio__link">Як працює публікація?</Link>
          </div>
        </div>

        <LevelCard rewards={rewards} />
      </section>

      {/* ---------- Шлях знімка ---------- */}
      <ol className="studio__flow" aria-label="Шлях знімка до публікації">
        {FLOW.map((s, i) => (
          <li key={s.key}>
            <button type="button" className={"flow-step" + (filter === s.key ? " flow-step--active" : "")}
              onClick={() => pickStep(s.key)} aria-pressed={filter === s.key}>
              <span className="flow-step__num">{i + 1}</span>
              <span className="flow-step__icon"><Icon name={s.icon} size={18} /></span>
              <span className="flow-step__body">
                <strong>{s.title}</strong>
                <span>{s.text}</span>
              </span>
              <span className="flow-step__count" aria-label="кількість знімків">{counts[s.key]}</span>
            </button>
            {s.hint && (
              <p className="flow-step__hint">
                <Term id="consents">Що таке згода C-02</Term>
              </p>
            )}
          </li>
        ))}
      </ol>

      {info && <p className={"notice small " + (info.tone === "ok" ? "notice--ok" : "notice--error")} role="status">{info.text}</p>}

      <div className="studio__body">
        {/* ---------- Форма завантаження ---------- */}
        <section ref={uploadRef} className="panel studio__upload" aria-labelledby="upload-title">
          <header className="studio__box-head">
            <span className="studio__box-icon"><Icon name="upload" size={18} /></span>
            <div>
              <h2 id="upload-title" className="studio__h">Новий знімок</h2>
              <p className="muted xsmall">Після завантаження знімок приватний</p>
            </div>
          </header>

          {!preview ? (
            <label className={"dropzone" + (dragOver ? " dropzone--over" : "") + (errors.file ? " dropzone--error" : "")}
              onDragOver={(e: DragEvent) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e: DragEvent<HTMLLabelElement>) => { e.preventDefault(); setDragOver(false); void pick(e.dataTransfer.files?.[0] ?? null); }}>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png" hidden
                onChange={(e: ChangeEvent<HTMLInputElement>) => { void pick(e.target.files?.[0] ?? null); e.target.value = ""; }} />
              <span className="dropzone__icon"><Icon name="upload" size={26} /></span>
              <strong className="dropzone__title">Перетягніть знімок сюди</strong>
              <span className="dropzone__sub">або <u>оберіть файл</u> на пристрої</span>
              <span className="dropzone__reqs">
                <span>JPEG або PNG</span><span>до 10 МБ</span><span>від 800 × 600</span>
              </span>
            </label>
          ) : (
            <div className="upload-preview">
              <img src={preview} alt="Попередній перегляд" />
              <div className="upload-preview__bar">
                <span className="upload-preview__name">
                  <strong>{file?.name}</strong>
                  <span>
                    {file && `${(file.size / 1048576).toFixed(1).replace(".", ",")} МБ`}
                    {fileDims && ` · ${fileDims.width} × ${fileDims.height} px`}
                  </span>
                </span>
                <button type="button" className="icon-btn" onClick={clearFile} title="Обрати інший файл" aria-label="Прибрати файл">
                  <Icon name="x" size={16} />
                </button>
              </div>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png" hidden
                onChange={(e: ChangeEvent<HTMLInputElement>) => { void pick(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            </div>
          )}
          {errors.file && <span className="field__error">{errors.file}</span>}

          <Input label="Назва" name="title" maxLength={200} placeholder="Напр. Оріон над Карпатами" value={meta.title}
            onChange={(e) => set("title", e.target.value)} error={errors.title} />

          <div className="field">
            <label className="field__label" htmlFor="constellation">Сузір'я на знімку</label>
            <Select id="constellation" value={meta.constellation} onChange={(v) => set("constellation", v)} options={conOptions}
              placeholder="Оберіть одне з 88 сузір'їв" searchable searchPlaceholder="Українською або латиною"
              error={!!errors.constellation} icon={<Icon name="star" size={15} />} />
            {errors.constellation && <span className="field__error">{errors.constellation}</span>}
          </div>

          <div className="studio__pair">
            <Input label="Дата зйомки" name="date_taken" type="date" max={todayIso()} value={meta.date_taken}
              onChange={(e) => set("date_taken", e.target.value)} error={errors.date_taken} />
            <LicenseSelect options={licenseOptions} value={meta.license} onChange={(v) => set("license", v)} error={errors.license} />
          </div>

          <div className="field">
            <span className="field__label">Авторство</span>
            <div className="segmented studio__seg" role="group" aria-label="Авторство">
              <button type="button" aria-pressed={!meta.anonymous} onClick={() => set("anonymous", false)}>Під своїм ім'ям</button>
              <button type="button" aria-pressed={meta.anonymous} onClick={() => set("anonymous", true)}>Анонімно</button>
            </div>
            {!meta.anonymous ? (
              <input className={"field__input" + (errors.author ? " field__input--error" : "")} aria-label="Ім'я автора" maxLength={200}
                value={meta.author} onChange={(e) => set("author", e.target.value)} placeholder="Ім'я, яке побачать інші" />
            ) : (
              <span className="field__hint">У галереї буде підпис «Анонімний спостерігач»</span>
            )}
            {errors.author && <span className="field__error">{errors.author}</span>}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="desc">Опис <span className="muted xsmall">(необов'язково)</span></label>
            <textarea id="desc" className="field__input field__input--area" maxLength={2000} value={meta.description}
              placeholder="Обладнання, експозиція, умови зйомки…" onChange={(e) => set("description", e.target.value)} />
          </div>

          <fieldset className="field gps-choice">
            <legend className="field__label">
              {c03?.title ?? "GPS-координати зі знімка"} <Term id="exif">EXIF</Term>
            </legend>
            <ChoiceCard checked={!meta.keep_gps} onSelect={() => set("keep_gps", false)} icon="shield"
              title={c03?.decline_label ?? "Видалити координати"} text="Рекомендовано. Місце зйомки не зберігається." />
            <ChoiceCard checked={meta.keep_gps} onSelect={() => set("keep_gps", true)} icon="pin"
              title={c03?.accept_label ?? "Дозволити збереження координат"} text="Координати бачите лише ви. Публічно їх не показують." />
            {c03?.text && <p className="field__hint">{c03.text}</p>}
          </fieldset>

          <label className={"checkbox studio__rights" + (errors.rights_confirmed ? " studio__rights--error" : "")}>
            <input type="checkbox" checked={meta.rights_confirmed} onChange={(e) => set("rights_confirmed", e.target.checked)} />
            <span>Підтверджую, що маю право передати цей знімок і дотримуюся умов обраної ліцензії</span>
          </label>
          {errors.rights_confirmed && <span className="field__error">{errors.rights_confirmed}</span>}
          {errors._ && <p className="status-error small">{errors._}</p>}

          <button type="button" className="btn btn--primary studio__submit" onClick={handleSubmit} disabled={busy}>
            <Icon name="upload" size={17} /> {busy ? "Перевірка й завантаження…" : "Завантажити знімок"}
          </button>
        </section>

        {/* ---------- Бібліотека ---------- */}
        <section ref={libraryRef} className="studio__library" aria-labelledby="library-title">
          <div className="studio__toolbar">
            <h2 id="library-title" className="studio__h2">Бібліотека <span className="muted">· {counts.all}</span></h2>
            <div className="filter-chips" role="group" aria-label="Фільтр за станом">
              {([
                ["all", "Усі"], ["internal", "Приватні"], ["submitted", "На модерації"], ["public", "Схвалені"], ["rejected", "Відхилені"],
              ] as [Filter, string][]).map(([k, label]) => (
                <button key={k} type="button" className="filter-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}
                  disabled={k !== "all" && counts[k] === 0}>
                  {label} <span className="filter-chip__count">{counts[k]}</span>
                </button>
              ))}
            </div>
          </div>

          {photos === null && <div className="studio__skeleton" aria-label="Завантаження">{[0, 1, 2].map((i) => <span key={i} />)}</div>}

          {photos && photos.length === 0 && (
            <div className="studio-empty">
              <svg viewBox="0 0 200 110" className="studio-empty__art" aria-hidden="true">
                <rect x="40" y="18" width="120" height="78" rx="10" />
                <polyline points="52,80 82,52 104,70 124,46 150,74" />
                {[[82, 52], [104, 70], [124, 46]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.2" />)}
                <circle cx="138" cy="34" r="6" className="studio-empty__moon" />
              </svg>
              <h3>Ваша бібліотека поки порожня</h3>
              <p>Завантажте перший знімок нічного неба. Коли модератор схвалить його й ви погодитеся на публікацію,
                він з'явиться в галереї спільноти, а вам нарахують бали.</p>
              <ul className="studio-empty__tips">
                <li><Icon name="check" size={14} /> Знімайте зі штатива, витримка 10–25 с</li>
                <li><Icon name="check" size={14} /> Оберіть сузір'я, яке є в кадрі</li>
                <li><Icon name="check" size={14} /> Від'їдьте від міських вогнів</li>
              </ul>
              <button type="button" className="btn btn--primary btn--sm" onClick={startUpload}><Icon name="upload" size={16} /> Обрати файл</button>
            </div>
          )}

          {photos && photos.length > 0 && shown.length === 0 && (
            <p className="muted small studio__none">Знімків у цьому стані немає. <button type="button" className="link-btn" onClick={() => setFilter("all")}>Показати всі</button></p>
          )}

          <div className="studio__grid">
            {shown.map((p) => {
              const st = statusOf(p);
              return (
                <article key={p.id} className="my-shot">
                  <a className="my-shot__media" href={fileUrl(p.full_url)} target="_blank" rel="noreferrer" aria-label={`Відкрити оригінал «${p.title}»`}>
                    <img src={fileUrl(p.thumb_url)} alt={p.title} loading="lazy" />
                    <span className={`my-shot__status my-shot__status--${st.tone}`}><Icon name={st.icon} size={13} /> {st.label}</span>
                    <span className="my-shot__con">{p.constellation_uk}</span>
                  </a>
                  <div className="my-shot__body">
                    <h3 className="my-shot__title" title={p.title}>{p.title}</h3>
                    <ul className="my-shot__meta">
                      <li><Icon name="calendar" size={13} /> {fmtDate(p.date_taken)}</li>
                      <li><Icon name="book" size={13} /> {p.license}</li>
                      {p.version && p.version > 1 && <li title="Метадані змінювалися">версія {p.version}</li>}
                      {p.gps_stored && <li className="my-shot__gps"><Icon name="pin" size={13} /> GPS збережено</li>}
                    </ul>

                    {p.status === "rejected" && (
                      <p className="my-shot__note my-shot__note--bad">
                        Причина: {p.reject_reason}. Знімок буде видалено через {p.retention_days_left} дн. Виправте й подайте знову.
                      </p>
                    )}
                    {p.status === "submitted" && (
                      <p className="my-shot__note">Чекає рішення модератора. Без рішення буде видалено через {p.retention_days_left} дн.</p>
                    )}
                    {p.hidden_reason === "complaint_upheld" && (
                      <p className="my-shot__note my-shot__note--bad">Приховано модератором після розгляду скарги.</p>
                    )}

                    <div className="my-shot__actions">
                      {(p.status === "internal" || p.status === "rejected") && (
                        <button type="button" className="btn btn--primary btn--sm" onClick={() => setSubmitFor(p)}>
                          <Icon name="send" size={15} /> Подати на публікацію
                        </button>
                      )}
                      {p.status === "submitted" && (
                        <button type="button" className="btn btn--outline btn--sm" onClick={() => run(() => photosApi.withdraw(p.id), "Знімок відкликано з модерації")}>
                          <Icon name="undo" size={15} /> Відкликати з модерації
                        </button>
                      )}
                      {p.status === "approved" && p.is_public && (
                        <button type="button" className="btn btn--outline btn--sm" onClick={() => setConfirm({ photo: p, kind: "hide" })}>
                          <Icon name="eye" size={15} /> Зняти з публікації
                        </button>
                      )}
                      {p.status === "approved" && !p.is_public && p.hidden_reason !== "complaint_upheld" && (
                        <button type="button" className="btn btn--primary btn--sm" onClick={() => setRepublishFor(p)}>
                          <Icon name="globe" size={15} /> Опублікувати знову
                        </button>
                      )}
                      <span className="my-shot__tools">
                      {(p.status === "internal" || p.status === "rejected") && (
                        <button type="button" className="icon-btn" onClick={() => setEditFor(p)} title="Редагувати метадані" aria-label="Редагувати">
                          <Icon name="edit" size={16} />
                        </button>
                      )}
                      {p.gps_stored && (
                        <button type="button" className="icon-btn" onClick={() => run(() => consentApi.revoke("C-03", p.id), "GPS-координати видалено з файлу")}
                          title="Видалити GPS-координати з файлу" aria-label="Видалити GPS">
                          <Icon name="pin" size={16} />
                        </button>
                      )}
                      <button type="button" className="icon-btn icon-btn--danger" onClick={() => setConfirm({ photo: p, kind: "delete" })}
                        title="Видалити знімок" aria-label="Видалити">
                        <Icon name="trash" size={16} />
                      </button>
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      {submitFor && (
        <SubmitDialog photo={submitFor} licenses={licenseOptions} onClose={() => setSubmitFor(null)}
          onDone={async () => { setSubmitFor(null); await load(); setInfo({ tone: "ok", text: "Знімок подано на модерацію. Рішення з'явиться тут." }); }} />
      )}

      {republishFor && (
        <ConsentDialog code="C-02" onDecline={() => setRepublishFor(null)} onAccept={async (t) => {
          const p = republishFor;
          setRepublishFor(null);
          await run(async () => { await consentApi.grant("C-02", t.version, p.id); await photosApi.republish(p.id); }, "Знімок знову опубліковано");
        }} />
      )}

      {editFor && <EditDialog photo={editFor} conOptions={conOptions} onClose={() => setEditFor(null)} onDone={async () => { setEditFor(null); await load(); }} />}

      {confirm && (
        <Modal title={confirm.kind === "delete" ? "Видалити знімок?" : "Зняти знімок з публікації?"} onClose={() => setConfirm(null)}>
          <p>
            {confirm.kind === "delete"
              ? `Знімок «${confirm.photo.title}» і його файли буде видалено без можливості відновлення.`
              : `Знімок «${confirm.photo.title}» зникне з галереї спільноти (ви відкликаєте згоду C-02). Повторна публікація потребуватиме нової згоди.`}
          </p>
          <div className="modal__actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setConfirm(null)}>Скасувати</button>
            <button type="button" className="btn btn--danger btn--sm" onClick={() => {
              const c = confirm;
              setConfirm(null);
              void run(
                () => (c.kind === "delete" ? photosApi.remove(c.photo.id) : consentApi.revoke("C-02", c.photo.id)),
                c.kind === "delete" ? "Знімок видалено" : "Знімок знято з публікації",
              );
            }}>{confirm.kind === "delete" ? "Видалити" : "Зняти з публікації"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LevelCard({ rewards }: { rewards: Rewards | null }) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const pct = rewards
    ? rewards.next ? Math.min(1, (rewards.points - rewards.prev_min) / (rewards.next - rewards.prev_min)) : 1
    : 0;
  return (
    <aside className="level-card" aria-label="Рівень спостерігача">
      <div className="level-card__ring">
        <svg viewBox="0 0 110 110" aria-hidden="true">
          <circle cx="55" cy="55" r={R} className="level-card__track" />
          <circle cx="55" cy="55" r={R} className="level-card__bar" strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 55 55)" />
        </svg>
        <span className="level-card__points">
          <strong>{rewards?.points ?? "—"}</strong>
          <span>балів</span>
        </span>
      </div>
      <div className="level-card__info">
        <span className="level-card__eyebrow">Ваш рівень</span>
        <strong className="level-card__name">{rewards?.level_name ?? "…"}</strong>
        <span className="level-card__next">
          {rewards ? (rewards.next ? `Ще ${rewards.next - rewards.points} балів до наступного рівня` : "Найвищий рівень досягнуто") : ""}
        </span>
        <span className="level-card__rule">
          <Icon name="spark" size={13} /> {rewards?.points_per_photo ?? 50} балів за схвалений знімок, до {rewards?.daily_limit ?? 3} на добу
        </span>
        {rewards && rewards.history.length > 0 && (
          <ul className="level-card__history">
            {rewards.history.slice(0, 3).map((r) => (
              <li key={r.id}>
                <span className={r.status === "credited" ? "level-card__plus" : "muted"}>{r.status === "credited" ? `+${r.points}` : "0"}</span>
                <span className="level-card__reason">{r.reason}</span>
                <time className="muted">{fmtDateTime(r.created_at)}</time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function ChoiceCard(p: { checked: boolean; onSelect: () => void; icon: IconName; title: string; text: string }) {
  return (
    <label className={"choice" + (p.checked ? " choice--on" : "")}>
      <input type="radio" name="gps-choice" checked={p.checked} onChange={p.onSelect} />
      <span className="choice__icon"><Icon name={p.icon} size={17} /></span>
      <span className="choice__body">
        <strong>{p.title}</strong>
        <span>{p.text}</span>
      </span>
      <span className="choice__radio" aria-hidden="true" />
    </label>
  );
}

function LicenseSelect(p: { options: SelectOption[]; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor="license"><Term id="license">Ліцензія</Term></label>
      <Select id="license" value={p.value} onChange={p.onChange} options={p.options} placeholder="Оберіть"
        error={!!p.error} menuWidth={300} />
      {p.value && LICENSE_LINKS[p.value] && (
        <a className="xsmall studio__license-link" href={LICENSE_LINKS[p.value]} target="_blank" rel="noreferrer">
          Текст ліцензії <Icon name="external" size={11} />
        </a>
      )}
      {p.error && <span className="field__error">{p.error}</span>}
    </div>
  );
}

/** C-02: перед підтвердженням публікації — вибір авторства та ліцензії (DG-3) */
function SubmitDialog({ photo, licenses, onClose, onDone }: { photo: Photo; licenses: SelectOption[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [anonymous, setAnonymous] = useState(photo.anonymous);
  const [author, setAuthor] = useState(photo.anonymous ? "" : photo.author_name ?? photo.author);
  const [license, setLicense] = useState(photo.license);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <ConsentDialog code="C-02" busy={busy} error={error} acceptDisabled={!license || (!anonymous && !author.trim())} onDecline={onClose}
      onAccept={async (t) => {
        setBusy(true);
        setError("");
        try {
          await consentApi.grant("C-02", t.version, photo.id);
          await photosApi.submit(photo.id, { anonymous, author: anonymous ? undefined : author.trim(), license });
          await onDone();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Не вдалося подати знімок");
        } finally {
          setBusy(false);
        }
      }}>
      <div className="stack">
        <div className="segmented" role="group" aria-label="Авторство">
          <button type="button" aria-pressed={!anonymous} onClick={() => setAnonymous(false)}>Ім'я автора</button>
          <button type="button" aria-pressed={anonymous} onClick={() => setAnonymous(true)}>Анонімно</button>
        </div>
        {!anonymous && <Input label="Ім'я автора" name="sub-author" value={author} maxLength={200} onChange={(e) => setAuthor(e.target.value)} />}
        <LicenseSelect options={licenses} value={license} onChange={setLicense} />
      </div>
    </ConsentDialog>
  );
}

function EditDialog({ photo, conOptions, onClose, onDone }: {
  photo: Photo; conOptions: SelectOption[]; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [title, setTitle] = useState(photo.title);
  const [constellation, setConstellation] = useState(photo.constellation);
  const [date, setDate] = useState(photo.date_taken);
  const [description, setDescription] = useState(photo.description);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save() {
    try {
      await photosApi.edit(photo.id, { title, constellation, date_taken: date, description });
      await onDone();
    } catch (e) {
      setErrors(e instanceof ApiError ? e.byField() : { _: "Помилка" });
    }
  }

  return (
    <Modal title="Редагувати метадані" onClose={onClose}>
      <Input label="Назва" name="ed-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
      <div className="field">
        <label className="field__label" htmlFor="ed-con">Сузір'я</label>
        <Select id="ed-con" value={constellation} onChange={setConstellation} options={conOptions} searchable
          searchPlaceholder="Українською або латиною" error={!!errors.constellation} />
      </div>
      <Input label="Дата зйомки" name="ed-date" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} error={errors.date_taken} />
      <div className="field">
        <label className="field__label" htmlFor="ed-desc">Опис</label>
        <textarea id="ed-desc" className="field__input field__input--area" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <p className="muted xsmall">Зміна метаданих створює нову версію знімка.</p>
      {errors._ && <p className="status-error small">{errors._}</p>}
      <div className="modal__actions">
        <button type="button" className="btn btn--outline btn--sm" onClick={onClose}>Скасувати</button>
        <button type="button" className="btn btn--primary btn--sm" onClick={save}>Зберегти</button>
      </div>
    </Modal>
  );
}

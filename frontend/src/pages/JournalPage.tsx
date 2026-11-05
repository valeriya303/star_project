import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";

import { ApiError } from "@/api/client";
import { journalApi, starsApi } from "@/api/endpoints";
import type { JournalInput } from "@/api/endpoints";
import Icon from "@/components/brand/Icon";
import type { IconName } from "@/components/brand/Icon";
import Term from "@/components/help/Term";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import StarPicker from "@/components/ui/StarPicker";
import { usePlace } from "@/context/LocationContext";
import type { StarSummary } from "@/types/star";
import type { JournalEntry } from "@/types/userData";
import { BRIGHTNESS_SCALE, CONDITIONS_SCALE, parseNum } from "@/utils/format";
import { fmtDate, todayIso } from "@/utils/time";
import "./JournalPage.css";

const NOTE_MAX = 2000;

type Sort = "new" | "old" | "bright" | "conditions";

interface Draft {
  id: string | null;
  date: string;
  star: StarSummary | null;
  brightness: number | null;
  conditions: number | null;
  note: string;
  withPlace: boolean;
  lat: string;
  lon: string;
}

const emptyDraft = (): Draft => ({
  id: null, date: todayIso(), star: null, brightness: null, conditions: null, note: "", withPlace: false, lat: "", lon: "",
});

const monthTitle = (iso: string) => {
  const s = new Date(`${iso}T12:00:00`).toLocaleDateString("uk-UA", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const dayParts = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return {
    day: d.getDate(),
    month: d.toLocaleDateString("uk-UA", { month: "short" }).replace(".", ""),
    weekday: d.toLocaleDateString("uk-UA", { weekday: "short" }),
  };
};

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** UC-09: журнал спостережень (запис валідується за JSON Schema на сервері) */
export default function JournalPage() {
  const location = useLocation();
  const { place } = usePlace();
  const presetHip = (location.state as { hip?: number } | null)?.hip;

  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  const [toDelete, setToDelete] = useState<JournalEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const load = useCallback(async () => {
    const r = await journalApi.list();
    setEntries(r.entries);
    setIsPublic(r.is_public);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- завантаження журналу
    void load();
  }, [load]);

  useEffect(() => {
    if (!presetHip) return;
    starsApi.get(presetHip).then((s) => setDraft((d) => ({ ...d, star: s }))).catch(() => undefined);
  }, [presetHip]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  function edit(e: JournalEntry) {
    setDraft({
      id: e.observation_id, date: e.observed_at,
      star: { hip: e.star_id, name: e.star_name, alt_names: [], hd: null, ra: 0, dec: 0, vmag: 0, bv: null, sp_type: null, constellation: null, constellation_uk: null },
      brightness: e.brightness_rating, conditions: e.conditions_rating, note: e.note,
      withPlace: e.observer_latitude != null, lat: e.observer_latitude?.toString() ?? "", lon: e.observer_longitude?.toString() ?? "",
    });
    setErrors({});
    setInfo("");
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function reset() {
    setDraft(emptyDraft());
    setErrors({});
  }

  async function handleSubmit(ev: FormEvent) {
    ev.preventDefault();
    setInfo("");
    const e: Record<string, string> = {};
    if (!draft.date) e.observed_at = "Вкажіть дату спостереження";
    else if (draft.date > todayIso()) e.observed_at = "Дата спостереження не може бути пізнішою за поточну дату (QR-20)";
    if (!draft.star) e.star_id = "Оберіть зорю зі списку підказок";
    if (!draft.brightness) e.brightness_rating = "Оцініть яскравість від 1 до 5";
    if (!draft.conditions) e.conditions_rating = "Оцініть умови від 1 до 5";
    if (draft.note.length > NOTE_MAX) e.note = "Не більше 2 000 символів";
    let lat: number | null | undefined = null;
    let lon: number | null | undefined = null;
    if (draft.withPlace) {
      lat = parseNum(draft.lat);
      lon = parseNum(draft.lon);
      if (lat == null || lat < -90 || lat > 90) e.observer_latitude = "Широта від −90° до +90°";
      if (lon == null || lon < -180 || lon > 180) e.observer_longitude = "Довгота від −180° до +180°";
    }
    setErrors(e);
    if (Object.keys(e).length) return;

    const body: JournalInput = {
      observation_id: draft.id ?? crypto.randomUUID(),
      star_id: draft.star!.hip,
      observed_at: draft.date,
      brightness_rating: draft.brightness!,
      conditions_rating: draft.conditions!,
      note: draft.note.trim(),
      ...(draft.withPlace ? { observer_latitude: lat!, observer_longitude: lon! } : {}),
    };
    setBusy(true);
    try {
      if (draft.id) await journalApi.update(draft.id, body);
      else await journalApi.create(body);
      setInfo(draft.id ? "Запис оновлено" : "Запис збережено в журналі");
      setDraft(emptyDraft());
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setErrors(err.byField());
      else setErrors({ _: err instanceof Error ? err.message : "Не вдалося зберегти" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    await journalApi.remove(toDelete.observation_id);
    if (draft.id === toDelete.observation_id) reset();
    setToDelete(null);
    await load();
  }

  const list = useMemo(() => entries ?? [], [entries]);

  const stats = useMemo(() => {
    const n = list.length;
    const avg = n ? list.reduce((s, e) => s + e.conditions_rating, 0) / n : 0;
    const last = n ? list.reduce((m, e) => (e.observed_at > m ? e.observed_at : m), list[0].observed_at) : null;
    return { n, unique: new Set(list.map((e) => e.star_id)).size, avg, last };
  }, [list]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const shown = q
      ? list.filter((e) => e.star_name?.toLowerCase().includes(q) || String(e.star_id).includes(q) || e.note.toLowerCase().includes(q))
      : list;
    const sorted = [...shown].sort((a, b) => {
      if (sort === "old") return a.observed_at.localeCompare(b.observed_at);
      if (sort === "bright") return b.brightness_rating - a.brightness_rating || b.observed_at.localeCompare(a.observed_at);
      if (sort === "conditions") return b.conditions_rating - a.conditions_rating || b.observed_at.localeCompare(a.observed_at);
      return b.observed_at.localeCompare(a.observed_at);
    });
    if (sort === "bright" || sort === "conditions") return [{ key: "all", title: null as string | null, items: sorted }];
    const out: { key: string; title: string | null; items: JournalEntry[] }[] = [];
    for (const e of sorted) {
      const key = e.observed_at.slice(0, 7);
      const g = out[out.length - 1];
      if (g && g.key === key) g.items.push(e);
      else out.push({ key, title: monthTitle(e.observed_at), items: [e] });
    }
    return out;
  }, [list, filter, sort]);

  const shownCount = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="logbook">
      {/* ---------- Банер ---------- */}
      <section className="logbook__hero">
        <svg className="logbook__deco" viewBox="0 0 300 180" aria-hidden="true">
          <circle cx="150" cy="150" r="120" />
          <circle cx="150" cy="150" r="80" />
          <path d="M30 150h240" />
          {[[60, 96, 3], [104, 52, 4.5], [182, 40, 3], [232, 84, 5], [258, 128, 2.5]].map(([x, y, r]) => (
            <circle key={x} cx={x} cy={y} r={r} className="logbook__deco-star" />
          ))}
        </svg>
        <div className="logbook__intro">
          <p className="logbook__eyebrow"><Icon name="journal" size={14} /> Журнал спостережень</p>
          <h1 className="logbook__title">Мій журнал</h1>
          <p className="logbook__lead">
            Записуйте, яку зорю бачили, наскільки яскраво й за яких умов. Так видно, як змінюється небо з сезонами й де
            вам найкраще спостерігати.
          </p>
          <p className={"logbook__privacy" + (isPublic ? " logbook__privacy--public" : "")}>
            <Icon name={isPublic ? "globe" : "lock"} size={15} />
            <span>
              {isPublic
                ? "Журнал публічний: інші бачать записи, а місце лише з точністю до 1°."
                : "Журнал приватний: записи бачите лише ви."}
            </span>
            <Link to="/profile" state={{ tab: "consents" }}>Змінити в «Мої згоди»</Link>
          </p>
        </div>
        <dl className="logbook__stats">
          <Stat icon="journal" value={String(stats.n)} label={plural(stats.n, "запис", "записи", "записів")} />
          <Stat icon="star" value={String(stats.unique)} label={plural(stats.unique, "різна зоря", "різні зорі", "різних зір")} />
          <Stat icon="eye" value={stats.n ? stats.avg.toFixed(1).replace(".", ",") : "—"} label={<>середні <Term id="ratings">умови</Term> з 5</>} />
          <Stat icon="calendar" value={stats.last ? fmtDate(stats.last) : "—"} label="останнє спостереження" small />
        </dl>
      </section>

      <div className="logbook__body">
        {/* ---------- Форма ---------- */}
        <form ref={formRef} className={"panel logbook__form" + (draft.id ? " logbook__form--edit" : "")} onSubmit={handleSubmit} noValidate>
          <header className="logbook__form-head">
            <span className="logbook__form-icon"><Icon name={draft.id ? "edit" : "plus"} size={18} /></span>
            <div>
              <h2 className="logbook__h">{draft.id ? "Редагування запису" : "Нове спостереження"}</h2>
              <p className="muted xsmall">{draft.id ? "Зміни збережуться в тому самому записі" : "Обов'язкові поля: дата, зоря та дві оцінки"}</p>
            </div>
          </header>

          <div className="logbook__pair">
            <Input label="Дата" name="date" type="date" max={todayIso()} value={draft.date}
              onChange={(e) => set("date", e.target.value)} error={errors.observed_at} />
            <div className="field logbook__today">
              <span className="field__label">&nbsp;</span>
              <button type="button" className="btn btn--outline btn--sm" onClick={() => set("date", todayIso())}>
                <Icon name="calendar" size={15} /> Сьогодні
              </button>
            </div>
          </div>

          <StarPicker id="journal-star" label="Зоря" value={draft.star} onChange={(s) => set("star", s)} error={errors.star_id}
            placeholder="Назва, HIP або HD, напр. Вега" />

          <ScaleField label="Яскравість зорі" icon="star" scale={BRIGHTNESS_SCALE} value={draft.brightness}
            onChange={(v) => set("brightness", v)} error={errors.brightness_rating} />
          <ScaleField label="Умови спостереження" icon="eye" scale={CONDITIONS_SCALE} value={draft.conditions}
            onChange={(v) => set("conditions", v)} error={errors.conditions_rating} />

          <div className="field">
            <label className="field__label" htmlFor="note">Нотатка <span className="muted xsmall">(необов'язково)</span></label>
            <textarea id="note" className={"field__input field__input--area" + (errors.note ? " field__input--error" : "")}
              maxLength={NOTE_MAX} value={draft.note} onChange={(e) => set("note", e.target.value)}
              placeholder="Що помітили: колір, мерехтіння, інструмент, сусідні об'єкти…" />
            <span className={"field__hint logbook__counter" + (draft.note.length > NOTE_MAX * 0.9 ? " logbook__counter--warn" : "")}>
              {draft.note.length.toLocaleString("uk-UA")} / 2 000
            </span>
            {errors.note && <span className="field__error">{errors.note}</span>}
          </div>

          <div className="logbook__place">
            <label className="switch">
              <input type="checkbox" checked={draft.withPlace} onChange={(e) => set("withPlace", e.target.checked)} />
              <span className="switch__track" aria-hidden="true" />
              <span className="switch__text">
                <strong><Icon name="pin" size={14} /> Місце спостереження</strong>
                <span>Необов'язково. Точні координати бачите лише ви</span>
              </span>
            </label>
            {draft.withPlace && (
              <>
                <div className="logbook__pair">
                  <Input label="Широта, °" name="obs-lat" inputMode="decimal" placeholder="49,8397" value={draft.lat}
                    onChange={(e) => set("lat", e.target.value)} error={errors.observer_latitude} />
                  <Input label="Довгота, °" name="obs-lon" inputMode="decimal" placeholder="24,0297" value={draft.lon}
                    onChange={(e) => set("lon", e.target.value)} error={errors.observer_longitude} />
                </div>
                <button type="button" className="link-btn small" onClick={() => setDraft((d) => ({ ...d, lat: place.lat.toFixed(4), lon: place.lon.toFixed(4) }))}>
                  Підставити місце з карти ({place.source === "lviv" ? "Львів" : "обране на карті"})
                </button>
              </>
            )}
          </div>

          {errors._ && <p className="status-error small">{errors._}</p>}
          {info && <p className="notice notice--ok small" role="status"><Icon name="check" size={14} /> {info}</p>}

          <div className="logbook__submit">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              <Icon name={draft.id ? "check" : "plus"} size={17} /> {busy ? "Збереження…" : draft.id ? "Зберегти зміни" : "Додати запис"}
            </button>
            {draft.id && <button type="button" className="btn btn--outline" onClick={reset}>Скасувати</button>}
          </div>
        </form>

        {/* ---------- Записи ---------- */}
        <section className="logbook__list" aria-labelledby="entries-title">
          <div className="logbook__toolbar">
            <h2 id="entries-title" className="logbook__h2">Записи <span className="muted">· {stats.n}</span></h2>
            {list.length > 0 && (
              <div className="logbook__tools">
                <label className="logbook__search">
                  <Icon name="search" size={16} />
                  <input placeholder="Зоря, номер або текст нотатки" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Пошук у журналі" />
                  {filter && (
                    <button type="button" onClick={() => setFilter("")} aria-label="Очистити пошук"><Icon name="x" size={14} /></button>
                  )}
                </label>
                <div className="logbook__sort">
                  <Select<Sort> size="sm" value={sort} onChange={setSort} aria-label="Сортування" menuWidth={230}
                    options={[
                      { value: "new", label: "Спершу нові" },
                      { value: "old", label: "Спершу давні" },
                      { value: "bright", label: "Найяскравіші" },
                      { value: "conditions", label: "Найкращі умови" },
                    ]} />
                </div>
              </div>
            )}
          </div>

          {entries === null && <div className="logbook__skeleton">{[0, 1, 2].map((i) => <span key={i} />)}</div>}

          {entries && entries.length === 0 && (
            <div className="logbook-empty">
              <svg viewBox="0 0 200 110" className="logbook-empty__art" aria-hidden="true">
                <path d="M20 92h160" />
                <path d="M40 92a60 60 0 0 1 120 0" className="logbook-empty__arc" />
                {[[62, 50], [100, 30], [140, 48]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.2" />)}
                <rect x="88" y="70" width="24" height="22" rx="3" className="logbook-empty__book" />
              </svg>
              <h3>Журнал чекає на перше спостереження</h3>
              <p>Почніть із найяскравішої зорі, яку бачите над собою. Не знаєте, що саме спостерігаєте? Знайдіть її на карті неба й додайте звідти.</p>
              <ol className="logbook-empty__steps">
                <li><span>1</span> Оберіть зорю на карті або введіть назву</li>
                <li><span>2</span> Оцініть яскравість і умови від 1 до 5</li>
                <li><span>3</span> Додайте нотатку, щоб згадати деталі</li>
              </ol>
              <Link to="/map" className="btn btn--outline btn--sm"><Icon name="map" size={16} /> Відкрити карту неба</Link>
            </div>
          )}

          {list.length > 0 && shownCount === 0 && (
            <p className="muted small logbook__none">За запитом «{filter}» нічого не знайдено.</p>
          )}

          {groups.map((g) => (
            <section key={g.key} className="logbook__group">
              {g.title && (
                <h3 className="logbook__month">
                  {g.title} <span>{g.items.length} {plural(g.items.length, "запис", "записи", "записів")}</span>
                </h3>
              )}
              <ol className="logbook__entries">
                {g.items.map((e) => {
                  const d = dayParts(e.observed_at);
                  return (
                    <li key={e.observation_id} className={"entry" + (draft.id === e.observation_id ? " entry--editing" : "")}>
                      <div className="entry__date" aria-label={fmtDate(e.observed_at)}>
                        <strong>{d.day}</strong>
                        <span>{d.month}</span>
                        <span className="entry__weekday">{d.weekday}</span>
                      </div>
                      <div className="entry__body">
                        <div className="entry__head">
                          <Link to="/map" state={{ hip: e.star_id }} className="entry__star" title="Показати на карті">
                            <Icon name="star" size={14} /> {e.star_name ?? `HIP ${e.star_id}`}
                          </Link>
                          <span className="entry__hip">HIP {e.star_id}</span>
                        </div>
                        <div className="entry__ratings">
                          <Stars label="Яскравість" value={e.brightness_rating} hint={BRIGHTNESS_SCALE[e.brightness_rating]} />
                          <Stars label="Умови" value={e.conditions_rating} hint={CONDITIONS_SCALE[e.conditions_rating]} />
                          {e.observer_latitude != null && (
                            <span className="entry__place">
                              <Icon name="pin" size={13} /> {e.observer_latitude.toFixed(2)}°, {e.observer_longitude?.toFixed(2)}°
                            </span>
                          )}
                        </div>
                        {e.note && <p className="entry__note">{e.note}</p>}
                      </div>
                      <div className="entry__actions">
                        <button type="button" className="icon-btn" onClick={() => edit(e)} title="Редагувати" aria-label="Редагувати запис">
                          <Icon name="edit" size={16} />
                        </button>
                        <button type="button" className="icon-btn icon-btn--danger" onClick={() => setToDelete(e)} title="Видалити" aria-label="Видалити запис">
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </section>
      </div>

      {toDelete && (
        <Modal title="Видалити запис?" onClose={() => setToDelete(null)}>
          <p>Запис про {toDelete.star_name ?? `HIP ${toDelete.star_id}`} від {fmtDate(toDelete.observed_at)} буде видалено без можливості відновлення.</p>
          <div className="modal__actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setToDelete(null)}>Скасувати</button>
            <button type="button" className="btn btn--danger btn--sm" onClick={confirmDelete}>Видалити</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Stat({ icon, value, label, small }: { icon: IconName; value: string; label: React.ReactNode; small?: boolean }) {
  return (
    <div className="logbook__stat">
      <span className="logbook__stat-icon"><Icon name={icon} size={18} /></span>
      <div>
        <dt className="sr-only">{label}</dt>
        <dd>
          <strong className={small ? "logbook__stat-small" : undefined}>{value}</strong>
          <span>{label}</span>
        </dd>
      </div>
    </div>
  );
}

function Stars({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <span className="stars" title={`${value} з 5: ${hint}`}>
      <span className="stars__label">{label}</span>
      <span className="stars__row" aria-label={`${value} з 5`}>
        {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= value ? "on" : ""} />)}
      </span>
      <span className="stars__hint">{hint}</span>
    </span>
  );
}

function ScaleField(p: { label: string; icon: IconName; scale: string[]; value: number | null; onChange: (v: number) => void; error?: string }) {
  return (
    <div className="field">
      <span className="field__label scale__label"><Icon name={p.icon} size={14} /> {p.label}</span>
      <div className={"scale" + (p.error ? " scale--error" : "")} role="radiogroup" aria-label={p.label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={p.value === n}
            className={"scale__step" + (p.value != null && n <= p.value ? " scale__step--fill" : "")}
            title={p.scale[n]} onClick={() => p.onChange(n)}>
            {n}
          </button>
        ))}
      </div>
      <span className="field__hint scale__hint">
        {p.value ? <><strong>{p.value}</strong> — {p.scale[p.value]}</> : <>1 — {p.scale[1]} · 5 — {p.scale[5]}</>}
      </span>
      {p.error && <span className="field__error">{p.error}</span>}
    </div>
  );
}

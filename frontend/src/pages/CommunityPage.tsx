import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { fileUrl } from "@/api/client";
import { communityApi, journalApi, photosApi } from "@/api/endpoints";
import type { PersonCard, PersonProfile } from "@/api/endpoints";
import Icon from "@/components/brand/Icon";
import Term from "@/components/help/Term";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import type { JournalEntry, Photo } from "@/types/userData";
import { BRIGHTNESS_SCALE, CONDITIONS_SCALE, LICENSE_LINKS } from "@/utils/format";
import { fmtDate } from "@/utils/time";
import "./CommunityPage.css";

const REASONS = [
  { id: "copyright", label: "Порушення авторських прав", hint: "Знімок належить іншій особі" },
  { id: "privacy", label: "Порушення приватності", hint: "Видно людей, номери, адреси" },
  { id: "inappropriate", label: "Недоречний вміст", hint: "Не стосується зоряного неба" },
  { id: "wrong_info", label: "Неправильні відомості", hint: "Хибне сузір'я, дата чи автор" },
];

const LICENSE_SHORT: Record<string, string> = { "CC0-1.0": "CC0", "CC-BY-4.0": "CC BY", "CC-BY-SA-4.0": "CC BY-SA" };

type Tab = "gallery" | "people" | "journals";
type Toast = { text: string; tone: "ok" | "error" };

/** Адреса допису: дозволяє відкрити його в новій вкладці */
const photoHref = (id: string | number) => `/community?photo=${encodeURIComponent(String(id))}`;

/** Адреса профілю спостерігача: дозволяє відкрити його в новій вкладці */
const personHref = (id: string) => `/community?person=${encodeURIComponent(id)}`;

/** Публічна галерея (схвалені знімки за згодою C-02) та публічні журнали (C-04) */
export default function CommunityPage() {
  const { user, canUsePersonal } = useAuth();
  const { constellations } = useCatalog();
  const [searchParams, setSearchParams] = useSearchParams();
  const photoParam = searchParams.get("photo");
  const personParam = searchParams.get("person");
  const [tab, setTab] = useState<Tab>("gallery");
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [all, setAll] = useState<Photo[]>([]);
  const [con, setCon] = useState("");
  const [open, setOpen] = useState<Photo | null>(null);
  const [complain, setComplain] = useState<Photo | null>(null);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [journals, setJournals] = useState<{ user_id: string; display_name: string; entries: number }[]>([]);
  const [journal, setJournal] = useState<{ id: string; display_name: string; entries: JournalEntry[] } | null>(null);
  const [jError, setJError] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);

  function openPhoto(p: Photo) {
    setOpen(p);
    setSearchParams({ photo: String(p.id) });
  }

  function closePhoto() {
    setOpen(null);
    if (photoParam) setSearchParams({}, { replace: true });
  }

  /** Звичайний клік відкриває модальне вікно; клік із Ctrl/Cmd/Shift і середня кнопка лишаються браузеру */
  function onPhotoLink(e: React.MouseEvent, p: Photo) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openPhoto(p);
  }

  function showPerson(id: string) {
    closePhoto();
    setTab("people");
    setPersonId(id);
  }

  /** Те саме для посилань на профіль: модифіковані кліки лишаються браузеру */
  function onPersonLink(e: React.MouseEvent, id: string) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    showPerson(id);
  }

  // Сповіщення зникає само через кілька секунд
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    photosApi.gallery().then(setAll).catch(() => setAll([]));
    journalApi.publicList().then(setJournals).catch(() => setJournals([]));
  }, []);

  // Відкриття допису за адресою ?photo=<id> (наприклад, у новій вкладці)
  useEffect(() => {
    if (!photoParam) return;
    const found = all.find((p) => String(p.id) === photoParam);
    /* eslint-disable react-hooks/set-state-in-effect -- відкриття допису за параметром адреси */
    if (found) setOpen((cur) => (cur && String(cur.id) === photoParam ? cur : found));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [photoParam, all]);

  // Відкриття профілю за адресою ?person=<id> (наприклад, у новій вкладці); параметр одразу прибираємо
  useEffect(() => {
    if (!personParam) return;
    /* eslint-disable react-hooks/set-state-in-effect -- відкриття профілю за параметром адреси */
    setTab("people");
    setPersonId(personParam);
    /* eslint-enable react-hooks/set-state-in-effect */
    const next = new URLSearchParams(searchParams);
    next.delete("person");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- реагуємо лише на появу параметра
  }, [personParam]);

  useEffect(() => {
    let alive = true;
    photosApi.gallery(con || undefined).then((p) => alive && setPhotos(p)).catch(() => alive && setPhotos([]));
    return () => {
      alive = false;
    };
  }, [con]);

  const stats = useMemo(() => ({
    photos: all.length,
    constellations: new Set(all.map((p) => p.constellation)).size,
    journals: journals.length,
    observations: journals.reduce((s, j) => s + j.entries, 0),
  }), [all, journals]);

  // Фільтр: усі 88 сузір'їв; ті, для яких уже є знімки, — угорі з кількістю
  const conOptions = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of all) count.set(p.constellation, (count.get(p.constellation) ?? 0) + 1);
    const sorted = [...constellations].sort((a, b) => a.name.localeCompare(b.name, "uk"));
    const withPhotos = sorted.filter((c) => count.has(c.latin));
    const rest = sorted.filter((c) => !count.has(c.latin));
    return [
      { value: "", label: "Усі сузір'я", meta: String(all.length) },
      ...withPhotos.map((c) => ({ value: c.latin, label: c.name, hint: c.latin, meta: String(count.get(c.latin)), group: "Є знімки" })),
      ...rest.map((c) => ({ value: c.latin, label: c.name, hint: c.latin, group: "Інші сузір'я" })),
    ];
  }, [all, constellations]);

  async function sendComplaint() {
    if (!complain || !reason) return;
    try {
      const r = await photosApi.complain(complain.id, reason, comment);
      setToast({ text: r.message, tone: "ok" });
      setComplain(null);
      setReason("");
      setComment("");
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "Не вдалося надіслати скаргу", tone: "error" });
    }
  }

  async function openJournal(id: string) {
    setJError("");
    try {
      const j = await journalApi.publicOne(id);
      setJournal({ id, ...j });
    } catch (e) {
      setJournal(null);
      setJError(e instanceof Error ? e.message : "Журнал недоступний");
    }
  }

  return (
    <div className="community">
      <section className="community__hero">
        <svg className="community__constellation" viewBox="0 0 400 220" aria-hidden="true">
          <g className="community__lines">
            <polyline points="30,150 105,70 175,125 255,45 345,105" />
            <polyline points="255,45 300,20" />
          </g>
          {[[30, 150, 4], [105, 70, 5], [175, 125, 3.5], [255, 45, 6], [345, 105, 4.5], [300, 20, 2.5]].map(([x, y, r]) => (
            <g key={`${x}-${y}`}>
              <circle cx={x} cy={y} r={r * 3} className="community__halo" />
              <circle cx={x} cy={y} r={r} className="community__star" />
            </g>
          ))}
        </svg>

        <div className="community__intro">
          <p className="community__eyebrow">Спільнота спостерігачів</p>
          <h1 className="community__title">Небо очима наших спостерігачів</h1>
          <p className="community__lead">
            Знімки сузір'їв, які пройшли <Term id="moderation">модерацію</Term> й опубліковані за згодою авторів,
            та журнали тих, хто вирішив поділитися своїми спостереженнями.
          </p>
          <div className="community__cta">
            {canUsePersonal ? (
              <Link to="/gallery" className="btn btn--primary btn--sm"><Icon name="camera" size={16} /> Додати свій знімок</Link>
            ) : !user ? (
              <Link to="/" state={{ from: "/gallery", mode: "register" }} className="btn btn--primary btn--sm">
                <Icon name="camera" size={16} /> Долучитися й поділитися знімком
              </Link>
            ) : null}
            <Link to="/help#guide-photos" className="community__link">Як опублікувати знімок?</Link>
          </div>
        </div>

        <dl className="community__stats">
          <Stat icon="gallery" value={stats.photos} label="опублікованих знімків" />
          <Stat icon="map" value={stats.constellations} label="сузір'їв на знімках" />
          <Stat icon="journal" value={stats.journals} label="публічних журналів" />
          <Stat icon="eye" value={stats.observations} label="записів спостережень" />
        </dl>
      </section>

      <div className="community__bar">
        <div className="segmented community__tabs" role="tablist" aria-label="Розділ спільноти">
          <button type="button" role="tab" aria-selected={tab === "gallery"} aria-pressed={tab === "gallery"} onClick={() => setTab("gallery")}>
            Галерея знімків
          </button>
          <button type="button" role="tab" aria-selected={tab === "people"} aria-pressed={tab === "people"}
            onClick={() => { setTab("people"); setPersonId(null); }}>
            Спостерігачі
          </button>
          <button type="button" role="tab" aria-selected={tab === "journals"} aria-pressed={tab === "journals"} onClick={() => setTab("journals")}>
            Публічні журнали
          </button>
        </div>
        {tab === "gallery" && (
          <div className="community__select">
            <Select value={con} onChange={setCon} options={conOptions} searchable menuWidth={300}
              searchPlaceholder="Назва сузір'я українською або латиною" aria-label="Фільтр за сузір'ям"
              icon={<Icon name="star" size={15} />} emptyText="Такого сузір'я немає серед 88 офіційних" />
          </div>
        )}
        <p className="community__note">
          <Icon name="shield" size={15} />
          Публікація лише за згодою автора. <Term id="exif">GPS-координати</Term> зі знімків не показуються.
        </p>
      </div>

      {tab === "gallery" && (
        <>
          {photos === null && <p className="muted">Завантаження…</p>}
          {photos && photos.length === 0 && (
            <EmptyState
              title={con ? "Для цього сузір'я знімків ще немає" : "Галерея поки порожня"}
              text="Станьте першим, хто поділиться знімком цієї ділянки неба. Після перевірки модератором він з'явиться тут."
              action={canUsePersonal ? <Link to="/gallery" className="btn btn--primary btn--sm">Завантажити знімок</Link> : undefined}
            />
          )}
          <div className="community__grid">
            {photos?.map((p) => (
              <article key={p.id} className="shot">
                <a href={photoHref(p.id)} className="shot__media" onClick={(e) => onPhotoLink(e, p)}
                  aria-label={`Відкрити знімок «${p.title}»`}>
                  <img src={fileUrl(p.thumb_url)} alt={p.title} loading="lazy" />
                  <span className="shot__chip">{p.constellation_uk}</span>
                  <span className="shot__zoom"><Icon name="search" size={16} /></span>
                </a>
                <div className="shot__body">
                  <h3 className="shot__title">
                    <a href={photoHref(p.id)} className="shot__title-link" onClick={(e) => onPhotoLink(e, p)}>{p.title}</a>
                  </h3>
                  <p className="shot__meta">
                    {p.author_profile_id ? (
                      <a href={personHref(p.author_profile_id)} className="author-link"
                        onClick={(e) => onPersonLink(e, p.author_profile_id!)}
                        title="Профіль спостерігача">{p.author}</a>
                    ) : <span>{p.author}</span>}
                    <span aria-hidden="true">·</span>
                    <span>{fmtDate(p.date_taken)}</span>
                  </p>
                  <div className="shot__foot">
                    <a className="shot__license" href={LICENSE_LINKS[p.license]} target="_blank" rel="noreferrer"
                      title="Умови використання знімка">{LICENSE_SHORT[p.license] ?? p.license}</a>
                    <span className="shot__size">{p.width_px} × {p.height_px}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {tab === "people" && (
        <PeopleSection personId={personId} onPerson={setPersonId} onPhoto={openPhoto} />
      )}

      {tab === "journals" && (
        <div className="community__journals">
          <aside className="community__observers">
            {journals.length === 0 && (
              <EmptyState compact title="Публічних журналів ще немає"
                text="Журнал стає публічним лише тоді, коли автор сам надає згоду C-04 у «Мої згоди»." />
            )}
            {journals.map((j) => (
              <button key={j.user_id} type="button"
                className={"observer" + (journal?.id === j.user_id ? " observer--active" : "")} onClick={() => openJournal(j.user_id)}>
                <span className="observer__avatar">{j.display_name.charAt(0).toUpperCase()}</span>
                <span className="observer__info">
                  <strong>{j.display_name}</strong>
                  <span>{j.entries} {plural(j.entries, "спостереження", "спостереження", "спостережень")}</span>
                </span>
                <Icon name="journal" size={18} />
              </button>
            ))}
          </aside>

          <section className="panel community__timeline">
            {jError && <p className="status-error">{jError}</p>}
            {!journal && !jError && (
              <EmptyState compact title="Оберіть спостерігача" text="Ліворуч — журнали, які автори зробили публічними." />
            )}
            {journal && (
              <>
                <header className="timeline__head">
                  <span className="observer__avatar observer__avatar--lg">{journal.display_name.charAt(0).toUpperCase()}</span>
                  <div>
                    <h2 className="timeline__title">{journal.display_name}</h2>
                    <p className="muted small">Публічний журнал · {journal.entries.length} записів · місце показано з точністю до 1°</p>
                  </div>
                  <button type="button" className="btn btn--outline btn--sm timeline__profile" onClick={() => showPerson(journal.id)}>
                    Профіль
                  </button>
                </header>
                <ol className="timeline">
                  {journal.entries.map((e) => (
                    <li key={e.observation_id} className="timeline__item">
                      <span className="timeline__dot" aria-hidden="true" />
                      <div className="timeline__card">
                        <div className="timeline__row">
                          <Link to={`/map?star=${e.star_id}`} className="timeline__star">{e.star_name ?? `HIP ${e.star_id}`}</Link>
                          <time className="muted small">{fmtDate(e.observed_at)}</time>
                        </div>
                        <div className="timeline__ratings">
                          <Rating label="Яскравість" value={e.brightness_rating} hint={BRIGHTNESS_SCALE[e.brightness_rating]} />
                          <Rating label="Умови" value={e.conditions_rating} hint={CONDITIONS_SCALE[e.conditions_rating]} />
                          {e.observer_area && <span className="timeline__area"><Icon name="pin" size={13} /> {e.observer_area}</span>}
                        </div>
                        {e.note && <p className="timeline__note">{e.note}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
      )}

      {open && (
        <Modal title={open.title} wide onClose={closePhoto}>
          <div className="viewer">
            <figure className="viewer__media">
              <img className="viewer__img" src={fileUrl(open.full_url)} alt={open.title} />
            </figure>
            <aside className="viewer__side">
              <span className="viewer__chip"><Icon name="star" size={13} /> {open.constellation_uk}</span>
              <dl className="viewer__info">
                <div><dt>Латинська назва</dt><dd>{open.constellation}</dd></div>
                <div>
                  <dt>Автор</dt>
                  <dd>
                    {open.author_profile_id ? (
                      <a href={personHref(open.author_profile_id)} className="author-link"
                        onClick={(e) => onPersonLink(e, open.author_profile_id!)}>
                        {open.author} <Icon name="external" size={12} />
                      </a>
                    ) : open.author}
                  </dd>
                </div>
                <div><dt>Дата зйомки</dt><dd>{fmtDate(open.date_taken)}</dd></div>
                <div><dt>Розмір</dt><dd>{open.width_px} × {open.height_px} px</dd></div>
                <div>
                  <dt><Term id="license">Ліцензія</Term></dt>
                  <dd><a href={LICENSE_LINKS[open.license]} target="_blank" rel="noreferrer">{open.license} <Icon name="external" size={12} /></a></dd>
                </div>
              </dl>
              <div className="viewer__actions">
                <a className="btn btn--outline btn--sm" href={fileUrl(open.full_url)} target="_blank" rel="noreferrer">
                  <Icon name="external" size={15} /> Повний розмір
                </a>
                {user ? (
                  <button type="button" className="btn btn--outline btn--sm viewer__report" onClick={() => { setComplain(open); closePhoto(); }}>
                    <Icon name="shield" size={15} /> Поскаржитися
                  </button>
                ) : (
                  <span className="muted xsmall"><Link to="/" state={{ from: "/community", mode: "login" }}>Увійдіть</Link>, щоб поскаржитися на знімок</span>
                )}
              </div>
            </aside>
          </div>
          {open.description && <p className="viewer__desc">{open.description}</p>}
        </Modal>
      )}

      {complain && (
        <Modal title="Скарга на знімок" onClose={() => setComplain(null)}>
          <p className="small">«{complain.title}». Скаргу розгляне модератор; за потреби знімок буде приховано.</p>
          <div className="field">
            <label className="field__label" htmlFor="c-reason">Причина</label>
            <Select id="c-reason" value={reason} onChange={setReason} placeholder="Оберіть причину"
              options={REASONS.map((r) => ({ value: r.id, label: r.label, hint: r.hint }))} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="c-comment">Коментар</label>
            <textarea id="c-comment" className="field__input field__input--area" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className="modal__actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setComplain(null)}>Скасувати</button>
            <button type="button" className="btn btn--primary btn--sm" disabled={!reason} onClick={sendComplaint}>Надіслати</button>
          </div>
        </Modal>
      )}

      {toast && (
        <div className={"community-toast community-toast--" + toast.tone} role="status" aria-live="polite">
          <Icon name={toast.tone === "ok" ? "check" : "x"} size={16} />
          <span>{toast.text}</span>
          <button type="button" className="icon-btn" onClick={() => setToast(null)} aria-label="Закрити сповіщення">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function Stat({ icon, value, label }: { icon: "gallery" | "map" | "journal" | "eye"; value: number; label: string }) {
  return (
    <div className="community__stat">
      <span className="community__stat-icon"><Icon name={icon} size={18} /></span>
      <dt className="sr-only">{label}</dt>
      <dd>
        <strong>{value.toLocaleString("uk-UA")}</strong>
        <span>{label}</span>
      </dd>
    </div>
  );
}

function Rating({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <span className="rating-chip" title={hint}>
      <span className="muted">{label}</span>
      <span className="rating-chip__stars" aria-label={`${value} з 5`}>
        {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= value ? "on" : ""} />)}
      </span>
    </span>
  );
}

function EmptyState({ title, text, action, compact }: { title: string; text: string; action?: React.ReactNode; compact?: boolean }) {
  return (
    <div className={"empty-state" + (compact ? " empty-state--compact" : "")}>
      <svg viewBox="0 0 160 90" className="empty-state__art" aria-hidden="true">
        <polyline points="12,62 48,30 78,52 112,18 148,44" />
        {[[12, 62], [48, 30], [78, 52], [112, 18], [148, 44]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="3" />)}
      </svg>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

const avatarHue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const h = avatarHue(name);
  return (
    <span className={`person-avatar person-avatar--${size}`} aria-hidden="true"
      style={{ background: `radial-gradient(circle at 30% 25%, hsl(${h} 45% 52%), hsl(${(h + 40) % 360} 40% 24%))` }}>
      {initials || "?"}
    </span>
  );
}

/** Пошук і профілі спостерігачів (лише оприлюднене самими людьми) */
function PeopleSection({ personId, onPerson, onPhoto }: {
  personId: string | null; onPerson: (id: string | null) => void; onPhoto: (p: Photo) => void;
}) {
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ total: number; items: PersonCard[] } | null>(null);
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [error, setError] = useState("");
  const personRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      communityApi.people(q.trim()).then((r) => alive && setData(r)).catch(() => alive && setData({ total: 0, items: [] }));
    }, q ? 220 : 0);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    if (!personId) return;
    let alive = true;
    communityApi.person(personId)
      .then((p) => { if (alive) { setProfile(p); setError(""); } })
      .catch((e) => { if (alive) { setProfile(null); setError(e instanceof Error ? e.message : "Профіль недоступний"); } });
    return () => {
      alive = false;
    };
  }, [personId]);

  // після завантаження профілю прокручуємо до нього й переводимо фокус на заголовок
  useEffect(() => {
    if (!personId || profile?.id !== personId) return;
    const el = personRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.querySelector<HTMLElement>(".person__name")?.focus({ preventScroll: true });
  }, [personId, profile]);

  if (personId) {
    const p = profile?.id === personId ? profile : null;
    return (
      <section className="person" ref={personRef}>
        <button type="button" className="person__back" onClick={() => onPerson(null)}>
          <Icon name="undo" size={15} /> Усі спостерігачі
        </button>
        {error && <p className="notice notice--error small">{error}</p>}
        {!p && !error && <p className="muted">Завантаження профілю…</p>}
        {p && (
          <>
            <header className="panel person__head">
              <Avatar name={p.name} size="lg" />
              <div className="person__id">
                <h2 className="person__name" tabIndex={-1}>{p.name}</h2>
                {p.also_known_as.length > 0 && <p className="muted xsmall">Також підписує знімки: {p.also_known_as.join(", ")}</p>}
                <div className="person__badges">
                  <span><Icon name="gallery" size={14} /> {p.public_photos} {plural(p.public_photos, "знімок", "знімки", "знімків")}</span>
                  {p.journal_public
                    ? <span><Icon name="journal" size={14} /> {p.journal_entries} {plural(p.journal_entries, "запис", "записи", "записів")} у журналі</span>
                    : <span className="muted"><Icon name="lock" size={14} /> Журнал приватний</span>}
                  {p.last_activity && <span><Icon name="clock" size={14} /> активність {fmtDate(p.last_activity)}</span>}
                </div>
              </div>
              {p.top_constellations.length > 0 && (
                <div className="person__fav">
                  <span className="person__fav-title">Найчастіше знімає</span>
                  <div className="person__chips">{p.top_constellations.map((c) => <span key={c}><Icon name="star" size={12} /> {c}</span>)}</div>
                </div>
              )}
            </header>

            <div className="person__cols">
              <section className="person__block">
                <h3 className="person__h">Знімки <span className="muted">· {p.photos.length}</span></h3>
                {p.photos.length === 0 ? (
                  <EmptyState compact title="Опублікованих знімків немає" text="Цей спостерігач поки ділиться лише журналом." />
                ) : (
                  <div className="person__photos">
                    {p.photos.map((ph) => (
                      <button key={ph.id} type="button" className="person__photo" onClick={() => onPhoto(ph)} aria-label={`Відкрити «${ph.title}»`}>
                        <img src={fileUrl(ph.thumb_url)} alt="" loading="lazy" />
                        <span className="person__photo-cap">
                          <strong>{ph.title}</strong>
                          <span>{ph.constellation_uk} · {fmtDate(ph.date_taken)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="person__block">
                <h3 className="person__h">Журнал спостережень</h3>
                {!p.journal ? (
                  <EmptyState compact title="Журнал приватний" text="Автор не надавав згоди C-04, тому записи бачить лише він." />
                ) : p.journal.length === 0 ? (
                  <EmptyState compact title="Записів ще немає" text="Журнал публічний, але порожній." />
                ) : (
                  <ol className="timeline">
                    {p.journal.map((e) => (
                      <li key={e.observation_id} className="timeline__item">
                        <span className="timeline__dot" aria-hidden="true" />
                        <div className="timeline__card">
                          <div className="timeline__row">
                            <Link to={`/map?star=${e.star_id}`} className="timeline__star">{e.star_name ?? `HIP ${e.star_id}`}</Link>
                            <time className="muted small">{fmtDate(e.observed_at)}</time>
                          </div>
                          <div className="timeline__ratings">
                            <Rating label="Яскравість" value={e.brightness_rating} hint={BRIGHTNESS_SCALE[e.brightness_rating]} />
                            <Rating label="Умови" value={e.conditions_rating} hint={CONDITIONS_SCALE[e.conditions_rating]} />
                            {e.observer_area && <span className="timeline__area"><Icon name="pin" size={13} /> {e.observer_area}</span>}
                          </div>
                          {e.note && <p className="timeline__note">{e.note}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="people">
      <div className="people__bar">
        <label className="people__search">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ім'я спостерігача: Олена, Olena, Kowalska…"
            aria-label="Пошук спостерігачів" />
          {q && <button type="button" onClick={() => setQ("")} aria-label="Очистити"><Icon name="x" size={15} /></button>}
        </label>
        <p className="people__hint">
          <Icon name="shield" size={14} />
          Тут лише ті, хто сам оприлюднив знімки або журнал. Пошук розуміє кирилицю й латиницю.
        </p>
      </div>

      {data === null && <p className="muted">Завантаження…</p>}
      {data && data.items.length === 0 && (
        <EmptyState
          title={q ? `За запитом «${q}» нікого не знайдено` : "Публічних спостерігачів ще немає"}
          text={q ? "Спробуйте інше написання або частину імені. Анонімні автори в пошуку не показуються." : "Щойно хтось опублікує знімок або відкриє журнал, він з'явиться тут."}
        />
      )}
      {data && data.items.length > 0 && (
        <>
          <p className="muted xsmall people__count">
            {q ? `Знайдено: ${data.items.length}` : `Усього публічних спостерігачів: ${data.total}`}
          </p>
          <div className="people__grid">
            {data.items.map((c) => (
              <button key={c.id} type="button" className="person-card" onClick={() => onPerson(c.id)}>
                <Avatar name={c.name} />
                <span className="person-card__body">
                  <strong className="person-card__name">{c.name}</strong>
                  <span className="person-card__stats">
                    <span><Icon name="gallery" size={13} /> {c.public_photos}</span>
                    <span>
                      <Icon name={c.journal_public ? "journal" : "lock"} size={13} /> {c.journal_public ? c.journal_entries : "приватний"}
                    </span>
                  </span>
                  {c.top_constellations.length > 0 && (
                    <span className="person-card__cons">{c.top_constellations.join(" · ")}</span>
                  )}
                </span>
                <Icon name="chevron" size={16} className="person-card__go" />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

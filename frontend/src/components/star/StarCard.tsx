import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { skyApi, starsApi } from "@/api/endpoints";
import type { VisibilityParams } from "@/api/endpoints";
import { ApiError } from "@/api/client";
import Icon from "@/components/brand/Icon";
import Term from "@/components/help/Term";
import Section from "@/components/ui/Section";
import Select from "@/components/ui/Select";
import type { Lineage, StarDetails, VisibilityResult } from "@/types/star";
import type { StarList } from "@/types/userData";
import { formatDec, formatRA } from "@/utils/astro";
import { MISSING, fmt, starTitle } from "@/utils/format";
import { fmtDateTime } from "@/utils/time";
import "./StarCard.css";

interface Props {
  hip: number | null;
  visParams: Omit<VisibilityParams, "hip"> | null;
  lists: StarList[];
  role: string;
  canUsePersonal: boolean;
  isFavorite: boolean;
  onFavorite: () => Promise<void>;
  onJournal: () => void;
  onAddToList: (listId: string) => Promise<void>;
  onClose?: () => void;
}

const SPECTRAL_UK: Record<string, string> = {
  O: "блакитна", B: "блакитно-біла", A: "біла", F: "жовтувато-біла", G: "жовта", K: "помаранчева", M: "червона",
};

/** UC-05: детальна інформація про зорю; UC-08: видимість; UC-06: додавання до списків */
export default function StarCard(p: Props) {
  const { hip, visParams } = p;
  const [star, setStar] = useState<StarDetails | null>(null);
  const [error, setError] = useState("");
  const [vis, setVis] = useState<VisibilityResult | null>(null);
  const [visError, setVisError] = useState("");
  const [lineage, setLineage] = useState<Lineage | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (hip == null) return;
    let alive = true;
    /* eslint-disable react-hooks/set-state-in-effect -- скидання картки під час вибору іншої зорі */
    setStar(null);
    setError("");
    setLineage(null);
    setMsg("");
    /* eslint-enable react-hooks/set-state-in-effect */
    starsApi.get(hip).then((s) => alive && setStar(s)).catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [hip]);

  const visKey = JSON.stringify(visParams);
  useEffect(() => {
    if (hip == null || !visParams) return;
    let alive = true;
    const t = window.setTimeout(() => {
      skyApi.visibility({ ...visParams, hip })
        .then((v) => { if (alive) { setVis(v); setVisError(""); } })
        .catch((e: ApiError) => { if (alive) { setVis(null); setVisError(e.message); } });
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- параметри порівнюються за значенням
  }, [hip, visKey]);

  if (hip == null) {
    return <p className="muted">Оберіть зорю або сузір'я на карті, або знайдіть у пошуку</p>;
  }
  if (error) {
    return (
      <div className="star-card">
        <p className="status-error">{error}</p>
        {p.onClose && <button type="button" className="btn btn--outline btn--sm" onClick={p.onClose}>Повернутися до перегляду</button>}
      </div>
    );
  }
  if (!star) return <p className="muted">Завантаження…</p>;

  const val = (v: number | null | undefined, digits: number, unit = "") =>
    v == null ? <span className="muted">{MISSING}</span> : <>{fmt(v, digits)}{unit}</>;

  async function act(f: () => Promise<void>, okText: string) {
    setMsg("");
    try {
      await f();
      setMsg(okText);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Не вдалося виконати дію");
    }
  }

  return (
    <div className="star-card">
      <h2 className="star-card__name">{starTitle(star)}</h2>
      <p className="muted star-card__sub">
        {star.alt_names.filter((n) => n !== star.name).slice(0, 3).join(" · ")}
        {star.alt_names.length > 1 ? " · " : ""}
        {star.constellation_uk ? `сузір'я ${star.constellation_uk}` : ""}
      </p>

      <dl className="kv">
        <div><dt><Term id="hip">HIP</Term></dt><dd>{star.hip > 0 ? star.hip : <span className="muted">{MISSING}</span>}</dd></div>
        <div><dt><Term id="hd">HD</Term></dt><dd>{star.hd ?? <span className="muted">{MISSING}</span>}</dd></div>
        <div><dt><Term id="ra">α (пряме піднесення)</Term></dt><dd>{formatRA(star.ra)}</dd></div>
        <div><dt><Term id="dec">δ (схилення)</Term></dt><dd>{formatDec(star.dec)}</dd></div>
        <div><dt><Term id="icrs">Система</Term> / <Term id="epoch">епоха</Term></dt><dd>{star.coordinate_system}, {star.epoch}</dd></div>
        <div><dt><Term id="vmag">Видима величина</Term></dt><dd>{fmt(star.vmag, 2)}m</dd></div>
        <div><dt><Term id="spectral">Спектр</Term></dt><dd>{star.sp_type ?? <span className="muted">{MISSING}</span>}{star.sp_class ? ` (${SPECTRAL_UK[star.sp_class]})` : ""}</dd></div>
        <div>
          <dt><Term id="bv">Колір B–V</Term></dt>
          <dd>
            <span className="swatch" style={{ background: star.bv == null ? "transparent" : star.color_hex }} />
            {val(star.bv, 2, "m")}
          </dd>
        </div>
        <div><dt><Term id="vi">V–I</Term></dt><dd>{val(star.vi, 2, "m")}</dd></div>
        <div><dt><Term id="parallax">Паралакс</Term></dt><dd>{star.parallax_mas == null ? <span className="muted">{MISSING}</span> : <>{fmt(star.parallax_mas, 2)} ± {fmt(star.parallax_error_mas ?? 0, 2)} мс</>}</dd></div>
        <div><dt><Term id="ly">Відстань</Term></dt><dd>{star.dist_ly == null ? <span className="muted">{MISSING}</span> : <>≈ {Math.round(star.dist_ly).toLocaleString("uk-UA")} св. р. ({fmt(star.dist_pc!, 1)} пк)</>}</dd></div>
        <div><dt><Term id="pm">μα* / μδ</Term></dt><dd>{star.pm_ra == null ? <span className="muted">{MISSING}</span> : <>{fmt(star.pm_ra, 1)} / {fmt(star.pm_dec!, 1)} мс/рік</>}</dd></div>
        <div><dt><Term id="pm">Власний рух (модуль)</Term></dt><dd>{val(star.pm_total, 1, " мс/рік")}</dd></div>
        <div><dt><Term id="tangential">Тангенціальна швидкість</Term></dt><dd>{star.tangential_velocity_kms == null ? <span className="muted">{MISSING}</span> : <>≈ {Math.round(star.tangential_velocity_kms)} км/с</>}</dd></div>
      </dl>
      {star.fast && <p className="status-ok small">Швидка зоря: великий <Term id="pm">власний рух</Term></p>}

      <h3 className="star-card__h3">Видимість</h3>
      {vis?.case === "circumpolar" || vis?.case === "never_rises" ? <p className="muted xsmall"><Term id="circumpolar">Чому так?</Term></p> : null}
      {visError && <p className="status-error small">{visError}</p>}
      {vis && (
        <>
          <p className={vis.above_horizon ? "status-ok" : "muted"}>{vis.text}</p>
          <dl className="kv">
            <div><dt><Term id="altitude">Висота</Term> / <Term id="azimuth">азимут</Term></dt><dd>{fmt(vis.altitude, 1)}° / {fmt(vis.azimuth, 1)}° ({vis.compass})</dd></div>
            {vis.case === "normal" && (
              <div><dt><Term id="riseset">Схід / захід</Term></dt><dd>{vis.rise?.label ?? "—"} / {vis.set?.label ?? "—"}</dd></div>
            )}
            {vis.case !== "never_rises" && (
              <div><dt><Term id="transit">Кульмінація</Term></dt><dd>{vis.transit?.label ?? "—"}, висота {fmt(vis.transit_altitude, 0)}°</dd></div>
            )}
          </dl>
          <p className="muted xsmall">
            {vis.place_label} · {fmtDateTime(vis.moment_local)} ({vis.timezone}). {vis.disclaimer}
          </p>
        </>
      )}

      <Section title="Походження даних" defaultOpen={false}>
        <p className="muted xsmall"><Term id="lineage">Що це означає?</Term></p>
        <dl className="kv">
          <div><dt>Джерело</dt><dd><a href={star.lineage.source_url} target="_blank" rel="noreferrer">{star.lineage.source}</a></dd></div>
          <div><dt>Ліцензія</dt><dd>{star.lineage.license}</dd></div>
          <div><dt>Дата імпорту</dt><dd>{fmtDateTime(star.lineage.import_date)}</dd></div>
          <div><dt>Ідентифікатор у джерелі</dt><dd>{star.lineage.source_id}</dd></div>
        </dl>
        {!lineage ? (
          <button type="button" className="link-btn small" onClick={() => starsApi.lineage(star.hip).then(setLineage)}>
            Розширений перегляд
          </button>
        ) : (
          <dl className="kv">
            <div><dt>Першоджерело</dt><dd>{lineage.origin}</dd></div>
            <div><dt>Версія джерела</dt><dd>{lineage.source_version}</dd></div>
            <div><dt>Партія імпорту</dt><dd className="mono">{lineage.batch_id}</dd></div>
            <div><dt>SHA-256 файлу</dt><dd className="mono">{lineage.checksum_sha256?.slice(0, 16)}…</dd></div>
            <div>
              <dt>Перетворення</dt>
              <dd>{lineage.transformations?.length ? lineage.transformations.join("; ") : "немає"}</dd>
            </div>
            <div><dt>Попередження якості</dt><dd>{lineage.quality_warnings?.length ? lineage.quality_warnings.join(", ") : "немає"}</dd></div>
          </dl>
        )}
      </Section>

      {p.role === "GUEST" && (
        <p className="notice small">
          <Link to="/" state={{ from: "/map", mode: "login" }}>Увійдіть</Link> або{" "}
          <Link to="/" state={{ from: "/map", mode: "register" }}>створіть акаунт</Link>, щоб додати зорю до списку чи журналу
        </p>
      )}
      {p.canUsePersonal && star.hip > 0 && (
        <div className="star-card__actions">
          <button type="button" className="btn btn--primary" onClick={() => act(p.onFavorite, p.isFavorite ? "Прибрано з улюблених" : "Додано до улюблених")}>
            <Icon name={p.isFavorite ? "check" : "star"} size={17} /> {p.isFavorite ? "В улюблених" : "В улюблені"}
          </button>
          <Select size="md" value="" placeholder={p.lists.some((l) => !l.is_favorites) ? "Додати до списку…" : "Списків ще немає"}
            aria-label="Додати до списку" icon={<Icon name="bookmark" size={16} />}
            disabled={!p.lists.some((l) => !l.is_favorites)}
            onChange={(v) => act(() => p.onAddToList(v), "Зорю додано до списку")}
            options={p.lists.filter((l) => !l.is_favorites).map((l) => ({
              value: l.id,
              label: l.name,
              meta: l.hips.includes(star.hip) ? "уже є" : `${l.hips.length} зір`,
              disabled: l.hips.includes(star.hip),
            }))} />
          <button type="button" className="btn btn--outline" onClick={p.onJournal}>Додати в журнал</button>
        </div>
      )}
      {msg && <p className="small" role="status">{msg}</p>}
    </div>
  );
}

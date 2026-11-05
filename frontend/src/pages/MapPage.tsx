import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { starsApi } from "@/api/endpoints";
import type { VisibilityParams } from "@/api/endpoints";
import FiltersPanel from "@/components/filters/FiltersPanel";
import SearchPanel from "@/components/search/SearchPanel";
import StarCard from "@/components/star/StarCard";
import ConstellationCard from "@/components/star/ConstellationCard";
import Icon from "@/components/brand/Icon";
import SkyMap from "@/components/map/SkyMap";
import { MOTION_YEARS } from "@/components/map/skyConstants";
import type { SkyMode } from "@/components/map/SkyMap";
import Term from "@/components/help/Term";
import Select from "@/components/ui/Select";
import ObservationPanel from "@/components/map/ObservationPanel";
import type { ObsParams } from "@/components/map/ObservationPanel";
import type { Projection } from "@/components/map/projection";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import { useData } from "@/context/DataContext";
import { usePlace } from "@/context/LocationContext";
import { BRIGHT_TIER_VMAG, DEFAULT_FILTERS } from "@/types/filters";
import type { Filters } from "@/types/filters";
import type { Constellation, StarSummary } from "@/types/star";
import { LVIV_TZ } from "@/utils/astro";
import { filterStars, toServerFilter } from "@/utils/filterStars";
import { COLOR_LEGEND } from "@/utils/starColor";
import { nowIn, resolveLocal } from "@/utils/time";
import "./MapPage.css";

function initialObs(): ObsParams {
  const tz = LVIV_TZ;
  const n = nowIn(tz);
  const r = resolveLocal(n.date, n.time, tz);
  return {
    ...n, tz, fold: null, live: true,
    instant: r.kind === "ok" ? r.instant : new Date(), offset: r.kind === "ok" ? r.offset : 0,
  };
}

export default function MapPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { role, canUsePersonal } = useAuth();
  const { lists, isFavorite, toggleFavorite, addToList } = useData();
  const { place, guestConsent } = usePlace();
  const catalog = useCatalog();

  const preset = location.state as { hips?: number[]; listName?: string; hip?: number } | null;

  const [mode, setMode] = useState<SkyMode>("equatorial");
  const [projection, setProjection] = useState<Projection>("equirect");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<number | null>(preset?.hip ?? null);
  const [selectedConst, setSelectedConst] = useState<Constellation | null>(null);
  const [focus, setFocus] = useState<{ ra: number; dec: number; nonce: number } | null>(null);
  const [obs, setObs] = useState<ObsParams>(initialObs);
  const [onlyList, setOnlyList] = useState<{ hips: number[]; name: string } | null>(
    preset?.hips ? { hips: preset.hips, name: preset.listName ?? "список" } : null,
  );
  const [serverCount, setServerCount] = useState<{ count: number; excluded_no_distance: number } | null>(null);
  const [panel, setPanel] = useState<"search" | "filters">("search");

  const [showConstellations, setShowConstellations] = useState(true);
  const [showNames, setShowNames] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showMotion, setShowMotion] = useState(false);

  const cardRef = useRef<HTMLElement>(null);

  // «Небо зараз»: автоматичне оновлення моменту часу
  useEffect(() => {
    if (!obs.live) return;
    const t = window.setInterval(() => {
      setObs((o) => {
        const n = nowIn(o.tz);
        const r = resolveLocal(n.date, n.time, o.tz);
        return r.kind === "ok" ? { ...o, ...n, instant: r.instant, offset: r.offset } : o;
      });
    }, 30000);
    return () => window.clearInterval(t);
  }, [obs.live]);

  const { visible, excluded } = useMemo(() => {
    const r = filterStars(catalog.stars, filters);
    const stars = onlyList ? r.stars.filter((s) => onlyList.hips.includes(s.hip)) : r.stars;
    return { visible: stars, excluded: r.excludedNoDistance };
  }, [catalog.stars, filters, onlyList]);

  // Кількість у всьому каталозі за тими самими умовами (UC-04 крок 8)
  useEffect(() => {
    let alive = true;
    starsApi.count(toServerFilter(filters))
      .then((r) => alive && setServerCount({ count: r.count, excluded_no_distance: r.excluded_no_distance }))
      .catch(() => alive && setServerCount(null));
    return () => {
      alive = false;
    };
  }, [filters]);

  const needFaint = filters.vmagMax > BRIGHT_TIER_VMAG;
  const { requestTiles } = catalog;
  const onViewTiles = useCallback((ids: string[]) => needFaint && requestTiles(ids), [needFaint, requestTiles]);

  // на телефоні картка під картою: прокручуємо до неї після вибору
  useEffect(() => {
    if ((selected != null || selectedConst) && window.matchMedia("(max-width: 900px)").matches) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selected, selectedConst]);

  function selectStar(hip: number) {
    setSelected(hip);
    setSelectedConst(null);
  }

  function pickFromSearch(s: StarSummary) {
    selectStar(s.hip);
    setFocus({ ra: s.ra, dec: s.dec, nonce: Date.now() });
  }

  /** Гість не може зберігати дані (UC-06 EX1): переходимо до входу */
  function requireLogin(): boolean {
    if (role !== "GUEST") return true;
    navigate("/", { state: { from: "/map", mode: "login" } });
    return false;
  }

  const visParams: Omit<VisibilityParams, "hip"> = {
    date: obs.date, time: obs.time, timezone: obs.tz, fold: obs.fold, location_source: place.source,
    ...(place.source !== "lviv" ? { latitude: place.lat, longitude: place.lon } : {}),
    ...(place.source === "device" && role === "GUEST" ? { guest_consent: guestConsent } : {}),
  };

  let overlay: string | null = null;
  if (catalog.error) overlay = null;
  else if (!catalog.ready) overlay = "Завантаження каталогу…";
  else if (visible.length === 0) overlay = "Жодна зоря не відповідає заданим умовам";

  return (
    <div className="map-page">
      <ObservationPanel
        applied={obs}
        onApply={setObs}
        showDisclaimer={mode === "local"}
        viewControls={
          <>
            <div className="segmented obs__seg" role="group" aria-label="Вигляд карти">
              <button type="button" aria-pressed={mode === "equatorial"} onClick={() => setMode("equatorial")}>Карта зір</button>
              <button type="button" aria-pressed={mode === "local"} onClick={() => setMode("local")}>
                {place.source === "lviv" ? "Небо над Львовом" : "Небо над місцем"}
              </button>
            </div>
            {mode === "equatorial" && (
              <div className="map-page__proj">
                <Select<Projection> size="sm" value={projection} onChange={setProjection} aria-label="Проєкція карти" menuWidth={280}
                  icon={<Icon name="layers" size={15} />}
                  options={[
                    { value: "equirect", label: "Рівнопроміжна", hint: "Усе небо прямокутником, як карта світу" },
                    { value: "stereo", label: "Стереографічна", hint: "Як погляд на небесну сферу, менше спотворень" },
                  ]} />
              </div>
            )}
          </>
        }
      />

      {(catalog.error || catalog.failedTiles.length > 0) && (
        <div className="notice notice--error row" role="alert">
          <span>Не вдалося завантажити дані каталогу{catalog.error ? `: ${catalog.error}` : " для частини неба"}. Поточний запит не виконано.</span>
          <button type="button" className="btn btn--outline btn--sm" onClick={catalog.retry}>Повторити</button>
        </div>
      )}

      <div className="map-page__body">
        <aside className="map-page__side map-page__filters panel">
          {onlyList && (
            <button type="button" className="chip-note" onClick={() => setOnlyList(null)}>
              <Icon name="bookmark" size={14} /> Список: {onlyList.name} <Icon name="x" size={14} />
            </button>
          )}
          <div className="segmented map-page__switch" role="tablist" aria-label="Панель">
            <button type="button" role="tab" aria-selected={panel === "search"} aria-pressed={panel === "search"} onClick={() => setPanel("search")}>Пошук</button>
            <button type="button" role="tab" aria-selected={panel === "filters"} aria-pressed={panel === "filters"} onClick={() => setPanel("filters")}>Фільтри</button>
          </div>
          {panel === "search" ? (
            <SearchPanel onPick={pickFromSearch} />
          ) : (
            <FiltersPanel applied={filters} onApply={setFilters} found={visible.length} catalog={serverCount}
              excludedNoDistance={excluded} />
          )}
        </aside>

        <section className="map-page__center panel">
          <div className="map-page__canvas">
            <SkyMap
              stars={visible}
              lineStars={catalog.byHip}
              constellations={catalog.constellations}
              mode={mode}
              projection={projection}
              date={obs.instant}
              place={place}
              selectedHip={selected}
              selectedConstId={selectedConst?.id ?? null}
              onSelect={(s) => selectStar(s.hip)}
              onSelectConstellation={(c) => {
                setSelectedConst(c);
                setSelected(null);
              }}
              showNames={showNames}
              showGrid={showGrid}
              showMotion={showMotion}
              showConstellations={showConstellations}
              focus={focus}
              onViewTiles={onViewTiles}
              overlayMessage={overlay}
            />
            {catalog.loadingTiles > 0 && <span className="map-page__loading">Завантаження слабших зір…</span>}
          </div>

          <div className="map-page__toggles">
            <label><input type="checkbox" checked={showConstellations} onChange={(e) => setShowConstellations(e.target.checked)} /> <Term id="constellation">Сузір'я</Term></label>
            <label><input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> Назви</label>
            <label><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> <Term id="grid">Сітка</Term></label>
            <label><input type="checkbox" checked={showMotion} disabled={mode === "local"} onChange={(e) => setShowMotion(e.target.checked)} /> <Term id="pm">Власний рух</Term></label>
            <span className="spacer" />
            <span className="map-page__legend" aria-label="Колір зір за B–V">
              <span className="map-page__legend-title"><Term id="bv">Колір за B–V</Term>:</span>
              {COLOR_LEGEND.map((l) => (
                <span key={l.bv} title={`B–V ${l.bv}`}><i style={{ background: l.color }} />{l.label}</span>
              ))}
              <span title="Немає значення B–V"><i className="map-page__nocolor" />немає B–V</span>
            </span>
          </div>
          {showMotion && mode === "equatorial" && (
            <p className="muted xsmall">Стрілки показують зміщення зір за {MOTION_YEARS.toLocaleString("uk-UA")} років (для власного руху від 20 мс/рік).</p>
          )}
        </section>

        <aside ref={cardRef} className="map-page__side map-page__card panel">
          {selectedConst ? (
            <ConstellationCard constellation={selectedConst} byHip={catalog.byHip}
              onPickStar={(s) => { selectStar(s.hip); }} />
          ) : (
            <StarCard
              hip={selected}
              visParams={selected != null ? visParams : null}
              lists={lists}
              role={role}
              canUsePersonal={canUsePersonal}
              isFavorite={selected != null && isFavorite(selected)}
              onFavorite={async () => {
                if (selected != null && requireLogin()) await toggleFavorite(selected);
              }}
              onAddToList={async (listId) => {
                if (selected != null && requireLogin()) await addToList(listId, selected);
              }}
              onJournal={() => {
                if (requireLogin()) navigate("/journal", { state: { hip: selected } });
              }}
              onClose={() => setSelected(null)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

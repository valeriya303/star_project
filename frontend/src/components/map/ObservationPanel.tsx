import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import Icon from "@/components/brand/Icon";
import ConsentDialog from "@/components/consent/ConsentDialog";
import Term from "@/components/help/Term";
import Select from "@/components/ui/Select";
import { usePlace } from "@/context/LocationContext";
import { useGeolocation } from "@/hooks/useGeolocation";
import { formatPlace } from "@/utils/astro";
import { parseNum } from "@/utils/format";
import { formatOffset, nowIn, resolveLocal, timezoneOptions } from "@/utils/time";
import "./ObservationPanel.css";

export interface ObsParams {
  date: string;
  time: string;
  tz: string;
  fold: 0 | 1 | null;
  instant: Date;
  offset: number;
  live: boolean;
}

interface Props {
  applied: ObsParams;
  onApply: (p: ObsParams) => void;
  showDisclaimer: boolean;
  /** Перша група панелі: вибір вигляду карти та проєкції */
  viewControls?: ReactNode;
}

/** UC-07: параметри спостереження — місце (Львів / вручну / геолокація), дата, час і часовий пояс */
export default function ObservationPanel({ applied, onApply, showDisclaimer, viewControls }: Props) {
  const { place, setManual, resetToLviv } = usePlace();
  const geo = useGeolocation();
  const tzList = useMemo(() => timezoneOptions(), []);

  const [date, setDate] = useState(applied.date);
  const [time, setTime] = useState(applied.time);
  const [tz, setTz] = useState(applied.tz);
  const [fold, setFold] = useState<0 | 1 | null>(applied.fold);
  const [placeMode, setPlaceMode] = useState<"lviv" | "manual" | "device">(place.source);
  const [lat, setLat] = useState(place.source === "manual" ? String(place.lat) : "");
  const [lon, setLon] = useState(place.source === "manual" ? String(place.lon) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resolved = useMemo(() => resolveLocal(date, time, tz), [date, time, tz]);

  function show(nextLive = false, override?: { date: string; time: string }) {
    const e: Record<string, string> = {};
    const d = override?.date ?? date;
    const t = override?.time ?? time;
    if (placeMode === "manual") {
      const la = parseNum(lat);
      const lo = parseNum(lon);
      if (la == null || la < -90 || la > 90) e.lat = "Широта від −90° до +90°";
      if (lo == null || lo < -180 || lo > 180) e.lon = "Довгота від −180° до +180°";
      if (!e.lat && !e.lon) setManual(la!, lo!);
    }
    const r = override ? resolveLocal(d, t, tz) : resolved;
    let instant: Date | null = null;
    let offset = 0;
    let f: 0 | 1 | null = null;
    if (r.kind === "invalid") e.time = "Вкажіть коректні дату й час";
    else if (r.kind === "nonexistent") e.time = "Такого місцевого часу не існує (перехід на літній час). Вкажіть інший час";
    else if (r.kind === "ambiguous") {
      if (fold == null) e.time = "Місцевий час неоднозначний (перехід на зимовий час). Оберіть, який саме момент";
      else {
        instant = r.options[fold].instant;
        offset = r.options[fold].offset;
        f = fold;
      }
    } else {
      instant = r.instant;
      offset = r.offset;
    }
    setErrors(e);
    if (Object.keys(e).length || !instant) return; // EX3
    onApply({ date: d, time: t, tz, fold: f, instant, offset, live: nextLive });
  }

  function now() {
    const n = nowIn(tz);
    setDate(n.date);
    setTime(n.time);
    setFold(null);
    show(true, n);
  }

  function choosePlace(m: "lviv" | "manual" | "device") {
    setPlaceMode(m);
    setErrors({});
    if (m === "lviv") resetToLviv();
    if (m === "device") void geo.start();
  }

  const active = placeMode === "manual" ? "manual" : place.source;
  const errorText = [errors.lat, errors.lon, errors.time].filter(Boolean).join(". ");

  return (
    <section className="obs panel" aria-label="Параметри перегляду неба">
      <div className="obs__groups">
        {viewControls && (
          <div className="obs__group">
            <span className="obs__label"><Icon name="eye" size={14} /> Вигляд</span>
            <div className="obs__controls">{viewControls}</div>
          </div>
        )}

        <div className="obs__group">
          <span className="obs__label"><Icon name="pin" size={14} /> Місце спостереження</span>
          <div className="obs__controls">
            <div className="segmented obs__seg" role="group" aria-label="Місце спостереження">
              <button type="button" aria-pressed={active === "lviv"} onClick={() => choosePlace("lviv")}>Львів</button>
              <button type="button" aria-pressed={active === "manual"} onClick={() => choosePlace("manual")}>Вручну</button>
              <button type="button" aria-pressed={active === "device"} onClick={() => choosePlace("device")} disabled={geo.busy}
                title="Потрібна згода на використання геолокації">
                {geo.busy ? "Визначення…" : "Моє місце"}
              </button>
            </div>
            {placeMode === "manual" && (
              <div className="obs__coords">
                <input className={"field__input obs__input" + (errors.lat ? " field__input--error" : "")} inputMode="decimal"
                  placeholder="Широта, °" value={lat} onChange={(e) => setLat(e.target.value)} aria-label="Широта, від −90 до 90" />
                <input className={"field__input obs__input" + (errors.lon ? " field__input--error" : "")} inputMode="decimal"
                  placeholder="Довгота, °" value={lon} onChange={(e) => setLon(e.target.value)} aria-label="Довгота, від −180 до 180" />
              </div>
            )}
          </div>
        </div>

        <div className="obs__group obs__group--time">
          <span className="obs__label"><Icon name="clock" size={14} /> Дата, час і <Term id="timezone">часовий пояс</Term></span>
          <div className="obs__controls">
            <input type="date" className="field__input obs__input obs__date" value={date} aria-label="Дата спостереження"
              onChange={(e) => { setDate(e.target.value); setFold(null); }} />
            <input type="time" className={"field__input obs__input obs__time" + (errors.time ? " field__input--error" : "")} value={time}
              aria-label="Час спостереження" onChange={(e) => { setTime(e.target.value); setFold(null); }} />
            <div className="obs__tz">
              <Select size="sm" value={tz} onChange={setTz} options={tzList} searchable menuWidth={320}
                searchPlaceholder="Місто або регіон, напр. Kyiv" aria-label="Часовий пояс" icon={<Icon name="globe" size={15} />} />
            </div>
            {resolved.kind === "ambiguous" && (
              <div className="obs__fold">
                <Select<"0" | "1"> size="sm" value={fold == null ? "" : (String(fold) as "0" | "1")} placeholder="Який момент?"
                  aria-label="Уточнення моменту" menuWidth={240} onChange={(v) => setFold(Number(v) as 0 | 1)}
                  options={resolved.options.map((o) => ({
                    value: String(o.fold) as "0" | "1",
                    label: o.fold === 0 ? "Перший (ще літній час)" : "Другий (уже зимовий час)",
                    meta: formatOffset(o.offset),
                  }))} />
              </div>
            )}
          </div>
        </div>

        <div className="obs__actions">
          <button type="button" className="btn btn--outline btn--sm" onClick={now} title="Поточний момент з автооновленням">Зараз</button>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => show(false)}>Показати небо</button>
        </div>
      </div>

      {errorText && <p className="obs__error" role="alert">{errorText}</p>}
      {geo.message && <p className="obs__error" role="status">{geo.message}</p>}

      <p className="obs__info">
        <span className="obs__dot" aria-hidden="true" />
        <span>
          {formatPlace(place)} · {applied.date.split("-").reverse().join(".")}, {applied.time} · {applied.tz} ({formatOffset(applied.offset)})
          {applied.live && <span className="obs__live"> · наживо</span>}
          {showDisclaimer && (
            <> · <Term id="geometric">геометричне положення</Term> без урахування погоди та перешкод</>
          )}
        </span>
      </p>

      {geo.askConsent && <ConsentDialog code="C-01" onAccept={geo.accept} onDecline={geo.decline} busy={geo.busy} />}
    </section>
  );
}

import { useEffect, useState } from "react";

import { skyApi } from "@/api/endpoints";
import type { AboutData } from "@/api/endpoints";
import { fmtInt } from "@/utils/format";
import { fmtDateTime } from "@/utils/time";

/** Розділ «Про дані» (DG-4, DG-8): джерела, версії, ліцензії, зазначення авторства */
export default function AboutDataPage() {
  const [d, setD] = useState<AboutData | null>(null);
  useEffect(() => {
    skyApi.aboutData().then(setD).catch(() => undefined);
  }, []);

  return (
    <div className="stack" style={{ maxWidth: 960 }}>
      <h1 className="page-title">Про дані</h1>
      <p>
        Каталог зір зберігається в системі локально (AD-02) і оновлюється лише через перевірений імпорт. Для кожного запису
        зберігаються джерело, версія, партія імпорту та виконані перетворення — їх видно в картці зорі в блоці «Походження даних».
      </p>
      {d?.catalog.map((c) => (
        <section key={c.batch_id} className="panel box">
          <h2 className="box__title">{c.source} <span className="tag">{c.status === "active" ? "чинна версія" : "попередня версія"}</span></h2>
          <dl className="kv">
            <div><dt>Сторінка завантаження</dt><dd><a href={c.source_url} target="_blank" rel="noreferrer">{c.source_url}</a></dd></div>
            <div><dt>Першоджерело</dt><dd>{c.origin}</dd></div>
            <div><dt>Версія джерела</dt><dd>{c.source_version}</dd></div>
            <div><dt>Ліцензія</dt><dd>{c.license}</dd></div>
            <div><dt>Файл / SHA-256</dt><dd className="mono">{c.file_name} · {c.checksum_sha256.slice(0, 20)}…</dd></div>
            <div><dt>Дата імпорту / партія</dt><dd>{fmtDateTime(c.imported_at)} · <span className="mono">{c.batch_id}</span></dd></div>
            <div><dt>Записів прийнято / відхилено</dt><dd>{fmtInt((c.stats.accepted ?? 0) + (c.stats.accepted_with_warnings ?? 0))} / {fmtInt(c.stats.rejected ?? 0)}</dd></div>
            <div><dt>Перетворення</dt><dd>{Object.entries(c.transformations).map(([k, v]) => `${k}: ${fmtInt(v)}`).join("; ") || "немає"}</dd></div>
          </dl>
          {c.license.includes("BY-SA") && (
            <p className="small">Дані HYG Database поширюються за ліцензією <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>; адаптовані матеріали — на тих самих умовах.</p>
          )}
        </section>
      ))}
      {d?.sky_culture.map((s) => (
        <section key={s.batch_id} className="panel box">
          <h2 className="box__title">{s.source}</h2>
          <dl className="kv">
            <div><dt>Джерело</dt><dd><a href={s.source_url} target="_blank" rel="noreferrer">Stellarium (GitHub)</a></dd></div>
            <div><dt>Версія</dt><dd>{s.source_version}</dd></div>
            <div><dt>Ліцензія</dt><dd>{s.license}</dd></div>
            <div><dt>Сузір'їв / назв зір</dt><dd>{s.constellations} / {s.star_names}</dd></div>
            <div><dt>Дата імпорту</dt><dd>{fmtDateTime(s.imported_at)}</dd></div>
          </dl>
        </section>
      ))}
      {d && (
        <section className="panel box">
          <h2 className="box__title">Обчислення</h2>
          <p className="small">{d.boundaries}</p>
          <p className="small">{d.calculations}</p>
          <p className="small">Видимість зір розраховується з урахуванням власного руху від епохи Hipparcos (J1991.25), прецесії та рефракції на горизонті. Погода й місцеві перешкоди не враховуються.</p>
          <p className="small">Дані ESA Gaia в системі не використовуються (рішення команди, AR-1).</p>
        </section>
      )}
    </div>
  );
}

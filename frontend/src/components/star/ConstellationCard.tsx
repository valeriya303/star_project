import { useEffect, useState } from "react";

import { skyApi } from "@/api/endpoints";
import type { Constellation, Star } from "@/types/star";
import { fmt, starTitle } from "@/utils/format";
import "./StarCard.css";

interface Props {
  constellation: Constellation;
  byHip: Map<number, Star>;
  onPickStar: (s: Star) => void;
}

export default function ConstellationCard({ constellation, byHip, onPickStar }: Props) {
  const [details, setDetails] = useState<Constellation | null>(null);

  useEffect(() => {
    let alive = true;
    skyApi.constellation(constellation.abbr).then((d) => alive && setDetails(d)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [constellation.abbr]);

  const stars = [...new Set(constellation.lines.flat())]
    .flatMap((hip) => {
      const s = byHip.get(hip);
      return s ? [s] : [];
    })
    .sort((a, b) => a.vmag - b.vmag);

  return (
    <div className="star-card">
      <h2 className="star-card__name">{constellation.name}</h2>
      <p className="muted star-card__sub">Сузір'я · {constellation.latin} · {constellation.abbr}</p>

      <p className="small">{details?.description ?? "Завантаження опису…"}</p>
      {details?.stars_count != null && (
        <p className="muted xsmall">Зір каталогу в межах сузір'я: {details.stars_count.toLocaleString("uk-UA")}</p>
      )}

      <h3 className="star-card__h3">Зорі фігури ({stars.length})</h3>
      <ul className="const-stars">
        {stars.map((s) => (
          <li key={s.hip}>
            <button type="button" className="link-btn" onClick={() => onPickStar(s)}>
              {starTitle(s)}
            </button>
            <span className="muted">{fmt(s.vmag, 2)}m</span>
          </li>
        ))}
      </ul>
      <p className="muted xsmall">Лінії сузір'я — Stellarium Sky Cultures (modern), межі — IAU.</p>
    </div>
  );
}

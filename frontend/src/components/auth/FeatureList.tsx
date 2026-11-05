import Icon from "@/components/brand/Icon";
import type { Feature } from "./access";
import "./FeatureList.css";

interface Props {
  items: Feature[];
  tone?: "default" | "accent";
}

/** Перелік можливостей з іконками в рамках */
export default function FeatureList({ items, tone = "default" }: Props) {
  return (
    <ul className={"features features--" + tone}>
      {items.map((f) => (
        <li key={f.title} className="features__item">
          <span className="features__icon"><Icon name={f.icon} size={18} /></span>
          <span className="features__body">
            <strong>{f.title}</strong>
            <span>{f.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

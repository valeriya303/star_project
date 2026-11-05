import "./Logo.css";

interface Props {
  size?: number;
  withText?: boolean;
  className?: string;
}

/** Знак Star: чотирипроменева зоря на орбіті */
export default function Logo({ size = 40, withText = true, className = "" }: Props) {
  return (
    <span className={"logo " + className}>
      <svg className="logo__mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
        <ellipse cx="24" cy="24" rx="21" ry="8" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2"
          transform="rotate(-24 24 24)" />
        <path d="M24 6 C25.6 17.5 30.5 22.4 42 24 C30.5 25.6 25.6 30.5 24 42 C22.4 30.5 17.5 25.6 6 24 C17.5 22.4 22.4 17.5 24 6 Z"
          fill="currentColor" />
        <circle cx="38.5" cy="15" r="1.8" fill="currentColor" />
      </svg>
      {withText && <span className="logo__text">Star</span>}
    </span>
  );
}

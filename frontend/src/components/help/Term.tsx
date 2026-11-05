import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import { GLOSSARY_BY_ID } from "@/content/glossary";
import "./Term.css";

interface Props {
  /** Ідентифікатор у глосарії (src/content/glossary.ts) */
  id: string;
  children: ReactNode;
}

/**
 * Термін із поясненням: пунктирне підкреслення й позначка «?».
 * Підказка відкривається наведенням, фокусом із клавіатури або дотиком.
 */
export default function Term({ id, children }: Props) {
  const entry = GLOSSARY_BY_ID[id];
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const tipId = useId();

  function open() {
    window.clearTimeout(closeTimer.current);
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(300, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 12));
    const above = r.bottom + 210 > window.innerHeight && r.top > 220;
    setPos({ top: above ? r.top - 8 : r.bottom + 8, left, above });
  }

  function close() {
    closeTimer.current = window.setTimeout(() => setPos(null), 120);
  }

  useEffect(() => {
    if (!pos) return;
    const onScroll = () => setPos(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [pos]);

  if (!entry) return <>{children}</>;

  return (
    <span
      ref={ref}
      className="term"
      tabIndex={0}
      aria-describedby={pos ? tipId : undefined}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      onClick={(e) => {
        e.stopPropagation();
        if (pos) setPos(null);
        else open();
      }}
    >
      {children}
      <span className="term__mark" aria-hidden="true">?</span>
      {pos && createPortal(
        <span
          id={tipId}
          role="tooltip"
          className={"term__tip" + (pos.above ? " term__tip--above" : "")}
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={() => window.clearTimeout(closeTimer.current)}
          onMouseLeave={close}
        >
          <strong className="term__title">{entry.term}</strong>
          <span className="term__text">{entry.short}</span>
          <Link to={`/help#${entry.id}`} className="term__more" onClick={() => setPos(null)}>
            Детальніше в довідці →
          </Link>
        </span>,
        document.body,
      )}
    </span>
  );
}

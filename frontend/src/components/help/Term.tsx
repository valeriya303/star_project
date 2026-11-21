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
 * Підказка відкривається наведенням миші, фокусом із клавіатури або дотиком (з першого тапу).
 */
export default function Term({ id, children }: Props) {
  const entry = GLOSSARY_BY_ID[id];
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const openRef = useRef(false);
  const tipId = useId();

  function open() {
    window.clearTimeout(closeTimer.current);
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(300, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 12));
    const above = r.bottom + 210 > window.innerHeight && r.top > 220;
    openRef.current = true;
    setPos({ top: above ? r.top - 8 : r.bottom + 8, left, above });
  }

  function hide() {
    window.clearTimeout(closeTimer.current);
    openRef.current = false;
    setPos(null);
  }

  function closeSoon() {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(hide, 120);
  }

  /** Наведення миші й фокус клавіатури; для дотику ці події ігноруємо, їх обробляє click */
  const isMouse = (e: React.PointerEvent) => e.pointerType === "mouse";

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    if (!pos) return;
    const onScroll = () => hide();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    // тап поза терміном і поза підказкою закриває вікно
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || tipRef.current?.contains(t)) return;
      hide();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [pos]);

  if (!entry) return <>{children}</>;

  return (
    <span
      ref={ref}
      className="term"
      tabIndex={0}
      aria-describedby={pos ? tipId : undefined}
      onPointerEnter={(e) => { if (isMouse(e)) open(); }}
      onPointerLeave={(e) => { if (isMouse(e)) closeSoon(); }}
      onFocus={(e) => {
        // фокус від дотику не відкриває: це зробить click; клавіатурний фокус відкриває
        if (e.currentTarget.matches(":focus-visible")) open();
      }}
      onBlur={() => closeSoon()}
      onClick={(e) => {
        e.stopPropagation();
        if (openRef.current) hide();
        else open();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (openRef.current) hide();
          else open();
        }
      }}
    >
      {children}
      <span className="term__mark" aria-hidden="true">?</span>
      {pos && createPortal(
        <span
          ref={tipRef}
          id={tipId}
          role="tooltip"
          className={"term__tip" + (pos.above ? " term__tip--above" : "")}
          style={{ top: pos.top, left: pos.left }}
          onPointerEnter={(e) => { if (isMouse(e)) window.clearTimeout(closeTimer.current); }}
          onPointerLeave={(e) => { if (isMouse(e)) closeSoon(); }}
        >
          <strong className="term__title">{entry.term}</strong>
          <span className="term__text">{entry.short}</span>
          <Link to={`/help#${entry.id}`} className="term__more" onClick={hide}>
            Детальніше в довідці →
          </Link>
        </span>,
        document.body,
      )}
    </span>
  );
}

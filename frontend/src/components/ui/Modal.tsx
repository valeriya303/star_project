import { useEffect } from "react";
import type { ReactNode } from "react";

import Icon from "@/components/brand/Icon";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

/* Лічильник відкритих модальних вікон: фон розблоковується лише після закриття останнього */
let lockCount = 0;
let savedScrollY = 0;

function lockBody() {
  if (lockCount++ > 0) return;
  savedScrollY = window.scrollY;
  const b = document.body.style;
  b.position = "fixed";
  b.top = `-${savedScrollY}px`;
  b.left = "0";
  b.right = "0";
  b.width = "100%";
  b.overflow = "hidden";
  document.documentElement.style.overflow = "hidden";
}

function unlockBody() {
  if (--lockCount > 0) return;
  const b = document.body.style;
  b.position = "";
  b.top = "";
  b.left = "";
  b.right = "";
  b.width = "";
  b.overflow = "";
  document.documentElement.style.overflow = "";
  window.scrollTo(0, savedScrollY);
}

export default function Modal({ title, onClose, children, wide }: Props) {
  useEffect(() => {
    lockBody();
    return () => unlockBody();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"panel modal__body" + (wide ? " modal__body--wide" : "")}>
        <div className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Закрити" title="Закрити (Esc)">
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

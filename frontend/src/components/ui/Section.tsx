import { useState } from "react";
import type { ReactNode } from "react";
import "./Section.css";

interface Props {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  onOpen?: () => void;
}

export default function Section({ title, defaultOpen = true, children, onOpen }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="section">
      <button
        type="button"
        className="section__head"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        <span>{title}</span>
        <span className={"section__arrow" + (open ? " section__arrow--open" : "")}>▾</span>
      </button>
      {open && <div className="section__body">{children}</div>}
    </div>
  );
}

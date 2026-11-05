import type { ReactNode } from "react";

import Modal from "@/components/ui/Modal";
import { useConsentTexts } from "@/hooks/useConsentTexts";
import type { ConsentCode, ConsentText } from "@/types/userData";

interface Props {
  code: ConsentCode;
  onAccept: (text: ConsentText) => void;
  onDecline: () => void;
  busy?: boolean;
  error?: string;
  /** Додаткові поля перед підтвердженням (наприклад, авторство й ліцензія для C-02) */
  children?: ReactNode;
  acceptDisabled?: boolean;
}

/** Окреме вікно згоди: текст українською, мета обробки, кнопки без попереднього вибору (DG-3 §2.3) */
export default function ConsentDialog({ code, onAccept, onDecline, busy, error, children, acceptDisabled }: Props) {
  const get = useConsentTexts();
  const t = get(code);

  return (
    <Modal title={t?.title ?? "Згода"} onClose={onDecline}>
      {!t ? (
        <p className="muted">Завантаження тексту згоди…</p>
      ) : (
        <>
          <p>{t.text}</p>
          <p className="muted small">
            <strong>Мета обробки:</strong> {t.purpose}. Код згоди {t.code}, редакція {t.version}.
          </p>
          {children}
          {error && <p className="status-error small">{error}</p>}
          <div className="modal__actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={onDecline} disabled={busy}>
              {t.decline_label}
            </button>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => onAccept(t)} disabled={busy || acceptDisabled}>
              {busy ? "Збереження…" : t.accept_label}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

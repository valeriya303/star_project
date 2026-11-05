import { useState } from "react";

import { consentApi } from "@/api/endpoints";
import { useAuth } from "@/context/AuthContext";
import { usePlace } from "@/context/LocationContext";
import type { ConsentText } from "@/types/userData";

/**
 * Сценарій UC-07 AC2 / UC-19 / UC-20: перевірка згоди C-01 → пояснення мети →
 * надання згоди → дозвіл браузера → координати. Відмова не повторює запит автоматично (EX1).
 */
export function useGeolocation() {
  const { user } = useAuth();
  const { locateDevice, resetToLviv, guestConsent, setGuestConsent } = usePlace();
  const [askConsent, setAskConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function hasConsent(): Promise<boolean> {
    if (!user) return guestConsent;
    try {
      const st = await consentApi.mine();
      return !!st.current["C-01"];
    } catch {
      return false;
    }
  }

  async function obtain() {
    setBusy(true);
    const r = await locateDevice();
    setBusy(false);
    if (r.ok) {
      setMessage("");
      return;
    }
    resetToLviv();
    setMessage(
      r.reason === "denied"
        ? "Геолокацію не надано. Використано координати Львова"
        : "Не вдалося визначити місце пристрою. Використано координати Львова — можна ввести місце вручну",
    );
  }

  async function start() {
    setMessage("");
    if (await hasConsent()) await obtain();
    else setAskConsent(true);
  }

  async function accept(t: ConsentText) {
    setBusy(true);
    try {
      if (user) await consentApi.grant("C-01", t.version);
      else setGuestConsent(true);
      setAskConsent(false);
      await obtain();
    } catch {
      setMessage("Не вдалося зберегти згоду. Спробуйте ще раз");
    } finally {
      setBusy(false);
    }
  }

  function decline() {
    setAskConsent(false);
    resetToLviv();
    setMessage("Геолокацію не надано. Використано координати Львова");
  }

  return { start, accept, decline, askConsent, busy, message, setMessage };
}

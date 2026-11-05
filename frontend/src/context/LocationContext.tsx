import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { LVIV } from "@/utils/astro";
import type { Place } from "@/utils/astro";
import { useAuth } from "./AuthContext";

/**
 * Місце спостереження. Координати НЕ записуються в localStorage і не надсилаються
 * для зберігання: вони живуть лише в пам'яті поточного сеансу (DS-5, RR-01).
 */
interface LocationValue {
  place: Place;
  setManual: (lat: number, lon: number) => void;
  resetToLviv: () => void;
  /** Отримати координати пристрою. Викликається лише ПІСЛЯ перевірки згоди C-01 */
  locateDevice: () => Promise<{ ok: boolean; reason?: "denied" | "unavailable" }>;
  /** Згода Гостя в межах сеансу (без облікового запису, UC-13) */
  guestConsent: boolean;
  setGuestConsent: (v: boolean) => void;
}

const LocationContext = createContext<LocationValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [place, setPlace] = useState<Place>(LVIV);
  const [guestConsent, setGuestConsent] = useState(false);

  // Зміна користувача: геолокація попереднього сеансу не переноситься
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- скидання при зміні облікового запису
    setPlace((p) => (p.source === "device" ? LVIV : p));
    setGuestConsent(false);
  }, [user?.id]);

  function locateDevice(): Promise<{ ok: boolean; reason?: "denied" | "unavailable" }> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ ok: false, reason: "unavailable" });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setPlace({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: "Ваше місце", source: "device" });
          resolve({ ok: true });
        },
        (err) => resolve({ ok: false, reason: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" }),
        { timeout: 10000, maximumAge: 0 },
      );
    });
  }

  return (
    <LocationContext.Provider
      value={{
        place,
        setManual: (lat, lon) => setPlace({ lat, lon, name: "Введене місце", source: "manual" }),
        resetToLviv: () => setPlace(LVIV),
        locateDevice,
        guestConsent,
        setGuestConsent,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePlace() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("usePlace має використовуватись всередині LocationProvider");
  return ctx;
}

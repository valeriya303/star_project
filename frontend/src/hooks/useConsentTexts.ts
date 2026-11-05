import { useEffect, useState } from "react";

import { consentApi } from "@/api/endpoints";
import type { ConsentCode, ConsentText } from "@/types/userData";

let cache: ConsentText[] | null = null;

/** Актуальні тексти згод (DG-3 §2.4) з версіями — щоб зафіксувати, з якою редакцією погодився користувач */
export function useConsentTexts() {
  const [texts, setTexts] = useState<ConsentText[] | null>(cache);
  useEffect(() => {
    if (cache) return;
    consentApi.texts().then((t) => {
      cache = t;
      setTexts(t);
    }).catch(() => undefined);
  }, []);
  return (code: ConsentCode) => texts?.find((t) => t.code === code) ?? null;
}

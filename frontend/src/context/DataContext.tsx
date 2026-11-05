import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { listsApi } from "@/api/endpoints";
import type { StarList } from "@/types/userData";
import { useAuth } from "./AuthContext";

/** Списки зір поточного користувача (UC-06) для швидких дій із картки зорі */
interface DataValue {
  lists: StarList[];
  favorites: StarList | undefined;
  isFavorite: (hip: number) => boolean;
  toggleFavorite: (hip: number) => Promise<void>;
  addToList: (id: string, hip: number) => Promise<void>;
  createList: (name: string) => Promise<StarList>;
  reload: () => Promise<void>;
}

const DataContext = createContext<DataValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { user, canUsePersonal } = useAuth();
  const [lists, setLists] = useState<StarList[]>([]);

  const reload = useCallback(async () => {
    if (!canUsePersonal) {
      setLists([]);
      return;
    }
    try {
      setLists(await listsApi.list());
    } catch {
      /* відображення продовжиться без списків */
    }
  }, [canUsePersonal]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- завантаження при зміні користувача
    void reload();
  }, [reload, user?.id]);

  const favorites = lists.find((l) => l.is_favorites);

  async function toggleFavorite(hip: number) {
    if (!favorites) return;
    if (favorites.hips.includes(hip)) await listsApi.removeStar(favorites.id, hip);
    else await listsApi.addStar(favorites.id, hip);
    await reload();
  }

  async function addToList(id: string, hip: number) {
    await listsApi.addStar(id, hip);
    await reload();
  }

  async function createList(name: string) {
    const l = await listsApi.create(name);
    await reload();
    return l;
  }

  return (
    <DataContext.Provider
      value={{
        lists, favorites, isFavorite: (hip) => favorites?.hips.includes(hip) ?? false,
        toggleFavorite, addToList, createList, reload,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData має використовуватись всередині DataProvider");
  return ctx;
}

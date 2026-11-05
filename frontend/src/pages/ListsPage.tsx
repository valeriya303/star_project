import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { listsApi } from "@/api/endpoints";
import Modal from "@/components/ui/Modal";
import StarPicker from "@/components/ui/StarPicker";
import { useData } from "@/context/DataContext";
import { usePlace } from "@/context/LocationContext";
import type { StarSummary } from "@/types/star";
import type { StarList } from "@/types/userData";
import { quickVisibility } from "@/utils/astro";
import { MISSING, fmt, starTitle } from "@/utils/format";
import "./ListsPage.css";

/** UC-06: керування списками улюблених зір */
export default function ListsPage() {
  const navigate = useNavigate();
  const { lists, reload } = useData();
  const { place } = usePlace();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<StarList | null>(null);
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameError, setRenameError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pick, setPick] = useState<StarSummary | null>(null);
  const [msg, setMsg] = useState("");

  const currentId = activeId ?? lists[0]?.id ?? null;

  const load = useCallback(async (id: string) => {
    try {
      setActive(await listsApi.get(id));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Не вдалося відкрити список");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- завантаження вибраного списку
    if (currentId) void load(currentId);
  }, [currentId, load, lists]);

  async function handleCreate(ev: FormEvent) {
    ev.preventDefault();
    if (!newName.trim()) {
      setNewError("Введіть назву списку"); // EX4
      return;
    }
    try {
      const l = await listsApi.create(newName);
      setNewName("");
      setNewError("");
      await reload();
      setActiveId(l.id);
    } catch (e) {
      setNewError(e instanceof ApiError ? Object.values(e.byField())[0] ?? e.message : "Помилка");
    }
  }

  async function handleRename(ev: FormEvent) {
    ev.preventDefault();
    if (!active || renaming == null) return;
    if (!renaming.trim()) {
      setRenameError("Введіть назву списку");
      return;
    }
    try {
      await listsApi.rename(active.id, renaming);
      setRenaming(null);
      setRenameError("");
      await reload();
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : "Помилка");
    }
  }

  async function handleDelete() {
    if (!active) return;
    await listsApi.remove(active.id);
    setConfirmDelete(false);
    setActiveId(null);
    await reload();
  }

  async function addStar() {
    if (!active || !pick) return;
    setMsg("");
    try {
      await listsApi.addStar(active.id, pick.hip);
      setPick(null);
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Не вдалося додати зорю");
    }
  }

  async function removeStar(hip: number) {
    if (!active) return;
    await listsApi.removeStar(active.id, hip);
    await reload();
  }

  const now = new Date();

  return (
    <div className="lists">
      <aside className="panel lists__side">
        <h1 className="page-title">Мої списки</h1>

        <div className="lists__items">
          {lists.map((l) => (
            <button key={l.id} type="button" className={"lists__item" + (l.id === currentId ? " lists__item--active" : "")}
              onClick={() => { setActiveId(l.id); setRenaming(null); }}>
              <span>{l.is_favorites ? "★ " : ""}{l.name}</span>
              <span className="muted">{l.hips.length}</span>
            </button>
          ))}
        </div>

        <form className="lists__new" onSubmit={handleCreate} noValidate>
          <input className={"field__input" + (newError ? " field__input--error" : "")} placeholder="Назва нового списку"
            value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Назва нового списку" maxLength={100} />
          {newError && <span className="field__error">{newError}</span>}
          <button type="submit" className="btn btn--primary btn--sm">Створити список</button>
        </form>
      </aside>

      <section className="panel lists__main">
        {!active ? (
          <p className="muted">Завантаження…</p>
        ) : (
          <>
            <div className="lists__head">
              {renaming != null ? (
                <form className="row" onSubmit={handleRename} noValidate>
                  <input className={"field__input lists__rename" + (renameError ? " field__input--error" : "")} value={renaming}
                    onChange={(e) => setRenaming(e.target.value)} aria-label="Нова назва" autoFocus maxLength={100} />
                  <button type="submit" className="btn btn--primary btn--sm">Зберегти</button>
                  <button type="button" className="btn btn--outline btn--sm" onClick={() => setRenaming(null)}>Скасувати</button>
                  {renameError && <span className="field__error">{renameError}</span>}
                </form>
              ) : (
                <h2 className="lists__title">{active.name}</h2>
              )}
              <div className="lists__actions">
                <button type="button" className="btn btn--outline btn--sm" disabled={active.hips.length === 0}
                  onClick={() => navigate("/map", { state: { hips: active.hips, listName: active.name } })}>
                  Показати на карті
                </button>
                {!active.is_favorites && renaming == null && (
                  <>
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => setRenaming(active.name)}>Перейменувати</button>
                    <button type="button" className="btn btn--danger btn--sm" onClick={() => setConfirmDelete(true)}>Видалити список</button>
                  </>
                )}
              </div>
            </div>

            {(active.stars ?? []).length === 0 ? (
              <p className="muted lists__empty">Список порожній. Додайте зорі нижче або з картки зорі на карті.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Назва</th><th>HIP</th><th>Сузір'я</th><th>Vmag</th><th>Спектр</th>
                      <th>Зараз ({place.source === "lviv" ? "Львів" : "ваше місце"})</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {(active.stars ?? []).map((s) => {
                      if (s.unavailable) {
                        return (
                          <tr key={s.hip}>
                            <td colSpan={6} className="muted">HIP {s.hip}: запис недоступний у поточній версії каталогу</td>
                            <td><button type="button" className="link-btn" onClick={() => removeStar(s.hip)}>Вилучити</button></td>
                          </tr>
                        );
                      }
                      const v = quickVisibility(s.ra, s.dec, now, place);
                      return (
                        <tr key={s.hip}>
                          <td><button type="button" className="link-btn" onClick={() => navigate("/map", { state: { hip: s.hip } })}><strong>{starTitle(s)}</strong></button></td>
                          <td>{s.hip}</td>
                          <td>{s.constellation_uk ?? "—"}</td>
                          <td>{fmt(s.vmag, 2)}</td>
                          <td>{s.sp_type ?? <span className="muted">{MISSING}</span>}</td>
                          <td className={v.above ? "status-ok" : "muted"}>
                            {v.neverRises ? "не сходить" : v.above ? `над горизонтом, ${Math.round(v.alt)}°` : "під горизонтом"}
                          </td>
                          <td><button type="button" className="link-btn" onClick={() => removeStar(s.hip)}>Вилучити</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="lists__add">
              <StarPicker id="list-add" label="Додати зорю" value={pick} onChange={setPick} />
              <button type="button" className="btn btn--primary btn--sm" disabled={!pick} onClick={addStar}>Додати</button>
            </div>
            {msg && <p className="status-error small">{msg}</p>}
          </>
        )}
      </section>

      {confirmDelete && active && (
        <Modal title="Видалити список?" onClose={() => setConfirmDelete(false)}>
          <p>Список «{active.name}» буде видалено разом із його складом. Записи зір у каталозі залишаться без змін.</p>
          <div className="modal__actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setConfirmDelete(false)}>Скасувати</button>
            <button type="button" className="btn btn--danger btn--sm" onClick={handleDelete}>Видалити</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

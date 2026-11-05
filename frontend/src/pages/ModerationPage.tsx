import { useCallback, useEffect, useState } from "react";

import { fileUrl } from "@/api/client";
import { moderationApi } from "@/api/endpoints";
import type { Complaint, Decision } from "@/api/endpoints";
import Modal from "@/components/ui/Modal";
import Tabs from "@/components/ui/Tabs";
import type { Photo } from "@/types/userData";
import { fmtDate, fmtDateTime } from "@/utils/time";
import "./GalleryPage.css";

/** UC-11: модерація знімків; розгляд скарг (RR-02) */
export default function ModerationPage() {
  const [tab, setTab] = useState<"queue" | "complaints" | "decisions">("queue");
  const [queue, setQueue] = useState<Photo[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [rejectFor, setRejectFor] = useState<Photo | null>(null);
  const [reason, setReason] = useState("");
  const [view, setView] = useState<Photo | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [q, c, d] = await Promise.all([moderationApi.queue(), moderationApi.complaints(), moderationApi.decisions()]);
    setQueue(q);
    setComplaints(c);
    setDecisions(d);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- завантаження черги
    void load();
  }, [load]);

  async function act(f: () => Promise<string>) {
    setMsg("");
    try {
      setMsg(await f());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Помилка");
    }
    await load();
  }

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Модерація</h1>
        <Tabs tabs={[
          { value: "queue", label: `Черга (${queue.length})` },
          { value: "complaints", label: `Скарги (${complaints.length})` },
          { value: "decisions", label: "Рішення" },
        ]} active={tab} onChange={setTab} />
      </div>
      {msg && <p className="notice small" role="status">{msg}</p>}

      {tab === "queue" && (
        <>
          {queue.length === 0 && <p className="muted empty">Черга порожня.</p>}
          <div className="gallery__grid">
            {queue.map((p) => (
              <article key={p.id} className="panel photo">
                <button type="button" className="photo__preview" style={{ padding: 0, border: "none" }} onClick={() => setView(p)}>
                  <img src={fileUrl(p.thumb_url)} alt={p.title} />
                </button>
                <strong>{p.title}</strong>
                <p className="muted xsmall">
                  {p.constellation_uk} · {fmtDate(p.date_taken)} · {p.author} · {p.license}<br />
                  {p.width_px}×{p.height_px} · {((p.file_size_bytes ?? 0) / 1048576).toFixed(1).replace(".", ",")} МБ · версія {p.version} ·
                  подано {p.submitted_at ? fmtDateTime(p.submitted_at) : "—"} · залишилось {p.retention_days_left} дн.
                </p>
                {p.description && <p className="small">{p.description}</p>}
                {p.is_own ? (
                  <p className="muted xsmall">Це ваш знімок — рішення ухвалює інший модератор (AP-02).</p>
                ) : (
                  <div className="row">
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => act(async () => {
                      const r = await moderationApi.approve(p.id, p.version!);
                      return `Схвалено${r.published ? " і опубліковано" : ""}. ${r.reward ? (r.reward.status === "credited" ? `Автору нараховано ${r.reward.points} балів` : r.reward.reason) : ""}`;
                    })}>Схвалити</button>
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => { setRejectFor(p); setReason(""); }}>Відхилити</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      {tab === "complaints" && (
        <>
          {complaints.length === 0 && <p className="muted empty">Відкритих скарг немає.</p>}
          {complaints.map((c) => (
            <article key={c.id} className="panel box">
              <div className="row">
                {c.photo && <img src={fileUrl(c.photo.thumb_url)} alt="" style={{ width: 120, borderRadius: 8 }} />}
                <div className="stack" style={{ gap: 4 }}>
                  <strong>{c.photo?.title ?? "Знімок видалено"}</strong>
                  <span className="small">{c.reason_label}</span>
                  {c.comment && <span className="muted small">{c.comment}</span>}
                  <span className="muted xsmall">{fmtDateTime(c.created_at)}</span>
                </div>
                <span className="spacer" />
                {c.is_own ? <span className="muted xsmall">Скарга на ваш знімок</span> : (
                  <>
                    <button type="button" className="btn btn--danger btn--sm" onClick={() => act(async () => { await moderationApi.resolve(c.id, "uphold"); return "Скаргу задоволено, знімок приховано"; })}>Приховати знімок</button>
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => act(async () => { await moderationApi.resolve(c.id, "dismiss"); return "Скаргу відхилено"; })}>Відхилити скаргу</button>
                  </>
                )}
              </div>
            </article>
          ))}
        </>
      )}

      {tab === "decisions" && (
        <div className="panel box table-wrap">
          <table className="table">
            <thead><tr><th>Дата</th><th>Знімок</th><th>Версія</th><th>Рішення</th><th>Статус</th><th>Причина</th><th>Ви</th></tr></thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id}>
                  <td>{fmtDateTime(d.created_at)}</td><td className="mono">{d.photo_id.slice(0, 8)}</td><td>{d.photo_version}</td>
                  <td>{d.decision === "approve" ? "Схвалено" : "Відхилено"}</td><td>{d.previous_status} → {d.new_status}</td>
                  <td>{d.reason || "—"}</td><td>{d.by_me ? "так" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view && (
        <Modal title={view.title} wide onClose={() => setView(null)}>
          <img src={fileUrl(view.full_url)} alt={view.title} style={{ width: "100%", borderRadius: 8 }} />
        </Modal>
      )}

      {rejectFor && (
        <Modal title="Відхилити знімок" onClose={() => setRejectFor(null)}>
          <div className="field">
            <label className="field__label" htmlFor="rej">Причина (буде показана автору)</label>
            <textarea id="rej" className="field__input field__input--area" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="modal__actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setRejectFor(null)}>Скасувати</button>
            <button type="button" className="btn btn--danger btn--sm" disabled={reason.trim().length < 3} onClick={() => {
              const p = rejectFor;
              setRejectFor(null);
              void act(async () => { await moderationApi.reject(p.id, p.version!, reason); return "Знімок відхилено"; });
            }}>Відхилити</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

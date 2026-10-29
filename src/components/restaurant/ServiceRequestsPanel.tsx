"use client";
import { useEffect, useRef, useState } from "react";
import { BellRing, Volume2, VolumeX } from "lucide-react";
import { api, button, secondary, panel, date, Notice, Pager } from "@/components/current-accounts/shared";
type Row = { id: string; type: string; status: string; createdAt: string; table: { name: string }; branch: { name: string }; assignedName: string | null; completedName: string | null; canFinish: boolean };
type Result = { notificationPolicy?: { enabled: boolean; notificationSound: boolean }; rows: Row[]; total: number; page: number; pages: number; latestId: string | null };
const statuses: Record<string, string> = { PENDING: "Bekliyor", ACKNOWLEDGED: "Görüldü / Üstlenildi", COMPLETED: "Tamamlandı", CANCELLED: "İptal edildi" };
export default function ServiceRequestsPanel({ branchId, canManage }: { branchId: string; canManage: boolean }) {
  const [data, setData] = useState<Result | null>(null), [history, setHistory] = useState(false), [page, setPage] = useState(1), [error, setError] = useState(""), [notice, setNotice] = useState(""), [sound, setSound] = useState(false), [pending, setPending] = useState(false), [revision, refresh] = useState(0), [now, setNow] = useState(() => Date.now());
  const audio = useRef<AudioContext | null>(null), latest = useRef<string | null | undefined>(undefined);
  useEffect(() => () => { void audio.current?.close(); }, []);
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>, controller: AbortController | null = null, failures = 0, running = false;
    async function poll() {
      if (stopped || running) return;
      if (document.hidden) { timer = setTimeout(poll, 5000); return; }
      running = true; controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 12000);
      try {
        const result = await api<Result>(`/api/restaurant/service-requests?branchId=${encodeURIComponent(branchId)}&history=${history}&page=${page}`, { signal: controller.signal });
        if (stopped) return;
        if (result.notificationPolicy?.enabled !== false && latest.current !== undefined && result.latestId && latest.current !== result.latestId) {
          setNotice("Yeni servis talebi geldi. Açık talepler listesini kontrol edin.");
          if (result.notificationPolicy?.notificationSound !== false && audio.current?.state === "running") {
            const context = audio.current, osc = context.createOscillator(), gain = context.createGain();
            osc.connect(gain); gain.connect(context.destination); osc.frequency.value = 740; gain.gain.setValueAtTime(0.08, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.4); osc.start(); osc.stop(context.currentTime + 0.4);
          }
        }
        latest.current = result.latestId; setData(result); setError(""); failures = 0; setNow(Date.now());
      } catch (e) { if (!stopped) { failures++; setError(e instanceof Error ? e.message : "Talepler yenilenemedi."); } }
      finally { clearTimeout(timeout); running = false; if (!stopped) timer = setTimeout(poll, Math.min(60000, 5000 * 2 ** Math.min(failures, 4))); }
    }
    const visible = () => { if (!document.hidden && !running) { clearTimeout(timer); void poll(); } };
    void poll(); document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", visible); };
  }, [branchId, history, page, revision]);
  async function toggleSound() {
    if (data?.notificationPolicy?.notificationSound === false) { setError("Şube ayarlarında servis talebi sesi kapalı."); return; }
    if (sound) { await audio.current?.suspend(); setSound(false); return; }
    try { audio.current ??= new AudioContext(); await audio.current.resume(); setSound(true); } catch { setError("Tarayıcı sesli uyarıya izin vermedi."); }
  }
  async function change(id: string, action: string) {
    if (pending) return; setPending(true);
    try { await api(`/api/restaurant/service-requests/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }); refresh(r => r + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "Talep güncellenemedi."); refresh(r => r + 1); }
    finally { setPending(false); }
  }
  return <section className={panel} aria-label="Servis talepleri"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><BellRing size={20}/>Servis Talepleri {data && <span className="text-sm text-slate-500">({data.total})</span>}</h2><p className="mt-1 text-xs text-slate-500">Görünürken 5 saniyede bir yenilenir. Hesap talepleri ödeme yapmaz.</p></div><div className="flex flex-wrap gap-2"><button className={secondary} onClick={() => void toggleSound()}>{sound ? <Volume2 size={16}/> : <VolumeX size={16}/>}Ses {sound ? "açık" : "kapalı"}</button><button className={secondary} onClick={() => { setHistory(v => !v); setPage(1); }}>{history ? "Açık talepler" : "Geçmiş"}</button></div></div>
    <Notice error={error}/>{notice && <div role="status" className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><span>{notice}</span><button onClick={() => { setNotice(""); setHistory(false); setPage(1); }}>Göster</button></div>}
    {!data ? <p className="py-6 text-slate-500">Talepler yükleniyor…</p> : !data.rows.length ? <p className="py-6 text-center text-slate-500">{history ? "Tamamlanmış veya iptal edilmiş talep yok." : "Bekleyen servis talebi yok."}</p> : <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.rows.map(row => <article key={row.id} className={"rounded-xl border p-4 " + (row.status === "PENDING" ? "border-amber-200 bg-amber-50/60" : "border-slate-200")}><div className="flex justify-between gap-2"><h3 className="font-bold">{row.table.name}</h3><span className="text-xs text-slate-500">{row.branch.name}</span></div><p className="mt-2 font-medium">{row.type === "WAITER_CALL" ? "Garson Çağır" : "Hesap İste"}</p><p className="mt-1 text-sm">{statuses[row.status]}</p><p className="mt-2 text-xs text-slate-500">{date(row.createdAt)}{!history && ` · ${Math.max(0, Math.floor((now - new Date(row.createdAt).getTime()) / 60000))} dk bekliyor`}</p>{row.assignedName && <p className="mt-1 text-xs text-slate-500">Üstlenen: {row.assignedName}</p>}{row.completedName && <p className="mt-1 text-xs text-slate-500">Tamamlayan: {row.completedName}</p>}{canManage && !history && <div className="mt-3 flex flex-wrap gap-2">{row.status === "PENDING" && <button disabled={pending} className={button} onClick={() => void change(row.id, "ACKNOWLEDGE")}>Üstlen</button>}{row.status === "ACKNOWLEDGED" && row.canFinish && <button disabled={pending} className={button} onClick={() => void change(row.id, "COMPLETE")}>Tamamla</button>}{row.canFinish && <button disabled={pending} className={secondary} onClick={() => void change(row.id, "CANCEL")}>İptal</button>}</div>}</article>)}</div>}
    {data && data.pages > 1 && <Pager page={page} pages={data.pages} busy={pending} onChange={setPage}/>}
  </section>;
}

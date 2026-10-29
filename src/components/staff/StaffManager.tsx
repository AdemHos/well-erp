"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const labels: Record<string, string> = { OWNER: "İşletme Sahibi", ADMIN: "Yönetici", MANAGER: "Operasyon Müdürü", CASHIER: "Kasiyer", WAITER: "Garson", KITCHEN: "Mutfak", STAFF: "Personel" };
type Member = { id: string; role: string; isActive: boolean; allBranches: boolean; canEdit: boolean; user: { id: string; name: string | null; email: string }; branchAccess: { branchId: string }[] };
type Invitation = { id: string; email: string; role: string; allBranches: boolean; expiresAt: string; acceptedAt: string | null; revokedAt: string | null; isPending: boolean; branches: { branchId: string }[] };
type Data = { memberships: Member[]; invitations: Invitation[]; branches: { id: string; name: string }[]; canManage: boolean; canAudit: boolean; assignableRoles: string[]; canAssignAllBranches: boolean; currentMembershipId: string; currentRole: string };
type Audit = { id: string; action: string; actorUserId: string | null; actorProfile?: { name: string } | null; entityId: string | null; branchId: string | null; createdAt: string };
const button = "rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium disabled:opacity-40";
const date = (value: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value));

export default function StaffManager() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("CASHIER");
  const [allBranches, setAllBranches] = useState(false);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [inviteLink, setInviteLink] = useState("");
  const [audit, setAudit] = useState<Audit[] | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/staff", { cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Personel listesi alınamadı.");
      if (!signal?.aborted) setData(result);
    } catch (err) { if (!signal?.aborted) setError(err instanceof Error ? err.message : "Personel listesi alınamadı."); }
  }, []);
  useEffect(() => { const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); }); return () => controller.abort(); }, [load]);

  async function mutate(url: string, method: string, body: unknown) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "İşlem tamamlanamadı.");
      setMessage(result.message ?? "İşlem tamamlandı.");
      await load();
      return result;
    } catch (err) { setError(err instanceof Error ? err.message : "İşlem sonucu doğrulanamadı; listeyi yenileyin."); return null; }
    finally { setBusy(false); }
  }
  function open(member?: Member) {
    setEditing(member ?? null); setEmail(member?.user.email ?? ""); setRole(member?.role ?? "CASHIER");
    setAllBranches(member?.allBranches ?? false); setBranchIds(member?.branchAccess.map((entry) => entry.branchId) ?? []);
    setInviteLink(""); setError(""); setFormOpen(true);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await mutate(editing ? `/api/staff/${editing.id}` : "/api/staff/invitations", editing ? "PATCH" : "POST", { email, role, allBranches: role === "OWNER" || allBranches, branchIds });
    if (!result) return;
    if (result.invitation) setInviteLink(new URL(result.invitation.path, window.location.origin).href);
    setFormOpen(false);
    if (editing?.id === data?.currentMembershipId) { router.push("/dashboard"); router.refresh(); }
  }
  async function setAccess(member: Member) {
    if (!window.confirm(`${member.user.name || member.user.email} için erişimi ${member.isActive ? "kaldırmak" : "yeniden açmak"} istiyor musunuz?`)) return;
    const result = await mutate(`/api/staff/${member.id}`, "PATCH", { isActive: !member.isActive });
    if (result && member.id === data?.currentMembershipId) { router.push("/dashboard"); router.refresh(); }
  }
  async function loadAudit() {
    setError("");
    try { const response = await fetch("/api/audit", { cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setAudit(result.entries); }
    catch (err) { setError(err instanceof Error ? err.message : "İşlem kayıtları alınamadı."); }
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Hesap Üyelikleri</h1><p className="mt-1 text-sm text-slate-500">Roller ve şube erişimleri bu işletme üyeliği için geçerlidir.</p></div>
      <div className="flex gap-2"><button className={button} disabled={busy} onClick={() => void load()}>Yenile</button></div></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
    {inviteLink && <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-4"><p className="text-sm font-semibold">Davet bağlantısı oluşturuldu. E-posta gönderilmedi.</p><p className="text-xs">72 saat geçerlidir ve yalnızca davet edilen hesap tarafından bir kez kullanılabilir. Bağlantı bu ekranda yalnızca şimdi gösterilir.</p><input aria-label="Davet bağlantısı" readOnly value={inviteLink} className="w-full rounded border bg-white p-2 text-sm" onFocus={(event) => event.target.select()} /><button className={button} onClick={() => void navigator.clipboard.writeText(inviteLink).then(() => setMessage("Bağlantı kopyalandı.")).catch(() => setError("Bağlantıyı metin kutusundan elle kopyalayın."))}>Bağlantıyı Kopyala</button></div>}
    {!data ? <p className="text-sm text-slate-500">Personel bilgileri yükleniyor…</p> : <>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{["Personel", "Rol", "Şube erişimi", "Durum", "İşlemler"].map((label) => <th key={label} className="p-4">{label}</th>)}</tr></thead><tbody>{data.memberships.map((member) => <tr key={member.id} className="border-t border-slate-100"><td className="p-4"><p className="font-medium">{member.user.name || "İsimsiz kullanıcı"}</p><p className="text-xs text-slate-500">{member.user.email}</p></td><td className="p-4">{labels[member.role]}{member.id === data.currentMembershipId && <span className="block text-xs text-blue-600">Siz</span>}</td><td className="p-4">{member.role === "OWNER" || member.allBranches ? "Tüm şubeler" : member.branchAccess.map((entry) => data.branches.find((branch) => branch.id === entry.branchId)?.name).filter(Boolean).join(", ") || "Şube atanmamış"}</td><td className="p-4">{member.isActive ? "Aktif" : "Erişim kapalı"}</td><td className="p-4">{member.canEdit && <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => open(member)}>Rol / Şube Düzenle</button><button className={button} disabled={busy} onClick={() => void setAccess(member)}>{member.isActive ? "Erişimi Kaldır" : "Yeniden Etkinleştir"}</button></div>}</td></tr>)}</tbody></table></div>
      <p className="text-xs text-slate-500">Son aktif işletme sahibi korunur. Erişim kaldırma üyeliği pasifleştirir; geçmiş kayıtlar ve kişinin diğer işletme üyelikleri silinmez. Liste en fazla 500 üyelik gösterir.</p>
      <section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="mb-3 font-semibold">Son Davetler</h2><div className="space-y-3">{data.invitations.length === 0 && <p className="text-sm text-slate-500">Davet bulunmuyor.</p>}{data.invitations.map((invitation) => {
        const pending = invitation.isPending;
        return <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm"><div><p>{invitation.email} · {labels[invitation.role]}</p><p className="text-xs text-slate-500">{invitation.acceptedAt ? "Kabul edildi" : invitation.revokedAt ? "İptal edildi" : pending ? "Kabul bekliyor" : "Süresi doldu"} · Son geçerlilik: {date(invitation.expiresAt)}</p></div>{data.canManage && data.assignableRoles.includes(invitation.role) && pending && <button className={button} disabled={busy} onClick={() => { if (window.confirm("Davet bağlantısı iptal edilsin mi?")) void mutate(`/api/staff/invitations/${invitation.id}`, "PATCH", {}); }}>Daveti İptal Et</button>}</div>;
      })}</div></section>
      {data.canAudit && <section className="rounded-2xl border border-slate-200 bg-white p-4"><button className={button} onClick={() => void loadAudit()}>Son 100 Kritik İşlem Kaydını Göster</button>{audit && <div className="mt-3 space-y-2">{audit.length === 0 && <p className="text-sm text-slate-500">Erişim kapsamınızda kayıt bulunmuyor.</p>}{audit.map((entry) => <div key={entry.id} className="break-words border-t border-slate-100 pt-2 text-xs text-slate-600">{date(entry.createdAt)} · {entry.action} · {entry.actorProfile?.name ?? data.memberships.find((member) => member.user.id === entry.actorUserId)?.user.email ?? entry.actorUserId ?? "Sistem"} · Şube: {data.branches.find((branch) => branch.id === entry.branchId)?.name ?? "İşletme"} · Kayıt: {entry.entityId}</div>)}</div>}</section>}
    </>}
    {formOpen && data && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><section role="dialog" aria-modal="true" aria-labelledby="staff-form-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"><h2 id="staff-form-title" className="mb-4 text-lg font-semibold">{editing ? "Rol ve Şube Erişimi" : "Personel Daveti"}</h2><form onSubmit={(event) => void submit(event)} className="space-y-4">
      <label className="block text-sm">E-posta<input type="email" required maxLength={254} disabled={Boolean(editing) || busy} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3" /></label>
      <label className="block text-sm">Rol<select value={role} disabled={busy} onChange={(event) => setRole(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3">{data.assignableRoles.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={role === "OWNER" || allBranches} disabled={busy || role === "OWNER" || !data.canAssignAllBranches} onChange={(event) => setAllBranches(event.target.checked)} />Tüm mevcut ve gelecekteki şubeler</label>
      {!allBranches && role !== "OWNER" && <fieldset className="space-y-2 rounded-xl border border-slate-200 p-3"><legend className="text-sm">İzinli şubeler</legend>{data.branches.map((branch) => <label key={branch.id} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={branchIds.includes(branch.id)} onChange={(event) => setBranchIds((current) => event.target.checked ? [...current, branch.id] : current.filter((id) => id !== branch.id))} />{branch.name}</label>)}</fieldset>}
      {role === "OWNER" && <p className="text-xs text-amber-700">Bu rol işletme sahipliği ve tam yönetim yetkisi verir.</p>}
      <p className="text-xs text-slate-500">{editing ? "Yeni yetkiler sonraki isteklerde veritabanından uygulanır." : "Davet bağlantısını kişiye kendiniz iletin. E-posta gönderimi yapılmaz."}</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" className={button} disabled={busy} onClick={() => setFormOpen(false)}>Vazgeç</button><button className={button + " bg-blue-600 text-white"} disabled={busy}>{busy ? "Kaydediliyor…" : editing ? "Kaydet" : "Davet Bağlantısı Oluştur"}</button></div>
    </form></section></div>}
  </div>;
}

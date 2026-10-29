"use client";
import { useRef, useState, type FormEvent } from "react";
import { api, button, categorySuggestions, input, Notice, panel, secondary, type Category } from "./shared";
export default function ExpenseCategories({ categories, onChanged }: { categories: Category[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Category | null>(null), [name, setName] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), lock = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { await api(editing ? "/api/finance/categories/" + editing.id : "/api/finance/categories", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing ? { name } : { name, direction: "OUT" }) }); setEditing(null); setName(""); onChanged(); }
    catch (error) { setError(error instanceof Error ? error.message : "Kategori kaydedilemedi."); } finally { lock.current = false; setBusy(false); }
  }
  async function toggle(category: Category) {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { await api("/api/finance/categories/" + category.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !category.isActive }) }); onChanged(); }
    catch (error) { setError(error instanceof Error ? error.message : "Kategori güncellenemedi."); } finally { lock.current = false; setBusy(false); }
  }
  return <section className={panel + " space-y-4"}><h2 className="text-lg font-bold">Gider kategorileri</h2><Notice error={error}/><form onSubmit={save} className="flex flex-wrap items-end gap-3"><label className="min-w-48 flex-1 text-sm">{editing ? "Kategori adını düzenle" : "Yeni kategori"}<input list="expense-category-suggestions" className={input} required maxLength={100} value={name} onChange={e => setName(e.target.value)}/><datalist id="expense-category-suggestions">{categorySuggestions.map(value => <option key={value} value={value}/>)}</datalist></label><button className={button} disabled={busy}>Kaydet</button>{editing && <button type="button" className={secondary} disabled={busy} onClick={() => { setEditing(null); setName(""); }}>Vazgeç</button>}</form><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{categories.map(category => <div key={category.id} className="rounded-xl border border-border p-3"><p className="font-medium">{category.name}<span className="ml-2 text-xs text-muted-foreground">{category.isActive ? "Aktif" : "Pasif"}</span></p><div className="mt-3 flex flex-wrap gap-2"><button className={secondary} disabled={busy} onClick={() => { setEditing(category); setName(category.name); }}>Düzenle</button><button className={secondary} disabled={busy} onClick={() => void toggle(category)}>{category.isActive ? "Pasifleştir" : "Aktifleştir"}</button></div></div>)}</div><p className="text-xs text-muted-foreground">Mevcut OUT finans kategorileri kullanılır. Pasifleştirme geçmiş giderleri ve ödemeleri korur.</p></section>;
}

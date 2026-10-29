
"use client";
import { clientAttempt, completeAttempt, type ClientAttempt } from "@/lib/client-attempt";

import { Banknote, CreditCard, Landmark } from "lucide-react";
import { financeInput, financeButton, financeSecondary, FinanceStat } from "./finance-ui";
import {
  useCallback,
  useRef,
  useEffect,
  useState,
  type FormEvent,
} from "react";

// ======================================================
// TYPES
// ======================================================

type Direction = "IN" | "OUT";
type AccountType = "CASH" | "CARD" | "BANK";
type Tab = "overview" | "transactions" | "categories";

type Branch = {
  id: string;
  name: string;
};

type FinanceAccount = {
  id: string;
  name: string;
  type: AccountType;
  branchId: string;
  branch: Branch;
  openingBalance: string;
  totalIncoming: string;
  totalOutgoing: string;
  balance: string;
  isActive: boolean;
};

type FinanceCategory = {
  id: string;
  name: string;
  direction: Direction;
  isActive: boolean;
  transactionCount: number;
};

type FinanceTransaction = {
  id: string;
  direction: Direction;
  source: "MANUAL" | "POS_SALE" | "POS_REFUND" | "EXPENSE_PAYMENT" | "PAYMENT" | "PAYMENT_REVERSAL";
  amount: string;
  description: string | null;
  occurredAt: string;
  branch: Branch;
  account: {
    id: string;
    name: string;
    type: AccountType;
  };
  category: {
    id: string;
    name: string;
  } | null;
  order: {
    id: string;
    orderNumber: string;
  } | null;
};

type TransactionSummary = {
  incoming: string;
  outgoing: string;
  net: string;
};

type ApiResponse = {
  success?: boolean;
  error?: string;
};

type Props = {
  canManage: boolean;
};

// ======================================================
// HELPERS
// ======================================================

const money = (value: string | number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  }).format(Number(value));

const dateFormat = (value: string) =>
  new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));

const accountTypeLabels: Record<AccountType, string> = {
  CASH: "Nakit",
  CARD: "Kart",
  BANK: "Banka",
};

const inputClass = financeInput;

const buttonClass = financeButton;

const secondaryButtonClass = financeSecondary;

async function apiRequest<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
  });

  const result = (await response.json()) as T & ApiResponse;

  if (!response.ok || result.success === false) {
    throw new Error(result.error || "İşlem başarısız.");
  }

  return result;
}

// ======================================================
// MAIN COMPONENT
// ======================================================

export default function FinanceManager({ canManage }: Props) {
  const requestAttempt = useRef<ClientAttempt | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [transactions, setTransactions] = useState<
    FinanceTransaction[]
  >([]);

  const [summary, setSummary] = useState<TransactionSummary>({
    incoming: "0",
    outgoing: "0",
    net: "0",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showTransactionForm, setShowTransactionForm] =
    useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);

  const [accountForm, setAccountForm] = useState({
    branchId: "",
    name: "",
    type: "CASH" as AccountType,
    openingBalance: "0",
  });

  const [transactionForm, setTransactionForm] = useState({
    accountId: "",
    categoryId: "",
    direction: "OUT" as Direction,
    amount: "",
    description: "",
  });

  const [categoryForm, setCategoryForm] = useState({
    name: "",
    direction: "OUT" as Direction,
  });

  const [editingAccount, setEditingAccount] = useState<FinanceAccount | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferPending, setTransferPending] = useState(false);
  const [transferForm, setTransferForm] = useState({ fromAccountId: "", toAccountId: "", amount: "", description: "" });
  const transferAttempt = useRef<{ key: string; payload: string } | null>(null);
  const mutationBusy = useRef(false);
  const loadVersion = useRef(0);
  const [filterAccount, setFilterAccount] = useState("");
  const [filterDirection, setFilterDirection] = useState("");

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  // ====================================================
  // FETCH DATA
  // ====================================================

  const loadData = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
      });

      if (filterAccount) {
        params.set("accountId", filterAccount);
      }

      if (filterDirection) {
        params.set("direction", filterDirection);
      }

      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const [
        branchesData,
        accountsData,
        categoriesData,
        transactionsData,
      ] = await Promise.all([
        apiRequest<{ branches: Branch[] }>("/api/branches"),

        apiRequest<{ accounts: FinanceAccount[] }>(
          "/api/finance/accounts"
        ),

        apiRequest<{ categories: FinanceCategory[] }>(
          "/api/finance/categories"
        ),

        apiRequest<{
          transactions: FinanceTransaction[];
          summary: TransactionSummary;
          pagination: {
            totalPages: number;
          };
        }>(`/api/finance/transactions?${params.toString()}`),
      ]);

      if (version !== loadVersion.current) return;
      setBranches(branchesData.branches);
      setAccounts(accountsData.accounts);
      setCategories(categoriesData.categories);
      setTransactions(transactionsData.transactions);
      setSummary(transactionsData.summary);
      setTotalPages(transactionsData.pagination.totalPages);
    } catch (err) {
      if (version !== loadVersion.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Finans verileri yüklenemedi."
      );
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [page, filterAccount, filterDirection, startDate, endDate]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void loadData(); });
    return () => { cancelled = true; };
  }, [loadData]);

  // ====================================================
  // CREATE ACCOUNT
  // ====================================================

  async function submitAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!accountForm.branchId) {
      setError("Lütfen bir şube seçin.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await apiRequest(editingAccount ? `/api/finance/accounts/${editingAccount.id}` : "/api/finance/accounts", {
        method: editingAccount ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(editingAccount ? { name: accountForm.name, type: accountForm.type, openingBalance: accountForm.openingBalance } : accountForm),
      });

      setMessage(editingAccount ? "Hesap güncellendi." : "Finans hesabı başarıyla oluşturuldu.");
      setEditingAccount(null);
      setShowAccountForm(false);

      setAccountForm({
        branchId: "",
        name: "",
        type: "CASH",
        openingBalance: "0",
      });

      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Finans hesabı oluşturulamadı."
      );
    } finally {
      setSaving(false);
    }
  }

  function editAccount(account: FinanceAccount) {
    setEditingAccount(account);
    setAccountForm({ branchId: account.branchId, name: account.name, type: account.type, openingBalance: account.openingBalance });
    setShowAccountForm(true);
  }

  async function changeAccountStatus(account: FinanceAccount) {
    if (mutationBusy.current) return;
    mutationBusy.current = true; setSaving(true); setError(""); setMessage("");
    try {
      await apiRequest(`/api/finance/accounts/${account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !account.isActive }) });
      setMessage(account.isActive ? "Hesap pasifleştirildi." : "Hesap aktifleştirildi.");
      await loadData();
    } catch (error) { setError(error instanceof Error ? error.message : "Hesap güncellenemedi."); }
    finally { mutationBusy.current = false; setSaving(false); }
  }

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationBusy.current) return;
    const payload = JSON.stringify(transferForm);
    // Retain the key and payload after an uncertain response; allow only retry until resolved.
    if (!transferAttempt.current) transferAttempt.current = { key: crypto.randomUUID(), payload };
    setTransferPending(true);
    mutationBusy.current = true; setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/finance/transfers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...JSON.parse(transferAttempt.current.payload), idempotencyKey: transferAttempt.current.key }) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) { transferAttempt.current = null; setTransferPending(false); }
        throw new Error(result.error || "Transfer tamamlanamadı.");
      }
      transferAttempt.current = null; setTransferPending(false);
      setTransferForm({ fromAccountId: "", toAccountId: "", amount: "", description: "" });
      setShowTransfer(false); setMessage("Transfer tamamlandı.");
      await loadData();
    } catch (error) { setError(error instanceof Error ? error.message : "Transfer sonucu doğrulanamadı; tekrar deneyin."); }
    finally { mutationBusy.current = false; setSaving(false); }
  }

  // ====================================================
  // CREATE TRANSACTION
  // ====================================================

  async function submitTransaction(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const payload = {
          accountId: transactionForm.accountId,
          categoryId: transactionForm.categoryId || null,
          direction: transactionForm.direction,
          amount: transactionForm.amount,
          description: transactionForm.description,
      };
      requestAttempt.current = clientAttempt(requestAttempt.current, payload, "finance-manual:" + transactionForm.accountId);
      await apiRequest("/api/finance/transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...payload, idempotencyKey: requestAttempt.current.key }),
      });

      completeAttempt("finance-manual:" + transactionForm.accountId);
      requestAttempt.current = null;
      setMessage("Finans hareketi başarıyla kaydedildi.");
      setShowTransactionForm(false);

      setTransactionForm({
        accountId: "",
        categoryId: "",
        direction: "OUT",
        amount: "",
        description: "",
      });

      if (page !== 1) {
        setPage(1);
      } else {
        await loadData();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Finans hareketi kaydedilemedi."
      );
    } finally {
      setSaving(false);
    }
  }

  // ====================================================
  // CREATE CATEGORY
  // ====================================================

  async function submitCategory(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      await apiRequest("/api/finance/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(categoryForm),
      });

      setMessage("Finans kategorisi başarıyla oluşturuldu.");
      setShowCategoryForm(false);

      setCategoryForm({
        name: "",
        direction: "OUT",
      });

      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Finans kategorisi oluşturulamadı."
      );
    } finally {
      setSaving(false);
    }
  }

  // ====================================================
  // CALCULATIONS
  // ====================================================

  const activeAccounts = accounts.filter(
    (account) => account.isActive
  );

  const availableCategories = categories.filter(
    (category) =>
      category.isActive &&
      category.direction === transactionForm.direction
  );

  const totalBalance = accounts.reduce(
    (sum, account) => sum + Number(account.balance),
    0
  );

  const totalIncoming = accounts.reduce(
    (sum, account) => sum + Number(account.totalIncoming),
    0
  );

  const totalOutgoing = accounts.reduce(
    (sum, account) => sum + Number(account.totalOutgoing),
    0
  );

  // ====================================================
  // RENDER
  // ====================================================

  return (
    <div className="space-y-6">
      {/* ALERTS */}

      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm font-medium text-rose-600 "
        >
          <span className="text-lg">!</span>
          {error}
        </div>
      )}

      {message && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm font-medium text-emerald-600 "
        >
          <span className="text-lg">✓</span>
          {message}
        </div>
      )}

      {/* NAVIGATION */}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="finance-tabs flex flex-wrap gap-2 rounded-2xl p-1.5">
          {(
            [
              ["overview", "Genel Bakış"],
              ["transactions", "Finans Hareketleri"],
              ["categories", "Kategoriler"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              aria-current={activeTab === key ? "page" : undefined}
              className={`
                rounded-lg px-4 py-2.5 text-sm font-semibold
                transition-all duration-200
                ${
                  activeTab === key
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                    : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className={secondaryButtonClass}
        >
          {loading ? "Yükleniyor..." : "↻ Yenile"}
        </button>
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">
          Finans verileri yükleniyor...
        </p>
      )}

      {/* ============================================= */}
      {/* OVERVIEW */}
      {/* ============================================= */}

      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <SummaryCard
              title="Toplam Hesap Bakiyesi"
              value={money(totalBalance)}
              description="Tüm finans hesaplarının bakiyesi"
              variant="primary"
            />

            <SummaryCard
              title="Toplam Para Girişi"
              value={money(totalIncoming)}
              description="Kayıtlı para girişleri"
              variant="success"
            />

            <SummaryCard
              title="Toplam Para Çıkışı"
              value={money(totalOutgoing)}
              description="Kayıtlı para çıkışları"
              variant="danger"
            />
          </div>

          <section className="finance-panel overflow-hidden rounded-2xl">
            <div className="flex flex-wrap items-center justify-between finance-section-heading gap-3 border-b border-border p-5">
              <div>
                <h2 className="text-lg font-bold">
                  Finans Hesapları
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Şubelerinizin nakit, kart ve banka hesapları
                </p>
              </div>

              {canManage && (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    setEditingAccount(null);
                    setAccountForm({ branchId: "", name: "", type: "CASH", openingBalance: "0" });
                    setShowAccountForm(!showAccountForm);
                  }}
                >
                  {showAccountForm
                    ? "Formu Kapat"
                    : "+ Yeni Hesap"}
                </button>
              )}
            </div>

            <div className="p-5">
              {showAccountForm && canManage && (
                <form
                  onSubmit={submitAccount}
                  className="mb-6 grid gap-4 rounded-xl border border-primary/20 bg-primary/5 p-5 md:grid-cols-2"
                >
                  {/* ACCOUNT NAME */}

                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      Hesap Adı
                    </label>
                    <input
                      className={inputClass}
                      required
                      maxLength={100}
                      placeholder="Örn. Merkez Kasa"
                      value={accountForm.name}
                      onChange={(e) =>
                        setAccountForm({
                          ...accountForm,
                          name: e.target.value,
                        })
                      }
                    />
                  </div>

                  {/* BRANCH SELECT */}

                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      Şube
                    </label>

                    <select
                      className={inputClass}
                      required
                      disabled={!!editingAccount || loading || branches.length === 0}
                      value={accountForm.branchId}
                      onChange={(e) =>
                        setAccountForm({
                          ...accountForm,
                          branchId: e.target.value,
                        })
                      }
                    >
                      <option value="">
                        {loading
                          ? "Şubeler yükleniyor..."
                          : branches.length === 0
                            ? "Şube bulunamadı"
                            : "Şube seçiniz"}
                      </option>

                      {branches.map((branch) => (
                        <option
                          key={branch.id}
                          value={branch.id}
                        >
                          {branch.name}
                        </option>
                      ))}
                    </select>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Finans hesabının bağlı olacağı şubeyi
                      seçin.
                    </p>

                    {!loading && branches.length === 0 && (
                      <p className="mt-2 text-xs font-medium text-rose-600 ">
                        Henüz şubeniz bulunmuyor. Önce şube
                        oluşturmalısınız.
                      </p>
                    )}
                  </div>

                  {/* ACCOUNT TYPE */}

                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      Hesap Türü
                    </label>

                    <select
                      className={inputClass}
                      disabled={!!editingAccount && (Number(editingAccount.totalIncoming) > 0 || Number(editingAccount.totalOutgoing) > 0)}
                      value={accountForm.type}
                      onChange={(e) =>
                        setAccountForm({
                          ...accountForm,
                          type: e.target.value as AccountType,
                        })
                      }
                    >
                      <option value="CASH">Nakit</option>
                      <option value="CARD">Kart</option>
                      <option value="BANK">Banka</option>
                    </select>
                  </div>

                  {editingAccount && <p className="text-xs text-muted-foreground md:col-span-2">Hareketi olan hesaplarda tür ve açılış bakiyesi değiştirilemez. Hesabın şubesi sabittir.</p>}
                  {/* OPENING BALANCE */}

                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      Açılış Bakiyesi
                    </label>

                    <input
                      className={inputClass}
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      disabled={!!editingAccount && (Number(editingAccount.totalIncoming) > 0 || Number(editingAccount.totalOutgoing) > 0)}
                      value={accountForm.openingBalance}
                      onChange={(e) =>
                        setAccountForm({
                          ...accountForm,
                          openingBalance: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className="md:col-span-2">
                    <button
                      type="submit"
                      disabled={
                        saving ||
                        loading ||
                        branches.length === 0
                      }
                      className={buttonClass}
                    >
                      {saving
                        ? "Kaydediliyor..."
                        : editingAccount ? "Değişiklikleri Kaydet" : "Hesabı Oluştur"}
                    </button>
                  </div>
                </form>
              )}

              {canManage && <div className="mb-5 space-y-4">
                <button type="button" className={secondaryButtonClass} onClick={() => setShowTransfer(!showTransfer)}>Hesaplar Arası Transfer</button>
                {showTransfer && <form onSubmit={submitTransfer} className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-2">
                  <fieldset disabled={saving || transferPending} className="contents">
                    <label className="text-sm">Kaynak hesap<select required className={inputClass} value={transferForm.fromAccountId} onChange={e => setTransferForm({ ...transferForm, fromAccountId: e.target.value })}><option value="">Hesap seçin</option>{activeAccounts.map(a => <option key={a.id} value={a.id}>{a.branch.name} · {a.name} ({money(a.balance)})</option>)}</select></label>
                    <label className="text-sm">Hedef hesap<select required className={inputClass} value={transferForm.toAccountId} onChange={e => setTransferForm({ ...transferForm, toAccountId: e.target.value })}><option value="">Hesap seçin</option>{activeAccounts.filter(a => a.id !== transferForm.fromAccountId).map(a => <option key={a.id} value={a.id}>{a.branch.name} · {a.name}</option>)}</select></label>
                    <label className="text-sm">Tutar<input required type="number" min="0.01" step="0.01" max="999999999999.99" className={inputClass} value={transferForm.amount} onChange={e => setTransferForm({ ...transferForm, amount: e.target.value })}/></label>
                    <label className="text-sm">Açıklama<input maxLength={500} className={inputClass} value={transferForm.description} onChange={e => setTransferForm({ ...transferForm, description: e.target.value })}/></label>
                  </fieldset>
                  <p className="text-xs text-muted-foreground md:col-span-2">Transfer toplam işletme bakiyesini değiştirmez. Yetersiz bakiyeli çıkışlara izin verilmez.</p>
                  {transferPending && <p className="text-sm md:col-span-2">Önceki transferin sonucu belirsiz. Aynı transferi doğrulamak için tekrar deneyin.</p>}
                  <button type="submit" disabled={saving} className={buttonClass}>{saving ? "İşleniyor..." : transferPending ? "Transferi Tekrar Dene" : "Transfer Yap"}</button>
                </form>}
              </div>}
              {/* ACCOUNT CARDS */}

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {accounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    disabled={saving}
                    onDetail={() => { setFilterAccount(account.id); setFilterDirection(""); setPage(1); setActiveTab("transactions"); }}
                    onEdit={canManage ? () => editAccount(account) : undefined}
                    onToggle={canManage ? () => void changeAccountStatus(account) : undefined}
                  />
                ))}

                {!loading && accounts.length === 0 && (
                  <div className="col-span-full rounded-xl border border-dashed border-primary/30 bg-primary/5 p-10 text-center">
                    <p className="font-semibold">
                      Henüz finans hesabı bulunmuyor.
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Nakit, kart veya banka hesabı oluşturarak
                      başlayabilirsiniz.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ============================================= */}
      {/* TRANSACTIONS */}
      {/* ============================================= */}

      {activeTab === "transactions" && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <SummaryCard
              title="Para Girişi"
              value={money(summary.incoming)}
              description="Seçili filtreye göre"
              variant="success"
            />

            <SummaryCard
              title="Para Çıkışı"
              value={money(summary.outgoing)}
              description="Seçili filtreye göre"
              variant="danger"
            />

            <SummaryCard
              title="Net Nakit Akışı"
              value={money(summary.net)}
              description="Giriş - Çıkış"
              variant="primary"
            />
          </div>

          <section className="finance-panel overflow-hidden rounded-2xl">
            <div className="flex flex-wrap items-center justify-between finance-section-heading gap-3 border-b border-border p-5">
              <div>
                <h2 className="text-lg font-bold">
                  Finans Hareketleri
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Kasa ve banka giriş/çıkışları; tahakkuk ve transferler kaynaklarına göre ayrılır
                </p>
              </div>

              {canManage && (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() =>
                    setShowTransactionForm(!showTransactionForm)
                  }
                >
                  {showTransactionForm
                    ? "Formu Kapat"
                    : "+ Yeni Hareket"}
                </button>
              )}
            </div>

            <div className="p-5">
              {showTransactionForm && canManage && (
                <form
                  onSubmit={submitTransaction}
                  className="mb-6 grid gap-4 rounded-xl border border-primary/20 bg-primary/5 p-5 md:grid-cols-2"
                >
                  <p className="text-sm text-muted-foreground md:col-span-2">Bu form belgesiz manuel kasa hareketleri içindir. Cari, gider veya fatura ödemelerini Ödemeler ekranından kaydedin; aynı tahsilatı iki kez girmeyin.</p>
                  {/* ACCOUNT SELECT */}

                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      Finans Hesabı
                    </label>

                    <select
                      className={inputClass}
                      required
                      value={transactionForm.accountId}
                      onChange={(e) =>
                        setTransactionForm({
                          ...transactionForm,
                          accountId: e.target.value,
                        })
                      }
                    >
                      <option value="">Hesap seçin</option>

                      {activeAccounts.map((account) => (
                        <option
                          key={account.id}
                          value={account.id}
                        >
                          {account.branch.name} - {account.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* DIRECTION */}

                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      İşlem Türü
                    </label>

                    <select
                      className={inputClass}
                      value={transactionForm.direction}
                      onChange={(e) =>
                        setTransactionForm({
                          ...transactionForm,
                          direction:
                            e.target.value as Direction,
                          categoryId: "",
                        })
                      }
                    >
                      <option value="IN">
                        Manuel Kasa Girişi
                      </option>
                      <option value="OUT">
                        Manuel Kasa Çıkışı
                      </option>
                    </select>
                  </div>

                  {/* CATEGORY */}

                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      Kategori
                    </label>

                    <select
                      className={inputClass}
                      value={transactionForm.categoryId}
                      onChange={(e) =>
                        setTransactionForm({
                          ...transactionForm,
                          categoryId: e.target.value,
                        })
                      }
                    >
                      <option value="">
                        Kategori seçilmedi
                      </option>

                      {availableCategories.map((category) => (
                        <option
                          key={category.id}
                          value={category.id}
                        >
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* AMOUNT */}

                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      Tutar (TL)
                    </label>

                    <input
                      className={inputClass}
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={transactionForm.amount}
                      onChange={(e) =>
                        setTransactionForm({
                          ...transactionForm,
                          amount: e.target.value,
                        })
                      }
                    />
                  </div>

                  {/* DESCRIPTION */}

                  <div className="md:col-span-2">
                    <label className="mb-2 block text-sm font-medium">
                      Açıklama
                    </label>

                    <input
                      className={inputClass}
                      maxLength={500}
                      placeholder="Örn. Elektrik faturası"
                      value={transactionForm.description}
                      onChange={(e) =>
                        setTransactionForm({
                          ...transactionForm,
                          description: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className="md:col-span-2">
                    <button
                      type="submit"
                      disabled={
                        saving || activeAccounts.length === 0
                      }
                      className={buttonClass}
                    >
                      {saving
                        ? "Kaydediliyor..."
                        : "Hareketi Kaydet"}
                    </button>
                  </div>
                </form>
              )}

              {filterAccount && <div className="mb-4 rounded-xl border border-border p-4">
                <h3 className="font-bold">{accounts.find(a => a.id === filterAccount)?.name} · Hesap Detayı</h3>
                <p className="text-sm text-muted-foreground">Açılış: {money(accounts.find(a => a.id === filterAccount)?.openingBalance ?? "0")} · Güncel bakiye: {money(accounts.find(a => a.id === filterAccount)?.balance ?? "0")}</p>
              </div>}
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">Başlangıç tarihi<input type="date" className={inputClass} value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1); }}/></label>
                <label className="text-sm">Bitiş tarihi<input type="date" className={inputClass} value={endDate} onChange={e => { setEndDate(e.target.value); setPage(1); }}/></label>
              </div>
              {/* FILTERS */}

              <div className="mb-5 flex flex-wrap gap-3">
                <select
                  className={`${inputClass} max-w-xs`}
                  value={filterAccount}
                  onChange={(e) => {
                    setFilterAccount(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Tüm Hesaplar</option>

                  {accounts.map((account) => (
                    <option
                      key={account.id}
                      value={account.id}
                    >
                      {account.branch.name} - {account.name}
                    </option>
                  ))}
                </select>

                <select
                  className={`${inputClass} max-w-xs`}
                  value={filterDirection}
                  onChange={(e) => {
                    setFilterDirection(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Tüm İşlemler</option>
                  <option value="IN">Para Girişi</option>
                  <option value="OUT">Para Çıkışı</option>
                </select>
              </div>

              {/* TRANSACTION TABLE */}

              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[750px] text-left text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="p-3 font-semibold">
                        Tarih
                      </th>
                      <th className="p-3 font-semibold">
                        Hesap
                      </th>
                      <th className="p-3 font-semibold">
                        Kategori
                      </th>
                      <th className="p-3 font-semibold">
                        Açıklama
                      </th>
                      <th className="p-3 text-right font-semibold">
                        Tutar
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {transactions.map((item) => (
                      <tr
                        key={item.id}
                        className="border-t border-border/60 transition-colors hover:bg-primary/5"
                      >
                        <td className="p-3 text-muted-foreground">
                          {dateFormat(item.occurredAt)}
                        </td>

                        <td className="p-3">
                          <div className="font-semibold">
                            {item.account.name}
                          </div>

                          <div className="text-xs text-muted-foreground">
                            {item.branch.name}
                          </div>
                        </td>

                        <td className="p-3">
                          {item.category?.name ?? "—"}
                        </td>

                        <td className="p-3">
                          <div className="text-xs font-semibold text-muted-foreground">
                            {item.source === "POS_SALE"
                              ? "POS Satışı"
                              : item.source === "POS_REFUND"
                                ? "POS İadesi"
                                : item.source === "PAYMENT" ? "Ödeme / Tahsilat" : item.source === "PAYMENT_REVERSAL" ? "Ödeme İptali" : item.source === "EXPENSE_PAYMENT" ? "Gider Ödemesi" : item.id.startsWith("transfer_") ? "Hesaplar Arası Transfer" : "Manuel İşlem"}
                          </div>
                          {item.description && <div>{item.description}</div>}
                          {item.order && <div className="text-xs text-muted-foreground">Satış No: {item.order.orderNumber}</div>}
                        </td>

                        <td className="p-3 text-right">
                          <span
                            className={`inline-flex rounded-lg px-3 py-1.5 font-bold ${
                              item.direction === "IN"
                                ? "bg-emerald-500/10 text-emerald-600 "
                                : "bg-rose-500/10 text-rose-600 "
                            }`}
                          >
                            {item.direction === "IN" ? "+" : "-"}
                            {money(item.amount)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {!loading && transactions.length === 0 && (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Finans hareketi bulunamadı.
                  </p>
                )}
              </div>

              {/* PAGINATION */}

              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                  className={secondaryButtonClass}
                >
                  Önceki
                </button>

                <span className="text-sm font-medium text-muted-foreground">
                  Sayfa {page} / {Math.max(totalPages, 1)}
                </span>

                <button
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                  className={secondaryButtonClass}
                >
                  Sonraki
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ============================================= */}
      {/* CATEGORIES */}
      {/* ============================================= */}

      {activeTab === "categories" && (
        <section className="finance-panel overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center justify-between finance-section-heading gap-3 border-b border-border p-5">
            <div>
              <h2 className="text-lg font-bold">
                Gelir-Gider Kategorileri
              </h2>

              <p className="mt-1 text-xs text-muted-foreground">
                İşlemlerinizi kategorilere ayırın
              </p>
            </div>

            {canManage && (
              <button
                type="button"
                className={buttonClass}
                onClick={() =>
                  setShowCategoryForm(!showCategoryForm)
                }
              >
                {showCategoryForm
                  ? "Formu Kapat"
                  : "+ Yeni Kategori"}
              </button>
            )}
          </div>

          <div className="p-5">
            {showCategoryForm && canManage && (
              <form
                onSubmit={submitCategory}
                className="mb-6 grid gap-4 rounded-xl border border-primary/20 bg-primary/5 p-5 md:grid-cols-3"
              >
                <input
                  className={inputClass}
                  required
                  maxLength={100}
                  placeholder="Kategori adı"
                  value={categoryForm.name}
                  onChange={(e) =>
                    setCategoryForm({
                      ...categoryForm,
                      name: e.target.value,
                    })
                  }
                />

                <select
                  className={inputClass}
                  value={categoryForm.direction}
                  onChange={(e) =>
                    setCategoryForm({
                      ...categoryForm,
                      direction:
                        e.target.value as Direction,
                    })
                  }
                >
                  <option value="OUT">Gider</option>
                  <option value="IN">Gelir</option>
                </select>

                <button
                  type="submit"
                  disabled={saving}
                  className={buttonClass}
                >
                  {saving
                    ? "Kaydediliyor..."
                    : "Kategori Oluştur"}
                </button>
              </form>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {categories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between gap-3 finance-item rounded-xl p-4 transition-all hover:border-primary/30 hover:shadow-sm"
                >
                  <div>
                    <p className="font-semibold">
                      {category.name}
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      {category.transactionCount} işlem
                    </p>
                  </div>

                  <span
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                      category.direction === "IN"
                        ? "bg-emerald-500/10 text-emerald-600 "
                        : "bg-rose-500/10 text-rose-600 "
                    }`}
                  >
                    {category.direction === "IN"
                      ? "Gelir"
                      : "Gider"}

                    {!category.isActive && " · Pasif"}
                  </span>
                </div>
              ))}

              {!loading && categories.length === 0 && (
                <div className="col-span-full rounded-xl border border-dashed border-primary/30 bg-primary/5 p-10 text-center">
                  <p className="font-semibold">
                    Henüz finans kategorisi bulunmuyor.
                  </p>

                  <p className="mt-2 text-sm text-muted-foreground">
                    Gelir veya gider kategorisi oluşturarak
                    başlayabilirsiniz.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ======================================================
// SUMMARY CARD
// ======================================================

function SummaryCard({
  title,
  value,
  description,
  variant = "primary",
}: {
  title: string;
  value: string;
  description: string;
  variant?: "primary" | "success" | "danger";
}) {
  return <FinanceStat title={title} value={value} description={description} tone={variant === "success" ? "green" : variant === "danger" ? "rose" : "blue"}/>;
}

// ======================================================
// ACCOUNT CARD
// ======================================================

function AccountCard({ account, onDetail, onEdit, onToggle, disabled }: {
  account: FinanceAccount;
  onDetail: () => void;
  onEdit?: () => void;
  onToggle?: () => void;
  disabled: boolean;
}) {
  const styles: Record<
    AccountType,
    {
      border: string;
      icon: string;
      symbol: React.ReactNode;
    }
  > = {
    CASH: {
      border: "hover:border-emerald-500/40",
      icon: "bg-emerald-500/10 text-emerald-600 ",
      symbol: <Banknote size={21} strokeWidth={1.8}/>,
    },
    CARD: {
      border: "hover:border-primary/40",
      icon: "bg-primary/10 text-primary",
      symbol: <CreditCard size={21} strokeWidth={1.8}/>,
    },
    BANK: {
      border: "hover:border-sky-500/40",
      icon: "bg-sky-500/10 text-sky-600 ",
      symbol: <Landmark size={21} strokeWidth={1.8}/>,
    },
  };

  const style = styles[account.type];

  return (
    <div
      className={`
        finance-item rounded-2xl p-5
        transition-all duration-200
        hover:-translate-y-0.5 hover:shadow-md
        ${style.border}
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-bold">
            {account.name}
          </h3>

          <p className="mt-1 text-xs text-muted-foreground">
            {account.branch.name} ·{" "}
            {accountTypeLabels[account.type]}
          </p>
        </div>

        <span
          className={`
            flex h-11 w-11 shrink-0 items-center justify-center
            rounded-xl text-xl font-bold
            ${style.icon}
          `}
        >
          {style.symbol}
        </span>
      </div>

      <p className="mt-5 text-2xl font-bold tracking-tight">
        {money(account.balance)}
      </p>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          Açılış: {money(account.openingBalance)}
        </p>

        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            account.isActive
              ? "bg-emerald-500/10 text-emerald-600 "
              : "bg-muted text-muted-foreground"
          }`}
        >
          {account.isActive ? "Aktif" : "Pasif"}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className={secondaryButtonClass} type="button" onClick={onDetail}>Hareketler</button>
        {onEdit && <button className={secondaryButtonClass} type="button" disabled={disabled} onClick={onEdit}>Düzenle</button>}
        {onToggle && <button className={secondaryButtonClass} type="button" disabled={disabled} onClick={onToggle}>{account.isActive ? "Pasifleştir" : "Aktifleştir"}</button>}
      </div>
    </div>
  );
}

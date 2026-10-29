# Giderler — uygulama ve doğrulama raporu

## Durum ve canlı uygulama sınırı

Giderler kodu `/dashboard/expenses`, detay ve ödemeler
`/dashboard/expenses/:id` altında hazırdır. Masaüstü ve mobil menü bağlantıları
finance.manage yetkisiyle etkinleştirildi. Genel Faturalar veya Ödemeler ekranı
geliştirilmedi.

**Neon şeması kullanıcı onayıyla güncellendi.** Önce 31 tablonun şema ve verileri
aynı salt okunur snapshot'tan PostgreSQL custom arşivine alındı. Arşiv tamamen
okundu ve ayrı yerel PostgreSQL'e geri yüklendi; 31 tablonun bütün satır sayıları
eşleşti. Deneme sunucusu kapatıldı. Yedek ayrıntıları `docs/database-backups.md`
dosyasındadır; arşiv `.backups` altında Git dışında ve sınırlı dosya izinleriyle saklanır.

Yedek doğrulandıktan sonra daha önce verilen canlı migration onayıyla
`prisma/migrations/20261022010000_add_expenses/migration.sql` normal Prisma
geçmişine eklendi ve `prisma migrate deploy` ile uygulandı. 19 migration güncel;
uygulanan dosyanın checksum'ı veritabanındaki kayıtla eşleşti.
`docs/migrations/expenses.sql` inceleme referansıdır; tekrar çalıştırılmamalıdır.
db push, reset, mevcut iş verisi silme veya geriye dönük muhasebeleştirme yoktur.

## Muhasebe ve ödeme davranışı

- Expense tutarı pozitif Decimal(14,2), TRY. Oluşturma kasa hareketi üretmez.
- Mevcut OUT FinanceCategory kullanılır; ayrı ExpenseCategory yoktur.
  Kategori oluşturma, ad düzenleme ve pasifleştirme vardır; yön değiştirilemez.
- Aktif SUPPLIER/BOTH carisi seçilirse aynı transaction'da EXPENSE/CREDIT
  tahakkuku oluşturulur. Carisiz gider yalnızca Expense kaydı oluşturur.
- Ödeme kaydı ExpensePayment üzerinden izlenir. PaidAmount = ödeme toplamı,
  remainingAmount = gider tutarı − ödemeler. Durum UNPAID, PARTIALLY_PAID veya
  PAID olarak türetilir; istemci bu durumları yazamaz.
- Ödeme, FinanceTransaction OUT/EXPENSE_PAYMENT, varsa CurrentAccountEntry
  PAYMENT/DEBIT ve AuditLog aynı Serializable transaction içinde kaydedilir.
  Cari ödeme hareketi aynı financeTransactionId'yi kullanır, ikinci çıkış oluşturmaz.
- Gider raporu gider tutarlarını bir kez sayar. Ödeme satırları gider toplamına
  yeniden eklenmez. Eski manuel finans OUT kayıtları kendiliğinden giderlere
  dönüştürülmez; geçmiş manuel kayıtla otomatik eşleştirme yapılmaz.
- Yalnızca giderle aynı şubede aktif CASH/BANK hesabı, yeterli bakiye ve kalan
  tutarı aşmayan pozitif ödeme kabul edilir. CARD mevcut sistemde POS tahsilatı
  olduğundan ödeme aracına çevrilmez; hem UI hem API bu hesabı reddeder.
- Gerçekleşmiş ödeme için gelecekteki ödeme tarihi kabul edilmez. Sonradan
  pasifleştirilen tedarikçi veya kategori, eski giderin ödenmesini engellemez.
- Oluşturma/ödeme idempotencyKey + normalize requestHash ile korunur. Aynı
  anahtar/içerik 200, ilk kayıt 201, farklı içerik 409'dur. Ödeme için deterministik
  benzersiz finans kimliği; tahakkuk/ödeme için ayrıca benzersiz cari sourceKey vardır.
- Ödeme ve gider güncellemeleri gider satırında version artırır. Böylece
  Serializable çatışma tekrarlarında güncel bakiye ve ödeme toplamı yeniden okunur.

## Düzenleme, iptal ve denetim

Şube sabittir. Ödemesiz giderin tutar/cari değişimi gerekçe ister; eski cari
tahakkuku REVERSAL ile kapanır ve yeni tahakkuk açılır. Tarih düzeltmesinde de
eski tahakkuk korunup yeni tarihli tahakkuk oluşturulur. Geçmiş cari kayıtları
UPDATE/DELETE edilmez. Güncellemeler expectedVersion ile eski formdan yapılacak
yazmaları reddeder.

Ödemeli giderde tutar, cari, kategori ve muhasebe tarihi kilitlidir. Başlık,
açıklama, referans ve vade gibi alanlar audit ile güncellenebilir. Eski ödeme
ve finans açıklamaları geriye dönük değiştirilmez.

İptal yalnızca ödemesiz giderde mümkündür; gerekçe, kullanıcı ve zaman saklanır.
Cari tahakkuku aynı transaction'da ters kaydedilir. Tekrarlı iptal yeni hareket
oluşturmaz. İptaller geçmiş listede filtrelenebilir; finansal toplamlara katılmaz.
Expense ve ExpensePayment için DELETE, ödeme için PATCH endpoint'i yoktur.
Ödemeli gider iptali ve gider ödemesi iade/ters kaydı bu aşamada desteklenmez;
bu işlemler açık hata ile engellenir, bakiye sessizce sıfırlanmaz.

Otomatik gider kayıtları mevcut genel cari ters kayıt API'sinden çevrilemez.
Manuel finans API'si source alanını MANUAL olarak belirlemeye devam eder.
Kasa ekranı otomatik hareketleri “Gider Ödemesi”, cari ekstre/CSV tahakkuku
“Gider tahakkuku” etiketiyle gösterir. Ödeme referansları iki kayıtta da korunur.

## Arayüz, kapsam ve raporlar

Toplam gider, ödenen, açık ve vadesi geçmiş bakiye/sayı; başlık/cari/referans
arama, kategori, şube, gider tarihi aralığı, ödeme durumu, iptal filtreleri ve
sayfalama vardır. Üst toplamlar aynı filtre kümesini, sayfa sınırından bağımsız
olarak kapsar. Vade aşımı İstanbul'da bugünün başlangıcından önce vadesi gelen
ve kalan tutarı pozitif giderlerdir. Tarih filtresi gider tarihine uygulanır;
ödenen/kalan tutar ilgili giderlerin bütün ödemelerinden hesaplanır.

SQL önce ödemeleri gider başına toplar; kategori/cari birleşimleri veya ödeme
sayısı Expense.amount tutarını çoğaltmaz. Okumalar RepeatableRead snapshot kullanır.
Yetki ve organizationId/branchScope listede, detayda, yazmalarda ve toplamların
tamamında API tarafında uygulanır. OWNER da farklı şube kasasını gider ödemesinde
doğrudan kullanamaz; önce Kasa transferi gerekir.

Belirsiz ağ/sunucu yanıtında oluşturma ve ödeme formları aynı istek anahtarını
koruyarak doğrulama sunar. SessionStorage kullanılabiliyorsa sayfa yenilemede
de korunur; tarayıcı depolamayı engellerse yalnızca açık bileşende tutulur.
Gider düzenleme formu başka bir bekleyen oluşturma isteğini yürütmez.

Mevcut cari operasyonları, migration uygulanmadan önce yeni expenseId kolonunu
istemeyen açık alan seçimleri kullanır. Yeni kolonun olmadığı aşamada eski
manuel cari INSERT sorgusunun expenseId içermediği gerçek Prisma SQL üretimi
üzerinden, pg sorgusu yerel stub'a yönlendirilerek ve DB'ye bağlanılmadan test edildi.

## API

| Yol | Metot | İşlem |
| --- | --- | --- |
| `/api/expenses` | GET / POST | Filtreli liste / gider oluşturma |
| `/api/expenses/:id` | GET / PATCH | Detay / sürüm kontrollü düzenleme |
| `/api/expenses/:id/payments` | GET / POST | Ödeme geçmişini içeren detay / ödeme |
| `/api/expenses/:id/cancel` | POST | Ödemesiz gider iptali |
| `/api/finance/categories` | GET / POST | Mevcut kategori listesi / oluşturma |
| `/api/finance/categories/:id` | PATCH | OUT kategori ad/aktiflik düzenleme |

Liste: `q`, `categoryId`, `branchId`, `startDate`, `endDate`, `status`,
`cancelled=exclude|include|only`, `page`, `limit` (1–100).

Gider POST: title, categoryId, branchId, amount, expenseDate, isteğe bağlı
dueDate/description/reference/currentAccountId ve zorunlu idempotencyKey.
Ödeme POST: accountId, amount, isteğe bağlı paidAt/description/reference,
zorunlu idempotencyKey. PATCH: değişen alanlar, expectedVersion, finansal
düzeltmede reason. İptal: expectedVersion ve reason. Kullanıcı sourceKey,
finans/cari hareket kimliği, ödeme durumu veya oluşturucu belirleyemez.

## Migration ve açık kalan doğrulamalar

SQL iki tablo; FinanceSource.EXPENSE_PAYMENT ve CurrentAccountEntryKind.EXPENSE;
CurrentAccountEntry.expenseId isteğe bağlı kolonu; bileşik FK ve benzersiz
indeksleri ekler. Pozitif tutar, pozitif sürüm ve iptal bilgisi tutarlılığı
CHECK'leri ayrıca eklenmiştir. Eski cari CHECK ve tek açılış kısmi indeksi korunur.
Mevcut tablolara yeni indeks/FK eklenmesi tarama/kilit oluşturabilir. SQL BEGIN/COMMIT
içindedir; yeni enum değerleri aynı migration transaction'ında satır veya CHECK
ifadesi içinde kullanılmaz. Migration doğrulanan yedekten sonra Neon'a uygulandı.
Pozitif tutar/sürüm, iptal tutarlılığı ve önceki cari tek açılış kısıtı ayrıca
canlı kataloglarda kontrol edildi. Mevcut iş tablolarının bütün satır sayıları
migration öncesiyle aynı kaldı; yalnızca `_prisma_migrations` sayısı 18'den 19'a
çıktı. Yeni Expense ve ExpensePayment tabloları test sonunda sıfır satırdır.
Kanıtlar: `docs/migrations/expenses-preflight.json`,
`docs/migrations/expenses-verification.json`.

sourceKey ileride alış faturası/kaynak satırının kalıcı kimliğine bağlanacaktır.
Manuel önceden girilmiş gider, fatura aşamasında mevcut kayda bağlanmalı; ikinci
gider/cari tahakkuku oluşturulmamalıdır. Serbest belge numarasını eşit görmek
tek başına otomatik eşleştirme için yeterli sayılmaz. Genel fatura/ödeme tahsis
ve nakit iade akışları bu aşamaya dahil değildir.

Gerçek PostgreSQL entegrasyon testi migration sonrasında çalıştırılıp geçti.
Fixture'lar dış transaction sonunda geri alındı; mevcut işletme verilerine
uygulanmadı. Çevrimdışı testlerde transaction sıralaması taklit edilir; gerçek
çok bağlantılı PostgreSQL yarış testi değildir. Masaüstü/mobil tarayıcı görsel
kabul testi henüz yapılmadı.

## Kontroller

- Prisma validate ve yerel generate: başarılı.
- İki yerel şema arasında migrate diff --script: SQL üretildi; DB bağlantısı yok.
- Next.js typegen: başarılı.
- `tsc --noEmit`: başarılı; yeni Next.js rota tipleri de kontrol edildi.
- Değişen TypeScript/TSX ve yeni test dosyalarının ESLint kontrolü: başarılı.
- `node --test tests/*.test.cjs`: 88 test, 83 başarılı, 0 hata,
  5 atlanan veritabanı entegrasyon testi. Mevcut Kasa/POS/Cari/iade çevrimdışı
  testleri de başarılıdır.
- Migration sonrasında `WELLPOS_EXPENSES_DB_TEST=1` ile gider PostgreSQL testi
  ayrıca çalıştırıldı: 1 başarılı, 0 hata. 10.000/3.000/7.000, gerçek rapor SQL'i,
  kasa/cari bağlantısı, kaynak etiketleri, fazla ödeme, tekrar istekler,
  hata geri alma, şube/rol güvenliği ve ödemesiz iptal doğrulandı.
- Yedek araçlarının ESLint kontrolü başarılı. Yedeğin SHA-256, tam arşiv okuması
  ve gerçek yerel geri yükleme kontrolleri başarılı.

Yeni testler: `tests/expenses.test.cjs` (15 çevrimdışı API testi),
`tests/expense-schema-compatibility.test.cjs` (1 gerçek SQL üretimi testi),
`tests/expenses.integration.test.cjs` (WELLPOS_EXPENSES_DB_TEST=1 olmadan atlanır).
Entegrasyon testi 10.000/3.000/7.000, fazla ödeme, kasa/cari bağlantısı,
rapor toplamları, hata geri alma, tekrar istek, kategori/şube/rol güvenliği ve
iptali gerçek sorgularla sınar; tüm fixture'ları dış transaction sonunda geri alır.

## Bu aşamada değişen dosyalar

- `prisma/schema.prisma`
- `src/lib/expenses.ts`
- `src/lib/expense-service.ts`
- `src/lib/expense-read.ts`
- `src/lib/current-accounts.ts`
- `src/lib/current-accounts-service.ts`
- `src/components/current-accounts/shared.tsx`
- `src/components/finance/FinanceManager.tsx`
- `src/app/api/expenses/route.ts`
- `src/app/api/expenses/[id]/route.ts`
- `src/app/api/expenses/[id]/payments/route.ts`
- `src/app/api/expenses/[id]/cancel/route.ts`
- `src/app/api/finance/categories/[id]/route.ts`
- `src/components/expenses/shared.tsx`
- `src/components/expenses/ExpenseForm.tsx`
- `src/components/expenses/ExpenseCategories.tsx`
- `src/components/expenses/ExpensesManager.tsx`
- `src/components/expenses/ExpenseDetail.tsx`
- `src/app/dashboard/expenses/page.tsx`
- `src/app/dashboard/expenses/[id]/page.tsx`
- `src/components/dashboard/Sidebar.tsx`
- `src/components/dashboard/DashboardHeader.tsx`
- `tests/expenses.test.cjs`
- `tests/expense-schema-compatibility.test.cjs`
- `tests/expenses.integration.test.cjs`
- `docs/expenses-design.md`
- `docs/expenses.md`
- `docs/migrations/expenses.sql`
- `prisma/migrations/20261022010000_add_expenses/migration.sql`
- `docs/migrations/expenses-preflight.json`
- `docs/migrations/expenses-verification.json`
- `.gitignore`
- `scripts/backup-neon.cjs`
- `scripts/verify-neon-backup.cjs`
- `docs/database-backups.md`

`src/generated/prisma` yerel olarak yeniden üretildi; mevcut gitignore'a göre
takip edilmiyor. POS satış/iade/stock işleyicileri değiştirilmedi.

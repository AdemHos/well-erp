# Cari Hesaplar — uygulama ve doğrulama raporu

## Durum

Kod, yerel Prisma şeması, üretilmiş istemci ve testler hazırdır. Cari ekranı
`/dashboard/accounts`, detay ekranı `/dashboard/accounts/:id` adresindedir.
Masaüstü ve mobil menülerde finance.manage yetkisiyle erişilir.

**Canlı şema kullanıcı onayıyla Neon'a uygulandı.**
`prisma/migrations/20261022000000_add_current_accounts/migration.sql` normal
Prisma migration geçmişine eklendi ve `prisma migrate deploy` ile uygulandı.
`prisma migrate status` 18 migration ile güncel şema bildirdi. Uygulanan dosyanın
SHA-256 checksum'ı veritabanındaki migration kaydıyla karşılaştırılıp doğrulandı.
`docs/migrations/current-accounts.sql` aynı SQL'in inceleme referansıdır; tekrar
çalıştırılmamalıdır. db push, veri silme veya geçmiş satışlara geri doldurma yoktur.

## Sağlanan davranış

- CUSTOMER, SUPPLIER, BOTH cari kartları; kod, unvan, iletişim, adres, vergi
  dairesi, isteğe bağlı 10/11 haneli vergi numarası/TCKN, açıklama ve aktiflik.
- Kod ASCII büyük harfe normalize edilir; işletme içinde benzersizdir.
- Kart düzenleme ve pasifleştirme. Silme API'si yoktur; finansal geçmiş korunur.
- Borç/alacak toplamları ve net bakiye Decimal/SQL numeric ile hesaplanır.
  DEBIT borcu artırır; CREDIT azaltır. Pozitif bakiye işletmenin alacağını,
  negatif bakiye işletmenin borcunu gösterir. Yön cari türünden bağımsızdır.
- Açılış, her cari ve şube için bir OPENING hareketidir. Sıfır açılış için kayıt
  gerekmez. Tüm hareket tutarları sıfırdan büyüktür; kredi/alacak yönü ayrı seçilir.
- Açıklamalı ADJUSTMENT ve eşit tutarlı karşıt REVERSAL. Ters kayıt tarihi
  orijinalden önce olamaz; orijinal kayıt düzenlenmez veya silinmez. Açılış ters
  kaydedilse bile ikinci OPENING yerine ADJUSTMENT kullanılır.
- Pasif kartlarda yeni normal hareket engellenir; hatalı geçmişin ters kaydı
  yapılabilir. Bağlantılı ödeme/fatura kaynakları manuel API'den ters çevrilemez.
- Cari hareketi hiçbir kasa kaydı oluşturmaz. Kullanıcı gelecekteki kaynak,
  finans bağlantısı veya oluşturucu alanlarını manuel istekle belirleyemez.
- Hareket oluşturma/ters kayıt; kalıcı işletme bazlı idempotencyKey + normalize
  edilmiş requestHash, unique reversal ve Serializable transaction ile korunur.
  İşlem ve AuditLog birlikte kaydedilir. Aynı anahtar/aynı içerik 200, ilk kayıt
  201, aynı anahtar/farklı içerik 409 döner.
- UI belirsiz sunucu/ağ hatasında yeni hareketi kilitler; aynı anahtarla tekrar
  doğrular. SessionStorage kullanılabiliyorsa istek sayfa yenilemede de korunur;
  depolamanın engellendiği tarayıcılarda yalnızca açık bileşende korunur.

## İşletme ve şube kapsamı

Cari kartı işletmenin ortak kayıt defteridir; finance.manage sahibi işletme
üyeleri ortak kartları görüp düzenleyebilir. Şube hareketleri, açılışlar, net
bakiye, üst toplamlar, ekstre ve CSV yalnızca kullanıcının izinli şubelerini
içerir. Şube filtresinin verilmemesi kapsamı genişletmez. Hiç şubesi olmayan
kısıtlı kullanıcı hareket göremez veya ekleyemez. Üst kartlar liste araması ve
tür/aktiflik filtrelerinden bağımsızdır; pasiflerin açık bakiyeleri de korunur.
Müşteri/BOTH pozitif netleri müşteri alacağına; tedarikçi/BOTH negatif netleri
tedarikçi borcuna katılır. Diğer ters bakiyeler cari kartında yön etiketiyle görünür.

## Ekstre

Tarih, işlem türü, açıklama, referans, şube, borç, alacak, işlem sonrası bakiye ve
oluşturan kullanıcının/personel profilinin adı gösterilir. İsim mevcut kullanıcı
ve profil kaydından okunur; geçmiş adın ayrıca anlık görüntüsü tutulmaz.

İstanbul takvim günü başlangıç/bitiş filtreleri, metin arama, artan/azalan tarih
sırası ve sayfalama vardır. Kararlı sıra `(occurredAt, createdAt, id)` kullanılır.
SQL window toplamı arama/tarih/sayfalama öncesinde hesaplanır. Dolayısıyla
arama yüzünden gizlenen hareketler ve önceki sayfalar bakiyeden düşmez.
Başlangıç öncesi devir ayrı gösterilir. Güncel bakiye tarih filtresiyle sınırlı
değildir; filtrelenmiş borç/alacak toplamları ayrıca verilir.

CSV aynı kapsam ve filtreleri kullanır; sayfa sınırı yoktur. UTF-8 BOM, noktalı
virgül, hücre kaçışları ve Excel formül enjeksiyonuna karşı metin öneki içerir.
CSV'de eksi bakiyeler güvenli metin hücresi olarak korunur. Okumalar aynı
RepeatableRead snapshot içinde yapılır.

## API

| Yol | Metot | İşlem |
| --- | --- | --- |
| `/api/current-accounts` | GET / POST | Liste / cari oluşturma |
| `/api/current-accounts/:id` | GET / PATCH | Kart detayı / düzenleme ve aktiflik |
| `/api/current-accounts/:id/entries` | GET / POST | Ekstre / açılış veya düzeltme |
| `/api/current-accounts/:id/entries/:entryId/reverse` | POST | Ters kayıt |
| `/api/current-accounts/:id/statement.csv` | GET | CSV ekstre |

Liste parametreleri: `q`, `type`, `active=true|false|all`, `page`, `limit`.
CUSTOMER ve SUPPLIER filtreleri BOTH carilerini de içerir.
Ekstre/CSV parametreleri: `q`, `startDate`, `endDate`, `branchId`, `sort=asc|desc`,
`page`, `limit` (CSV'de sayfalama yok). limit 1–100 arasındadır.

POST hareket örneği:

```json
{
  "branchId": "yetkili-sube-id",
  "kind": "OPENING",
  "direction": "DEBIT",
  "amount": "5000.00",
  "description": "Devir açılışı",
  "reference": "ACILIS-2026",
  "occurredAt": "2026-10-22",
  "idempotencyKey": "bir-kez-uretilen-uuid"
}
```

Düzeltmede kind ADJUSTMENT ve açıklama zorunludur. Ters kayıt gövdesinde açıklama,
idempotencyKey, isteğe bağlı reference/occurredAt bulunur; tutar/yön sunucuda alınır.

## Migration incelemesi

Onaylanmış modele göre iki boş tablo, üç enum, indeksler ve bileşik FK'ler eklenir.
Ek SQL kısıtları: pozitif tutar, ters kayıt türü/bağlantısı tutarlılığı,
normalize kod ve cari/şube başına tek OPENING. Prisma bu özel CHECK ve kısmi
indeksi şemada ifade etmediği için taslağa ayrıca eklendi; sonraki migrationlarda
bu kısıtların korunması gerekir.

Mevcut Organization, Branch, User ve StaffProfile şemasında ters ilişkiler;
FinanceTransaction üzerinde yeni ters ilişki ve `(id, organizationId, branchId)`
benzersiz indeksi vardır. Bu indeks mevcut finans tablosunu tarar ve kilit/süre
etkisi yaratabilir. Mevcut finans verilerinde UPDATE, DELETE, geri doldurma veya
POS muhasebeleştirmesi yoktur. SQL BEGIN/COMMIT ile atomik uygulanacak şekilde
hazırlanmıştır. Kullanıcının ayrı canlı onayı sonrasında başarıyla uygulanmıştır.

Uygulama öncesi ve sonrası satır sayıları: FinanceAccount 3, FinanceTransaction 5,
Order 16; hepsi aynı kaldı. Gerçek cari entegrasyon testi sonunda CurrentAccount
ve CurrentAccountEntry sayıları sıfırdır; test fixture'ları kalıcılaşmadı.
Pozitif tutar, ters kayıt türü, normalize kod ve tek açılış kısıtları ile yeni
finans bağlantısı indeksi ayrıca canlı kataloglardan doğrulandı. Ayrıntılar
`docs/migrations/current-accounts-preflight.json` ve
`docs/migrations/current-accounts-verification.json` dosyalarındadır.

Gelecek ödeme/tahsilat kaydı tek kasa hareketine benzersiz financeTransactionId
ile bağlanacak; kaynak olay sourceKey ile ayrıca korunacak. Bu aşamada
vadeli POS, tahsilat, ödeme, fatura oluşturma veya fatura bazlı ödeme dağıtımı yoktur.
Fatura dağıtımı ileride ayrı allocation tablosuyla yapılmalı; dağıtım yeniden
kasa/cari geliri veya hareketi yaratmamalıdır.

## Doğrulama ve sınırlar

- `prisma validate`: başarılı.
- Yerel `prisma generate`: başarılı; yalnızca istemci dosyaları üretildi.
- İki yerel şema arasında `prisma migrate diff --script`: SQL taslağı üretildi,
  veritabanına bağlanmadı.
- `next typegen`: başarılı.
- `tsc --noEmit`: başarılı.
- Değişen TypeScript/TSX ve yeni testlerin ESLint kontrolü: başarılı.
- `node --test tests/*.test.cjs`: 71 test, 67 başarılı, 0 hata, 4 atlanan
  veritabanı testi. Yeni 15 çevrimdışı cari testi başarılıdır.
- Migration sonrasında `WELLPOS_CURRENT_ACCOUNTS_DB_TEST=1` ile yalnızca yeni
  cari PostgreSQL entegrasyon testi ayrıca çalıştırıldı: 1 başarılı, 0 hata.
  Gerçek SQL ekstre bakiyesi, arama/tarih/sayfalama/sıralama, CSV, şube kapsamı,
  pozitif tutar, tek açılış ve işletme/şube FK kısıtları doğrulandı. Fixture'ların
  tamamı dış transaction rollback'iyle geri alındı; veri silme sorgusu çalışmadı.
- Mevcut kasa, satış, iade ve RBAC çevrimdışı testleri başarılıdır.

Çevrimdışı testler API yetkileri, doğrulama, Decimal toplamları, mükerrer kod,
açılış, ters kayıt, atomiklik ve SQL'in parametre/kapsam/pencere yapısını sınar.
Taklit transaction sıralaması gerçek PostgreSQL eşzamanlılık doğrulaması değildir.
Yeni `current-accounts.integration.test.cjs` gerçek SQL ekstre bakiyesi,
arama/tarih/sayfalama/sıralama ve CHECK/FK/kısmi indeks testini içerir;
`WELLPOS_CURRENT_ACCOUNTS_DB_TEST=1` ile açıkça etkinleştirilmedikçe atlanır.
Migration uygulanmış ve ayrıca izin verilmiş test veritabanında çalıştırılmalıdır.
Fixture'lar dış transaction sonunda rollback edilir; veri silme sorgusu yoktur.

Tarayıcı envanterinde açık oturum bulunmadığından masaüstü/mobil görsel kabul
testi henüz yapılmadı. Gerçek veritabanı ekstre/API entegrasyonu doğrulandı.

## Bu aşamada değişen dosyalar

- `prisma/schema.prisma`
- `src/lib/current-accounts.ts`
- `src/lib/current-accounts-service.ts`
- `src/lib/current-account-statement.ts`
- `src/app/api/current-accounts/route.ts`
- `src/app/api/current-accounts/[id]/route.ts`
- `src/app/api/current-accounts/[id]/entries/route.ts`
- `src/app/api/current-accounts/[id]/entries/[entryId]/reverse/route.ts`
- `src/app/api/current-accounts/[id]/statement.csv/route.ts`
- `src/app/dashboard/accounts/page.tsx`
- `src/app/dashboard/accounts/[id]/page.tsx`
- `src/components/current-accounts/shared.tsx`
- `src/components/current-accounts/CurrentAccountsManager.tsx`
- `src/components/current-accounts/CurrentAccountDetail.tsx`
- `src/components/dashboard/Sidebar.tsx`
- `src/components/dashboard/DashboardHeader.tsx`
- `tests/current-accounts.test.cjs`
- `tests/current-accounts.integration.test.cjs`
- `docs/current-accounts-design.md`
- `docs/current-accounts.md`
- `docs/migrations/current-accounts.sql`
- `prisma/migrations/20261022000000_add_current_accounts/migration.sql`
- `docs/migrations/current-accounts-preflight.json`
- `docs/migrations/current-accounts-verification.json`

`src/generated/prisma` yerel olarak yeniden üretildi; mevcut gitignore'a göre
takip edilmiyor. Çalışan kasa/POS/iade işleyicilerinde değişiklik yapılmadı.

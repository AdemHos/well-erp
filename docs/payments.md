# Ödemeler ve Tahsilatlar

Finans > Ödemeler (`/dashboard/payments`) beş işlem türünü destekler. Mevcut
`Payment` / fiziksel `ExpensePayment` tablosu ve `InvoicePaymentAllocation`
korundu. Harici banka veya ödeme sağlayıcısı entegrasyonu yoktur.

## Kayıt sahipliği ve işlem sözleşmesi

| Tür | Kasa | Cari | Belge |
| --- | --- | --- | --- |
| CUSTOMER_COLLECTION | IN | COLLECTION / CREDIT | Belgesiz müşteri alacağı |
| SUPPLIER_PAYMENT | OUT | PAYMENT / DEBIT | Belgesiz tedarikçi borcu |
| EXPENSE_PAYMENT | OUT | Varsa PAYMENT / DEBIT | Aktif gider |
| PURCHASE_INVOICE_PAYMENT | OUT | PAYMENT / DEBIT | Kesin alış faturası |
| SALES_INVOICE_COLLECTION | IN | COLLECTION / CREDIT | Kesin satış faturası |

Giderler ekranı `createExpensePayment` çekirdeğini kullanmaya devam eder.
Merkezi ekrandan gider veya gider bağlantılı alış faturası ödemesi aynı çekirdeğe
gider: bir Payment, bir kasa çıkışı, varsa bir cari hareket ve bir fatura tahsisi.
Fatura kesinleştirme, geçmiş aktif gider ödemelerini tahsis eder; tekrar para
hareketi yazmaz. Cari ve kasa kayıtlarında ödeme ID'si veya kullanıcı referansı
bulunur. Kayıtlar Payment üzerinden benzersiz bağlarla izlenir.

POS_SALE/POS_REFUND kaynakları ve kasa transferleri bu modüle aktarılmaz.
orderId, source, direction, status, ödenen toplam veya hareket ID'leri istemciden
kabul edilmez. POS siparişine bağlı bir fatura merkezi ekrandan tahsil edilemez.
Yalnız aynı işletme ve şubedeki aktif CASH/BANK hesapları kullanılabilir.

## Bakiye ve avans politikası

MVP'de avans yoktur. Para hesapları Prisma Decimal ile yapılır. Her belge
ödemesi hem belgenin açık tutarı hem aynı şubenin net cari bakiyesiyle sınırlıdır.
Carisiz gider yalnız kendi kalanı ve ödeme hesabı bakiyesiyle sınırlıdır.

Belgesiz cari kapamada net bakiyeden aynı yöndeki açık kesin faturalar ve henüz
kesin faturaya bağlanmamış giderlerin açık tutarları ayrılır. Böylece cari kapanıp
aynı faturanın ikinci kez ödenmesi önlenir. Belge borcu için ilgili belge işlem
türü seçilmelidir; otomatik FIFO/mahsup yapılmaz. Fatura ve gider aynı borcu
temsil ediyorsa bir kez sayılır. Başka şubenin bakiyesi kullanılamaz.

Ödeme durumu ayrı bir değiştirilebilir toplam olarak tutulmaz; aktif ödeme veya
tahsis toplamından UNPAID / PARTIALLY_PAID / PAID hesaplanır. Liste, detay, PDF
ve raporlar aynı iptal dışlama kuralını kullanır. Finans ana ekranında aktif
ödemeler/tahsilatlar, açık belge borcu ve açık satış faturası alacağı gösterilir.
Cari açılış/düzeltme bakiyeleri cari ekstrede ayrıca izlenir; kasa transferleri
ödeme toplamına girmez.

## Atomiklik, idempotency ve yetki

- `organizationId + idempotencyKey` benzersizdir; farklı içerikle tekrar 409,
  aynı içerikle tekrar 200 döner. İlk kayıt 201 döner.
- Gider API'sinin eski requestHash ve deterministik ID sözleşmesi korundu.
  Aynı istek eski gider endpoint'i veya merkezi endpoint üzerinden tekrar
  gönderilebilir. İptal edilmiş eski istek yeni ödeme yaratmaz.
- Serializable transaction, P2034 için sınırlı retry ve benzersiz kasa/cari
  bağları kullanılır. Belge, cari ve kasa limitleri transaction içinde okunur.
- Payment, kasa, cari, fatura tahsisi ve audit aynı transaction içinde yazılır.
  Herhangi bir aşamadaki hata tamamını geri alır.
- finance.manage: OWNER / ADMIN / MANAGER. Aktif personel oturumu, origin,
  işletme ve şube erişim kontrolleri mevcut RBAC üzerinden uygulanır.
- İstemci sonucu belirsiz isteğin anahtarını sessionStorage'da saklar ve aynı
  isteği doğrular; frontend kilidi sunucu güvenliğinin yerine geçmez.

## İptal ve düzeltme

Finansal ödeme silme/düzenleme endpoint'i yoktur. Yetkili kullanıcı gerekçeyle
iptal eder. Orijinal hesapta karşıt PAYMENT_REVERSAL, varsa orijinal cari
hareketine bağlı REVERSAL ve iptal audit'i atomik oluşur. Orijinal Payment ve
tahsisler saklanır; açık belge tutarları otomatik yeniden artar. İkinci iptal
409 verir. Düzeltme iptal + yeni istek anahtarıyla yeni ödeme şeklindedir.

Asıl hesap pasif olsa da ters kayıt aynı hesapta kalır. Tahsilat iptali OUT
olduğundan yeterli bakiye gerekir. Para harcanmışsa iptal reddedilir. Bu işlem
gerçek banka transferi veya kart işlemini geri almaz; WellPOS kayıt düzeltmesidir.
POS iadeleri kendi mevcut akışında kalır.

Geçmiş ödemesi bulunan giderin finansal alanları, ödeme iptal edilmiş olsa bile
korunur. Tüm aktif ödemeler iptal edildikten sonra kaynak gider/fatura mevcut
tahakkuk ters kayıt kurallarıyla iptal edilebilir.

## API

| Endpoint | İşlem |
| --- | --- |
| GET /api/payments | Sayfalı liste ve aynı filtrelerde aktif ödeme toplamları |
| POST /api/payments | Ödeme/tahsilat oluşturma |
| GET /api/payments/options | Yetkili şubeler, hesaplar, cariler ve açık belge seçimleri |
| GET /api/payments/overview | Yetkili şubelerde finans ana ekranı özeti |
| GET /api/payments/:id | Ödeme ve kaynak/iptal bağlantıları |
| POST /api/payments/:id/cancel | Gerekçeli iptal |

Liste filtreleri: type, branchId, accountId, currentAccountId, expenseId,
invoiceId, startDate, endDate, q (referans), status (active/cancelled/all),
page ve limit. Özetler sayfalama öncesi hesaplanır. İptal filtresinde para
toplamları sıfırdır; iptal geçmişinin işlem sayısı korunur.

Oluşturma alanları: type, branchId, currentAccountId, expenseId, invoiceId,
accountId, amount, paidAt, description, reference, idempotencyKey. Belge türünde
yalnız ilgili belge ID'si kabul edilir; cari belge üzerinden belirlenir ve
gönderilmişse eşleşmesi gerekir. Belgesiz işlemde cari zorunludur. Tutar pozitif,
en fazla iki ondalıklıdır. Gelecek tarih reddedilir. İptal gövdesi: `{ "reason": "..." }`.

## Migration ve canlıya geçiş

SQL: `prisma/migrations/20261023010000_add_payments/migration.sql`.
İnceleme kopyası: `docs/migrations/payments.sql`.

Şema PaymentType, cari bağlantısı, iptal kullanıcı/personel/gerekçe alanları,
benzersiz ters kayıt bağlantıları, kapsamlı FK'ler, indeksler ve CHECK'ler ekler.
Ön kontrol eski ödemenin gider/kasa/cari bağını doğrular; tutarsızlık varsa durur.
Mevcut ödeme metadata'sı EXPENSE_PAYMENT ve doğrulanmış currentAccountId ile
doldurulur. Eski kimlik/tutar/tarih/hash/kasa/cari/tahsis kayıtları korunur.

Eski gider/fatura API'leri migration öncesi yeni kolonları seçmez/yazmaz. Yeni
özellikler migration gerektirir. Şema algılama önbelleğe alınmaz. PaymentType
varsayılanı DB tarafındadır; Prisma eski tablo INSERT'ine yeni kolonu eklemez.

Canlı adımlar:

1. Yeni Neon yedeği alınmalı ve geri yüklenebilirliği doğrulanmalı.
2. SQL ve ön kontrol sonuçlarıyla ayrı canlı migration onayı alınmalı.
3. Uygulama ve şema geçişi birlikte yapılmalı; iptal bilmeyen eski rapor sürümü
   eşzamanlı kullanılmamalı. Yeni CHECK'ler eski uygulama yazımlarına uygun değildir.
4. Metadata backfill ve indeks/FK taramaları kısa süreli tablo kilidi alabilir.
   Bakım aralığı seçilmeli; büyük tabloda süre yerel küçük fixture sonucundan
   tahmin edilmemeli.
5. Sonrasında eski veri kimlik/tutar/hash, FK/CHECK, bakiye ve örnek işlem
   doğrulaması yapılmalı. db push/reset ve otomatik geçmiş eşleştirme kullanılmaz.

Yerel geliştirme sırasında Neon değiştirilmedi. Ardından kullanıcının ayrı canlı
onayıyla yalnız ödeme migration’ı uygulandı; db push veya veri silme yapılmadı. Yerel doğrulayıcı DATABASE_URL'yi kullanmaz; yeni rastgele
port/parolalı localhost PostgreSQL yaratır ve sonunda durdurur.

## Değişen dosyalar

- Şema ve SQL: `prisma/schema.prisma`, yeni migration ve inceleme kopyası.
- Çekirdek: `src/lib/payment-service.ts`, `payment-operations.ts`,
  `payment-balance.ts`, `payment-schema.ts`, `payments.ts`, `cash-management.ts`.
- Okuma/rapor: `payment-read.ts`, `payment-overview.ts`, `expenses.ts`,
  `expense-service.ts`, `expense-read.ts`, `invoice-service.ts`, `invoice-read.ts`,
  `current-account-statement.ts`.
- API: `src/app/api/payments/**`.
- UI: `src/app/dashboard/payments/page.tsx`, `src/components/payments/**`,
  `src/app/dashboard/finance/page.tsx`, `src/components/dashboard/Sidebar.tsx`,
  `src/components/finance/FinanceManager.tsx`, gider/fatura detayları ve shared tipleri.
- Doğrulama: `tests/payments.integration.test.cjs`, mevcut gider mock testinin
  yeni sorgu desteği, `scripts/test-finance-local.cjs`,
  `scripts/payment-migration-fixture.cjs`.
- Belgeler: `docs/payments-design.md`, bu dosya.

## Doğrulama

İstenen 16
senaryo yeni PostgreSQL ödeme testinde; ek olarak iki endpoint arası replay,
gider/fatura tek tahakkuk, belgesiz kapama sınırı, iptal sonrası eski anahtar,
pasif hesapta ters kayıt, yetersiz kasa, PDF, dashboard ve filtreler sınanır.
Eşzamanlılık testleri gerçek ayrı bağlantılarda Promise.all ile çalışır.
Eski regresyonların uzun rollback fixture transaction'ları, ödeme dosyasıyla
testler arası SSI çakışmasını önlemek için dosya düzeyinde sırayla çalışır.

Yerel migration testi tarihsel Payment fixture'ını SQL öncesinde kaydeder ve
sonrasında ID/tutar/hash/hareketleri karşılaştırır; cari backfill'i doğrular.


### Sonuçlar — 23 Ekim 2026

| Kontrol | Sonuç |
| --- | --- |
| npx prisma validate --config prisma7.config.ts | Başarılı |
| npx prisma generate --config prisma7.config.ts | Başarılı; yerel istemci üretildi |
| npx tsc --noEmit | Başarılı |
| Değişen TypeScript/TSX ve test/script dosyalarında ESLint | Başarılı |
| node --test tests/*.test.cjs | 89 başarılı, 0 başarısız; 7 isteğe bağlı DB testi bu komutta atlandı |
| Son ekstre değişikliği sonrası ilgili birim regresyonları | 35 başarılı, 0 başarısız |
| node scripts/test-finance-local.cjs | Migration sonrası 16 başarılı, 0 başarısız, 0 atlanan |
| Migration öncesi uyumluluk | Fatura migration öncesi gider testi + ödeme migration öncesi gider/fatura testleri başarılı |
| Tarihsel ödeme migration fixture'ı | Kimlik/tutar/tarih/hash/kasa/cari kayıtları korunuyor; yeni cari bağlantısı doğru |

Yerel DB turu ödeme testinin 11 alt grubunda istenen 16 senaryoyu ve ek
kontrolleri çalıştırdı; ayrıca Cari, Gider, Fatura ve POS/iade gerçek PostgreSQL
regresyonları geçti. Aynı faturaya iki ayrı ödeme ve aynı anahtarla iki istek
ayrı bağlantılarda eşzamanlı gönderildi; tek ödeme/limit kuralları korundu.

### Açık koşullar ve sınırlamalar

- Canlı Neon migration’ı ayrı kullanıcı onayıyla uygulandı. Yeni yedek, gerçek
  geri yükleme ve gerçek verinin yerel kopyasında migration provası başarılı.
- Migration kolon ekleme/backfill ve indeks/FK taramaları kilit alır. Canlı
  büyüklükte süre/lock etkisi ölçülmedi. Eski rapor/uygulama sürümüyle birlikte
  iptal özelliği açılmamalı.
- Tarayıcıda oturumlu görsel/etkileşimli UI kontrolü ve production build bu
  aşamada çalıştırılmadı. Responsive arayüz mevcut ortak tasarım sınıflarını
  kullanır; API davranışları gerçek PostgreSQL testleriyle doğrulandı.
- İsteğe bağlı RBAC/personel entegrasyon testleri genel çevrimdışı turda atlandı;
  ödeme rol/şube/işletme kontrolleri yeni ödeme entegrasyonunda ve mevcut birim
  testlerinde çalıştırıldı.
- pg@8, mevcut savepoint tabanlı eski test harness'lerinde paralel sorgu için
  deprecation uyarısı verdi; testler başarılı. Üretimde kullanılan ortak ödeme
  akışı sorguları sırayla await eder.
- MVP avans, çoklu belgeye ödeme dağıtımı, banka/kart geri alma ve POS fişinden
  fatura üretimi sunmaz. Bunlar bu aşamanın kapsamına eklenmedi.


## Canlı uygulama — 23 Ekim 2026 01:27:07 (Europe/Istanbul)

Kullanıcının ayrı canlı onayı üzerine yeni before-payments yedeği alındı.
36 tablo ayrı localhost PostgreSQL’e geri yüklendi; tüm satır sayıları eşleşti.
Ödeme migration’ı geri yüklenen gerçek veri kopyasında prova edildi; iş
verilerinin içerik özetleri, tarihsel metadata, enumlar, kısıtlar ve indeksler
doğrulandı. Doğrulama sunucusu kapatıldı.

- Yedek: `.backups/wellpos-before-payments-2026-10-22T22-24-18-797Z/wellpos.dump`.
- Yedek SHA-256: `81195bac04dd08e78979eaf3a33b4f233fb8d0ec4f8d72651b876f09c9bcac6b`.
- Migration: `20261023010000_add_payments`.
- SQL SHA-256: `aed4a6426837b5ad595c73ad57fc841e8996ba97f215711bab9a45d306e81522`.
- Önceki 20 migration checksum’ı eşleşti; yalnız ödeme migration’ı bekliyordu.
- Prisma migrate deploy başarılı; canlıda 21 tamamlanmış migration doğrulandı.
- Tüm mevcut iş tablosu sayıları ve özgün kolon içerik özetleri korundu.
- Yeni ödeme FK/CHECK’leri ve indeksleri doğrulandı.
- Prisma yeni ödeme ilişkilerini READ ONLY transaction içinde başarıyla okudu.
  Canlı Payment tablosunda henüz ödeme yok; test ödemesi oluşturulmadı.
  Fazla ödenmiş fatura/gider ve tutarsız kasa/cari ödeme bağlantısı bulunmadı.

Kanıtlar: [ön kontrol](migrations/payments-preflight.json),
[migration doğrulaması](migrations/payments-verification.json),
[uygulama istemcisi salt okunur kontrolü](migrations/payments-live-readonly.json).
Eklenen araçlar: `scripts/payment-deployment-checks.cjs`,
`scripts/deploy-payments-migration.cjs`, `scripts/check-payments-live.cjs`;
`verify-neon-backup.cjs` isteğe bağlı ödeme migration provasıyla genişletildi.
Bu araçların ESLint/sözdizimi kontrolleri başarılı.
Tarayıcı oturumuyla görsel/etkileşimli UI kontrolü ve production build yapılmadı.

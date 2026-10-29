# Faturalar modülü — yerel geliştirme ve doğrulama

## Kapsam

Adres: `/dashboard/invoices`, detay ve `/preview`. Alış/satış taslağı, katalog veya
serbest hizmet satırları, açık KDV oranı, dahil/hariç fiyatlandırma, satır ve genel
iskonto, sunucuda toplam önizlemesi, kesinleştirme, gerekçeli iptal, cari ve gider
bağlantıları, gerçek PDF indirme ve yazdırma eklendi. Arama, tür/durum/ödeme
durumu/şube/tarih filtresi ve sayfalama mevcut. Finansal kartlar yalnız seçili
filtrelerdeki ISSUED belgeleri sayar; taslak/iptaller bakiye raporuna katılmaz.

DEBIT − CREDIT işletmenin net alacağıdır. Bağımsız alış CREDIT, satış DEBIT
üretir. Taslaklar ve fatura kesinleştirmesi stok/kasa yazmaz. Kesin belgeler
düzenlenemez. Ödemesiz iptal eski tahakkuku silmez; tek REVERSAL üretir.
Faturaya bağlı kesin giderin düzenleme/iptal API'si bu kuralları atlayamaz.

## Gider ve ödeme bağlantıları

Mevcut ExpensePayment tablosu yerinde kaldı; Prisma modeli Payment ve
`@@map("ExpensePayment")` kullanıyor. Kimlikler/ilişkiler/kayıtlar kopyalanmıyor.
expenseId nullable olması sonraki genel Ödemeler aşamasını hazırlıyor.
Gider ödeme yazımı `payment-service.ts` içine alındı; mevcut endpoint korunuyor.
InvoicePaymentAllocation mevcut ödemenin tahsisidir, yeni kasa/cari hareketi
değildir. Kısmi/tam ödeme gerçek tahsis toplamından türetilir; fazla tahsis
transaction içinde reddedilir. Aynı ödeme/istek tekrarı ikinci kasa çıkışı yapmaz.

Mevcut gider bağlama aynı şube/cari/toplam gerektirir. Mevcut EXPENSE tahakkuku
benimsenir; yeni borç üretilmez. Eski ödemeler aynı kimliklerle tahsis edilir;
yeni gider ödemeleri de bağlı kesin faturaya aynı transaction'da tahsis edilir.
Cari ekstresinde eski açıklama/referans korunur, ek fatura numarası ve bağlantısı
gösterilir; fatura numarasına göre arama ve CSV de desteklenir. Gider raporu tek
Expense sayar. İsteğe bağlı yeni gider yalnız kesinleştirmede seçilen OUT
kategorisiyle oluşturulur. Bütün alış faturaları otomatik gider veya stok sayılmaz.

Carisiz, ödemesiz gider gerekçeyle tedarikçiye bağlanabilir; carisiz ödemeli gider
otomatik benimsenmez. Ödemeli belge iptal edilmez. Tahsilat/ödeme iadesi ve geçmiş
ödeme düzeltmesi sonraki aşamadadır. Bağımsız faturalar için yeni ödeme ekranı
henüz açılmaz; genel Ödemeler modülü bu ortak model/servisi genişletecek.

## Hesaplama ve numara

Decimal miktar (3 basamak), birim fiyat (4), tutar (2) ve HALF_UP kullanılır.
Genel iskonto kuruşları en büyük kalan yöntemiyle, eşitlikte satır sırasıyla
dağıtılır. Satır iskontosu sonrası genel iskonto; ardından seçilen fiyat moduna
göre KDV hesaplanır. Toplamlar yuvarlanmış satırların toplamıdır. İstemci toplam,
ödeme durumu veya orderId enjekte edemez. Ürün/POS modellerinde vergi bilgisi
olmadığından oran varsayılmaz; sıfır oran da açık kullanıcı seçimidir.

Satış numarası işletme genelinde; dış alış numarası işletme + tedarikçi kapsamında
kısmi unique indeksle korunur. Taslak ve iptaller numarayı korur. Resmî seri veya
GİB numarası üretilmez. Ayrıntılı sözleşme `invoices-design.md` içindedir.

## POS ve belge sınırları

Order bağlantısı benzersiz ve işletme/şube FK'siyle hazırlandı. Bu aşamada
otomatik POS dönüştürme endpoint/UI'si yoktur. Mevcut POS tahsilatının ortak
Payment olarak benimsenmesi, açık vergi bilgileri, müşteri mahsuplaşması ve POS
iadesiyle birlikte tersleme çözülmeden köprü açılmaz. Mevcut stok/gelir/iade
akışlarına yeni yazım eklenmedi.

PDF dosyası pdf-lib/fontkit ve lisansı eklenmiş DejaVu Sans kullanır; fontun
sunucu deployment paketine alınması Next outputFileTracingIncludes ile belirtilir.
Her PDF sayfasında "Taslak / Ticari Belge Önizlemesi" ve resmî e-Fatura/e-Arşiv
olmadığı etiketi vardır. ETTN, mali mühür, QR, doğrulama kodu uydurulmaz. Kesin
belgede işletme/şube/cari kimliği snapshot'tan okunur. Bu, GİB entegrasyonu değildir.

## Testler

- `prisma validate` ve yerel `prisma generate`: başarılı; veritabanına bağlanmaz.
- `next typegen`, `tsc --noEmit`, değişen TypeScript/React/test dosyalarında ESLint:
  başarılı.
- `node --test tests/*.test.cjs`: 95 test, 89 başarılı, 6 opt-in veritabanı testi
  varsayılan çalıştırmada atlandı. POS/iade/Kasa/Cari/Gider regresyonları dahil.
- `node scripts/test-finance-local.cjs`: yeni, izole **localhost PostgreSQL**
  kümesi açar; bütün migration'ları boş DB'ye uygular. Neon URL'sini okumaz ve
  kullanmaz. Önce fatura migration'ı olmadan gerçek gider entegrasyonunu çalıştırır
  (1 başarılı), sonra migration ile gider + fatura entegrasyonlarını çalıştırır
  (2 başarılı). Test fixture'ları dış transaction rollback ile temizlenir ve
  sunucu finally içinde durdurulur. Yardımcı, `.tools/postgresql/bin` gerektirir.
- Gerçek API/SQL testinde: taslak/düzenleme ve kasa-cari etkisizliği; alış/satış
  yönleri; Decimal KDV/iskonto; tekrar kesinleştirme; tek ters kayıt; ödemeli iptal
  reddi; numara indeksleri; gider borcunu benimseme; 3.000 + 7.000 ödeme;
  mükerrer/fazla/yanlış şube ödemesi; tahsis dahil atomik rollback; cari ekstrede
  fatura araması; raporlar; yetki ve işletme/şube izolasyonu; PDF erişim kontrolü.
- POS hazırlığı: orderId enjekte eden istek reddi, gerçek unique Order bağlantısı
  ve şube FK'si; fatura işlemlerinde stok/POS gelir kaydı oluşmaması. Otomatik POS
  dönüştürmesinin uçtan uca testi yapıldığı iddia edilmez.
- 35 uzun kalemli 7 sayfalı gerçek PDF üretildi, PNG render'ları görsel incelendi.
  pdfplumber ile Türkçe karakterler, dondurulmuş kimlik, toplamlar ve her sayfanın
  uyarısı doğrulandı. Formun statik gerçek bileşen render'ı Chrome'da 390/1440 px
  genişliklerde incelendi; yatay taşma yok. Bu kontrol tam oturumlu browser E2E
  testi değildir; canlı veride kullanıcı işlemi yapılmadı.

## Migration ve canlıya geçiş

Hazır SQL: `prisma/migrations/20261022020000_add_invoices/migration.sql`;
inceleme kopyası `docs/migrations/invoices.sql`. Üç enum, üç yeni tablo,
tenant/şube FK'leri, indeksler/CHECK'ler; Product/Order bileşik unique anahtarları;
ExpensePayment.expenseId NOT NULL kısıtının gevşetilmesi. Veri silme, tablo
yeniden adlandırma, eski satıştan/giderden fatura üretme veya backfill yok.
Mevcut tablolardaki unique indeksler tarama/kilit gerektirebilir; canlı uygulama
öncesi SQL ve kilit etkisi değerlendirilmeli. Eski gider akışı, Invoice tablosu
henüz yokken güvenli to_regclass kontrolü sayesinde çalışmaya devam eder.

Kullanıcının ayrı yedek onayıyla 22 Ekim 2026 03:10'da yeni Neon yedeği alındı;
gerçek yerel restore ve 33 tablonun satır sayıları doğrulandı. Ayrıntılar
`database-backups.md` belgesindedir. Sonrasında kullanıcı ayrıca canlı migration'ı
onayladı. `20261022020000_add_invoices`, Prisma `migrate deploy` ile Neon'a uygulandı.
db push/reset/veri silme yapılmadı.

Ön kontrol: doğrulanmış yedek ve arşiv SHA-256; önceki 19 migration'ın yerel/canlı
checksum eşleşmesi; tek bekleyen migration'ın onaylı fatura SQL'i olması.
Son kontrol: canlıda 20 tamamlanmış migration; fatura SQL SHA-256 eşleşmesi;
bütün yeni FK/CHECK'ler validated; alış/satış numarası unique indeksleri;
ExpensePayment.expenseId nullable. Mevcut 32 iş tablosunun hem satır sayıları
hem satır içeriklerinden hesaplanan özetleri değişmedi. Yeni üç fatura tablosu
doğrulama anında boştu. Gerçek Prisma Client ile READ ONLY transaction içinde
fatura ilişkileri sorgusu ve Payment → ExpensePayment tablo eşlemesi başarılı.
Canlıya test faturası veya ödeme eklenmedi.

Kanıtlar: `docs/migrations/invoices-preflight.json` ve
`docs/migrations/invoices-verification.json`. Onaylı tek migration için checksum ve
yedek kontrolleri yapan araç: `scripts/deploy-invoices-migration.cjs` (ESLint ve
Node sözdizimi kontrolü başarılı). Bu araç genel otomatik migration aracı değildir;
başka bekleyen migration veya değişmiş SQL varsa durur.

## Değişen dosyalar

- `prisma/schema.prisma`; yeni migration SQL ve inceleme kopyası.
- `src/lib/invoices.ts`, `invoice-service.ts`, `invoice-read.ts`, `invoice-pdf.ts`,
  `payment-service.ts`; ortak ödeme için `expense-service.ts`; fatura referansları
  için `current-account-statement.ts`.
- `/api/invoices`: liste/oluşturma, detay/düzenleme, issue, cancel, calculate,
  options ve PDF route'ları.
- `/dashboard/invoices`: liste, detay, preview sayfaları;
  `src/components/invoices/{shared,InvoiceForm,InvoicesManager,InvoiceDetail,InvoicePreview}`.
- Menü: `Sidebar.tsx`, `DashboardHeader.tsx`; ekstre: `CurrentAccountDetail.tsx`.
- `tests/invoices.test.cjs`, `invoices.integration.test.cjs`, `invoice-pdf.test.cjs`;
  ortak model ve migration uyumluluğu için `expenses.test.cjs`,
  `expenses.integration.test.cjs`, `current-accounts.test.cjs`.
- `scripts/test-finance-local.cjs`; `package.json`/lock, `next.config.ts`,
  `public/fonts/DejaVuSans.ttf` ve `DejaVu-LICENSE.txt`, `.gitignore` (tmp hariç).
- `docs/invoices-design.md`, bu rapor.
- Canlı uygulama: `scripts/deploy-invoices-migration.cjs`,
  `docs/migrations/invoices-preflight.json`, `invoices-verification.json` ve
  güncellenen `docs/database-backups.md`.

## Kalan riskler

Canlı migration ve salt okunur Prisma doğrulaması tamamlandı; gerçek oturumlu
tarayıcı uçtan uca testi henüz yapılmadı. Genel Ödemeler,
resmî e-belge entegrasyonu ve otomatik POS dönüştürmesi bu aşamaya dahil değil.
PDF deployment ortamında font paketlemesi ayrıca doğrulanmalı. npm audit taraması
mevcut Prisma/Uploadthing/ESLint ve alt bağımlılık zincirinde 13 high bulgu
bildirdi; pdf-lib/fontkit için bulgu yok. Kapsam dışı toplu veya kırıcı paket
güncellemesi yapılmadı. PostgreSQL test adapter'ı paralel okumalarda pg@9 öncesi
deprecation mesajı veriyor; testler başarılı, sürüm yükseltmesinde incelenmeli.

# Tedarikçiler Yönetimi — uygulama ve doğrulama

24 Ekim 2026: canlı geçiş tamamlandı. Liste `/dashboard/suppliers`, detay
`/dashboard/suppliers/:id`. Masaüstü Yönetim menüsünde ve mobil menüde
suppliers.read izniyle erişilir.

## Durum

Kullanıcının açık canlı geçiş onayıyla `20261023030000_add_suppliers`
Neon'a uygulandı. Migration öncesinde yeni yedek, gerçek localhost restore
ve gerçek veri kopyasında migration provası tekrarlandı. 23 tamamlanmış
migration; hedef SQL checksum'ı canlı kayıtla eşleşti. Eski iş tablolarının
satır sayıları ve içerik özetleri korundu; yeni tablolar boş, otomatik backfill yok.
Yeni ilişkiler uygulamanın Prisma istemcisiyle salt okunur transaction'da
okundu; fatura/ödeme/kasa/cari bütünlük sorgularında tutarsızlık bulunmadı.
Canlıya test kaydı yazılmadı; db push veya veri silme yapılmadı.

Kanıtlar: `docs/migrations/suppliers-preflight.json`,
`suppliers-verification.json`, `suppliers-live-readonly.json`.

## Sağlanan davranış

- Kod (boş bırakılırsa TED- önekiyle sunucuda üretilir), firma/unvan, yetkili,
  telefon, e-posta, web sitesi, adres, il/ilçe, vergi dairesi, 10/11 haneli
  vergi numarası/TCKN, notlar, aktiflik, oluşturulma tarihi.
- Telefon, e-posta, http/https web adresi ve vergi biçim kontrolü; profil kodu
  işletme içinde benzersiz. Oluşturma kalıcı idempotency anahtarı ve hash ile,
  düzenleme optimistic version kontrolüyle korunur.
- Carisiz profil, uygun mevcut SUPPLIER/BOTH carisi veya aynı transaction'da
  yeni SUPPLIER carisi. Cari başına tek tedarikçi profili; BOTH aynı zamanda
  Customer profiline bağlanabilir. Kurulmuş bağlantı değiştirilemez/koparılamaz.
- Dolu vergi kimliği çakışmasında ikinci cari açılması ortak kontrolle cari,
  müşteri ve tedarikçi oluşturma yollarında engellenir. Serializable predicate
  okuması ve mevcut P2034 retry eşzamanlı açılış yarışını korur; eski yinelenmiş
  cariler otomatik birleştirilmez. Kod çakışması DB unique ile de korunur.
  Vergi kimliği olmayan ve farklı bilgilerle girilmiş aynı firma kesin olarak
  saptanamaz; benzer profil/cari eşleşmeleri formda gösterilir.
- Tedarikçi–ürün/hammadde çoktan çoğa ilişkisi; isteğe bağlı tedarikçi ürün
  kodu ve referans son alış fiyatı. isSellable=false hammadde seçilebilir.
  Bağlama/düzenleme/kaldırma stok, kasa veya cari hareketi oluşturmaz.
- Genel Bilgiler, Ürünler, Alış Faturaları, Cari Hesap, Ödemeler, İstatistikler.
  Ürün, fatura, ödeme ve ana liste ayrı sayfalıdır. Arama ve aktiflik filtresi var.
- Bakiye CurrentAccountEntry üzerinden DEBIT eksi CREDIT; negatif bakiye
  işletmenin borcudur. İkinci bakiye alanı/tablosu/servisi eklenmedi.
- Faturalar bağlı carinin PURCHASE belgeleri; mevcut kesinleştirme tahakkuku,
  gider ilişkisi, ödeme tahsisi, iptal ve belge snapshot'ları korunur.
  Yeni faturada tedarikçi seçimi cari seçimini doldurur. Geçici supplierId
  sunucuda tenant/aktiflik/cari eşleşmesiyle doğrulanır; Invoice'a yazılmaz.
- Ödeme Yap mevcut merkezi PaymentsManager'ı açar. Seçili kapsamda açık
  fatura/gider varsa ilgili belge ve şube doldurulur; tutar ve kasa hesabı
  kullanıcı tarafından seçilir. Genel cari ödemesi açık fatura borcunu
  tahsissiz kapatamaz; mevcut mükerrer ödeme/avans koruması korunur.
- İstatistikler: yalnız ISSUED PURCHASE toplamı/son tarihi, aktif tahsisler,
  iptal edilmemiş dışa ödemeler, son ödeme tarihi ve hareketten açık cari borç.
  BOTH müşteri tahsilatları tedarikçi ödemesine katılmaz. İptal belgeler ve
  ödemeler geçmişte görünür; geçerli toplamlara girmez.
- Pasifleştirme geçmişi ve cari aktifliğini değiştirmez; borç ödenebilir.
  Tedarikçi silme API'si yoktur. Profil düzenlemek cari kartını veya kesin
  fatura snapshot'ını değiştirmez. Bağlı cari uygunsuz türe dönüştürülemez.

## Yetki ve kapsam

suppliers.read / suppliers.manage: OWNER, ADMIN, MANAGER; mevcut rol haritası
ve withPermission kullanılır. Cari bağlama/oluşturma, fiyat ve finans
payload'u ayrıca finance.manage gerektirir. Ödeme mevcut finance.manage ile
korunur; bu projede ayrı ödeme izni bulunmadığından yeni paralel izin modeli yoktur.

Profiller ve ürün ilişkileri organizationId kapsamındadır. Finansal listeler,
istatistikler ve bakiye branchScope ile daralır; şube filtresi erişimi
genişletemez. Finans izni yoksa API cari/istatistik/fiyat alanlarını göndermez.
Oluşturma ve düzenleme yanıtları da cari ID ve dahili istek hash/anahtarını gizler.
Yeni FK'ler supplier/product/currentAccount/profile ilişkilerinde tenant
eşleşmesini veritabanında da zorunlu kılar. Audit yazıları değişiklikle aynı
transaction'dadır; iletişim/not/vergi değerleri audit'e kopyalanmaz.

## Migration ve yedek

Migration: `prisma/migrations/20261023030000_add_suppliers/migration.sql`.
SHA-256: `92d2972c040b4ba22ae699b8583e775f025935ff4fad70cca833632e2156454e`.
Yalnız Supplier ve SupplierProduct boş tabloları, FK/index/CHECK eklenir.
Mevcut belgeler, ödemeler, cariler, siparişler veya stok kolonları değişmez.
SQL inceleme kopyası `docs/migrations/suppliers.sql`; ayrı çalıştırılmamalıdır.

Yeni yedek: `.backups/wellpos-before-suppliers-2026-10-23T22-00-50-191Z`.
37 tablo; 189382 bayt. Yedek SHA-256:
`d3c4b6e82d5f43668ba0cc169bb944ea2369264c35749e89a49bad5b8a7e6075`.
Salt okunur tutarlı snapshot; arşiv listesi/tam okuma PASS; ayrı localhost'a
gerçek restore, tüm tablo satır sayımları ve gerçek veri kopyasında migration
provası PASS. Geçici yerel sunucu durduruldu ve parola dosyası kaldırıldı.

Deployment script'i uygulama öncesinde iki saatten yeni yedek,
restore/prova, sabit SQL checksum, önceki migration checksum'ları ve yalnız
tek bekleyen migration koşullarını tekrar doğruladı. Gelecekte tekrar migration yapılacaksa yeni
yedek ve restore/prova gerekir. Uygulanmış SQL yeniden çalıştırılmamalıdır.

## Doğrulama

- `npx prisma validate --config prisma7.config.ts`: PASS.
- `npx prisma generate --config prisma7.config.ts`: PASS, Prisma 7.10.0.
- `npx tsc --noEmit`: PASS.
- Değişen TS/TSX ve CJS dosyaları için ESLint: PASS.
- `node --test tests/*.test.cjs`: 90 PASS, 10 DB entegrasyon testi bu komutta
  ortam değişkenleri verilmediğinden SKIP. Gerçek DB testleri aşağıdaki komutta.
- `node scripts/test-finance-local.cjs`: yeni localhost PostgreSQL'de bütün
  migration'lar, migration öncesi müşteri/ödeme uyumluluğu ve sonrasında
  POS/iade/checkout/cari/müşteri/gider/fatura/ödeme/tedarikçi paketi: 55 PASS.
  İstenen 16 tedarikçi senaryosu, iptaller, branch scope ve rollback dahil.
- Son ilavelerle `node scripts/test-finance-local.cjs --suppliers-only`: 22 PASS
  (21 alt senaryo + ana test); eşzamanlı tek cari sahipliği, üç cari oluşturma
  yolunda vergi kimliği kontrolü, seçili tedarikçinin seçeneklerde korunması,
  BOTH tahsilat ayrımı ve pasif tedarikçi borcunun özet kapsamı da doğrulandı.
- `npm run build`: PASS. İlk sandbox koşusu mevcut Google Fonts dosyalarını
  indiremedi; izinli ağ erişimiyle standart üretim derlemesi başarılı oldu.
- Gerçek bileşenlerin örnek verilerle statik render'ı üzerinden tarayıcıda
  masaüstü liste/ürün detayı ve 390px mobil detay görsel kontrolü: PASS.
  Bu kontrol, oturum açılmış tarayıcıyla etkileşimli uçtan uca test değildir.

Yerel prova kanıtı: `docs/migrations/suppliers-local-verification.json`.
Eski pg sürücüsünün paralel transaction sorgularına ilişkin deprecation uyarısı
testlerde görülebilir; test başarısızlığı değildir. pg@9 yükseltmesi bu işin kapsamında değildir.

## Değiştirilen / eklenen dosyalar

- `prisma/schema.prisma`, yukarıdaki migration ve `docs/migrations/suppliers.sql`.
- `src/lib/suppliers.ts`, `supplier-service.ts`, `supplier-read.ts`,
  `supplier-products.ts`, `account-identity.ts`, `permissions.ts`.
- `src/lib/customer-service.ts`, `current-accounts-service.ts`: ortak vergi
  kimliği kontrolü ve cari türü koruması; migration öncesi tablo varlık kontrolü.
- `src/lib/invoice-service.ts`: isteğe bağlı tedarikçi/cari doğrulaması.
- `src/app/api/suppliers/route.ts`, `options/route.ts`, `[id]/route.ts`,
  `[id]/account/route.ts`, `[id]/products/route.ts`,
  `[id]/products/[productId]/route.ts`.
- `src/app/dashboard/suppliers/page.tsx`, `layout.tsx`, `[id]/page.tsx`.
- `src/components/suppliers/shared.ts`, `SupplierForm.tsx`,
  `SuppliersManager.tsx`, `SupplierDetail.tsx`.
- `src/components/invoices/InvoiceForm.tsx`, `InvoicesManager.tsx`,
  `src/components/payments/PaymentsManager.tsx`.
- `src/components/dashboard/Sidebar.tsx`, `DashboardHeader.tsx`.
- `tests/suppliers.integration.test.cjs`, `scripts/test-finance-local.cjs`,
  `supplier-deployment-checks.cjs`, `deploy-suppliers-migration.cjs`,
  `verify-neon-backup.cjs`, `check-suppliers-live.cjs`.
- `docs/suppliers-design.md`, `docs/suppliers.md`, `docs/database-backups.md`
  ve yerel doğrulama raporu.

İlgisiz mevcut kullanıcı değişiklikleri geri alınmadı. Satın alma siparişi,
teklif, puanlama ve otomatik tedarik eklenmedi.

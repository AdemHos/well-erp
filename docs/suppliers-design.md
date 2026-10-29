# Tedarikçiler Yönetimi — onaylı MVP tasarımı

23 Ekim 2026. Kullanıcı tasarımı ve gerekli işlemleri onayladı. Yerel uygulama tamamlandı; 24 Ekim 2026
tarihinde açık canlı onayı, yeni yedek ve restore/prova sonrasında migration
Neon üzerinde uygulandı ve doğrulandı. Güncel durum: [suppliers.md](suppliers.md).
Hedef: 10 Kasım MVP.

## İncelenen mevcut mimari

- `prisma/schema.prisma`: Supplier ve ürün–tedarikçi ilişkisi yok.
  Customer işletme genelinde profil; nullable, benzersiz currentAccountId ile
  CurrentAccount'a bileşik tenant FK üzerinden bağlanıyor.
- CurrentAccount CUSTOMER / SUPPLIER / BOTH türlerini destekliyor. Bakiye
  CurrentAccountEntry DEBIT toplamı eksi CREDIT toplamı; negatif net işletmenin
  borcu. Şube erişimi toplam hesaplarında da uygulanıyor.
- `customer-service.ts`, `customer-read.ts`, `customers.ts`: profil, cari
  bağlama, Serializable yazma, sürüm kontrolü, idempotency ve audit örneği.
  Kurulmuş müşteri cari bağlantısı değiştirilemiyor.
- `invoice-service.ts`: PURCHASE faturası aktif SUPPLIER/BOTH carisine bağlı.
  Kesinleştirme mevcut gider tahakkukunu kullanıyor veya tek INVOICE/CREDIT
  oluşturuyor. Kesin belgede cari bilgileri snapshot olarak korunuyor.
- `payment-operations.ts`, `payment-service.ts`: tek merkezi ödeme işlemi;
  ödeme, kasa, cari ve varsa fatura tahsisi aynı transaction içinde.
  İptaller ters kayıtla korunuyor; tekrarlar idempotency anahtarıyla engelleniyor.
- Product, isSellable=false ile hammaddeyi de temsil ediyor. BranchStock ve
  StockMovement ayrı; ürün tedarik ilişkisi bu tablolara yazmamalı.
- Organization ortak kayıt havuzu; finans kayıtları Branch kapsamında.
  RBAC withPermission, branchScope ve branchIdScope üzerinden uygulanıyor.
  Mevcut ödeme/fatura yetkisi finance.manage; ayrı ödeme izni henüz yok.
- Dashboard Sidebar, CustomerForm/CustomersManager/CustomerDetail ve ortak
  finance-ui kartları/butonları responsive ekranlar için yeniden kullanılacak.

## Önerilen yeni tablolar

### Supplier

Alanlar: id, organizationId, code, name; nullable contactName, phone, email,
website, address, city, district, taxOffice, taxNumber, notes; isActive=true;
createdAt, updatedAt; nullable currentAccountId; version=1; idempotencyKey,
requestHash; createdByUserId ve nullable createdByProfileId.

Yalnız kod ve firma/unvan kullanıcıdan zorunlu. Kod normalize edilerek
unique(organizationId, code); ayrıca unique(id, organizationId) ve
unique(organizationId, idempotencyKey). Liste için organizationId/isActive ve
organizationId/name/id indeksleri.

currentAccountId benzersiz; (currentAccountId, organizationId) bileşik FK ile
CurrentAccount(id, organizationId)'a Restrict. Her cariye en fazla bir Supplier
profili. BOTH carisi aynı anda bir Customer ve bir Supplier profiline bağlanabilir.
Supplier üzerinde bakiye, borç veya ödenen toplam alanı yok.

Organization, CurrentAccount, User ve StaffProfile'a gereken ters ilişkiler
eklenecek. Kullanıcı/profil ilişkileri Customer örneğindeki tenant kurallarını
izleyecek. Silme endpoint'i sunulmayacak; kullanıcı pasifleştirecek.

### SupplierProduct

Alanlar: id, organizationId, supplierId, productId; nullable supplierProductCode;
nullable lastPurchasePrice Decimal(12,2); createdAt, updatedAt; version=1.
lastPurchasePrice negatif olamaz, fiyat girilmesi zorunlu değildir. Bu alan MVP'de
kullanıcının beyan ettiği referans fiyattır; fatura kesinleştirme bu alanı sessizce
değiştirmez.

unique(organizationId, supplierId, productId); organizationId/productId indeksi.
(supplierId, organizationId) ve (productId, organizationId) bileşik FK'ler,
onDelete Restrict. Organization ters ilişkisi eklenir. branchId bulunmaz;
aynı işletmenin şubeleri ortak tedarik havuzunu kullanır.
isSellable filtresi uygulanmaz; hammadde ve satış ürünü bağlanabilir.
Bağlama/düzenleme/bağ kaldırma yalnız ilişkiyi değiştirir; stok veya finans
hareketi oluşturmaz. Son alış fiyatı finance.manage olmadan okunamaz/yazılamaz.

## Cari kimliği ve mükerrer önleme

Üç açık seçenek: carisiz profil, mevcut SUPPLIER/BOTH carisi, yeni SUPPLIER carisi.
Cari işlemi ayrıca finance.manage gerektirir. Yeni cari/profil/audit aynı
Serializable transaction içinde oluşturulur; başarısızlık tümünü geri alır.

Aynı cari kodu veya normalize edilmiş dolu vergi numarasıyla yeni cari açılması
engellenip mevcut kartı seçme yolu gösterilir. Vergi kimliği kontrolü mevcut
carilerde de yapılır; tüm cari oluşturma yolları ortak kontrolü kullanmalıdır.
Eşzamanlı aynı kimlik için Serializable predicate okuması ve mevcut retry kullanılır.
Eski yinelenmiş cariler otomatik birleştirilmez; seçim kullanıcıya bırakılır.
Ad/telefon/e-posta benzerlikleri olası eşleşme gösterir; tek başına kimlik kanıtı
sayılmaz. Vergi kimliği olmayan, farklı bilgilerle girilen aynı firmanın kesin
olarak saptanamayacağı arayüzde açıkça belirtilir.

Mevcut CUSTOMER carisi uygun firmaysa finans ekranında açıkça BOTH yapılır;
tedarikçi oluşturma müşteri carisini sessizce dönüştürmez. Bağlı carinin türünü
Supplier varken CUSTOMER'a, Customer varken SUPPLIER'a dönüştürmek API'de engellenir.
Kurulmuş bağlantı MVP'de değiştirilemez/koparılamaz. Carisiz profile sonradan
uygun cari bağlanabilir. Profil düzenlemek cari kartını veya kesin belge
snapshot'ını değiştirmez. Pasifleştirme cariyi pasifleştirmez; borç ödenebilir.

## Fatura ve ödeme entegrasyonu

Invoice ve Payment'a ikinci supplierId eklenmez. Tedarikçi geçmişi açıkça
bağlanmış currentAccountId üzerinden okunur; bu carinin önceki alış faturaları
ve ödemeleri de görünür. Ad/telefon benzerliğinden geçmiş ataması yapılmaz.
Fatura oluşturma ekranında aktif tedarikçi seçimi uygun cari seçimini doldurur;
carisiz tedarikçi için önce cari bağlama gerekir. Sunucu tenant/tür/aktiflik
kontrollerini mevcut fatura servisinde sürdürür. Yeni tahakkuk servisi yoktur.

Ödeme Yap merkezi PaymentsManager akışını cari ve ödeme türüyle açar. Mevcut
API, ödeme yetkisi olan finance.manage kullanıcıları için kullanılır.
Fatura ödemesi fatura tahsisiyle; genel cari ödemesi cari üzerinden ilerler.
Geçerli tutarlar Decimal ile hesaplanır, float toplamı kullanılmaz.

Toplam kesin alış = yetkili/seçili şubelerde ISSUED PURCHASE grandTotal toplamı.
Faturalara ödenen = bu faturaların iptal edilmemiş ödeme tahsisleri toplamı.
Yapılan toplam ödeme ve son ödeme tarihi = bağlı carinin iptal edilmemiş dışa
ödemeleri; müşteri tahsilatları BOTH hesabında bu toplama girmez. Gider ödemeleri
de merkezi Payment kaydından bir kez sayılır. Bu iki ödeme toplamı farklı
anlam taşıdığı için ayrı etiketlenir; toplanarak tekrar sayılmaz.
Açık cari borç = max(0, -net cari bakiye); fatura kalanıyla aynı olduğu varsayılmaz.
Son alış tarihi aynı ISSUED PURCHASE kapsamından gelir. İptaller geçmişte
durumuyla görünür; istatistik toplamlarına katılmaz. Cari bakiye ters kayıtları
da kapsayan mevcut hareketlerden hesaplanır.

## Ekran, API ve yetki

`/dashboard/suppliers`: toplam/aktif/borç kartları, arama, aktiflik filtresi,
sayfalama, oluşturma/düzenleme ve detay. Borç kartı pasif profillerin borcunu da
kapsar; her cari yalnız bir kez sayılır. Üst kartların filtre kapsamı açıklanır.
`/dashboard/suppliers/:id`: Genel Bilgiler, Ürünler, Alış Faturaları,
Cari Hesap, Ödemeler, İstatistikler sekmeleri. Geçmiş listeleri sayfalı olacak.

API: `/api/suppliers` GET/POST; `/:id` GET/PATCH;
`/:id/account` POST; `/:id/products` GET/POST;
`/:id/products/:productId` PATCH/DELETE; `/options` GET.
DELETE yalnız ürün ilişkisinin kaldırılmasıdır; tedarikçi silinmez.

suppliers.read ve suppliers.manage mevcut Permission/rol sistemine eklenir;
Customer gibi OWNER/ADMIN/MANAGER alır. Finans payload'u, istatistikler, son
alış fiyatı ve cari seçimi ayrıca finance.manage gerektirir. Finans verisi
yetkisiz API cevabında bulunmaz. Ödemeyi mevcut finance.manage korur.
Tüm profil/ilişki sorgularında organizationId; tüm fatura/ödeme/bakiye
sorgularında ayrıca branchScope. Seçilen branchId erişimi sunucuda doğrulanır.
Origin, aktif üyelik, stale version, idempotency ve audit mevcut altyapıyla.
Audit'e kişisel alanların değerleri değil değişen alan adları ve kayıt ID yazılır.

Telefon uzunluk/karakter/rakam sayısı, e-posta biçim/uzunluk, website yalnız
http/https, vergi numarası/TCKN 10/11 hane olarak doğrulanır. Boş alanlar null.

## Mevcut verilere etki ve migration sınırı

İki yeni boş tablo ve indeks/FK/CHECK eklenir. Mevcut Invoice, Payment, Order,
CurrentAccountEntry, StockMovement ve BranchStock kolonları değişmez.
Eski carilerden otomatik profil/ürün ilişkisi üretilmez; veri silme, bakiye
taşıma veya backfill yoktur. Ters Prisma ilişkileri mevcut tablolara kolon eklemez.
Mevcut cari mükerrerleri için otomatik temizlik/unique vergi kısıtı önerilmez.

Bu tasarım onaylanmadan schema.prisma veya migration SQL hazırlanmayacak.
Onaydan sonra yerel şema/API/UI/testler geliştirilecek. Canlı migration öncesi
yeni before-suppliers Neon yedeği alınması istenecek; gerçek yerel restore,
veri kopyasında migration provası ve açık canlı uygulama onayı beklenecek.
Şema hazır değilken tedarikçi özelliği açıklayıcı SCHEMA_PENDING yanıtı vermeli;
mevcut finans/POS servisleri yeni tabloyu zorunlu olarak sorgulamamalı.

## Doğrulama planı

Kullanıcının 16 senaryosu localhost PostgreSQL'de; ayrıca aynı cariye eşzamanlı
profil bağlama, aynı vergi kimliğiyle eşzamanlı cari açma, rollback, BOTH tahsilat
ayrımı, iptal istatistikleri, şube izolasyonu, snapshot korunması, cari tür
değişikliği koruması ve migration öncesi eski modül uyumluluğu sınanacak.
Neon'a test verisi yazılmayacak. TypeScript, ilgili ESLint ve mevcut cari,
fatura, ödeme, stok/POS, müşteri ve RBAC regresyonları çalıştırılacak.

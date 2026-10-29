# Müşteriler — MVP uygulama ve teslim raporu

Yerel model/ilişki tasarımı kullanıcı tarafından onaylandı. Yönetim > Müşteriler
(`/dashboard/customers`), profil sayfası ve POS müşteri seçimi geliştirildi.
23 Ekim 2026 tarihinde kullanıcının canlı geçiş onayıyla, yeni yedek ve gerçek
geri yükleme/migration provası sonrasında müşteri migration'ı Neon'a uygulandı.

## Kullanım ve kayıt sahipliği

Müşteri formunda kod manuel girilmez veya değiştirilmez. Yeni kayıt kodu sunucuda
`MUS-` ve 16 büyük onaltılık karakter olarak oluşturulur; işletme/kod benzersizlik
kısıtı korunur. Aynı idempotency anahtarıyla tekrar gönderim aynı kaydı ve kodu
döndürür. Eski API istemcilerinin açık kod gönderimi ve geçmiş istek hash'leri
uyumluluk için korunur. Mevcut kodlar değiştirilmez; şema değişikliği gerekmez.
Mevcut cariyi seçmek cari kodunu müşteri profiline kopyalamaz. Yeni cari birlikte
açılırsa otomatik müşteri kodu başlangıç cari kodu olarak kullanılır.

İleride müşteri bazlı kampanya önerileri için müşteriye açıkça bağlanmış sipariş
ve kalem geçmişi, net harcama, sıklık ve iade bilgileri kullanılabilir. Bu aşamada
AI/kampanya otomasyonu eklenmedi ve müşterisiz satışlara kimlik tahmini yapılmaz.

- Bireysel/kurumsal müşteri ekleme, düzenleme, pasifleştirme; işletme kapsamında
  benzersiz büyük harfli müşteri kodu. Telefon/e-posta/adres/il/ilçe/notlar ve
  kurumsal vergi bilgileri isteğe bağlıdır.
- Liste: toplam/aktif/bireysel/kurumsal sayıları, ad/kod/telefon/e-posta araması,
  tür/aktiflik filtresi, sayfalama, düzenleme ve profil bağlantıları.
- Profil: genel bilgiler, şube/tarih filtreli satış geçmişi ve özetler,
  yetkili kullanıcı için cari bakiye/ekstre ve satış faturaları.
- Cari açmadan müşteri oluşturulabilir. Mevcut CUSTOMER/BOTH carisi açık
  seçimle bağlanabilir veya müşteriyle birlikte yeni cari atomik oluşturulabilir.
- Bir cari yalnız bir müşteri profiline bağlanır. Bağlantı MVP'de değiştirilemez
  veya koparılamaz. Aynı kod başka bir cariye aitse yanlış bağlantı reddedilir.
- Benzer kayıtlar ve mevcut cariler oluşturma formunda aranır/gösterilir;
  isim/telefon benzerliğinden otomatik birleştirme yapılmaz. Ortak telefon veya
  e-posta benzersiz kimlik değildir. Mevcut müşteri carileri topluca kopyalanmaz.
- Profil iletişim bilgileri ile muhasebe/hukuki kart birbirinin alanlarını
  otomatik ezmez. Yeni cariye yalnız başlangıçta bir kez bilgi yazılır. Mevcut
  cariye bağlama, muhasebe kartını değiştirmez. İkinci bakiye alanı yoktur.
- Müşteri pasifleştirilince cari hesabı kapatılmaz; açık alacak tahsilatı devam
  eder. Satış/fatura geçmişi görünür kalır. DELETE endpoint'i yoktur.
- UI mevcut mavi/pastel kart, hafif border, buton ve ikon sistemini kullanır.

## POS ve tarihsel belge koruması

POS'ta aktif müşteri ad/kod/telefonla aranıp seçilebilir; seçim zorunlu değildir.
Telefon araması rakamları normalize ederek boşluk/parantez/tire farklarını da
karşılar. Kasiyer arama cevabında yalnız id/name/code alır; iletişim, vergi,
notlar, bakiye ve fatura bilgileri verilmez.

Seçilen müşteri satış transaction'ında aynı işletmede aktif olarak doğrulanır;
satış tamamlanana kadar müşteri satırında paylaşım kilidi tutulur. Sunucu
customerId ve ad/kod/tür snapshot'ını kaydeder; istemci snapshot gönderemez.
Müşteri seçimi fiyatı, iskontoyu, stok miktarını, ödeme hesabını veya mevcut
tek POS_SALE kasa girişini değiştirmez. Yeni cari hareketi, Payment veya fatura
oluşturmaz. Restoran checkout mevcut müşterisiz akışını sürdürür.

Termal fişte müşteri adını/kodunu gösterme ayrı seçimdir ve varsayılan kapalıdır.
Gösterildiğinde güncel profilden değil satış anındaki snapshot'tan okunur.
Profil güncellense de eski fiş ve kesin fatura alıcı snapshot'ları değişmez.
Eski siparişlerin müşteri alanları null kalır. Geriye dönük isim/telefon/tutar
eşleştirmesi veya sipariş müşterisini değiştiren endpoint yapılmadı.

## Bakiye, faturalar ve istatistikler

Cari bakiye mevcut CurrentAccountEntry hareketlerinden DEBIT−CREDIT olarak,
yalnız yetkili/seçili şubelerde hesaplanır. Bu güncel bakiye tarih aralığıyla
kesilmez; UI bunu açıklar. Faturalar bağlı currentAccountId üzerinden SALES
türüyle ve yetkili/seçili şubelerle filtrelenir. Ödenen/kalan/ödeme durumu mevcut
aktif Payment tahsislerinden hesaplanır. Taslak ve iptal durumları ayrıdır.

POS istatistikleri aynı şube/tarih kapsamındaki COMPLETED siparişler üzerinden:

- Alışveriş sayısı: kayıt adedi.
- Net harcama: kayıtlı Order.total toplamı.
- Ortalama sepet: aynı toplam / aynı adet; sıfır adet için 0.
- Son alışveriş: aynı geçerli kayıtların en yeni tarihi.

Mevcut tam iade Order.status=REFUNDED akışını kullanır. REFUNDED/CANCELLED
geçmişte orijinal tutar ve sıfır net etkiyle görünür; geçerli adet/harcama/
ortalama/son alışverişe girmez. Faturalar POS harcamasına eklenerek aynı satış
ikinci kez sayılmaz. İstatistikler POS alışveriş istatistikleri olarak etiketlidir.

## Yetki, izolasyon ve tekrar güvenliği

| Yetki | Erişim |
| --- | --- |
| customers.read / customers.manage | OWNER, ADMIN, MANAGER |
| customers.lookup | OWNER, ADMIN, MANAGER, CASHIER |
| finance.manage | Cari bağlama/açma, cari bakiye ve fatura payload'u için ayrıca gerekir |
| orders.read | Satış geçmişi, istatistik ve satış detayı için ayrıca gerekir |

Mevcut withPermission, aktif personel oturumu, origin ve organization/branch
kontrolleri kullanılır. Profil havuzu işletme genelinde ortaktır; finans ve
satış sorguları branchScope ile daralır. Yetkisiz şube toplamı da gösterilmez.
Finans izni yoksa cari bağlantısı/bakiye/faturalar profil API cevabında bulunmaz.
Yeni müşteri-satış FK'si ve cari FK'si işletme kapsamını DB'de de korur.

Oluşturmada organization+idempotencyKey unique ve requestHash, aynı anahtarın
tekrarını tek kayda indirger; farklı içerik 409'dur. Müşteri, isteğe bağlı cari
ve audit aynı Serializable transaction'dadır; sınırlı P2034 retry kullanılır.
Cari unique bağlantısı eşzamanlı iki profile bağlamayı engeller. Güncelleme ve
bağlama expectedVersion ister. Yanlış sürüm 409 verir.

İstemci sonucu belirsiz oluşturmayı aynı anahtarla doğrular. Bekleyen istek
işletme ID'sine göre saklanır ve expectedOrganizationId ile sunucuda kontrol
edilir; işletme değişince eski kayıt başka işletmeye yazılamaz. Eski gider
pending istek anahtarları ve endpoint'leri değiştirilmedi.

Audit yalnız işlem/kimlik/değişen alan adları/sürüm/aktiflik gibi metadata
yazar. Müşteri adı/telefon/e-posta/adres/not/vergi bilgileri veya bütün istek
gövdesi loglanmaz. Hata loglarında hata sınıfı kullanılır.

## API

| Endpoint | Görev |
| --- | --- |
| GET /api/customers | Liste, filtreler, sayfalama ve işletme müşteri sayıları |
| POST /api/customers | Müşteri ve isteğe bağlı cari oluşturma |
| GET /api/customers/:id | Profil, yetkiye göre geçmiş/istatistik/cari/faturalar |
| PATCH /api/customers/:id | Alan düzenleme ve aktif/pasif geçişi |
| POST /api/customers/:id/account | İlk cari bağlantısı; mevcut bağ değiştirilemez |
| GET /api/customers/lookup | POS için dar aktif müşteri araması |
| GET /api/customers/options | Finans yetkilisine uygun boşta cariler ve benzer profiller |
| GET /api/customers/:id/orders/:orderId | Müşteri ve yetkili şube kapsamlı satış/fiş detayı |

Liste parametreleri: q, type, active (all/true/false), page, limit (1–100).
Profil parametreleri: branchId, startDate, endDate, salesPage, invoicePage.
Geçmişler 20'şer kayıtla bağımsız sayfalanır. Tarihler Europe/Istanbul gün
sınırlarıyla işlenir. Liste üst sayıları işletme genelidir; filtreli liste
adedi pagination.total'dadır ve UI bu ayrımı açıklar.

Oluşturma gövdesi: type, code, name ve isteğe bağlı iletişim/vergi/not/aktiflik
alanları; accountMode (none/existing/create), currentAccountId (yalnız existing),
idempotencyKey; istemci bağlam kontrolü için expectedOrganizationId.
Güncellemede expectedVersion zorunlu; currentAccountId doğrudan PATCH edilemez.
İsteğe bağlı vergi numarası kurumsal müşteri için 10 rakamdır; birey için TCKN
toplanmaz. Telefon 7–15 rakam ve izinli telefon karakterleriyle doğrulanır.

## Şema ve migration

SQL: `prisma/migrations/20261023020000_add_customers/migration.sql`.
İnceleme kopyası: `docs/migrations/customers.sql`.

- Yeni CustomerType ve Customer profili; tenant-kod, tenant-istek ve tek cari
  unique kısıtları; organization/user/profile/current account FK'leri.
- Order'a nullable customerId ve customerSnapshot; tenant kapsamlı müşteri FK'si
  ve geçmiş indeksleri. Snapshot kimlik/şekil ve müşteri kodu/vergi/sürüm CHECK'leri.
- Mevcut cari/sipariş/fatura/ödeme kimlikleri, tutarlar ve hareketler korunur.
  Müşteriler otomatik backfill edilmez; eski siparişler müşterisiz kalır.
- SQL BEGIN/COMMIT içinde atomiktir. Order kolon/FK/indeks taramaları tablo kilidi
  alabilir; canlı büyüklükte süre ölçülmedi. Yeni yedek ve bakım aralığı gerekir.

Migration öncesi POS müşterisiz satış, satış liste/detay/fiş, iade ve restoran
checkout yeni kolonları Prisma'da omit eder. Okumalar şema hazır olduğunda
snapshot alanlarını seçer. Yeni müşteri endpoint'leri şema yoksa 503
SCHEMA_PENDING verir; eski çalışan satış/finans modülleri korunur.

Yerel gerçek PostgreSQL provasında tüm mevcut iş tablolarının satır sayıları
ve özgün kolon içerik özetleri karşılaştırıldı. Eski Order fixture'ının müşteri
alanlarının null kaldığı ve Customer tablosunun boş başladığı doğrulandı.
Kanıt: `docs/migrations/customers-local-verification.json`.

## Değişen dosyalar

- `prisma/schema.prisma`, `prisma/migrations/20261023020000_add_customers/migration.sql`,
  `docs/migrations/customers.sql`.
- `src/lib/customers.ts`, `customer-schema.ts`, `customer-service.ts`, `customer-read.ts`.
- `src/lib/permissions.ts`, `src/lib/current-accounts-service.ts`.
- `src/app/api/customers/route.ts`, `lookup/route.ts`, `options/route.ts`,
  `[id]/route.ts`, `[id]/account/route.ts`, `[id]/orders/[orderId]/route.ts`.
- `src/app/api/orders/route.ts`, `orders/[id]/route.ts`, `orders/[id]/refund/route.ts`,
  `src/app/api/restaurant/tabs/[id]/checkout/route.ts`.
- `src/app/dashboard/customers/layout.tsx`, `page.tsx`, `[id]/page.tsx`.
- `src/components/customers/shared.ts`, `CustomerForm.tsx`, `CustomersManager.tsx`,
  `CustomerDetail.tsx`.
- `src/components/pos/CustomerPicker.tsx`, `POSManager.tsx`, `SaleReceipt.tsx`.
- `src/components/dashboard/Sidebar.tsx`, `src/components/expenses/shared.tsx`
  (mevcut mutation hook'una isteğe bağlı işletme kapsamı).
- `tests/customers.integration.test.cjs`, `checkout-schema-compatibility.test.cjs`,
  `order-refunds.test.cjs`, `invoices.integration.test.cjs`,
  `pos-finance.integration.test.cjs`, `rbac.test.cjs`.
- `scripts/test-finance-local.cjs`, `scripts/customer-migration-fixture.cjs`.
- `docs/customers-design.md`, bu rapor ve yerel doğrulama JSON'u.
- Yerel Prisma istemcisi yeniden üretildi; üretilen dosyalar mevcut Git ignore
  politikasına tabidir.

## Doğrulama sonuçları

- Mevcut genel birim/çevrimdışı tur: 89 başarılı, 0 başarısız; o komuttaki
  isteğe bağlı DB testleri atlandı, ilgili DB testleri ayrıca localhost'ta koşuldu.
- `node scripts/test-finance-local.cjs`: 34 başarılı, 0 başarısız, 0 atlanan.
  Kullanıcının 15 müşteri senaryosu ile mevcut Cari/Gider/Fatura/Ödeme/POS/iade
  ve restoran checkout regresyonlarını kapsar.
- Son kimlik/işletme bağlamı kontrolleri sonrası `--customers-only`: 18 başarılı,
  0 başarısız, 0 atlanan. 15 senaryo + ek idempotency/race/rollback/privacy grubu
  ve checkout testi çalıştı.
- Yeni şema öncesi gerçek POS/iade, fatura ve checkout uyumluluk testleri başarılı.
- Son RBAC, sipariş iadesi ve POS fiş birim testi turu: 26 başarılı,
  0 başarısız, 0 atlanan.
- Otomatik kod değişikliği sonrası `--customers-only`: 19 başarılı, 0 başarısız,
  0 atlanan; eşzamanlı kod üretimi, idempotent tekrar ve cari bağlantısı dahil.
- Yerel tarihsel kayıt koruması, boş Customer başlangıcı ve yeni FK/CHECK'ler başarılı.
- TypeScript, Next route typegen ve Prisma şema doğrulaması başarılı.
- Değişen müşteri/API/şema uyum/test dosyalarında ESLint hatası yok. POSManager'da
  önceden bulunan ürün `<img>` kullanımı uyarısı bu görev kapsamında değiştirilmedi.

## Canlıya geçiş ve açık sınırlar

Canlı migration kullanıcı onayıyla uygulandı. Yeni before-customers yedeği
alındı, ayrı localhost PostgreSQL'e geri yüklendi ve müşteri migration'ı gerçek
veri kopyasında prova edildi. 36 eski tablonun satır sayıları ve iş verisi içerik
özetleri korundu. Canlıda 22 tamamlanmış migration, yeni FK/CHECK/indeksler,
eski siparişlerde boş müşteri alanları ve otomatik müşteri backfill'i yapılmadığı
doğrulandı. Canlıya test müşterisi, test satışı veya finans hareketi yazılmadı.
db push/reset/veri silme yapılmadı.

Kanıtlar: [ön kontrol](migrations/customers-preflight.json),
[migration doğrulaması](migrations/customers-verification.json),
[Prisma salt okunur kontrolü](migrations/customers-live-readonly.json).
Prisma müşteri/cari/sipariş ilişkileri ve mevcut finans tutarlılığı kontrolü
başarılı. Mevcut canlı ödeme sayısı sıfır olduğundan ödeme bağlantılarının
dolu kayıt davranışı yerel entegrasyon testleriyle doğrulandı. Salt okunur
istemci turunda mevcut pg SSL modu ve eşzamanlı sorgu deprecation uyarıları
görüldü; komut başarılı, bağlantı doğrulaması mevcut sürümde verify-full.

Production build ve oturumlu tarayıcı görsel/etkileşim kontrolü yapılmadı;
arayüz TypeScript ve mevcut ortak tasarım sistemiyle kontrol edildi.

MVP'de otomatik kişi birleştirme, geçmiş satış atama, cari bağlantısını taşıma,
sadakat/kampanya/SMS veya gelişmiş CRM yoktur. Benzer kayıtlar otomatik kimlik
kanıtı sayılmaz. Kurumsal e-posta/telefon paylaşımı nedeniyle bu alanlarda
benzersizlik kısıtı uygulanmaz; operatör mevcut profil/cariyi açıkça seçmelidir.

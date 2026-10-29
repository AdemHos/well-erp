# Faturalar — onaylanan şema ve entegrasyon tasarımı

Kullanıcı yerel şema/API/UI/PDF/test geliştirmesini onayladı. Yerel uygulama ve
migration SQL hazırlandı; sonuçlar `invoices.md` belgesinde. Yerel onaydan sonra
ayrı yedek onayıyla güncel yedek geri yüklenerek doğrulandı. Ardından verilen ayrı
canlı migration onayıyla fatura migration'ı Neon'a uygulandı ve eski verilerin
korunduğu doğrulandı. Aşağıdaki plan tasarımın onaylandığı sıradaki sıralamadır.

## İnceleme sonucu

- Invoice veya benzeri fatura/kalem modeli yok. Menüde `/dashboard/invoices`
  hazırlık bağlantısı bulunuyor; çalışan ekran/API yok.
- Product ve Order/OrderItem içinde KDV oranı veya vergi dahil/hariç fiyat
  bilgisi yok. POS kaydından KDV oranı tahmin edilemez. Ürün ve satış tutarları
  değiştirilmeden faturada kullanıcıdan açık vergi seçimi alınmalı.
- CurrentAccountEntry yönü DEBIT − CREDIT: alış CREDIT, satış DEBIT oluşturur.
  INVOICE, PAYMENT, COLLECTION ve REVERSAL türleri mevcut.
- Expense mevcutta kendi CREDIT tahakkukunu üretir. ExpensePayment tek bir
  FinanceTransaction OUT'a, varsa tek bir cari PAYMENT/DEBIT kaydına bağlıdır.
  Aynı borç ve kasa çıkışını yeniden oluşturmadan bu kayıtlar benimsenmelidir.
- Order tamamlanmış POS satışıdır; POS_SALE finans kaydı ve stok düşümü zaten
  yapılmıştır. POS iadesi de kendi stok/finans transaction'ına sahiptir.
- finance.manage yetkisi, işletme/şube kapsamları, audit ve Serializable
  tekrar altyapısı korunacak. Yeni rol veya daha geniş yetki verilmeyecek.

## Önerilen yeni modeller

### Invoice

- `id`, `organizationId`, `branchId`, `currentAccountId`.
- `type`: PURCHASE / SALES. Alışta SUPPLIER/BOTH, satışta CUSTOMER/BOTH.
- `status`: DRAFT / ISSUED / CANCELLED; `version` ile eski form/yazma kontrolü.
- `number`: kullanıcının girdiği belge/fatura referansı; `numberKey`: normalize
  benzersizlik anahtarı. Sistem bu numarayı resmî e-belge numarası olarak sunmaz.
- `invoiceDate`, isteğe bağlı `dueDate`, TRY `currency`, `description`.
- `priceMode`: TAX_EXCLUSIVE / TAX_INCLUSIVE. Kullanıcı açıkça seçer.
- Genel iskonto türü/değeri; hesaplanan satır iskontosu toplamı, genel iskonto
  tutarı, vergi matrahı/net ara toplam, vergi toplamı ve genel toplam.
- İsteğe bağlı benzersiz `expenseId`: aynı işletme/şubedeki bir giderle bağlantı.
- İsteğe bağlı benzersiz `orderId`: gelecekteki POS köprüsü için aynı işletme/şube
  siparişine bağlantı. Aynı sipariş ikinci faturaya bağlanamaz; iptal edilmesi de
  bağlantıyı sessizce serbest bırakmaz.
- İsteğe bağlı benzersiz `accrualEntryId`, `reversalEntryId`: mevcut veya yeni
  CurrentAccountEntry kayıtlarına aynı işletme/şubeden bağlantı.
- `idempotencyKey`, `requestHash`; oluşturma tekrarlarına karşı işletme bazlı unique.
- `createdAt`, `updatedAt`, `issuedAt`, `cancelledAt`, oluşturucu/işlemi yapan
  gerçek kullanıcı ve isteğe bağlı aktif personel profili, iptal gerekçesi.
- Kesinleştirmede gerçek işletme/şube adı, cari unvanı, iletişim, adres ve mevcut
  vergi bilgilerinin anlık görüntüsü. Olmayan satıcı/vergi bilgileri uydurulmaz.
- Kalemler ve ödeme tahsisleri; `(id, organizationId, branchId)` unique anahtarı,
  işletme/şube/tarih/durum/vade indeksleri.

### InvoiceItem

- `id`, `invoiceId`, `organizationId`, `branchId`, kararlı `position`.
- İsteğe bağlı `productId`: aynı işletmenin ürünü. Serbest hizmet satırında null.
- Açıklama, birim bilgisi ve katalog açıklamasının anlık görüntüsü.
- Miktar Decimal(14,3); birim fiyat Decimal(18,4).
- Satır iskonto türü/değeri ve hesaplanan iskonto tutarı.
- Kullanıcının açık seçtiği KDV oranı Decimal(5,2), 0–100; varsayılan oran yok.
- Genel iskontodan ayrılan pay, net tutar, KDV tutarı ve brüt satır toplamı.
- Hesaplanan parasal toplamlar Decimal(14,2). Invoice ile işletme/şube bileşik
  FK, ürünle işletme doğrulaması; tarihsel ürün bağlantısı silme Restrict ile korunur.

### InvoicePaymentAllocation

Yeni bir ödeme/finans hareketi değildir; mevcut ödemenin faturaya tahsisidir.

- `id`, `organizationId`, `branchId`, `invoiceId`, `paymentId`, pozitif Decimal tutar,
  `createdAt` ve oluşturan kullanıcı.
- `(invoiceId, paymentId)` unique; aynı ödeme aynı faturaya iki kez eklenmez.
- Aynı işletme/şubede gerçek Invoice ve ortak Payment kayıtlarına bileşik FK.
- Faturaya tahsisler toplamı genel toplamı; bir ödemeden yapılan bütün tahsisler
  toplamı ödeme tutarını aşamaz. Yön ve cari uyumu transaction içinde doğrulanır.
- Bu yapı bir faturaya birden fazla ödeme ve ileride bir ödemenin uygun birden
  fazla faturaya dağıtılması için hazırlanır. Tahsis eklemek kasa/cari yazmaz.

## Mevcut ödeme altyapısını ortaklaştırma

İkinci bağımsız InvoicePayment sistemi oluşturulmayacak. Prisma'daki mevcut
ExpensePayment modeli ortak **Payment** adına taşınıp `@@map("ExpensePayment")`
ile aynı fiziksel tabloya bağlanacak. Tablo, kimlikler, tutarlar, finans/cari
bağlantıları ve mevcut ödeme geçmişi korunacak; veri kopyalanmayacak.

`expenseId` ve ilişkisi isteğe bağlı olacak. Mevcut satırlar aynı gider bağlantısı
ile kalır. Kasa yönü bağlı FinanceTransaction.direction üzerinden okunur; ikinci
değiştirilebilir yön/bakiye alanı tutulmaz. financeTransactionId benzersizliği
ve ödeme idempotency kontrolleri korunur. Gider ödeme endpoint'i ve UI adresleri
aynı kalır; iç ödeme oluşturma/hesap/bakiye/audit mantığı ortak servise alınır.
Fatura tahsisleri de bu servisin aynı transaction'ına eklenebilir.

Bu aşamada genel Ödemeler menüsü veya bağımsız tahsilat dağıtım ekranı açılmaz.
Bağımsız faturaların yeni tahsilat/ödeme işlemleri sonraki aşamadadır. Fatura
altyapısı kısmi ödemeyi destekler; mevcut gider ödeme kayıtları bağlı faturaya
gerçek tahsislerle yansır. Faturanın ödeme durumu istemciden serbestçe yazılmaz.

## Numara benzersizliği

- SALES: `(organizationId, numberKey)` satış belgeleri arasında unique.
- PURCHASE: `(organizationId, currentAccountId, numberKey)` alış belgeleri
  arasında unique. İki farklı tedarikçinin aynı dış numarayı kullanması engellenmez.
- İki kural type koşullu kısmi unique indekslerle veritabanında korunur; şube
  değiştirmek numara çakışmasını aşamaz. Taslaklar ve iptaller de numarayı tutar.
- numberKey boşluk/kontrol karakteri ve Unicode normalizasyon kurallarıyla
  sunucuda üretilir; gösterilen özgün referans ayrıca korunur. Veritabanı unique
  kısıtı eşzamanlı iki isteği de korur.
- Bu MVP, GİB numaralama/seri tahsis etmez; resmî numara üreticisi eklenmez.

## Decimal, KDV ve iskonto hesaplama sözleşmesi

Bu bölüm uygulamanın hesaplama kuralıdır; yasal KDV oranı önerisi değildir.

1. Miktar > 0, birim fiyat >= 0; yüzde iskontolar 0–100 arasında, sabit iskonto
   uygulanacağı tabanı aşmayacak. Kesinleştirme için genel toplam > 0.
2. Bütün çarpma/bölme Decimal ile yapılır. Parasal yuvarlama 2 haneye HALF_UP;
   miktar en fazla 3, birim fiyat en fazla 4 ondalık. Sınır aşımı sunucuda reddedilir.
3. Satırın miktar × fiyat tutarı, seçilen fiyat modunda kuruşa yuvarlanır.
   Satır iskontosu bu tutardan uygulanır. Genel iskonto, satır iskontolarından
   sonraki toplam üzerinden hesaplanır.
4. Genel iskonto kuruş cinsinden satırlara oransal dağıtılır. Kalan kuruşlar en
   büyük küsurat, eşitlikte position sırasıyla dağıtılır; payların toplamı genel
   iskontoya tam eşit olur. Negatif satır oluşmaz.
5. Vergi hariç modda iskonto sonrası netten satır KDV'si hesaplanıp yuvarlanır;
   brüt = net + KDV. Vergi dahil modda iskonto sonrası brütten net tutar ayrılır;
   net = brüt / (1 + oran/100), KDV = brüt − yuvarlanmış net.
6. Fatura net/KDV/brüt toplamları yuvarlanmış satırların toplamıdır. Ara toplam,
   satır iskontosu, genel iskonto payı, KDV ve brüt açık etiketlerle gösterilir.
   İstemciden gelen herhangi bir hesaplanmış toplam kabul edilmez.

Product'ta mevcut bir KDV alanı bulunmadığından yeni bir ürün vergi varsayılanı
veya geriye dönük ürün güncellemesi eklenmez. Katalog seçimi açıklama/fiyat için
yardımcıdır; kullanıcı fiyat modunu ve her satırın oranını açıkça seçer. Oranın
0 seçilmesi de açık kullanıcı girdisidir; e-belge istisna kodu uydurulmaz.

## Kesinleştirme ve cari hareketleri

- DRAFT oluşturma/düzenleme yalnızca belgeyi ve kalemleri değiştirir. Kasa,
  cari veya stok yazılmaz. Taslak toplamları bile sunucuda yeniden hesaplanır.
- Kesinleştirme version ve durum kontrolüyle tek transaction'da yapılır. Kalemler,
  cari türü, işletme/şube, numara ve toplamlar yeniden doğrulanır; snapshot alınır.
- Bağımsız PURCHASE için tek INVOICE/CREDIT, SALES için tek INVOICE/DEBIT
  oluşturulur; sourceKey faturanın kimliğinden üretilir. accrualEntryId aynı
  transaction'da bağlanır. Tekrarlı kesinleştirme ikinci hareket üretmez.
- ISSUED belgenin kalem/cari/tutar/şube/tarih alanları düzenlenmez. Referans ve
  belge verisi değişecekse orijinal korunur, izinli iptal/yeni belge akışı kullanılır.
- Taslak iptali finansal hareket oluşturmaz. Ödemesiz kesin belge iptalinde
  orijinal tahakkuka eşit tutarlı karşıt REVERSAL aynı transaction'da bağlanır.
- Tahsisi veya bağlı giderinde ödemesi olan faturanın iptali açıkça reddedilir.
  Genel ödeme iadesi/ters kayıt ve resmî e-belge iptali bu aşamaya eklenmez.

## Gider-fatura: tek borç ve tek ödeme

Alış faturasında gider takibi isteğe bağlıdır; her mal alışı otomatik gider veya
stok hareketi sayılmaz. İki güvenli seçenek vardır:

- **Mevcut gideri bağla:** aynı işletme, şube, cari ve genel tutar gerekir; gider
  iptal edilmemiş ve başka faturaya bağlanmamış olmalı. Mevcut aktif EXPENSE/CREDIT
  tahakkuku accrualEntryId olarak benimsenir; ikinci CREDIT oluşturulmaz.
- **Yeni giderle izle:** kullanıcı OUT kategorisini seçer; kesinleştirmede bir
  Expense oluşturulur. Tek tahakkuk giderin ortak servisi tarafından yazılır;
  Invoice aynı tahakkuku benimser. Expense.sourceKey faturadan üretilir ve unique'dir.

Mevcut gider ödemeleri, aynı Payment satırları üzerinden InvoicePaymentAllocation
ile faturaya bağlanır. Yeni gider ödemesi de bağlı ISSUED faturaya aynı transaction
içinde tahsis edilir. Kasa OUT veya cari DEBIT tekrar üretilmez. Gider raporunda
tek Expense vardır; tahsis veya Invoice ikinci gider olarak sayılmaz.

Bağlı ISSUED faturanın giderinde finansal düzenleme/iptal, fatura kurallarını
atlayamaz. Ödemesiz bağlı iptal iki belgeyi ve tek ters kaydı birlikte yönetir.
Fatura taslağı mevcut gideri gösterse bile onu değiştirmez veya iptal etmez.
Kesinleştirmede giderin son version ve ödeme/tahakkuk durumu yeniden okunur.

Carisi olmayan ödemesiz gider, açık kullanıcı onayı/gerekçesiyle aynı transaction'da
seçilen tedarikçiye bağlanabilir ve tek tahakkuk oluşturulur. **Carisi olmayan
ödemeli gider otomatik benimsenmez:** geçmiş kasa ödemelerinden sessizce cari
hareketleri türetmek yerine açıklayıcı hata verilir. Bu istisna bir sonraki
Ödemeler/düzeltme aşamasında ayrıca ele alınır. Serbest metin belge numarasının
aynı olması tek başına otomatik eşleştirme sebebi değildir.

## POS entegrasyon sınırı

Bu aşamada istenen mimari hazırlık yapılır: aynı işletme/şubeye Order FK'si,
benzersiz orderId, mevcut POS_SALE finans kaydına bağlanabilen ortak Payment ve
tahsis yapısı. Fatura servisi hiçbir durumda stok düşümü veya yeni POS_SALE yazmaz.

Otomatik POS → fatura dönüştürme ekranı/endpoint'i bu aşamada etkinleştirilmez.
Mevcut POS'ta KDV anlık görüntüsü yoktur; fiş resmî fatura sayılmaz. Genel taslak
API'si orderId/payment/finance kimliği enjekte ederek POS tahsilatını yeniden
kullanma veya sahte “ödenmiş” durum oluşturma isteğini reddeder.

Gelecekteki köprü için sözleşme: tamamlanmış ve iade edilmemiş Order, kaydedilmiş
kalem/indirim/total ve doğrulanmış tek POS_SALE kullanılmalı; kullanıcı vergi
bilgilerini açıkça tamamlamalı; belge brüt toplamı tahsilatla eşleşmeli. Eski
tahsilat yeni IN yaratmadan ortak Payment olarak benimsenir; fatura DEBIT ve
mevcut tahsilatı yansıtan tek cari CREDIT ile net açık sıfır olur. POS iadesiyle
bağlı fatura/tahsislerin birlikte terslenmesi de çözülmeden bu köprü açılmaz.

Testler bu aşamada sipariş benzersizliği/FK'ler, yasak istemci bağlantıları ve
fatura işlemlerinin stok/POS finans yazmaması sınırlarını doğrular; çalışan bir
otomatik POS dönüştürme akışı test edilmiş gibi raporlanmaz.

## Liste, çıktı ve güvenlik

`/dashboard/invoices`: alış/satış toplamları, açık borç/alacak, vadesi geçmiş
sayı/tutar; durum/tür/tarih/arama/şube filtreleri ve sayfalama. Finansal kartlar
yalnız ISSUED, iptal edilmemiş belgeleri ve yetkili şubeleri kapsar; ödeme durumu
gerçek tahsislerden türetilir. Taslak ve iptaller filtreyle geçmişte görünür.

Detay: kalemler, vergi/iskonto dökümü, durum/audit, cari geçişi, varsa gider
bağlantısı ve gerçek tahsis/ödeme geçmişi. Yetkili kullanıcı taslak düzenler,
kesinleştirir ve izinli iptal yapar. Genel Ödemeler menüsü sonraki aşamadır.

Yazdırma ve gerçek PDF indirme endpoint'i, kayıtlı sunucu toplamları/snapshot
üzerinden çok sayfalı ve Türkçe font destekli çıktı üretir. Her çıktıda
**“Taslak / Ticari Belge Önizlemesi — Resmî e-Fatura veya e-Arşiv değildir”**
etiketi ve gerçek belge durumu bulunur. ETTN, mali mühür, GİB QR/doğrulama kodu
ve resmî seri üretilmez. Taslakta değişebilir veri, kesin belgede dondurulmuş
snapshot gösterilir. Sunucu PDF'i için uygun bir PDF kütüphanesi ve lisansı
korunan Türkçe font kaynağı yerel geliştirmede seçilecek; çıktı render edilip
çok sayfalı örnekle kontrol edilecek.

API, PDF ve yazdırma verileri finance.manage, organizationId ve branchScope ile
korunur. Cari/ürün/ödeme/gider bağlantıları sunucuda doğrulanır. Oluşturma,
düzenleme, kesinleştirme, gider benimseme, tahsis ve iptal AuditLog ile kaydedilir.

## Veri etkisi, yedek ve migration planı

Yeni Invoice, InvoiceItem, InvoicePaymentAllocation tabloları; durum/tür/fiyat
modu enumları ve indeks/FK/CHECK'ler eklenecek. Mevcut CurrentAccountEntry'ye
zorunlu yeni bir alan gerekmez; Invoice onun mevcut hareketlerine bağlanır.
Organization/Branch/User/StaffProfile/CurrentAccount/Product/Order/Expense ve
ortak Payment üzerinde gereken ters ilişkiler/benzersiz anahtarlar eklenir.

ExpensePayment fiziksel tablosu yerinde kalır; Prisma model adı Payment olur
ve expenseId NOT NULL kısıtı gevşetilir. Mevcut ödeme kimlikleri, tutarları,
gider bağlantıları ve kasa/cari referansları korunur. Yeni gider API'lerine
göç zorunluluğu yoktur. Eski satış/ödeme/giderlerden otomatik fatura üretilmez.
Uygulama değişikliği ortak servis ve regresyon testleriyle birlikte hazırlanır.

İlk istenen onay yerel şema/API/UI/PDF/test ve migration SQL taslağı içindir.
Canlı migration izni değildir. Sonraki sıralama:

1. Yerel geliştirme, TypeScript, ESLint ve ilgili regresyon testleri.
2. Kesin SQL ve mevcut tablo indeks/kilit etkisinin sunulması.
3. **Yeni Neon yedeğinin alınması ve geri yüklenerek doğrulanması.** Önceki
   Giderler öncesi yedek güncel fatura migration yedeği sayılmayacak. Mevcut
   backup/verify araçları bu amaçla kullanılabilir; önce kullanıcıdan yedek alınması
   istenecek veya ayrıca kullanıcı isteğiyle araçlar çalıştırılacak.
4. Yedek doğrulandıktan sonra ayrı canlı migration onayı; sadece onaylı migration.
   db push, reset veya mevcut iş verisi silme yok.
5. Checksum/kısıt/eski veri kontrolü ve rollback fixture'lı gerçek PostgreSQL testi.

## Test ve açık sınırlar

İstenen taslak, alış/satış kesinleştirme, KDV/iskonto, tekrar kesinleştirme,
ters kayıt, ödemeli iptal reddi, gider benimseme, yetki/işletme izolasyonu;
ayrıca tedarikçi bazlı dış numara, satış numarası, kuruş dağıtımı, dahil/hariç
eşitliği, fazla tahsis, gider ödeme regresyonu, PDF yetkisi ve Türkçe/çok sayfa
çıktısı test edilecek. POS hazırlığı yukarıda tanımlanan kapsamda sınanacak.

Uygulama/TypeScript test sonuçları `invoices.md` belgesinde. Yasal e-belge
entegrasyonu, otomatik POS dönüştürmesi ve
bağımsız fatura tahsilat/ödeme arayüzü bu aşamada etkinleştirilmeyecek.

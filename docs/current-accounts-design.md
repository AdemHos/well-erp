# Cari Hesaplar — şema ve uygulama önerisi

Durum: kullanıcı tarafından onaylanan tasarım; yerel şema, uygulama ve testler
geliştirildi. Kullanıcının ayrıca verdiği canlı migration onayıyla
`20261022000000_add_current_accounts` Neon üzerinde uygulandı ve doğrulandı.
Uygulama sonuçları `docs/current-accounts.md` dosyasındadır.

## Mevcut mimari incelemesi

- Prisma 7 / PostgreSQL; üretilmiş istemci `src/generated/prisma` altında.
- Organization işletme sınırı, Branch işletmeye bağlı şube. Branch üzerinde
  `(id, organizationId)` benzersiz anahtarı mevcut.
- Customer, Supplier, CurrentAccount veya cari defteri modeli yok.
- FinanceAccount şubeye ait kasa/kart/banka hesabı. FinanceTransaction mevcut
  nakit hareketlerini ve POS satış/iade kayıtlarını tutuyor. Cari borç ile nakit
  hareketi farklı olaylar olduğundan bu modeller cari kartı yerine kullanılmayacak.
- `/dashboard/finance` çalışan kasa ekranı. Menüde `/dashboard/accounts`
  bağlantısı mevcut; sayfa henüz yok ve bağlantı upcomingRoutes içinde.
- `withPermission`, `requirePagePermission`, `getCurrentMembership`,
  `branchScope` ve `writeAudit` yeniden kullanılacak. Etkin personel profili
  yetkileri ve gerçek oturum kullanıcısı mevcut altyapı üzerinden korunacak.
- finance.manage: OWNER, ADMIN ve MANAGER rollerinde var; CASHIER ve diğer
  operasyon rollerinde yok. Yeni bir rol veya mevcut yetkileri genişletme gerekmiyor.

## Muhasebe yönü

Cari defterinde yönler cari tarafının borç/alacağını ifade edecek:

| Yön | Net bakiyeye etki | Örnek |
| --- | --- | --- |
| DEBIT / Borç | Artırır | Müşteriye 5.000 TL vadeli satış: +5.000, işletme alacaklı |
| CREDIT / Alacak | Azaltır | Tedarikçiden 3.000 TL vadeli alış: -3.000, işletme borçlu |

Net bakiye > 0: işletme alacaklı; < 0: işletme borçlu; = 0: kapalı bakiye.
Yön, CUSTOMER/SUPPLIER/BOTH türü değişince tersine çevrilmeyecek.
Tutar her zaman pozitif Decimal(14,2), yön ayrı enum olacak. TRY kullanılacak;
bu aşamada döviz ve kur farkı kapsam dışı.

Açılış, değiştirilebilir bir bakiye alanı yerine OPENING hareketi olarak tutulacak.
Her cari/şube için bir ilk açılış kaydı; hata varsa ters kayıt ve açıklamalı
düzeltme kullanılacak. Böylece şube izolasyonu açılışta da korunacak.
Gösterim: açılış borcu − açılış alacağı + diğer borçlar − diğer alacaklar.
Aynı açılış hem alan hem hareket üzerinden iki kere toplanmayacak.

## Önerilen modeller ve veritabanı kısıtları

### CurrentAccount — işletme düzeyindeki cari kartı

- `id`: cuid primary key.
- `organizationId`: Organization ilişkisi, silme Restrict.
- `code`: normalize edilmiş cari kodu; boşlukları temizlenip büyük harfe
  dönüştürülecek. `(organizationId, code)` benzersiz olacak.
- `name`: cari adı / ticari unvan.
- `type`: CurrentAccountType = CUSTOMER, SUPPLIER, BOTH.
- İsteğe bağlı `phone`, `email`, `address`, `taxOffice`, `taxNumber`, `description`.
  taxNumber metin olacak; baştaki sıfırlar korunacak. Boş veya 10/11 rakam kabulü,
  uzunluk ve biçim doğrulaması; dış sistemden kimlik doğrulaması yapılmayacak.
- `isActive`: varsayılan true; `createdAt`, `updatedAt`.
- `entries`: CurrentAccountEntry ters ilişkisi.
- Ek benzersiz `(id, organizationId)` anahtarı; bileşik dış anahtarla işletme
  sınırını veritabanında da koruyacak.
- Liste için `(organizationId, isActive, type)` indeksi.

Cari kartı işletmenin ortak iletişim kaydıdır. finance.manage yetkilileri kendi
işletmelerindeki kartları görebilir ve düzenleyebilir; bu, diğer şube hareketlerine
erişim vermez. Silme endpoint'i olmayacak; pasifleştirme kullanılacak. Pasif cariye
yeni normal hareket eklenmeyecek; geçmişin yetkili kullanıcı tarafından ters
kaydı denetim iziyle mümkün olacak. Geçmiş hareketlerin muhasebe yönü değişmez.

### CurrentAccountEntry — değiştirilemez cari hareketi

- `id`: cuid primary key.
- `organizationId`, `currentAccountId`, `branchId`: zorunlu. Cari bağlantısı
  `(currentAccountId, organizationId)`, şube bağlantısı `(branchId, organizationId)`
  üzerinden bileşik FK ve silme Restrict ile kurulacak.
- `direction`: CurrentAccountDirection = DEBIT, CREDIT.
- `kind`: CurrentAccountEntryKind. Bu aşamada OPENING, ADJUSTMENT, REVERSAL;
  ileride CREDIT_SALE, CREDIT_PURCHASE, INVOICE, COLLECTION, PAYMENT için ayrım.
- `amount`: Decimal(14,2), veritabanında `CHECK(amount > 0)`.
- `description`, `reference`: isteğe bağlı; düzeltme ve ters kayıtta gerekçe zorunlu.
- `occurredAt`: işlem tarihi; `createdAt`: gerçek oluşturulma tarihi.
- `createdByUserId`: User ilişkisi. `createdByProfileId`: isteğe bağlı StaffProfile
  ilişkisi; profil bağlantısı organizationId ile birlikte doğrulanacak.
- `idempotencyKey`, `requestHash`: `(organizationId, idempotencyKey)` benzersiz.
  Aynı anahtar/aynı içerik önceki sonucu, farklı içerik 409 döndürecek.
- `reversalOfId`: isteğe bağlı, benzersiz ters kayıt bağlantısı. Orijinal hareketle
  aynı işletme/cari/şube, eşit tutar ve karşıt yön transaction içinde doğrulanacak.
  Aynı orijinale iki kez ters kayıt yazılamayacak; ters kayda ters kayıt yerine
  açık gerekçeli yeni düzeltme kullanılacak.
- `financeTransactionId`: isteğe bağlı, benzersiz. İleride tek tahsilat/ödemenin
  tek kasa hareketine bağlantısı. Bu aşamadaki manuel API bu alanı kabul etmeyecek.
  FK aynı işletme/şubeyi kapsayacak; silme Restrict olacak.
- `sourceKey`: isteğe bağlı; `(organizationId, sourceKey)` benzersiz. İleride
  aynı sipariş/fatura/ödeme kaynağının farklı HTTP anahtarıyla yeniden
  muhasebeleştirilmesini önlemek için sunucuda üretilecek.
- `dueAt`: isteğe bağlı vade tarihi; bu aşamada otomatik vade takibi yok.
- `(organizationId, currentAccountId, branchId, occurredAt, createdAt, id)`
  ile işletme/şube/tarih sorgularını destekleyen uygun indeksler.
- Cari/şube başına bir OPENING kaydını koruyan kısmi benzersiz indeks.

Net bakiye bu tabloda saklanmayacak; Decimal toplamlarından hesaplanacak.
Doğrudan hareket UPDATE/DELETE API'si olmayacak. Oluşturma, kart değişikliği,
pasifleştirme ve ters kayıt aynı transaction içinde AuditLog'a yazılacak.

### Mevcut modellere ilişki ekleri

Organization, Branch, User ve StaffProfile modellerine ters ilişkiler eklenecek.
FinanceTransaction modeline isteğe bağlı ters ilişki ve cari-kasa FK'sini
destekleyen `(id, organizationId, branchId)` benzersiz anahtarı eklenecek.
Mevcut FinanceAccount, POS order, stok ve iade hesaplama kuralları değişmeyecek.

## Gelecekte kasa / fatura / ödeme bağlantısı

Bu aşamada cari manuel hareketi kasa kaydı oluşturmayacak. Tahsilat, ödeme,
vadeli POS satışı ve fatura kaydı için çalışan endpoint veya ekran eklenmeyecek.
Gelecekte tahsilat: kasa IN + cari CREDIT; tedarikçi ödemesi: kasa OUT + cari
DEBIT. İki kayıt aynı transaction'da yazılacak; kasa hareketi yeniden oluşturulmak
yerine financeTransactionId ile bağlanacak. sourceKey kaynak olayını,
idempotencyKey ise HTTP tekrarını ayrı ayrı koruyacak.

Kısmi tahsilatlar ayrı pozitif hareketler olacak. Fatura modeli geldiğinde bir
ödemenin birden fazla faturaya dağıtımı için ayrı allocation tablosu eklenecek;
dağıtım cari veya kasa toplamına yeniden yazılmayacak. Bu aşamada mevcut olmayan
bir fatura tablosuna sahte FK veya tam ödeme modülü eklenmeyecek. Cari net bakiye
hesaplanacak; fatura bazında açık bakiye/yaşlandırma sonraki aşamanın işidir.

## API, arayüz ve ekstre

- `/dashboard/accounts`: liste, aktiflik/tür/arama filtreleri, sayfalama,
  ekleme/düzenleme ve detay/ekstre. Mevcut sidebar bağlantısı etkinleştirilecek.
- `/api/current-accounts`: liste/oluşturma; `/:id`: detay/güncelleme;
  `/:id/entries`: hareketler/oluşturma; `/:id/entries/:entryId/reverse`: ters kayıt;
  `/:id/statement.csv`: aynı kapsam ve filtrelerle CSV.
- Bütün endpoint'ler finance.manage ve organizationId sınırıyla korunacak.
  Şube istemciden geliyorsa yetkisi sunucuda doğrulanacak; filtre verilmemesi
  kapsamı genişletmeyecek. CSV de aynı kontrolleri kullanacak.
- Kartlar ortak, bütün bakiye/toplam/ekstre sorguları yalnızca izinli şubeleri
  içerecek. Şube kısıtlı kullanıcıya “Yetkili şubeler” etiketi gösterilecek.
- Müşteri alacağı: CUSTOMER/BOTH carilerindeki pozitif netler; tedarikçi borcu:
  SUPPLIER/BOTH carilerindeki negatif netlerin mutlak toplamı. Ters bakiye ayrıca
  cari listesinde yön etiketiyle görünecek; sadece tür üzerinden yön varsayılmayacak.
- İstanbul tarih aralığı, metin arama, tarih sıralaması ve sayfalama desteklenecek.
  Kronolojik sıralama `(occurredAt, createdAt, id)` ile kararlı olacak.
- İşlem sonrası bakiye bütün önceki kapsam içi hareketleri içerecek. Tarih
  filtresi öncesi devir ayrıca gösterilecek; arama ve sayfalama bakiye hesabından
  geçmiş hareketleri çıkarmayacak. Azalan sırada da aynı tarihsel bakiyeler görünür.
- CSV bütün eşleşen hareketleri sayfa sınırı olmadan, devir ve yön bilgileriyle
  aktaracak; UTF-8 ve Excel formül enjeksiyonuna karşı hücre kaçışları kullanılacak.
  Liste ve toplamlar tutarlı snapshot üzerinden okunacak.

## Veri etkisi ve onay sınırı

İki yeni boş tablo, yeni enumlar, indeksler ve FK/check kısıtları eklenecek.
Mevcut tablo verileri silinmeyecek, bakiyeler değiştirilmemiş kalacak, geçmiş
POS satışları otomatik cari borcuna dönüştürülmeyecek. FinanceTransaction üzerinde
yeni benzersiz indeks mevcut satırları tarar; canlı uygulama sırasında kilit ve
süre etkisi migration SQL'i incelenirken ayrıca değerlendirilecek.

İstenen ilk onay: yerel Prisma şemasının bu tasarımla güncellenmesi, uygulama
ve testlerin geliştirilmesi ve incelenebilir migration SQL taslağının hazırlanması.
Bu onay canlı Neon migration/db push/veri silme izni sayılmayacak. Canlı uygulama
öncesinde kesin SQL ve etkisi ayrı sunulacak.

## Onay sonrası doğrulama

İstenen 10 senaryoya ek olarak BOTH ve ters bakiye, şubeler arası sızıntı,
açılış tekrarları, eşzamanlı ters kayıt, idempotency, arama/sayfalama sonrası
ekstre bakiyesi ve CSV güvenliği test edilecek. TypeScript, ilgili ESLint ve
mevcut Kasa/POS/iade testleri çalıştırılacak. Gerçek veritabanı testleri ayrıca
izin verilmedikçe etkinleştirilmeyecek. Güncel sonuçlar uygulama raporundadır.

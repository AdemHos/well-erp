# Müşteriler — onaylı MVP tasarımı

Yerel model/ilişki tasarımı kullanıcı tarafından onaylandı ve uygulandı. Canlı Neon migration’ı yeni yedek, gerçek geri yükleme ve migration provası sonrasında kullanıcının canlı onayıyla uygulandı. Uygulama, değişen dosyalar ve test sonuçları: [customers.md](customers.md).

## Mevcut durum

- Customer modeli ve müşteri API/ekranı yok. Sidebar'daki Müşteriler bağlantısı
  henüz açılmamış özellik olarak işaretli.
- CurrentAccount, işletme genelinde ortak müşteri/tedarikçi cari kartıdır.
  CUSTOMER / SUPPLIER / BOTH türleri var; code işletme kapsamında benzersiz.
  Bakiye CurrentAccountEntry üzerinden yetkili şube kapsamıyla hesaplanıyor.
- Order ve OrderItem mevcut. Siparişte müşteri bağlantısı veya müşteri snapshot'ı
  yok. Ürün adları satış anındaki değerleriyle saklanıyor.
- POS tek sipariş, stok hareketleri ve tek POS_SALE kasa girişi oluşturuyor.
  Müşteri seçimi ek kasa/cari/Payment/fatura üretmeyecek.
- Mevcut iade tam iadedir: Order.status REFUNDED olur, stok ve kasa ters etkileri
  mevcut akışta üretilir. Yeni modül bu akışı değiştirmeyecek.
- Faturalar CurrentAccount üzerinden bağlanır ve kesin belgede hukuki alıcı
  snapshot'ı bulunur. Ödemeler ve etkin tahsis toplamları mevcut servislerdedir.
- POS liste/detay/fiş/iade ve restoran checkout Order okur/oluşturur. Yeni nullable
  kolonlar eklenince Prisma'nın otomatik seçimlerinin migration öncesi uyumu
  bu yolların tamamında ele alınmalıdır.
- OWNER / ADMIN / MANAGER finans yönetebilir. CASHIER POS satabilir; finans ve
  cari detaylarına erişemez. RBAC işletme, aktif personel ve şube erişimini kontrol eder.
- Son UI çalışmasındaki ortak pastel kartlar, mavi butonlar, hafif kenarlıklar,
  ikonlar ve mobil düzen müşteri ekranlarında da kullanılacak.

## Önerilen model ve ilişkiler

### CustomerType

INDIVIDUAL / CORPORATE. Mevcut cari verilerinden bireysel/kurumsal türü tahmin
edilmeyecek; kullanıcı açıkça seçer.

### Customer

- id; organizationId.
- type: CustomerType; code; name. Yalnız tür, kod ve ad/unvan zorunlu.
- phone, email, address, city, district: nullable iletişim alanları.
- taxOffice, taxNumber: kurumsal müşteri için isteğe bağlı nullable alanlar.
- notes; isActive (varsayılan true); createdAt; updatedAt.
- currentAccountId: nullable. Aynı işletmedeki tek CurrentAccount'a bağlantı.
- version: Int (varsayılan 1); eski formun daha yeni düzenlemeyi ezmesini engeller.
- createdByUserId / createdByProfileId: gerçek kullanıcı ve varsa personel izi.
- idempotencyKey / requestHash: müşteri + isteğe bağlı cari + audit oluşturma
  tekrarlarında tek kayıt için işletme kapsamında benzersiz istek anahtarı.
- unique(organizationId, code), unique(id, organizationId).
- currentAccountId üzerinde unique; (currentAccountId, organizationId) üzerinden
  bileşik FK. Böylece bir cari iki müşteri profiline bağlanamaz ve tenant dışına çıkamaz.
- organization/tür/aktiflik/ad için liste indeksleri.

Customer bir ticari müşteri profilidir; CurrentAccount mevcut finansal/hukuki
kart olmaya devam eder. Yeni bir ortak kişi, adres, bakiye veya CRM tablosu
eklenmez. Carisiz müşteri için gereksiz bir CurrentAccount açılmaz.

Profil iletişim bilgileri ile mevcut finans kartının fatura/tebligat bilgileri
ayrı amaç taşır. Bağlantı kurulduktan sonra aralarında otomatik çift yönlü kopya
ve senkronizasyon yapılmaz. Böylece cari ekranından yapılan bir güncelleme
müşteri profilini, profil güncellemesi de muhasebe kartını ve kesin belgeleri
sessizce değiştirmez. Yeni cari oluşturulacaksa başlangıç bilgileri kullanıcıya
gösterilip aynı transaction içinde bir kez yazılır. Müşteri profili ve finansal
kimlik, benzersiz bire bir bağlantıyla aynı kişiyi temsil eder.

### Order'a ek alanlar

- customerId: String?; (customerId, organizationId) → Customer(id, organizationId).
  onDelete Restrict; eski siparişler null kalır.
- customerSnapshot: Json?; yalnız satış anındaki ad/unvan, müşteri kodu ve tür.
  İstemciden snapshot kabul edilmez; sunucu seçilen müşteriden üretir.
- organizationId/customerId/createdAt ve organizationId/customerId/branchId/createdAt
  indeksleri, müşteri geçmişi ve filtreler için.

Customer güncellense/pasifleştirilse de eski fiş snapshot'ı korunur. OrderItem'a
müşteri alanı eklenmez. Order'ın müşteri bağlantısını sonradan değiştiren bir
endpoint yapılmaz. Customer / CurrentAccount / Organization / User / StaffProfile'a
gereken ters ilişkiler eklenir; Invoice ve Payment modellerine ikinci müşteri
bağlantısı veya bağımsız bakiye alanı eklenmez.

## Mükerrer kimlik ve mevcut cari bağlantısı

Oluşturma ekranında üç açık yol bulunur:

1. Carisiz müşteri profili.
2. Mevcut CUSTOMER/BOTH carisini seçerek müşteri profili. Kartın başlangıç
   bilgileri gösterilir; müşteri türü kullanıcı tarafından seçilir.
3. Müşteriyle birlikte yeni müşteri carisi. Kod çakışıyorsa var olan cariye
   yönlendirilir; ikinci cari yaratılmaz.

Aynı cari için ikinci profil unique kısıtıyla engellenir. Mevcut bir cariyle
aynı kodla bağlantısız profil açılmak istendiğinde mevcut kartı bağlama yolu
gösterilir. Ad/telefon/e-posta/vergi numarası benzerlikleri muhtemel eşleşme
olarak gösterilir; otomatik birleştirme veya otomatik kimlik atama yapılmaz.
Telefon/e-posta aile/şirket içinde ortak olabileceğinden benzersiz kimlik sayılmaz.

Bağlantı kurma, ayrıca finance.manage gerektirir. SUPPLIER türündeki cari
bağlanamaz. Bağlı cari daha sonra SUPPLIER türüne çevrilemez. MVP'de kurulmuş
cari bağlantısı değiştirilemez veya koparılamaz; başka kişinin geçmiş
faturalarının yanlış profilde görünmesi engellenir. Önceden carisiz bir profile
aynı işletmedeki uygun ve henüz bağlı olmayan cari açık seçimle bağlanabilir.

Müşterinin pasifleştirilmesi cari kartını pasifleştirmez; mevcut alacakların
tahsili devam eder. Cari pasifleştirmesi de profil bilgilerini silmez. Yeni
satış seçimi yalnız aktif müşteri profillerini getirir.

## POS, geçmiş ve istatistikler

Kasiyer POS'ta ad/kod/telefonla aktif müşteri arayıp seçebilir; seçim zorunlu
değildir. Dar bir lookup endpoint'i yalnız gerekli ad/kod ve arama/seçim
bilgisini döndürür; adres, vergi, notlar, cari bakiye veya fatura bilgisi dönmez.

customerId gönderilmişse aynı işletmede aktif müşteri olması satış transaction'ı
içinde doğrulanır. Mevcut fiyat/iskonto/stok/hesap seçimi/kasa işlemi korunur.
Yalnız siparişe ID ve snapshot eklenir. Müşterisiz POS ve restoran checkout
akışları mevcut davranışı sürdürür. Termal fişte müşteri gösterimi isteğe bağlıdır;
gösterilen bilgi güncel profilden değil kaydedilmiş snapshot'tan gelir.

Geçmiş yalnız order.customerId ile bağlanır; isim/telefon/tutar benzerliğinden
geriye dönük satış ataması yapılmaz. Satış geçmişi, özet ve son alışveriş aynı
yetkili şube ve seçili şube filtresini izler:

- Tamamlanan alışveriş sayısı: status COMPLETED olan satış adedi.
- Net harcama: bu satışların kayıtlı Order.total toplamı.
- Ortalama sepet: aynı toplam / aynı adet; adet sıfırsa 0.
- Son alışveriş: aynı geçerli satışların en son tarihi.
- REFUNDED/CANCELLED geçmişte görünür; geçerli adet/harcama/ortalamaya girmez.
  Geçmişte orijinal tutar ve güncel net etki ayrı açıklanır; yeni bir iade satırı
  ekleyerek iki kez düşüm yapılmaz.

Faturalar bağlı currentAccountId üzerinden SALES türüyle listelenir. Önceden
aynı cariye düzenlenmiş faturalar, açıkça kurulan kimlik bağlantısı sayesinde
görülebilir; Order müşteri bağlantıları geriye dönük değiştirilmez. Taslak/iptal
durumları açık görünür, ödeme durumu mevcut aktif tahsislerden hesaplanır.
Bu satış istatistikleri POS alışveriş istatistikleridir; satış faturası toplamı
eklenerek aynı satış iki kez sayılmaz.

## Yetki, izolasyon ve geçmiş koruması

| Yetki | Roller / davranış |
| --- | --- |
| customers.read | OWNER / ADMIN / MANAGER; müşteri listesi ve profil |
| customers.manage | OWNER / ADMIN / MANAGER; ekleme/düzenleme/pasifleştirme |
| customers.lookup | OWNER / ADMIN / MANAGER / CASHIER; POS için dar aktif arama |
| finance.manage | Mevcut finans yetkisi; cari/fatura/ödeme payload'u ve bağlantı işlemleri |
| orders.read | Satış ayrıntıları ve satış istatistikleri; ayrıca mevcut branchScope |

Müşteriler işletme genelinde ortak havuzdur; branchId müşteri kimliği alanı
olmaz. Bütün profil ve lookup API'leri organizationId ile daralır. Geçmiş,
faturalar ve bakiye yalnız yetkili şubelerden gelir; başka şube toplamı da sızmaz.
Finans izni olmayan kişiye finans verisi API cevabında hiç dönmez; yalnız UI'da
gizlenmez. Aktif personel, origin, tenant ve rol kontrolleri mevcut RBAC ile yürür.

DELETE endpoint'i yapılmaz. İlişkiler Restrict, kullanıcı işlemi pasifleştirmedir.
Profil sürümü kontrol edilir; audit'e kimlik, işlem ve değişen alan adları
yazılır; telefon/e-posta/adres/not/vergi bilgisi veya tüm request body loglanmaz.
Telefon için makul uzunluk, izinli biçim ve rakam sayısı; e-posta için uzunluk ve
biçim; kurumsal vergi numarası girilmişse 10 hane doğrulanır. İsteğe bağlı
alanlar boş kalabilir. Bireysel müşteri için TCKN zorunluluğu eklenmez.

## Migration etkisi ve doğrulama

Yeni Customer tablosu ve enum oluşturulur; eski cari kartları, cari hareketleri,
bakiyeler, faturalar ve ödemeler değiştirilmez. Otomatik müşteri backfill'i veya
vergi bilgisine göre tür tahmini yoktur. Eski Order kayıtlarında iki yeni alan
null kalır; stok/kasa/iade ve sipariş kimlik/tutarları korunur. FK ve indeks
taramalarının Order üzerinde kilit etkisi yerel prova sonrası raporlanır.

Migration öncesi POS, satış listesi/detayı/fişi, iade ve restoran checkout yeni
kolonlara erişmeden çalışabilmeli. Yeni müşteri özellikleri şema hazır değilse
açıklayıcı kurulum bekleniyor cevabı verir. Yeni şema ile mevcut finans/cari
seçimlerinin uyumu da gerçek yerel PostgreSQL'de sınanır.

Kullanıcının 15 senaryosu; ayrıca tek cariye eşzamanlı profil bağlama,
müşteri+cari+audit rollback, eski belge snapshot'larının korunması,
kasiyer payload'unda finans/PII sınırı ve migration öncesi POS/iade/checkout
uyumluluğu test edilecek. TypeScript, ESLint ve mevcut POS/fiş/iade/Cari/Fatura/
Ödeme/RBAC regresyonları çalıştırılacak. Canlıya test müşterisi/satışı eklenmeyecek.

Başlangıç kontrolü: TypeScript başarılı. Cari/Fatura/POS/fiş/RBAC için ilgili
37 mevcut test başarılı. Bu sonuçlar henüz yeni Müşteriler modülü testleri değildir.

Bu belge onaylanan tasarım kararlarını korur; uygulanan dosyalar ve doğrulama sonuçları
customers.md içinde raporlandı. Canlı migration öncesinde yeni Neon
yedeği alınması istenecek; yedek geri yükleme doğrulaması ve ayrı canlı onay
olmadan migration/db push/veri silme yapılmayacak.

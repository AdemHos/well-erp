# POS finans entegrasyonu

Yeni pozitif tutarlı POS satışları, sipariş ve stok işlemleriyle aynı transaction
içinde `IN / POS_SALE` finans hareketi oluşturur. Tutar kaydedilen siparişin
indirim sonrası `total` değeridir. İşletme, aktif şube, ödeme türü ve hesabın
aktifliği sunucuda doğrulanır. Kaydın açıklaması ve referansı satış numarasını
içerir; `orderId` siparişe bağlanır. Kategori zorunlu değildir ve otomatik kategori
oluşturulmaz. Sıfır tutarlı satışlarda finans kaydı veya hesap şartı yoktur.

Tek uygun hesap otomatik kullanılır. Birden fazla uygun hesapta POS kullanıcısı
hesap seçer; rastgele hesap seçilmez. Seçim sayfa açıkken ödeme türüne göre
korunur. Kalıcı varsayılan hesap ayarı henüz yoktur. Böyle bir ayar istenirse
işletme + şube + ödeme türü bazında tek varsayılan sağlayan, yönetici tarafından
değiştirilebilir bir ayar ve onaylı migration ayrı geliştirilmelidir.

Finans listesi ve hesap bakiyeleri mevcut toplama sorgularıyla yeni hareketleri
içerir. Otomatik kayıtlar için düzenleme/silme endpoint'i bulunmaz. Manuel işlem
endpoint'i kaynağı daima `MANUAL` olarak belirler ve istemciden `orderId` almaz.
Geçmiş satışlar geriye dönük olarak finans kaydına dönüştürülmez. Adisyon tahsilatı,
iade ve iptal için otomatik gelir/ters kayıt bu değişikliğe dahil değildir.

## İstek tekrarları: açık risk ve öneri

`@@unique([orderId, source])` aynı siparişin ikinci kez muhasebeleştirilmesini
engeller. Aynı HTTP isteğinin yeniden gönderilip farklı siparişler oluşturmasını
engellemez. Arayüz aynı anda birden fazla satış isteğini engeller; ağ hatasında
satışın tamamlanma durumu belirsiz olabileceği için kayıt kontrolü önerilir.
Bunlar kalıcı idempotency garantisi değildir.

Önerilen sonraki değişiklik: işletme kapsamında benzersiz bir idempotency anahtarı,
sunucuda normalize edilmiş istek özeti ve sonuç siparişine bağlantı saklayan kalıcı
bir kayıt. Anahtar istemcide satış denemesi başında bir kez üretilmeli ve ağ
tekrarlarında korunmalıdır. Aynı anahtar + aynı içerik kaydedilmiş siparişi ve fiş
verisini döndürmeli; aynı anahtar + farklı içerik 409 olmalıdır. Anahtar kaydı ve
satış aynı transaction içinde güvenceye alınmalı, eşzamanlı istekler de test
edilmelidir. Bunun için şema/migration onayı gerekir; şu an uygulanmamıştır.

## Kontroller

`node --test tests/*.test.cjs` çevrimdışı kontrolleri çalıştırır.

Gerçek veritabanı testi ayrıca ve açıkça etkinleştirilir:

```powershell
$env:WELLPOS_FINANCE_DB_TEST = '1'
node --test tests/pos-finance.integration.test.cjs
Remove-Item Env:WELLPOS_FINANCE_DB_TEST
```

Test, ayrı deneme işletmeleri oluşturur ve tüm deneme verilerini dış transaction
ile geri alır. Her işleyici çağrısında gerçek savepoint kullanarak hata sonrası
stok, sipariş ve finans kayıtlarını karşılaştırır. Nakit/kart, yüzde/sabit indirim,
sıfır tutar, stok yetersizliği, hesap eksikliği/çokluğu, şube/işletme/ödeme türü
uyuşmazlığı, pasif hesap, finans kaydı hatası, benzersizlik kısıtı, finans listesi,
bakiyeler ve manuel işlem kaynak güvenliği test edilir.

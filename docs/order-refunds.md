# Satış geçmişi ve tam iade

Ekran: `/dashboard/orders` (menüde Siparişler). Kayıtlar aktif şubeye ve oturumun
işletmesine göre sunucuda sınırlandırılır. Tarih filtreleri İstanbul saatinde
gün başlangıcından, bitiş gününün sonuna kadar uygulanır. Sayfalama 25 kayıttır;
özetler yalnızca görünen sayfayı değil, filtrelere uyan tüm kayıtları kapsar.
Tamamlanmamış/iptal/iade satışlar tamamlanmış satış özetlerine dahil edilmez.

## Durumlar ve yetki

- `COMPLETED`: tamamlanmış satış; tam iade için başlangıç durumu.
- `REFUNDED`: stok ve gerekiyorsa finans geri alma işlemleri atomik tamamlanmış satış.
- `CANCELLED`: ödemesi alınmamış/terk edilmiş işlem akışına ayrılmış durum.
  Bu MVP yeni bir iptal akışı sunmaz. Eski durum-only PATCH yolu artık 409 döner;
  tamamlanmış satış finans/stok düzeltmesi olmadan iptal edilemez.

OWNER, ADMIN ve MANAGER iade yapabilir. CASHIER dahil diğer roller API'de 403
alır. Kullanıcı arayüzünde de yalnızca yetkililere iade butonu sunulur. İade
edilmiş veya iptal edilmiş satışta buton devre dışıdır.

## Transaction ve tutarlar

`POST /api/orders/[id]/refund`, istemcinin tutar/miktar alanlarını kullanmaz.
Transaction içindeki koşullu `COMPLETED -> REFUNDED` güncellemesi sipariş satırını
kilitler. Eşzamanlı istekte ikinci işlem kilidi bekler ve değişmiş durumu görünce
409 alır. Ürün miktarları kayıtlı OrderItem'lardan toplanır; stoklar satışın
şubesine eklenir ve RETURN hareketleri oluşturulur. Satılan ürün geri gelir;
reçete hammaddeleri ayrıca geri eklenmez.

Pozitif tutarda ilk POS_SALE hareketi zorunludur. İşletme, şube, hesap ve tutar
uyumu doğrulanır. İlk kayıt korunur; aynı hesapta net Order.total kadar
OUT / POS_REFUND oluşturulur. Hesap sonradan pasif olsa da orijinal hesap
kullanılır. `unique(orderId, source)` ek finans korumasıdır. Stok ve finans
hareketlerinin açıklamasında satış numarası ve işlemi yapan üyeliğin userId'si
yer alır. İadenin zamanı finans/stok hareketlerinde saklanır.

Sıfır tutarlı ve finans hareketi olmayan satışta yalnızca stok geri gelir;
sıfır tutarlı finans kaydı oluşturulmaz. Pozitif eski/adisyon satışında ilk finans
kaydı yoksa otomatik iade reddedilir. Silinmiş ürün bağlantısı veya tutarsız
finans/stok kayıtları da iadeyi bütünüyle durdurur. Geçmiş kayıtlar otomatik
onarılmaz veya silinmez. Herhangi bir hatada durum, stok ve finans geri alınır.

## Fiş ve kapsam

Detaydan kayıtlı verilerle 58/80 mm orijinal satış fişi yeniden yazdırılabilir.
İade edilmiş fişte bu durum açıkça işaretlenir. Çıktı resmi mali belge veya banka
iade dekontu değildir. Karttan para iadesi bu sistem dışında ayrıca yapılmalıdır.
Kısmi iade, bankadan otomatik kart iadesi ve resmi belge iptali kapsam dışıdır.

## Test

`node --test tests/*.test.cjs`: çevrimdışı regresyonlar. Eşzamanlı iki API çağrısı
testi, PostgreSQL satır kilidi sıralamasını modelleyen transaction mock'u kullanır.

Opt-in gerçek Neon testi:

```powershell
$env:WELLPOS_FINANCE_DB_TEST = '1'
node --test tests/pos-finance.integration.test.cjs
Remove-Item Env:WELLPOS_FINANCE_DB_TEST
```

Bu test ayrı deneme işletmelerinde satış geçmişini, filtreleri, sayfalamayı,
nakit/kart/net tutar iadelerini, tekrar iadeyi, rol ve şube/işletme izolasyonunu,
sıfır tutarı ve hata sonrası kısmi kayıt kalmamasını gerçek API işleyicileri ve
SQL savepoint'leriyle sınar. Tüm deneme kayıtları dış transaction ile geri alınır;
migration veya kalıcı silme yapılmaz.

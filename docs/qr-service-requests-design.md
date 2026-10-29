# QR Menü servis talepleri — onay bekleyen tasarım

## Mevcut durum

- `RestaurantTable`, `Tab`, `TabItem`, şube kapsamlı RBAC ve personel profilleri mevcut.
- Public QR Menü route'u, QR ayarları, masa token'ı veya servis talebi modeli bulunmuyor. Sidebar QR Menü bağlantısı henüz gelecek özellik olarak işaretli.
- `KitchenManager` 5 saniye polling ve kullanıcı etkileşimiyle sesli bildirim örneği içeriyor; realtime servisi yok.
- `Branch` slug içermiyor. Yeni slug zorunluluğu yerine rastgele public menü anahtarı kullanılacak.

## Önerilen şema

### BranchQrMenu (yeni)

- `id`, `organizationId`, `branchId` (tekil), `publicToken` (32 kriptografik rastgele bayt, tekil)
- `isPublished`, `serviceRequestsEnabled`, `waiterCallEnabled`, `billRequestEnabled` — varsayılan kapalı
- `createdAt`, `updatedAt`
- Branch ile `(branchId, organizationId)` bileşik dış anahtar. Public anahtar yalnız açık menünün adresidir; personel API yetkisi vermez.

### RestaurantTable (mevcut modele ek)

- `qrTokenHash` nullable/tekil, `qrTokenRotatedAt` nullable
- `requestWindowStartedAt` nullable ve `requestWindowCount` varsayılan 0: aynı masa için veritabanında kalıcı ve transaction kilidi altında rate limit
- `(id, branchId, organizationId)` bileşik unique: servis taleplerinde işletme/şube/masa eşleşmesini DB düzeyinde doğrulamak için
- Ham token 32 kriptografik rastgele bayttan oluşturulacak; yalnız SHA-256 özeti saklanacak. QR üretildiğinde/yenilendiğinde ham bağlantı bir kez gösterilip indirilebilecek. Tekrar edinmek için token yenilenir; eski QR geçersizleşir. Tokenlar audit loglara yazılmaz.

### ServiceRequest (yeni)

- `id`, `organizationId`, `branchId`, `tableId`, opsiyonel `tabId`
- `type`: `WAITER_CALL` veya `BILL_REQUEST`
- `status`: `PENDING`, `ACKNOWLEDGED`, `COMPLETED`, `CANCELLED`
- `createdAt`, `updatedAt`, `acknowledgedAt`, `completedAt`, `cancelledAt`
- Üstlenen, tamamlayan ve iptal eden için ayrı user/profile kimlikleri. Mevcut oturumdaki gerçek kullanıcı ve aktif personel profili birlikte kaydedilir.
- Masa ilişkisi `(tableId, branchId, organizationId)`; adisyon ilişkisi `(tabId, tableId, branchId, organizationId)`. Bunun için Tab modeline aynı bileşik unique eklenir.
- Açık durumlarda `(tableId, type)` partial unique index: eşzamanlı çağrılarda bile aynı türde en fazla bir açık talep.
- `(organizationId, branchId, status, createdAt)` ve tarih/geçmiş liste indeksleri.
- Kimlikler ve durum/zaman tutarlılığı uygun dış anahtarlar ve SQL CHECK kurallarıyla korunacak. İlişkili masa/adisyonun fiziksel silinmesi geçmişi kaybettirmeyecek; Restrict kullanılacak.

## Akış ve sınırlar

- Genel menü `/menu/[publicToken]`; masa menüsü aynı route üzerinde `?table=<opaqueToken>`. Parametreler sunucuda aynı işletme/şube/aktif masa ile doğrulanır.
- Genel menü yalnız aktif, satılabilir ürünlerin public alanlarını gösterir. Maliyet, stok, personel, finans ve özel adisyon detayları public yanıta girmez. QR sipariş ve ödeme yok.
- Masa token'ı geçersiz veya masa pasifse butonlar gösterilmez, POST da reddedilir.
- Hesap isteği yalnız aynı masada açık adisyon varsa oluşturulur ve ona bağlanır; adisyon kapanmaz, ödeme/fiş/stok/finans hareketi oluşmaz.
- Transaction masa kilidi altında açık talep kontrolü ve pencere sayacı. Öneri: masa başına dakikada en fazla 6 oluşturma denemesi, ayrıca aynı tür son talep sonrasında 30 saniye bekleme. Mevcut açık talep yeni kayıt yerine bekliyor yanıtı verir. İstemci bekleme bilgisi alır, personel kimliği almaz.
- Yanlış/bulunamayan token denemeleri için ayrıca sınırlı boyutlu süreç içi IP limiti; güvenilmeyen proxy başlıkları körlemesine kullanılmaz. Çok instance ortamında bu katman global değildir; geçerli masa token'ına ait kalıcı DB limiti tüm instance'larda geçerlidir.
- Public POST için same-origin/fetch metadata kontrolü, dar JSON doğrulaması ve boyut sınırı; organizationId/branchId istemciden kabul edilmez. Referrer-Policy no-referrer; token içeren sayfalarda üçüncü taraf QR servisi kullanılmaz.
- Personel paneli mevcut Masalar ve Adisyonlar sayfasına eklenir. Okuma ve yönetim ayrı izinlerle, mevcut rol ve branch kapsamıyla uygulanır. WAITER yönetebilir; CASHIER okuma yapabilir; KITCHEN/STAFF varsayılan erişemez.
- Üstlenme/bitirme/iptal koşullu atomik güncelleme ile yapılır; başka personelin üstlendiği talebi normal personel tamamlayamaz. Yönetici müdahalesi açık yetki ve audit ile sınırlanır.
- Panel 5 saniyede bir, görünürken ve önceki istek bitmişse yenilenir; arka planda durur, hatada gecikme artar. Görsel uyarı, isteğe bağlı kullanıcı etkileşiminden sonra ses.
- Şube ayarları ve token yenileme yetkili yönetim ekranından yapılır ve audit kaydı tutulur. Ayar kapanınca public oluşturma durur; mevcut talepler panelde yönetilmeye devam eder.

## Mevcut veriye etki ve onay sınırı

- Mevcut tablo/adisyon/ürün/satış/finans kayıtları taşınmaz veya silinmez.
- Mevcut masalara otomatik token üretilmez; şubeler otomatik yayınlanmaz. Yeni alanlar nullable veya güvenli varsayılanlarla eklenir.
- Yeni servis talepleri ve ayarlar ayrı küçük tablolar; ikinci masa/adisyon sistemi oluşturulmaz.
- Şema onayı sonrası uygulama ve migration dosyası hazırlanır; önce izole localhost PostgreSQL üzerinde migration ve 15 istek senaryosu doğrulanır, TypeScript ve lint çalıştırılır.
- Canlı Neon migration öncesi güncel yedek alınması istenir, yedek ve restore provası doğrulanır. Canlı uygulama ayrıca açık onaya tabidir; bu tasarım onayı canlı veritabanına yazma izni sayılmaz.

Durum: kullanıcı tasarımı ve ardından canlı geçişi ayrıca onayladı. Geliştirme, yerel testler, yeni yedek/restore/prova, canlı Neon migration ve salt-okunur servis doğrulamaları tamamlandı. Güncel uygulama ve doğrulama raporu: [qr-service-requests.md](qr-service-requests.md).

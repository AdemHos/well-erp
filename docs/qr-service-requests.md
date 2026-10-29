# QR Menü — Garson Çağır ve Hesap İste

## Kapsam ve kullanım

- Yönetim → QR Menü (`/dashboard/qr-menu`): yetkili şubeyi seçin, menüyü yayınlayın ve servis anahtarlarını kaydedin. Başlangıçta tüm anahtarlar kapalıdır.
- Şube genel QR kodu yalnız menüyü açar. Masa kartından QR oluşturmak, menüye masa bağlamını ekler.
- Masa kodunun ham bağlantısı yalnız oluşturma/yenileme sırasında gösterilir. PNG dosyasını indirin veya bağlantıyı kopyalayın. Sonradan tekrar görüntülemek yerine yeni kod üretilir; önceki kod geçersiz olur. Kod iptali de desteklenir.
- Public menü `/menu/[publicToken]?table=[tableToken]`; yeni slug veya ikinci ürün kataloğu yok. Mevcut işletme ürünlerinden yalnız aktif/satılabilir ürün adı, açıklama, kategori ve kayıtlı fiyat gösterilir. Organizasyonun ortak kataloğu kullanılır; stok yokluğu menüden ürün gizlemez.
- Geçerli aktif masa olmadan servis butonları görünmez. Doğrudan public POST da tokenı işletme/şube/aktif masa ile tekrar doğrular.
- Hesap İste için açık adisyon gerekir. Adisyon kilit altında tekrar doğrulanır. Kapanmış/eski adisyon talebi yeni adisyona taşınmaz; gerektiğinde personelin önce eski talebi kapatması istenir.
- Talep oluşturma, üstlenme veya tamamlama ödeme, satış, stok, fiş ya da adisyon kapatma işlemi değildir.

## Personel paneli

Masalar ve Adisyonlar ekranında açık servis talepleri ve sayfalı geçmiş gösterilir. Masa, şube, tür, zaman, bekleme süresi, durum ve personel adları bulunur.

Durum akışı: `PENDING → ACKNOWLEDGED → COMPLETED`; açık talepler yetkili personel tarafından `CANCELLED` durumuna getirilebilir. Normal personel önce üstlenir ve yalnız kendi aktif user/profile kimliğiyle üstlendiği kaydı tamamlar/iptal eder. `tables.manage` yetkili yöneticiler açık talepleri iptal edebilir veya üstlenilmiş talepleri tamamlayabilir. Her değişiklik mevcut audit altyapısına yazılır. Eşzamanlı güncelleme, önceki durum ve sahiplik alanlarıyla koşullu atomik update kullanır; yarışta kaybeden 409 alır.

- OWNER / ADMIN / MANAGER: QR ayarları, kodlar, servis okuma/yönetme.
- WAITER: yetkili şubelerde servis okuma/yönetme.
- CASHIER: yetkili şubelerde servis okuma; değiştirme/QR ayarı yok.
- KITCHEN / STAFF: varsayılan servis erişimi yok.

Panel görünürken 5 saniyede bir yenilenir; önceki istek tamamlanmadan yenisi başlamaz. 12 saniyelik istek zaman aşımı, hatada 10–60 saniye gecikme, sekme arka plandayken duraklama ve görünür olunca yenileme uygulanır. Yeni talep görsel uyarı üretir; ses varsayılan kapalıdır ve kullanıcı düğmeye basıp AudioContext açtıktan sonra çalar. Web Push/SMS/WhatsApp veya QR sipariş/ödeme yok.

## Güvenlik ve veri tutarlılığı

- 32 bayt kriptografik rastgele masa token'ı; veritabanında yalnız SHA-256 özeti. Genel menü anahtarı da rastgele 32 bayttır, özel finans/personel API yetkisi vermez.
- Ham tokenlar audit/log mesajlarına yazılmaz; QR üretimi qrcode paketiyle tarayıcı içinde yapılır, üçüncü taraf QR servisi kullanılmaz.
- Public POST strict same-origin, JSON content-type/2048 bayt sınırı, dar alan/tür/token doğrulaması kullanır. organizationId/branchId gibi ek alanlar reddedilir.
- Aynı masa için transaction satır kilidi + açık `(tableId,type)` partial unique index: bir açık kayıt. Aynı tür yeni kayıtta 30 saniye bekleme; masa başına 60 saniyede en fazla 6 sayılan oluşturma denemesi. Açık kayıt tekrarında kayıt açılmaz.
- Ek süreç içi limiter en fazla 4096 anahtar tutar. Varsayılan güvenilmeyen IP başlıklarına güvenmez; süreç başına paylaşılan 300/dakika koruma kullanır. Dağıtım proxy'si başlığı temizliyorsa `QR_TRUSTED_IP_HEADER` ile IP başına 30/dakika etkinleştirilebilir. Bu ek IP katmanı çok instance arasında ortak değildir; masa başına veritabanı limiti ortaktır. Token fiziksel masada bulunmayı kanıtlamaz.
- Public yanıt talep kimliği, adisyon numarası/tutarı veya personel verisi döndürmez. Menü `hasOpenTab` boolean'ı yalnız hesap düğmesini yönetir.
- Menüde no-referrer/noindex/nofollow; API yanıtları private/no-store/nosniff. 429 yanıtlarında Retry-After verilir.
- Personel API ve servis katmanında oturum, izin, organization ve branch kapsamı uygulanır. İstemciden işletme seçimi kabul edilmez.
- BranchQrMenu ve ServiceRequest bileşik FK'leri işletme/şube/masa/adisyon tutarlılığını korur; geçmişi olan kayıtların bağlı masa/adisyonu fiziksel silinemez. Personel profili FK'leri işletme kapsamlıdır.
- Mevcut masalar API'si yalnız eski public alanları açıkça seçer; QR token özeti veya rate-limit alanlarını yanıtına eklemez.

## Migration ve canlı geçiş

Onaylanan tasarım: [qr-service-requests-design.md](qr-service-requests-design.md).

Migration: `20261024010000_add_qr_service_requests`.

SQL SHA-256: `ac5be184f9ac2508e56e7f5bb214229a7c622ee5d68320c5601244218f3158ac`.

Yeni BranchQrMenu / ServiceRequest tabloları, iki enum, mevcut RestaurantTable üzerinde nullable token/zaman alanları ve sıfır varsayılanlı sayaç, masa/adisyon bileşik unique indeksleri ve servis indeksleri eklenir. Mevcut iş verileri silinmez veya taşınmaz. Otomatik yayınlama, token backfill veya servis talebi oluşturma yoktur.

**Canlı Neon migration 24 Ekim 2026'da kullanıcıdan ayrıca açık canlı onayı alındıktan sonra uygulandı.** 24 migration tamamlanmış durumda; yalnız onaylı QR migration'ı uygulandı. Mevcut iş verilerinin tüm satır sayıları ve içerik özetleri korundu. QR API'lerinde eksik tablo/alan için bulunan 503 kontrolü, farklı eski kurulumlarda geçerli kalır.

Yeni yedek: `.backups/wellpos-before-qr-service-2026-10-23T23-35-12-312Z` (Türkiye saatiyle 24 Ekim 02:35). 39 tablo, 200733 bayt; SHA-256 `e838d19266aaf6c2c2d44370705ea444a183bdf559dbb277457b9c2dd991f5b5`. Arşiv tam okuma, gerçek localhost restore, tüm tablo satır sayıları ve migration provası geçti. Canlı uygulamada yedek yaşı, checksum, önceki migration geçmişi ve yalnız hedef migration'ın beklediği tekrar doğrulandı.

Canlı sonrasında yeni tabloların boş olduğu, mevcut masalara token/yayın ayarı eklenmediği, tüm FK/CHECK/unique/partial indekslerin geçerli olduğu doğrulandı. QR ayarları, açık/geçmiş talepler, mevcut masa/adisyon okumaları ve geçersiz public token davranışı gerçek Neon üzerinde READ ONLY transaction ile kontrol edildi. Canlı fixture, token veya oturum oluşturulmadı. Bu servis smoke kontrolü mevcut OWNER üyeliğiyle servis katmanını çalıştırır; tarayıcı oturumu açma/E2E kontrolü değildir. Uygulamanın ayrı bir hosting ortamına yayınlanması yapılmadı.

Kanıtlar: [preflight](migrations/qr-service-preflight.json), [migration doğrulaması](migrations/qr-service-verification.json), [canlı salt-okunur servis kontrolü](qr-service-live-readonly.json). Şube yayın ve servis anahtarları varsayılan kapalıdır; kullanıcı QR Menü ekranından etkinleştirir.

## Dosyalar

- `prisma/schema.prisma`, `prisma/migrations/20261024010000_add_qr_service_requests/migration.sql`
- `src/lib/qr-service.ts`, `src/lib/permissions.ts`
- `src/app/menu/[token]/{page,not-found,error}.tsx`
- `src/app/api/menu/[token]/requests/route.ts`
- `src/app/api/qr-menu/[branchId]/route.ts`, `tables/[tableId]/route.ts`
- `src/app/api/restaurant/service-requests/route.ts`, `[id]/route.ts`
- `src/app/api/restaurant/tables/route.ts` (eski response alanlarını açık select ile koruma)
- `src/components/qr-menu/{PublicMenu,QrMenuManager}.tsx`
- `src/components/restaurant/ServiceRequestsPanel.tsx`
- `src/app/dashboard/qr-menu/{page,layout}.tsx`, `src/app/dashboard/tables/page.tsx`
- `src/components/dashboard/{Sidebar,DashboardHeader}.tsx`, `next.config.ts`
- `package.json`, `package-lock.json` (yerel QR üretimi için qrcode ve TypeScript türleri)
- `tests/qr-service.integration.test.cjs`, `tests/qr-ui.test.cjs`, `tests/rbac.test.cjs`, `scripts/test-qr-local.cjs`
- Canlı geçiş: `scripts/qr-deployment-checks.cjs`, `scripts/deploy-qr-migration.cjs`, `scripts/check-qr-live.cjs`, `scripts/verify-neon-backup.cjs` (QR prova seçeneği); `docs/migrations/qr-service.sql` ve doğrulama JSON kayıtları.

## Doğrulama

- `node scripts/test-qr-local.cjs --all`: 94 geçti, 0 hata/skip. QR migration'ı yeni localhost PostgreSQL'e önceki tüm migration'larla uygulandı; POS/iade, checkout, cari, gider, fatura, ödeme, müşteri, tedarikçi, rapor regresyonları dahil.
- `node scripts/test-qr-local.cjs`: 17 geçti, 0 hata/skip. İstenen 15 senaryo, gerçek eşzamanlı çağrı/üstlenme, token iptal/yenileme, kapalı/eski adisyon, DB constraintleri ve rate/origin kontrolleri.
- `node --test tests/qr-ui.test.cjs`: 2 geçti. Public düğmeler/JSON isteği ve kontrollü hook/timer ile otomatik güncelleme, görünür uyarı, opt-in ses, arka plan duraklama, hata backoff ve cleanup doğrulandı. Gerçek tarayıcı ses izninin uçtan uca testi değildir.
- `node --test tests/*.test.cjs`: 93 geçti, 0 hata; veritabanı bayrakları olmayan bu komutta 12 integration testi bilinçli skip edildi. Veritabanlı ilgili senaryolar yukarıdaki localhost komutlarıyla ayrıca çalıştırıldı. Yeni public QR POST'un personel oturumu istememesi RBAC taramasında yalnız bu route için tanımlandı; origin/rate/token güvenlik akışı ayrı test edilir. Diğer personel API'leri merkezi permission wrapper zorunluluğunu korur.
- Prisma validate, TypeScript, değiştirilen dosyalar ESLint ve nihai `npm run build`: geçti. Üretim derlemesi son stil kapsayıcısı düzenlemesini de içeriyor; public menü, QR yönetimi ve servis API route'ları derleme çıktısında mevcut.
- Gerçek bileşenlerden sentetik verilerle üretilmiş statik önizleme: 390px mobil ve masaüstü görünümünde menü, personel paneli ve QR ayarları incelendi. Koyu sistem temasındaki yazı kontrastı için ortak stil kapsayıcısı eklendi. Bu kontrol oturum açılmış canlı tarayıcı E2E testi değildir; gerçek API/DB işlemleri integration testleriyle doğrulandı.
- İlk geniş test turunda build ile aynı anda çalışan cari fixture işlem başlatma zaman aşımı verdi; derleme kapalıyken bütün paket 94/94 geçti. İlk build `.next/dev/types` bozuk üretilmiş dosyalarına takıldı; yalnız ilgili üretilmiş dosyalar kaldırılıp Next typegen ile yenilendi. Kaynak şema veya operasyonel finans kodu değiştirilmedi.

MVP sınırları: ürün menüsü en fazla 1000 kayıt (aşım sessiz kesilmez), QR yönetiminde ilk 500 masa açık bilgiyle gösterilir; servis listeleri 50 kayıt/sayfa. Katalog/stok/finans için ikinci veri kaynağı yok.

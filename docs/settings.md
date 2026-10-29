# Yönetim / Ayarlar — MVP

## Tema seçenekleri

Koyu POS görünümü ayrıca yumuşak gri-mavi yüzeyler, ayrı ürün/sepet zeminleri, yeşil fiyat/toplam ve satış düğmesi, belirgin seçili durumlar ve klavye odağıyla düzenlendi. Ana metin/fiyat/yardımcı metin/seçim/satış düğmesi renk çiftlerinin hesaplanan kontrastları 5.47:1–9.84:1 arasında. POS barkod ve fiş testleri 15/15 başarılı; TypeScript ve hedefli lint kontrolünde hata yok (önceden mevcut ürün görseli uyarısı sürüyor). Değişiklikler `src/components/pos/POSManager.tsx` ve `src/app/globals.css` içinde, yalnızca koyu POS ekranına sınırlıdır.

Ayarlar içindeki Görünüm ve Tema bölümünde renk önizlemeleriyle Açık, Sıcak, Gece, Grafit, Okyanus ve Orman hazır paletleri ile Sistem seçeneği vardır. Eski light/dark/system tercihlerinin anahtarları geçerliliğini korur. Paletler zemin, yüzey, metin, kenarlık ve işlem renklerini ortak semantik değişkenlerle yönetir; hata/başarı/masa durum renkleri anlamlarını korur. Palet kataloğu src/lib/theme-presets.ts içinde tanımlıdır. Varsayılan Açık mevcut görünümü korur. Seçim `wellpos:theme:<userId>` anahtarında bu tarayıcının localStorage alanında saklanır; aynı kullanıcının sekmeleri değişikliği izler. Sistem tercihi işletim sistemi açık/koyu değişikliğini izler. Diğer kullanıcıların kayıtları ayrı tutulur; cihazlar arasında eşitleme yapılmaz. Tarayıcı depolaması kapalıysa kaydetme hatası gösterilir.

Tema yalnızca dashboard kapsamındadır; yönetim, POS ve finans yüzeylerini kapsar. Tema CSS'i ekran ortamına sınırlıdır; satış fişinin izole iframe baskı belgesi ve kamuya açık QR Menü değiştirilmez. Veritabanı/migration eklenmedi. Dosyalar: `src/lib/theme.ts`, `src/components/settings/DashboardTheme.tsx`, `ThemeOptions.tsx`, `SettingsManager.tsx`, `src/app/dashboard/settings/page.tsx`, `src/app/dashboard/layout.tsx`, `src/components/finance/FinanceLayout.tsx`, `src/app/globals.css`. TypeScript ve hedefli ESLint kontrolü ile mevcut 6 Ayarlar testi başarılı.

27 Ekim 2026. Yol: `/dashboard/settings`.

## Mevcut altyapı değerlendirmesi

- Organization yalnızca ad/slug, Branch ad ve organizasyon ilişkisini taşıyordu; merkezi OrganizationSettings/BranchSettings modeli yoktu. Onboarding işletme ve ilk şubeyi oluşturur.
- Yazıcı ayarlarının tek kaynağı `BranchPrinterSetting` ve `printer-settings.ts`. QR müşteri servis seçeneklerinin tek kaynağı `BranchQrMenu` ve `qr-service.ts` olarak kaldı.
- POS ve adisyon mevcut şube stok kaydını atomik `quantity >= requested` koşuluyla düşürüyordu. Hammadde/satılabilir ürün ayrımı Product.isSellable ile korunur. Reçete hammadde tüketimi Üretim modülünde yapılır; satışa ikinci bir hammadde düşümü eklenmedi.
- Kritik stok eşikleri BranchStock.criticalLevel içinde ürüne ve şubeye özeldir. Eski dashboard uyarı listesi örnek veriydi; seçili şubenin gerçek kritik stok sorgusuyla değiştirildi.
- Auth.js v5 JWT oturumu kullanır; Google ve yerel credentials girişleri vardır. Parola değiştirme/sıfırlama veya diğer cihazların oturumlarını yönetme altyapısı yoktur.
- Etkin üyelik/personel profili, merkezi RBAC, tenant/şube kapsamı, same-origin kontrolü ve mevcut AuditLog yeniden kullanıldı.

## Veri modeli ve onay sınırı

Kullanıcı aşağıdaki şema değişikliğini bu görevde onayladı:

1. Organization'a isteğe bağlı ticari unvan, tür, telefon/e-posta/web, adres/il/ilçe, vergi bilgileri ve logo URL alanları. Mevcut name kullanılır, slug ve şube adları değiştirilmez. Para birimi bu sürümde sabit TRY; ikinci para birimi kaynağı oluşturulmadı.
2. Tek BranchSettings modeli. POS/stok/bildirim politikaları şube bazındadır; kayıt yoksa tanımlı varsayılanlar geçerlidir. Organizasyon genelinden örtülü miras yoktur. Bölümler aynı satırda yalnızca kendi alanlarını günceller.
3. Mevcut BranchPrinterSetting'e showOrganization/showBranch alanları. Diğer fiş ayarları kopyalanmadı.
4. Order.businessSnapshot. Yeni POS/adisyon satışında işletme bilgisi kaydedilir. İşletme bilgisi değişmeden önce snapshot'ı olmayan eski satışlar eski işletme bilgisiyle sabitlenir. Mevcut fatura snapshot'ları korunur; eski kesinleşmiş ve snapshot'ı bulunmayan faturalarda işletme adı sabitlenir. Satış tutarları, indirimler, finans ve stok hareketleri yeniden hesaplanmaz.

Migration: `prisma/migrations/20261027020000_add_management_settings/migration.sql`. Yalnızca alan/tablo/indeks/kısıt ekler; geçmiş satış snapshot doldurması migration sırasında değil, ilk işletme bilgisi değişikliğinin transaction'ında yapılır. Yeni modelin bileşik FK'sı organizationId/branchId tutarlılığını sağlar; ödeme/indirim/rol/eşik seçenekleri DB CHECK ile de sınırlıdır.

**Bu görevin migration'ı Neon'a uygulanmadı.** Canlı uygulamadan önce yeni Neon yedeği alınmalı, geri yüklenebilirliği doğrulanmalı ve kullanıcıdan ayrıca canlı migration onayı alınmalıdır. Önceki Entegrasyonlar migration onayı bu değişikliği kapsamıyor.

## Varsayılanlar ve çalışan davranış

| Ayar | Varsayılan / kapsam |
| --- | --- |
| Ödeme | CASH; seçili şube, POS başlangıç tercihi |
| İndirim | OWNER/ADMIN/MANAGER/CASHIER; en fazla %100 |
| İade | OWNER/ADMIN/MANAGER; açıklama isteğe bağlı |
| POS müşteri seçimi | OPTIONAL; anonim satış serbest |
| Negatif stok | Kapalı; POS ve adisyon yeterlilik kontrolü sürer |
| Kritik stok | Açık; yeni stok kaydı varsayılan eşiği 0 |
| Uygulama içi bildirimler | Açık; garson/hesap/kritik stok uyarıları açık |
| Ses izni | Şubede kullanılabilir; gerçek ses yine kullanıcı düğmesiyle açılır, kendiliğinden başlamaz |
| Fiş | Mevcut 80 mm / manuel varsayılanı, işletme ve şube adı görünür |

İndirim limiti API transaction'ında uygulanır. Yüzdeli indirimde girilen yüzde, sabit tutarlı indirimde ara toplama oranı kontrol edilir. Mevcut parasal yuvarlama korunur. İndirim/iade rol listeleri mevcut RBAC yetkisini genişletemez.

REQUIRED müşteri seçimi yalnızca POS satış API'sinde anonim satışı bilinçli olarak engeller; HIDDEN müşteri gönderilmesini de API'de reddeder. Restoran adisyonları bu POS seçeneğinden etkilenmez.

Negatif stok kapalıyken koşullu atomik decrement, açıkken atomik upsert/decrement kullanılır. Aynı anda yapılan satışlar kayıp güncelleme oluşturmaz. Eksik stok kaydı yalnızca açık politika ile oluşturulabilir. Transfer/üretim yeterlilik kontrolleri korunur. Politikalar satış transaction'ında sunucudan okunur; istemci politikası güvenlik kaynağı değildir. İşletme ve şube kilitleri ayar güncellemeleriyle sıraya konur.

Varsayılan kritik eşik yeni stok girişi/düzeltme, hedefe transfer, üretim, negatif stok satışı veya eksik stok iade kaydında kullanılır. Mevcut ürün eşiği, sıfır dahil, açık bir ürün tercihi sayılır ve değiştirilmez. Genel eşiği değiştirmek geçmiş stok kayıtlarına toplu güncelleme yapmaz.

## Ekran ve yetkiler

Altı bölüm: İşletme Bilgileri, POS Ayarları, Stok Ayarları, Fiş ve Belge Ayarları, Bildirim Ayarları, Güvenlik ve Oturum. Bölümler kapsam etiketi taşır; ayrı yükleme/kaydetme ve hata/başarı durumu vardır. Kaydedilmemiş değişiklik uyarısı; sayfa kapanışı, bağlantıyla ayrılma ve işletme/şube seçicileri için uyarı vardır. Önceki şube isteği AbortController ile iptal edilir; formlar şube/işletme anahtarıyla yeniden oluşturulur.

- OWNER ve tüm şubelere erişebilen ADMIN işletme bilgilerini düzenleyebilir. Şube kapsamı kısıtlı ADMIN işletme genelini değiştiremez.
- OWNER/ADMIN yetkili olduğu şubede POS/stok politikalarını değiştirebilir.
- MANAGER yetkili şubesinin bildirim tercihlerini değiştirebilir; kritik mali/stok politikalarını değiştiremez.
- Yazıcı değişikliği mevcut integrations.manage yetkisine bağlıdır. Ayarlar ve Entegrasyonlar aynı API ve tabloyu kullanır.
- Kişisel güvenlik ekranı tüm mevcut roller için erişilebilir. Kullanıcı adı/e-posta, etkin rol/yetkiler, giriş sağlayıcıları, mevcut giriş zamanı ve oturum geçerliliği gösterilir. Yerel şifre varlığı yalnızca boolean olarak belirlenir; hash/token/session kimliği istemciye aktarılmaz. OAuth-only kullanıcıya yerel parola akışı gösterilmez. Mevcut Çıkış Yap akışı kullanılır.
- Logo mevcut UploadThing üzerinden ayrı, yetki kontrollü businessLogo uploader ile yüklenir. HTTPS ve mevcut UploadThing alan adları doğrulanır. Yeni secret/environment değişkeni eklenmedi.

API uçları: `GET/PATCH /api/settings/organization`, `GET/PATCH /api/settings/branches/[branchId]`. İstemciden organizationId kabul edilmez. Şube erişimi tenant ve membership/personel kapsamıyla doğrulanır. Yanıtlar private/no-store; alan izin listesi, sunucuda iletişim/vergi/URL doğrulaması ve same-origin uygulanır. Kritik değişiklikler aynı transaction'da kullanıcı, organizasyon/şube, zaman ve changedFields ile AuditLog'a yazılır. Vergi numarası, iletişim değerleri, parola ve token audit metadata'ya kopyalanmaz.

## Bildirimler ve MVP sınırları

Garson/hesap uyarı tercihleri QR servis listesi yanıtındaki notificationPolicy ve uyarı için latestId sorgusuna yansır. Bekleyen/geçmiş talepler filtrelenip kaybedilmez; müşteri düğmelerinin etkinliği mevcut QR Menü ayarlarında kalır. Ses politikası kapalıysa ses çalınmaz. Görünür sayfada mevcut 5 saniyelik polling ve tarayıcıda kullanıcıyla başlatılan ses kullanılır. Push, e-posta, SMS veya arka plan otomasyonu eklenmedi.

Kritik stok bildirimi seçili şubenin gerçek yönetici dashboard listesidir; tarayıcı açık değilken bir kanala bildirim göndermez. Genel eşik mevcut ürün eşiklerini yeniden yazmaz. Reçete tüketim modeli, otomatik banka iadesi, mali fiş ve e-Belge entegrasyonu eklenmedi. Yazdırma tarayıcı penceresidir; sessiz baskı değildir.

Diğer cihazlardan çıkış, parola sıfırlama, abonelik/faturalandırma, gelişmiş güvenlik, tema editörü ve çoklu para birimi bu sürümde yoktur.

## Doğrulama

```powershell
node node_modules/prisma/build/index.js validate --config prisma7.config.ts
node node_modules/prisma/build/index.js generate --config prisma7.config.ts
node node_modules/typescript/bin/tsc --noEmit
node --test tests/settings.test.cjs tests/integrations.test.cjs tests/pos-receipt.test.cjs tests/pos-orders-receipt.test.cjs tests/order-refunds.test.cjs tests/rbac.test.cjs tests/qr-ui.test.cjs tests/product-sellability.test.cjs tests/cash-management.test.cjs
node scripts/test-settings-local.cjs --all
```

Test yardımcısı yalnızca yeni localhost PostgreSQL'e bağlanır; dış DATABASE_URL değerini geçersiz kılar. Migration'lar bu geçici veritabanında uygulanır; sonunda sunucu kapatılır. Canlıda test kaydı oluşturulmaz.

27 Ekim 2026 sonuçları:

- Prisma şema doğrulaması ve yerel Client generate başarılı.
- TypeScript `tsc --noEmit` başarılı.
- 61 birim/bileşen/regresyon testi başarılı, atlanan test yok. OAuth-only ekran, bölüm bazlı kayıt, eski şube yanıtının iptali, barkod, snapshot fişi ve yetki denetimi dahil.
- Son geniş localhost PostgreSQL paketi: **119/119 başarılı**, atlanan test yok. POS/Finans, QR Menü, rapor, müşteri, tedarikçi, cari, gider, fatura, ödeme, entegrasyon, adisyon ve şema uyumluluğu dahil. Ayarlar paketindeki 16 senaryo ve üst test toplam 17 test olarak sayılır.
- Değişen uygulama dosyalarında ESLint hatası yok; mevcut POS ürün `<img>` etiketi için tek Next.js performans uyarısı var. Regresyon testlerinde mevcut pg eşzamanlı sorgu deprecation uyarıları çıktı; hata oluşturmadı.
- Bu görevde Neon migration, db push veya veri silme yapılmadı.

Şema eksik olduğunda POS politikaları güvenli eski varsayılanlarla devam eder. Ayar yazmaları 503 ile kapatılır. Yeni sütunları olmayan satış okuma/yazmaları eski kolonları seçer; onboarding de yeni işletme sütunlarını döndürmeye zorlanmaz. İşletme formu şema beklediğini bildirir. Yazıcı alanları eksikse mevcut fiş varsayılanları korunur.

## Değiştirilen dosyalar

- Yeni sayfa/formlar: `src/app/dashboard/settings/page.tsx`, `src/components/settings/SettingsManager.tsx`, `SettingsForm.tsx`.
- Yeni ayar servisleri: `src/lib/settings.ts`, `settings-policy.ts`, `settings-service.ts`, `settings-navigation.ts`, `stock-alerts.ts`.
- Yeni API'ler: `src/app/api/settings/organization/route.ts`, `src/app/api/settings/branches/[branchId]/route.ts`.
- POS/iade/adisyon: `src/app/api/orders/route.ts`, `src/app/api/orders/[id]/refund/route.ts`, `src/app/api/restaurant/tabs/[id]/checkout/route.ts`, `src/components/pos/POSManager.tsx`, `SaleReceipt.tsx`, `src/components/orders/OrderManager.tsx`, `src/app/dashboard/pos/page.tsx`, `src/app/dashboard/orders/page.tsx`.
- Stok varsayılanları: `src/app/api/stock/route.ts`, `src/app/api/stock/movements/route.ts`, `src/app/api/stock/transfers/route.ts`, `src/app/api/productions/route.ts`.
- Ortak yazıcı: `src/lib/integrations.ts`, `printer-settings.ts`, `src/components/integrations/IntegrationsManager.tsx`.
- QR/bildirim: `src/lib/qr-service.ts`, `src/components/restaurant/ServiceRequestsPanel.tsx`, `src/components/dashboard/StockAlerts.tsx`, `src/app/dashboard/page.tsx`.
- RBAC/gezinme: `src/lib/permissions.ts`, `src/components/dashboard/Sidebar.tsx`, `BranchSelector.tsx`, `OrganizationSelector.tsx`.
- Logo/şema uyumluluğu: `src/app/api/uploadthing/core.ts`, `src/lib/customer-schema.ts`, `src/app/api/onboarding/route.ts`, `src/app/api/customers/[id]/orders/[orderId]/route.ts`.
- Şema: `prisma/schema.prisma`, `prisma/migrations/20261027020000_add_management_settings/migration.sql`.
- Test/rapor: `tests/settings.test.cjs`, `tests/settings.integration.test.cjs`, `tests/integrations.test.cjs`, `tests/pos-receipt.test.cjs`, `scripts/test-settings-local.cjs`, `docs/settings.md`.

## Açık dağıtım ve kullanım sınırları

- Neon migration için yeni, doğrulanmış yedek ve ayrıca canlı onay gerekir. Migration uygulanana kadar yeni ayarların canlı kaydı kapalıdır.
- Fiziksel yazıcı/okuyucu ve gerçek UploadThing yüklemesi bu otomatik testlerin kapsamı değildir; mevcut yapılandırma ve cihazla kullanıcı denemesi gerekir.
- Aynı bölüm iki yönetici tarafından düzenlenirse en son başarılı kayıt geçerlidir. Farklı bölümler birbirlerinin alanlarını yazmaz.
- Dashboard'daki diğer eski örnek KPI/grafikler bu görevin kapsamında yenilenmedi; yalnızca kritik stok sayısı/listesi gerçek veriye bağlandı.

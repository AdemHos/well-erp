# Yönetim / Entegrasyonlar

## Canlı migration — 27 Ekim 2026

Kullanıcının canlı migration onayıyla `20261027010000_add_branch_printer_settings` Neon'a uygulandı. Artık şube yazıcı ayarlarının kalıcı kaydı kullanılabilir. Aşağıdaki ilk geliştirme raporundaki "Neon'a uygulanmadı" ifadeleri bu geçişten önceki durumu anlatır.

- Yeni yedek: `.backups/wellpos-before-integrations-2026-10-26T22-08-40-187Z/wellpos.dump` (27 Ekim 01:08:40 Europe/Istanbul), 218405 bayt, 41 tablo.
- SHA-256: `3db6dfabe6c7f7db4b8a884b5afe6f1bd7d9f971cf6c4683f79a2d33f3cadaac`.
- Arşiv listesi/tam okuma, bağımsız localhost'a restore, 41 tablonun satır sayımları ve gerçek veri kopyasında migration provası başarılı. Yerel doğrulama sunucusu kapatıldı, geçici parolası kaldırıldı.
- Canlı ön kontrolde önceki 24 migration checksum'ı ve yedekle eşleşmesi doğrulandı; yalnızca onaylanan migration bekliyordu.
- Migration sonrası 25 tamamlanmış migration doğrulandı. Mevcut iş tablolarının satır sayıları ve içerik özetleri korundu. Yeni tablonun FK/CHECK/indeksleri doğrulandı; otomatik kayıt/backfill oluşturulmadı.
- Prisma uygulama servisiyle READ ONLY transaction içinde mevcut şubenin ayarları okundu: `storageReady=true`. Yanıt alan izin listesi doğrulandı; canlı test kaydı oluşturulmadı, sır veya işletme değerleri loglanmadı.
- Kanıtlar: `docs/migrations/integrations-preflight.json`, `integrations-verification.json`, `integrations-live-readonly.json`; uygulanan SQL: `docs/migrations/integrations.sql`.
- Bu geçişte eklenen yardımcılar: `scripts/integration-deployment-checks.cjs`, `deploy-integrations-migration.cjs`, `check-integrations-live.cjs`. `scripts/verify-neon-backup.cjs` içine `--integrations-rehearsal` seçeneği eklendi. Bu yardımcıların ESLint ve sözdizimi kontrolleri başarılı.

## Kapsam ve mevcut altyapı

`/dashboard/integrations` beş kategoride sekiz katalog kartı sunar. Katalog kodda tutulur; kullanılmayan IntegrationProvider, OrganizationIntegration ve IntegrationEventLog tabloları eklenmedi. Destek (`AVAILABLE`, `COMING_SOON`) ile bağlantı (`CONNECTED`, `DISCONNECTED`, `ERROR`) ayrı tiplerdir. Tarayıcı yazdırması ve klavye tipi okuyucu için fiziksel bağlantı izlenmediğinden katalog bağlı durumu üretmez. Diğer servisler Yakında ve ayar düğmeleri devre dışıdır.

- Organization ve Branch mevcut tenant/şube kapsamıdır; Membership ve etkin personel profili üzerinden mevcut RBAC kullanılır.
- SaleReceipt, React portalı ve izole iframe üzerinden 58/80 mm tarayıcı çıktısı üretir. Başlık/alt mesaj React tarafından kaçırılır, kullanıcı verisi srcDoc içine yazılmaz. Mali belge uyarısı korunur.
- Product.barcode organizasyon içinde benzersizdir. POS yalnızca mevcut organizasyonun aktif, satılabilir ürünlerini yükler. Arama alanında Enter, tam barkod eşleşmesini kategori filtresinden bağımsız sepete ekler. Aynı üründe mevcut sepete ekleme miktarı artırır. Global klavye dinleyicisi yoktur; normal yazma, IME ve diğer alanlar etkilenmez. Okuyucu klavye modu ve Enter sonlandırıcısıyla kullanılmalıdır.
- ProductUnit, stok ve satış miktarları ondalıklı değerleri destekler. POS miktar arayüzü tamsayı adımlıdır; manuel ağırlık girişi ve terazi barkodu ayrıştırması henüz uygulanmamıştır. Cihaz protokolü/SDK bilinmediğinden Terazi Yakında gösterilir.
- CASH/CARD ödeme yöntemleri ve finans hesapları mevcut kayıt mekanizmasıdır; banka/terminal entegrasyonu değildir. Satış, stok, finans hesaplama ve ödeme servisleri değiştirilmedi.
- Merkezi işletme ayarları veya kalıcı yazıcı/entegrasyon modeli yoktu. Başka amaçlı QR ayarları ve audit tablosu ayar deposu olarak kullanılmadı.
- Prisma sunucuda DATABASE_URL kullanır; Auth.js sunucuda AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET kullanır. Hiçbir environment değeri okunup rapora/loga aktarılmadı; yeni secret veya NEXT_PUBLIC değişkeni eklenmedi.

## Şube yazıcı ayarları

Onaylanan tek yeni model `BranchPrinterSetting`: şube başına tek kayıt, organizationId, branchId, paperWidth, receiptHeader (160), receiptFooter (300), afterSalePrint, zaman damgaları. Bileşik FK şubenin organizasyonunu veritabanında doğrular. Migration CHECK kısıtları 58/80 ve MANUAL/OPEN_DIALOG değerlerini sınırlar.

`GET /api/integrations/printer/[branchId]` operasyonel fiş kullanıcılarına ve katalog yetkililerine izin verir. `PATCH` yalnızca integrations.manage yetkili OWNER/ADMIN için açıktır. MANAGER katalog/ayarları okuyabilir; değiştiremez. Her iki uçta organizasyon ve atanmış şube kontrol edilir; istemciden organizationId kabul edilmez. Yazma işlemi aynı origin kontrolü, alan izin listesi ve metin sınırları uygular. Ayarlar ile audit kaydı aynı transaction içindedir; fiş metinleri audit metadata alanına kopyalanmaz.

POS tamamlanan satış için şube ayarını yükler. OPEN_DIALOG tercihi tarayıcı yazdırma penceresini açmayı dener; sessiz baskı değildir. Tarayıcı otomatik pencereyi engellerse manuel Fiş Yazdır kullanılmalıdır. Geçmiş satışın yeniden yazdırılmasında güncel şube ayarları kullanılır; geçmiş sipariş açıldığında otomatik yazdırılmaz. Test fişi istemcide örnek veriden oluşturulur; sipariş/finans/stok yazmaz.

## Veritabanına alma

`prisma/migrations/20261027010000_add_branch_printer_settings/migration.sql` yalnızca yeni tablo/indeks/FK oluşturur; mevcut satırları güncellemez. Varsayılan 80 mm / manuel tercih mevcut şubelerde kayıt oluşturulmadan çalışır. Yerel Prisma Client yeniden üretilmelidir.

**Neon'a migration uygulanmadı.** Uygulamadan önce doğrulanmış Neon yedeği alınmalı ve dağıtım için ayrıca kullanıcı onayı alınmalıdır. Şema eksikse GET varsayılan ayarları storageReady=false ile döndürür, yönetim ekranı kaydetmeyi kapatır ve nedeni gösterir; PATCH 503 döndürür. POS mevcut varsayılan fişle çalışmayı sürdürür.

## Gelecekte gizli bağlantı bilgileri

Bu sürüm anahtar/token toplamaz veya saklamaz. Gerçek sağlayıcı geliştirildiğinde yalnızca kullanılan ihtiyaç için organizasyon/şube kapsamlı model eklenmeli. Credential düz metin alanı ve istemciye aktarılan genel JSON ayar alanı kullanılmamalı.

Önerilen strateji: sunucuda AES-256-GCM authenticated encryption; her yazmada benzersiz rastgele nonce; ciphertext, authTag, keyVersion; organizationId + branchId + provider kimliğinin AAD olarak doğrulanması. Master anahtar kaynak kodu/veritabanından ayrı secret manager/KMS içinde tutulmalı; NEXT_PUBLIC olmamalı. Güncel anahtarla yazma, geçiş süresince eski sürümle okuma, kontrollü yeniden şifreleme ve doğrulamadan sonra eski anahtarı devreden çıkarma uygulanmalı. Anahtar kaybı/yedek geri dönüşü için kurtarma planı gerekir. Bağlantı API'si yalnızca durum, sağlayıcı ve maskeli tanımlayıcı döndürmeli; decrypt işlemi sunucu connector sınırında yapılmalı. İstek/yanıt gövdeleri, token, authorization header, URL query ve sağlayıcı hata gövdeleri loglanmamalı. Event log gerekirse credential içermeyen izin listeli metadata, saklama süresi ve RBAC ile eklenmeli.

## Doğrulama komutları

```powershell
node node_modules/prisma/build/index.js validate --config prisma7.config.ts
node node_modules/prisma/build/index.js generate --config prisma7.config.ts
node node_modules/typescript/bin/tsc --noEmit
node --test tests/integrations.test.cjs tests/pos-receipt.test.cjs tests/pos-orders-receipt.test.cjs tests/rbac.test.cjs
node scripts/test-integrations-local.cjs --all
```

Yerel test yardımcısı rastgele port ve parola ile yeni localhost PostgreSQL başlatır, migration dosyalarını yalnızca bu veritabanına uygular ve sonunda sunucuyu durdurur; Neon DATABASE_URL değerini kullanmaz. `--all` ayrıca QR, rapor, tedarikçi, müşteri, cari, fatura, ödeme, gider ve POS/Finans regresyonlarını çalıştırır. Fiziksel yazıcı ve okuyucu donanımı olmadan gerçek kağıt baskısı/cihaz bağlantısı doğrulanmış sayılmaz.

## Değişen dosyalar

- `src/app/dashboard/integrations/page.tsx`: yetki kontrollü yönetim sayfası ve şube listesi.
- `src/components/integrations/IntegrationsManager.tsx`: katalog, şube ayar formu ve test fişi.
- `src/lib/integrations.ts`: destek/bağlantı tipleri, katalog, ayar doğrulama ve barkod arama.
- `src/lib/printer-settings.ts`: tenant/şube kontrollü kalıcı ayar servisi ve atomik audit.
- `src/app/api/integrations/printer/[branchId]/route.ts`: korumalı GET/PATCH uçları.
- `src/lib/permissions.ts`, `src/components/dashboard/Sidebar.tsx`: entegrasyon yetkileri ve aktif menü bağlantısı.
- `src/components/pos/POSManager.tsx`: odaklı barkod girişi ve satış sonrası şube fişi.
- `src/components/pos/SaleReceipt.tsx`: mevcut yazdırıcıya ayar yükleme, özel metin ve isteğe bağlı yazdırma penceresi.
- `prisma/schema.prisma`, `prisma/migrations/20261027010000_add_branch_printer_settings/migration.sql`: onaylanan tek model ve henüz Neon'a uygulanmayan migration.
- `tests/integrations.test.cjs`, `tests/integrations.integration.test.cjs`, `tests/pos-receipt.test.cjs`: katalog/POS etkileşimi, gerçek PostgreSQL izolasyonu ve fiş testleri.
- `scripts/test-integrations-local.cjs`: bağımsız localhost test yardımcısı.
- `docs/integrations.md`: kapsam, dağıtım, güvenlik ve test raporu.

## 27 Ekim 2026 test sonucu

- Prisma validate ve yerel Client generate başarılı; TypeScript `tsc --noEmit` başarılı.
- 54 birim/bileşen/regresyon testi başarılı; atlanan test yok.
- `node scripts/test-integrations-local.cjs --all`: 101 gerçek PostgreSQL testi başarılı; atlanan test yok. POS/Finans, QR, raporlar, müşteriler, tedarikçiler, cari, gider, fatura, ödeme ve checkout uyumluluğu dahil.
- Son eklenen migration eksikliği senaryosuyla yalnızca entegrasyon PostgreSQL paketi yeniden çalıştırıldı: 8/8 başarılı. Eksik tabloda varsayılan fişle devam etme ve yazmada 503 doğrulandı.
- Değiştirilen dosyalarda ESLint hatası yok. POSManager içindeki önceden mevcut ürün `<img>` etiketi için bir Next.js performans uyarısı bulunuyor.
- Regresyon testlerinde mevcut pg eşzamanlı sorgu kullanımına ilişkin deprecation uyarıları çıktı; test hatası oluşturmadı.
- Neon üzerinde migration, db push, fixture veya veri silme yapılmadı.

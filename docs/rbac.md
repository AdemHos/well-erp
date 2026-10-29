# Personel ve yetkilendirme MVP

Merkezi izinler: src/lib/permissions.ts. API ve sayfa kontrolleri: src/lib/rbac.ts. Her istekte aktif üyelik veritabanından okunur; rol değişikliği eski oturuma güvenmez.

## Kullanım
Personel ekranından rol ve şube seçerek davet oluşturun. Bağlantıyı güvenli bir kanaldan kendiniz iletin; e-posta gönderimi yapılmaz. Davet 72 saat geçerli, tek kullanımlık ve davet edilen e-postaya bağlıdır. Token yalnızca bağlantının fragment kısmındadır; veritabanında SHA-256 özeti tutulur.

Üyelik kaldırma pasifleştirmedir. Son aktif OWNER düşürülemez veya kaldırılamaz. ADMIN, OWNER/ADMIN atayamaz veya bu üyeleri yönetemez. Sınırlı şube yöneticisi kendi kapsamını genişletemez. Yeni şube açmak tüm şubelere erişim gerektirir.

Mevcut üyelikler migration ile aktif ve tüm şubelere erişimli kalır. OWNER tüm şubelere erişir. İşletme seçicisi yalnızca aktif üyelikleri gösterir. Menü görünürlüğü kolaylık sağlar; gerçek kontrol sunucudadır.

## Veri ve güvenlik
Onaylanan migration: prisma/migrations/20261021000000_staff_rbac/migration.sql. Uygulama öncesinde .env.backups altında pg_dump yedeği alındı ve arşiv doğrulandı. MembershipBranch, StaffInvitation, InvitationBranch ve AuditLog eklendi; mevcut satış/finans kayıtları silinmedi.

Personel değişiklikleri, satış/iade, manuel stok ve kritik finans kayıtları kendi transaction'larında audit kaydı oluşturur. Audit uygulama katmanında salt okunurdur; veritabanı yöneticisinin değiştiremeyeceği harici bir kayıt sistemi değildir.

## Kontroller
- npx tsc --noEmit
- node --test tests/*.test.cjs
- Gerçek veritabanı testleri: WELLPOS_RBAC_DB_TEST=1 ve WELLPOS_FINANCE_DB_TEST=1 ortam değişkenleriyle aynı test komutu.

Entegrasyon testleri geçici kullanıcı/işletme verilerini dış transaction sonunda rollback eder. Rol, şube/işletme izolasyonu, davet süre/tek kullanım/e-posta kontrolleri, son OWNER, audit hatasında rollback ve mevcut POS/finans/iade akışları kapsanır. Eşzamanlı OWNER değişimi testi tek dış transaction içinde sıralanan savepoint çağrılarını kullanır; bağımsız bağlantılarla üretim yük testi değildir. Üretimde kuruluş satır kilidi işlemleri serileştirir.

## Manuel kabul testi
OWNER ile personel ekranında bir şubeye CASHIER davet edin. Davet edilen e-postayla kabul edin. Satış ve fiş çalışmalı; finans yönetimi ve iade reddedilmeli. WAITER masa/sipariş işlemlerini, KITCHEN mutfak durumunu kullanmalı; POS/finans erişimi olmamalı. OWNER rolü değiştirdiğinde aynı oturumun sonraki API isteğinde eski yetki reddedilmeli. Başka şubenin ID'siyle doğrudan istek de reddedilmeli.

## MVP sınırları
Personel listesi en fazla 500, davet listesi 100, audit listesi son 100 kaydı gösterir. Özel rol düzenleyicisi, davet e-postası gönderimi ve ayrı yönetici onay akışı yoktur. Açık ekran menüsü rol değişiminden sonra yenilenene kadar eski görünebilir; sunucu işlemi yeni izinle değerlendirir. Oturumlu görsel kabul testi kullanıcı hesabıyla tamamlanmalıdır.

## Son doğrulama
37/37 test başarılı (iki gerçek Neon entegrasyon testi dahil); TypeScript ve değişen alanlara yönelik ESLint başarılı. Üretim derlemesi başarılı. Prisma migrate status: şema güncel. Oturumsuz personel erişiminin login yönlendirmesi ve genel davet sayfası tarayıcıda kontrol edildi.

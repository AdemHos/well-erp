# E-postasız personel profilleri

## İlk kullanım

1. Çalışan geliştirme sunucusunu yeniden başlatın: `npm run dev`.
2. Mevcut hesabınızdan çıkış yapıp yeniden giriş yapın. Yeni profil oturumları Auth.js girişine bağlandığı için eski oturumlarda yeniden giriş istenir.
3. “Kim kullanıyor?” ekranında kendi hesabınızı seçin. Altı haneli PIN belirleyin ve hesap şifrenizi girin. Google hesabında şifre alanı boş bırakılır; son beş dakika içinde giriş yapılmış olmalıdır.
4. Personel sayfasında **Personel Ekle** ile ad soyad, şube ve rol seçin. Oluşturulan PIN yalnızca bu ekranda bir kez görünür; personele güvenli şekilde iletin.
5. Sağ üstten **Profil Değiştir / Kilitle** seçin. Personel kartına tıklayıp PIN ile giriş yapın. Dashboard, menü ve sunucu izinleri etkin personele göre değişir.

Personel için e-posta veya telefon gerekmez. Ana işletme hesabının giriş bilgileri personelle paylaşılmaz; profil sistemi açık ortak cihaz oturumunda çalışır. Bağımsız cihazdan işletme hesabı olmadan personel girişi bu sürümün kapsamında değildir.

## Davranış

- Her profil, tek profil varsa bile PIN ile açılır. Birden fazla personel kartlarla listelenir.
- PIN beş yanlış denemeden sonra 15 dakika kilitlenir; denemeler veritabanında tutulur.
- Yönetici PIN sıfırlayabilir, rol/şube değiştirebilir veya profili pasifleştirebilir. Bunlar eski profil oturumlarını geçersiz kılar.
- Kendi gerçek hesap profilinizde PIN unutulursa hesap doğrulamasıyla yeni PIN kurulabilir. Google ile sıfırlama için son profil kullanımından sonra yeniden giriş yapılmış olmalıdır.
- Seçim değişimi ve başarısız seçim önceki yetkiye geri dönmez. Profil oturumu en fazla sekiz saattir. Yeni Auth.js girişi eski profil cookie'sini kullanamaz.
- Şube/işletme ve ana hesap yetkileri üst sınırdır. Bir yerel profil ana hesabın erişimini genişletemez. Başka gerçek kullanıcının hesap profiline geçilemez.
- Yerel OWNER oluşturulmaz. Mevcut sahiplik, son OWNER koruması ve gerçek kullanıcı üyelikleri korunur.
- Mevcut üyelik yönetimi ve audit kayıtları personel sayfasındaki kapalı bölümde korunur; yeni personel için e-posta daveti düğmesi gösterilmez.
- Aynı tarayıcıdaki sekmeler aynı profil cookie'sini paylaşır. Bir sekmede profil değişirse diğer sekmelerin sonraki işlemleri yeni sunucu bağlamını kullanır; işlemden önce ekran yenilenmelidir.

## Veritabanı ve değişen alanlar

Onaylanan migration: `prisma/migrations/20261021010000_staff_profiles/migration.sql`.
StaffProfile, StaffProfileBranch ve StaffProfileSession tabloları; AuditLog.actorProfileId ilişkisi eklendi. Gerçek hesap profilleri ilk doğrulanmış seçimde oluşturulur. Kullanıcı, satış, stok ve finans kayıtları silinmedi.

Migration öncesinde `.env.backups` altında 99.906 baytlık pg_dump yedeği alındı ve pg_restore ile tüm arşiv okunarak doğrulandı. SHA-256: `0b00679772281773efd8d0b653a9e1cfdbb09d58eec5122996e65aaff22918ae`. Bağlantı sırları belgeye veya çıktıya yazılmadı.

Başlıca dosyalar:

- `src/lib/staff-profiles.ts`: PIN, kalıcı kilit, profil kapsamı, oturum ve profil yönetimi.
- `src/lib/current-membership.ts`, `auth-context.ts`, `rbac.ts`, `staff-service.ts`, `audit.ts`, `src/auth.ts`: etkin profilin sunucu izinlerine ve audit'e bağlanması.
- `src/app/api/profile-session/route.ts`, `src/app/api/profiles/**`, `src/app/api/organizations/active/route.ts`, `src/app/api/audit/route.ts`: seçim, kilitleme, yönetim, işletme geçişi ve işlem kayıtları.
- `src/app/profiles/page.tsx`, `ProfilePicker.tsx`, `LocalStaffManager.tsx`, `StaffManager.tsx`, dashboard layout/header/staff/başlangıç sayfaları: seçim ve role uygun arayüz.
- `tests/staff-profile-access.test.cjs`, `tests/staff-profiles.integration.test.cjs`: yeni güvenlik testleri. RBAC testleri gerçek profil oturumlarıyla güncellendi.

## Doğrulama

`npx tsc --noEmit`, değişen dosyalarda ESLint ve `npm run build` çalıştırılır.
`node --test tests/*.test.cjs` varsayılan olarak veritabanı testlerini atlar.
Gerçek testler için `WELLPOS_PROFILES_DB_TEST=1`, `WELLPOS_RBAC_DB_TEST=1`, `WELLPOS_FINANCE_DB_TEST=1` kullanılır.

Veritabanı testleri dış transaction sonunda rollback edilir. Profil testi PIN kurulumu, hash saklama, yanlış PIN/kilit, rol yükseltme reddi, eski oturum iptali, şube/işletme izolasyonu, PIN sıfırlama, audit hatasında rollback ve kasiyer profilinden gerçek satış/finans kaydını kapsar. Savepoint testleri bağımsız bağlantılarla yük testi değildir.

Oturumlu görsel kabul testi gerçek kullanıcı hesabıyla ayrıca yapılmalıdır. Profil/personel listeleri en fazla 500 kayıt gösterir. Süresi dolmuş profil oturumları erişim sağlamaz; geçmiş oturum satırları için periyodik temizleme işi bu sürümde yoktur.

Son sonuç: 42/42 tam test paketi (üç Neon entegrasyon testi dahil) başarılı; ek Google PIN sıfırlama güvenlik testi de başarılı. TypeScript, değişen dosyalarda ESLint ve üretim derlemesi başarılı. Prisma şeması geçerli ve migration durumu güncel.

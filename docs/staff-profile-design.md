# E-postasız personel ve profil seçimi — onaylanan tasarım

Uygulandı. Güncel kullanım ve test bilgileri: [staff-profiles.md](staff-profiles.md).

## Kullanım akışı

- İşletmenin mevcut ana hesabı ve Auth.js giriş sistemi korunur. Personel için e-posta veya telefon istenmez.
- Yönetici, Personel Ekle ekranında ad soyad, şube ve rol seçer. Profilin ilk PIN'i oluşturma ekranında bir kez gösterilir; değiştirilebilir.
- İşletme hesabına girişten sonra birden fazla etkin profil varsa kartlarla “Kim kullanıyor?” ekranı açılır. Tek profil varsa da gerekli PIN doğrulaması yapılır.
- Personel kendi profilini ve PIN'ini seçer. Menü, dashboard, erişilebilir şubeler ve API izinleri seçili profile göre belirlenir.
- Sağ üstte etkin personelin adı ve rolü, Profil Değiştir ve Kilitle seçenekleri bulunur. Profil değişimi önceki personel yetkisini kaldırır; başarısız PIN denemesi eski yetkiye geri dönmez.
- Kasiyer satış/fiş ekranlarına; garson masa/siparişlere; mutfak çalışanı mutfağa; yönetici izinli yönetim ekranlarına ulaşır. Sunucu izinleri zorunludur.
- E-posta daveti bu personel akışında gösterilmez. Mevcut hesaplar, üyelikler ve geçmiş davet verileri silinmez.

## Önerilen veri modeli

StaffProfile: id, organizationId, name, role, isActive, allBranches, pinHash, credentialVersion, isteğe bağlı membershipId, createdAt, updatedAt.

StaffProfileBranch: profileId, organizationId, branchId. İşletme ve şube uyumu bileşik yabancı anahtarlarla korunur.

StaffProfileSession: ana oturum sahibi userId, organizationId, profileId, rastgele token özeti, expiresAt ve credentialVersion. Ham oturum token'ı yalnızca HttpOnly/SameSite cookie'de tutulur; sunucu ana Auth.js oturumu, işletme erişimi ve profil kapsamını her istekte doğrular. PIN deneme sınırı ve geçici kilit bilgisi kalıcı olarak saklanır.

AuditLog'a isteğe bağlı actorProfileId eklenir. Gerçek oturum sahibi actorUserId korunur; personel adına yapılan işlem ayrıca profille izlenir. PIN veya token audit'e yazılmaz.

Mevcut gerçek kullanıcıya bağlı yönetici profilleri Membership'e bağlanır; bunların rol ve şube yetkisinde mevcut Membership kaynak kabul edilir. Yerel personel profilinin yetkisi bağlı işletme ve kendi şube atamalarıyla sınırlıdır. Yerel personel OWNER olarak oluşturulmaz; sahiplik ve son OWNER koruması mevcut gerçek üyelikler üzerinden sürer.

## Güvenlik ve uyumluluk

- PIN önerisi: 6 rakam, hash olarak saklama, sınırlı deneme ve geçici kilitleme. Profil kartını seçmek tek başına yetki sağlamaz. Yönetici profilinin ilk PIN kurulumu ana hesabın yeniden doğrulanmasını gerektirir.
- Profil değişiminde cookie'ye yazılan rol/şube yetki kaynağı sayılmaz. Pasifleştirme, PIN sıfırlama ve rol değişiklikleri sunucuda eski erişimi geçersiz kılar.
- İşletme değiştirmek profil oturumunu temizler. Başka işletmenin profili kullanılamaz.
- Mevcut staff-service gibi transaction içinde üyeliği tekrar okuyan servisler, etkin profilin izinlerini de kontrol edecek şekilde genişletilir; ana hesabın OWNER rolüne geri düşülmez.
- POS, stok, iade, finans ve fiş davranışı korunur. Satış tutarı veya stok muhasebesi değiştirilmez.

## Mevcut verilere etkisi ve uygulama sırası

Yeni tablolar ve nullable audit ilişkisi eklenir. Kullanıcı e-postaları nullable yapılmaz; mevcut satış, stok, finans ve üyelik kayıtları değiştirilmez/silinmez. Mevcut üyelikler için bağlı profil oluşturma ve PIN kurulum adımı kontrollü biçimde uygulanır. Kurulum tamamlanmamış hesaplar erişimsiz bırakılmaz; mevcut hesabın yeniden doğrulanmasıyla kurulum sunulur.

1. Şema/PIN yaklaşımı için kullanıcı onayı.
2. Model, sunucu servisleri, API, seçim ekranı ve personel formu geliştirme; migration SQL'ini inceleme.
3. Neon yedeği ve yedek doğrulaması; yalnızca onaylanan migration'ı uygulama.
4. TypeScript, lint, build; profil seçimi/yanlış PIN/kilit, yetki yükseltme, şube ve işletme izolasyonu, rol iptali ve mevcut POS/finans/iade testleri.

Bu tasarım ortak işletme cihazında personel profili kullanımını kapsar. E-postasız personelin bağımsız cihazdan işletme ana hesabı olmadan giriş yapması ayrı bir kimlik doğrulama akışıdır.

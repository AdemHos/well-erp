# Vercel deployment

1. PostgreSQL veritabanını ve yedeğini hazırlayın. Paylaşılan veritabanlarında migration geçmişini doğrulayın.
2. Kaynağı Vercel’de Next.js projesine bağlayın. Build ayarları `vercel.json` içindedir.
3. `.env.example` şablonuna göre gerekli değişkenleri doğru Vercel ortamlarında tanımlayın.
4. Vercel için `AUTH_TRUST_HOST=true` ekleyin. Sabit `AUTH_URL` kullanıyorsanız gerçek HTTPS yayın adresiyle eşleştirin.
5. Google OAuth istemcisine `https://YOUR-DOMAIN/api/auth/callback/google` callback’ini ekleyin.
6. İncelenmiş migration’ları, yedek ve test kopyası doğrulamasının ardından ayrı adımda uygulayın.
7. Yayın sonrası giriş, yetkisiz API yanıtı, favicon ve izinli test hesabıyla temel iş akışlarını doğrulayın.

Build migration çalıştırmaz. Preview ve production veritabanlarını ayırmak, önizleme testlerinin gerçek iş verilerini değiştirmesini önler.

`.vercelignore`, ortam dosyaları, yedekler, yerel araçlar ve test kanıtlarını upload dışında tutar.
`.env.example` yalnızca doldurulacak alanları gösterir; gerçek anahtarlar Vercel’in gizli değişkenlerinde tutulmalıdır.

## Operasyon notları

- Next.js 16.4.3, önceki sürümdeki kritik bildirimler sonrasında seçilmiştir.
- Son paket kurulumunda kritik uyarı kalmadı; tam bağımlılık ağacında 9 yüksek ve 1 orta audit uyarısı raporlandı. Transitif bağımlılıklar ayrıca uyumluluk incelemesi gerektirir.
- Mevcut process bellekli istek limitleri instance’lar arasında ortak değildir.
- Gemini ücretsiz katmanı kotalıdır ve veri kullanım koşulları üretim öncesinde değerlendirilmelidir.
- Fiziksel POS terminali, yazıcı ve gerçek e-belge servisleri ayrıca entegrasyon ve doğrulama gerektirir.

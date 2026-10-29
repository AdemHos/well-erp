# WellPOS AI asistanı

Dashboard üzerindeki “İşletmene sor” kartı `POST /api/ai/assistant` kullanır.
Günlük özet ve bağımsız sorular desteklenir; konuşma geçmişi saklanmaz.

## Yapılandırma

- Ücretsiz kotalı bulut seçeneği: `AI_PROVIDER=gemini`, `GEMINI_API_KEY=...`.
- Varsayılan Gemini modeli `gemini-3.5-flash-lite`; `GEMINI_MODEL` ile değiştirilebilir.
- Anahtar: https://aistudio.google.com/apikey . Ücretsiz katmana uygun proje kullanın.
- Gemini ücretsiz katmanı sınırlıdır; erişim ve güncel kota Google hesabına/projesine bağlıdır.
  Uygulama billing durumunu doğrulayamaz; ücretli projeyi ücretsiz hale getirmez.
- Google’ın ücretsiz katmanında gönderilen içerik ürün geliştirmede kullanılabilir:
  https://ai.google.dev/gemini-api/docs/pricing . Bu bilgi arayüzde de gösterilir.
- OpenAI için `AI_PROVIDER=openai` kullanılır; sağlayıcı belirtilmezse geriye uyumluluk için OpenAI seçilir.
- Sunucuda `OPENAI_API_KEY` veya mevcut `OPENAI_SECRET_KEY` tanımlayın. İkisi varsa `OPENAI_API_KEY` önceliklidir.
- İsteğe bağlı `OPENAI_MODEL`; varsayılan `gpt-4.1-mini`.
- Ortam değişkenlerinden sonra geliştirme sunucusunu yeniden başlatın.
- Anahtar istemciye aktarılmaz. `.env` Git tarafından dışlanır.

## Kapsam ve erişim

`finance.manage` yetkisi, aktif üyelik/profil ve mevcut şube erişim denetimleri uygulanır.
Şube istemciden alınmaz; yetkili aktif şube sunucuda çözülür. Hesaplamalar mevcut
dashboard servisinden gelir. AI sorgu veya mutasyon çalıştıramaz.
Seçilen AI sağlayıcısına soru, bugünün satış toplamı/sayısı/ortalaması, düne göre değişimler,
son 30 günün günlük satış tutarları ve yetkili kritik stok özeti gönderilir.
Müşteri/personel bilgileri, sipariş kimlikleri ve finans hesabı ayrıntıları gönderilmez.
Kritik stoklar mevcut bildirim ayarlarına bağlıdır ve ilk 5 kayıtla sınırlıdır.
Kâr, kasa bakiyesi, ürün satış sıralaması, iade toplamı ve tükenme tahmini bu sürümde yoktur.

Responses API çağrısı `store: false`, 900 çıktı tokenı ve 30 saniye zaman aşımı kullanır.
Bu ayar OpenAI’ın diğer veri saklama politikaları hakkında bir garanti değildir.
Gemini `generateContent` çağrısı 900 çıktı tokenı ve 30 saniye zaman aşımı kullanır;
anahtar URL yerine `x-goog-api-key` header’ında gönderilir. Yalnızca tamamlanmış
metin yanıtları gösterilir; düşünce parçaları ve yarım/filtrelenmiş yanıtlar gösterilmez.
Sağlayıcı başarısız olursa otomatik olarak başka/ücretli sağlayıcıya geçilmez.
Çağrı yalnızca kullanıcı soru/özet düğmesine bastığında yapılır; otomatik yeniden deneme yoktur.
Kullanıcı/profil başına dakikada 10, işletme başına 24 saatlik pencerede 100 istek sınırı vardır.
Limitler süreç belleğindedir; yeniden başlatmada sıfırlanır. Çok instance için ortak limit deposu gerekir.
AI metni düz metin olarak görüntülenir; HTML çalıştırılmaz.

## Doğrulama

`node --test tests/ai-assistant.test.cjs`, `npm run typecheck`, `npm run lint`.
API sözleşmesi ve hata durumları sahte HTTP yanıtlarıyla test edilir.
Resmî kaynak: https://developers.openai.com/api/docs/quickstart
Gemini API: https://ai.google.dev/api/generate-content

Doğrulama: mevcut 127 çevrimdışı test daha önce geçti. AI paketi Gemini desteğiyle 7 test içerir.
Gemini 3.5 Flash-Lite canlı HTTP 200/STOP yanıtı ve gerçek uygulama adaptörü üzerinden
uydurma örnek satış verileriyle başarılı yanıt doğrulandı. Gerçek işletme verisi bu canlı
bağlantı testinde gönderilmedi. OpenAI hesabı önceki testte kredi bakiyesi hatası döndürdü.

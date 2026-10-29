# MVP denetimi düzeltmeleri

Bu çalışma kaynak kodunu değiştirir. Neon'a bağlanılmadı; migration, seed,
db push veya veri düzeltme işlemi çalıştırılmadı.

## Düzeltilen akışlar

- Dashboard: aktif işletme/şube kapsamlı gerçek satış KPI'ları, önceki gün
  karşılaştırması, İstanbul saatinde 24 saat / 7 gün / 30 gün grafikleri,
  son beş satış ve boş/hata/yükleme durumları. İade, rapor modülündeki gibi
  ilk satış döneminden düşer. Tahsilat yeniden satış sayılmaz.
- POS ve restoran aynı finans hesabı doğrulamasını ve POS_SALE kaydını kullanır.
  Restoran ödeme tekrarları adisyon kilidi altında önceki sonucu döndürür.
- POS, manuel kasa, stok giriş/çıkış, stok transferi ve üretim için istek anahtarı
  zorunludur. AuditLog üzerinde kalıcı replay kaydı ve transaction kilidi kullanılır.
  İstemci anahtarı belirsiz yanıtta korur; sessionStorage kullanılabiliyorsa sayfa
  yenilemesinden sonra da aynı içerik aynı anahtarla gönderilir.
- Ürün DELETE işlemi arşivler; ürün/stok/satış kimliklerini silmez. Ürün birimi
  form ve API'den seçilebilir. Stok/reçete geçmişli üründe birim değiştirme engellenir.
  POS'ta adet dışındaki birimler için üç ondalıklı manuel miktar girilebilir.
- Kritik eşik stok girişinde uygulanır; miktar değiştirmeden eşik düzenlemek için
  ayrı PATCH akışı vardır. Sıfır eşik ve sıfır stok arayüzde de kritik kabul edilir.
- Boş ve ödenmemiş adisyon iptal edilebilir. Ödenmiş, hazırlığı bitmemiş siparişler
  mutfak ekranında kalır; iade edilen/iptal edilmiş işler listeye alınmaz.
- POS iadesi hesap bakiyesini kontrol eden Serializable transaction kullanır.
- Kayıt/giriş alan sınırları, bcrypt parola uzunluğu, hız sınırlaması, gövde boyutu
  sınırı ve cross-site istek kontrolü eklendi. Ham API hata nesneleri loglanmaz.
- Ürün, reçete, şube ve restoran mutasyonlarının audit kapsamı genişletildi.
- Lint hataları düzeltildi; build öncesi açık Prisma generate adımı ve yalnız
  çevrimdışı testleri seçen test:offline komutu eklendi.
- Google Fonts indirme bağımlılığı kaldırıldı; mevcut lisanslı yerel font
  kullanılır. Derleme Google Fonts ağına erişim gerektirmez.

## Veritabanı değişikliği: henüz uygulanmadı

`20261027030000_harden_legacy_tenant_relations` migration'ı eski ürün/stok,
satış, masa/adisyon ve finans ilişkilerini bileşik işletme/şube foreign key'leriyle
korur. Ürün silme kısıtları, tek açık adisyon, şube adı ve sorgu indeksleri içerir.
Prisma validate ve generate veritabanına bağlanmadan çalıştırılabilir.

Migration öncesi ayrı, salt okunur preflight ile mevcut tenant/şube uyuşmazlıkları,
aynı masadaki çoklu açık adisyonlar ve normalleştirilmiş yinelenen şube adları
kontrol edilmelidir. Tutarsız kayıt varsa migration başarısız olmalıdır; bu dosya
veri silmez veya otomatik düzeltmez. Önce test veritabanında denenmeli, yedek ve
geri dönüş planından sonra ayrıca yetkilendirilmiş deployment adımında uygulanmalıdır.

Eski restoran satışlarında eksik kasa hareketleri otomatik tamamlanmaz. Bunlar
canlı veriye dokunmadan kaynak satış/tahsilat belgeleriyle mutabakat gerektirir.

## Yerel doğrulama

```text
npm run prisma:generate
npm run typecheck
npm run test:offline
npm run lint
```

Doğrulama sonucu: 125 çevrimdışı test geçti; TypeScript ve kaynak/test ESLint
kontrolleri hatasız tamamlandı. Production build, DATABASE_URL geçersiz bir yerel
adrese yönlendirilerek başarılı tamamlandı; canlı Neon'a erişilmedi.

`test:offline` gerçek PostgreSQL fixture testlerini ve dosya üreten PDF testini
çalıştırmaz. Gerçek DB kilitleri/constraint'leri, canlı OAuth, cihazlar ve tarayıcı
uçtan uca akışları ayrıca doğrulanmalıdır.

## Deployment sınırları ve ayrı özellik işleri

- Giriş/kayıt hız sınırı process belleğindedir. Çok instance'lı deployment için
  ortak Redis/edge hız sınırı gerekir. AUTH_TRUSTED_IP_HEADER ancak reverse proxy
  bu header'ı kullanıcı girdisinden temizleyip kendisi yazıyorsa ayarlanmalıdır.
  Ayarlanmazsa IP bazlı limit paylaşılan bir kota kullanır; hesap bazlı limit ayrıca vardır.
- Negatif stok ayarı satış içindir. Üretim, fire ve transfer fiziksel stok
  yeterliliğini korur; ayarın mevcut açıklaması bu kapsamı belirtir.
- Otomatik satış reçetesi tüketimi eklenmedi: mevcut ön üretim modelinde hem
  üretimde hem satışta hammadde düşmek çift tüketim üretir. Sipariş üzerine üretim
  için açık bir stok politikası ve tüketim snapshot'ı ayrı özellik olarak gerekir.
- Kısmi iade, parçalı ödeme, adisyon taşıma/bölme/birleştirme, alış faturasıyla
  stok kabulü, maliyet snapshot'ı/kârlılık ve büyük katalogların tüm ekranlarda
  sayfalanması ayrı kapsamdır.
- Gerçek e-belge, terminal, terazi, yemek platformu ve harici webhook bağlantısı
  eklenmedi; katalogda tamamlanmış olarak gösterilmez.

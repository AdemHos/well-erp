# WellPOS personel ve RBAC — onaylanan MVP tasarımı

Bu belge onaylanan tasarımın kaydıdır. Uygulama ve migration tamamlandı; güncel sonuçlar için rbac.md belgesine bakın.

## Mevcut durum

- User -> Membership -> Organization ilişkisi ve yedi rol zaten var.
- unique(userId, organizationId) farklı işletmelerde farklı rolleri destekliyor.
- Auth.js JWT oturumu kullanıyor. Rol/üyelik yetkileri veritabanından okunmalı;
  yetki kaynağı olarak JWT veya istemciden gelen rol kabul edilmemeli.
- current-membership, dashboard layout, ürün/stok/kategori sayfaları ve kategori
  detay API'si ilk üyeliği seçiyor. Bunlar tek işletme bağlamına taşınmalı.
- Şubeler işletmeye göre sınırlandırılıyor; üyelik bazlı şube ataması yok.
- Rol listeleri endpoint'lere dağılmış. Bazı okuma/yazma yollarında yalnızca
  üyelik kontrolü var. Finans GET sorguları tüm işletmenin şubelerini kapsıyor.
- Davet, personel ekranı, davet e-postası gönderimi ve merkezi audit tablosu yok.
- /api/users içinde OAuth Account nesnesi döndüren eski tanılama kodu bulundu.
  Bu yanıt oturum gerektiren, yalnızca kişinin profilini döndüren yanıtla sınırlandı.

## Önerilen veri değişikliği

Mevcut Membership'e yalnızca şu iki alan eklenir:

```prisma
isActive    Boolean @default(true)
allBranches Boolean @default(true)
```

Yeni tablolar:

| Model | Alanlar ve kurallar |
| --- | --- |
| MembershipBranch | membershipId, branchId, organizationId, isActive; üyelik/şube çifti benzersiz. Aynı işletme koşulu composite foreign key ile korunur. |
| StaffInvitation | id, organizationId, email, role, allBranches, tokenHash(unique), expiresAt, acceptedAt?, revokedAt?, createdById, createdAt. |
| InvitationBranch | invitationId, branchId, organizationId; davet/şube çifti benzersiz. Aynı işletme koşulu composite foreign key ile korunur. |
| AuditLog | id, actorUserId?, organizationId, branchId?, action, entityType, entityId?, metadata?, createdAt. İstek token'ları, şifreler veya OAuth alanları kaydedilmez. |

Composite foreign key'ler için Membership, Branch ve StaffInvitation üzerinde
id + organizationId benzersiz anahtarları eklenir. Gerekli ters ilişkiler eklenir.
Branch alanları mevcut kayıtları güncellemez; yalnızca ilişki ve indeks eklenir.

Mevcut tüm üyeliklerde isActive=true ve allBranches=true olur. Böylece mevcut
şube kapsamı korunur. Kimse otomatik başka işletmeye taşınmaz veya pasifleştirilmez.
Yeni davetlerde tüm şubeler açıkça seçilmedikçe sadece seçili şubeler atanır.
İşletmenin yeni şubeleri allBranches=false üyeliklere kendiliğinden açılmaz.
OWNER tüm şubelere erişir; diğer roller kendi atama kapsamıyla sınırlanır.
Üyelik/şube erişimi kaldırmada kayıtlar silinmek yerine pasifleştirilir.

## Merkezi izinler

Tek rol -> izin haritası; API, server page ve menü aynı tanımları kullanır.
Varsayılan davranış erişimi reddetmektir.

| Rol | MVP yetkileri |
| --- | --- |
| OWNER | İşletme, personel, sahiplik ve tüm operasyonların yönetimi. |
| ADMIN | Operasyonlar, personel ve şube yönetimi; OWNER/ADMIN yetkisi dağıtamaz, OWNER/ADMIN üyeliğini değiştiremez. |
| MANAGER | POS, satış geçmişi/iade, ürün/kategori, stok, reçete/üretim, finans ve restoran yönetimi; personel listesini okuyabilir, rol/erişim değiştiremez. |
| CASHIER | POS, satışa uygun katalog, kendi izinli şubelerinde satış geçmişi/fiş ve restoran tahsilatı; finans yönetimi veya iade yok. |
| WAITER | İzinli şubelerde masa/adisyon okuma, adisyon açma ve ürün ekleme/düzenleme; tahsilat, POS, finans ve iade yok. |
| KITCHEN | İzinli şubelerde mutfak siparişlerini okuma/hazırlık durumlarını güncelleme; POS ve finans yok. |
| STAFF | Kendi profil ve işletme/şube bağlamı; varsayılan operasyon izni yok. |

Ürün ve kategori kayıtları işletme geneli tanımlardır. Satış kataloğu okuması,
ürün yönetimi/maliyet okumasından ayrılır; kasiyer ve garsona maliyet bilgileri
açılmaz. Şubeye bağlı stok, satış, finans ve restoran verileri ayrıca şube
filtresinden geçer. Transferde kaynak ve hedef şubelerin ikisi de doğrulanır.

Denetlenecek yollar: orders/list/detail/refund, finance/accounts/categories/
transactions, products/categories ve görsel yükleme, stock/movements/transfers,
recipes/productions, restaurant/tables/tabs/items/checkout/kitchen, branches/
active ve yeni staff/invitations/organization-context API'leri.

Giriş yoksa 401; giriş var ancak gerekli izin/aktif üyelik yoksa 403.
Başka işletme/şubedeki kayıt sorgularında veri ifşa etmeyen 404 uygulanabilir.
Dashboard'a link gizlemek tek başına yetki kontrolü sayılmaz.

## İşletme seçimi ve oturum

Aktif işletme sunucuda doğrulanan bir cookie ile seçilir. Her istekte kullanıcının
o işletmede aktif üyeliği yeniden sorgulanır. İşletme değişince şube cookie'si
temizlenir/seçili izinli şubeye ayarlanır. İlk üyelik seçimi tek bir yardımcıya
taşınır. Rol/erişim değişikliğinden sonraki yeni API istekleri eski JWT rolüne
dayanmaz. Sayfalar ve menüler aynı izin bağlamıyla oluşturulur.

## Güvenli davet ve son OWNER

- 32 rastgele byte token; yalnızca SHA-256 hash'i veritabanına yazılır.
- 72 saat geçerlilik, e-posta ve işletmeye bağlılık, iptal ve tek kullanımlık kabul.
- Bağlantı oluşturana bir kez gösterilir/kopyalanır. E-posta gönderildiği söylenmez.
- Kabul giriş yapmış ve e-postası davetle eşleşen kullanıcıyla yapılır. Yeni kişi
  önce mevcut kayıt/giriş akışını kullanır; mevcut kişi şifre paylaşmadan kabul eder.
- GET linki üyelik oluşturmaz. Kabul POST ile açıkça yapılır; rol ve şubeler
  istemciden değil kayıtlı davetten alınır. Süre/iptal/kullanım transaction içinde
  koşullu güncellenir; ikinci kabul başarılı olamaz.
- Sadece OWNER sahiplik rolü atayabilir/değiştirebilir. ADMIN kendisini veya
  başkasını OWNER/ADMIN yapamaz, üst düzey üyeliği kaldıramaz.
- Personel değişiminde işletme satırı transaction içinde kilitlenir, işlemi yapanın
  güncel yetkisi doğrulanır, aktif OWNER sayısı kontrol edilir. Son OWNER erişimi
  kapatılamaz veya rolü düşürülemez. Eşzamanlı iki değişiklik de bu kilidi kullanır.
- Kullanıcının başka işletmelerdeki üyelikleri etkilenmez.

## Audit ve uygulama sırası

Personel/rol/şube değişimleri, davet kabul/iptali, satış iadesi, manuel stok
düzeltmesi ve kritik finans işlemleri kendi business transaction'larıyla birlikte
audit kaydı yazar. Audit başarısızsa kritik değişiklik de geri alınır. Audit için
uygulamada düzenleme/silme endpoint'i açılmaz; veritabanı yöneticisine karşı
bağımsız bir kurcalama önleme garantisi iddia edilmez.

1. Onay sonrası schema, tek migration, izin tanımları ve testler hazırlanır.
2. Neon yedeği alınır/doğrulanır; yalnızca onaylı migration uygulanır.
3. Ortak işletme/üyelik/şube kontrolü kritik API'lere ve server sayfalarına taşınır.
4. Personel, davet, işletme seçimi ve izinli menü arayüzleri tamamlanır.
5. Rol matrisi, şube/işletme izolasyonu, eşzamanlı son OWNER/davet kabulü ve
   POS/stok/finans/iade regresyonları test edilir.

Yeni rol kısıtları kasıtlı olarak CASHIER/WAITER/KITCHEN/STAFF için yönetim
ekranlarını kapatır. Mevcut şube kapsamı korunur; bu durum herkese mevcut geniş
operasyon yetkilerini koruma sözü değildir. Dış e-posta servisi, özel izin editörü,
vardiya sistemi veya yönetici onay kuyruğu MVP kapsamına eklenmez.

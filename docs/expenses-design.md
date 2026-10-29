# Giderler — şema, entegrasyon ve migration önerisi

Durum: kullanıcı tasarımı ve yerel geliştirmeyi onayladı. Yerel şema, API,
arayüz, testler ve migration SQL'i hazırlandı. Kullanıcının canlı onayı sonrasında
veritabanı yedeği alınıp yerel geri yükleme ile doğrulandı ve
`20261022010000_add_expenses` Neon'a uygulandı. Gerçek PostgreSQL testi başarılı.
Uygulama raporu: `docs/expenses.md`.

## İnceleme sonucu

- Expense, ExpenseCategory veya genel Payment modeli yok.
- FinanceCategory işletme düzeyinde IN/OUT yönlü kategorileri destekliyor.
  Mevcut OUT kategorileri gider kategorisi olarak kullanılacak; yeni kategori
  tablosu oluşturulmayacak. Oluşturma/listeleme API'si mevcut; düzenleme ve
  pasifleştirme eklenecek. Kullanılmış kategorinin yönü değiştirilemeyecek.
- FinanceAccount CASH/CARD/BANK türlerine sahip. POS satış API'si CARD ödemeleri
  için CARD hesabına POS_SALE / IN yazıyor. Bu hesaplar POS tahsilat hesabıdır;
  fiziksel kredi kartı borcu veya kredi limiti modeli bulunmuyor. Gider ödemesi
  için aktif CASH/BANK hesapları kabul edilecek; CARD API seviyesinde reddedilecek.
  Yeni kredi kartı borç modeli bu aşamanın kapsamına eklenmeyecek.
- CurrentAccount, CurrentAccountEntry, sourceKey, idempotencyKey, requestHash,
  financeTransactionId ve ters kayıt altyapısı mevcut. Cari yönü DEBIT − CREDIT;
  negatif net bakiye işletmenin tedarikçiye borcunu ifade ediyor.
- finance.manage OWNER/ADMIN/MANAGER rollerinde var. Mevcut withPermission,
  branchScope, branchIdScope, writeAudit ve Serializable tekrarları kullanılacak.
- `/dashboard/expenses` menüde hazırlık bağlantısı; çalışan ekran/API henüz yok.

## Önerilen yeni modeller

### Expense

- `id`, `organizationId`, `branchId`.
- `title`, `categoryId`: mevcut FinanceCategory bağlantısı. Yeni giderde aynı
  işletmenin aktif OUT kategorisi zorunlu olacak.
- `amount`: Decimal(14,2), CHECK(amount > 0), TRY.
- `expenseDate`, isteğe bağlı `dueDate`, `description`, `reference`.
- İsteğe bağlı `currentAccountId`: aynı işletmenin SUPPLIER veya BOTH carisi.
  Yeni bağlantı için cari aktif olmalı. Bağlantı varsa gider kaydı tahakkuk anında
  cari borcu oluşturacak; vade tarihi borcun varlığını değil son ödeme gününü belirler.
- `createdAt`, `updatedAt`, `createdByUserId`, isteğe bağlı `createdByProfileId`.
- `version`: güncelleme/iptal yarışlarını ve tahakkuk revizyonlarını izlemek için.
- `cancelledAt`, `cancelledByUserId`, `cancellationReason`: silme yerine iptal.
- `idempotencyKey`, `requestHash`: oluşturma tekrarlarına karşı işletme bazlı
  benzersizlik ve normalize içerik kontrolü.
- İsteğe bağlı `sourceKey`: ileride alış faturası/kaynak belge satırından üretilecek
  işletme bazlı benzersiz kaynak kimliği. Manuel API bunu istemciden kabul etmeyecek.
- `payments`: ExpensePayment ilişkisi; `currentEntries`: bağlı cari hareketleri.
- `(id, organizationId, branchId)` benzersiz anahtarı; işletme/şube/tarih,
  kategori ve vade sorgularını destekleyen indeksler.

Ödeme durumu ve ödenen tutar serbestçe yazılabilir alanlar olmayacak. Aktif ödeme
kayıtları toplamından paidAmount, remainingAmount ve ödeme durumu hesaplanacak.
İptal, ödeme durumundan ayrı bir yaşam döngüsü bilgisidir; iptal edilen gider
normal gider toplamlarından çıkarılır, geçmişte filtrelenebilir biçimde korunur.

### ExpensePayment

Yalnızca gidere ait ödeme kaydıdır; genel Ödemeler modülü değildir.

- `id`, `organizationId`, `branchId`, `expenseId`.
- `amount`: pozitif Decimal(14,2); `paidAt`, `description`, `reference`.
- `financeTransactionId`: zorunlu, benzersiz; aynı işletme/şubeye ait OUT hareketi.
  Kasa hesabı bu bağlantıdaki FinanceTransaction.accountId üzerinden izlenecek;
  iki ayrı değiştirilebilir hesap alanı tutulmayacak.
- İsteğe bağlı, benzersiz `currentAccountEntryId`: carili giderde ödeme için
  oluşturulan DEBIT hareketi. Bu hareketin financeTransactionId alanı aynı kasa
  hareketini gösterecek; yeni bir kasa çıkışı oluşturmayacak.
- `idempotencyKey`, `requestHash`: `(organizationId, idempotencyKey)` benzersiz.
- `createdAt`, `createdByUserId`, isteğe bağlı `createdByProfileId`.
- `(id, organizationId, branchId)` benzersizliği, expenseId ve tarih indeksleri.

## Mevcut modellere ekler

- FinanceCategory'ye Expense ters ilişkisi ve bileşik işletme FK'si için
  `(id, organizationId)` benzersiz anahtarı.
- CurrentAccountEntry'ye isteğe bağlı `expenseId`; Expense'e aynı işletme/şube
  üzerinden bileşik FK. Tahakkuk, tahakkuk düzeltmesi ve ödeme hareketleri gerçek
  gider kaydına bağlanır. ExpensePayment bağlantısı için mevcut cari kimlik
  bileşimine uygun ek benzersiz `(id, organizationId, branchId)` anahtarı.
- CurrentAccountEntryKind enum'una EXPENSE; ödemede mevcut PAYMENT, tahakkuk
  düzeltmesi/iptalinde mevcut REVERSAL ve reversalOfId kullanılır.
- FinanceSource enum'una EXPENSE_PAYMENT; otomatik gider ödemesi Kasa ekranında
  açıkça bu kaynakla gösterilir. İstemci source belirleyemez.
- Organization, Branch, User, StaffProfile, CurrentAccount ve FinanceTransaction
  üzerinde gerekli ters ilişkiler. Mevcut financeTransactionId benzersizliği korunur.
- Gider/şube/cari/kategori/finans ilişkilerinde bileşik işletme ve şube FK'leri,
  silme Restrict. Sonraki muhasebe kayıtları işletmeler arasında bağlanamaz.

## Muhasebe akışı ve tutarlılık

| Olay | Gider toplamı | Kasa | Cari |
| --- | --- | --- | --- |
| 10.000 TL carisiz gider kaydı | +10.000 | Değişmez | Hareket yok |
| 10.000 TL carili gider kaydı | +10.000 | Değişmez | CREDIT 10.000; işletme borçlu |
| 3.000 TL ödeme | Değişmez | Seçilen hesap OUT 3.000 | Bağlıysa DEBIT 3.000 |
| Kalan 7.000 TL ödeme | Değişmez | OUT 7.000 | Bağlıysa DEBIT 7.000 |

- paidAmount = SUM(ExpensePayment.amount), remainingAmount = amount − paidAmount.
  0 ödeme: UNPAID; 0 < ödeme < tutar: PARTIALLY_PAID; ödeme = tutar: PAID.
- Gider raporu Expense.amount üzerinden hesaplanır; ödeme satırları veya kasa
  OUT toplamı tekrar gider olarak eklenmez. Eski manuel kasa çıkışları bu aşamada
  kendiliğinden gider kaydına dönüştürülmez; geriye dönük tahmin yapılmaz.
- Gider oluşturma ve varsa cari CREDIT aynı transaction'da; ödeme, kasa OUT,
  varsa cari DEBIT ve AuditLog aynı transaction'da kaydedilir.
- Ödeme transaction'ı giderin güncel tutarını/ödemelerini ve kasa bakiyesini
  doğrular. Serializable ve sınırlı tekrarlar eşzamanlı fazla ödeme/eksi bakiye
  girişimlerini önler. Aynı şubede, aktif CASH/BANK ve yeterli bakiye gerekir.
- Aynı anahtar/aynı içerik önceki sonucu döndürür; farklı içerik 409. Gider
  tahakkuku için gider+version, ödeme için paymentId tabanlı sunucu sourceKey'leri
  aynı kaynak olayının iki kere cariye yazılmasını da önler.
- Mevcut POS iadelerinin davranışı değişmez. Otomatik gider/cari kayıtlarının
  genel manuel API'den düzenlenmesi, silinmesi veya bağımsız ters kaydı engellenir.
- Daha sonra pasifleştirilmiş cari/kategori eski borcu ödemeyi engellemez;
  ancak yeni gider veya yeni cari/kategori seçimi için aktiflik gerekir.

## Düzenleme ve iptal

- Şube oluşturma sonrasında sabit kalır. Şube değişikliği, kaydı düzeltip yeni
  şubede yeniden oluşturma yoluyla yapılır; geçmiş hareketler taşınmaz.
- Ödemesi olmayan giderin tutar/cari değişikliği gerekiyorsa eski cari tahakkuku
  aynı transaction'da REVERSAL ile kapatılır, yeni tahakkuk oluşturulur; version
  artırılır. Eski hareketler ve bağlantıları korunur. Kullanıcı gerekçe girer.
- Ödemesi bulunan giderde tutar, cari, şube, kategori ve muhasebe tarihi kilitli
  olur; başlık, açıklama, belge referansı ve vade gibi ödeme toplamını
  değiştirmeyen alanlar AuditLog ile düzenlenebilir. Geçmiş ödeme açıklamaları
  güncel gider metniyle geriye dönük yeniden yazılmaz.
- İptal bu aşamada yalnızca ödemesiz giderde mümkündür. Varsa cari tahakkuku
  ters kaydedilir; iptal bilgisi ve gerekçesi korunur. Tekrarlı iptal yeni ters
  kayıt oluşturmaz. Ödemeli giderin iptali reddedilir; nakit iadesi ve ödeme ters
  kaydı ayrıca tasarlanmadan finansal geçmiş sessizce sıfırlanmaz.
- ExpensePayment için doğrudan güncelleme/silme endpoint'i olmayacak. Ödeme
  kaydı ve otomatik finans hareketi değiştirilemez.

## Faturalarla sonraki entegrasyon

Gelecekte sourceKey, faturanın veya ilgili gider satırının kalıcı kimliğinden
sunucuda üretilecek. Aynı kaynak tekrar işlendiğinde yeni Expense oluşturulmayacak.
Fatura kaydı daha önce elle girilmiş bir gideri temsil ediyorsa kullanıcı mevcut
gidere bağlama/benimseme yapacak; ikinci gider ve ikinci cari CREDIT yaratılmayacak.
Sadece serbest metin reference eşitliğine dayanarak otomatik eşleştirme yapılmaz.
Bu aşamada gerçek olmayan invoiceId FK'si, fatura ekranı veya genel ödeme
dağıtımı eklenmeyecek.

## Arayüz ve API planı

- `/dashboard/expenses`: toplam gider, ödenen, açık bakiye ve vadesi geçmiş
  gider sayısı/kalan tutarı. İstanbul gününe göre vade aşımı; iptaller hariç.
- Arama, gider tarihi aralığı, kategori, yetkili şube, ödeme durumu ve iptal
  filtresi; sayfalama. Üst toplamlar aynı filtre kümesi üzerinde, sayfa sınırından
  bağımsız ve tutarlı snapshot ile hesaplanacak.
- Gider ekleme/düzenleme, detay/ödeme geçmişi, nakit/banka hesabından kısmi veya
  tam ödeme, ödemesiz gider iptali ve kategori yönetimi.
- Mevcut OUT kategori API'si genişletilecek; gelir kategorileri korunacak.
  Örnek kategori adları yeni kategori formunda önerilebilir; canlı veritabanına
  onaysız otomatik kategori veya geriye dönük gider eklenmeyecek.
- `/api/expenses`, `/:id`, `/:id/payments`, `/:id/cancel`; ortak kategori
  oluşturma/listeleme ve kategori güncelleme API'si.
- Bütün endpoint'lerde finance.manage, organizationId ve branchScope kontrolü.
  Gider şubesi ile kasa hesabının şubesi eşit olmak zorunda; OWNER bile gider
  ödemesini farklı şubedeki hesaptan doğrudan yapamaz. Önce Kasa transferi gerekir.
- Oluşturma, düzenleme, ödeme, iptal ve kategori değişiklikleri audit log'a yazılır.

## Veri etkisi ve migration planı

1. Bu tasarım ve yerel şema/API/UI/test/migration taslağı için kullanıcı onayı.
2. Onay sonrası yerel geliştirme ve çevrimdışı testler. Yeni şema SQL'i yalnızca
   yerel şema karşılaştırmasıyla hazırlanır; Neon'a bu aşamada uygulanmaz.
3. **Canlı migration öncesi kullanıcıdan Neon veritabanı yedeğini alması ve
   hazır olduğunu doğrulaması istenir.** Yedek alındığı varsayılmaz. Geri yükleme
   noktası ve zamanı bilinmeden canlı uygulamaya geçilmez.
4. Hazır SQL, indeks/kilit etkileri ve yedek durumu ile ayrıca canlı migration
   onayı alınır. Önceki Cari Hesaplar migration onayı bu aşamaya taşınmaz.
5. Mevcut migration geçmişi ve bağlantı doğrulanır. Onaylı yeni migration normal
   Prisma geçmişine eklenip uygulanır. `db push`, reset, veri silme yapılmaz.
6. Yeni kısıtlar/indeksler, migration checksum'ı ve eski kayıtların korunduğu
   doğrulanır. İzinli gerçek DB testleri izole fixture ve rollback ile çalışır.

İki boş tablo, iki mevcut enum'a yeni değerler, isteğe bağlı cari gider bağlantısı,
indeksler ve FK/CHECK kısıtları eklenir. Mevcut OUT kategorileri tekrar kullanılır.
Eski POS, iade, kasa ve cari tutarlar değişmez; geri doldurma yoktur.
Mevcut tablolardaki yeni indeks/FK işlemlerinin tarama ve kilit etkisi olabilir.
PostgreSQL enum genişletmesi, yeni değerin aynı transaction'da kullanılması
kısıtına göre gerektiğinde ayrı migration adımı olarak hazırlanır.

## Test planı ve mevcut durum

İstenen 12 senaryonun tamamına ek olarak CARD/POS hesabının reddi, pasif hesap,
yetersiz bakiye, eşzamanlı fazla ödeme, aynı anahtar/farklı içerik, ödemesiz
düzenlemede tahakkuk ters kaydı, iptal tekrarı, pasif cariyle eski borcun ödenmesi,
kategori yönünün korunması, CSV/cari ekstre kaynak etiketleri ve şube filtreleri
doğrulanacak. TypeScript, ilgili ESLint ve mevcut Kasa/POS/Cari/iade testleri
çalıştırılacak. Gerçek veritabanı testi çevrimdışı testten ayrı raporlanacak.

Güncel test sonuçları, değişen dosyalar ve canlı uygulama sınırı uygulama
raporunda tutulur. Tasarım onayı canlı migration veya veri silme izni değildir.

# Ödemeler ve Tahsilatlar — onaylı tasarım

Yerel şema ve geliştirme tasarımı 23 Ekim 2026 tarihinde kullanıcı tarafından onaylandı. Uygulama ve yerel migration SQL’i hazırlandı. Canlı Neon migration’ı yeni yedek/restore ve gerçek veri kopyasında prova sonrasında kullanıcının ayrı canlı onayıyla uygulandı; 21 migration ve iş verilerinin korunması doğrulandı. Uygulama ve doğrulama raporu: [payments.md](payments.md).

## Mevcut kayıt sahipliği ve tekrar riskleri

| Kaynak | Ürettiği kayıtlar | Korunacak davranış |
| --- | --- | --- |
| POS satış | Order/kalem, stok OUT, tek POS_SALE/IN | Yeni Payment/tahsilat üretilmez |
| POS iade | Stok geri dönüşü, POS_REFUND/OUT | Ödeme iptali bu akışa girmez |
| Kasa manuel | MANUAL finans hareketi | Belge/cari ödemesine otomatik dönüştürülmez |
| Kasa transferi | Aynı transaction'da MANUAL OUT + IN, TRANSFER referansı | Payment/gider/gelir sayılmaz |
| Cari manuel | OPENING/ADJUSTMENT ve izinli REVERSAL | Kasa yazmaz, otomatik ödeme gibi sunulmaz |
| Gider oluşturma | İsteğe bağlı tek EXPENSE/CREDIT | Kasa yazmaz |
| Bağımsız kesin fatura | Alış INVOICE/CREDIT; satış INVOICE/DEBIT | Kasa/stok yazmaz |
| Gider bağlantılı fatura | Mevcut gider tahakkukunu benimser | İkinci borç/gider oluşturmaz |
| Mevcut gider ödeme | Payment + EXPENSE_PAYMENT/OUT + varsa PAYMENT/DEBIT; bağlı faturaya tahsis | Aynı ödeme iki ekrandan aynı servise gider |

Payment zaten `@@map("ExpensePayment")` kullanıyor; expenseId nullable ve
financeTransactionId/currentAccountEntryId unique. InvoicePaymentAllocation
mevcut; yeni bağımsız ödeme/tahsis tablosu oluşturulmayacak. Mevcut oluşturucu,
personel, tenant/şube FK'leri ve organization+idempotencyKey unique korunacak.

Şu anki allocatePayment sadece gider bağlantılı alış faturalarını destekliyor.
Gider/fatura toplamları tüm ödemeleri sayıyor; iptal eklenince listeler, detaylar,
PDF, tahsis sınırı, ödeme/iptal/düzenleme kontrolleri birlikte güncellenmeli.
Sadece yeni Ödemeler ekranında filtrelemek tutarsız bakiye üretir.

## Önerilen şema değişiklikleri

### Mevcut Payment modelini genişlet

Fiziksel ExpensePayment tablosu ve mevcut ödeme kimlikleri korunacak:

- `type: PaymentType` eklenecek. Enum: CUSTOMER_COLLECTION, SUPPLIER_PAYMENT,
  EXPENSE_PAYMENT, PURCHASE_INVOICE_PAYMENT, SALES_INVOICE_COLLECTION.
- `currentAccountId: String?`: doğrudan cari bağlantısı, organization kapsamlı
  bileşik FK; carisiz gider için null. Var olan CurrentAccountEntry bağlantısı
  ayrıca korunur. Şube, ödeme ve cari hareketi sunucuda birlikte doğrulanır.
- `cancelledAt: DateTime?`, `cancelledByUserId: String?`,
  `cancelledByProfileId: String?`, `cancellationReason: String?`.
- `reversalFinanceTransactionId: String? @unique`: tek karşıt kasa hareketi;
  organization/branch bileşik FK. Asıl financeTransactionId değişmez.
- `reversalCurrentAccountEntryId: String? @unique`: varsa tek cari ters kaydı;
  organization/branch bileşik FK. Asıl currentAccountEntryId değişmez.
- Gerekli ters ilişkiler, tenant/şube/tarih/tür/cari/iptal indeksleri ve CHECK'ler.

İptal durumu cancelledAt üzerinden türetilir; ikinci bağımsız değiştirilebilir
status/bakiye alanı eklenmez. direction da ödeme türünden sunucuda belirlenir,
bağlı FinanceTransaction üzerinde bulunur; Payment'a kopyalanmaz.

### FinanceSource

Mevcut EXPENSE_PAYMENT, MANUAL, POS_SALE, POS_REFUND korunur. İki kaynak eklenir:

- PAYMENT: yeni cari/fatura ödeme ve tahsilatlarının otomatik kasa hareketi.
- PAYMENT_REVERSAL: Payment iptalinin karşıt kasa hareketi.

İşlem alt türü Payment.type içinde saklanır; aynı beş tür ikinci enumda
tekrarlanmaz. Kaynak otomatik olduğu için manuel kasa düzenleme akışına girmez.
Mevcut CurrentAccountEntryKind COLLECTION, PAYMENT, REVERSAL yeterlidir.
InvoicePaymentAllocation yapısı ve unique(invoiceId,paymentId) korunur.

## Eski verilere etki ve migration

1. Payment türü için eski gerçek gider ödemeleri EXPENSE_PAYMENT olarak
   işaretlenir. Ön kontrolde eski satırların gerçekten expenseId ve EXPENSE_PAYMENT
   kaynaklı OUT finans hareketine sahip olduğu doğrulanır. Uyuşmazlık varsa
   migration durur; belirsiz kayıtlar tahminle sınıflandırılmaz.
2. currentAccountId, mevcut gider ve ilişkili cari hareketinden doğrulanarak
   doldurulur. Carisiz giderde null kalır. Tenant/şube/cari çelişkisi varsa durulur.
3. Yeni iptal ve ters kayıt alanları başlangıçta null; mevcut kayıtlar aktiftir.
   Geçmiş tutarlar, tarihler, kimlikler, idempotency anahtarları, kasa/cari
   hareketleri ve tahsisler değiştirilmez, kopyalanmaz veya silinmez.
4. Yeni enumlar/kolonlar/FK/CHECK/indeksler eklenir. Payment type için eski gider
   API sürümüyle kısa geçiş uyumu sağlayan EXPENSE_PAYMENT varsayılanı bulunur;
   güncel servis her işlemde türü açıkça yazar.
5. Güncellenmiş uygulama eski Giderler/Faturalar endpoint adreslerini korur.
   Yeni nullable kolonlar otomatik Prisma select ile seçilebildiğinden migration
   öncesi uyumluluk explicit select / şema hazır kontrolüyle ayrıca sınanır.
   İptal özellikli yeni kod ile eski rapor sürümü aynı anda açık tutulmamalı;
   uygulama/şema geçişi birlikte doğrulanır.

Mevcut tabloda metadata backfill ve indeks taraması kısa kilit gerektirebilir.
Kesin SQL ve kilit etkisi geliştirme sonunda sunulacak. db push/reset yok.

## İşlem ve yön sözleşmesi

| Tür | Cari uygunluğu | Belge | Kasa | Cari |
| --- | --- | --- | --- | --- |
| CUSTOMER_COLLECTION | CUSTOMER/BOTH | Belgesiz cari kapama | IN | COLLECTION/CREDIT |
| SUPPLIER_PAYMENT | SUPPLIER/BOTH | Belgesiz cari kapama | OUT | PAYMENT/DEBIT |
| EXPENSE_PAYMENT | Varsa SUPPLIER/BOTH | Aktif gider zorunlu | OUT | Varsa PAYMENT/DEBIT |
| PURCHASE_INVOICE_PAYMENT | SUPPLIER/BOTH | ISSUED alış zorunlu | OUT | PAYMENT/DEBIT |
| SALES_INVOICE_COLLECTION | CUSTOMER/BOTH | ISSUED satış zorunlu | IN | COLLECTION/CREDIT |

MVP'de işlem başına tek kaynak belge vardır. Bağımsız cari kapamada belge
alanı gösterilmez; belge borcu/alacağı için ilgili belge türü seçilir. Aynı
ödemenin çok sayıda belgesiz gider arasında dağıtılması bu MVP'ye eklenmez.
Var olan InvoicePaymentAllocation ileride çoklu fatura dağıtımını destekler.

Gidere bağlı alış faturasında fatura üzerinden ödeme de aynı gider ödeme
çekirdeğine yönlendirilir: **bir Payment, bir OUT, bir cari DEBIT, bir tahsis**.
Payment.type başlatılan işlemi gösterir; expenseId ve tahsis aynı borcu izler.
Sonradan mevcut gidere bağlanan faturada geçmiş Payment kimliği/türü korunur.
Gider ekranı ödemeleri merkezi listede EXPENSE_PAYMENT olarak görünür.

## Avans ve belgesiz cari kapama politikası

**MVP'de avans yok.** Bakiye aynı işletme, cari ve işlem şubesindeki gerçek
cari hareketlerinden Decimal ile hesaplanır; başka şubenin alacağı/borcu kapatılamaz.
Net DEBIT−CREDIT >0 alacak, <0 borçtur.

- Tahsilat, o şubede cari net alacağını; tedarikçi ödemesi cari net borcunu aşamaz.
- Cari bağlantılı belge ödemesi ayrıca belgenin açık tutarını aşamaz. Cari net
  tutar belge tutarından küçükse açıkça hata verilir; mahsup/avans uydurulmaz.
- Carisiz giderde cari limiti yok, yalnız gider kalanı ve kasa limiti vardır.
- Belgesiz cari kapama, **açık belgelerin kapanmasını atlayamaz**. Uygun yöndeki
  net cari bakiye içinden açık kesin faturalar ve henüz faturalanmamış cari
  bağlantılı giderler için ayrılmış tutar düşülür; aynı gider-fatura bir kez
  sayılır. Kalan pozitif kısım belgesiz kapama için kullanılabilir.
- Açık belgeden doğan tutarı belgesiz ödeme ile kapatma isteğinde, kullanıcıya
  ilgili fatura/gider türünü seçmesi söylenir. Sessiz FIFO tahsisi yapılmaz.
  Böylece cari kapanırken faturanın açık kalması, ardından ikinci tahsilat
  yapılması veya aynı borcun hem gider hem faturada kapanması engellenir.

Bu sınırlama özellikle eski manuel cari düzeltmeleriyle belge bakiyeleri
uyuşmadığında görünür olur. Otomatik geçmiş eşleştirme yapılmaz; açıklayıcı hata
ve kaynak belgelere geçiş sağlanır. Hesapların sayısal doğruluğu korunur.

## Tek transaction ve tekrar güvenliği

`payment-service.ts` tek oluşturma/tahsis/iptal çekirdeğine genişletilecek.
Merkezi endpoint ve eski gider endpoint'i aynı çekirdeği kullanacak; eski
gider API payload'u ve daha önce verilmiş anahtarların requestHash sözleşmesi
korunacak. Aynı eski istek farklı endpoint'ten tekrarlandığında da ortak,
normalize edilmiş anlam doğrulanacak; iki ödeme yaratılmayacak. Anahtarın farklı
belge/tutar için kullanımı 409 döndürecek. İptal edilmiş isteğin anahtarıyla yeni
aktif ödeme açılmayacak; eski sonuç dönecek veya açık iptal durumu bildirilecek.

Serializable transaction içinde rol/kapsam, kaynak belge, cari türü, aktif aynı
şube CASH/BANK hesabı, belge/cari limitleri, OUT için yeterli kasa ve tahsis
sınırları yeniden okunacak. Tutar >0 ve iki ondalık. Gelecek tarih reddedilecek.
Kasa, cari, Payment, tahsis ve audit birlikte yazılacak. P2034 sınırlı retry ve
unique kısıtları korunacak. İstemciden direction/source/status/ödenen toplam,
finans hareketi ID'si veya POS orderId kabul edilmeyecek.

## İptal ve tarihsel koruma

Yetkili, gerekçeli iptal aynı transaction içinde:

1. Kapsam ve aktif ödeme doğrulanır; POS/transfer kaynakları kabul edilmez.
2. Asıl **aynı hesapta**, aynı tutarda karşıt PAYMENT_REVERSAL finans hareketi.
   Asıl hesap pasif olsa da düzeltme hesabı değiştirilmez. Tahsilat iptali OUT
   olduğundan mevcut eksi kasa yasağı uygulanır; para harcanmışsa yetersiz bakiye
   nedeniyle iptal reddedilir. Otomatik eksi bakiye veya başka hesaptan mahsup yok.
3. Varsa orijinal cari hareketine reversalOfId ile tek karşıt REVERSAL;
   aynı ters kasa hareketine financeTransactionId ile bağlanır.
4. Payment'a iptal zamanı, gerçek kullanıcı/personel, gerekçe ve ters kayıt
   bağlantıları yazılır; audit kaydı oluşturulur.
5. Fatura tahsisleri ve Payment fiziksel olarak tutulur. Etkin ödeme toplamları
   yalnız cancelledAt null kayıtları sayar; gider/fatura açık tutarı yeniden artar.
   Tekrar iptal ikinci ters kayıt üretmez. Düzeltme, iptal + yeni anahtarlı yeni
   ödeme şeklindedir; eski tutar/tarih/bağlantı düzenlenmez.

Tarihsel ödemesi olan giderin finansal alanları, ödemeler iptal edilmiş olsa da
keyfi değiştirilmez. Kaynak gider/fatura iptali ise aktif ödeme kalmadığında,
mevcut tahakkuk ters kayıt kurallarıyla yapılabilir. Kaynak belgesi iptal edilmiş
ödemeye yeniden ödeme eklenmez. Bunlar gerçek banka/kart iadesi değildir; UI
WellPOS içi kayıt düzeltmesini açıkça belirtir.

## Rapor/UI/güvenlik

`/dashboard/payments`: toplam etkin IN, etkin OUT, işlem sayısı; tarih/tür,
hesap/cari/şube/referans arama, aktif/iptal/tümü filtreleri ve sayfalama. Detayda
orijinal ve ters kasa/cari kayıtları, kullanıcılar, kaynak gider/fatura/cari
bağlantıları görünür. Form türe göre alanları açar ve uygun kayıtları listeler;
API her seçimi yeniden doğrular. Gider/fatura detayından ödeme ve merkezi listeye
geçiş sağlanır; iptal geçmişi açıkça görünür.

Kasa raporu gerçek IN/OUT ve ters hareketleri okumayı sürdürür. Merkezi ödeme
kartları seçilen işlem tarihi filtresinde aktif ödemeleri sayar; iptal kayıtları
geçmişte görünür, toplamı şişirmez. Bu kartlar satış/gider tahakkuk raporu değildir.
Gider/fatura detay, listeler, PDF ve açık bakiye hesapları aynı aktif ödeme
kuralına taşınır. Cari ekstre orijinal + REVERSAL geçmişini gösterir.

finance.manage (OWNER/ADMIN/MANAGER), aktif personel oturumu, origin ve API
organization/branch kontrolleri korunur. Kaynak belge ve kasa/cari bağlantıları
başka işletme/şubeye taşınamaz. POS tahsilat CARD hesabı ödeme aracı değildir.
POS_SALE/POS_REFUND ve TRANSFER hareketleri merkezi Payment'a dönüştürülmez;
POS fişi satış faturası veya açık müşteri alacağı olarak varsayılmaz.

## Doğrulama ve canlıya geçiş

İstenen 16 senaryo; ayrıca iki ekran arası aynı anahtar tekrarı, iptal sonrası
yeniden ödeme, gider-fatura tek tahakkuk, iptal edilmiş ödemelerin PDF/raporlardan
ayıklanması, eski gider requestHash uyumu ve migration öncesi uyumluluk sınanacak.
Eşzamanlı ödeme testi, yalnız mock/sıralı savepoint testi olmayacak: izole yerel
PostgreSQL üzerinde ayrı bağlantılarla gerçek yarış oluşturulacak. Rollback
enjeksiyonu kasa/cari/Payment/tahsis/audit aşamalarını kapsayacak. TypeScript,
ESLint, mevcut POS/iade/Kasa/Cari/Gider/Fatura regresyonları çalıştırılacak.

Yerel geliştirme bitince kesin SQL, değişen dosyalar, testler ve riskler
raporlanacak. **Yeni Neon yedeği alınması istenecek**; kullanıcı isterse mevcut
backup/restore araçları kullanılacak. Faturalar öncesi yedek yeni migration için
güncel sayılmayacak. Yedek doğrulandıktan sonra ayrı canlı migration onayı;
checksum, eski veri ve yeni kısıt doğrulaması. Bu tasarım onayı canlı veri
değiştirme izni değildir.

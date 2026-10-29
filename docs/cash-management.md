# Kasa yönetimi

Mevcut FinanceAccount, FinanceTransaction, hesap listesi ve POS entegrasyonu
genişletildi. Şema değişikliği yoktur. Migration, db push ve canlı veritabanı
işlemi çalıştırılmadı.

## Hesaplar ve hareketler

- `/dashboard/finance`: nakit, kart/POS ve banka hesapları; açılış + giriş − çıkış
  üzerinden güncel bakiye. Pasif hesaplar da geçmiş bakiyeleriyle görünür.
- `PATCH /api/finance/accounts/:id`: ad, aktiflik, tür ve açılış bakiyesi.
  Şube değiştirilemez. Hareketi olan hesapta tür ve açılış bakiyesi değiştirilemez.
- Hesap kartındaki Hareketler düğmesi hesabı seçer. Tarihler İstanbul gününü,
  bitiş gününün tamamı dahil olacak şekilde filtreler. Toplamlar sayfanın değil,
  bütün filtrelenmiş hareketlerin giriş/çıkışını gösterir.
- Manuel çıkış ve transferlerde güncel bakiye yetersizse 409 döner. Kontrol ve
  yazma Serializable transaction içindedir; serialization çatışmaları sınırlı
  tekrar edilir. POS iadeleri mevcut davranışıyla orijinal satış hesabına yazılır;
  bu otomatik ters kayıtlar hesabı eksiye indirebilir.
- Manuel kaydın kaynağı sunucuda MANUAL kalır. POS hareketlerini veya transferin
  tek bacağını değiştiren/silen endpoint eklenmedi.

## Transfer sözleşmesi

`POST /api/finance/transfers` gövdesi:

```json
{
  "fromAccountId": "kaynak-hesap",
  "toAccountId": "hedef-hesap",
  "amount": "125.50",
  "description": "Kasadan bankaya",
  "idempotencyKey": "istemcide-bir-kez-uretilen-uuid"
}
```

İki hesap için de finance.manage yetkisi, işletme ve şube kapsamı doğrulanır.
Yeni transferde hesaplar aktif olmalıdır. Tutar sıfırdan büyük, iki ondalıkla ve
Decimal(14,2) sınırlarında olmalıdır. Kaynak ile hedef farklı olmalıdır.

Mevcut şema korunarak MANUAL kaynaklı iki hareket yazılır. Kimlikleri işletme ve
istek anahtarının SHA-256 özetiyle oluşturulur; mevcut primary key benzersizliği
eşzamanlı tekrarları da korur. Ortak TRANSFER referansı ve kimlik öneki bunları
ayırt eder. İki hareket ve denetim kaydı aynı transaction içindedir. Hareketlerin
tarihleri ve tutarları aynıdır; işletme toplam bakiyesi değişmez. Şubeler arası
transferde her hareket kendi hesabının şubesine aittir.

İlk yanıt 201, aynı anahtar ve aynı içerikle tekrar 200; aynı anahtar ve farklı
hesap/tutar/açıklama 409 döner. Yanıt kaybolursa aynı anahtar korunmalıdır.
Arayüz belirsiz hata sonrası formu kilitler ve aynı anahtarla tekrarı sağlar;
anahtar açık bileşende tutulur, sayfa yenilenirse korunmaz. Böyle bir durumda
yeni transfer başlatmadan hareketlerden sonuç kontrol edilmelidir.

## Doğrulama

`npx tsc --noEmit` ve `node --test tests/*.test.cjs` çalıştırılır.
Yeni `tests/cash-management.test.cjs` çevrimdışı API testleri; toplam bakiye,
ondalık doğruluğu, tekrar/çakışma, iki bacak atomikliği, erişim sınırları,
negatif/sıfır tutar, yetersiz bakiye, hesap düzenleme ve gün filtresini kapsar.
Eşzamanlılık testlerinde transaction sıralaması taklit edilir; gerçek PostgreSQL
eşzamanlılık testi değildir. Veritabanına bağlı mevcut üç test ayrıca açıkça
etkinleştirilmedikçe atlanır.

Bu geliştirmede sonuç: TypeScript başarılı; 55 testten 52 başarılı, 3 veritabanı
testi atlandı, hata yok. Değişen TypeScript ve test dosyalarının ESLint kontrolü
başarılı. Tarayıcıda oturum açılarak görsel kabul testi yapılmadı.

## Değişen dosyalar

- `src/components/finance/FinanceManager.tsx`: hesap düzenleme/aktiflik,
  detay, tarih filtreleri, transfer ve belirsiz isteği tekrar deneme arayüzü.
- `src/app/api/finance/accounts/[id]/route.ts`: kapsamlı hesap güncelleme API'si.
- `src/app/api/finance/transfers/route.ts`: atomik, idempotent transfer API'si.
- `src/app/api/finance/transactions/route.ts`: manuel çıkışta bakiye kontrolü
  ve İstanbul iş gününe göre tarih aralığı.
- `src/lib/cash-management.ts`: Decimal doğrulaması, bakiye kontrolü,
  transfer kimlikleri ve Serializable transaction tekrarları.
- `tests/cash-management.test.cjs`: 12 çevrimdışı test.
- `docs/cash-management.md`: davranış, API, test ve değişiklik raporu.

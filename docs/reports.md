# Raporlar ve Analitik — MVP

24 Ekim 2026. Ekran: `/dashboard/reports`. Masaüstü Yönetim ve mobil menüde
`reports.read` ile görünür. Şema, migration, bağımsız satış/finans/stok tablosu
veya rapor kopyası oluşturulmadı. Neon'a veri yazılmadı.

## İnceleme ve kapsam

Order/OrderItem, POS ve restoran satışları, tam iade servisi, ürün maliyeti,
stok/üretim hareketleri, FinanceAccount/FinanceTransaction, gider, cari,
fatura/tahsis/merkezi Payment, müşteri/tedarikçi, Membership/personel ve şube
yapıları incelendi. `payment-overview.ts`, `invoice-read.ts`, `expense-read.ts`,
`customer-read.ts`, `supplier-read.ts`, `current-accounts-service.ts` mevcut
kuralların referansıdır. Mevcut dashboard kart/grafiklerinin bazısı örnek
sabit veri kullanıyor; raporlara taşınmadı, dashboard bu görevde değiştirilmedi.

Yeni rapor okuma servisi mevcut Prisma istemcisi, üyelik/RBAC/branchScope
mantığı, tarih doğrulaması, CashError, CSV kaçışı ve finans tasarım bileşenlerini
kullanır. SQL'de tüm parasal toplamlar PostgreSQL numeric; sunucu tarafındaki
yuvarlama/çıkarma Prisma.Decimal ile yapılır. Grafik koordinatları ve sayı
biçimlendirmesi dışında JavaScript Number ile parasal aritmetik yapılmaz.

Sekmeler: Genel Bakış, Satışlar, Finans, Stok, Kârlılık, Müşteriler,
Tedarikçiler, Personel ve Şubeler. Her sekme aynı tarih/şube filtresini kullanır.
Anlık göstergeler özellikle ayrı etiketlenir.

## Tarih ve satış kuralları

- İşletmede timezone alanı yok; mevcut sistemin Europe/Istanbul saat dilimi
  kullanılır. Bu görev timezone ayarı veya yeni kolon eklemez.
- Bugün, dün, son 7/30 gün (bugün dahil), bu ay, geçen ay ve özel aralık.
  Özel aralık en fazla 366 gün. Başlangıç/bitiş yerel takvim günü olarak dahil;
  sorgu UTC `[başlangıç, sonraki gün başlangıcı)` şeklindedir.
- IANA/Intl ile geçmiş İstanbul UTC+02/UTC+03 farkları da hesaplanır.
  Trend SQL'i UTC saklanan timestamp'ı İstanbul yerel takvimine çevirir.
  Gün/hafta/ay trendi boş dönemleri sıfır doldurur; hafta başlangıcı pazartesidir.
- Merkezi satış CTE'si yalnız COMPLETED/REFUNDED siparişleri, satış tarihiyle
  seçer. CANCELLED tamamen hariçtir. Brüt = subtotal; indirim = discountAmount;
  iade = REFUNDED.total; net = brüt − indirim − iade = COMPLETED.total toplamı.
- Mevcut model yalnız tam sipariş iadesini destekler. Kısmi/satır iadesi
  varsayılmaz. Rapor satış kohortunun **güncel durumudur**: daha sonra iade
  yapılan satış, eski satış dönemini de sıfırlar. İade gününe göre para çıkışı
  ayrı nakit akışında yer alır; bu iki tarih yaklaşımı ekranda/çıktıda açıklanır.
- Satış sayısı yalnız COMPLETED; ortalama net/sayı; sıfır adette 0.
  Nakit/kart yalnız siparişin kayıtlı paymentMethod değeridir; tahsilat değildir.
- Ürün geliri, kayıtlı OrderItem.total ağırlığıyla Order.total üzerinden
  kuruş bazında largest-remainder dağıtımıdır. Satırların toplamı sipariş
  toplamına tam eşittir; indirim ikinci kez düşülmez. Tam iadede net miktar
  ve satır geliri sıfırdır. Aynı ürünün farklı tarihsel adları ayrı satırdır.
  Dağıtılabilir satırı olmayan eski satışlar KPI'da kalır; ürün detayında
  hesaplanamadıkları uyarılır. Ürün/kategori/birim bilgileri güncel ürün
  sınıflandırmasıdır; geçmiş kategori/birim snapshot'ı iddiası yoktur.

## Finans kuralları

- Yönetimsel Gelir-Gider Özeti: dönem POS net satışı ve iptal edilmemiş
  Expense.expenseDate tutarları. Gösterilen fark net kâr değildir; stok maliyeti,
  bütün vergi ve muhasebe düzeltmeleri yoktur. Satış faturaları POS satışına
  eklenmez. Alış faturası yalnız mevcut akışta Expense oluşturmuşsa gider
  tablosunda bir kez yer alır; satın alınan stok otomatik dönem gideri sayılmaz.
- Tahsilatlar satış, tedarikçi ödemeleri tekrar gider değildir. Fatura issue
  cari tahakkukudur; nakit girişi/çıkışı olarak türetilmez.
- Nakit akışı FinanceTransaction.occurredAt üzerinden gerçekleşen hareketlerdir.
  İptalin asıl ve ters kayıtları kendi tarihlerinde kalır; aynı dönemdekiler
  netleşir, farklı dönemdekiler geçmiş nakit akışından sessizce silinmez.
- Merkezi transfer servisinin ürettiği deterministik transfer ID/referans
  biçimi tanınır. Transferler faaliyet nakit giriş/çıkışından ve yönetimsel
  gelir-giderden hariçtir; ayrı kaynak satırında gösterilir. Hesap bazlı
  gerçek hareket/bakiye tablosu transferleri içerir (şube transferinde önemlidir).
- Hesap dönem başı = openingBalance + başlangıç öncesi tüm IN−OUT;
  dönem sonu = openingBalance + bitiş sınırı öncesi tüm IN−OUT.
- Cari = tüm yetkili/seçili şube hareketlerinde DEBIT−CREDIT. Açık müşteri
  alacağı CUSTOMER/BOTH pozitif netler, tedarikçi borcu SUPPLIER/BOTH negatif
  netlerin mutlak toplamıdır. Anlıktır; tarih filtresi uygulanmaz. Pasifler dahildir.
- Dönem faturalarının açık/ödenmiş tutarı: ISSUED + invoiceDate kapsamı;
  yalnız iptal edilmemiş Payment tahsisleriyle güncel kalan. Vade rapor anına
  göre hesaplanır. Gecikmiş alacak ve borç KPI'ları ayrıdır. İptal/taslak
  faturalar açık fatura toplamına girmez; dönem sonu tarihi itibarıyla geçmiş
  muhasebe bakiyesi sunulduğu iddia edilmez.

## Stok, maliyet, müşteri ve tedarikçi

- BranchStock anlık; StockMovement.createdAt dönemsel. Kaynak ve birim
  bazında giriş/çıkışlar ayrı; SALE satış tüketimi, RETURN iade girişi,
  PRODUCTION_OUT kayıtlı reçeteli üretim tüketimi. Farklı birimler toplanmaz.
  Hammadde tüketimi miktara göre sıralanır; satılabilir ürün ayrımı korunur.
- Satış anı maliyet/COGS snapshot'ı OrderItem'da yok. Product.costPrice,
  SupplierProduct.lastPurchasePrice veya bağımsız Production maliyeti geçmiş
  satışa kesin maliyet olarak atanamaz. Bu nedenle ürün/kategori/şube satış
  gelirleri gösterilir; maliyet, brüt kâr ve marj **null / Hesaplanamadı**.
  Net kâr veya kesin stok değerlemesi üretilmez. İleride güvenilir kârlılık
  için satış anı maliyet snapshot'ı/maliyet yöntemi ayrı tasarım/onay gerektirir.
- Kayıtlı müşteri toplamı işletme genelidir; alışveriş yapan müşteri,
  harcama/sepet/son alışveriş seçili satış döneminde, yetkili şubelerde.
  customerId olmayan POS satışları müşteri raporundan hariçtir. Anlık müşteri
  alacağı ayrıca finance.manage gerektirir; isim/iletişim benzerliğiyle atama yok.
- Tedarikçi toplamı/aktifliği ortak profil havuzudur. Bağlı carinin ISSUED
  PURCHASE toplamı fatura tarihine; dışa ödemeleri paidAt tarihine göre ayrılır.
  İptal ödemeler ve BOTH müşteri tahsilatları ödeme toplamına girmez.
  Borç anlık, gecikmiş tutar seçili dönemin faturalarının güncel kalanıdır.
- Order'da güvenilir satış personeli bağlantısı yoktur. Faturayı kesen,
  iadeyi yapan veya güncel şube personeli satış yapan kişi sayılmaz.
  Personel sıralaması üretilmez; şube satış/iade/sepeti ve önceki aynı takvim
  günü sayısındaki dönemle karşılaştırma sunulur. Bu sekme staff.read gerektirir.

## API ve yetki

- `GET /api/reports`: JSON raporu.
- `GET /api/reports/export?format=csv|xlsx`: aynı sunucu sorguları/izinleri.
- Parametreler: report=overview|sales|finance|stock|profit|customers|suppliers|branches,
  preset, startDate, endDate, branchId, grain=day|week|month, page.
  Filtreler SQL parametresidir; istemciden organizationId kabul edilmez.
- reports.read OWNER/ADMIN/MANAGER'a mevcut rol haritasıyla eklenir.
  Satış/Genel Bakış orders.read; Finans finance.manage; Stok stock.manage;
  Kârlılık finance.manage + orders.read; Müşteriler customers.read + orders.read;
  Tedarikçiler suppliers.read + finance.manage; Personel/Şube staff.read + orders.read.
- API ve export aynı accessibleReports/withPermission kontrolünü uygular.
  Genel Bakış ve Müşterilerde finans izni yoksa finans KPI/tablo payload'u
  hiç gönderilmez. Şube boş kapsamı FALSE'dur; filtre erişimi genişletemez.
  Pasif ve güncel profil isimlerinin ortak işletme havuzunda görünmesi
  finansal şube kapsamını genişletmez.

## Performans ve çıktılar

- Her sorguda oturum organizationId ve finans/satış/stok için izinli branch
  kapsamı. Sunucu RepeatableRead + READ ONLY transaction; statement timeout
  5 saniye, toplam 30 saniye. Yazma, finans/stok hareketi veya audit üretmez.
- Toplamlar/gruplamalar veritabanında. Ayrıntı tabloları en fazla 20 satır;
  tek sayfa kontrolü tüm tabloların sayfasını değiştirir. KPI/grafikler sayfa
  öncesi kapsamı izler. Trend en fazla 366 günlük bucket; şube grafiği ilk 20,
  şube tablosu tüm sonuçları sayfalı sunar.
- Order(organizationId,createdAt), FinanceTransaction(org/branch/account,occurredAt),
  Expense/Invoice(org,branch,date), CurrentAccountEntry(org,branch,occurredAt),
  StockMovement ve BranchStock tenant/branch indeksleri incelendi.
  MVP için yeni indeks/migration gerekmedi; büyüyen veride EXPLAIN'e göre yeni
  indeks önerisi ayrıca onaya sunulmalıdır. Snapshot sorguları POS satırlarını
  yazma kilidiyle kilitlemez; timeout sınırsız taramayı engeller.
- Export, sayfalama dışındaki aynı filtrelerle yeniden RepeatableRead
  snapshot'ı alır. Ekran ile indirme arasında yeni işlem olursa fark oluşabilir;
  bu durum arayüzde açıklanır. Eski ekranın dondurulmuş kopyası değildir.
- Tüm tablo detaylarında toplam 10.000 satır, XLSX için 32MiB sınırı.
  Fazlasında sessiz kesme yapılmaz; 422 ile filtre daraltma istenir.
  SQL count ile sınır ayrıntı satırları alınmadan doğrulanır.
- CSV: UTF-8 BOM, noktalı virgül, Türkçe başlık ve tarih/ondalık biçimi;
  mevcut csvCell formül enjeksiyonu koruması. XLSX: gerçek OOXML ZIP, sayısal
  para ve tarih hücre biçimleri; metinler inlineStr, formül/makro/dış bağlantı yok.
  Excel'in 15 basamak kesinlik sınırını aşan sayılar kayıpsız metin olarak korunur.
  ZIP CRC ve XML parçaları doğrulandı. Ek npm bağımlılığı eklenmedi.
- PDF bu MVP'de eklenmedi; mevcut invoice PDF'si fatura belgesine özeldir.

## Doğrulama

- TypeScript ve değişen dosyalar için ESLint: PASS.
- Üretim Next.js derlemesi: PASS.
- Gerçek Raporlar bileşeninin localhost sentetik test verisiyle statik
  render'ı üzerinden masaüstü ve 390px mobil filtre/kart/tablo düzeni görsel
  kontrolü: PASS. Bu kontrol oturum açılmış etkileşimli uçtan uca test değildir.
- `node --test tests/*.test.cjs`: 90 PASS, 11 gerçek DB testi bu genel
  komutta ortam bayrakları verilmediği için SKIP.
- `node scripts/test-reports-local.cjs --all`: gerçek, yeni localhost
  PostgreSQL'de rapor/POS/iade/checkout/cari/gider/fatura/ödeme/müşteri/tedarikçi
  entegrasyonları: 75 PASS (son iki ek rapor kontrolünden önceki geniş koşu).
- Son `node scripts/test-reports-local.cjs`: 20 PASS; kullanıcının 16 senaryosu,
  kuruş dağıtımı, sayfalama/KPI ayrımı, tarihsel UTC farkı, gece sınırı,
  sıfır gün trendi, XLSX CRC/formül güvenliği ve 10.000 satır sınırı dahil.
- `node scripts/check-reports-live.cjs`: sekiz rapor mevcut Neon üzerinde
  READ ONLY servis transaction'larıyla PASS. Test verisi oluşturulmadı;
  finans tutarları loglanmadı. Yerel sorgu planı yerine gerçek ağ/servis
  süresi ölçüldü: yaklaşık 0,6–1,5 sn/rapor (mevcut küçük veri hacmi).
  Kanıt: `docs/reports-live-readonly.json`. Bu süre bir yük testi taahhüdü değildir.
- XLSX ZIP girişleri/XML parçaları .NET XML okuyucusuyla, tüm ZIP içerik
  checksum'ları Node zlib.crc32 ile doğrulandı. Gerçek Excel uygulamasında
  interaktif açma testi yapılmadı.

## Dosyalar

- `src/lib/report-config.ts`: ortak sekmeler/etiketler.
- `src/lib/reports.ts`: tarih/izin/rapor tipleri ve merkezi tanımlar.
- `src/lib/report-queries.ts`: tenant/şube parametreli rapor SQL'leri.
- `src/lib/report-service.ts`: salt okunur sorgular, KPI, grafik ve sayfalama.
- `src/lib/report-export.ts`: CSV/XLSX ve sınırlı dışa aktarım.
- `src/app/api/reports/route.ts`, `src/app/api/reports/export/route.ts`.
- `src/components/reports/ReportsManager.tsx`.
- `src/app/dashboard/reports/page.tsx`, `layout.tsx`.
- `src/lib/permissions.ts`, `src/components/dashboard/Sidebar.tsx`,
  `DashboardHeader.tsx`: izin ve menü bağlantıları.
- `tests/reports.integration.test.cjs`, `scripts/test-reports-local.cjs`,
  `scripts/check-reports-live.cjs`, `docs/reports-live-readonly.json`, bu belge.

Mevcut POS/finans/stok yazma servisleri ve Prisma şeması değiştirilmedi.
AI/BI/otomatik e-posta ve tam muhasebe raporları eklenmedi.

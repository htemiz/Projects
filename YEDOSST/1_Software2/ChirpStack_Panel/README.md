# Otonom Sulama Paneli

LoRaWAN (RFM95, 868 MHz) ve ChirpStack tabanlı otonom sulama sistemi için yerel web paneli.

- Sensör verisini (toprak nemi, sıcaklık, hava nemi, batarya) ChirpStack'ten canlı gösterir.
- Vanaları panelden açıp kapatır (hex downlink komutu, ChirpStack REST API üzerinden).
- Kural tabanlı karar motoruyla vanaları otomatik yönetir; her kararı gerekçesiyle gösterir.
- Bağımlılık yok: yalnızca **Node.js 22+**. `npm install` gerekmez.

```
 Sensör/Röle düğümü ──LoRa──► Gateway ──► ChirpStack ──HTTP entegrasyonu──► Panel (localhost:3000)
        ▲                                     ▲                                  │
        └──────────── downlink ◄──────────────┴──── REST API (kuyruğa ekle) ◄────┘
```

## Hızlı başlangıç

```bash
cd 1_Software/ChirpStack_Panel
cp config.example.json config.json      # Windows: copy config.example.json config.json
# config.json içini düzenleyin (aşağıya bakın)
node server.js
```

Tarayıcıda `http://localhost:3000` açın. Donanımsız denemek için ikinci bir terminalde `node simulate.js`.

> `config.json` ve `data/` klasörü `.gitignore`'dadır: API token'ınız GitHub'a yüklenmez.
> Gerçek anahtarlarınızı hiçbir zaman commit etmeyin.

## Ayarlar (`config.json`)

| Alan | Anlamı |
|---|---|
| `dryRun` | `true` iken komutlar ChirpStack'e **gönderilmez**, sadece günlüğe yazılır. İlk denemede `true` kullanın. |
| `chirpstack.apiUrl` | ChirpStack **REST API** adresi (varsayılan `http://localhost:8090`). Web arayüzü portu (8080) değildir. |
| `chirpstack.apiToken` | ChirpStack → Tenant → API Keys'te oluşturduğunuz anahtar. |
| `ingestToken` | ChirpStack'in panele veri yollarken kullandığı gizli değer. Değiştirin. |
| `uiPassword` | Doluysa panel parola ister. Ağdan erişilecekse mutlaka doldurun. |
| `staleMinutes` | Sensör bu süre sessiz kalırsa veri "eski" sayılır, otomatik sulama askıya alınır. |
| `hardMaxRunMin` | Hangi modda olursa olsun vananın açık kalabileceği en uzun süre. |
| `zones[]` | Her bölge: bir sensör + bir röle düğümü (içinde bir veya birkaç vana). |

Bölge örneği (`config.example.json`): tek sensör, iki vana, aynı düğüm.
Vana komutları `valve.valves[]` içinde, "ikisi birden" komutları `bothOnHex`/`bothOffHex` ile tanımlanır.

## ChirpStack tarafı

1. **API anahtarı:** Tenant → API Keys → Add API key. Token yalnızca bir kez gösterilir, `config.json`'a yazın.
2. **REST API:** ChirpStack'in `chirpstack-rest-api` servisi çalışmalı (genelde `:8090`). Kontrol: tarayıcıda `http://localhost:8090`.
3. **HTTP entegrasyonu:** Applications → *uygulamanız* → Integrations → HTTP → Add.
   Event endpoint URL: `http://host.docker.internal:3000/ingest?token=<ingestToken>`
   (ChirpStack Docker'daysa `host.docker.internal`, değilse panelin IP'si). Payload encoding: JSON.
4. Cihaz profilinde codec tanımlıysa uplink'te `object` alanı hazır gelir; yoksa baytları `decoder.js` içinde çözün.

## Röle komut tablosu (firmware ile aynı)

| Hex | İşlev |
|---|---|
| `01` / `02` | Vana 1 aç / kapat |
| `03` / `04` | Vana 2 aç / kapat |
| `05` | İkisini birden aç (iki pin HIGH) |
| `06` | İkisini birden kapat (iki pin LOW) |

Röle modülünüz ters mantıkla (active-low) çalışıyorsa vanalar tersine davranır. Su bağlamadan önce rölelerin gerçekten açılıp kapandığını doğrulayın; gerekirse `config.json`'da `bothOnHex` ile `bothOffHex` değerlerini yer değiştirin.

## Karar motoru (otomatik mod)

Her uplink'te ve 15 sn'de bir değerlendirilir:

- **Açar:** nem < eşik (sıcak havada eşik yükselir), sulama saatleri içinde, son sulamadan bekleme süresi geçmiş, yağmur ve aşırı soğuk yok.
- **Kritik nemde** saat ve bekleme kuralları atlanır.
- **Kapatır:** nem hedefe ulaştı, planlanan süre doldu, yağmur başladı ya da sensör sustu.
- **Öğrenir:** her sulamada nemin artış hızını ölçer ve sonraki sulama süresini buna göre planlar.
- **Arıza tespiti:** vana açık ama nem artmıyorsa uyarı verir ve otomatik sulamayı durdurur.
- **Güvenlik:** vana `hardMaxRunMin` üstünde açık kalmaz. Panel yeniden başlarsa son komutlardan vana durumunu geri yükler.

Eşikler arayüzden değiştirilir ve `data/settings.json` içine kaydedilir.

## LoRaWAN uyarıları

- **Class A** cihazlar downlink'i ancak bir sonraki uplink'ten sonra alır. Komut, uplink aralığı kadar (örn. 20 sn) gecikir. Röle düğümünü Class C yapmak ya da uplink'i sıklaştırmak gecikmeyi azaltır.
- Kapatma komutu gecikebileceği için düğüm yazılımına kendi içinde bir **otomatik kapanma zamanlayıcısı** eklemeniz önerilir.
- Panel her komuttan önce cihazın eski kuyruğunu temizler (`flushQueue`), böylece eski bir AÇ komutu sonradan teslim edilmez.
- 868 MHz'de %1 duty cycle vardır, çok sık downlink atmayın.

## Dosyalar

```
server.js            sunucu: ChirpStack köprüsü, SSE, SQLite, karar motoru
public/index.html    web arayüzü
decoder.js           payload çözücü (codec yoksa)
simulate.js          donanımsız test için sahte uplink üretir
config.example.json  örnek ayar dosyası (kopyalayıp config.json yapın)
firmware/            ESP32 + RFM95 (LMIC) düğüm yazılımları — anahtarlar şablondur
```

## Firmware

`firmware/esp32-s3/` ve `firmware/esp32-tcan485/` altındaki `.ino` dosyaları Arduino IDE (MCCI LoRaWAN LMIC kütüphanesi) ile derlenir. `APPEUI`, `DEVEUI` ve `APPKEY` değerleri sıfırlarla doldurulmuştur: kendi değerlerinizi **yerel kopyanıza** yazın, GitHub'a yüklemeyin. `DEVEUI` ve `APPEUI` LSB (ChirpStack'te göründüğünün ters bayt sırası), `APPKEY` MSB yazılır.

## Güvenlik

- Panel varsayılan olarak ağdaki herkese açıktır: `uiPassword` ve `ingestToken` belirleyin.
- API token'ı ve cihaz anahtarlarını repoya koymayın. Yanlışlıkla yüklendiyse ChirpStack'ten silip yenisini oluşturun.

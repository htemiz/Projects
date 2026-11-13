#include <SPI.h>
#include <lmic.h>
#include <hal/hal.h>

// =================== LORAWAN ANAHTARLARI ===================
// ChirpStack'teki cihaz kaydınızla aynı olmalı. DİKKAT: GitHub'a gerçek anahtarları yüklemeyin.
// APPEUI / JOINEUI: lsb formatında
static const u1_t PROGMEM APPEUI[8] = { 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 };
void os_getArtEui(u1_t* buf) { memcpy_P(buf, APPEUI, 8); }

// DEVEUI: lsb formatında (ChirpStack'te yazdığınız değerin BAYT SIRASI TERSİ)
static const u1_t PROGMEM DEVEUI[8] = { 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 };
void os_getDevEui(u1_t* buf) { memcpy_P(buf, DEVEUI, 8); }

// APPKEY: msb formatında (ChirpStack'e yapıştırdığınız anahtarla aynı sıra)
static const u1_t PROGMEM APPKEY[16] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};
void os_getDevKey(u1_t* buf) { memcpy_P(buf, APPKEY, 16); }

// =================== PIN VE DONANIM AYARLARI ===================
const int valf1Pin = 6; // 1. Valf Röle Sinyal Pini
const int valf2Pin = 7; // 2. Valf Röle Sinyal Pini

// ESP32-S3 Pin Haritası (RST bağlanmadı)
const lmic_pinmap lmic_pins = {
    .nss = 10,
    .rxtx = LMIC_UNUSED_PIN,
    .rst = LMIC_UNUSED_PIN,
    .dio = {4, 5, LMIC_UNUSED_PIN}, // DIO0 = 4, DIO1 = 5
};

static uint8_t mydata[] = { 0xAA }; // Heartbeat/Uplink verisi
static osjob_t sendjob;
const unsigned TX_INTERVAL = 20;    // Gönderim sıklığı (saniye)

// =================== DOWNLINK KOMUT YÖNETİMİ ===================
// 01/02: Vana 1 aç/kapat   03/04: Vana 2 aç/kapat   05: ikisini aç (HIGH)   06: ikisini kapat (LOW)
void handleDownlink(uint8_t cmd) {
    Serial.print(F("[KOMUT] Gelen HEX: 0x0"));
    Serial.println(cmd, HEX);

    if (cmd == 0x01) {
        digitalWrite(valf1Pin, HIGH);
        Serial.println(F("[VALF 1] ACIK (GPIO 6 HIGH)"));
    } else if (cmd == 0x02) {
        digitalWrite(valf1Pin, LOW);
        Serial.println(F("[VALF 1] KAPALI (GPIO 6 LOW)"));
    } else if (cmd == 0x03) {
        digitalWrite(valf2Pin, HIGH);
        Serial.println(F("[VALF 2] ACIK (GPIO 7 HIGH)"));
    } else if (cmd == 0x04) {
        digitalWrite(valf2Pin, LOW);
        Serial.println(F("[VALF 2] KAPALI (GPIO 7 LOW)"));
    } else if (cmd == 0x05) {
        digitalWrite(valf2Pin, HIGH);
        digitalWrite(valf1Pin, HIGH);
        Serial.println(F("[VALFLER] ACIK"));
    } else if (cmd == 0x06) {
        digitalWrite(valf2Pin, LOW);
        digitalWrite(valf1Pin, LOW);
        Serial.println(F("[VALFLER] KAPALI"));
    }
}

// =================== LMIC OLAYLARI ===================
void onEvent(ev_t ev) {
    switch(ev) {
        case EV_JOINING:
            Serial.println(F("[LoRaWAN] Aga katilma istegi gonderiliyor (JoinRequest)..."));
            break;
        case EV_JOINED:
            Serial.println(F("[LoRaWAN] BASARILI! Aga katilim saglandi."));
            LMIC_setLinkCheckMode(0);
            break;
        case EV_TXCOMPLETE:
            Serial.println(F("[LoRaWAN] Paket gonderimi tamamlandi (TXCOMPLETE)."));

            // Downlink verisi geldiyse oku
            if (LMIC.dataLen) {
                Serial.print(F("[LoRaWAN] Downlink Alindi! Bayt sayisi: "));
                Serial.println(LMIC.dataLen);
                uint8_t receivedByte = LMIC.frame[LMIC.dataBeg];
                handleDownlink(receivedByte);
            }

            // Bir sonraki periyodik gönderimi planla
            os_setTimedCallback(&sendjob, os_getTime() + sec2osticks(TX_INTERVAL), do_send);
            break;
        default:
            break;
    }
}

void do_send(osjob_t* j) {
    if (LMIC.opmode & OP_TXRXPEND) {
        Serial.println(F("[LoRaWAN] Onceki gonderim bekleniyor, atlandi."));
    } else {
        LMIC_setTxData2(1, mydata, sizeof(mydata), 0);
        Serial.println(F("[LoRaWAN] Uplink kuyruga alindi."));
    }
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println(F("ESP32-S3 LoRaWAN Sulama Dugumu Baslatiliyor..."));

    // Röle pinlerini hazırla
    pinMode(valf1Pin, OUTPUT);
    pinMode(valf2Pin, OUTPUT);
    digitalWrite(valf1Pin, LOW);
    digitalWrite(valf2Pin, LOW);

    // ESP32-S3 özel SPI pin başlatması (SCK: 12, MISO: 13, MOSI: 11, SS: 10)
    SPI.begin(12, 13, 11, 10);

    // OS ve LMIC başlat
    os_init();
    LMIC_reset();

    // İlk gönderimi başlat (OTAA Join tetikler)
    do_send(&sendjob);
}

void loop() {
    os_runloop_once();
}

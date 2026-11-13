#define CFG_eu868 1
#define CFG_sx1276_radio 1

#include <lmic.h>
#include <hal/hal.h>
#include <SPI.h>

void do_send(osjob_t* j);

// --- Valf Röle Pini ---
const int valf1Pin = 32;
const int valf2Pin = 25;

// --- LoRaWAN Kimlik ve Anahtarları ---
// DİKKAT: GitHub'a gerçek anahtarları yüklemeyin; yerel kopyanıza yazın.
// 1. JoinEUI (AppEUI) - LSB Formatı
static const u1_t PROGMEM APPEUI[8] = { 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 };
void os_getArtEui (u1_t* buf) { memcpy_P(buf, APPEUI, 8); }

// 2. DevEUI - LSB Formatı
static const u1_t PROGMEM DEVEUI[8] = { 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 };
void os_getDevEui (u1_t* buf) { memcpy_P(buf, DEVEUI, 8); }

// 3. AppKey - MSB Formatı
static const u1_t PROGMEM APPKEY[16] = {
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};
void os_getDevKey (u1_t* buf) { memcpy_P(buf, APPKEY, 16); }

static osjob_t sendjob;
const unsigned TX_INTERVAL = 20; // 20 saniyede bir uplink

// ESP32 T-CAN485 -> RFM95 Pin Haritası
const lmic_pinmap lmic_pins = {
    .nss = 5,
    .rxtx = LMIC_UNUSED_PIN,
    .rst = LMIC_UNUSED_PIN,
    .dio = {34, 33, LMIC_UNUSED_PIN}, // DIO0 -> IO 34, DIO1 -> IO 33
};

// ChirpStack Downlink Komut Isleme
void handleDownlink(uint8_t cmd) {
    Serial.print(F("[KOMUT] Gelen HEX Veri: 0x0"));
    Serial.println(cmd, HEX);

    if (cmd == 0x01) {
        digitalWrite(valf1Pin, HIGH);
        Serial.println(F("[VALF 1] ACIK (IO 32 HIGH)"));
    } else if (cmd == 0x02) {
        digitalWrite(valf1Pin, LOW);
        Serial.println(F("[VALF 1] KAPALI (IO 32 LOW)"));
    } else if (cmd == 0x03) {
        digitalWrite(valf2Pin, HIGH);
        Serial.println(F("[VALF 2] ACIK (IO 25 HIGH)"));
    } else if (cmd == 0x04) {
        digitalWrite(valf2Pin, LOW);
        Serial.println(F("[VALF 2] KAPALI (IO 25 LOW)"));
    }
     else if (cmd == 0x05) {
        digitalWrite(valf1Pin, HIGH);
        digitalWrite(valf2Pin, HIGH);
        Serial.println(F("[VALFLER] KAPALI (IO 25-32 LOW)"));
    }
      else if (cmd == 0x06) {
        digitalWrite(valf1Pin, LOW);
        digitalWrite(valf2Pin, LOW);
        Serial.println(F("[VALFLER] ACIK (IO 25-32 HIGH)"));
    }
}

void onEvent (ev_t ev) {
    switch(ev) {
        case EV_JOINING:
            Serial.println(F("[LoRaWAN] Aga katilma istegi yollaniyor (Join Request)..."));
            break;
        case EV_JOINED:
            Serial.println(F("[LoRaWAN] BASARILI! Aga katilim saglandi (JOIN ACCEPT)."));
            LMIC_setLinkCheckMode(0);
            // Ağa katılım sağlandıktan sonra ilk periyodik veriyi gönder:
            do_send(&sendjob);
            break;
        case EV_JOIN_FAILED:
            Serial.println(F("[LoRaWAN] Katilim basarisiz!"));
            break;
        case EV_TXCOMPLETE:
            Serial.println(F("[LoRaWAN] Paket iletildi (TX_COMPLETE)."));

            // Sunucudan (Queue) gelen Downlink komutu var mı?
            if (LMIC.dataLen) {
                uint8_t receivedByte = LMIC.frame[LMIC.dataBeg];
                handleDownlink(receivedByte);
            }

            // Bir sonraki gönderimi TX_INTERVAL saniye sonraya kur:
            os_setTimedCallback(&sendjob, os_getTime() + sec2osticks(TX_INTERVAL), do_send);
            break;
        default:
            Serial.print(F("[LoRaWAN Event]: "));
            Serial.println((unsigned)ev);
            break;
    }
}

void do_send(osjob_t* j) {
    if (LMIC.opmode & OP_TXRXPEND) {
        Serial.println(F("[LoRaWAN] Bekleyen iletim var, atlandi."));
    } else {
        uint8_t payload[1] = { 0xAA };
        LMIC_setTxData2(1, payload, sizeof(payload), 0);
        Serial.println(F("[LoRaWAN] Periyodik paket gonderildi."));
    }
}

void setup() {
    Serial.begin(115200);
    delay(1500);
    Serial.println(F("--- ESP32 T-CAN485 VALF SISTEMI AKTIF ---"));

    pinMode(valf1Pin, OUTPUT);
    digitalWrite(valf1Pin, LOW);
    pinMode(valf2Pin, OUTPUT);
    digitalWrite(valf2Pin, LOW);

    // SPI Pinleri: SCK=18, MISO=35, MOSI=12, NSS=5
    SPI.begin(18, 35, 12, 5);

    os_init();
    LMIC_reset();

    // 1. Kanal 0 (868.1 MHz) haricindeki kanalları kapat
    for (int i = 1; i <= 8; i++) {
        LMIC_disableChannel(i);
    }

    // 2. RX zaman sapması toleransını sonuna kadar aç (ESP32 osilatör kaymasını önler)
    LMIC_setClockError(MAX_CLOCK_ERROR);

    // 3. EU868 / ChirpStack standart RX2 ayarını kilitle (869.525 MHz / SF9)
    LMIC.dn2Dr = DR_SF9;

    // Temiz katılım isteğini tetikle
    LMIC_startJoining();
}

void loop() {
    os_runloop_once();
}

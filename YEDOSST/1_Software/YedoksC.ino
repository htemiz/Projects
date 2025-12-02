#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>

#define DHTPIN 25
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

#define RAIN_SENSOR_PIN 34
const int valfpin1 = 32;
const int valfpin2 = 33;

const char* ssid = "Redmi";
const char* password = "pororo123";

// Değiştir: kendi domainine göre
const String SERVER = "http://192.168.242.41/";

unsigned long lastSendTime = 0;
unsigned long interval = 10000;

void setup() {
  Serial.begin(115200);
  dht.begin();

  pinMode(RAIN_SENSOR_PIN, INPUT);
  pinMode(valfpin1, OUTPUT);
  digitalWrite(valfpin1, LOW);
  pinMode(valfpin2, OUTPUT);
  digitalWrite(valfpin2, LOW);

  WiFi.begin(ssid, password);
  Serial.print("WiFi bağlantısı kuruluyor...");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nBağlandı! IP: " + WiFi.localIP().toString());
}

void loop() {
  if (millis() - lastSendTime > interval) {
    sendSensorData();
    checkCommand();
    //checkSchedule();
    lastSendTime = millis();
  }
}

void sendSensorData() {
  float temp = dht.readTemperature();
  float hum = dht.readHumidity();
  bool isRaining = digitalRead(RAIN_SENSOR_PIN);
  float soil = 50.0; // Gerçek sensör bağlıysa burayı değiştir

  if (isnan(temp) || isnan(hum)) return;

  String url = SERVER + "verial.php?temp=" + String(temp) +
               "&hum=" + String(hum) +
               "&soil=" + String(soil) +
               "&rain=" + String(isRaining ? 1 : 0);

  HTTPClient http;
  http.begin(url);
  int code = http.GET();
  String payload = http.getString();
  Serial.println("Veri gönderildi: " + payload);
  http.end();
}

void checkCommand() {
  bool isRaining = digitalRead(RAIN_SENSOR_PIN);
  HTTPClient http;
  http.begin(SERVER + "komutal.php");
  int code = http.GET();
  String cmd = http.getString();
  http.end();

  cmd.trim();

  Serial.println("Gelen Komut: [" + cmd + "]");
  if (isRaining == false){
    digitalWrite(valfpin1, LOW);
    digitalWrite(valfpin2, LOW);
    
  }
  else {
    if(cmd == "valve_ac1") {
    digitalWrite(valfpin1, HIGH);
  } else if (cmd == "valve_kapat1") {
    digitalWrite(valfpin1, LOW);
  } else if (cmd == "valve_ac2") {
    digitalWrite(valfpin2, HIGH);
  } else if (cmd == "valve_kapat2") {
    digitalWrite(valfpin2, LOW);
  }
  }

}

void checkSchedule() {
  HTTPClient http;
  http.begin(SERVER + "zaman_kontrol.php");
  int code = http.GET();

  if (code == 200) {
    String response = http.getString();
    Serial.println("Zaman kontrol yanıtı: " + response);

    bool v1 = response.indexOf("1") != -1;
    bool v2 = response.indexOf("2") != -1;

    digitalWrite(valfpin1, v1 ? HIGH : LOW);
    digitalWrite(valfpin2, v2 ? HIGH : LOW);
  } else {
    Serial.println("Zaman kontrolü alınamadı. Kod: " + String(code));
  }

  http.end();
}

'use strict';
/**
 * ChirpStack cihaz profilinde codec (JS) tanımlıysa uplink JSON'unda "object" alanı
 * hazır gelir ve bu dosya KULLANILMAZ.
 * Codec yoksa ham baytları burada çözün. Aşağıdaki sadece ÖRNEKTİR; kendi
 * payload formatınıza göre değiştirin.
 *
 * Örnek format (6 bayt): [nem%, sıcaklık*10 (int16 BE), hava nemi%, batarya%]
 */
exports.decode = function ({ bytes, fPort, devEui }) {
  if (bytes.length < 5) return null;
  const temp = ((bytes[1] << 8) | bytes[2]);
  const signed = temp & 0x8000 ? temp - 0x10000 : temp;
  return {
    soil_moisture: bytes[0],
    temperature: signed / 10,
    humidity: bytes[3],
    battery: bytes[4],
  };
};

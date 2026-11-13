'use strict';
/**
 * Donanım olmadan test: ChirpStack'in HTTP entegrasyonunu taklit eder.
 *   node simulate.js [adım_sn=5] [başlangıç_nem=35]
 * Panelin vana durumuna bakar: vana açıksa nem yükselir, kapalıysa düşer.
 */
const step = +(process.argv[2] || 5), BASE = process.env.BASE || 'http://localhost:3000';
const TOKEN = process.env.TOKEN || 'degistir-beni';
let moisture = +(process.argv[3] || 35);
(async () => {
  const cfgZone = (await (await fetch(BASE + '/api/state')).json()).zones[0];
  const devEui = cfgZone.sensorDevEui;
  for (let i = 0; ; i++) {
    const st = (await (await fetch(BASE + '/api/state')).json()).zones[0];
    moisture += st.valveOn ? 2.0 : -0.8;
    moisture = Math.max(0, Math.min(100, moisture));
    const ev = {
      deviceInfo: { devEui, deviceName: 'sim-sensor' }, fPort: 2, fCnt: i,
      object: { soil_moisture: +moisture.toFixed(1), temperature: 24 + Math.sin(i / 10) * 3, humidity: 55, battery: 87 },
      rxInfo: [{ rssi: -92, snr: 7.5 }],
    };
    const r = await fetch(`${BASE}/ingest?event=up&token=${TOKEN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) });
    console.log(`uplink #${i} nem=${moisture.toFixed(1)} vana=${st.valveOn ? 'AÇIK' : 'kapalı'} → ${r.status}`);
    await new Promise((res) => setTimeout(res, step * 1000));
  }
})();

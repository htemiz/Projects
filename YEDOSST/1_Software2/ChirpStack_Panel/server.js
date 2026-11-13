'use strict';
/**
 * Otonom Sulama Paneli — ChirpStack köprüsü + karar motoru
 * Bağımlılık YOK (Node 22+). Çalıştırma: node server.js
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const origEmit = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : origEmit.call(process, w, ...a));
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const CONFIG_PATH = process.env.CONFIG || path.join(ROOT, 'config.json');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

let cfg;
try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
catch (e) {
  console.error(`\nconfig.json okunamadı (${e.message}).\nİlk kurulumda şunu yapın:  config.example.json dosyasını kopyalayıp adını config.json yapın, sonra içini düzenleyin.\n`);
  process.exit(1);
}
cfg.port = process.env.PORT ? +process.env.PORT : cfg.port || 3000;
cfg.staleMinutes ??= 90;
cfg.hardMaxRunMin ??= 60;
cfg.chirpstack ??= {};

let decoder = { decode: () => null };
try { decoder = require('./decoder.js'); } catch { /* decoder isteğe bağlı */ }

// ---------------------------------------------------------------- yardımcılar
const norm = (s) => String(s || '').toLowerCase().replace(/[^0-9a-f]/g, '');
const fmt = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const AUTO_DEFAULTS = {
  enabled: true, onBelow: 30, offAbove: 45, criticalBelow: 20, maxRunMin: 15,
  minIntervalMin: 60, allowedHours: [[5, 9], [18, 23]], minTempC: 4,
  skipIfRain: true, tempBoost: true, faultCheckMin: 5, faultMinRise: 1,
};
const DEFAULT_FIELDS = { moisture: 'soil_moisture', temperature: 'temperature', humidity: 'humidity', battery: 'battery', rain: 'rain' };

// ---------------------------------------------------------------- veritabanı
const db = new DatabaseSync(path.join(DATA_DIR, 'sulama.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS readings(id INTEGER PRIMARY KEY, ts INTEGER, zone TEXT, dev_eui TEXT, moisture REAL, temperature REAL, humidity REAL, battery REAL, rain REAL, rssi REAL, snr REAL, raw TEXT);
CREATE INDEX IF NOT EXISTS idx_readings ON readings(zone, ts);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, ts INTEGER, level TEXT, zone TEXT, msg TEXT);
CREATE TABLE IF NOT EXISTS commands(id INTEGER PRIMARY KEY, ts INTEGER, zone TEXT, dev_eui TEXT, fport INTEGER, hex TEXT, source TEXT, status TEXT, note TEXT);
`);
db.prepare('DELETE FROM readings WHERE ts < ?').run(Date.now() - 90 * 86400e3);
const qInsReading = db.prepare('INSERT INTO readings(ts,zone,dev_eui,moisture,temperature,humidity,battery,rain,rssi,snr,raw) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
const qInsEvent = db.prepare('INSERT INTO events(ts,level,zone,msg) VALUES (?,?,?,?)');
const qInsCmd = db.prepare('INSERT INTO commands(ts,zone,dev_eui,fport,hex,source,status,note) VALUES (?,?,?,?,?,?,?,?)');

// ---------------------------------------------------------------- ayar katmanı (arayüzden değişenler)
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
let overlay = {};
try { overlay = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { /* ilk çalıştırma */ }
function saveOverlay() {
  const o = {};
  for (const z of zones) o[z.id] = { mode: z.mode, auto: z.auto, riseRate: z.riseRate };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(o, null, 2));
}

// ---------------------------------------------------------------- bölgeler
const zones = (cfg.zones || []).map((zc) => {
  const ov = overlay[zc.id] || {};
  return {
    id: zc.id,
    name: zc.name || zc.id,
    sensor: { devEui: norm(zc.sensor.devEui), fields: { ...DEFAULT_FIELDS, ...(zc.sensor.fields || {}) } },
    valve: { devEui: norm(zc.valve.devEui), fPort: zc.valve.fPort || 10, confirmed: !!zc.valve.confirmed, stateField: zc.valve.stateField || null, bothOnHex: zc.valve.bothOnHex || null, bothOffHex: zc.valve.bothOffHex || null },
    valves: (Array.isArray(zc.valve.valves) && zc.valve.valves.length ? zc.valve.valves : [{ label: 'Vana', onHex: zc.valve.onHex || '01', offHex: zc.valve.offHex || '00' }])
      .map((v, i) => ({ label: v.label || `Vana ${i + 1}`, onHex: String(v.onHex), offHex: String(v.offHex), on: false })),
    manualStopAt: null,
    auto: { ...AUTO_DEFAULTS, ...(zc.auto || {}), ...(ov.auto || {}) },
    mode: ov.mode || zc.mode || 'auto',
    riseRate: ov.riseRate ?? null,   // öğrenilen nem artış hızı (%/dk)
    valveOn: false, onSince: null, plannedRunMin: null, startMoisture: null, lastOffAt: null,
    last: null, recent: [], stale: true, fault: null,
    decision: 'Veri bekleniyor', _code: '', busy: false, lastFailAt: 0, _warnedField: false,
  };
});

// ---------------------------------------------------------------- olay günlüğü + SSE
const eventRing = [];
const clients = new Set();
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const c of clients) c.write(msg);
}
function log(level, zoneId, msg) {
  const e = { ts: Date.now(), level, zone: zoneId || null, msg };
  qInsEvent.run(e.ts, level, e.zone, msg);
  eventRing.push(e);
  if (eventRing.length > 300) eventRing.shift();
  console.log(`[${new Date(e.ts).toLocaleTimeString('tr-TR')}] ${level.toUpperCase()} ${zoneId || '-'} ${msg}`);
  broadcast('log', e);
}

const hexMatch = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
function applyHexState(z, hex) {
  if (hexMatch(hex, z.valve.bothOnHex)) { z.valves.forEach((v) => { v.on = true; }); return true; }
  if (hexMatch(hex, z.valve.bothOffHex)) { z.valves.forEach((v) => { v.on = false; }); return true; }
  for (const v of z.valves) {
    if (hexMatch(hex, v.onHex)) { v.on = true; return true; }
    if (hexMatch(hex, v.offHex)) { v.on = false; return true; }
  }
  return false;
}

// ---------------------------------------------------------------- açılışta durumu geri yükle
for (const z of zones) {
  const rows = db.prepare('SELECT * FROM readings WHERE zone=? AND ts>? ORDER BY ts').all(z.id, Date.now() - 3 * 3600e3);
  for (const r of rows) if (r.moisture != null) z.recent.push({ ts: r.ts, m: r.moisture });
  const lr = db.prepare('SELECT * FROM readings WHERE zone=? ORDER BY ts DESC LIMIT 1').get(z.id);
  if (lr) z.last = { ts: lr.ts, moisture: lr.moisture, temperature: lr.temperature, humidity: lr.humidity, battery: lr.battery, rain: lr.rain, rssi: lr.rssi, snr: lr.snr };
  // Son komutları sırayla yeniden oynat: vana hâlâ açık olabilir, güvenli tarafta kalıp zamanlayıcıya bırak.
  const past = db.prepare("SELECT * FROM commands WHERE zone=? AND status IN ('ok','dry-run') ORDER BY ts DESC LIMIT 40").all(z.id).reverse();
  for (const c of past) {
    const was = z.valves.some((v) => v.on);
    applyHexState(z, c.hex);
    const any = z.valves.some((v) => v.on);
    if (any && !was) z.onSince = c.ts;
    if (!any) z.onSince = null;
  }
  z.valveOn = z.valves.some((v) => v.on);
  if (z.valveOn) { z.plannedRunMin = z.auto.maxRunMin; z.manualStopAt = z.onSince + z.auto.maxRunMin * 60e3; }
}
eventRing.push(...db.prepare('SELECT ts,level,zone,msg FROM events ORDER BY ts DESC LIMIT 100').all().reverse());

// ---------------------------------------------------------------- ChirpStack REST
async function csFetch(method, urlPath, body) {
  const base = (cfg.chirpstack.apiUrl || '').replace(/\/$/, '');
  const res = await fetch(base + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.chirpstack.apiToken}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ChirpStack ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

const lastEnqueue = {};
async function sendDownlink({ devEui, fPort, hex, confirmed }, zoneId, source) {
  hex = String(hex || '').replace(/\s+/g, '').replace(/^0x/i, '');
  if (!/^([0-9a-f]{2})+$/i.test(hex)) return { ok: false, error: 'Geçersiz hex (çift sayıda hex karakter olmalı)' };
  fPort = +fPort;
  if (!(fPort >= 1 && fPort <= 223)) return { ok: false, error: 'fPort 1-223 arasında olmalı' };
  devEui = norm(devEui);
  if (devEui.length !== 16) return { ok: false, error: 'DevEUI 16 hex karakter olmalı' };
  const data = Buffer.from(hex, 'hex').toString('base64');
  let status = 'ok', note = '';
  if (cfg.dryRun) {
    status = 'dry-run'; note = 'Deneme modu: ChirpStack\'e gönderilmedi';
  } else {
    try {
      if (cfg.chirpstack.flushQueue !== false && Date.now() - (lastEnqueue[devEui] || 0) > 60e3) await csFetch('DELETE', `/api/devices/${devEui}/queue`).catch(() => {});
      await csFetch('POST', `/api/devices/${devEui}/queue`, { queueItem: { devEui, confirmed: !!confirmed, fPort, data } });
      lastEnqueue[devEui] = Date.now();
    } catch (e) { status = 'error'; note = e.message; }
  }
  qInsCmd.run(Date.now(), zoneId || null, devEui, fPort, hex, source, status, note);
  broadcast('command', {});
  return { ok: status !== 'error', status, error: note };
}

// ---------------------------------------------------------------- vana komutu
// which: 'all' (tüm vanalar) ya da vana sırası (0, 1, ...)
function applyValve(z, on, r, which = 'all') {
  const now = Date.now(), was = z.valveOn;
  z.valves.forEach((v, i) => { if (which === 'all' || which === i) v.on = on; });
  const any = z.valves.some((v) => v.on);
  if (any && !was) {
    z.valveOn = true; z.onSince = now;
  } else if (!any && was) {
    // Öğrenme: bu sulamada nem ne kadar hızlı yükseldi?
    if (z.onSince && z.startMoisture != null && r && r.moisture != null && r.ts > z.onSince + 60e3) {
      const runMin = (r.ts - z.onSince) / 60e3;
      const rise = r.moisture - z.startMoisture;
      if (runMin > 0 && rise > 0) {
        const rate = rise / runMin;
        z.riseRate = z.riseRate ? 0.5 * z.riseRate + 0.5 * rate : rate;
      }
      if (rise >= z.auto.faultMinRise) z.fault = null;
    }
    z.valveOn = false; z.onSince = null; z.lastOffAt = now; z.plannedRunMin = null; z.manualStopAt = null;
    saveOverlay();
  }
}

async function command(z, on, source, reason, which = 'all') {
  if (source === 'auto' && Date.now() - z.lastFailAt < 60e3) return false;
  z.busy = true;
  try {
    const v = z.valve;
    let hexes;
    if (which === 'all') {
      const both = on ? v.bothOnHex : v.bothOffHex;
      hexes = both ? [both] : z.valves.map((x) => (on ? x.onHex : x.offHex));
    } else hexes = [on ? z.valves[which].onHex : z.valves[which].offHex];
    let status = 'ok';
    for (const hex of hexes) {
      const res = await sendDownlink({ devEui: v.devEui, fPort: v.fPort, hex, confirmed: v.confirmed }, z.id, source);
      if (!res.ok) {
        z.lastFailAt = Date.now();
        log('error', z.id, `Komut gönderilemedi: ${res.error}`);
        return false;
      }
      status = res.status;
    }
    applyValve(z, on, z.last, which);
    const name = which === 'all' ? (z.valves.length > 1 ? 'Tüm vanalar' : z.valves[0].label) : z.valves[which].label;
    log('info', z.id, `${name} ${on ? 'AÇILDI' : 'KAPATILDI'} [${source}] — ${reason}${status === 'dry-run' ? ' (DENEME MODU)' : ''}`);
    return true;
  } finally { z.busy = false; broadcast('state', fullState()); }
}

// ---------------------------------------------------------------- karar motoru
function slopePerHour(z) {
  const pts = z.recent.filter((p) => p.ts > Date.now() - 3 * 3600e3);
  if (pts.length < 3 || pts[pts.length - 1].ts - pts[0].ts < 10 * 60e3) return null;   // en az 10 dk'lık veri yoksa eğilim hesaplama
  const t0 = pts[0].ts;
  const xs = pts.map((p) => (p.ts - t0) / 3600e3), ys = pts.map((p) => p.m);
  const n = pts.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : null;
}
function inAllowedHours(ranges) {
  if (!ranges || !ranges.length) return true;
  const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
  return ranges.some(([s, e]) => (s <= e ? h >= s && h < e : h >= s || h < e));
}
function note(z, code, text, level = 'info') {
  z.decision = text;
  if (z._code !== code) { z._code = code; log(level, z.id, `Karar: ${text}`); }
}

async function evaluate(z) {
  if (z.busy) return;
  const a = z.auto, now = Date.now(), r = z.last;
  const ageMin = r ? (now - r.ts) / 60e3 : Infinity;
  z.stale = ageMin > cfg.staleMinutes;
  const run = z.valveOn && z.onSince ? (now - z.onSince) / 60e3 : 0;

  // Güvenlik ağı: hangi modda olursa olsun vana sınırsız açık kalmaz
  if (z.valveOn && run >= cfg.hardMaxRunMin) return void (await command(z, false, 'failsafe', `${cfg.hardMaxRunMin} dk üst sınır doldu`));

  if (z.mode !== 'auto' || !a.enabled) {
    z.decision = z.mode === 'auto' ? 'Otomatik sulama kapalı' : 'Manuel mod';
    z._code = 'manual';
    if (z.valveOn && z.manualStopAt && now >= z.manualStopAt) await command(z, false, 'manual-timer', `Süre doldu (${fmt(run)} dk)`);
    return;
  }

  // ---- vana açıkken: ne zaman kapatılacak?
  if (z.valveOn) {
    let why = null;
    if (z.stale) why = 'Sensör verisi gelmiyor, güvenlik için kapatıldı';
    else if (a.skipIfRain && r.rain > 0) why = 'Yağmur algılandı';
    else if (r.moisture != null && r.ts > z.onSince && r.moisture >= a.offAbove) why = `Hedef nem aşıldı (%${fmt(r.moisture)})`;
    else if (z.plannedRunMin && run >= z.plannedRunMin) why = `Planlanan süre doldu (${fmt(run)} dk)`;
    if (why) return void (await command(z, false, 'auto', why));
    if (!z.fault && run >= a.faultCheckMin && r.moisture != null && z.startMoisture != null && r.ts > z.onSince + 60e3 && r.moisture - z.startMoisture < a.faultMinRise) {
      z.fault = `Vana ${fmt(run)} dk açık ama nem artmadı (%${fmt(z.startMoisture)} → %${fmt(r.moisture)}). Vana, boru veya sensör arızası olabilir.`;
      log('warn', z.id, 'ARIZA ŞÜPHESİ: ' + z.fault);
    }
    z.decision = `Sulama sürüyor: ${fmt(run)}/${fmt(z.plannedRunMin || a.maxRunMin)} dk, nem %${r?.moisture != null ? fmt(r.moisture) : '?'}`;
    z._code = 'running';
    return;
  }

  // ---- vana kapalıyken: açmak gerekir mi?
  if (!r || r.moisture == null) return note(z, 'nodata', 'Henüz nem verisi gelmedi');
  if (z.stale) return note(z, 'stale', `Sensör ${Math.round(ageMin)} dk'dır sessiz — sulama askıda`, 'warn');

  const m = r.moisture, slope = slopePerHour(z);
  let on = a.onBelow;
  if (a.tempBoost && r.temperature != null) on += r.temperature >= 35 ? 5 : r.temperature >= 30 ? 3 : 0;

  if (m >= on) {
    let extra = '';
    if (slope != null && slope < -0.05) extra = `, eşiğe tahmini ~${fmt((m - on) / -slope)} saat`;
    return note(z, 'ok', `Nem yeterli (%${fmt(m)} ≥ eşik %${fmt(on)})${extra}`);
  }
  const critical = m < a.criticalBelow;
  if (a.skipIfRain && r.rain > 0) return note(z, 'rain', `Nem düşük (%${fmt(m)}) ama yağmur var`);
  if (r.temperature != null && r.temperature < a.minTempC) return note(z, 'cold', `Nem düşük (%${fmt(m)}) ama hava çok soğuk (${fmt(r.temperature)}°C)`);
  if (z.fault) return note(z, 'fault', 'Arıza şüphesi nedeniyle otomatik sulama durduruldu — kontrol edip arızayı sıfırlayın', 'warn');
  if (!critical && !inAllowedHours(a.allowedHours)) return note(z, 'window', `Nem düşük (%${fmt(m)}) — sulama saatini bekliyor`);
  if (!critical && z.lastOffAt && (now - z.lastOffAt) / 60e3 < a.minIntervalMin) return note(z, 'interval', `Nem düşük (%${fmt(m)}) — son sulamadan beri bekleme süresi dolmadı`);

  const deficit = Math.max(a.offAbove - m, 1);
  let planned = a.maxRunMin;
  if (z.riseRate > 0.01) planned = clamp(Math.ceil((deficit / z.riseRate) * 1.1), 1, a.maxRunMin);
  z.plannedRunMin = planned;
  z.startMoisture = m;
  z._code = 'start';
  const ok = await command(z, true, 'auto', `Nem %${fmt(m)} < eşik %${fmt(on)}${critical ? ' (KRİTİK)' : ''}; planlanan ${planned} dk`);
  if (!ok) { z.plannedRunMin = null; z.startMoisture = null; }
}

// ---------------------------------------------------------------- ChirpStack olayları (HTTP entegrasyonu)
function handleEvent(kind, ev) {
  const devEui = norm(ev.deviceInfo?.devEui);
  const name = ev.deviceInfo?.deviceName || devEui;
  if (kind === 'up') return handleUplink(ev, devEui);
  if (kind === 'ack') log('info', null, `${name}: komut cihaz tarafından onaylandı (ACK)`);
  else if (kind === 'txack') log('info', null, `${name}: downlink gateway'e iletildi`);
  else if (kind === 'join') log('info', null, `${name}: ağa katıldı (join)`);
  else if (kind === 'log') log(ev.level === 'ERROR' ? 'error' : 'warn', null, `${name}: ${ev.code || ''} ${ev.description || ''}`);
}

function handleUplink(ev, devEui) {
  let obj = ev.object && Object.keys(ev.object).length ? ev.object : null;
  if (!obj && ev.data) {
    try { obj = decoder.decode({ bytes: Array.from(Buffer.from(ev.data, 'base64')), fPort: ev.fPort, devEui }); }
    catch (e) { log('error', null, `decoder.js hatası: ${e.message}`); }
  }
  if (!obj) return log('warn', null, `Uplink çözümlenemedi (${devEui}, fPort ${ev.fPort}). ChirpStack'te codec tanımlayın veya decoder.js'i düzenleyin.`);
  const rx = (ev.rxInfo && ev.rxInfo[0]) || {};
  let matched = false;

  for (const z of zones) {
    if (z.valve.devEui === devEui && z.valve.stateField && obj[z.valve.stateField] != null) {
      const s = !!+obj[z.valve.stateField];
      if (s !== z.valveOn) { log('info', z.id, `Cihaz vana durumunu bildirdi: ${s ? 'AÇIK' : 'KAPALI'}`); applyValve(z, s, z.last); }
      matched = true;
    }
    if (z.sensor.devEui !== devEui) continue;
    matched = true;
    const num = (k) => { const v = obj[z.sensor.fields[k]]; return v != null && v !== '' && !isNaN(+v) ? +v : null; };
    const r = { ts: Date.now(), moisture: num('moisture'), temperature: num('temperature'), humidity: num('humidity'), battery: num('battery'), rain: num('rain'), rssi: rx.rssi ?? null, snr: rx.snr ?? null };
    if (r.moisture == null && !z._warnedField) {
      z._warnedField = true;
      log('warn', z.id, `Nem alanı "${z.sensor.fields.moisture}" uplink'te yok. Gelen alanlar: ${Object.keys(obj).join(', ')} → config.json > fields'i düzeltin.`);
    }
    z.last = r;
    if (r.moisture != null) { z.recent.push({ ts: r.ts, m: r.moisture }); if (z.recent.length > 60) z.recent.shift(); }
    qInsReading.run(r.ts, z.id, devEui, r.moisture, r.temperature, r.humidity, r.battery, r.rain, r.rssi, r.snr, JSON.stringify(obj));
    broadcast('reading', { zone: z.id });
    evaluate(z).finally(() => broadcast('state', fullState()));
  }
  if (!matched) log('warn', null, `Tanımsız cihazdan uplink: ${devEui} — config.json'a ekleyin`);
}

// ---------------------------------------------------------------- durum
function serializeZone(z) {
  const slope = slopePerHour(z);
  return {
    id: z.id, name: z.name, mode: z.mode, valveOn: z.valveOn, onSince: z.onSince, plannedRunMin: z.plannedRunMin,
    last: z.last, stale: z.stale, fault: z.fault, decision: z.decision, slope: slope != null ? fmt(slope) : null,
    riseRate: z.riseRate != null ? Math.round(z.riseRate * 1000) / 1000 : null, lastOffAt: z.lastOffAt,
    auto: z.auto, sensorDevEui: z.sensor.devEui, valveDevEui: z.valve.devEui,
    valves: z.valves.map((v) => ({ label: v.label, on: v.on, onHex: v.onHex, offHex: v.offHex })),
    both: { onHex: z.valve.bothOnHex, offHex: z.valve.bothOffHex }, manualStopAt: z.manualStopAt,
  };
}
function fullState() {
  return { now: Date.now(), dryRun: !!cfg.dryRun, staleMinutes: cfg.staleMinutes, hardMaxRunMin: cfg.hardMaxRunMin, zones: zones.map(serializeZone) };
}

// ---------------------------------------------------------------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Gövde çok büyük')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function uiAuthOk(req) {
  if (!cfg.uiPassword) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const pass = Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':');
  return safeEq(pass, cfg.uiPassword);
}
const getZone = (id) => zones.find((z) => z.id === id);

const NUM_RANGES = {
  onBelow: [0, 100], offAbove: [0, 100], criticalBelow: [0, 100], maxRunMin: [0.1, 240], minIntervalMin: [0, 1440],
  minTempC: [-40, 60], faultCheckMin: [0.1, 120], faultMinRise: [0, 50],
};

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // ChirpStack → panel (HTTP entegrasyonu)
  if (p === '/ingest' && req.method === 'POST') {
    if (cfg.ingestToken && !safeEq(url.searchParams.get('token') || '', cfg.ingestToken)) { log('warn', null, "ChirpStack'ten /ingest isteği geldi ama token yanlış. ChirpStack'teki adresin sonundaki token ile config.json'daki ingestToken aynı olmalı."); return json(res, 401, { error: 'token' }); }
    try {
      const ev = JSON.parse(await readBody(req));
      handleEvent(url.searchParams.get('event') || 'up', ev);
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (!uiAuthOk(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Sulama"' }); return res.end('Giriş gerekli'); }

  if (p === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(fullState())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (p === '/api/state') return json(res, 200, fullState());
  if (p === '/api/events') return json(res, 200, eventRing.slice(-+(url.searchParams.get('limit') || 100)).reverse());
  if (p === '/api/commands') return json(res, 200, db.prepare('SELECT * FROM commands ORDER BY ts DESC LIMIT 50').all());
  if (p === '/api/history') {
    const hours = clamp(+(url.searchParams.get('hours') || 24), 1, 24 * 90);
    const rows = db.prepare('SELECT ts,moisture,temperature,humidity,battery FROM readings WHERE zone=? AND ts>? ORDER BY ts LIMIT 5000').all(url.searchParams.get('zone') || '', Date.now() - hours * 3600e3);
    const cmds = db.prepare("SELECT ts,hex,source FROM commands WHERE zone=? AND ts>? AND status IN ('ok','dry-run') ORDER BY ts").all(url.searchParams.get('zone') || '', Date.now() - hours * 3600e3);
    return json(res, 200, { readings: rows, commands: cmds });
  }

  if (req.method === 'POST' && p.startsWith('/api/')) {
    let body;
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { error: 'Geçersiz JSON' }); }

    if (p === '/api/valve') {
      const z = getZone(body.zone);
      if (!z) return json(res, 404, { error: 'Bölge yok' });
      if (z.busy) return json(res, 409, { error: 'Önceki komut işleniyor' });
      const on = body.action === 'on';
      let which = 'all';
      if (body.valve !== undefined && body.valve !== 'all') {
        which = +body.valve;
        if (!Number.isInteger(which) || !z.valves[which]) return json(res, 400, { error: 'Vana yok' });
      }
      const minutes = clamp(+body.minutes || 10, 0.5, cfg.hardMaxRunMin);
      z.mode = 'manual';
      if (on && !z.valveOn) z.startMoisture = z.last?.moisture ?? null;
      const ok = await command(z, on, 'manual', on ? `Elle açıldı (${minutes} dk)` : 'Elle kapatıldı', which);
      if (ok && on && z.valveOn) {
        z.manualStopAt = Math.max(z.manualStopAt || 0, Date.now() + minutes * 60e3);
        z.plannedRunMin = fmt((z.manualStopAt - z.onSince) / 60e3);
      }
      saveOverlay();
      broadcast('state', fullState());
      return json(res, ok ? 200 : 502, { ok, error: ok ? undefined : 'Komut gönderilemedi (günlüğe bakın)' });
    }
    if (p === '/api/mode') {
      const z = getZone(body.zone);
      if (!z || !['auto', 'manual'].includes(body.mode)) return json(res, 400, { error: 'Geçersiz istek' });
      z.mode = body.mode; z._code = '';
      saveOverlay(); log('info', z.id, `Mod: ${z.mode === 'auto' ? 'OTOMATİK' : 'MANUEL'}`);
      evaluate(z).finally(() => broadcast('state', fullState()));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/settings') {
      const z = getZone(body.zone);
      if (!z || typeof body.auto !== 'object') return json(res, 400, { error: 'Geçersiz istek' });
      const next = { ...z.auto };
      for (const [k, v] of Object.entries(body.auto)) {
        if (k in NUM_RANGES) {
          const n = +v, [lo, hi] = NUM_RANGES[k];
          if (!Number.isFinite(n) || n < lo || n > hi) return json(res, 400, { error: `${k}: ${lo}-${hi} arasında olmalı` });
          next[k] = n;
        } else if (['enabled', 'skipIfRain', 'tempBoost'].includes(k)) next[k] = !!v;
        else if (k === 'allowedHours') {
          if (!Array.isArray(v) || v.some((r) => !Array.isArray(r) || r.length !== 2 || r.some((h) => !(h >= 0 && h <= 24)))) return json(res, 400, { error: 'allowedHours: [[5,9],[18,23]] biçiminde olmalı' });
          next[k] = v.map(([s, e]) => [+s, +e]);
        }
      }
      if (next.offAbove <= next.onBelow) return json(res, 400, { error: 'Kapanma eşiği, açılma eşiğinden büyük olmalı' });
      z.auto = next; z._code = '';
      saveOverlay(); log('info', z.id, 'Otomatik sulama ayarları güncellendi');
      evaluate(z).finally(() => broadcast('state', fullState()));
      return json(res, 200, { ok: true, auto: z.auto });
    }
    if (p === '/api/clear-fault') {
      const z = getZone(body.zone);
      if (!z) return json(res, 404, { error: 'Bölge yok' });
      z.fault = null; z._code = ''; log('info', z.id, 'Arıza işareti sıfırlandı');
      broadcast('state', fullState());
      return json(res, 200, { ok: true });
    }
    if (p === '/api/downlink') {
      const r = await sendDownlink({ devEui: body.devEui, fPort: body.fPort, hex: body.hex, confirmed: body.confirmed }, null, 'raw');
      log(r.ok ? 'info' : 'error', null, `Ham downlink → ${body.devEui} fPort ${body.fPort} hex ${body.hex}: ${r.ok ? r.status : r.error}`);
      return json(res, r.ok ? 200 : 502, r);
    }
    return json(res, 404, { error: 'Bilinmeyen uç nokta' });
  }

  // statik dosyalar
  let file = p === '/' ? '/index.html' : p;
  const full = path.join(ROOT, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Bulunamadı'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => { console.error(e); if (!res.headersSent) json(res, 500, { error: e.message }); });
});

// Açılışta ilk değerlendirmeyi hemen yap (15 sn beklemeden "veri eski" görünmesin)
setTimeout(() => { for (const z of zones) evaluate(z).finally(() => broadcast('state', fullState())); }, 300);
setInterval(() => {
  for (const z of zones) evaluate(z);
  broadcast('state', fullState());
}, 15e3);
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20e3);

server.listen(cfg.port, cfg.host || '0.0.0.0', () => {
  console.log(`\n  Sulama Paneli  →  http://localhost:${cfg.port}`);
  console.log(`  ChirpStack HTTP entegrasyonu URL'si  →  http://<bu-bilgisayarin-ip>:${cfg.port}/ingest?event=up&token=${cfg.ingestToken || ''}`);
  console.log(`  Mod: ${cfg.dryRun ? 'DENEME (dryRun) — downlink GÖNDERİLMEZ' : 'CANLI — downlink ChirpStack\'e gönderilir'}\n`);
  if (!cfg.ingestToken) console.warn('  UYARI: ingestToken boş, /ingest herkese açık.');
  if (!cfg.uiPassword && cfg.host !== '127.0.0.1') console.warn('  UYARI: uiPassword boş; ağdaki herkes vanaları açabilir.');
});

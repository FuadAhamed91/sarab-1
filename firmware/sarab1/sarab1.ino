/*
  SARAB-1 flight software for the tabletop prototype
  --------------------------------------------------
  ESP32 DevKit V1 + u-blox NEO-6M GPS + INA219 + MPU6050 + 0.96" SSD1306 OLED

  Every second the cube:
    1. reads the GPS receiver: signal strength per satellite (NMEA GSV), position (GGA/RMC)
       and, on genuine u-blox modules, noise level, gain and the jamming indicator (UBX-MON-HW)
    2. reads battery voltage and current (INA219) and tilt, vibration, temperature (MPU6050)
    3. runs the same detection as the ground station and computes the Interference Index
    4. publishes one JSON packet over MQTT and shows a summary on the OLED

  Libraries (Arduino IDE > Tools > Manage Libraries): PubSubClient (Nick O'Leary),
  ArduinoJson (Benoit Blanchon, version 7), U8g2 (oliver). Board package: esp32 by Espressif.

  Serial monitor at 115200 baud accepts single-letter commands:
    s = run the spoofing replay test for 20 seconds     c = recalibrate the clean baseline
*/
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <time.h>
#include <math.h>
#include "mbedtls/md.h"

// ================= Settings you change =================
const char* WIFI_SSID     = "YOUR_HOTSPOT_NAME";
const char* WIFI_PASSWORD = "YOUR_HOTSPOT_PASSWORD";
const char* COMMAND_PIN   = "change-me-2026";    // command key for signed telecommands from the dashboard; use a long random phrase
const float INA_SIGN      = -1.0;                // flip to +1.0 if charging shows as draining
// =======================================================

const char* TOPIC     = "sarab1/cb-7f3a91/tm";
const char* CMD_TOPIC = "sarab1/cb-7f3a91/cmd";
const char* BROKERS[] = { "broker.emqx.io", "broker.hivemq.com" };
const uint16_t MQTT_PORT = 1883;

#define GPS_RX_PIN 16      // ESP32 receives here  <- GPS TX
#define GPS_TX_PIN 17      // ESP32 transmits here -> GPS RX
#define I2C_SDA 21
#define I2C_SCL 22
#define INA_ADDR 0x40
#define MPU_ADDR 0x68
#define MAX_SATS 24
#define CAL_SECONDS 45

HardwareSerial GPS(2);
WiFiClient netClient;
PubSubClient mqtt(netClient);
U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);

// ---------------- Satellites and receiver state ----------------
struct Sat { uint8_t prn; int8_t el; int16_t az; uint8_t cn0; float base; uint32_t seen; };
Sat sats[MAX_SATS]; int nSats = 0;           // satellites in view (last complete GSV cycle)
Sat gsvTmp[MAX_SATS]; int nTmp = 0;
float baseByPrn[33];                          // clean baseline C/N0 per GPS PRN (0 = unknown)

bool fixValid = false; char fixQ[6] = "none"; int satsUsed = 0;
double lat = 0, lon = 0; char gpsTime[24] = "";
bool hwMetrics = false; uint32_t lastMonHw = 0;
float noiseLevel = 0, agcPct = 0; int jamInd = 0;

// ---------------- Detection state ----------------
enum State { NOMINAL, SUSPECT, JAMMING, SPOOFING };
const char* STATE_NAME[] = { "NOMINAL", "SUSPECT", "JAMMING", "SPOOFING" };
State state = NOMINAL;
bool calibrated = false; uint32_t calStart = 0; int calCount = 0, posCount = 0;
double homeLat = 0, homeLon = 0; float baseNoise = 100, baseAgc = 58, baseJam = 8;
double sumNoise = 0, sumAgc = 0, sumJam = 0, sumLat = 0, sumLon = 0;
float lastDev = 0;
uint32_t replayUntil = 0;
long lastCmdTs = 0; char lastAck[64] = "";

// ---------------- Housekeeping ----------------
float vbat = 0, ibat = 0, rollDeg = 0, pitchDeg = 0, vibG = 0, boardC = 0;
float roll0 = 0, pitch0 = 0; bool tilt0 = false;
double vibSum = 0; int vibN = 0;
uint32_t seq = 0; int brokerIdx = 0;

// =============== Small helpers ===============
static float clampf(float v, float a, float b) { return v < a ? a : (v > b ? b : v); }

static bool readReg16(uint8_t addr, uint8_t reg, int16_t &out) {
  Wire.beginTransmission(addr); Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)addr, 2) != 2) return false;
  out = (int16_t)((Wire.read() << 8) | Wire.read()); return true;
}
static bool writeReg8(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr); Wire.write(reg); Wire.write(val); return Wire.endTransmission() == 0;
}
static double haversineKm(double a1, double o1, double a2, double o2) {
  const double R = 6371.0, d2r = M_PI / 180.0;
  double da = (a2 - a1) * d2r, dlo = (o2 - o1) * d2r;
  double h = sin(da / 2) * sin(da / 2) + cos(a1 * d2r) * cos(a2 * d2r) * sin(dlo / 2) * sin(dlo / 2);
  return 2 * R * asin(sqrt(h));
}
static float socFromVoltage(float v) {
  const float V[] = { 3.30, 3.50, 3.60, 3.70, 3.75, 3.80, 3.85, 3.90, 3.95, 4.00, 4.10, 4.20 };
  const float S[] = { 0, 5, 10, 30, 45, 55, 65, 75, 83, 88, 95, 100 };
  if (v <= V[0]) return 0;
  if (v >= V[11]) return 100;
  for (int i = 1; i < 12; i++) if (v < V[i]) return S[i - 1] + (S[i] - S[i - 1]) * (v - V[i - 1]) / (V[i] - V[i - 1]);
  return 100;
}

// =============== u-blox UBX messages ===============
static void ubxSend(uint8_t cls, uint8_t id, const uint8_t* payload, uint16_t len) {
  uint8_t ckA = 0, ckB = 0, head[4] = { cls, id, (uint8_t)(len & 0xFF), (uint8_t)(len >> 8) };
  GPS.write(0xB5); GPS.write(0x62);
  for (int i = 0; i < 4; i++) { GPS.write(head[i]); ckA += head[i]; ckB += ckA; }
  for (uint16_t i = 0; i < len; i++) { GPS.write(payload[i]); ckA += payload[i]; ckB += ckA; }
  GPS.write(ckA); GPS.write(ckB);
}
static void enableJammingMonitor() {           // UBX-CFG-ITFM: enable the receiver's interference monitor
  uint32_t config = (1UL << 31) | (0x16B156UL << 9) | (15UL << 4) | 3UL, config2 = 0x31E;
  uint8_t p[8];
  for (int i = 0; i < 4; i++) { p[i] = (config >> (8 * i)) & 0xFF; p[4 + i] = (config2 >> (8 * i)) & 0xFF; }
  ubxSend(0x06, 0x39, p, 8);
}
static void handleUbx(uint8_t cls, uint8_t id, const uint8_t* p, uint16_t len) {
  if (cls == 0x0A && id == 0x09 && (len == 68 || len == 60)) {    // UBX-MON-HW (u-blox 6: 68 bytes, M8: 60 bytes)
    uint16_t noise = p[16] | (p[17] << 8), agc = p[18] | (p[19] << 8);
    noiseLevel = noise; agcPct = agc * 100.0f / 8191.0f; jamInd = p[len == 68 ? 53 : 45];
    hwMetrics = true; lastMonHw = millis();
  }
}

// =============== NMEA parsing ===============
static char nmea[128]; static int nmeaLen = 0;
static int splitFields(char* s, char* f[], int maxF) {
  int n = 0; f[n++] = s;
  for (char* c = s; *c && n < maxF; c++) if (*c == ',') { *c = 0; f[n++] = c + 1; }
  return n;
}
static double nmeaCoord(const char* v, const char* hemi) {
  if (!*v) return 0;
  double raw = atof(v); int deg = (int)(raw / 100); double d = deg + (raw - deg * 100) / 60.0;
  return (*hemi == 'S' || *hemi == 'W') ? -d : d;
}
static void handleSentence(char* s) {
  char* star = strchr(s, '*'); if (!star) return;       // validate the checksum
  uint8_t cs = 0; for (char* c = s + 1; c < star; c++) cs ^= (uint8_t)*c;
  if (strtol(star + 1, nullptr, 16) != cs) return;
  *star = 0;
  char* f[24]; int n = splitFields(s, f, 24);
  const char* type = f[0] + 3;                            // skip "$GP" / "$GN"
  if (!strcmp(type, "GGA") && n > 7) {
    int q = atoi(f[6]); satsUsed = atoi(f[7]);
    if (q > 0) { lat = nmeaCoord(f[2], f[3]); lon = nmeaCoord(f[4], f[5]); fixValid = true; strcpy(fixQ, q == 2 ? "DGPS" : "3D"); }
    else { fixValid = false; strcpy(fixQ, "none"); }
  } else if (!strcmp(type, "RMC") && n > 9 && strlen(f[1]) >= 6 && strlen(f[9]) == 6) {
    snprintf(gpsTime, sizeof gpsTime, "20%c%c-%c%c-%c%cT%c%c:%c%c:%c%cZ", f[9][4], f[9][5], f[9][2], f[9][3], f[9][0], f[9][1], f[1][0], f[1][1], f[1][2], f[1][3], f[1][4], f[1][5]);
  } else if (!strcmp(type, "GSV") && n >= 4) {
    int total = atoi(f[1]), msg = atoi(f[2]);
    if (msg == 1) nTmp = 0;
    for (int i = 4; i + 2 < n; i += 4) {                  // groups of PRN, elevation, azimuth, SNR
      if (!*f[i] || nTmp >= MAX_SATS) continue;
      Sat& t = gsvTmp[nTmp++];
      t.prn = atoi(f[i]); t.el = atoi(f[i + 1]); t.az = atoi(f[i + 2]);
      t.cn0 = (i + 3 < n && *f[i + 3]) ? atoi(f[i + 3]) : 0;   // empty SNR = not tracked
      t.base = 0; t.seen = millis();
    }
    if (msg == total) { memcpy(sats, gsvTmp, sizeof(Sat) * nTmp); nSats = nTmp; }
  }
}
static uint8_t ubxBuf[120]; static int ubxPos = -1; static uint16_t ubxLen = 0;
static void readGps() {
  while (GPS.available()) {
    uint8_t b = GPS.read();
    if (ubxPos >= 0) {                                    // inside a UBX frame
      if (ubxPos == 0 && b != 0x62) { ubxPos = -1; continue; }
      if (ubxPos < (int)sizeof ubxBuf) ubxBuf[ubxPos] = b;
      ubxPos++;
      if (ubxPos == 5) { ubxLen = ubxBuf[3] | (ubxBuf[4] << 8); if (ubxLen > sizeof ubxBuf - 8) ubxPos = -1; }
      else if (ubxPos > 5 && ubxPos == 5 + ubxLen + 2) {
        uint8_t a = 0, c = 0; for (int i = 1; i < 5 + ubxLen; i++) { a += ubxBuf[i]; c += a; }
        if (a == ubxBuf[5 + ubxLen] && c == ubxBuf[6 + ubxLen]) handleUbx(ubxBuf[1], ubxBuf[2], ubxBuf + 5, ubxLen);
        ubxPos = -1;
      }
      continue;
    }
    if (b == 0xB5) { ubxPos = 0; continue; }
    if (b == '$') nmeaLen = 0;
    if (b == '\n' || b == '\r') { if (nmeaLen > 6) { nmea[nmeaLen] = 0; handleSentence(nmea); } nmeaLen = 0; }
    else if (nmeaLen < (int)sizeof nmea - 1) nmea[nmeaLen++] = (char)b;
  }
}

// =============== Sensors ===============
static void readPower() {
  int16_t busRaw, shuntRaw;
  if (readReg16(INA_ADDR, 0x02, busRaw) && readReg16(INA_ADDR, 0x01, shuntRaw)) {
    vbat = ((uint16_t)busRaw >> 3) * 0.004f;
    ibat = INA_SIGN * (shuntRaw * 0.01f) * 10.0f;        // 0.1 ohm shunt: mA = shunt mV x 10
  }
}
static void readMotion(bool fullRead) {
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(MPU_ADDR, 8) != 8) return;
  int16_t ax = (Wire.read() << 8) | Wire.read(), ay = (Wire.read() << 8) | Wire.read(), az = (Wire.read() << 8) | Wire.read(), t = (Wire.read() << 8) | Wire.read();
  float gx = ax / 16384.0f, gy = ay / 16384.0f, gz = az / 16384.0f, mag = sqrtf(gx * gx + gy * gy + gz * gz);
  vibSum += (mag - 1.0f) * (mag - 1.0f); vibN++;
  if (!fullRead) return;
  float r = atan2f(gy, gz) * 57.2958f, p = atan2f(-gx, sqrtf(gy * gy + gz * gz)) * 57.2958f;
  if (!tilt0) { roll0 = r; pitch0 = p; tilt0 = true; }   // tilt is reported relative to the power-on pose
  rollDeg = r - roll0; pitchDeg = p - pitch0; boardC = t / 340.0f + 36.53f;
  vibG = vibN ? sqrtf(vibSum / vibN) : 0; vibSum = 0; vibN = 0;
}

// =============== Detection (same maths as the ground station) ===============
struct Det { float drop, mean, sd, r, dev; int n, index; };
static Det detect() {
  Det d = { 0, 0, 0, 0, lastDev, 0, 0 };
  bool replay = millis() < replayUntil;
  float cn[MAX_SATS]; int k = 0, withBase = 0; float dropSum = 0;
  for (int i = 0; i < nSats; i++) {
    Sat& s = sats[i];
    if (replay) s.cn0 = 43 + (esp_random() % 7) / 10.0f;   // replayed spoofed signal: every satellite the same strength
    float b = (s.prn > 0 && s.prn <= 32) ? baseByPrn[s.prn] : 0; s.base = b;
    if (b > 0) { dropSum += fmaxf(0, b - fmaxf(s.cn0, 15)); withBase++; }
    if (s.cn0 >= 22) { cn[k] = s.cn0; k++; }
  }
  d.n = k; d.drop = withBase ? dropSum / withBase : 0;
  for (int i = 0; i < k; i++) d.mean += cn[i];
  if (k) d.mean /= k;
  for (int i = 0; i < k; i++) d.sd += (cn[i] - d.mean) * (cn[i] - d.mean);
  d.sd = k > 1 ? sqrtf(d.sd / (k - 1)) : 0;
  float xs[MAX_SATS]; int m = 0;                             // correlation of strength with elevation
  for (int i = 0; i < nSats; i++) if (sats[i].cn0 >= 22) xs[m++] = sinf(sats[i].el * 0.0174533f);
  if (m >= 3) {
    float mx = 0, my = 0, sxy = 0, sxx = 0, syy = 0;
    for (int i = 0; i < m; i++) { mx += xs[i]; my += cn[i]; } mx /= m; my /= m;
    for (int i = 0; i < m; i++) { float a = xs[i] - mx, b2 = cn[i] - my; sxy += a * b2; sxx += a * a; syy += b2 * b2; }
    d.r = (sxx > 0 && syy > 0) ? sxy / sqrtf(sxx * syy) : 0;
  }
  if (calibrated && fixValid && posCount > 0) d.dev = lastDev = haversineKm(homeLat, homeLon, lat, lon);
  if (replay) d.dev = lastDev = 38 + (esp_random() % 10) / 10.0f;
  float noise = hwMetrics ? noiseLevel : baseNoise, agc = hwMetrics ? agcPct : baseAgc, jam = hwMetrics ? jamInd : baseJam;
  float jamScore = 0.35f * clampf(d.drop / 12, 0, 1) + 0.25f * clampf((noise - baseNoise) / (baseNoise * 0.6f), 0, 1)
                 + 0.2f * clampf((jam - baseJam) / 120, 0, 1) + 0.2f * clampf((baseAgc - agc) / 30, 0, 1);
  float spoofScore = clampf((3 - d.sd) / 2, 0, 1) * clampf((d.dev - 2) / 12, 0, 1);
  d.index = (int)roundf(clampf(100 * fmaxf(jamScore, 0.9f * spoofScore), 0, 100));
  if (!calibrated) d.index = 0;
  State prev = state;
  if (spoofScore > (prev == SPOOFING ? 0.35f : 0.5f)) state = SPOOFING;
  else if (d.index >= (prev == JAMMING ? 55 : 60)) state = JAMMING;
  else if (d.index >= ((prev == SUSPECT || prev == JAMMING) ? 25 : 30)) state = SUSPECT;
  else state = NOMINAL;
  if (!calibrated) state = NOMINAL;
  // learn the clean baseline: first CAL_SECONDS with a fix, then keep adapting slowly while clean
  if (!replay) {
    for (int i = 0; i < nSats; i++) {
      Sat& s = sats[i]; if (s.prn == 0 || s.prn > 32 || s.cn0 < 22) continue;
      float& b = baseByPrn[s.prn];
      if (!calibrated || b == 0) b = (b == 0) ? s.cn0 : b * 0.9f + s.cn0 * 0.1f;
      else if (state == NOMINAL) b = b * 0.98f + s.cn0 * 0.02f;
    }
  }
  if (!calibrated && d.n >= 4) {                             // needs 4 satellites; a position fix is a bonus
    if (!calStart) calStart = millis();
    sumNoise += noise; sumAgc += agc; sumJam += jam; calCount++;
    if (fixValid) { sumLat += lat; sumLon += lon; posCount++; }
    if (millis() - calStart > CAL_SECONDS * 1000UL && calCount > 10) {
      if (hwMetrics) { baseNoise = sumNoise / calCount; baseAgc = sumAgc / calCount; baseJam = sumJam / calCount; }
      if (posCount) { homeLat = sumLat / posCount; homeLon = sumLon / posCount; }
      calibrated = true;
      Serial.println("Clean baseline learned");
    }
  }
  if (calibrated && posCount == 0 && fixValid) { homeLat = lat; homeLon = lon; posCount = 1; }
  return d;
}
static void recalibrate() {
  calibrated = false; calStart = 0; calCount = 0; posCount = 0; sumNoise = sumAgc = sumJam = sumLat = sumLon = 0;
  for (int i = 0; i <= 32; i++) baseByPrn[i] = 0;
  state = NOMINAL; lastDev = 0;
}

// =============== Signed telecommands ===============
// The dashboard sends {"cmd":"replay_spoof","ts":1761210000,"sig":"<64 hex>"} on CMD_TOPIC, where sig is
// HMAC-SHA256 of "cmd|ts" keyed with COMMAND_PIN. The answer goes out in det.ack of every packet:
// "ok:<cmd>:<ts>" or "rejected:<cmd>:<ts>:<signature|stale|clock|unknown>".
static bool hmacHex(const char* key, const char* msg, char out[65]) {
  uint8_t mac[32]; const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (mbedtls_md_hmac(info, (const unsigned char*)key, strlen(key), (const unsigned char*)msg, strlen(msg), mac) != 0) return false;
  for (int i = 0; i < 32; i++) sprintf(out + 2 * i, "%02x", mac[i]);
  out[64] = 0; return true;
}
static bool sameHex(const char* a, const char* b) {            // constant-time compare: response timing leaks nothing about the key
  if (strlen(b) != 64) return false;
  uint8_t diff = 0;
  for (int i = 0; i < 64; i++) diff |= (uint8_t)(tolower((unsigned char)a[i]) ^ tolower((unsigned char)b[i]));
  return diff == 0;
}
static void onCommand(char* topic, byte* payload, unsigned int len) {
  JsonDocument doc; if (deserializeJson(doc, payload, len)) return;
  const char* cmd = doc["cmd"] | ""; long ts = doc["ts"] | 0L; const char* sig = doc["sig"] | "";
  bool known = !strcmp(cmd, "replay_spoof") || !strcmp(cmd, "recal");
  char msg[64], expect[65]; snprintf(msg, sizeof msg, "%s|%ld", cmd, ts);
  time_t now = time(nullptr);
  const char* why = !known ? "unknown"
                  : now < 1700000000 ? "clock"                                  // no internet time yet, so freshness can't be checked
                  : labs((long)now - ts) >= 120 || ts <= lastCmdTs ? "stale"    // too old, or a replay of a command already run
                  : !hmacHex(COMMAND_PIN, msg, expect) || !sameHex(expect, sig) ? "signature" : nullptr;
  if (why) { snprintf(lastAck, sizeof lastAck, "rejected:%s:%ld:%s", known ? cmd : "?", ts, why); Serial.printf("Rejected command (%s)\n", why); return; }
  lastCmdTs = ts;
  if (!strcmp(cmd, "replay_spoof")) replayUntil = millis() + 20000;
  else recalibrate();
  snprintf(lastAck, sizeof lastAck, "ok:%s:%ld", cmd, ts); Serial.printf("Command accepted: %s\n", cmd);
}

// =============== Network ===============
static void keepConnected() {
  static uint32_t lastTry = 0;
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastTry > 8000) { lastTry = millis(); WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASSWORD); Serial.println("Wi-Fi: connecting"); }
    return;
  }
  if (!mqtt.connected() && millis() - lastTry > 3000) {
    lastTry = millis();
    mqtt.setServer(BROKERS[brokerIdx], MQTT_PORT);
    String id = "sarab1-cube-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqtt.connect(id.c_str())) { mqtt.subscribe(CMD_TOPIC); Serial.printf("MQTT: connected to %s\n", BROKERS[brokerIdx]); }
    else { Serial.printf("MQTT: %s failed (%d), trying the other relay\n", BROKERS[brokerIdx], mqtt.state()); brokerIdx = (brokerIdx + 1) % 2; }
  }
}
static void utcNow(char* out, size_t n) {
  time_t now = time(nullptr);
  if (now > 1700000000) { struct tm t; gmtime_r(&now, &t); strftime(out, n, "%Y-%m-%dT%H:%M:%SZ", &t); }
  else strncpy(out, gpsTime[0] ? gpsTime : "1970-01-01T00:00:00Z", n);
}

// =============== Telemetry ===============
static char packet[2048];
static void sendTelemetry(const Det& d) {
  JsonDocument doc;
  char utc[24]; utcNow(utc, sizeof utc);
  doc["sat"] = "SARAB-1"; doc["seq"] = ++seq; doc["utc"] = utc; doc["src"] = "HW";
  JsonObject g = doc["gnss"].to<JsonObject>();
  bool replay = millis() < replayUntil;
  g["fix"] = fixQ;
  g["lat"] = serialized(String(replay ? lat + 0.25 : lat, 5)); g["lon"] = serialized(String(replay ? lon - 0.22 : lon, 5));
  g["nsat"] = d.n;
  if (hwMetrics) { g["agc_pct"] = serialized(String(agcPct, 1)); g["noise"] = (int)noiseLevel; g["jam_ind"] = jamInd; }
  JsonArray arr = g["sats"].to<JsonArray>();
  for (int i = 0; i < nSats && i < 16; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["prn"] = sats[i].prn; o["el"] = sats[i].el; o["az"] = sats[i].az; o["cn0"] = sats[i].cn0 >= 22 ? sats[i].cn0 : 0;
    if (sats[i].base > 0) o["b"] = serialized(String(sats[i].base, 1));
  }
  JsonObject det = doc["det"].to<JsonObject>();
  det["index"] = d.index; det["state"] = STATE_NAME[state];
  det["drop_db"] = serialized(String(d.drop, 1)); det["cn0_mean"] = serialized(String(d.mean, 1));
  det["cn0_sd"] = serialized(String(d.sd, 2)); det["cn0_el_r"] = serialized(String(d.r, 2)); det["pos_dev_km"] = serialized(String(d.dev, 2));
  JsonObject base = det["base"].to<JsonObject>();
  base["noise"] = serialized(String(baseNoise, 0)); base["agc"] = serialized(String(baseAgc, 1)); base["jam"] = serialized(String(baseJam, 0));
  if (!calibrated) det["cal"] = true;
  if (replay) det["test"] = "replay";
  if (lastAck[0]) det["ack"] = lastAck;
  JsonObject e = doc["eps"].to<JsonObject>();
  e["vbat"] = serialized(String(vbat, 2)); e["ibat_ma"] = (int)roundf(ibat); e["net_w"] = serialized(String(vbat * ibat / 1000.0f, 2)); e["soc_pct"] = (int)roundf(socFromVoltage(vbat));
  JsonObject a = doc["adcs"].to<JsonObject>();
  a["roll_deg"] = serialized(String(rollDeg, 1)); a["pitch_deg"] = serialized(String(pitchDeg, 1)); a["vib_g"] = serialized(String(vibG, 3));
  doc["therm"]["board_c"] = serialized(String(boardC, 1));
  size_t len = serializeJson(doc, packet, sizeof packet);
  if (mqtt.connected()) mqtt.publish(TOPIC, (const uint8_t*)packet, len, true);
}
static void drawOled(const Det& d) {
  char l[24];
  oled.clearBuffer(); oled.setFont(u8g2_font_6x12_tf);
  oled.drawStr(0, 10, "SARAB-1");
  snprintf(l, sizeof l, "#%lu", (unsigned long)seq); oled.drawStr(128 - oled.getStrWidth(l), 10, l);
  snprintf(l, sizeof l, "GPS %s  %d sats", fixQ, d.n); oled.drawStr(0, 24, l);
  snprintf(l, sizeof l, "IDX %d %s", d.index, calibrated ? STATE_NAME[state] : "CAL"); oled.drawStr(0, 38, l);
  snprintf(l, sizeof l, "BAT %.2fV %+dmA", vbat, (int)ibat); oled.drawStr(0, 52, l);
  oled.drawStr(0, 64, WiFi.status() != WL_CONNECTED ? "WiFi --" : mqtt.connected() ? "LINK OK" : "LINK --");
  oled.sendBuffer();
}

// =============== Arduino entry points ===============
void setup() {
  Serial.begin(115200);
  GPS.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Wire.begin(I2C_SDA, I2C_SCL);
  writeReg8(MPU_ADDR, 0x6B, 0x00);                          // wake the MPU6050
  oled.begin();
  oled.clearBuffer(); oled.setFont(u8g2_font_6x12_tf); oled.drawStr(0, 12, "SARAB-1 booting"); oled.sendBuffer();
  for (int i = 0; i <= 32; i++) baseByPrn[i] = 0;
  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  mqtt.setBufferSize(2048); mqtt.setKeepAlive(30); mqtt.setCallback(onCommand);
  delay(1000); enableJammingMonitor();
  Serial.println("SARAB-1 flight software started");
}

void loop() {
  static uint32_t lastFast = 0, lastSec = 0, lastPoll = 0;
  readGps();
  keepConnected(); mqtt.loop();
  uint32_t now = millis();
  if (now - lastFast >= 20) { lastFast = now; readMotion(false); }        // 50 Hz vibration sampling
  if (now - lastPoll >= 1000) { lastPoll = now; ubxSend(0x0A, 0x09, nullptr, 0); }   // poll UBX-MON-HW
  if (hwMetrics && now - lastMonHw > 10000) hwMetrics = false;           // clone modules never answer
  if (now - lastSec >= 1000) {
    lastSec = now;
    readMotion(true); readPower();
    Det d = detect();
    sendTelemetry(d); drawOled(d);
    Serial.printf("#%lu fix=%s sats=%d idx=%d %s vbat=%.2f\n", (unsigned long)seq, fixQ, d.n, d.index, STATE_NAME[state], vbat);
  }
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 's') { replayUntil = millis() + 20000; Serial.println("Spoofing replay test: 20 s"); }
    if (c == 'c') { recalibrate(); Serial.println("Recalibrating clean baseline"); }
  }
}

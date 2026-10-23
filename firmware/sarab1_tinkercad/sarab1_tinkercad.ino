/*
  SARAB-1 · Tinkercad Circuits model of the flight software
  ----------------------------------------------------------
  Tinkercad has no ESP32 or GPS receiver, so this circuit stands in for the cube:
    Arduino Uno            -> ESP32 flight computer
    LCD 16x2 (I2C)         -> 0.96" SSD1306 OLED, on the same kind of I2C bus (SDA A4, SCL A5)
    SIGNAL potentiometer   -> GPS signal strength; turn it down to block the antenna (the foil-cap test)
    NOISE potentiometer    -> RF noise next to the antenna (the noisy-device test)
    SPOOF switch           -> the replayed spoofed track (the replay test)
    RECAL button           -> relearn the clean baseline (the dashboard's "recal" telecommand)
    green, yellow, red LED and the buzzer -> detection state and alert
  The receiver is modelled with 10 satellites whose strength depends on their elevation. The detection
  maths, thresholds and packet fields are the ones in firmware/sarab1/sarab1.ino. Every second the model
  prints one telemetry packet (JSON) on the Serial Monitor.

  Both potentiometers count as clean anywhere in their first half (SIGNAL high, NOISE low), so the first
  10 seconds always learn a clean baseline whatever position the knobs start in.

  Wiring: SIGNAL wiper A0 and NOISE wiper A1 (pot ends to 5V and GND); SPOOF switch: common to D2, one
  end to 5V, D2 pulled down to GND by 10k; RECAL push button D3 to GND; LEDs D5 green, D6 yellow, D7 red,
  each through 220 ohm to GND; piezo D8 to GND; LCD SDA A4, SCL A5, VCC 5V, GND.
*/
#include <Adafruit_LiquidCrystal.h>
#include <math.h>

Adafruit_LiquidCrystal lcd(0);

const int PIN_SIGNAL = A0, PIN_NOISE = A1, PIN_SPOOF = 2, PIN_RECAL = 3;
const int LED_GREEN = 5, LED_YELLOW = 6, LED_RED = 7, BUZZER = 8;
const int NSAT = 10, CAL_SECONDS = 10;

const int8_t EL[NSAT] = { 78, 64, 55, 47, 39, 33, 27, 21, 15, 11 };   // satellite elevations, degrees
float cn0[NSAT], base[NSAT];                                         // signal strength now and its clean baseline, dB-Hz

enum State { NOMINAL, SUSPECT, JAMMING, SPOOFING };
const char* STATE_NAME[] = { "NOMINAL", "SUSPECT", "JAMMING", "SPOOFING" };
State state = NOMINAL;
bool calibrated = false;
int calCount = 0;
float baseNoise = 80, baseAgc = 58, baseJam = 8, sumNoise = 0, sumAgc = 0, sumJam = 0;
unsigned long seq = 0, lastSec = 0;

float clampf(float v, float a, float b) { return v < a ? a : (v > b ? b : v); }

void recalibrate() {
  calibrated = false; calCount = 0; sumNoise = sumAgc = sumJam = 0;
  for (int i = 0; i < NSAT; i++) base[i] = 0;
  state = NOMINAL;
}

void lcdLine(int row, const String& text) {             // print a full 16-character row, so old text never lingers
  lcd.setCursor(0, row);
  String s = text;
  while (s.length() < 16) s += ' ';
  lcd.print(s.substring(0, 16));
}

void setup() {
  Serial.begin(9600);
  pinMode(PIN_SPOOF, INPUT);
  pinMode(PIN_RECAL, INPUT_PULLUP);
  pinMode(LED_GREEN, OUTPUT); pinMode(LED_YELLOW, OUTPUT); pinMode(LED_RED, OUTPUT); pinMode(BUZZER, OUTPUT);
  lcd.begin(16, 2);
  lcd.setBacklight(1);
  lcdLine(0, "SARAB-1");
  lcdLine(1, "GNSS watch boot");
  randomSeed(analogRead(A3));
  recalibrate();
  Serial.println("SARAB-1 Tinkercad model started: learning the clean baseline");
}

void loop() {
  if (digitalRead(PIN_RECAL) == LOW) { recalibrate(); Serial.println("Recalibrating clean baseline"); delay(300); }
  unsigned long now = millis();
  if (now - lastSec < 1000) return;
  lastSec = now;

  // ---- the receiver: what the GPS module reports this second ----
  bool spoof = digitalRead(PIN_SPOOF) == HIGH;
  float atten = max(0, 512 - analogRead(PIN_SIGNAL)) * 25.0 / 512;   // dB of signal lost, up to 25 dB (foil cap)
  float noise = 80 + max(0, analogRead(PIN_NOISE) - 512) * 170.0 / 511; // receiver noise level, 80 when clean
  float jam = 8 + (noise - 80) * 0.9;                                   // the jamming indicator rises with the noise
  float agc = 58 - (noise - 80) * 0.15;                                 // and the gain control backs off
  float noiseLoss = 10 * log10(noise / 80);                             // a higher noise floor lowers every C/N0
  for (int i = 0; i < NSAT; i++) {
    float clean = 32 + 16 * sin(EL[i] * 0.0174533);
    cn0[i] = spoof ? 43 + random(7) / 10.0                               // replayed spoofed signal: every satellite the same strength
                   : clean - atten - noiseLoss + (random(11) - 5) / 10.0;
  }

  // ---- detection: the same maths as the flight software and the ground station ----
  int n = 0, withBase = 0;
  float dropSum = 0, mean = 0, sd = 0;
  for (int i = 0; i < NSAT; i++) {
    if (base[i] > 0) { dropSum += max(0.0, base[i] - max(cn0[i], 15.0)); withBase++; }
    if (cn0[i] >= 22) { mean += cn0[i]; n++; }                          // below 22 dB-Hz a satellite has dropped out
  }
  float drop = withBase ? dropSum / withBase : 0;
  if (n) mean /= n;
  for (int i = 0; i < NSAT; i++) if (cn0[i] >= 22) sd += (cn0[i] - mean) * (cn0[i] - mean);
  sd = n > 1 ? sqrt(sd / (n - 1)) : 0;
  float dev = spoof ? 38 + random(10) / 10.0 : 0;                       // how far the position jumped, km
  float jamScore = 0.35 * clampf(drop / 12, 0, 1) + 0.25 * clampf((noise - baseNoise) / (baseNoise * 0.6), 0, 1)
                 + 0.2 * clampf((jam - baseJam) / 120, 0, 1) + 0.2 * clampf((baseAgc - agc) / 30, 0, 1);
  float spoofScore = clampf((3 - sd) / 2, 0, 1) * clampf((dev - 2) / 12, 0, 1);
  int index = calibrated ? (int)round(clampf(100 * max(jamScore, 0.9 * spoofScore), 0, 100)) : 0;
  State prev = state;
  if (spoofScore > (prev == SPOOFING ? 0.35 : 0.5)) state = SPOOFING;
  else if (index >= (prev == JAMMING ? 55 : 60)) state = JAMMING;
  else if (index >= ((prev == SUSPECT || prev == JAMMING) ? 25 : 30)) state = SUSPECT;
  else state = NOMINAL;
  if (!calibrated) state = NOMINAL;

  // ---- learn the clean baseline in the first CAL_SECONDS, then keep adapting slowly while clean ----
  if (!spoof) {
    for (int i = 0; i < NSAT; i++) {
      if (cn0[i] < 22) continue;
      if (!calibrated || base[i] == 0) base[i] = base[i] == 0 ? cn0[i] : base[i] * 0.9 + cn0[i] * 0.1;
      else if (state == NOMINAL) base[i] = base[i] * 0.98 + cn0[i] * 0.02;
    }
  }
  if (!calibrated) {
    sumNoise += noise; sumAgc += agc; sumJam += jam;
    if (++calCount >= CAL_SECONDS) {
      baseNoise = sumNoise / calCount; baseAgc = sumAgc / calCount; baseJam = sumJam / calCount;
      calibrated = true;
      Serial.println("Clean baseline learned");
    }
  }
  seq++;

  // ---- LEDs, buzzer and screen ----
  bool blink = seq % 2;
  digitalWrite(LED_GREEN, calibrated && state == NOMINAL);
  digitalWrite(LED_YELLOW, calibrated ? state == SUSPECT : blink);     // yellow blinks while learning the baseline
  digitalWrite(LED_RED, state == JAMMING || (state == SPOOFING && blink));
  if ((state == JAMMING || state == SPOOFING) && state != prev) tone(BUZZER, 2000, 250);

  if (!calibrated) lcdLine(0, "CAL " + String(CAL_SECONDS - calCount) + "s baseline");
  else lcdLine(0, "IDX " + String(index) + " " + STATE_NAME[state]);
  if (spoof) lcdLine(1, "JUMP " + String((int)dev) + "km SD" + String(sd, 1));
  else lcdLine(1, String(n) + "sat CN" + String((int)round(mean)) + " N" + String((int)noise));

  // ---- one telemetry packet, the same fields the cube sends to the dashboard ----
  Serial.print("{\"sat\":\"SARAB-1\",\"seq\":"); Serial.print(seq);
  Serial.print(",\"src\":\"SIM\",\"gnss\":{\"nsat\":"); Serial.print(n);
  Serial.print(",\"noise\":"); Serial.print((int)noise);
  Serial.print(",\"agc_pct\":"); Serial.print(agc, 1);
  Serial.print(",\"jam_ind\":"); Serial.print((int)jam);
  Serial.print("},\"det\":{\"index\":"); Serial.print(index);
  Serial.print(",\"state\":\""); Serial.print(STATE_NAME[state]);
  Serial.print("\",\"drop_db\":"); Serial.print(drop, 1);
  Serial.print(",\"cn0_mean\":"); Serial.print(mean, 1);
  Serial.print(",\"cn0_sd\":"); Serial.print(sd, 2);
  Serial.print(",\"pos_dev_km\":"); Serial.print(dev, 2);
  if (!calibrated) Serial.print(",\"cal\":true");
  if (spoof) Serial.print(",\"test\":\"replay\"");
  Serial.println("}}");
}

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_INA219.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <DHT.h>
#include <math.h>

/*
  =============================================================================
  PROJECT: MOTRIVEXA
  SMART PREDICTIVE HEALTH MONITORING AND PROTECTION SYSTEM FOR INDUSTRIAL MOTORS
  Tagline: Intelligent Monitoring. Predictive Insights. Safer Motors.

  Hardware Platform: ESP32 Development Board
  Serial Speed:      115200 Baud
  Telemetry:         Structured JSON output for Web Serial Dashboard + Serial Monitor
  =============================================================================
  PIN ALLOCATION:
  - TEMP_PIN (DS18B20 OneWire): GPIO 4 (Motor Contact Temperature)
  - DHT_PIN  (DHT11 Data):       GPIO 18 (Ambient Temp & Relative Humidity)
  - KY024_PIN (Analog AO):      GPIO 34 (Hall Effect Magnetic Sensor ADC1)
  - ENA (Motor PWM Speed):      GPIO 25
  - IN1 (Motor Direction 1):    GPIO 26
  - IN2 (Motor Direction 2):    GPIO 27
  - BUZZER_PIN (Buzzer Alert):  GPIO 33
  - SDA_PIN (I2C Data):         GPIO 21 (INA219 & OLED & MPU6050)
  - SCL_PIN (I2C Clock):        GPIO 22 (INA219 & OLED & MPU6050)
  =============================================================================
*/

// ================= OLED DISPLAY =================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define OLED_ADDRESS 0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ================= PIN DEFINITIONS =================
#define TEMP_PIN 4      // DS18B20 OneWire Bus
#define DHT_PIN 18      // DHT11 Ambient Sensor (Safe, non-conflicting GPIO)
#define DHTTYPE DHT11

#define KY024_PIN 34    // KY-024 Analog Output (AO), ADC1 input-only pin

#define ENA 25          // L298N / Driver PWM Speed
#define IN1 26          // L298N Direction Input 1
#define IN2 27          // L298N Direction Input 2

#define BUZZER_PIN 33   // Active Alert Buzzer

// I2C Bus Pins
#define SDA_PIN 21
#define SCL_PIN 22

// ================= SENSORS =================
Adafruit_INA219 ina219;

OneWire oneWire(TEMP_PIN);
DallasTemperature sensors(&oneWire);

DHT dht(DHT_PIN, DHTTYPE);

// ================= MOTOR STATE =================
bool motorRunning = false;
char motorDirection = 'S'; // 'S' = Stop, 'F' = Forward, 'R' = Reverse
int motorSpeed = 200;      // PWM value (0 - 255)

// ================= KY-024 MAGNETIC SENSOR =================
int ky024Reading = 0;

// ================= INA219 ELECTRICAL SENSOR =================
float inaVoltage = 0.0;
float inaCurrent = 0.0;
float inaPower = 0.0;
float inaShunt = 0.0;
bool batteryPresent = false;

// ================= MOTOR TEMPERATURE (DS18B20) =================
float temperatureC = 0.0;
bool temperatureReady = false;

// ================= AMBIENT SENSING (DHT11) =================
float ambientTemperature = 0.0;
float ambientHumidity = 0.0;
bool dhtReady = false;

// ================= MPU6050 VIBRATION SENSING =================
const uint8_t MPU_ADDR = 0x68;
float vibrationRMS = 0.0;
int vibrationScore = 0;
const float VIBRATION_THRESHOLD = 0.006;

// ================= ALERT STATE =================
bool alertActive = false;
bool vibrationAlert = false;
bool voltageAlert = false;
bool currentAlert = false;
bool temperatureAlert = false;

// ================= TIMING & TELEMETRY =================
unsigned long lastTelemetryTime = 0;
const unsigned long TELEMETRY_INTERVAL = 600; // Emit telemetry JSON every 600 ms

unsigned long lastDHTTime = 0;
const unsigned long DHT_INTERVAL = 1500;       // Read DHT11 every 1500 ms (sensor limit)

// ================= MOTOR CONTROL FUNCTIONS =================
void motorStop() {
  analogWrite(ENA, 0);
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);

  motorRunning = false;
  motorDirection = 'S';

  vibrationRMS = 0;
  vibrationScore = 0;
}

void motorForward() {
  motorStop();
  delay(80);

  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  analogWrite(ENA, motorSpeed);

  motorRunning = true;
  motorDirection = 'F';
}

void motorReverse() {
  motorStop();
  delay(80);

  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  analogWrite(ENA, motorSpeed);

  motorRunning = true;
  motorDirection = 'R';
}

// ================= SERIAL COMMAND INTERPRETER =================
void processSerial() {
  while (Serial.available() > 0) {
    char command = Serial.read();

    if (command == 'F' || command == 'f') {
      motorForward();
      Serial.println(F("[MOTRIVEXA] Motor Command: FORWARD"));
    }
    else if (command == 'R' || command == 'r') {
      motorReverse();
      Serial.println(F("[MOTRIVEXA] Motor Command: REVERSE"));
    }
    else if (command == 'S' || command == 's') {
      motorStop();
      Serial.println(F("[MOTRIVEXA] Motor Command: STOP"));
    }
  }
}

// ================= INA219 MEASUREMENT =================
void updateINA() {
  float busVoltage = ina219.getBusVoltage_V();

  if (busVoltage > 3.0) {
    batteryPresent = true;
    inaVoltage = busVoltage;
    inaCurrent = ina219.getCurrent_mA();
    inaPower = ina219.getPower_mW();
    inaShunt = ina219.getShuntVoltage_mV();
  }
  else {
    batteryPresent = false;
    inaVoltage = 0.0;
    inaCurrent = 0.0;
    inaPower = 0.0;
    inaShunt = 0.0;
  }
}

// ================= MPU6050 READ & VIBRATION CALCULATION =================
bool readIMU16(uint8_t reg, int16_t &value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);

  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  Wire.requestFrom(MPU_ADDR, (uint8_t)2);

  if (Wire.available() < 2) {
    return false;
  }

  uint8_t highByte = Wire.read();
  uint8_t lowByte = Wire.read();

  value = (int16_t)((highByte << 8) | lowByte);
  return true;
}

void calculateVibration() {
  // Sample 40 measurements at 3ms intervals for responsive non-blocking performance
  const int N = 40;
  float sum = 0.0;
  float sumSquares = 0.0;

  for (int i = 0; i < N; i++) {
    int16_t axRaw, ayRaw, azRaw;

    if (!readIMU16(0x3B, axRaw) || !readIMU16(0x3D, ayRaw) || !readIMU16(0x3F, azRaw)) {
      vibrationRMS = 0;
      vibrationScore = 0;
      return;
    }

    // MPU6050 +/-2g range: 16384 LSB/g
    float ax = axRaw / 16384.0;
    float ay = ayRaw / 16384.0;
    float az = azRaw / 16384.0;

    float magnitude = sqrt(ax * ax + ay * ay + az * az);
    sum += magnitude;
    sumSquares += magnitude * magnitude;

    delay(3);
  }

  float mean = sum / N;
  float variance = (sumSquares / N) - (mean * mean);

  if (variance < 0.0) {
    variance = 0.0;
  }

  vibrationRMS = sqrt(variance);

  if (vibrationRMS > VIBRATION_THRESHOLD) {
    vibrationScore = (int)round((vibrationRMS - VIBRATION_THRESHOLD) * 1000.0);
  }
  else {
    vibrationScore = 0;
  }
}

// ================= KY-024 HALL SENSOR AO =================
void updateKY024() {
  if (motorRunning) {
    ky024Reading = analogRead(KY024_PIN);
  }
  else {
    ky024Reading = 0;
  }
}

// ================= DS18B20 MOTOR TEMPERATURE =================
void updateTemperature() {
  static unsigned long lastRequest = 0;
  static bool conversionStarted = false;
  unsigned long now = millis();

  if (!conversionStarted) {
    sensors.requestTemperatures();
    lastRequest = now;
    conversionStarted = true;
  }

  // DS18B20 requires up to 750ms for 12-bit conversion
  if (conversionStarted && (now - lastRequest >= 750)) {
    float temp = sensors.getTempCByIndex(0);

    if (temp != DEVICE_DISCONNECTED_C && temp >= -55.0 && temp <= 125.0) {
      temperatureC = temp;
      temperatureReady = true;
    }
    else {
      temperatureReady = false;
    }

    conversionStarted = false;
  }
}

// ================= DHT11 AMBIENT ENVIRONMENT =================
void updateDHT() {
  unsigned long now = millis();
  if (now - lastDHTTime >= DHT_INTERVAL) {
    lastDHTTime = now;
    float h = dht.readHumidity();
    float t = dht.readTemperature();

    if (!isnan(h) && !isnan(t) && t >= -20.0 && t <= 80.0 && h >= 0.0 && h <= 100.0) {
      ambientTemperature = t;
      ambientHumidity = h;
      dhtReady = true;
    }
    else {
      dhtReady = false;
    }
  }
}

// ================= ALERT & HARDWARE BUZZER LOGIC =================
void updateAlert() {
  vibrationAlert = false;
  voltageAlert = false;
  currentAlert = false;
  temperatureAlert = false;

  if (motorRunning) {
    vibrationAlert = (vibrationScore > 124);
    voltageAlert = (inaVoltage < 8.0 || inaVoltage > 13.0);
    currentAlert = (inaCurrent > 750.0);
    temperatureAlert = (temperatureReady && temperatureC > 60.0);
  }

  alertActive = (vibrationAlert || voltageAlert || currentAlert || temperatureAlert);

  digitalWrite(BUZZER_PIN, alertActive ? HIGH : LOW);

  // Serial Monitor text alert notifications
  if (motorRunning) {
    if (vibrationAlert) {
      Serial.println(F("ALERT: HIGH VIBRATION"));
    }
    if (voltageAlert) {
      Serial.println(F("ALERT: VOLTAGE ABNORMAL"));
    }
    if (currentAlert) {
      Serial.println(F("ALERT: HIGH CURRENT"));
    }
    if (temperatureReady && temperatureC >= 70.0) {
      Serial.println(F("CRITICAL: HIGH MOTOR TEMPERATURE"));
    }
    else if (temperatureAlert) {
      Serial.println(F("WARNING: TEMPERATURE HIGH"));
    }
  }
}

// ================= OLED DISPLAY =================
void updateOLED() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  display.setCursor(0, 0);
  display.print("MOTRIVEXA: ");
  if (!motorRunning) {
    display.println("STOP");
  }
  else if (motorDirection == 'F') {
    display.println("FWD");
  }
  else {
    display.println("REV");
  }

  display.print("V:");
  display.print(inaVoltage, 1);
  display.print("V I:");
  display.print(inaCurrent, 0);
  display.println("mA");

  display.print("Vib Score: ");
  display.println(vibrationScore);

  display.print("Motor T: ");
  if (temperatureReady) {
    display.print(temperatureC, 1);
    display.println(" C");
  }
  else {
    display.println("--");
  }

  display.print("Amb: ");
  if (dhtReady) {
    display.print(ambientTemperature, 0);
    display.print("C ");
    display.print(ambientHumidity, 0);
    display.println("%");
  }
  else {
    display.println("-- C -- %");
  }

  display.print("Mag ADC: ");
  display.println(ky024Reading);

  display.print("Status: ");
  display.println(alertActive ? "! ALERT !" : "NORMAL");

  display.display();
}

// ================= STRUCTURED JSON TELEMETRY =================
void sendTelemetryJSON() {
  Serial.print("{\"type\":\"telemetry\"");

  // Motor state
  Serial.print(",\"motor\":\"");
  if (!motorRunning) {
    Serial.print("STOP");
  }
  else if (motorDirection == 'F') {
    Serial.print("FORWARD");
  }
  else {
    Serial.print("REVERSE");
  }
  Serial.print("\"");

  // INA219 Voltage, Current, Power, Shunt
  Serial.print(",\"voltage\":");
  Serial.print(inaVoltage, 2);

  Serial.print(",\"current\":");
  Serial.print(inaCurrent, 1);

  Serial.print(",\"power\":");
  Serial.print(inaPower, 1);

  Serial.print(",\"shuntVoltage\":");
  Serial.print(inaShunt, 2);

  // DS18B20 Motor Temperature (null if unavailable)
  Serial.print(",\"motorTemperature\":");
  if (temperatureReady) {
    Serial.print(temperatureC, 2);
  }
  else {
    Serial.print("null");
  }

  // DHT11 Ambient Temperature (null if unavailable)
  Serial.print(",\"ambientTemperature\":");
  if (dhtReady) {
    Serial.print(ambientTemperature, 1);
  }
  else {
    Serial.print("null");
  }

  // DHT11 Ambient Humidity (null if unavailable)
  Serial.print(",\"humidity\":");
  if (dhtReady) {
    Serial.print(ambientHumidity, 1);
  }
  else {
    Serial.print("null");
  }

  // Vibration Score & RMS
  Serial.print(",\"vibrationScore\":");
  Serial.print(vibrationScore);

  Serial.print(",\"vibrationRMS\":");
  Serial.print(vibrationRMS, 4);

  // KY-024 Analog ADC
  Serial.print(",\"ky024Raw\":");
  Serial.print(ky024Reading);

  // Buzzer State
  Serial.print(",\"buzzer\":\"");
  Serial.print(alertActive ? "ALERT" : "OFF");
  Serial.print("\"");

  // Alert Breakdown Flags
  Serial.print(",\"vibrationAlert\":");
  Serial.print(vibrationAlert ? "true" : "false");

  Serial.print(",\"voltageAlert\":");
  Serial.print(voltageAlert ? "true" : "false");

  Serial.print(",\"currentAlert\":");
  Serial.print(currentAlert ? "true" : "false");

  Serial.print(",\"temperatureAlert\":");
  Serial.print(temperatureAlert ? "true" : "false");

  // Uptime in ms
  Serial.print(",\"uptime\":");
  Serial.print(millis());

  Serial.println("}");
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);

  Wire.begin(SDA_PIN, SCL_PIN);

  // Motor output pins
  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);

  // Alert Buzzer
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // KY-024 Analog Pin configuration
  pinMode(KY024_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(KY024_PIN, ADC_11db);

  // OLED Display Initialization
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
    Serial.println(F("[MOTRIVEXA] OLED not found on 0x3C"));
  }
  else {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(15, 20);
    display.println(F("MOTRIVEXA IoT"));
    display.setCursor(15, 35);
    display.println(F("Initializing..."));
    display.display();
  }

  // INA219 Current/Voltage Sensor
  if (!ina219.begin()) {
    Serial.println(F("[MOTRIVEXA] INA219 not found"));
  }
  else {
    Serial.println(F("[MOTRIVEXA] INA219 ready"));
  }

  // DS18B20 Temperature Sensor
  sensors.begin();
  sensors.setWaitForConversion(false);

  // DHT11 Ambient Temperature & Humidity Sensor
  dht.begin();
  Serial.println(F("[MOTRIVEXA] DHT11 initialized on GPIO 18"));

  // MPU6050 Accelerometer Wakeup
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B); // Power Management 1 register
  Wire.write(0x00); // Wake up sensor
  if (Wire.endTransmission() == 0) {
    Serial.println(F("[MOTRIVEXA] MPU6050 ready"));
  }
  else {
    Serial.println(F("[MOTRIVEXA] MPU6050 not detected on 0x68"));
  }

  // Safety initial state: stop motor
  motorStop();

  Serial.println();
  Serial.println(F("=================================================="));
  Serial.println(F("MOTRIVEXA: Smart Motor Health Monitoring System"));
  Serial.println(F("Commands: F = Forward, R = Reverse, S = Stop"));
  Serial.println(F("Telemetry format: Structured JSON @ 115200 Baud"));
  Serial.println(F("=================================================="));
}

// ================= MAIN LOOP =================
void loop() {
  // 1. Process serial commands from user/website ('F', 'R', 'S')
  processSerial();

  // 2. Update electrical metrics from INA219
  updateINA();

  // 3. Update KY-024 Hall effect ADC reading
  updateKY024();

  // 4. Calculate vibration when motor is running
  if (motorRunning) {
    calculateVibration();
  }

  // 5. Update DS18B20 motor contact temperature
  updateTemperature();

  // 6. Update DHT11 ambient environment
  updateDHT();

  // 7. Evaluate safety conditions and trigger buzzer if necessary
  updateAlert();

  // 8. Update physical OLED display
  updateOLED();

  // 9. Emit structured JSON telemetry record at steady intervals
  unsigned long currentMillis = millis();
  if (currentMillis - lastTelemetryTime >= TELEMETRY_INTERVAL) {
    lastTelemetryTime = currentMillis;
    sendTelemetryJSON();
  }

  delay(30);
}

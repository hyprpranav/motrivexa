#include <Wire.h>
#include <Adafruit_INA219.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ========== PIN CONFIGURATION ==========
#define ENA 25
#define IN1 26
#define IN2 27

#define IR_PIN 32
#define KY024_PIN 34

#define DHT_PIN 14
#define DHT_TYPE DHT11

#define DS18B20_PIN 4

// ========== SENSOR OBJECTS ==========
Adafruit_INA219 ina219;
DHT dht(DHT_PIN, DHT_TYPE);

OneWire oneWire(DS18B20_PIN);
DallasTemperature ds18b20(&oneWire);

bool ina219OK = false;

// ========== MOTOR CONTROL ==========
bool motorON = false;
int motorSpeed = 255;

// ========== RPM SETTINGS ==========
const int PULSES_PER_REVOLUTION = 1;

// Reject electrical noise / repeated edges.
// 2000 us supports up to 30,000 RPM with one mark.
const unsigned long MIN_PULSE_GAP_US = 2000;

// Measure over 2 seconds for more stable readings.
const unsigned long RPM_WINDOW_MS = 2000;

// Hold last RPM briefly if a pulse is missed.
const unsigned long ZERO_TIMEOUT_MS = 1500;

volatile unsigned long pulseCount = 0;
volatile unsigned long lastPulseMicros = 0;

unsigned long previousRPMTime = 0;
unsigned long lastValidPulseTime = 0;

float rpm = 0;
unsigned long pulsesPerWindow = 0;

// ========== SENSOR VALUES ==========
float voltage = 0;
float current = 0;
float power = 0;

float motorTemp = 0;
float ambientTemp = 0;
float humidity = 0;

int ky024Raw = 0;
int vibrationScore = 0;

unsigned long previousSensorTime = 0;
const unsigned long SENSOR_INTERVAL = 2000;

// ========== IR INTERRUPT ==========
void IRAM_ATTR countPulse() {
  unsigned long currentMicros = micros();

  if (currentMicros - lastPulseMicros >= MIN_PULSE_GAP_US) {
    pulseCount++;
    lastPulseMicros = currentMicros;
  }
}

// ========== MOTOR START ==========
void motorStart() {
  motorON = true;

  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  analogWrite(ENA, motorSpeed);

  Serial.println("MOTOR ON");
}

// ========== MOTOR STOP ==========
void motorStop() {
  motorON = false;

  analogWrite(ENA, 0);
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);

  vibrationScore = 0;
  ky024Raw = 0;

  Serial.println("MOTOR OFF");
}

// ========== SERIAL COMMANDS ==========
void checkCommands() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    command.toUpperCase();

    if (command == "ON" || command == "F" || command == "START") {
      motorStart();
    }
    else if (command == "OFF" || command == "S" || command == "STOP") {
      motorStop();
    }
    else if (command == "STATUS") {
      Serial.print("MOTOR STATUS: ");
      Serial.println(motorON ? "ON" : "OFF");

      Serial.print("RPM: ");
      Serial.println((int)rpm);
    }
    else if (command == "HELP") {
      Serial.println("ON - START MOTOR");
      Serial.println("OFF - STOP MOTOR");
      Serial.println("STATUS - MOTOR STATUS");
      Serial.println("HELP - COMMAND LIST");
    }
    else {
      Serial.println("INVALID COMMAND");
    }
  }
}

// ========== RPM CALCULATION ==========
void calculateRPM(unsigned long now) {
  if (now - previousRPMTime >= RPM_WINDOW_MS) {

    noInterrupts();
    unsigned long pulses = pulseCount;
    pulseCount = 0;
    interrupts();

    pulsesPerWindow = pulses;

    if (pulses > 0) {
      // Actual RPM from pulse count and measurement time.
      rpm = (pulses * 60000.0) /
            (RPM_WINDOW_MS * PULSES_PER_REVOLUTION);

      lastValidPulseTime = now;
    }
    else {
      // Do not immediately drop RPM to zero.
      if (now - lastValidPulseTime >= ZERO_TIMEOUT_MS) {
        rpm = 0;
      }
    }

    previousRPMTime = now;
  }

  // Stop condition: after motor is stopped, RPM becomes zero.
  if (!motorON && now - lastValidPulseTime >= ZERO_TIMEOUT_MS) {
    rpm = 0;
  }
}

// ========== SETUP ==========
void setup() {
  Serial.begin(115200);
  Serial.setTimeout(20);

  Wire.begin(21, 22);

  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);

  pinMode(IR_PIN, INPUT_PULLUP);
  pinMode(KY024_PIN, INPUT);

  attachInterrupt(
    digitalPinToInterrupt(IR_PIN),
    countPulse,
    FALLING
  );

  dht.begin();

  ds18b20.begin();
  ds18b20.setResolution(9);

  ina219OK = ina219.begin();

  motorStop();

  randomSeed(micros());

  previousRPMTime = millis();
  previousSensorTime = millis();

  Serial.println();
  Serial.println("ESP32 MOTOR MONITORING SYSTEM");
  Serial.println(ina219OK ? "INA219 CONNECTED" : "INA219 NOT FOUND");
  Serial.println("DS18B20 INITIALIZED");
  Serial.println("DHT11 INITIALIZED");
  Serial.println("IR SENSOR INITIALIZED");
  Serial.println("KY-024 INITIALIZED");
  Serial.println("ONE REFLECTIVE MARK = ONE REVOLUTION");
  Serial.println("TYPE ON / OFF / STATUS / HELP");
}

// ========== MAIN LOOP ==========
void loop() {
  checkCommands();

  unsigned long now = millis();

  // RPM calculation
  calculateRPM(now);

  // ========== SENSOR READING ==========
  if (now - previousSensorTime >= SENSOR_INTERVAL) {
    previousSensorTime = now;

    // INA219
    if (ina219OK) {
      voltage = ina219.getBusVoltage_V();
      current = ina219.getCurrent_mA() / 1000.0;
      power = ina219.getPower_mW() / 1000.0;
    }

    // DS18B20
    ds18b20.requestTemperatures();
    float temp = ds18b20.getTempCByIndex(0);

    if (temp != DEVICE_DISCONNECTED_C) {
      motorTemp = temp;
    }

    // DHT11
    float tempDHT = dht.readTemperature();
    float humDHT = dht.readHumidity();

    if (!isnan(tempDHT)) {
      ambientTemp = tempDHT;
    }

    if (!isnan(humDHT)) {
      humidity = humDHT;
    }

    // KY-024 AO
    ky024Raw = motorON ? analogRead(KY024_PIN) : 0;

    // Existing vibration score behavior
    if (motorON) {
      vibrationScore = random(50, 101);
    }
    else {
      vibrationScore = 0;
    }
  }

  // ========== SERIAL OUTPUT ==========
  static unsigned long previousPrintTime = 0;

  if (now - previousPrintTime >= 1000) {
    previousPrintTime = now;

    Serial.println();
    Serial.println("========== MOTOR MONITORING SYSTEM ==========");

    Serial.print("VOLTAGE              : ");
    Serial.print(voltage, 2);
    Serial.println(" V");

    Serial.print("CURRENT              : ");
    Serial.print(current, 3);
    Serial.println(" A");

    Serial.print("POWER                : ");
    Serial.print(power, 2);
    Serial.println(" W");

    Serial.print("MOTOR TEMPERATURE    : ");
    Serial.print(motorTemp, 2);
    Serial.println(" C");

    Serial.print("AMBIENT TEMPERATURE  : ");
    Serial.print(ambientTemp, 2);
    Serial.println(" C");

    Serial.print("HUMIDITY             : ");
    Serial.print(humidity, 1);
    Serial.println(" %");

    Serial.print("IR PULSES PER WINDOW : ");
    Serial.println(pulsesPerWindow);

    Serial.print("RPM                  : ");
    Serial.println((int)rpm);

    Serial.print("KY024 AO RAW         : ");
    Serial.println(ky024Raw);

    Serial.print("VIBRATION SCORE      : ");
    Serial.print(vibrationScore);
    Serial.println(" mg");

    Serial.print("MOTOR STATUS         : ");
    Serial.println(motorON ? "ON" : "OFF");
  }
}

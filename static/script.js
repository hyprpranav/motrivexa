/**
 * ============================================================================
 * MOTRIVEXA - INDUSTRIAL IOT DASHBOARD CONTROLLER
 * Smart Predictive Health Monitoring and Protection System for Electric Motors
 * Web Serial API + Chart.js + Telemetry Analytics Pipeline
 * ============================================================================
 */

(() => {
  'use strict';

  // ================= ESP32 PRODUCTION FIRMWARE CODE =================
  const FIRMWARE_CODE = `#include <Wire.h>
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
    String command = Serial.readStringUntil('\\n');
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
}`;

  // ================= CONFIGURATION & CONSTANTS =================
  const DEFAULT_SETTINGS = {
    voltMin: 8.0,
    voltMax: 13.0,
    currMax: 750.0,
    vibMax: 124,
    tempWarn: 60.0,
    tempCrit: 70.0,
    staleTimeout: 4.0 // seconds
  };

  const MAX_HISTORY_ROWS = 50;
  const MAX_CHART_POINTS = 60;

  // ================= STATE =================
  let port = null;
  let reader = null;
  let keepReading = false;
  let serialBuffer = '';

  let settings = { ...DEFAULT_SETTINGS };
  let telemetryHistory = [];
  let chartsPaused = false;
  let lastTelemetryTimestamp = 0;
  let staleCheckInterval = null;

  let audioContext = null;
  let isAudioAlarmEnabled = false;
  let lastBeepTime = 0;

  // Current parsed sensor state from ESP32
  let currentTelemetry = {
    voltage: 0.0,
    current: 0.0,      // in A
    current_mA: 0.0,   // in mA
    power: 0.0,        // in W
    power_mW: 0.0,     // in mW
    motorTemperature: null,
    ambientTemperature: null,
    humidity: null,
    irPulses: 0,
    rpm: 0,
    ky024Raw: 0,
    vibrationScore: 0,
    motor: 'OFF',
    buzzer: 'OFF'
  };

  let telemetryCommitTimer = null;
  let currentTheme = 'dark';

  // Chart.js Instances
  let electricalChart = null;
  let powerChart = null;
  let thermalChart = null;
  let vibrationChart = null;

  // ================= DOM ELEMENT REFERENCES =================
  const dom = {
    // Header & Global
    headerStatusDot: document.getElementById('headerStatusDot'),
    headerStatusText: document.getElementById('headerStatusText'),
    headerThemeToggleBtn: document.getElementById('headerThemeToggleBtn'),
    themeIconSun: document.getElementById('themeIconSun'),
    themeIconMoon: document.getElementById('themeIconMoon'),
    webSerialWarning: document.getElementById('webSerialWarning'),
    staleDataWarning: document.getElementById('staleDataWarning'),
    staleTimeCount: document.getElementById('staleTimeCount'),

    // Connection Hub
    connectBtn: document.getElementById('connectBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    connStatusBadge: document.getElementById('connStatusBadge'),
    deviceInfoText: document.getElementById('deviceInfoText'),
    streamPipelineText: document.getElementById('streamPipelineText'),
    lastUpdateText: document.getElementById('lastUpdateText'),
    connInstructionText: document.getElementById('connInstructionText'),

    // Motor Controls
    cmdFwdBtn: document.getElementById('cmdFwdBtn'),
    cmdRevBtn: document.getElementById('cmdRevBtn'),
    cmdStopBtn: document.getElementById('cmdStopBtn'),

    // Terminal
    toggleTerminalBtn: document.getElementById('toggleTerminalBtn'),
    terminalBtnLabel: document.getElementById('terminalBtnLabel'),
    serialTerminalDrawer: document.getElementById('serialTerminalDrawer'),
    terminalOutput: document.getElementById('terminalOutput'),
    clearTerminalBtn: document.getElementById('clearTerminalBtn'),
    autoscrollCheck: document.getElementById('autoscrollCheck'),

    // Motor Status Hero
    rotorBladesGroup: document.getElementById('rotorBladesGroup'),
    motorDirectionOverlay: document.getElementById('motorDirectionOverlay'),
    motorStatusPill: document.getElementById('motorStatusPill'),
    motorPillDot: document.getElementById('motorPillDot'),
    motorStateText: document.getElementById('motorStateText'),
    motorDirectionText: document.getElementById('motorDirectionText'),
    motorRpmHeroVal: document.getElementById('motorRpmHeroVal'),
    motorPulsesHeroVal: document.getElementById('motorPulsesHeroVal'),
    motorBuzzerState: document.getElementById('motorBuzzerState'),
    motorHealthSummary: document.getElementById('motorHealthSummary'),

    // Primary Sensor Cards
    voltageVal: document.getElementById('voltageVal'),
    voltageBadge: document.getElementById('voltageBadge'),
    voltageBarFill: document.getElementById('voltageBarFill'),
    vMinThreshold: document.getElementById('vMinThreshold'),
    vMaxThreshold: document.getElementById('vMaxThreshold'),
    shuntVoltageVal: document.getElementById('shuntVoltageVal'),

    currentVal: document.getElementById('currentVal'),
    currentBadge: document.getElementById('currentBadge'),
    currentBarFill: document.getElementById('currentBarFill'),
    currentAmpVal: document.getElementById('currentAmpVal'),
    cMaxThreshold: document.getElementById('cMaxThreshold'),

    powerVal: document.getElementById('powerVal'),
    powerBadge: document.getElementById('powerBadge'),
    powerBarFill: document.getElementById('powerBarFill'),
    powerWattVal: document.getElementById('powerWattVal'),

    vibrationScoreVal: document.getElementById('vibrationScoreVal'),
    vibrationRmsVal: document.getElementById('vibrationRmsVal'),
    vibrationBadge: document.getElementById('vibrationBadge'),
    vibrationBarFill: document.getElementById('vibrationBarFill'),
    vibThreshold: document.getElementById('vibThreshold'),

    motorTempVal: document.getElementById('motorTempVal'),
    motorTempBadge: document.getElementById('motorTempBadge'),
    motorTempBarFill: document.getElementById('motorTempBarFill'),
    tWarnThreshold: document.getElementById('tWarnThreshold'),
    tCritThreshold: document.getElementById('tCritThreshold'),

    ambientTempVal: document.getElementById('ambientTempVal'),
    ambientTempBadge: document.getElementById('ambientTempBadge'),
    ambientTempBarFill: document.getElementById('ambientTempBarFill'),
    deltaTempVal: document.getElementById('deltaTempVal'),

    humidityVal: document.getElementById('humidityVal'),
    humidityBadge: document.getElementById('humidityBadge'),
    humidityBarFill: document.getElementById('humidityBarFill'),
    humidityCondText: document.getElementById('humidityCondText'),

    // RPM & KY-024 Cards
    rpmCard: document.getElementById('rpmCard'),
    rpmVal: document.getElementById('rpmVal'),
    rpmBadge: document.getElementById('rpmBadge'),
    rpmBarFill: document.getElementById('rpmBarFill'),
    irPulsesVal: document.getElementById('irPulsesVal'),

    ky024Card: document.getElementById('ky024Card'),
    ky024Val: document.getElementById('ky024Val'),
    ky024Badge: document.getElementById('ky024Badge'),
    ky024BarFill: document.getElementById('ky024BarFill'),
    ky024StateText: document.getElementById('ky024StateText'),

    // Alert Matrix Checks
    alertVibStatus: document.getElementById('alertVibStatus'),
    alertVibDesc: document.getElementById('alertVibDesc'),
    alertCheckVib: document.getElementById('alertCheckVib'),

    alertVoltStatus: document.getElementById('alertVoltStatus'),
    alertVoltDesc: document.getElementById('alertVoltDesc'),
    alertCheckVolt: document.getElementById('alertCheckVolt'),

    alertCurrStatus: document.getElementById('alertCurrStatus'),
    alertCurrDesc: document.getElementById('alertCurrDesc'),
    alertCheckCurr: document.getElementById('alertCheckCurr'),

    alertTempStatus: document.getElementById('alertTempStatus'),
    alertTempDesc: document.getElementById('alertTempDesc'),
    alertCheckTemp: document.getElementById('alertCheckTemp'),

    audioAlarmToggle: document.getElementById('audioAlarmToggle'),

    // Charts & Empty States
    electricalChartCanvas: document.getElementById('electricalChart'),
    electricalChartEmpty: document.getElementById('electricalChartEmpty'),
    powerChartCanvas: document.getElementById('powerChart'),
    powerChartEmpty: document.getElementById('powerChartEmpty'),
    thermalChartCanvas: document.getElementById('thermalChart'),
    thermalChartEmpty: document.getElementById('thermalChartEmpty'),
    vibrationChartCanvas: document.getElementById('vibrationChart'),
    vibrationChartEmpty: document.getElementById('vibrationChartEmpty'),
    pauseChartsBtn: document.getElementById('pauseChartsBtn'),
    pauseChartsLabel: document.getElementById('pauseChartsLabel'),

    // Telemetry Table
    telemetryTableBody: document.getElementById('telemetryTableBody'),
    tableEmptyRow: document.getElementById('tableEmptyRow'),
    telemetryCountBadge: document.getElementById('telemetryCountBadge'),
    exportCsvBtn: document.getElementById('exportCsvBtn'),
    clearTableBtn: document.getElementById('clearTableBtn'),

    // Settings Modal
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    settingsForm: document.getElementById('settingsForm'),
    resetDefaultsBtn: document.getElementById('resetDefaultsBtn'),
    settingVoltMin: document.getElementById('settingVoltMin'),
    settingVoltMax: document.getElementById('settingVoltMax'),
    settingCurrMax: document.getElementById('settingCurrMax'),
    settingVibMax: document.getElementById('settingVibMax'),
    settingTempWarn: document.getElementById('settingTempWarn'),
    settingTempCrit: document.getElementById('settingTempCrit'),
    settingStaleTimeout: document.getElementById('settingStaleTimeout'),

    // Tabs & Firmware Viewer
    tabBtnThresholds: document.getElementById('tabBtnThresholds'),
    tabBtnFirmware: document.getElementById('tabBtnFirmware'),
    tabBtnTheme: document.getElementById('tabBtnTheme'),
    tabThresholds: document.getElementById('tabThresholds'),
    tabFirmware: document.getElementById('tabFirmware'),
    tabTheme: document.getElementById('tabTheme'),
    copyFirmwareBtn: document.getElementById('copyFirmwareBtn'),
    copyFirmwareLabel: document.getElementById('copyFirmwareLabel'),
    downloadFirmwareBtn: document.getElementById('downloadFirmwareBtn'),
    firmwareCodeText: document.getElementById('firmwareCodeText'),
    themeOptDark: document.getElementById('themeOptDark'),
    themeOptLight: document.getElementById('themeOptLight')
  };

  // ================= INITIALIZATION =================
  function init() {
    loadSettings();
    updateThresholdDisplays();
    checkWebSerialSupport();
    initCharts();
    initTheme();
    initModalTabs();
    initFirmwareViewer();
    setupEventListeners();
    startStaleWatchdog();
    appendTerminalLine('MOTRIVEXA IoT Core initialized. Ready to connect @ 115200 Baud.', 'system');
  }

  // ================= SETTINGS MANAGEMENT =================
  function loadSettings() {
    try {
      const stored = localStorage.getItem('motrivexa_settings');
      if (stored) {
        settings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn('Could not load settings from localStorage, using defaults.', e);
      settings = { ...DEFAULT_SETTINGS };
    }
    populateSettingsForm();
  }

  function saveSettings() {
    settings.voltMin = parseFloat(dom.settingVoltMin.value) || DEFAULT_SETTINGS.voltMin;
    settings.voltMax = parseFloat(dom.settingVoltMax.value) || DEFAULT_SETTINGS.voltMax;
    settings.currMax = parseFloat(dom.settingCurrMax.value) || DEFAULT_SETTINGS.currMax;
    settings.vibMax = parseInt(dom.settingVibMax.value, 10) || DEFAULT_SETTINGS.vibMax;
    settings.tempWarn = parseFloat(dom.settingTempWarn.value) || DEFAULT_SETTINGS.tempWarn;
    settings.tempCrit = parseFloat(dom.settingTempCrit.value) || DEFAULT_SETTINGS.tempCrit;
    settings.staleTimeout = parseFloat(dom.settingStaleTimeout.value) || DEFAULT_SETTINGS.staleTimeout;

    try {
      localStorage.setItem('motrivexa_settings', JSON.stringify(settings));
    } catch (e) {
      console.warn('Could not save settings to localStorage.', e);
    }

    updateThresholdDisplays();
    closeSettingsModal();
    appendTerminalLine('Updated system thresholds applied.', 'system');
  }

  function populateSettingsForm() {
    dom.settingVoltMin.value = settings.voltMin;
    dom.settingVoltMax.value = settings.voltMax;
    dom.settingCurrMax.value = settings.currMax;
    dom.settingVibMax.value = settings.vibMax;
    dom.settingTempWarn.value = settings.tempWarn;
    dom.settingTempCrit.value = settings.tempCrit;
    dom.settingStaleTimeout.value = settings.staleTimeout;
  }

  function updateThresholdDisplays() {
    if (dom.vMinThreshold) dom.vMinThreshold.textContent = settings.voltMin.toFixed(1);
    if (dom.vMaxThreshold) dom.vMaxThreshold.textContent = settings.voltMax.toFixed(1);
    if (dom.cMaxThreshold) dom.cMaxThreshold.textContent = settings.currMax.toFixed(1);
    if (dom.vibThreshold) dom.vibThreshold.textContent = settings.vibMax;
    if (dom.tWarnThreshold) dom.tWarnThreshold.textContent = settings.tempWarn.toFixed(0);
    if (dom.tCritThreshold) dom.tCritThreshold.textContent = settings.tempCrit.toFixed(0);
    if (dom.staleTimeCount) dom.staleTimeCount.textContent = settings.staleTimeout.toFixed(1);
  }

  function openSettingsModal() {
    populateSettingsForm();
    dom.settingsModal.classList.remove('hidden');
  }

  function closeSettingsModal() {
    dom.settingsModal.classList.add('hidden');
  }

  // ================= MODAL TABS =================
  function initModalTabs() {
    const tabs = [
      { btn: dom.tabBtnThresholds, pane: dom.tabThresholds },
      { btn: dom.tabBtnFirmware, pane: dom.tabFirmware },
      { btn: dom.tabBtnTheme, pane: dom.tabTheme }
    ];

    tabs.forEach(({ btn, pane }) => {
      if (!btn || !pane) return;
      btn.addEventListener('click', () => {
        tabs.forEach(t => {
          if (t.btn) {
            t.btn.classList.remove('active');
            t.btn.setAttribute('aria-selected', 'false');
          }
          if (t.pane) t.pane.classList.add('hidden');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        pane.classList.remove('hidden');
      });
    });
  }

  // ================= FIRMWARE CODE VIEWER & DOWNLOADER =================
  function initFirmwareViewer() {
    if (dom.firmwareCodeText) {
      dom.firmwareCodeText.textContent = FIRMWARE_CODE;
    }

    if (dom.copyFirmwareBtn) {
      dom.copyFirmwareBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(FIRMWARE_CODE);
          showCopySuccess();
        } catch (e) {
          const ta = document.createElement('textarea');
          ta.value = FIRMWARE_CODE;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showCopySuccess();
        }
      });
    }

    if (dom.downloadFirmwareBtn) {
      dom.downloadFirmwareBtn.addEventListener('click', () => {
        const blob = new Blob([FIRMWARE_CODE], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'motrivexa_esp32.ino';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        appendTerminalLine('Downloaded motrivexa_esp32.ino firmware.', 'system');
      });
    }
  }

  function showCopySuccess() {
    if (!dom.copyFirmwareLabel) return;
    const orig = dom.copyFirmwareLabel.textContent;
    dom.copyFirmwareLabel.textContent = '✓ Copied!';
    if (dom.copyFirmwareBtn) dom.copyFirmwareBtn.classList.add('btn-success');
    setTimeout(() => {
      dom.copyFirmwareLabel.textContent = orig;
      if (dom.copyFirmwareBtn) dom.copyFirmwareBtn.classList.remove('btn-success');
    }, 2000);
  }

  // ================= THEME MANAGEMENT =================
  function initTheme() {
    try {
      const storedTheme = localStorage.getItem('motrivexa_theme');
      if (storedTheme === 'light' || storedTheme === 'dark') {
        currentTheme = storedTheme;
      }
    } catch (e) {
      currentTheme = 'dark';
    }
    applyTheme(currentTheme);

    if (dom.headerThemeToggleBtn) {
      dom.headerThemeToggleBtn.addEventListener('click', () => {
        toggleTheme();
      });
    }

    if (dom.themeOptDark) {
      dom.themeOptDark.addEventListener('click', () => {
        setTheme('dark');
      });
    }

    if (dom.themeOptLight) {
      dom.themeOptLight.addEventListener('click', () => {
        setTheme('light');
      });
    }
  }

  function toggleTheme() {
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
  }

  function setTheme(theme) {
    currentTheme = theme;
    try {
      localStorage.setItem('motrivexa_theme', theme);
    } catch (e) {}
    applyTheme(theme);
    appendTerminalLine(`Switched theme to: ${theme.toUpperCase()}`, 'system');
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    if (dom.themeIconSun && dom.themeIconMoon) {
      if (theme === 'light') {
        dom.themeIconSun.classList.add('hidden');
        dom.themeIconMoon.classList.remove('hidden');
      } else {
        dom.themeIconSun.classList.remove('hidden');
        dom.themeIconMoon.classList.add('hidden');
      }
    }

    if (dom.themeOptDark && dom.themeOptLight) {
      dom.themeOptDark.classList.toggle('active', theme === 'dark');
      dom.themeOptLight.classList.toggle('active', theme === 'light');
    }

    updateChartTheme(theme);
  }

  function updateChartTheme(theme) {
    const textColor = theme === 'light' ? '#334155' : '#94a3b8';
    const gridColor = theme === 'light' ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.06)';

    [electricalChart, powerChart, thermalChart, vibrationChart].forEach(chart => {
      if (!chart) return;
      if (chart.options && chart.options.scales) {
        Object.values(chart.options.scales).forEach(scale => {
          if (scale.ticks) scale.ticks.color = textColor;
          if (scale.grid) scale.grid.color = gridColor;
        });
      }
      chart.update('none');
    });
  }

  // ================= WEB SERIAL API IMPLEMENTATION =================
  function checkWebSerialSupport() {
    if (!('serial' in navigator)) {
      dom.webSerialWarning.classList.remove('hidden');
      dom.connectBtn.disabled = true;
      dom.connStatusBadge.textContent = 'UNSUPPORTED';
      dom.streamPipelineText.textContent = 'Web Serial API unavailable';
      appendTerminalLine('ERROR: Web Serial API is not supported in this browser.', 'alert');
      return false;
    }
    return true;
  }

  async function connectDevice() {
    if (!checkWebSerialSupport()) return;

    try {
      updateConnectionUI('connecting');
      appendTerminalLine('Requesting USB port access...', 'system');

      // Native browser port picker dialog
      port = await navigator.serial.requestPort();

      // Open selected port at 115200 baud
      await port.open({ baudRate: 115200 });

      // Gather hardware device info if exposed
      const portInfo = port.getInfo();
      let deviceLabel = 'ESP32 Serial Device';
      if (portInfo && (portInfo.usbVendorId || portInfo.usbProductId)) {
        deviceLabel = `USB (VID: 0x${(portInfo.usbVendorId || 0).toString(16).padStart(4, '0')}, PID: 0x${(portInfo.usbProductId || 0).toString(16).padStart(4, '0')})`;
      }
      dom.deviceInfoText.textContent = deviceLabel;

      updateConnectionUI('connected');
      appendTerminalLine(`ESP32 Connected @ 115200 Baud. Starting stream pipeline.`, 'system');

      // Setup reader loop
      keepReading = true;
      readSerialStream();

      // Listen for hardware disconnects (e.g. cable pulled)
      navigator.serial.addEventListener('disconnect', handleDeviceUnplugged, { once: true });

    } catch (err) {
      console.error('Serial connection error:', err);
      updateConnectionUI('disconnected');

      if (err.name === 'NotFoundError') {
        appendTerminalLine('Port selection cancelled by user.', 'warn');
        dom.connInstructionText.textContent = 'Device selection cancelled. Click "Connect Device" when ready.';
      } else {
        appendTerminalLine(`Connection failure: ${err.message}`, 'alert');
        dom.connInstructionText.textContent = `Connection error: ${err.message}. Ensure port is not open in Arduino IDE Serial Monitor.`;
      }
    }
  }

  async function disconnectDevice() {
    if (!port) return;

    appendTerminalLine('Disconnecting ESP32 serial interface...', 'system');
    keepReading = false;

    try {
      if (reader) {
        await reader.cancel();
        reader.releaseLock();
        reader = null;
      }
      await port.close();
      port = null;
    } catch (err) {
      console.warn('Error during serial close:', err);
    } finally {
      updateConnectionUI('disconnected');
      appendTerminalLine('ESP32 Disconnected safely.', 'system');
    }
  }

  function handleDeviceUnplugged() {
    appendTerminalLine('HARDWARE EVENT: USB cable unplugged or device disconnected.', 'alert');
    disconnectDevice();
  }

  // ================= SERIAL STREAM READER =================
  async function readSerialStream() {
    while (port && port.readable && keepReading) {
      try {
        reader = port.readable.getReader();
        const decoder = new TextDecoder();
        while (keepReading) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            processIncomingChunk(chunk);
          }
        }
      } catch (err) {
        if (keepReading) {
          console.error('Error reading serial stream:', err);
          appendTerminalLine(`Stream read error: ${err.message}`, 'alert');
        }
      } finally {
        if (reader) {
          try {
            reader.releaseLock();
          } catch (e) {}
          reader = null;
        }
      }
    }
  }

  function processIncomingChunk(chunk) {
    serialBuffer += chunk;

    // Split completed lines by newline
    let newlineIndex;
    while ((newlineIndex = serialBuffer.indexOf('\n')) !== -1) {
      const line = serialBuffer.slice(0, newlineIndex).trim();
      serialBuffer = serialBuffer.slice(newlineIndex + 1);

      if (line.length > 0) {
        handleSerialLine(line);
      }
    }
  }

  // ================= PARSING ESP32 SERIAL OUTPUT =================
  function scheduleTelemetryCommit() {
    if (telemetryCommitTimer) clearTimeout(telemetryCommitTimer);
    telemetryCommitTimer = setTimeout(() => {
      commitTelemetry();
    }, 60);
  }

  function commitTelemetry() {
    if (telemetryCommitTimer) {
      clearTimeout(telemetryCommitTimer);
      telemetryCommitTimer = null;
    }

    // Determine alert conditions
    const isAlert = (
      (currentTelemetry.vibrationScore > settings.vibMax) ||
      (currentTelemetry.voltage < settings.voltMin || currentTelemetry.voltage > settings.voltMax) ||
      (currentTelemetry.current_mA > settings.currMax) ||
      (currentTelemetry.motorTemperature !== null && currentTelemetry.motorTemperature > settings.tempWarn)
    );
    currentTelemetry.buzzer = isAlert ? 'ALERT' : 'OFF';

    onTelemetryReceived({ ...currentTelemetry }, JSON.stringify(currentTelemetry));
  }

  function handleSerialLine(line) {
    if (!line) return;

    // 1. JSON Telemetry Fallback (if firmware ever emits JSON)
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const data = JSON.parse(line);
        if (data.type === 'telemetry' || data.voltage !== undefined || data.motor !== undefined) {
          if (data.voltage !== undefined) currentTelemetry.voltage = parseFloat(data.voltage) || 0;
          if (data.current !== undefined) {
            const c = parseFloat(data.current) || 0;
            currentTelemetry.current = c > 10 ? c / 1000.0 : c;
            currentTelemetry.current_mA = c > 10 ? c : c * 1000.0;
          }
          if (data.power !== undefined) {
            const p = parseFloat(data.power) || 0;
            currentTelemetry.power = p > 50 ? p / 1000.0 : p;
            currentTelemetry.power_mW = p > 50 ? p : p * 1000.0;
          }
          if (data.motorTemperature !== undefined) currentTelemetry.motorTemperature = data.motorTemperature;
          if (data.ambientTemperature !== undefined) currentTelemetry.ambientTemperature = data.ambientTemperature;
          if (data.humidity !== undefined) currentTelemetry.humidity = data.humidity;
          if (data.vibrationScore !== undefined) currentTelemetry.vibrationScore = parseInt(data.vibrationScore, 10) || 0;
          if (data.ky024Raw !== undefined) currentTelemetry.ky024Raw = parseInt(data.ky024Raw, 10) || 0;
          if (data.rpm !== undefined) currentTelemetry.rpm = parseInt(data.rpm, 10) || 0;
          if (data.irPulses !== undefined) currentTelemetry.irPulses = parseInt(data.irPulses, 10) || 0;
          if (data.motor !== undefined) {
            currentTelemetry.motor = (data.motor.toUpperCase().includes('ON') || data.motor.toUpperCase().includes('FWD')) ? 'ON' : 'OFF';
          }
          commitTelemetry();
          return;
        }
      } catch (e) {}
    }

    // 2. Direct Motor Status Commands
    const upperLine = line.toUpperCase().trim();
    if (upperLine === 'MOTOR ON') {
      currentTelemetry.motor = 'ON';
      commitTelemetry();
      appendTerminalLine(line, 'cmd');
      return;
    }
    if (upperLine === 'MOTOR OFF') {
      currentTelemetry.motor = 'OFF';
      currentTelemetry.rpm = 0;
      currentTelemetry.vibrationScore = 0;
      commitTelemetry();
      appendTerminalLine(line, 'cmd');
      return;
    }

    // 3. Human-Readable Key-Value Pairs from ESP32 Serial Output
    if (line.includes(':')) {
      const colonIdx = line.indexOf(':');
      const key = line.slice(0, colonIdx).trim().toUpperCase();
      const valStr = line.slice(colonIdx + 1).trim();
      const valNum = parseFloat(valStr);

      let matched = false;

      if (key.includes('VOLTAGE')) {
        if (!isNaN(valNum)) currentTelemetry.voltage = valNum;
        matched = true;
      }
      else if (key.includes('CURRENT')) {
        if (!isNaN(valNum)) {
          // ESP32 outputs in Amperes (e.g. 0.123 A)
          currentTelemetry.current = valNum;
          currentTelemetry.current_mA = valNum * 1000.0;
        }
        matched = true;
      }
      else if (key.includes('POWER')) {
        if (!isNaN(valNum)) {
          // ESP32 outputs in Watts (e.g. 1.48 W)
          currentTelemetry.power = valNum;
          currentTelemetry.power_mW = valNum * 1000.0;
        }
        matched = true;
      }
      else if (key.includes('MOTOR TEMPERATURE')) {
        if (!isNaN(valNum)) {
          currentTelemetry.motorTemperature = (valNum > -50 && valNum < 150) ? valNum : null;
        }
        matched = true;
      }
      else if (key.includes('AMBIENT TEMPERATURE')) {
        if (!isNaN(valNum)) {
          currentTelemetry.ambientTemperature = (valNum > -40 && valNum < 85) ? valNum : null;
        }
        matched = true;
      }
      else if (key.includes('HUMIDITY')) {
        if (!isNaN(valNum)) {
          currentTelemetry.humidity = (valNum >= 0 && valNum <= 100) ? valNum : null;
        }
        matched = true;
      }
      else if (key.includes('IR PULSES')) {
        const p = parseInt(valStr, 10);
        if (!isNaN(p)) currentTelemetry.irPulses = p;
        matched = true;
      }
      else if (key === 'RPM' || key.endsWith('RPM')) {
        const r = parseInt(valStr, 10);
        if (!isNaN(r)) currentTelemetry.rpm = r;
        matched = true;
      }
      else if (key.includes('KY024')) {
        const k = parseInt(valStr, 10);
        if (!isNaN(k)) currentTelemetry.ky024Raw = k;
        matched = true;
      }
      else if (key.includes('VIBRATION SCORE')) {
        const v = parseInt(valStr, 10);
        if (!isNaN(v)) currentTelemetry.vibrationScore = v;
        matched = true;
      }
      else if (key.includes('MOTOR STATUS')) {
        currentTelemetry.motor = valStr.toUpperCase().includes('ON') ? 'ON' : 'OFF';
        matched = true;
        // Last line of the ESP32 block: commit immediately!
        commitTelemetry();
        appendTerminalLine(line, 'telemetry');
        return;
      }

      if (matched) {
        scheduleTelemetryCommit();
        appendTerminalLine(line, 'telemetry');
        return;
      }
    }

    // 4. Header, Boot messages, or general log lines
    classifyAndLogSerialLine(line);
  }

  function classifyAndLogSerialLine(line) {
    let lineClass = 'system';
    if (line.includes('ALERT') || line.includes('CRITICAL')) {
      lineClass = 'alert';
    } else if (line.includes('WARNING') || line.includes('warn') || line.includes('NOT FOUND')) {
      lineClass = 'warn';
    } else if (line.includes('MOTOR') || line.includes('Command')) {
      lineClass = 'cmd';
    }
    appendTerminalLine(line, lineClass);
  }

  // ================= DIRECT MOTOR COMMAND TRANSMITTER =================
  async function sendMotorCommand(cmd) {
    if (!port || !port.writable) {
      alert('Cannot send command: ESP32 is not connected via USB.');
      return;
    }

    try {
      let wireCmd = cmd.trim().toUpperCase();
      if (wireCmd === 'F') wireCmd = 'ON';
      if (wireCmd === 'R') wireCmd = 'STATUS';
      if (wireCmd === 'S') wireCmd = 'OFF';

      const encoder = new TextEncoder();
      const writer = port.writable.getWriter();
      await writer.write(encoder.encode(wireCmd + '\n'));
      writer.releaseLock();

      appendTerminalLine(`Sent Motor Command: '${wireCmd}'`, 'cmd');

      // Optimistic UI state update for immediate user feedback
      if (wireCmd === 'ON') {
        currentTelemetry.motor = 'ON';
        commitTelemetry();
      } else if (wireCmd === 'OFF') {
        currentTelemetry.motor = 'OFF';
        currentTelemetry.rpm = 0;
        currentTelemetry.vibrationScore = 0;
        commitTelemetry();
      }
    } catch (err) {
      console.error('Error writing motor command:', err);
      appendTerminalLine(`Command send error: ${err.message}`, 'alert');
    }
  }

  // ================= TELEMETRY PROCESSING =================
  function onTelemetryReceived(data) {
    lastTelemetryTimestamp = Date.now();
    dom.staleDataWarning.classList.add('hidden');

    const timestamp = new Date();
    const timeFormatted = timestamp.toLocaleTimeString();
    dom.lastUpdateText.textContent = timeFormatted;

    // 1. Update Motor Hero Section
    updateMotorHero(data);

    // 2. Update Primary & Environmental Sensor Cards
    updateSensorCards(data);

    // 3. Update Alert Center & Protection Rule Matrix
    updateAlertMatrix(data);

    // 4. Update Charts
    if (!chartsPaused) {
      updateCharts(data, timeFormatted);
    }

    // 5. Update Recent Telemetry Table
    recordTelemetryHistory(data, timeFormatted);
  }

  // ================= UI UPDATE: MOTOR HERO =================
  function updateMotorHero(data) {
    const isMotorOn = (data.motor || 'OFF').toUpperCase() === 'ON';
    const buzzerState = (data.buzzer || 'OFF').toUpperCase();

    dom.motorStateText.textContent = isMotorOn ? 'MOTOR ON' : 'MOTOR OFF';
    dom.motorDirectionOverlay.textContent = isMotorOn ? 'RUNNING' : 'STOPPED';
    dom.motorDirectionText.textContent = isMotorOn ? 'ACTIVE (RUNNING)' : 'STOPPED (IDLE)';

    // Reset rotor animation classes
    dom.rotorBladesGroup.classList.remove('rotor-spinning-forward', 'rotor-spinning-reverse');
    dom.motorStatusPill.classList.remove('running-fwd', 'running-rev', 'alert-fault');

    if (isMotorOn) {
      dom.rotorBladesGroup.classList.add('rotor-spinning-forward');
      dom.motorStatusPill.classList.add('running-fwd');
    }

    // Hardware buzzer alert highlight
    if (buzzerState === 'ALERT') {
      dom.motorStatusPill.classList.add('alert-fault');
      dom.motorHealthSummary.textContent = 'ALERT TRIGGERED';
      dom.motorHealthSummary.className = 'submetric-val critical';
    } else {
      dom.motorHealthSummary.textContent = 'SYSTEM HEALTHY';
      dom.motorHealthSummary.className = 'submetric-val healthy';
    }
  }

  // ================= UI UPDATE: SENSOR CARDS =================
  function updateSensorCards(data) {
    // 1. Bus Voltage (INA219)
    const voltage = typeof data.voltage === 'number' ? data.voltage : 0.0;
    dom.voltageVal.textContent = voltage.toFixed(2);
    if (dom.shuntVoltageVal) {
      dom.shuntVoltageVal.textContent = `${(data.current * 0.1).toFixed(2)} mV`;
    }

    const vPct = Math.min(Math.max((voltage / 16.0) * 100, 0), 100);
    dom.voltageBarFill.style.width = `${vPct}%`;

    if (voltage < settings.voltMin) {
      setCardBadge(dom.voltageBadge, 'LOW VOLTAGE', 'warning');
    } else if (voltage > settings.voltMax) {
      setCardBadge(dom.voltageBadge, 'OVERVOLTAGE', 'critical');
    } else {
      setCardBadge(dom.voltageBadge, 'NORMAL', 'normal');
    }

    // 2. Load Current (INA219)
    const currentA = typeof data.current === 'number' ? data.current : 0.0;
    const currentMA = typeof data.current_mA === 'number' ? data.current_mA : currentA * 1000.0;
    dom.currentVal.textContent = currentMA.toFixed(1);
    dom.currentAmpVal.textContent = `${currentA.toFixed(3)} A`;

    const cPct = Math.min(Math.max((currentMA / 1000.0) * 100, 0), 100);
    dom.currentBarFill.style.width = `${cPct}%`;

    if (currentMA > settings.currMax) {
      setCardBadge(dom.currentBadge, 'OVERCURRENT', 'critical');
    } else {
      setCardBadge(dom.currentBadge, 'NORMAL', 'normal');
    }

    // 3. Power Consumption (INA219)
    const powerW = typeof data.power === 'number' ? data.power : 0.0;
    const powerMW = typeof data.power_mW === 'number' ? data.power_mW : powerW * 1000.0;
    dom.powerVal.textContent = powerMW.toFixed(1);
    dom.powerWattVal.textContent = `${powerW.toFixed(2)} W`;

    const pPct = Math.min(Math.max((powerMW / 12000.0) * 100, 0), 100);
    dom.powerBarFill.style.width = `${pPct}%`;
    setCardBadge(dom.powerBadge, 'NORMAL', 'normal');

    // 4. Vibration Score
    const vibScore = typeof data.vibrationScore === 'number' ? data.vibrationScore : 0;
    dom.vibrationScoreVal.textContent = vibScore;
    dom.vibrationRmsVal.textContent = `${vibScore} mg`;

    const vibPct = Math.min(Math.max((vibScore / 250.0) * 100, 0), 100);
    dom.vibrationBarFill.style.width = `${vibPct}%`;

    if (vibScore > settings.vibMax) {
      setCardBadge(dom.vibrationBadge, 'HIGH VIBRATION', 'critical');
    } else {
      setCardBadge(dom.vibrationBadge, 'NORMAL', 'normal');
    }

    // 5. Motor Temperature (DS18B20)
    let motorTempValid = false;
    let motorTempVal = 0;
    if (data.motorTemperature !== null && data.motorTemperature !== undefined && !isNaN(data.motorTemperature)) {
      motorTempVal = parseFloat(data.motorTemperature);
      motorTempValid = true;
      dom.motorTempVal.textContent = motorTempVal.toFixed(2);
      dom.motorTempVal.classList.remove('unavailable-text');

      const tPct = Math.min(Math.max((motorTempVal / 100.0) * 100, 0), 100);
      dom.motorTempBarFill.style.width = `${tPct}%`;

      if (motorTempVal >= settings.tempCrit) {
        setCardBadge(dom.motorTempBadge, 'CRITICAL TEMP', 'critical');
      } else if (motorTempVal > settings.tempWarn) {
        setCardBadge(dom.motorTempBadge, 'ELEVATED TEMP', 'warning');
      } else {
        setCardBadge(dom.motorTempBadge, 'NORMAL', 'normal');
      }
    } else {
      dom.motorTempVal.textContent = 'Sensor Unavailable';
      dom.motorTempVal.classList.add('unavailable-text');
      dom.motorTempBarFill.style.width = '0%';
      setCardBadge(dom.motorTempBadge, 'UNAVAILABLE', 'unavailable');
    }

    // 6. Ambient Temperature (DHT11)
    let ambTempValid = false;
    let ambTempVal = 0;
    if (data.ambientTemperature !== null && data.ambientTemperature !== undefined && !isNaN(data.ambientTemperature)) {
      ambTempVal = parseFloat(data.ambientTemperature);
      ambTempValid = true;
      dom.ambientTempVal.textContent = ambTempVal.toFixed(1);
      dom.ambientTempVal.classList.remove('unavailable-text');

      const aPct = Math.min(Math.max((ambTempVal / 50.0) * 100, 0), 100);
      dom.ambientTempBarFill.style.width = `${aPct}%`;
      setCardBadge(dom.ambientTempBadge, 'NORMAL', 'normal');
    } else {
      dom.ambientTempVal.textContent = 'Sensor Unavailable';
      dom.ambientTempVal.classList.add('unavailable-text');
      dom.ambientTempBarFill.style.width = '0%';
      setCardBadge(dom.ambientTempBadge, 'UNAVAILABLE', 'unavailable');
    }

    // Delta T calculation
    if (motorTempValid && ambTempValid) {
      const deltaT = motorTempVal - ambTempVal;
      dom.deltaTempVal.textContent = `${deltaT >= 0 ? '+' : ''}${deltaT.toFixed(1)} °C`;
    } else {
      dom.deltaTempVal.textContent = '--.- °C';
    }

    // 7. Ambient Humidity (DHT11)
    if (data.humidity !== null && data.humidity !== undefined && !isNaN(data.humidity)) {
      const humidity = parseFloat(data.humidity);
      dom.humidityVal.textContent = humidity.toFixed(1);
      dom.humidityVal.classList.remove('unavailable-text');

      const hPct = Math.min(Math.max((humidity / 100.0) * 100, 0), 100);
      dom.humidityBarFill.style.width = `${hPct}%`;

      if (humidity > 75.0) {
        dom.humidityCondText.textContent = 'High Condensation Risk';
        setCardBadge(dom.humidityBadge, 'HIGH HUMIDITY', 'warning');
      } else if (humidity < 25.0) {
        dom.humidityCondText.textContent = 'Dry Environment';
        setCardBadge(dom.humidityBadge, 'DRY', 'normal');
      } else {
        dom.humidityCondText.textContent = 'Nominal / Optimal';
        setCardBadge(dom.humidityBadge, 'NORMAL', 'normal');
      }
    } else {
      dom.humidityVal.textContent = 'Sensor Unavailable';
      dom.humidityVal.classList.add('unavailable-text');
      dom.humidityBarFill.style.width = '0%';
      dom.humidityCondText.textContent = 'Unavailable';
      setCardBadge(dom.humidityBadge, 'UNAVAILABLE', 'unavailable');
    }

    // 8. Rotational Speed (RPM from IR Sensor)
    const rpmVal = typeof data.rpm === 'number' ? Math.round(data.rpm) : 0;
    const irPulses = typeof data.irPulses === 'number' ? data.irPulses : 0;
    if (dom.rpmVal) dom.rpmVal.textContent = rpmVal;
    if (dom.motorRpmHeroVal) dom.motorRpmHeroVal.textContent = `${rpmVal} RPM`;
    if (dom.irPulsesVal) dom.irPulsesVal.textContent = irPulses;
    if (dom.motorPulsesHeroVal) dom.motorPulsesHeroVal.textContent = `${irPulses} Pulses`;

    if (dom.rpmBarFill) {
      const rPct = Math.min(Math.max((rpmVal / 5000.0) * 100, 0), 100);
      dom.rpmBarFill.style.width = `${rPct}%`;
    }
    if (dom.rpmBadge) {
      if (rpmVal > 0) {
        setCardBadge(dom.rpmBadge, 'ROTATING', 'normal');
      } else {
        setCardBadge(dom.rpmBadge, 'STOPPED', 'offline');
      }
    }

    // 9. KY-024 Magnetic Sensor AO (GPIO 34)
    const ky024Raw = typeof data.ky024Raw === 'number' ? data.ky024Raw : 0;
    if (dom.ky024Val) dom.ky024Val.textContent = ky024Raw;
    if (dom.ky024BarFill) {
      const magPct = Math.min(Math.max((ky024Raw / 4095.0) * 100, 0), 100);
      dom.ky024BarFill.style.width = `${magPct}%`;
    }
    if (dom.ky024Badge) {
      const isKyActive = data.motor === 'ON' || ky024Raw > 0;
      setCardBadge(dom.ky024Badge, isKyActive ? 'ACTIVE' : 'IDLE', isKyActive ? 'normal' : 'offline');
    }
    if (dom.ky024StateText) {
      dom.ky024StateText.textContent = ky024Raw > 2500 ? 'High Magnetic Flux' : ky024Raw > 200 ? 'Active Flux Detected' : 'Nominal Flux';
    }
  }

  function setCardBadge(element, text, level) {
    if (!element) return;
    element.textContent = text;
    element.className = `state-badge ${level}`;
  }

  // ================= UI UPDATE: ALERT MATRIX =================
  function updateAlertMatrix(data) {
    let hasCriticalAlarm = false;

    // 1. Vibration
    const vibScore = data.vibrationScore || 0;
    if (vibScore > settings.vibMax) {
      setAlertCheck(dom.alertCheckVib, dom.alertVibStatus, dom.alertVibDesc, 'CRITICAL', `Vibration score (${vibScore}) exceeded safety threshold (${settings.vibMax}).`, 'critical');
      hasCriticalAlarm = true;
    } else {
      setAlertCheck(dom.alertCheckVib, dom.alertVibStatus, dom.alertVibDesc, 'NORMAL', `Vibration score within acceptable operational tolerances (≤ ${settings.vibMax}).`, 'normal');
    }

    // 2. Voltage
    const voltage = typeof data.voltage === 'number' ? data.voltage : 0.0;
    if (voltage < settings.voltMin) {
      setAlertCheck(dom.alertCheckVolt, dom.alertVoltStatus, dom.alertVoltDesc, 'UNDERVOLTAGE', `Bus voltage (${voltage.toFixed(2)}V) is below low boundary (${settings.voltMin.toFixed(1)}V).`, 'warning');
    } else if (voltage > settings.voltMax) {
      setAlertCheck(dom.alertCheckVolt, dom.alertVoltStatus, dom.alertVoltDesc, 'OVERVOLTAGE', `Bus voltage (${voltage.toFixed(2)}V) exceeded high boundary (${settings.voltMax.toFixed(1)}V).`, 'critical');
      hasCriticalAlarm = true;
    } else {
      setAlertCheck(dom.alertCheckVolt, dom.alertVoltStatus, dom.alertVoltDesc, 'NORMAL', `Bus supply voltage within rated operating window (${settings.voltMin.toFixed(1)}V - ${settings.voltMax.toFixed(1)}V).`, 'normal');
    }

    // 3. Current
    const currentMA = typeof data.current_mA === 'number' ? data.current_mA : (data.current || 0) * 1000.0;
    if (currentMA > settings.currMax) {
      setAlertCheck(dom.alertCheckCurr, dom.alertCurrStatus, dom.alertCurrDesc, 'OVERCURRENT', `Load current (${currentMA.toFixed(1)} mA) exceeded safety limit (${settings.currMax.toFixed(1)} mA).`, 'critical');
      hasCriticalAlarm = true;
    } else {
      setAlertCheck(dom.alertCheckCurr, dom.alertCurrStatus, dom.alertCurrDesc, 'NORMAL', `Load current below continuous limit (≤ ${settings.currMax.toFixed(1)} mA).`, 'normal');
    }

    // 4. Temperature
    const motorTemp = data.motorTemperature;
    if (motorTemp !== null && motorTemp !== undefined && !isNaN(motorTemp)) {
      const t = parseFloat(motorTemp);
      if (t >= settings.tempCrit) {
        setAlertCheck(dom.alertCheckTemp, dom.alertTempStatus, dom.alertTempDesc, 'CRITICAL OVERHEAT', `Motor temperature (${t.toFixed(1)}°C) reached critical boundary (≥ ${settings.tempCrit.toFixed(0)}°C). Immediate shutdown advised.`, 'critical');
        hasCriticalAlarm = true;
      } else if (t > settings.tempWarn) {
        setAlertCheck(dom.alertCheckTemp, dom.alertTempStatus, dom.alertTempDesc, 'ELEVATED TEMP', `Motor temperature (${t.toFixed(1)}°C) exceeded warning threshold (> ${settings.tempWarn.toFixed(0)}°C).`, 'warning');
      } else {
        setAlertCheck(dom.alertCheckTemp, dom.alertTempStatus, dom.alertTempDesc, 'NORMAL', `DS18B20 motor contact temperature below warning threshold (≤ ${settings.tempWarn.toFixed(0)}°C).`, 'normal');
      }
    } else {
      setAlertCheck(dom.alertCheckTemp, dom.alertTempStatus, dom.alertTempDesc, 'UNAVAILABLE', 'DS18B20 sensor reading unavailable or disconnected.', 'warning');
    }

    // Sound audio alarm if enabled and critical
    if (hasCriticalAlarm && isAudioAlarmEnabled) {
      triggerAudioAlarmBeep();
    }
  }

  function setAlertCheck(cardEl, statusEl, descEl, statusText, descText, level) {
    if (!cardEl || !statusEl || !descEl) return;
    cardEl.classList.remove('is-warning', 'is-critical');
    if (level === 'warning') cardEl.classList.add('is-warning');
    if (level === 'critical') cardEl.classList.add('is-critical');

    statusEl.textContent = statusText;
    statusEl.className = `check-status ${level}`;
    descEl.textContent = descText;
  }

  // ================= WEB AUDIO SYNTHESIZER FOR ALARM =================
  function triggerAudioAlarmBeep() {
    const now = Date.now();
    if (now - lastBeepTime < 1500) return;
    lastBeepTime = now;

    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }

      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.25);

      gain.gain.setValueAtTime(0.2, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(audioContext.destination);

      osc.start();
      osc.stop(audioContext.currentTime + 0.25);
    } catch (e) {
      console.warn('Audio alarm could not play:', e);
    }
  }

  // ================= REAL-TIME CHART.JS SETUP =================
  function initCharts() {
    Chart.defaults.color = currentTheme === 'light' ? '#334155' : '#94a3b8';
    Chart.defaults.borderColor = currentTheme === 'light' ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.06)';
    Chart.defaults.font.family = "'JetBrains Mono', 'Inter', monospace";
    Chart.defaults.font.size = 11;

    // 1. Electrical Chart (Voltage & Current)
    const ctxElec = dom.electricalChartCanvas.getContext('2d');
    electricalChart = new Chart(ctxElec, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Voltage (V)',
            data: [],
            borderColor: '#00e5ff',
            backgroundColor: 'rgba(0, 229, 255, 0.1)',
            borderWidth: 2,
            tension: 0.25,
            pointRadius: 0,
            yAxisID: 'yVoltage'
          },
          {
            label: 'Current (mA)',
            data: [],
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
            borderWidth: 2,
            tension: 0.25,
            pointRadius: 0,
            yAxisID: 'yCurrent'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          yVoltage: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Voltage (V)', color: '#00e5ff' },
            min: 0,
            suggestedMax: 15
          },
          yCurrent: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Current (mA)', color: '#f59e0b' },
            min: 0,
            suggestedMax: 1000,
            grid: { drawOnChartArea: false }
          }
        }
      }
    });

    // 2. Power Dissipation Chart
    const ctxPower = dom.powerChartCanvas.getContext('2d');
    powerChart = new Chart(ctxPower, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Power (W)',
            data: [],
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.15)',
            borderWidth: 2,
            fill: true,
            tension: 0.25,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: {
            title: { display: true, text: 'Watts (W)' },
            min: 0,
            suggestedMax: 10
          }
        }
      }
    });

    // 3. Thermal Profile Chart (Motor vs Ambient)
    const ctxTherm = dom.thermalChartCanvas.getContext('2d');
    thermalChart = new Chart(ctxTherm, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Motor DS18B20 (°C)',
            data: [],
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            borderWidth: 2,
            tension: 0.25,
            pointRadius: 0
          },
          {
            label: 'Ambient DHT11 (°C)',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            borderWidth: 2,
            tension: 0.25,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: {
            title: { display: true, text: 'Temperature (°C)' },
            min: 0,
            suggestedMax: 80
          }
        }
      }
    });

    // 4. Vibration & Humidity Chart
    const ctxVib = dom.vibrationChartCanvas.getContext('2d');
    vibrationChart = new Chart(ctxVib, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Vibration Score (mg)',
            data: [],
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderWidth: 2,
            tension: 0.25,
            pointRadius: 0,
            yAxisID: 'yVib'
          },
          {
            label: 'Relative Humidity (%)',
            data: [],
            borderColor: '#14b8a6',
            backgroundColor: 'rgba(20, 184, 166, 0.08)',
            borderWidth: 2,
            tension: 0.25,
            pointRadius: 0,
            yAxisID: 'yHum'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          yVib: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Vib Score (mg)', color: '#3b82f6' },
            min: 0,
            suggestedMax: 150
          },
          yHum: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Humidity (%)', color: '#14b8a6' },
            min: 0,
            max: 100,
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  function updateCharts(data, timeLabel) {
    if (dom.electricalChartEmpty) dom.electricalChartEmpty.style.display = 'none';
    if (dom.powerChartEmpty) dom.powerChartEmpty.style.display = 'none';
    if (dom.thermalChartEmpty) dom.thermalChartEmpty.style.display = 'none';
    if (dom.vibrationChartEmpty) dom.vibrationChartEmpty.style.display = 'none';

    // 1. Electrical
    const currentMA = typeof data.current_mA === 'number' ? data.current_mA : (data.current || 0) * 1000.0;
    appendChartPoint(electricalChart, timeLabel, [
      typeof data.voltage === 'number' ? data.voltage : null,
      currentMA
    ]);

    // 2. Power in Watts
    appendChartPoint(powerChart, timeLabel, [
      typeof data.power === 'number' ? data.power : null
    ]);

    // 3. Thermal
    appendChartPoint(thermalChart, timeLabel, [
      data.motorTemperature !== null && !isNaN(data.motorTemperature) ? data.motorTemperature : null,
      data.ambientTemperature !== null && !isNaN(data.ambientTemperature) ? data.ambientTemperature : null
    ]);

    // 4. Vibration & Humidity
    appendChartPoint(vibrationChart, timeLabel, [
      typeof data.vibrationScore === 'number' ? data.vibrationScore : null,
      data.humidity !== null && !isNaN(data.humidity) ? data.humidity : null
    ]);
  }

  function appendChartPoint(chart, label, dataValues) {
    if (!chart) return;

    chart.data.labels.push(label);
    if (chart.data.labels.length > MAX_CHART_POINTS) {
      chart.data.labels.shift();
    }

    dataValues.forEach((val, index) => {
      if (chart.data.datasets[index]) {
        chart.data.datasets[index].data.push(val);
        if (chart.data.datasets[index].data.length > MAX_CHART_POINTS) {
          chart.data.datasets[index].data.shift();
        }
      }
    });

    chart.update('none');
  }

  function toggleChartsPause() {
    chartsPaused = !chartsPaused;
    dom.pauseChartsLabel.textContent = chartsPaused ? 'Resume Charts' : 'Pause Charts';
    dom.pauseChartsBtn.classList.toggle('active', chartsPaused);
  }

  // ================= TELEMETRY TABLE & CSV EXPORT =================
  function recordTelemetryHistory(data, timeFormatted) {
    const currentA = typeof data.current === 'number' ? data.current : 0.0;
    const currentMA = typeof data.current_mA === 'number' ? data.current_mA : currentA * 1000.0;
    const powerW = typeof data.power === 'number' ? data.power : 0.0;

    const record = {
      index: telemetryHistory.length + 1,
      time: timeFormatted,
      motor: data.motor || 'OFF',
      rpm: typeof data.rpm === 'number' ? Math.round(data.rpm) : 0,
      voltage: typeof data.voltage === 'number' ? data.voltage.toFixed(2) : '--',
      current: currentMA.toFixed(1),
      power: powerW.toFixed(2),
      motorTemp: data.motorTemperature !== null && !isNaN(data.motorTemperature) ? parseFloat(data.motorTemperature).toFixed(1) : 'null',
      ambTemp: data.ambientTemperature !== null && !isNaN(data.ambientTemperature) ? parseFloat(data.ambientTemperature).toFixed(1) : 'null',
      humidity: data.humidity !== null && !isNaN(data.humidity) ? parseFloat(data.humidity).toFixed(1) : 'null',
      vibScore: typeof data.vibrationScore === 'number' ? data.vibrationScore : 0,
      ky024Raw: typeof data.ky024Raw === 'number' ? data.ky024Raw : 0,
      buzzer: data.buzzer || 'OFF'
    };

    telemetryHistory.unshift(record);
    if (telemetryHistory.length > MAX_HISTORY_ROWS) {
      telemetryHistory.pop();
    }

    dom.telemetryCountBadge.textContent = `${telemetryHistory.length} Records`;

    if (dom.tableEmptyRow) {
      dom.tableEmptyRow.remove();
      dom.tableEmptyRow = null;
    }

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${record.index}</td>
      <td>${record.time}</td>
      <td><span class="status-badge ${record.motor === 'ON' ? 'connected' : ''}">${record.motor}</span></td>
      <td><strong>${record.rpm}</strong></td>
      <td>${record.voltage}</td>
      <td>${record.current}</td>
      <td>${record.power}</td>
      <td>${record.motorTemp !== 'null' ? record.motorTemp : '<span class="text-muted">--</span>'}</td>
      <td>${record.ambTemp !== 'null' ? record.ambTemp : '<span class="text-muted">--</span>'}</td>
      <td>${record.humidity !== 'null' ? record.humidity : '<span class="text-muted">--</span>'}</td>
      <td>${record.vibScore}</td>
      <td>${record.ky024Raw}</td>
      <td><span class="status-badge ${record.buzzer === 'ALERT' ? 'critical' : ''}">${record.buzzer}</span></td>
    `;

    dom.telemetryTableBody.prepend(row);

    while (dom.telemetryTableBody.children.length > MAX_HISTORY_ROWS) {
      dom.telemetryTableBody.removeChild(dom.telemetryTableBody.lastChild);
    }
  }

  function clearTelemetryTable() {
    telemetryHistory = [];
    dom.telemetryTableBody.innerHTML = `
      <tr class="empty-row" id="tableEmptyRow">
        <td colspan="13">Session data cleared. Waiting for new telemetry records...</td>
      </tr>
    `;
    dom.tableEmptyRow = document.getElementById('tableEmptyRow');
    dom.telemetryCountBadge.textContent = '0 Records';
    appendTerminalLine('Session telemetry log cleared by user.', 'system');
  }

  function exportTelemetryCSV() {
    if (telemetryHistory.length === 0) {
      alert('No telemetry data collected in current session to export.');
      return;
    }

    const headers = [
      'RecordIndex', 'Timestamp', 'MotorState', 'RPM', 'Voltage_V', 'Current_mA',
      'Power_W', 'MotorTemp_C', 'AmbientTemp_C', 'Humidity_pct',
      'VibrationScore_mg', 'KY024_ADC', 'BuzzerState'
    ];

    let csvContent = headers.join(',') + '\r\n';

    const chronological = [...telemetryHistory].reverse();

    chronological.forEach(r => {
      const row = [
        r.index,
        `"${r.time}"`,
        `"${r.motor}"`,
        r.rpm,
        r.voltage,
        r.current,
        r.power,
        r.motorTemp,
        r.ambTemp,
        r.humidity,
        r.vibScore,
        r.ky024Raw,
        `"${r.buzzer}"`
      ];
      csvContent += row.join(',') + '\r\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
    link.setAttribute('href', url);
    link.setAttribute('download', `motrivexa_telemetry_${dateStr}_${timeStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    appendTerminalLine(`Exported ${telemetryHistory.length} telemetry records to CSV.`, 'system');
  }

  // ================= UI CONNECTION STATE =================
  function updateConnectionUI(state) {
    if (state === 'connected') {
      dom.headerStatusDot.className = 'status-dot connected';
      dom.headerStatusText.textContent = 'ESP32 Connected';
      dom.connStatusBadge.textContent = 'CONNECTED';
      dom.connStatusBadge.className = 'meta-value status-badge connected';
      dom.streamPipelineText.textContent = 'Active @ 115200 8N1';

      dom.connectBtn.disabled = true;
      dom.disconnectBtn.disabled = false;
      dom.cmdFwdBtn.disabled = false;
      dom.cmdRevBtn.disabled = false;
      dom.cmdStopBtn.disabled = false;

      dom.connInstructionText.textContent = 'ESP32 connected via USB. Live sensor telemetry streaming continuously.';
    } else if (state === 'connecting') {
      dom.headerStatusDot.className = 'status-dot connecting';
      dom.headerStatusText.textContent = 'Connecting...';
      dom.connStatusBadge.textContent = 'CONNECTING';
      dom.connStatusBadge.className = 'meta-value status-badge connecting';
      dom.streamPipelineText.textContent = 'Opening COM Port...';
      dom.connectBtn.disabled = true;
    } else {
      dom.headerStatusDot.className = 'status-dot disconnected';
      dom.headerStatusText.textContent = 'Disconnected';
      dom.connStatusBadge.textContent = 'DISCONNECTED';
      dom.connStatusBadge.className = 'meta-value status-badge';
      dom.deviceInfoText.textContent = 'No Device Selected';
      dom.streamPipelineText.textContent = 'Idle / Port Closed';

      dom.connectBtn.disabled = false;
      dom.disconnectBtn.disabled = true;
      dom.cmdFwdBtn.disabled = true;
      dom.cmdRevBtn.disabled = true;
      dom.cmdStopBtn.disabled = true;

      dom.staleDataWarning.classList.add('hidden');
      dom.connInstructionText.textContent = 'Connect your ESP32 through USB to begin live motor monitoring.';

      // Stop rotor spin
      dom.rotorBladesGroup.classList.remove('rotor-spinning-forward', 'rotor-spinning-reverse');
      dom.motorDirectionOverlay.textContent = 'OFFLINE';
      dom.motorStateText.textContent = 'OFFLINE';
      dom.motorStatusPill.className = 'motor-status-pill';
    }
  }

  // ================= STALE TELEMETRY WATCHDOG =================
  function startStaleWatchdog() {
    if (staleCheckInterval) clearInterval(staleCheckInterval);

    staleCheckInterval = setInterval(() => {
      if (port && keepReading && lastTelemetryTimestamp > 0) {
        const elapsedSec = (Date.now() - lastTelemetryTimestamp) / 1000.0;
        if (elapsedSec > settings.staleTimeout) {
          dom.staleDataWarning.classList.remove('hidden');
          dom.staleTimeCount.textContent = elapsedSec.toFixed(1);
        } else {
          dom.staleDataWarning.classList.add('hidden');
        }
      } else {
        dom.staleDataWarning.classList.add('hidden');
      }
    }, 1000);
  }

  // ================= TERMINAL MANAGEMENT =================
  function appendTerminalLine(text, type = 'system') {
    if (!dom.terminalOutput) return;

    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;

    const timestamp = new Date().toLocaleTimeString();
    line.textContent = `[${timestamp}] ${text}`;

    dom.terminalOutput.appendChild(line);

    while (dom.terminalOutput.children.length > 100) {
      dom.terminalOutput.removeChild(dom.terminalOutput.firstChild);
    }

    if (dom.autoscrollCheck && dom.autoscrollCheck.checked) {
      dom.terminalOutput.scrollTop = dom.terminalOutput.scrollHeight;
    }
  }

  function clearTerminal() {
    if (dom.terminalOutput) {
      dom.terminalOutput.innerHTML = '';
      appendTerminalLine('Terminal cleared.', 'system');
    }
  }

  function toggleTerminalDrawer() {
    const isHidden = dom.serialTerminalDrawer.classList.toggle('hidden');
    dom.terminalBtnLabel.textContent = isHidden ? 'Show Serial Console' : 'Hide Serial Console';
  }

  // ================= EVENT LISTENERS =================
  function setupEventListeners() {
    // Serial Connection Buttons
    dom.connectBtn.addEventListener('click', connectDevice);
    dom.disconnectBtn.addEventListener('click', disconnectDevice);

    // Motor Command Buttons
    dom.cmdFwdBtn.addEventListener('click', () => sendMotorCommand('ON'));
    dom.cmdStopBtn.addEventListener('click', () => sendMotorCommand('OFF'));
    dom.cmdRevBtn.addEventListener('click', () => sendMotorCommand('STATUS'));

    // Terminal Controls
    dom.toggleTerminalBtn.addEventListener('click', toggleTerminalDrawer);
    dom.clearTerminalBtn.addEventListener('click', clearTerminal);

    // Chart Controls
    dom.pauseChartsBtn.addEventListener('click', toggleChartsPause);

    // Table Controls
    dom.exportCsvBtn.addEventListener('click', exportTelemetryCSV);
    dom.clearTableBtn.addEventListener('click', clearTelemetryTable);

    // Settings Modal
    dom.openSettingsBtn.addEventListener('click', openSettingsModal);
    dom.closeSettingsBtn.addEventListener('click', closeSettingsModal);
    dom.cancelSettingsBtn.addEventListener('click', closeSettingsModal);
    dom.settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveSettings();
    });
    dom.resetDefaultsBtn.addEventListener('click', () => {
      settings = { ...DEFAULT_SETTINGS };
      populateSettingsForm();
      updateThresholdDisplays();
      appendTerminalLine('Reset settings to default thresholds.', 'system');
    });

    // Close modal on backdrop click
    dom.settingsModal.addEventListener('click', (e) => {
      if (e.target === dom.settingsModal) closeSettingsModal();
    });

    // Keyboard ESC to close modal
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !dom.settingsModal.classList.contains('hidden')) {
        closeSettingsModal();
      }
    });

    // Audio alarm toggle
    dom.audioAlarmToggle.addEventListener('change', (e) => {
      isAudioAlarmEnabled = e.target.checked;
      if (isAudioAlarmEnabled && !audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      appendTerminalLine(`Browser audio alarm: ${isAudioAlarmEnabled ? 'ENABLED' : 'DISABLED'}`, 'system');
    });
  }

  // ================= BOOTSTRAP =================
  window.addEventListener('DOMContentLoaded', init);
})();

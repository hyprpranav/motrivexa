/**
 * ============================================================================
 * MOTRIVEXA - INDUSTRIAL IOT DASHBOARD CONTROLLER
 * Smart Predictive Health Monitoring and Protection System for Electric Motors
 * Web Serial API + Chart.js + Telemetry Analytics Pipeline
 * ============================================================================
 */

(() => {
  'use strict';

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
    motorPwmText: document.getElementById('motorPwmText'),
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

    ky024Val: document.getElementById('ky024Val'),
    ky024Badge: document.getElementById('ky024Badge'),
    ky024BarFill: document.getElementById('ky024BarFill'),

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
    settingStaleTimeout: document.getElementById('settingStaleTimeout')
  };

  // ================= INITIALIZATION =================
  function init() {
    loadSettings();
    updateThresholdDisplays();
    checkWebSerialSupport();
    initCharts();
    setupEventListeners();
    startStaleWatchdog();
    appendTerminalLine('MOTRIVEXA IoT Core initialized. Ready to connect.', 'system');
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

  function handleDeviceUnplugged(event) {
    appendTerminalLine('HARDWARE EVENT: USB cable unplugged or device disconnected.', 'alert');
    disconnectDevice();
  }

  // ================= SERIAL STREAM READER =================
  async function readSerialStream() {
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
    reader = textDecoder.readable.getReader();

    try {
      while (keepReading) {
        const { value, done } = await reader.read();
        if (done) {
          // Stream cancelled
          break;
        }
        if (value) {
          processIncomingChunk(value);
        }
      }
    } catch (err) {
      if (keepReading) {
        console.error('Error reading serial stream:', err);
        appendTerminalLine(`Stream read error: ${err.message}`, 'alert');
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {}
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

  function handleSerialLine(line) {
    // 1. Check if line is valid JSON telemetry
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const data = JSON.parse(line);
        if (data.type === 'telemetry' || data.voltage !== undefined || data.motor !== undefined) {
          onTelemetryReceived(data, line);
          return;
        }
      } catch (e) {
        // Malformed JSON chunk, ignore without crashing reader
      }
    }

    // 2. Otherwise line is a human-readable log or debug message from firmware
    classifyAndLogSerialLine(line);
  }

  function classifyAndLogSerialLine(line) {
    let lineClass = 'system';
    if (line.includes('ALERT') || line.includes('CRITICAL')) {
      lineClass = 'alert';
    } else if (line.includes('WARNING') || line.includes('warn')) {
      lineClass = 'warn';
    } else if (line.includes('Command:') || line.includes('Motor')) {
      lineClass = 'cmd';
    }
    appendTerminalLine(line, lineClass);
  }

  // ================= DIRECT MOTOR COMMAND TRANSMITTER =================
  async function sendMotorCommand(cmdChar) {
    if (!port || !port.writable) {
      alert('Cannot send command: ESP32 is not connected.');
      return;
    }

    try {
      const encoder = new TextEncoder();
      const writer = port.writable.getWriter();
      await writer.write(encoder.encode(cmdChar + '\n'));
      writer.releaseLock();

      const cmdMap = { 'F': 'FORWARD', 'R': 'REVERSE', 'S': 'STOP' };
      appendTerminalLine(`Sent Motor Command: '${cmdChar}' (${cmdMap[cmdChar] || 'Command'})`, 'cmd');
    } catch (err) {
      console.error('Error writing motor command:', err);
      appendTerminalLine(`Command send error: ${err.message}`, 'alert');
    }
  }

  // ================= TELEMETRY PROCESSING =================
  function onTelemetryReceived(data, rawJsonLine) {
    lastTelemetryTimestamp = Date.now();
    dom.staleDataWarning.classList.add('hidden');

    const timestamp = new Date();
    const timeFormatted = timestamp.toLocaleTimeString();
    dom.lastUpdateText.textContent = timeFormatted;

    // Log to terminal (truncated if long)
    appendTerminalLine(rawJsonLine, 'json');

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
    const motorState = (data.motor || 'STOP').toUpperCase();
    const buzzerState = (data.buzzer || 'OFF').toUpperCase();

    dom.motorStateText.textContent = motorState;
    dom.motorBuzzerState.textContent = buzzerState;

    // Reset rotor animation classes
    dom.rotorBladesGroup.classList.remove('rotor-spinning-forward', 'rotor-spinning-reverse');
    dom.motorStatusPill.classList.remove('running-fwd', 'running-rev', 'alert-fault');

    if (motorState === 'FORWARD') {
      dom.rotorBladesGroup.classList.add('rotor-spinning-forward');
      dom.motorDirectionOverlay.textContent = 'FORWARD';
      dom.motorDirectionText.textContent = 'FORWARD (CLOCKWISE)';
      dom.motorStatusPill.classList.add('running-fwd');
    } else if (motorState === 'REVERSE') {
      dom.rotorBladesGroup.classList.add('rotor-spinning-reverse');
      dom.motorDirectionOverlay.textContent = 'REVERSE';
      dom.motorDirectionText.textContent = 'REVERSE (COUNTER-CLOCKWISE)';
      dom.motorStatusPill.classList.add('running-rev');
    } else {
      dom.motorDirectionOverlay.textContent = 'STOPPED';
      dom.motorDirectionText.textContent = 'STOPPED (IDLE)';
    }

    // Hardware buzzer alert highlight
    if (buzzerState === 'ALERT' || data.alertActive) {
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
    if (data.shuntVoltage !== undefined && data.shuntVoltage !== null) {
      dom.shuntVoltageVal.textContent = `${parseFloat(data.shuntVoltage).toFixed(2)} mV`;
    }

    // Voltage Badge & Bar
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
    const current = typeof data.current === 'number' ? data.current : 0.0;
    dom.currentVal.textContent = current.toFixed(1);
    const amperes = (current / 1000.0).toFixed(3);
    dom.currentAmpVal.textContent = `${amperes} A`;

    const cPct = Math.min(Math.max((current / 1000.0) * 100, 0), 100);
    dom.currentBarFill.style.width = `${cPct}%`;

    if (current > settings.currMax) {
      setCardBadge(dom.currentBadge, 'OVERCURRENT', 'critical');
    } else {
      setCardBadge(dom.currentBadge, 'NORMAL', 'normal');
    }

    // 3. Power Consumption (INA219)
    const power = typeof data.power === 'number' ? data.power : 0.0;
    dom.powerVal.textContent = power.toFixed(1);
    const watts = (power / 1000.0).toFixed(3);
    dom.powerWattVal.textContent = `${watts} W`;

    const pPct = Math.min(Math.max((power / 12000.0) * 100, 0), 100);
    dom.powerBarFill.style.width = `${pPct}%`;
    setCardBadge(dom.powerBadge, 'NORMAL', 'normal');

    // 4. Vibration Health (MPU6050)
    const vibScore = typeof data.vibrationScore === 'number' ? data.vibrationScore : 0;
    const vibRms = typeof data.vibrationRMS === 'number' ? data.vibrationRMS : 0.0;
    dom.vibrationScoreVal.textContent = vibScore;
    dom.vibrationRmsVal.textContent = `${vibRms.toFixed(4)} g`;

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
      dom.motorTempVal.textContent = motorTempVal.toFixed(1);
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

    // 8. KY-024 Magnetic Sensor AO (GPIO 34)
    const ky024Raw = typeof data.ky024Raw === 'number' ? data.ky024Raw : 0;
    dom.ky024Val.textContent = ky024Raw;
    const magPct = Math.min(Math.max((ky024Raw / 4095.0) * 100, 0), 100);
    dom.ky024BarFill.style.width = `${magPct}%`;
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
      setAlertCheck(dom.alertCheckVib, dom.alertVibStatus, dom.alertVibDesc, 'CRITICAL', `Calculated vibration score (${vibScore}) exceeded configured threshold (${settings.vibMax}).`, 'critical');
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
    const current = typeof data.current === 'number' ? data.current : 0.0;
    if (current > settings.currMax) {
      setAlertCheck(dom.alertCheckCurr, dom.alertCurrStatus, dom.alertCurrDesc, 'OVERCURRENT', `Load current (${current.toFixed(1)} mA) exceeded safety limit (${settings.currMax.toFixed(1)} mA).`, 'critical');
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
    if (now - lastBeepTime < 1500) return; // Beep max once every 1.5s
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
      osc.frequency.setValueAtTime(880, audioContext.currentTime); // A5 note
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
    // Dark theme global defaults for Chart.js
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.06)';
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
            label: 'Power (mW)',
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
            title: { display: true, text: 'mW' },
            min: 0,
            suggestedMax: 8000
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
            label: 'Vibration Score',
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
            title: { display: true, text: 'Vib Score', color: '#3b82f6' },
            min: 0,
            suggestedMax: 200
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
    // Hide empty state placeholders on first data point
    dom.electricalChartEmpty.style.display = 'none';
    dom.powerChartEmpty.style.display = 'none';
    dom.thermalChartEmpty.style.display = 'none';
    dom.vibrationChartEmpty.style.display = 'none';

    // 1. Electrical
    appendChartPoint(electricalChart, timeLabel, [
      typeof data.voltage === 'number' ? data.voltage : null,
      typeof data.current === 'number' ? data.current : null
    ]);

    // 2. Power
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

    chart.update('none'); // non-animated high-performance refresh
  }

  function toggleChartsPause() {
    chartsPaused = !chartsPaused;
    dom.pauseChartsLabel.textContent = chartsPaused ? 'Resume Charts' : 'Pause Charts';
    dom.pauseChartsBtn.classList.toggle('active', chartsPaused);
  }

  // ================= TELEMETRY TABLE & CSV EXPORT =================
  function recordTelemetryHistory(data, timeFormatted) {
    // Store record in memory array
    const record = {
      index: telemetryHistory.length + 1,
      time: timeFormatted,
      motor: data.motor || 'STOP',
      voltage: typeof data.voltage === 'number' ? data.voltage.toFixed(2) : '--',
      current: typeof data.current === 'number' ? data.current.toFixed(1) : '--',
      power: typeof data.power === 'number' ? data.power.toFixed(1) : '--',
      motorTemp: data.motorTemperature !== null && !isNaN(data.motorTemperature) ? parseFloat(data.motorTemperature).toFixed(1) : 'null',
      ambTemp: data.ambientTemperature !== null && !isNaN(data.ambientTemperature) ? parseFloat(data.ambientTemperature).toFixed(1) : 'null',
      humidity: data.humidity !== null && !isNaN(data.humidity) ? parseFloat(data.humidity).toFixed(1) : 'null',
      vibScore: typeof data.vibrationScore === 'number' ? data.vibrationScore : 0,
      ky024Raw: typeof data.ky024Raw === 'number' ? data.ky024Raw : 0,
      buzzer: data.buzzer || 'OFF'
    };

    telemetryHistory.unshift(record); // Prepend for latest first
    if (telemetryHistory.length > MAX_HISTORY_ROWS) {
      telemetryHistory.pop();
    }

    dom.telemetryCountBadge.textContent = `${telemetryHistory.length} Records`;

    // Remove empty placeholder row if present
    if (dom.tableEmptyRow) {
      dom.tableEmptyRow.remove();
      dom.tableEmptyRow = null;
    }

    // Insert new row at top
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${record.index}</td>
      <td>${record.time}</td>
      <td><span class="status-badge ${record.motor === 'FORWARD' ? 'connected' : record.motor === 'REVERSE' ? 'connecting' : ''}">${record.motor}</span></td>
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

    // Keep DOM rows bounded to MAX_HISTORY_ROWS
    while (dom.telemetryTableBody.children.length > MAX_HISTORY_ROWS) {
      dom.telemetryTableBody.removeChild(dom.telemetryTableBody.lastChild);
    }
  }

  function clearTelemetryTable() {
    telemetryHistory = [];
    dom.telemetryTableBody.innerHTML = `
      <tr class="empty-row" id="tableEmptyRow">
        <td colspan="12">Session data cleared. Waiting for new telemetry records...</td>
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
      'RecordIndex', 'Timestamp', 'MotorState', 'Voltage_V', 'Current_mA',
      'Power_mW', 'MotorTemp_C', 'AmbientTemp_C', 'Humidity_pct',
      'VibrationScore', 'KY024_ADC', 'BuzzerState'
    ];

    let csvContent = headers.join(',') + '\r\n';

    // Export in chronological order (reverse of table view)
    const chronological = [...telemetryHistory].reverse();

    chronological.forEach(r => {
      const row = [
        r.index,
        `"${r.time}"`,
        `"${r.motor}"`,
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

      dom.connInstructionText.textContent = 'ESP32 connected via USB. Live telemetry streaming continuously.';
    } else if (state === 'connecting') {
      dom.headerStatusDot.className = 'status-dot connecting';
      dom.headerStatusText.textContent = 'Connecting...';
      dom.connStatusBadge.textContent = 'CONNECTING';
      dom.connStatusBadge.className = 'meta-value status-badge connecting';
      dom.streamPipelineText.textContent = 'Opening COM Port...';
      dom.connectBtn.disabled = true;
    } else {
      // Disconnected
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

    // Limit terminal buffer to 100 lines
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
    dom.cmdFwdBtn.addEventListener('click', () => sendMotorCommand('F'));
    dom.cmdRevBtn.addEventListener('click', () => sendMotorCommand('R'));
    dom.cmdStopBtn.addEventListener('click', () => sendMotorCommand('S'));

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
      appendTerminalLine('Reset settings to firmware default thresholds.', 'system');
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

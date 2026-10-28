# MOTRIVEXA

> **SMART PREDICTIVE HEALTH MONITORING AND PROTECTION SYSTEM FOR INDUSTRIAL ELECTRIC MOTORS**  
> *Tagline: Intelligent Monitoring. Predictive Insights. Safer Motors.*

---

## 📖 Overview

**MOTRIVEXA** is a real-time predictive motor health monitoring and protection system built for industrial electric motor prototypes. It connects an **ESP32** microcontroller directly to a modern web dashboard via the browser's native **Web Serial API** over USB at **115200 Baud**, eliminating the need for intermediary cloud servers, databases, or local backends.

The dashboard displays live sensor measurements, provides interactive waveform visualizations using Chart.js, tracks anomalies against configurable safety limits, manages fail-safe alarms, and allows exporting session telemetry directly to CSV.

---

## ⚙️ System Architecture & Technology Stack

- **Frontend**:
  - Semantic HTML5
  - Modern CSS3 (Industrial Dark Theme, CSS Custom Properties, Responsive Flex/Grid)
  - Vanilla JavaScript (ES6+, Web Serial API, Web Audio API)
  - [Chart.js](https://www.chartjs.org/) for live telemetry waveforms
- **Hardware & Firmware**:
  - ESP32 Development Board
  - Arduino C++ Framework
  - Direct USB Serial Communication (115200 Baud)
  - Non-blocking structured JSON telemetry output
- **Deployment**:
  - Static hosting (Vercel, GitHub Pages, or local HTTP server)

---

## 📁 Repository Structure

```text
MOTRIVEXA/
├── index.html                  # Main dashboard markup & modal interfaces
├── static/
│   ├── style.css               # Complete industrial design system & responsive styling
│   └── script.js               # Web Serial pipeline, Chart.js logic & CSV export
├── ESP32/
│   └── motrivexa_esp32.ino     # Consolidated ESP32 firmware (sensors, motor & JSON stream)
└── README.md                   # Documentation & setup guide
```

---

## 🔌 Hardware Pin Allocation

| Component | Pin / Bus | ESP32 GPIO | Description |
| :--- | :--- | :--- | :--- |
| **DS18B20 Temp Probe** | OneWire | **GPIO 4** | Motor contact thermal measurement |
| **DHT11 Sensor** | Data | **GPIO 18** | Ambient temp & relative humidity |
| **KY-024 Hall Sensor** | Analog Out (AO) | **GPIO 34** | 12-bit ADC1 input (magnetic flux) |
| **L298N Motor Driver** | ENA (PWM) | **GPIO 25** | Motor PWM speed drive |
| **L298N Motor Driver** | IN1 (Dir 1) | **GPIO 26** | Direction logic |
| **L298N Motor Driver** | IN2 (Dir 2) | **GPIO 27** | Direction logic |
| **Active Buzzer** | Control | **GPIO 33** | Hardware alert buzzer output |
| **I2C Bus Data** | SDA | **GPIO 21** | INA219, SSD1306 OLED, MPU6050 |
| **I2C Bus Clock** | SCL | **GPIO 22** | INA219, SSD1306 OLED, MPU6050 |

---

## 🚀 Quick Start Guide

### 1. ESP32 Firmware Setup
1. Install [Arduino IDE](https://www.arduino.cc/en/software) with the ESP32 board package.
2. In **Tools > Manage Libraries...**, install:
   - `Adafruit INA219`
   - `Adafruit SSD1306` & `Adafruit GFX Library`
   - `DallasTemperature` & `OneWire`
   - `DHT sensor library` (and `Adafruit Unified Sensor`)
3. Open `ESP32/motrivexa_esp32.ino`.
4. Select board: **ESP32 Dev Module** and the correct COM port.
5. Upload the code. **Close the Arduino Serial Monitor** once complete.

### 2. Live Web Dashboard
1. Open `index.html` in a supported desktop browser (**Google Chrome**, **Microsoft Edge**, or **Opera**).
2. Click **Connect Device**.
3. Select your ESP32 serial port in the browser prompt and click **Connect**.
4. Live telemetry will stream immediately to all cards, charts, and table logs.

### 3. Vercel Deployment
Deploy as a static website directly on Vercel:
1. Import the repository into Vercel.
2. Select Framework Preset as **Other** (Root directory `./`).
3. Deploy! Access via HTTPS on your desktop browser with the ESP32 connected via USB.

---

## 🛡️ License

MIT License. Designed and engineered for the MOTRIVEXA project.

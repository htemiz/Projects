## 📌 Project Title  
**An Energy-Efficient and Long-Range Smart Irrigation System Using LoRa Network**

---

## 👥 Project Team & Authors  

- **Hakan Temiz** – Project Manager
- **Muhammed Enes Kandemir** 
- **Eren Güler** 
- **Hüseyin Gürgün** 
- **Gökhan Yavuz** 
- **Ömer Bozbay** 

---

## 🧪 Novelty & Contributions  

This project integrates the following features:

- **Long-range wireless communication using LoRa / LoRaWAN**  
- **Off-grid operation enabled by a solar energy module**  
- **Zone-based irrigation and remote-control capability**  
- **Modular and scalable system architecture**  
- **Sensor-driven automated scheduling and decision mechanisms**

Expected contributions:

- **Significant reduction in labor and water consumption**  
- **Low-cost communication without GSM subscription**  
- **Environmentally friendly irrigation with reduced carbon footprint**  
- A **reference model** for future smart agriculture and irrigation projects  

---

## 🔬 Literature Background (Short Overview)

Recent research in smart irrigation highlights:

- **Sensor-based control:** automatic irrigation based on soil moisture, temperature, light, etc.  
- **Remote control via GSM / DTMF:** irrigation commands sent through GSM networks or DTMF signaling  
- **Renewable energy-powered irrigation:** solar-powered systems for remote agricultural areas  

This project **combines and advances** these approaches by:

- Leveraging **LoRa / LoRaWAN**, instead of Wi-Fi or GSM alone  
- Integrating **renewable solar energy** as the primary power source  
- Providing a **modular, scalable, zone-based architecture** suitable for large-scale deployment  

---

## 🎯 Project Objective  

The main objective of this project is to design and implement an **autonomous, remotely controllable irrigation system powered by renewable energy**.

Key goals include:

- Performing irrigation at the **right time, right amount, and right location**  
- Reducing **labor, water, and energy usage**  
- Achieving long-distance communication (up to **5–10 km**) without GSM or wired infrastructure  
- Establishing an **autonomous, sensor-assisted, remotely controlled irrigation system**  
- Promoting **environmental sustainability and reduced carbon footprint** through solar energy  

---
## 📦 Repository Structure
```
├── 1_Software/                    # Control software, web interface, and embedded code
│   ├── chart.js/                 # Chart.js library
│   ├── acu.ico                   # Favicon
│   ├── grafik.php                # Graph visualization
│   ├── grafik_veri.php           # Graph data provider
│   ├── headerlogotr.png          # Logo image
│   ├── index.php                 # Main control panel
│   ├── komutal.php               # Receive commands/data
│   ├── komutver.php              # Send commands to devices
│   ├── readme.md                 # Optional internal documentation
│   ├── schedule_ekle.php         # Scheduling interface
│   ├── style.css                 # UI styling
│   ├── verial.php                # Data receiving script
│   ├── YedoksC.ino               # Embedded firmware (ESP32/Arduino)
│   └── zaman_kontrol.php         # Time-based trigger logic
│
├── 2_Report/
│   └── LoRa_Rapor_30July.pdf     # Project report
│
└── README.md                     # This file
```

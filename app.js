const BASE = window.APP_CONFIG.FIREBASE_URL.replace(/\/$/, "");
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=42.883&longitude=23.050&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,is_day,cloud_cover,wind_speed_10m,wind_gusts_10m&timezone=Europe%2FSofia";

const ONLINE_LIMIT_SEC = 120;
const MICROPYTHON_EPOCH_OFFSET = 946684800;
const FUTURE_TOLERANCE_SEC = 30;

let chart = null;
const $ = (id) => document.getElementById(id);

function normalizeTimestamp(ts) {
  const value = Number(ts || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;

  const nowSec = Math.floor(Date.now() / 1000);

  // If already a sane Unix timestamp around current time, use directly.
  if (value > 1500000000 && value < nowSec + 86400) {
    return value;
  }

  // MicroPython on ESP32 often reports seconds from 2000-01-01.
  const asUnixFromMicroPython = value + MICROPYTHON_EPOCH_OFFSET;
  if (asUnixFromMicroPython > 1500000000 && asUnixFromMicroPython < nowSec + 86400) {
    return asUnixFromMicroPython;
  }

  // Fallback for old valid Unix-looking values.
  if (value > 1000000000) {
    return value;
  }

  return 0;
}

function computeOnline(updatedAt) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (!updatedAt) return { online: false, ageSec: Infinity, validTime: false };

  const delta = nowSec - updatedAt;

  // Future timestamps are not trusted as online except tiny clock drift.
  if (delta < -FUTURE_TOLERANCE_SEC) {
    return { online: false, ageSec: Infinity, validTime: false };
  }

  const ageSec = Math.max(0, delta);
  return {
    online: ageSec <= ONLINE_LIMIT_SEC,
    ageSec,
    validTime: true
  };
}

function state(v) {
  if (v < 800) return ["Добро качество на въздуха", "#39d98a"];
  if (v < 1200) return ["Препоръчва се проветряване", "#ffd166"];
  if (v < 1600) return ["Високо ниво — проветрете", "#ff9f43"];
  return ["Много високо ниво — проветрете веднага", "#ff6b6b"];
}

function fmt(ts) {
  const normalized = normalizeTimestamp(ts);
  return normalized ? new Date(normalized * 1000).toLocaleString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }) : "—";
}

function ageText(ageSec, validTime = true) {
  if (!validTime) return "невалиден час";
  if (!Number.isFinite(ageSec) || ageSec < 0) return "няма валиден час";
  if (ageSec < 60) return `преди ${ageSec} сек.`;

  const min = Math.floor(ageSec / 60);
  if (min < 60) return `преди ${min} мин.`;

  const hours = Math.floor(min / 60);
  const restMin = min % 60;
  if (hours < 24) return restMin ? `преди ${hours} ч. ${restMin} мин.` : `преди ${hours} ч.`;

  const days = Math.floor(hours / 24);
  return `преди ${days} дн.`;
}

function weatherInfo(code, isDay) {
  const night = !Boolean(isDay);
  const map = {
    0: [night ? "🌙" : "☀️", night ? "Ясна нощ" : "Ясно"],
    1: [night ? "🌙" : "🌤️", night ? "Предимно ясна нощ" : "Предимно ясно"],
    2: [night ? "☁️" : "⛅", night ? "Разкъсана облачност през нощта" : "Разкъсана облачност"],
    3: ["☁️", "Облачно"],
    45: ["🌫️", "Мъгла"],
    48: ["🌫️", "Скрежна мъгла"],
    51: ["🌦️", "Слаб ръмеж"],
    53: ["🌦️", "Ръмеж"],
    55: ["🌧️", "Силен ръмеж"],
    61: ["🌦️", "Слаб дъжд"],
    63: ["🌧️", "Дъжд"],
    65: ["🌧️", "Силен дъжд"],
    71: ["🌨️", "Слаб сняг"],
    73: ["🌨️", "Сняг"],
    75: ["❄️", "Силен сняг"],
    80: ["🌦️", "Превалявания"],
    81: ["🌧️", "Дъждовни превалявания"],
    82: ["⛈️", "Силни превалявания"],
    95: ["⛈️", "Гръмотевична буря"],
    96: ["⛈️", "Буря с градушка"],
    99: ["⛈️", "Силна буря с градушка"]
  };
  return map[code] || [night ? "🌙" : "🌡️", "Няма данни"];
}

function renderWeather(payload) {
  const current = payload?.current;
  if (!current) throw new Error("Няма метеорологични данни");

  const [icon, description] = weatherInfo(current.weather_code, current.is_day);
  $("weatherCondition").innerHTML = `<span class="weather-icon">${icon}</span> ${description}`;
  $("weatherTemp").innerHTML = `${Number(current.temperature_2m).toFixed(1)}<span class="unit">°C</span>`;
  $("weatherWind").innerHTML = `${Math.round(current.wind_speed_10m)}<span class="unit"> km/h</span>`;

  const period = current.is_day ? "ден" : "нощ";
  $("weatherUpdated").textContent = `${period === "нощ" ? "Нощни условия" : "Дневни условия"} · усеща се като ${Number(current.apparent_temperature).toFixed(1)}°C · влажност ${current.relative_humidity_2m}% · валеж ${Number(current.precipitation).toFixed(1)} mm · облачност ${current.cloud_cover}% · пориви ${Math.round(current.wind_gusts_10m)} km/h · обновено ${current.time}`;
}

function render(current, raw) {
  const co2 = Number(current?.co2 || 0);
  const temp = Number(current?.temperature || 0);
  const hum = Number(current?.humidity || 0);
  const updatedAtRaw = Number(current?.updated_at || current?.last_seen || 0);
  const updatedAt = normalizeTimestamp(updatedAtRaw);
  const status = computeOnline(updatedAt);
  const hasData = Boolean(current && current.co2 !== undefined && updatedAt && status.validTime);
  const online = hasData && status.online;
  const device = current?.device || current?.board || "неизвестно устройство";

  $("co2").innerHTML = co2 ? `${co2} <span class="unit">ppm</span>` : "—";
  $("temp").innerHTML = temp ? `${temp.toFixed(1)} <span class="unit">°C</span>` : "—";
  $("hum").innerHTML = hum ? `${hum.toFixed(1)} <span class="unit">%</span>` : "—";

  const quality = state(co2);
  if (!co2) {
    $("state").textContent = "Очакване на данни";
    $("state").style.color = "#9db1cb";
  } else if (!online) {
    $("state").textContent = "Офлайн — показани са последните данни";
    $("state").style.color = "#ff9f43";
  } else {
    $("state").textContent = quality[0];
    $("state").style.color = quality[1];
  }

  $("updated").textContent = updatedAt
    ? `Последно обновяване: ${fmt(updatedAt)} · ${ageText(status.ageSec, status.validTime)} · ${device}`
    : "Последно обновяване: няма данни";

  $("dot").classList.toggle("on", online);
  if (!hasData) {
    $("conn").textContent = "Няма валидни данни";
  } else if (online) {
    $("conn").textContent = "Устройството е онлайн";
  } else {
    $("conn").textContent = "Устройството е офлайн";
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const minTime = nowSec - 12 * 60 * 60;
  const data = Object.values(raw || {})
    .map((item) => {
      const normalizedTimestamp = normalizeTimestamp(item?.timestamp);
      return {
        ...item,
        timestamp: normalizedTimestamp
      };
    })
    .filter((item) => item && item.timestamp && item.timestamp >= minTime && item.timestamp <= nowSec + 60)
    .sort((a, b) => a.timestamp - b.timestamp);

  const labels = data.map((item) => new Date(item.timestamp * 1000).toLocaleTimeString("bg-BG", {
    hour: "2-digit",
    minute: "2-digit"
  }));

  if (chart) chart.destroy();
  chart = new Chart($("chart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "CO₂ ppm",
          data: data.map((item) => item.co2),
          borderColor: "#39d98a",
          backgroundColor: "rgba(57,217,138,0.14)",
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          borderWidth: 3,
          yAxisID: "y"
        },
        {
          label: "Температура °C",
          data: data.map((item) => item.temperature),
          borderColor: "#ffd166",
          backgroundColor: "transparent",
          fill: false,
          tension: 0.3,
          pointRadius: 2,
          borderWidth: 2,
          yAxisID: "y1"
        },
        {
          label: "Влажност %",
          data: data.map((item) => item.humidity),
          borderColor: "#3ba7ff",
          backgroundColor: "transparent",
          fill: false,
          tension: 0.3,
          pointRadius: 2,
          borderWidth: 2,
          yAxisID: "y1"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "#edf5ff" }
        }
      },
      scales: {
        x: {
          ticks: { color: "#9db1cb", maxTicksLimit: 10 },
          grid: { color: "rgba(255,255,255,0.05)" }
        },
        y: {
          type: "linear",
          position: "left",
          ticks: { color: "#9db1cb" },
          grid: { color: "rgba(255,255,255,0.08)" }
        },
        y1: {
          type: "linear",
          position: "right",
          ticks: { color: "#9db1cb" },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });

  $("err").textContent = data.length < 2
    ? "За линиите са нужни поне две исторически точки; ESP32 записва по една на 5 минути."
    : "";
}

async function loadIndoor() {
  const cacheBuster = Date.now();
  const [currentResponse, historyResponse] = await Promise.all([
    fetch(`${BASE}/co2_monitor/current.json?cb=${cacheBuster}`, { cache: "no-store" }),
    fetch(`${BASE}/co2_monitor/history.json?cb=${cacheBuster}`, { cache: "no-store" })
  ]);

  if (!currentResponse.ok) throw new Error(`Firebase current error: ${currentResponse.status}`);
  if (!historyResponse.ok) throw new Error(`Firebase history error: ${historyResponse.status}`);

  render(await currentResponse.json(), await historyResponse.json());
}

async function loadWeather() {
  try {
    const response = await fetch(`${WEATHER_URL}&cb=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Open-Meteo error: ${response.status}`);
    renderWeather(await response.json());
  } catch (error) {
    $("weatherUpdated").textContent = `Метеорологичните данни не са налични: ${error.message}`;
  }
}

async function load() {
  try {
    await loadIndoor();
  } catch (error) {
    $("dot").classList.remove("on");
    $("conn").textContent = "Грешка при Firebase връзката";
    $("err").textContent = error.message;
    console.error(error);
  }
}

load();
loadWeather();
setInterval(load, 15000);
setInterval(loadWeather, 10 * 60 * 1000);

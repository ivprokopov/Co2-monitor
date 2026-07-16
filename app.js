const BASE = window.APP_CONFIG.FIREBASE_URL.replace(/\/$/, "");

const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=42.883&longitude=23.050&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,is_day,cloud_cover,wind_speed_10m,wind_gusts_10m&timezone=Europe%2FSofia";

const ONLINE_LIMIT_SEC = 120;
const MICROPYTHON_EPOCH_OFFSET = 946684800;

let chart = null;

function $(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setHTML(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

function normalizeTimestamp(ts) {
  const value = Number(ts || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;

  const nowSec = Math.floor(Date.now() / 1000);

  // Нормален Unix timestamp
  if (value > 1500000000 && value < nowSec + 86400) {
    return value;
  }

  // MicroPython epoch: 2000-01-01
  const microAsUnix = value + MICROPYTHON_EPOCH_OFFSET;
  if (microAsUnix > 1500000000 && microAsUnix < nowSec + 86400) {
    return microAsUnix;
  }

  return value > 1000000000 ? value : 0;
}

function getAgeSec(timestamp) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (!timestamp) return Infinity;

  const age = nowSec - timestamp;

  // Ако времето е много в бъдещето, не го приемаме за валидно.
  if (age < -30) return Infinity;

  return Math.max(0, age);
}

function isOnline(timestamp) {
  const age = getAgeSec(timestamp);
  return Number.isFinite(age) && age <= ONLINE_LIMIT_SEC;
}

function ageText(ageSec) {
  if (!Number.isFinite(ageSec)) return "няма валиден час";
  if (ageSec < 60) return `преди ${ageSec} сек.`;

  const min = Math.floor(ageSec / 60);
  if (min < 60) return `преди ${min} мин.`;

  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `преди ${h} ч. ${m} мин.` : `преди ${h} ч.`;

  return `преди ${Math.floor(h / 24)} дн.`;
}

function formatTime(timestamp) {
  if (!timestamp) return "—";

  return new Date(timestamp * 1000).toLocaleString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function airState(co2) {
  if (co2 < 800) {
    return ["Добро качество на въздуха", "#39d98a"];
  }

  if (co2 < 1200) {
    return ["Препоръчва се проветряване", "#ffd166"];
  }

  if (co2 < 1600) {
    return ["Високо ниво — проветрете", "#ff9f43"];
  }

  return ["Много високо ниво — проветрете веднага", "#ff6b6b"];
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
  const current = payload && payload.current;

  if (!current) {
    throw new Error("Няма метеорологични данни");
  }

  const info = weatherInfo(current.weather_code, current.is_day);

  setHTML(
    "weatherCondition",
    `<span class="weather-icon">${info[0]}</span> ${info[1]}`
  );

  setHTML(
    "weatherTemp",
    `${Number(current.temperature_2m).toFixed(1)}<span class="unit">°C</span>`
  );

  setHTML(
    "weatherWind",
    `${Math.round(current.wind_speed_10m)}<span class="unit"> km/h</span>`
  );

  const period = current.is_day ? "Дневни условия" : "Нощни условия";

  setText(
    "weatherUpdated",
    `${period} · усеща се като ${Number(current.apparent_temperature).toFixed(1)}°C · влажност ${current.relative_humidity_2m}% · валеж ${Number(current.precipitation).toFixed(1)} mm · облачност ${current.cloud_cover}% · пориви ${Math.round(current.wind_gusts_10m)} km/h · обновено ${current.time}`
  );
}

function sensorStatusHex(value) {
  if (value === undefined || value === null) return "—";

  return `0x${Number(value).toString(16).toUpperCase().padStart(4, "0")}`;
}

function renderDiagnostics(current) {
  const node = $("diagnostics");

  if (!node) {
    return;
  }

  if (!current) {
    node.textContent = "Диагностика: няма данни";
    return;
  }

  const raw = current.co2_raw !== undefined ? current.co2_raw : "—";
  const corrected =
    current.co2_corrected !== undefined
      ? current.co2_corrected
      : current.co2 !== undefined
        ? current.co2
        : "—";

  const offset =
    current.co2_base_offset !== undefined
      ? current.co2_base_offset
      : current.co2_offset !== undefined
        ? current.co2_offset
        : 0;

  const confidence = current.confidence || "—";
  const mode = current.mode || "—";
  const filter = current.filter || "—";
  const driver = current.driver || "—";
  const status = sensorStatusHex(current.status);

  node.textContent =
    `Raw: ${raw} ppm · ` +
    `Corrected: ${corrected} ppm · ` +
    `Offset: ${offset} ppm · ` +
    `Confidence: ${confidence} · ` +
    `Sensor status: ${status} · ` +
    `Mode: ${mode} · ` +
    `Filter: ${filter} · ` +
    `Driver: ${driver}`;
}

function correctedValue(item) {
  if (!item) return 0;

  if (item.co2_corrected !== undefined && item.co2_corrected !== null) {
    return Number(item.co2_corrected);
  }

  if (item.co2 !== undefined && item.co2 !== null) {
    return Number(item.co2);
  }

  return 0;
}

function rawValue(item) {
  if (!item) return null;

  if (item.co2_raw !== undefined && item.co2_raw !== null) {
    return Number(item.co2_raw);
  }

  return null;
}

function renderIndoor(current, history) {
  const co2Corrected = correctedValue(current);
  const temp = Number(current && current.temperature ? current.temperature : 0);
  const hum = Number(current && current.humidity ? current.humidity : 0);

  const timestampRaw = current
    ? current.updated_at || current.last_seen || 0
    : 0;

  const timestamp = normalizeTimestamp(timestampRaw);
  const ageSec = getAgeSec(timestamp);
  const online = Boolean(current) && isOnline(timestamp);

  const device =
    current && (current.device || current.board)
      ? current.device || current.board
      : "неизвестно устройство";

  setHTML(
    "co2",
    co2Corrected
      ? `${Math.round(co2Corrected)} <span class="unit">ppm</span>`
      : "—"
  );

  setHTML(
    "temp",
    temp ? `${temp.toFixed(1)} <span class="unit">°C</span>` : "—"
  );

  setHTML(
    "hum",
    hum ? `${hum.toFixed(1)} <span class="unit">%</span>` : "—"
  );

  const quality = airState(co2Corrected);

  if (!current || !co2Corrected) {
    setText("state", "Очакване на данни");
    $("state").style.color = "#9db1cb";
  } else if (!online) {
    setText("state", "Офлайн — показани са последните данни");
    $("state").style.color = "#ff9f43";
  } else {
    setText("state", quality[0]);
    $("state").style.color = quality[1];
  }

  setText(
    "updated",
    timestamp
      ? `Последно обновяване: ${formatTime(timestamp)} · ${ageText(ageSec)} · ${device}`
      : "Последно обновяване: няма данни"
  );

  renderDiagnostics(current);

  $("dot").classList.toggle("on", online);
  setText(
    "conn",
    online
      ? "Устройството е онлайн"
      : current
        ? "Устройството е офлайн"
        : "Няма валидни данни"
  );

  renderChart(history);
}

function renderChart(history) {
  const nowSec = Math.floor(Date.now() / 1000);
  const minTime = nowSec - 12 * 60 * 60;

  const data = Object.values(history || {})
    .map((item) => {
      const timestamp = normalizeTimestamp(item.timestamp || item.updated_at);
      return {
        timestamp,
        co2Corrected: correctedValue(item),
        co2Raw: rawValue(item),
        temperature: Number(item.temperature || 0),
        humidity: Number(item.humidity || 0)
      };
    })
    .filter((item) => {
      return (
        item.timestamp &&
        item.timestamp >= minTime &&
        item.timestamp <= nowSec + 60
      );
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  const labels = data.map((item) => {
    return new Date(item.timestamp * 1000).toLocaleTimeString("bg-BG", {
      hour: "2-digit",
      minute: "2-digit"
    });
  });

  if (chart) {
    chart.destroy();
  }

  chart = new Chart($("chart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "CO₂ corrected ppm",
          data: data.map((item) => item.co2Corrected),
          borderColor: "#39d98a",
          backgroundColor: "rgba(57,217,138,0.14)",
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          borderWidth: 3,
          yAxisID: "y"
        },
        {
          label: "CO₂ raw ppm",
          data: data.map((item) => item.co2Raw),
          borderColor: "#9db1cb",
          backgroundColor: "transparent",
          fill: false,
          tension: 0.2,
          pointRadius: 1,
          borderWidth: 1,
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
          labels: {
            color: "#edf5ff"
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#9db1cb",
            maxTicksLimit: 10
          },
          grid: {
            color: "rgba(255,255,255,0.05)"
          }
        },
        y: {
          type: "linear",
          position: "left",
          ticks: {
            color: "#9db1cb"
          },
          grid: {
            color: "rgba(255,255,255,0.08)"
          }
        },
        y1: {
          type: "linear",
          position: "right",
          ticks: {
            color: "#9db1cb"
          },
          grid: {
            drawOnChartArea: false
          }
        }
      }
    }
  });

  setText(
    "err",
    data.length < 2
      ? "За линиите са нужни поне две исторически точки; ESP32 записва по една на 5 минути."
      : ""
  );
}

async function loadIndoor() {
  const cb = Date.now();

  const currentResponse = await fetch(
    `${BASE}/co2_monitor/current.json?cb=${cb}`,
    { cache: "no-store" }
  );

  const historyResponse = await fetch(
    `${BASE}/co2_monitor/history.json?cb=${cb}`,
    { cache: "no-store" }
  );

  if (!currentResponse.ok) {
    throw new Error(`Firebase current error: ${currentResponse.status}`);
  }

  if (!historyResponse.ok) {
    throw new Error(`Firebase history error: ${historyResponse.status}`);
  }

  const current = await currentResponse.json();
  const history = await historyResponse.json();

  renderIndoor(current, history);
}

async function loadWeather() {
  try {
    const response = await fetch(`${WEATHER_URL}&cb=${Date.now()}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Open-Meteo error: ${response.status}`);
    }

    const payload = await response.json();
    renderWeather(payload);
  } catch (error) {
    setText(
      "weatherUpdated",
      `Метеорологичните данни не са налични: ${error.message}`
    );
  }
}

async function load() {
  try {
    await loadIndoor();
  } catch (error) {
    $("dot").classList.remove("on");
    setText("conn", "Грешка при Firebase връзката");
    setText("err", error.message);
    console.error(error);
  }
}

load();
loadWeather();

setInterval(load, 15000);
setInterval(loadWeather, 10 * 60 * 1000);

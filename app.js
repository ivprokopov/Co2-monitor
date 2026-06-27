const BASE = window.APP_CONFIG.FIREBASE_URL.replace(/\/$/, "");
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=42.883&longitude=23.050&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m&timezone=Europe%2FSofia";
let chart = null;
const $ = (id) => document.getElementById(id);

function state(v) {
  if (v < 800) return ["Добро качество на въздуха", "#39d98a"];
  if (v < 1200) return ["Препоръчва се проветряване", "#ffd166"];
  if (v < 1600) return ["Високо ниво — проветрете", "#ff9f43"];
  return ["Много високо ниво — проветрете веднага", "#ff6b6b"];
}

function fmt(ts) {
  return ts ? new Date(ts * 1000).toLocaleString("bg-BG", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  }) : "—";
}

function weatherInfo(code) {
  const map = {
    0: ["☀️", "Ясно"], 1: ["🌤️", "Предимно ясно"], 2: ["⛅", "Разкъсана облачност"],
    3: ["☁️", "Облачно"], 45: ["🌫️", "Мъгла"], 48: ["🌫️", "Скрежна мъгла"],
    51: ["🌦️", "Слаб ръмеж"], 53: ["🌦️", "Ръмеж"], 55: ["🌧️", "Силен ръмеж"],
    61: ["🌦️", "Слаб дъжд"], 63: ["🌧️", "Дъжд"], 65: ["🌧️", "Силен дъжд"],
    71: ["🌨️", "Слаб сняг"], 73: ["🌨️", "Сняг"], 75: ["❄️", "Силен сняг"],
    80: ["🌦️", "Превалявания"], 81: ["🌧️", "Дъждовни превалявания"], 82: ["⛈️", "Силни превалявания"],
    95: ["⛈️", "Гръмотевична буря"], 96: ["⛈️", "Буря с градушка"], 99: ["⛈️", "Силна буря с градушка"]
  };
  return map[code] || ["🌡️", "Няма данни"];
}

function renderWeather(payload) {
  const current = payload?.current;
  if (!current) throw new Error("Няма метеорологични данни");

  const [icon, description] = weatherInfo(current.weather_code);
  $("weatherCondition").innerHTML = `<span class="weather-icon">${icon}</span> ${description}`;
  $("weatherTemp").innerHTML = `${Number(current.temperature_2m).toFixed(1)}<span class="unit">°C</span>`;
  $("weatherWind").innerHTML = `${Math.round(current.wind_speed_10m)}<span class="unit"> km/h</span>`;
  $("weatherUpdated").textContent = `Усеща се като ${Number(current.apparent_temperature).toFixed(1)}°C · влажност ${current.relative_humidity_2m}% · валеж ${Number(current.precipitation).toFixed(1)} mm · облачност ${current.cloud_cover}% · пориви ${Math.round(current.wind_gusts_10m)} km/h · обновено ${current.time}`;
}

function render(current, raw) {
  const co2 = Number(current?.co2 || 0);
  const temp = Number(current?.temperature || 0);
  const hum = Number(current?.humidity || 0);

  $("co2").innerHTML = co2 ? `${co2} <span class="unit">ppm</span>` : "—";
  $("temp").innerHTML = temp ? `${temp.toFixed(1)} <span class="unit">°C</span>` : "—";
  $("hum").innerHTML = hum ? `${hum.toFixed(1)} <span class="unit">%</span>` : "—";

  const quality = state(co2);
  $("state").textContent = co2 ? quality[0] : "Очакване на данни";
  $("state").style.color = quality[1];
  $("updated").textContent = `Последно обновяване: ${fmt(current?.updated_at)}`;

  const online = Boolean(current && current.co2 !== undefined);
  $("dot").classList.toggle("on", online);
  $("conn").textContent = online ? "Устройството е онлайн" : "Няма данни от устройството";

  const minTime = Math.floor(Date.now() / 1000) - 12 * 60 * 60;
  const data = Object.values(raw || {})
    .filter((item) => item && item.timestamp && item.timestamp >= minTime)
    .sort((a, b) => a.timestamp - b.timestamp);

  const labels = data.map((item) => new Date(item.timestamp * 1000).toLocaleTimeString("bg-BG", {
    hour: "2-digit", minute: "2-digit"
  }));

  if (chart) chart.destroy();
  chart = new Chart($("chart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "CO₂ ppm", data: data.map((item) => item.co2), borderColor: "#39d98a", backgroundColor: "rgba(57,217,138,0.14)", fill: true, tension: 0.3, pointRadius: 2, borderWidth: 3, yAxisID: "y" },
        { label: "Температура °C", data: data.map((item) => item.temperature), borderColor: "#ffd166", backgroundColor: "transparent", fill: false, tension: 0.3, pointRadius: 2, borderWidth: 2, yAxisID: "y1" },
        { label: "Влажност %", data: data.map((item) => item.humidity), borderColor: "#3ba7ff", backgroundColor: "transparent", fill: false, tension: 0.3, pointRadius: 2, borderWidth: 2, yAxisID: "y1" }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#edf5ff" } } },
      scales: {
        x: { ticks: { color: "#9db1cb", maxTicksLimit: 10 }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { type: "linear", position: "left", ticks: { color: "#9db1cb" }, grid: { color: "rgba(255,255,255,0.08)" } },
        y1: { type: "linear", position: "right", ticks: { color: "#9db1cb" }, grid: { drawOnChartArea: false } }
      }
    }
  });

  $("err").textContent = data.length < 2 ? "За линиите са нужни поне две исторически точки; ESP32 записва по една на 5 минути." : "";
}

async function loadIndoor() {
  const [currentResponse, historyResponse] = await Promise.all([
    fetch(`${BASE}/co2_monitor/current.json`),
    fetch(`${BASE}/co2_monitor/history.json`)
  ]);
  render(await currentResponse.json(), await historyResponse.json());
}

async function loadWeather() {
  try {
    const response = await fetch(WEATHER_URL);
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

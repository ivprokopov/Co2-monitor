const BASE = window.APP_CONFIG.FIREBASE_URL.replace(/\/$/, "");

const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=42.883&longitude=23.050&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,is_day,cloud_cover,wind_speed_10m,wind_gusts_10m&timezone=Europe%2FSofia";

const ONLINE_LIMIT_SEC = 120;
const MICROPYTHON_EPOCH_OFFSET = 946684800;
const REFERENCE_CO2_PPM = 400;

let selectedHours = 12;
let currentPayload = null;
let normalizedHistory = [];

let co2Chart = null;
let climateChart = null;
let errorChart = null;
let rawVsTempChart = null;
let rawVsHumidityChart = null;
let correctedVsTempChart = null;
let correctedVsHumidityChart = null;

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

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolText(value, trueText = "Да", falseText = "Не") {
  return value ? trueText : falseText;
}

function normalizeTimestamp(ts) {
  const value = Number(ts || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;

  const nowSec = Math.floor(Date.now() / 1000);

  if (value > 1500000000 && value < nowSec + 86400) {
    return value;
  }

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
  if (age < -30) return Infinity;
  return Math.max(0, age);
}

function isOnline(timestamp) {
  const age = getAgeSec(timestamp);
  return Number.isFinite(age) && age <= ONLINE_LIMIT_SEC;
}

function ageText(ageSec) {
  if (!Number.isFinite(ageSec)) return "няма валиден час";
  if (ageSec < 60) return `преди ${Math.round(ageSec)} сек.`;

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
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatShortTime(timestamp) {
  return new Date(timestamp * 1000).toLocaleString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function airState(co2) {
  if (co2 < 800) return ["Добро качество на въздуха", "#39d98a"];
  if (co2 < 1200) return ["Препоръчва се проветряване", "#ffd166"];
  if (co2 < 1600) return ["Високо ниво — проветрете", "#ff9f43"];
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
  if (!current) throw new Error("Няма метеорологични данни");

  const info = weatherInfo(current.weather_code, current.is_day);

  setHTML(
    "weatherCondition",
    `<span class="weather-icon">${info[0]}</span> ${info[1]}`
  );

  setHTML(
    "weatherTemp",
    `${num(current.temperature_2m).toFixed(1)}<span class="unit">°C</span>`
  );

  setHTML(
    "weatherWind",
    `${Math.round(num(current.wind_speed_10m))}<span class="unit"> km/h</span>`
  );

  const period = current.is_day ? "Дневни условия" : "Нощни условия";

  setText(
    "weatherUpdated",
    `${period} · усеща се като ${num(current.apparent_temperature).toFixed(1)}°C · влажност ${num(current.relative_humidity_2m)}% · валеж ${num(current.precipitation).toFixed(1)} mm · облачност ${num(current.cloud_cover)}% · пориви ${Math.round(num(current.wind_gusts_10m))} km/h · обновено ${current.time}`
  );
}

function sensorStatusHex(value) {
  if (value === undefined || value === null) return "—";
  return `0x${Number(value).toString(16).toUpperCase().padStart(4, "0")}`;
}

function normalizeHistory(history) {
  return Object.values(history || {})
    .map((item) => {
      const timestamp = normalizeTimestamp(
        item.timestamp || item.updated_at || item.last_seen
      );

      const raw = num(item.co2_raw, NaN);
      const nativeFiltered = num(
        item.co2_native_filtered,
        num(item.co2_raw, NaN)
      );
      const corrected = num(
        item.co2_software_compensated,
        num(item.co2_corrected, num(item.co2, NaN))
      );
      const temperature = num(item.temperature, NaN);
      const humidity = num(item.humidity, NaN);
      const predictedError = num(
        item.predicted_sensor_error,
        nativeFiltered - corrected
      );
      const residualError = corrected - REFERENCE_CO2_PPM;

      return {
        timestamp,
        raw,
        nativeFiltered,
        corrected,
        temperature,
        humidity,
        predictedError,
        residualError,
        modelBt: num(item.temperature_coefficient_ppm_per_c, NaN),
        modelBh: num(item.humidity_coefficient_ppm_per_rh, NaN),
        modelR2: num(item.model_r2, NaN),
        status: num(item.status, 0)
      };
    })
    .filter((item) => item.timestamp && Number.isFinite(item.raw))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function getFilteredHistory() {
  const nowSec = Math.floor(Date.now() / 1000);
  const minTime = nowSec - selectedHours * 3600;

  return normalizedHistory.filter((item) => {
    return item.timestamp >= minTime && item.timestamp <= nowSec + 60;
  });
}

function destroyChart(instance) {
  if (instance) instance.destroy();
}

function chartCommonOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "nearest",
      intersect: false
    },
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
        ticks: {
          color: "#9db1cb"
        },
        grid: {
          color: "rgba(255,255,255,0.08)"
        }
      }
    }
  };
}

function renderCo2Chart(data) {
  destroyChart(co2Chart);

  co2Chart = new Chart($("co2Chart"), {
    type: "line",
    data: {
      labels: data.map((item) => formatShortTime(item.timestamp)),
      datasets: [
        {
          label: "STCC4 raw CO₂",
          data: data.map((item) => item.raw),
          borderColor: "#9db1cb",
          backgroundColor: "transparent",
          borderWidth: 1,
          pointRadius: 1,
          tension: 0.2
        },
        {
          label: "STCC4 native filtered",
          data: data.map((item) => item.nativeFiltered),
          borderColor: "#7f8fa6",
          backgroundColor: "transparent",
          borderWidth: 2,
          pointRadius: 1,
          tension: 0.25
        },
        {
          label: "CO₂ software compensated — experimental",
          data: data.map((item) => item.corrected),
          borderColor: "#39d98a",
          backgroundColor: "rgba(57,217,138,0.12)",
          borderWidth: 3,
          pointRadius: 2,
          tension: 0.3,
          fill: true
        },
        {
          label: "Референция 400 ppm",
          data: data.map(() => REFERENCE_CO2_PPM),
          borderColor: "#ffd166",
          backgroundColor: "transparent",
          borderDash: [8, 6],
          pointRadius: 0,
          borderWidth: 2
        }
      ]
    },
    options: chartCommonOptions()
  });
}

function renderClimateChart(data) {
  destroyChart(climateChart);

  const options = chartCommonOptions();
  options.scales.y1 = {
    position: "right",
    ticks: { color: "#9db1cb" },
    grid: { drawOnChartArea: false }
  };

  climateChart = new Chart($("climateChart"), {
    type: "line",
    data: {
      labels: data.map((item) => formatShortTime(item.timestamp)),
      datasets: [
        {
          label: "Температура °C",
          data: data.map((item) => item.temperature),
          borderColor: "#ffd166",
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.3,
          yAxisID: "y"
        },
        {
          label: "Влажност %RH",
          data: data.map((item) => item.humidity),
          borderColor: "#3ba7ff",
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.3,
          yAxisID: "y1"
        }
      ]
    },
    options
  });
}

function renderErrorChart(data) {
  destroyChart(errorChart);

  errorChart = new Chart($("errorChart"), {
    type: "line",
    data: {
      labels: data.map((item) => formatShortTime(item.timestamp)),
      datasets: [
        {
          label: "Native грешка спрямо 400 ppm",
          data: data.map((item) => item.nativeFiltered - REFERENCE_CO2_PPM),
          borderColor: "#ff6b6b",
          borderWidth: 2,
          pointRadius: 1,
          tension: 0.25
        },
        {
          label: "Прогнозирана грешка",
          data: data.map((item) => item.predictedError),
          borderColor: "#ffd166",
          borderWidth: 2,
          pointRadius: 1,
          tension: 0.25
        },
        {
          label: "Остатъчна грешка след компенсацията",
          data: data.map((item) => item.residualError),
          borderColor: "#39d98a",
          borderWidth: 2,
          pointRadius: 1,
          tension: 0.25
        },
        {
          label: "Нулева остатъчна грешка",
          data: data.map(() => 0),
          borderColor: "#9db1cb",
          borderDash: [6, 6],
          pointRadius: 0,
          borderWidth: 1
        }
      ]
    },
    options: chartCommonOptions()
  });
}

function createScatter(canvasId, data, xKey, yKey, label, xLabel, yLabel) {
  return new Chart($(canvasId), {
    type: "scatter",
    data: {
      datasets: [
        {
          label,
          data: data
            .filter(
              (item) =>
                Number.isFinite(item[xKey]) && Number.isFinite(item[yKey])
            )
            .map((item) => ({
              x: item[xKey],
              y: item[yKey]
            })),
          borderColor: "#39d98a",
          backgroundColor: "rgba(57,217,138,0.65)",
          pointRadius: 4
        }
      ]
    },
    options: {
      ...chartCommonOptions(),
      scales: {
        x: {
          title: {
            display: true,
            text: xLabel,
            color: "#edf5ff"
          },
          ticks: { color: "#9db1cb" },
          grid: { color: "rgba(255,255,255,0.05)" }
        },
        y: {
          title: {
            display: true,
            text: yLabel,
            color: "#edf5ff"
          },
          ticks: { color: "#9db1cb" },
          grid: { color: "rgba(255,255,255,0.08)" }
        }
      }
    }
  });
}

function renderScatterCharts(data) {
  destroyChart(rawVsTempChart);
  destroyChart(rawVsHumidityChart);
  destroyChart(correctedVsTempChart);
  destroyChart(correctedVsHumidityChart);

  rawVsTempChart = createScatter(
    "rawVsTempChart",
    data,
    "temperature",
    "nativeFiltered",
    "Native CO₂ спрямо температура",
    "Температура °C",
    "Native CO₂ ppm"
  );

  rawVsHumidityChart = createScatter(
    "rawVsHumidityChart",
    data,
    "humidity",
    "nativeFiltered",
    "Native CO₂ спрямо влажност",
    "Влажност %RH",
    "Native CO₂ ppm"
  );

  correctedVsTempChart = createScatter(
    "correctedVsTempChart",
    data,
    "temperature",
    "corrected",
    "Компенсиран CO₂ спрямо температура",
    "Температура °C",
    "Компенсиран CO₂ ppm"
  );

  correctedVsHumidityChart = createScatter(
    "correctedVsHumidityChart",
    data,
    "humidity",
    "corrected",
    "Компенсиран CO₂ спрямо влажност",
    "Влажност %RH",
    "Компенсиран CO₂ ppm"
  );
}

function renderCurrent(current) {
  if (!current) return;

  const corrected = num(
    current.co2_software_compensated,
    num(current.co2_corrected, num(current.co2, 0))
  );
  const nativeFiltered = num(
    current.co2_native_filtered,
    num(current.co2_raw, 0)
  );
  const raw = num(current.co2_raw, 0);
  const temp = num(current.temperature, 0);
  const hum = num(current.humidity, 0);
  const predictedError = num(
    current.predicted_sensor_error,
    nativeFiltered - corrected
  );
  const residualError = corrected - REFERENCE_CO2_PPM;

  const timestamp = normalizeTimestamp(
    current.updated_at || current.last_seen || 0
  );
  const online = isOnline(timestamp);
  const ageSec = getAgeSec(timestamp);

  setHTML(
    "co2",
    corrected ? `${Math.round(corrected)} <span class="unit">ppm</span>` : "—"
  );
  setHTML(
    "co2Native",
    nativeFiltered
      ? `${Math.round(nativeFiltered)} <span class="unit">ppm</span>`
      : "—"
  );
  setHTML(
    "co2Raw",
    raw ? `${Math.round(raw)} <span class="unit">ppm</span>` : "—"
  );
  setHTML(
    "temp",
    temp ? `${temp.toFixed(1)} <span class="unit">°C</span>` : "—"
  );
  setHTML(
    "hum",
    hum ? `${hum.toFixed(1)} <span class="unit">%</span>` : "—"
  );
  setHTML(
    "predictedError",
    `${predictedError.toFixed(1)} <span class="unit">ppm</span>`
  );

  const quality = airState(corrected);
  setText(
    "state",
    online ? quality[0] : "Офлайн — показани са последните данни"
  );
  $("state").style.color = online ? quality[1] : "#ff9f43";

  $("dot").classList.toggle("on", online);
  setText(
    "conn",
    online ? "Устройството е онлайн" : "Устройството е офлайн"
  );

  setText(
    "updated",
    `Последно обновяване: ${formatTime(timestamp)} · ${ageText(ageSec)} · ${
      current.device || current.board || "неизвестно устройство"
    }`
  );

  setText("modelSamples", String(num(current.model_samples, 0)));
  setText("modelR2", num(current.model_r2, 0).toFixed(4));
  setText(
    "temperatureCoefficient",
    `${num(current.temperature_coefficient_ppm_per_c, 0).toFixed(2)} ppm/°C`
  );
  setText(
    "humidityCoefficient",
    `${num(current.humidity_coefficient_ppm_per_rh, 0).toFixed(2)} ppm/%RH`
  );
  setText(
    "temperatureEffect",
    `${num(current.temperature_effect_per_10c, 0).toFixed(1)} ppm`
  );
  setText(
    "humidityEffect",
    `${num(current.humidity_effect_per_20rh, 0).toFixed(1)} ppm`
  );
  setText(
    "modelIntercept",
    `${num(current.model_intercept, 0).toFixed(2)} ppm`
  );
  setText("residualError", `${residualError.toFixed(1)} ppm`);

  setText("ascStatus", current.asc_enabled ? "Включена" : "Изключена");
  setText(
    "testingModeStatus",
    boolText(current.testing_mode, "Активен", "Неактивен")
  );
  setText(
    "shtLinkStatus",
    boolText(current.internal_rht_link_ok, "OK", "Проблем")
  );
  setText("sensorStatus", sensorStatusHex(current.status));

  setText(
    "modelDiagnosis",
    current.compensation_diagnosis || "Няма диагностичен резултат"
  );

  setText(
    "diagnostics",
    `Raw: ${raw} ppm · Native filtered: ${Math.round(
      nativeFiltered
    )} ppm · Software compensated: ${Math.round(
      corrected
    )} ppm · Predicted error: ${predictedError.toFixed(
      1
    )} ppm · R²: ${num(current.model_r2, 0).toFixed(
      4
    )} · Status: ${sensorStatusHex(current.status)} · Mode: ${
      current.mode || "—"
    }`
  );
}

function renderDatasetQuality(data) {
  if (!data.length) {
    setText("datasetQuality", "Няма достатъчно исторически данни.");
    return;
  }

  const temps = data.map((item) => item.temperature).filter(Number.isFinite);
  const hums = data.map((item) => item.humidity).filter(Number.isFinite);

  const tMin = Math.min(...temps);
  const tMax = Math.max(...temps);
  const hMin = Math.min(...hums);
  const hMax = Math.max(...hums);

  const tRange = tMax - tMin;
  const hRange = hMax - hMin;

  setText("temperatureMin", `${tMin.toFixed(1)} °C`);
  setText("temperatureMax", `${tMax.toFixed(1)} °C`);
  setText("temperatureRange", `${tRange.toFixed(1)} °C`);
  setText("humidityMin", `${hMin.toFixed(1)} %RH`);
  setText("humidityMax", `${hMax.toFixed(1)} %RH`);
  setText("humidityRange", `${hRange.toFixed(1)} %RH`);

  const problems = [];

  if (data.length < 200) problems.push("под 200 проби");
  if (tRange < 8) problems.push("температурен диапазон под 8°C");
  if (hRange < 15)
    problems.push("диапазон на влажността под 15 процентни пункта");
  if (selectedHours < 18) problems.push("периодът е под 18 часа");

  setText(
    "datasetQuality",
    problems.length
      ? `Наборът още не е достатъчно стабилен: ${problems.join(", ")}.`
      : "Наборът има достатъчен обем и диапазон за последващ офлайн анализ."
  );
}

function renderTable(data) {
  const body = $("historyTableBody");
  if (!body) return;

  const limitValue = $("tableLimit") ? $("tableLimit").value : "100";
  const rows =
    limitValue === "all" ? data : data.slice(-Number(limitValue));

  body.innerHTML = "";

  if (!rows.length) {
    body.innerHTML =
      '<tr><td colspan="12">Няма данни за избрания период.</td></tr>';
    return;
  }

  rows
    .slice()
    .reverse()
    .forEach((item) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${formatTime(item.timestamp)}</td>
        <td>${Math.round(item.raw)}</td>
        <td>${Math.round(item.nativeFiltered)}</td>
        <td>${Math.round(item.corrected)}</td>
        <td>${item.temperature.toFixed(2)}</td>
        <td>${item.humidity.toFixed(2)}</td>
        <td>${item.predictedError.toFixed(2)}</td>
        <td>${item.residualError.toFixed(2)}</td>
        <td>${Number.isFinite(item.modelBt) ? item.modelBt.toFixed(3) : "—"}</td>
        <td>${Number.isFinite(item.modelBh) ? item.modelBh.toFixed(3) : "—"}</td>
        <td>${Number.isFinite(item.modelR2) ? item.modelR2.toFixed(4) : "—"}</td>
        <td>${sensorStatusHex(item.status)}</td>
      `;
      body.appendChild(row);
    });
}

function renderAll() {
  renderCurrent(currentPayload);

  const data = getFilteredHistory();

  renderCo2Chart(data);
  renderClimateChart(data);
  renderErrorChart(data);
  renderScatterCharts(data);
  renderDatasetQuality(data);
  renderTable(data);

  setText(
    "err",
    data.length < 2
      ? "За графиките са нужни поне две исторически точки."
      : ""
  );
}

function exportCsv() {
  const data = getFilteredHistory();

  if (!data.length) {
    alert("Няма данни за експорт.");
    return;
  }

  const header = [
    "timestamp",
    "datetime_bg",
    "co2_raw",
    "co2_native_filtered",
    "co2_software_compensated",
    "temperature_c",
    "humidity_rh",
    "predicted_sensor_error",
    "residual_error_vs_400",
    "temperature_coefficient_ppm_per_c",
    "humidity_coefficient_ppm_per_rh",
    "model_r2",
    "status_hex"
  ];

  const lines = [header.join(",")];

  data.forEach((item) => {
    lines.push(
      [
        item.timestamp,
        `"${formatTime(item.timestamp)}"`,
        item.raw,
        item.nativeFiltered,
        item.corrected,
        item.temperature,
        item.humidity,
        item.predictedError,
        item.residualError,
        Number.isFinite(item.modelBt) ? item.modelBt : "",
        Number.isFinite(item.modelBh) ? item.modelBh : "",
        Number.isFinite(item.modelR2) ? item.modelR2 : "",
        sensorStatusHex(item.status)
      ].join(",")
    );
  });

  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `stcc4_diagnostic_${selectedHours}h_${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadIndoor() {
  const cb = Date.now();

  const [currentResponse, historyResponse] = await Promise.all([
    fetch(`${BASE}/co2_monitor/current.json?cb=${cb}`, {
      cache: "no-store"
    }),
    fetch(`${BASE}/co2_monitor/history.json?cb=${cb}`, {
      cache: "no-store"
    })
  ]);

  if (!currentResponse.ok) {
    throw new Error(`Firebase current error: ${currentResponse.status}`);
  }

  if (!historyResponse.ok) {
    throw new Error(`Firebase history error: ${historyResponse.status}`);
  }

  currentPayload = await currentResponse.json();
  const historyPayload = await historyResponse.json();
  normalizedHistory = normalizeHistory(historyPayload);

  renderAll();
}

async function loadWeather() {
  try {
    const response = await fetch(`${WEATHER_URL}&cb=${Date.now()}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Open-Meteo error: ${response.status}`);
    }

    renderWeather(await response.json());
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

function bindControls() {
  document.querySelectorAll(".period-btn").forEach((button) => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll(".period-btn")
        .forEach((btn) => btn.classList.remove("active"));

      button.classList.add("active");
      selectedHours = Number(button.dataset.hours || 12);
      renderAll();
    });
  });

  if ($("refreshButton")) {
    $("refreshButton").addEventListener("click", load);
  }

  if ($("exportCsvButton")) {
    $("exportCsvButton").addEventListener("click", exportCsv);
  }

  if ($("tableLimit")) {
    $("tableLimit").addEventListener("change", () => {
      renderTable(getFilteredHistory());
    });
  }
}

bindControls();
load();
loadWeather();

setInterval(load, 15000);
setInterval(loadWeather, 10 * 60 * 1000);

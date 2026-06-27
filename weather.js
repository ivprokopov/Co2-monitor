const WEATHER_LAT = 42.931793;
const WEATHER_LON = 23.202095;

function weatherLabel(code) {
  const labels = {0:"Ясно",1:"Предимно ясно",2:"Разкъсана облачност",3:"Облачно",45:"Мъгла",48:"Скрежна мъгла",51:"Слаб ръмеж",53:"Ръмеж",55:"Силен ръмеж",61:"Слаб дъжд",63:"Дъжд",65:"Силен дъжд",71:"Слаб сняг",73:"Сняг",75:"Силен сняг",80:"Превалявания",81:"Дъждовни превалявания",82:"Силни превалявания",95:"Гръмотевици"};
  return labels[code] || "Няма данни";
}

async function refreshWeather() {
  try {
    const host = ["https://api", "open-meteo", "com"].join(".");
    const endpoint = host + "/v1/forecast?latitude=" + WEATHER_LAT + "&longitude=" + WEATHER_LON + "&current=temperature_2m,weather_code,wind_speed_10m&timezone=Europe%2FSofia";
    const response = await fetch(endpoint);
    const data = await response.json();
    const current = data.current;
    document.getElementById("weatherCondition").textContent = weatherLabel(current.weather_code);
    document.getElementById("weatherTemp").innerHTML = Number(current.temperature_2m).toFixed(1) + ' <span class="unit">°C</span>';
    document.getElementById("weatherWind").innerHTML = Math.round(current.wind_speed_10m) + ' <span class="unit">km/h</span>';
    document.getElementById("weatherUpdated").textContent = "Външни данни: " + current.time.replace("T", " ");
  } catch (error) {
    document.getElementById("weatherCondition").textContent = "Няма връзка";
    document.getElementById("weatherUpdated").textContent = "Неуспешно зареждане на външните метеорологични данни.";
  }
}

refreshWeather();
setInterval(refreshWeather, 600000);

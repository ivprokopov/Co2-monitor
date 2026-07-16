const BASE = window.APP_CONFIG.FIREBASE_URL.replace(/\/$/, "");
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=42.883&longitude=23.050&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,is_day,cloud_cover,wind_speed_10m,wind_gusts_10m&timezone=Europe%2FSofia";
const ONLINE_LIMIT_SEC = 120;
const MICROPYTHON_EPOCH_OFFSET = 946684800;
const FUTURE_TOLERANCE_SEC = 30;
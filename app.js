const CFG = window.APP_CONFIG || {};
const BASE = String(CFG.FIREBASE_URL || "").replace(/\/$/, "");
const LAT = Number(CFG.WEATHER_LAT);
const LON = Number(CFG.WEATHER_LON);
const REF = 429;
const ONLINE_SEC = 120;
const MP_OFFSET = 946684800;

let hours = 12;
let customFrom = null;
let customTo = null;
let current = null;
let history = [];
let forecastPressure = [];
let co2Chart, climateChart, pressureChart;

const $ = id => document.getElementById(id);
const n = (v, fallback = NaN) => Number.isFinite(Number(v)) ? Number(v) : fallback;

function unixTime(v){
  const x = Number(v || 0);
  if (!Number.isFinite(x) || x <= 0) return 0;
  const now = Date.now()/1000;
  if (x > 1500000000 && x < now + 86400) return x;
  const converted = x + MP_OFFSET;
  return converted > 1500000000 && converted < now + 86400 ? converted : 0;
}
function fmt(ts, seconds=false){
  if(!ts) return "—";
  const options={day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"};
  if(seconds) options.second="2-digit";
  return new Date(ts*1000).toLocaleString("bg-BG",options);
}
function isoDateLocal(date){
  const y=date.getFullYear();
  const m=String(date.getMonth()+1).padStart(2,"0");
  const d=String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function hex(v){return v === undefined || v === null ? "—" : "0x"+Number(v).toString(16).toUpperCase().padStart(4,"0")}
function weatherText(code){
  return ({0:"☀️ Ясно",1:"🌤️ Предимно ясно",2:"⛅ Разкъсана облачност",3:"☁️ Облачно",
  45:"🌫️ Мъгла",48:"🌫️ Скрежна мъгла",51:"🌦️ Слаб ръмеж",53:"🌦️ Ръмеж",
  55:"🌧️ Силен ръмеж",61:"🌦️ Слаб дъжд",63:"🌧️ Дъжд",65:"🌧️ Силен дъжд",
  71:"🌨️ Слаб сняг",73:"🌨️ Сняг",75:"❄️ Силен сняг",80:"🌦️ Превалявания",
  81:"🌧️ Дъждовни превалявания",82:"⛈️ Силни превалявания",95:"⛈️ Гръмотевици"})[code] || "Няма данни";
}
function airState(x){
  if(x < 800) return ["Добро качество на въздуха","#39d98a"];
  if(x < 1200) return ["Повишено ниво","#ffd166"];
  if(x < 1600) return ["Високо ниво","#ff9f43"];
  return ["Много високо ниво","#ff6b6b"];
}
function normalize(h){
  return Object.values(h || {}).map(x => ({
    ts: unixTime(x.timestamp || x.updated_at || x.last_seen),
    raw:n(x.co2_raw),
    co2:n(x.co2_native_filtered,n(x.co2)),
    t:n(x.temperature),
    rh:n(x.humidity),
    status:n(x.status,0),
    pressure:n(x.surface_pressure_hpa),
    pressureApplied:n(x.pressure_compensation_pa)
  })).filter(x=>x.ts && Number.isFinite(x.co2)).sort((a,b)=>a.ts-b.ts);
}
function filtered(){
  if(customFrom !== null && customTo !== null){
    return history.filter(x=>x.ts>=customFrom && x.ts<=customTo);
  }
  const min=Date.now()/1000-hours*3600;
  return history.filter(x=>x.ts>=min);
}
function chartOpts(){
  return {responsive:true,maintainAspectRatio:false,interaction:{mode:"nearest",intersect:false},
    plugins:{legend:{labels:{color:"#edf5ff"}}},
    scales:{x:{ticks:{color:"#9db1cb",maxTicksLimit:10},grid:{color:"rgba(255,255,255,.05)"}},
    y:{ticks:{color:"#9db1cb"},grid:{color:"rgba(255,255,255,.08)"}}}};
}
function renderCharts(){
  const d=filtered(), labels=d.map(x=>fmt(x.ts));
  if(co2Chart)co2Chart.destroy();
  co2Chart=new Chart($("co2Chart"),{type:"line",data:{labels,datasets:[
    {label:"Native filtered CO₂",data:d.map(x=>x.co2),borderColor:"#39d98a",backgroundColor:"rgba(57,217,138,.12)",fill:true,borderWidth:2,pointRadius:1,tension:.25},
    {label:"Референция 429 ppm",data:d.map(()=>REF),borderColor:"#ffd166",borderDash:[7,6],pointRadius:0,borderWidth:2}
  ]},options:chartOpts()});

  if(climateChart)climateChart.destroy();
  const o=chartOpts();o.scales.y1={position:"right",ticks:{color:"#9db1cb"},grid:{drawOnChartArea:false}};
  climateChart=new Chart($("climateChart"),{type:"line",data:{labels,datasets:[
    {label:"Температура °C",data:d.map(x=>x.t),borderColor:"#ffd166",borderWidth:2,pointRadius:1,tension:.25,yAxisID:"y"},
    {label:"Влажност %RH",data:d.map(x=>x.rh),borderColor:"#3ba7ff",borderWidth:2,pointRadius:1,tension:.25,yAxisID:"y1"}
  ]},options:o});

  if(pressureChart)pressureChart.destroy();
  pressureChart=new Chart($("pressureChart"),{type:"line",data:{
    labels:forecastPressure.map(x=>x.label),
    datasets:[{label:"Surface pressure hPa",data:forecastPressure.map(x=>x.value),borderColor:"#8ec5ff",backgroundColor:"rgba(142,197,255,.12)",fill:true,borderWidth:2,pointRadius:2,tension:.25}]
  },options:chartOpts()});
}
function renderCurrent(){
  if(!current)return;
  const co2=n(current.co2_native_filtered,n(current.co2));
  const raw=n(current.co2_raw);
  const t=n(current.temperature),rh=n(current.humidity);
  const ts=unixTime(current.updated_at||current.last_seen||current.timestamp);
  const online=ts && (Date.now()/1000-ts)<=ONLINE_SEC;

  $("dot").classList.toggle("on",online);
  $("conn").textContent=online?"Устройството е онлайн":"Устройството е офлайн";
  $("co2").innerHTML=Number.isFinite(co2)?`${Math.round(co2)} <span class="unit">ppm</span>`:"—";
  $("temp").innerHTML=Number.isFinite(t)?`${t.toFixed(1)} <span class="unit">°C</span>`:"—";
  $("hum").innerHTML=Number.isFinite(rh)?`${rh.toFixed(1)} <span class="unit">%</span>`:"—";

  const state=airState(co2);
  $("airState").textContent=online?state[0]:"Офлайн — последни данни";
  $("airState").style.color=online?state[1]:"#ff9f43";
  $("updated").textContent=`Последно обновяване: ${fmt(ts,true)}`;

  const frc=Boolean(current.frc_applied || current.frc_marker_present);
  $("frcStatus").textContent=frc?`Изпълнена към ${n(current.frc_target_ppm,429)} ppm`:"Предстои";
  $("frcStatus").style.color=frc?"#39d98a":"#ffd166";
  $("frcCorrection").textContent=current.frc_correction_ppm === null || current.frc_correction_ppm === undefined
    ? "—"
    : `${current.frc_correction_ppm} ppm`;

  $("asc").textContent=current.asc_enabled?"Включена":"Изключена";
  $("testing").textContent=current.testing_mode?"Активен":"Неактивен";
  $("sht").textContent=current.internal_rht_link_ok?"OK":"Проблем";
  $("stccStatus").textContent=hex(current.status);
  $("sensorMode").textContent=current.mode || "—";

  const pressureActive=Boolean(current.pressure_compensation_active);
  $("pressureComp").textContent=pressureActive?"Активна":"Неактивна";
  $("pressureComp").style.color=pressureActive?"#39d98a":"#ffd166";
  $("pressureApplied").textContent=Number.isFinite(n(current.pressure_compensation_pa))
    ? `${Math.round(n(current.pressure_compensation_pa))} Pa`
    : "—";
  $("pressureSource").textContent=current.pressure_source || "—";
  $("pressureUpdated").textContent=fmt(unixTime(current.pressure_last_update));

  $("rawCo2").textContent=Number.isFinite(raw)?`${Math.round(raw)} ppm`:"—";
  $("nativeCo2").textContent=Number.isFinite(co2)?`${Math.round(co2)} ppm`:"—";
  $("sequence").textContent=current.measurement_sequence ?? current.sequence ?? "—";
}
function pressureTrend(now,p6){
  const d=p6-now;
  if(d>1.5)return `↑ Покачване с ${d.toFixed(1)} hPa / 6 ч.`;
  if(d<-1.5)return `↓ Спад с ${Math.abs(d).toFixed(1)} hPa / 6 ч.`;
  return `→ Стабилно (${d>=0?"+":""}${d.toFixed(1)} hPa / 6 ч.)`;
}
async function loadWeather(){
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code,wind_speed_10m,surface_pressure&hourly=surface_pressure&forecast_hours=24&timezone=Europe%2FSofia`;
  const r=await fetch(url+"&cb="+Date.now(),{cache:"no-store"});
  if(!r.ok)throw new Error("Open-Meteo "+r.status);
  const d=await r.json(),c=d.current;

  $("locationName").textContent=CFG.LOCATION_NAME||"с. Дръмша";
  $("weatherCondition").textContent=weatherText(c.weather_code);
  $("weatherTemp").innerHTML=`${n(c.temperature_2m).toFixed(1)} <span class="unit">°C</span>`;
  $("weatherWind").innerHTML=`${Math.round(n(c.wind_speed_10m))} <span class="unit">km/h</span>`;
  $("pressure").innerHTML=`${n(c.surface_pressure).toFixed(1)} <span class="unit">hPa</span>`;

  const vals=d.hourly?.surface_pressure||[],times=d.hourly?.time||[];
  forecastPressure=times.map((x,i)=>({
    label:new Date(x).toLocaleString("bg-BG",{hour:"2-digit",minute:"2-digit"}),
    value:n(vals[i])
  })).filter(x=>Number.isFinite(x.value));

  const p6=forecastPressure[Math.min(6,forecastPressure.length-1)]?.value;
  $("pressure6h").innerHTML=Number.isFinite(p6)?`${p6.toFixed(1)} <span class="unit">hPa</span>`:"—";
  $("pressureTrend").textContent=Number.isFinite(p6)?pressureTrend(n(c.surface_pressure),p6):"—";
  $("weatherUpdated").textContent=`Текущо surface pressure · обновено ${String(c.time).replace("T"," ")}`;
}
async function loadFirebase(){
  const cb=Date.now();
  const [a,b]=await Promise.all([
    fetch(`${BASE}/co2_monitor/current.json?cb=${cb}`,{cache:"no-store"}),
    fetch(`${BASE}/co2_monitor/history.json?cb=${cb}`,{cache:"no-store"})
  ]);
  if(!a.ok||!b.ok)throw new Error("Грешка при Firebase");
  current=await a.json();
  history=normalize(await b.json());
}
async function loadAll(){
  try{
    $("error").textContent="";
    await Promise.all([loadFirebase(),loadWeather()]);
    renderCurrent();
    renderCharts();
  }catch(e){
    $("error").textContent=e.message;
    $("dot").classList.remove("on");
    console.error(e);
  }
}
function updateRangeSummary(){
  if(customFrom !== null && customTo !== null){
    $("rangeSummary").textContent=`Период: ${fmt(customFrom)} – ${fmt(customTo)}`;
  }else{
    const labels={12:"последните 12 часа",24:"последните 24 часа",72:"последните 3 дни",168:"последните 7 дни"};
    $("rangeSummary").textContent=`Период: ${labels[hours] || `последните ${hours} часа`}`;
  }
}
function applyCustomDates(){
  const fromValue=$("dateFrom").value;
  const toValue=$("dateTo").value;

  if(!fromValue || !toValue){
    alert("Избери начална и крайна дата.");
    return;
  }

  const fromDate=new Date(`${fromValue}T00:00:00`);
  const toDate=new Date(`${toValue}T23:59:59`);

  if(toDate < fromDate){
    alert("Крайната дата трябва да е след началната.");
    return;
  }

  customFrom=Math.floor(fromDate.getTime()/1000);
  customTo=Math.floor(toDate.getTime()/1000);

  document.querySelectorAll(".period").forEach(x=>x.classList.remove("active"));
  updateRangeSummary();
  renderCharts();
}
function clearCustomDates(){
  customFrom=null;
  customTo=null;
  $("dateFrom").value="";
  $("dateTo").value="";
  document.querySelectorAll(".period").forEach(x=>x.classList.toggle("active",Number(x.dataset.hours)===hours));
  updateRangeSummary();
  renderCharts();
}
function csv(){
  const d=filtered();
  if(!d.length)return alert("Няма данни за избрания период.");

  const rows=[["timestamp","datetime","co2_raw","co2_native_filtered","temperature_c","humidity_rh","surface_pressure_hpa","pressure_compensation_pa","status"].join(",")];
  d.forEach(x=>rows.push([
    x.ts,`"${fmt(x.ts,true)}"`,x.raw,x.co2,x.t,x.rh,
    Number.isFinite(x.pressure)?x.pressure:"",
    Number.isFinite(x.pressureApplied)?x.pressureApplied:"",
    hex(x.status)
  ].join(",")));

  const blob=new Blob([rows.join("\n")],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`stcc4_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.querySelectorAll(".period").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".period").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  hours=Number(btn.dataset.hours);
  customFrom=null;
  customTo=null;
  $("dateFrom").value="";
  $("dateTo").value="";
  updateRangeSummary();
  renderCharts();
});

$("applyDateBtn").onclick=applyCustomDates;
$("clearDateBtn").onclick=clearCustomDates;
$("refreshBtn").onclick=loadAll;
$("csvBtn").onclick=csv;

const today=new Date();
$("dateTo").max=isoDateLocal(today);
$("dateFrom").max=isoDateLocal(today);

updateRangeSummary();
loadAll();
setInterval(async()=>{
  try{
    await loadFirebase();
    renderCurrent();
    renderCharts();
  }catch(e){
    $("error").textContent=e.message;
  }
},15000);
setInterval(loadWeather,600000);

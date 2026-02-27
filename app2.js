
import { bollinger, ema, rsi, atr } from "./indicators.js";
import { predict, train } from "./ai.js";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
}

const $ = (id) => document.getElementById(id);

const apiKeyInput = $("apiKey");
const saveKeyBtn = $("saveKeyBtn");
const keyStatus = $("keyStatus");

const symbolSel = $("symbol");
const tfSel = $("tf");
const leadSel = $("leadSec");

const startBtn = $("startBtn");
const stopBtn = $("stopBtn");

const countdownEl = $("countdown");
const signalEl = $("signal");
const winrateEl = $("winrate");
const realWinrateEl = $("realWinrate");
const reasonEl = $("reason");

const winBtn = $("winBtn");
const loseBtn = $("loseBtn");

const historyEl = $("history");

const LS_KEY = "tw_api_key_v1";
const RESULTS_KEY = "results_last50_v1";

let timer = null;
let lastSignal = null;

function setKeyStatus(msg){ keyStatus.textContent = msg; }
function getApiKey(){ return localStorage.getItem(LS_KEY) || ""; }

function setHistory(item){
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML = `<b>${item.dir}</b> / ${item.symbol} / ${item.tf}分 / 勝率目安 ${item.winrate}%<br>${item.time}<br>${item.reason}`;
  historyEl.prepend(div);
  while(historyEl.children.length > 20) historyEl.removeChild(historyEl.lastChild);
}

function loadResults(){
  try {
    const arr = JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]");
    return Array.isArray(arr) ? arr.filter(v => v===0 || v===1) : [];
  } catch {
    return [];
  }
}

function saveResults(arr){
  localStorage.setItem(RESULTS_KEY, JSON.stringify(arr));
}

function pushResult(isWin){
  const arr = loadResults();
  arr.unshift(isWin ? 1 : 0);
  if(arr.length > 50) arr.length = 50;
  saveResults(arr);
}

function renderRealWinrate(){
  const arr = loadResults();
  const n = arr.length;
  if(n === 0){
    realWinrateEl.textContent = "--（まだ結果がありません）";
    return;
  }
  let wins = 0;
  for(const v of arr) wins += v;
  const pct = Math.round((wins / n) * 100);
  realWinrateEl.textContent = `${pct}%（${n}回中${wins}勝）`;
}

function nowJST(){
  return new Date();
}

function nextBarTime(tfMin){
  const d = nowJST();
  const ms = d.getTime();
  const m = d.getMinutes();
  const nextMin = Math.ceil((m + d.getSeconds()/60) / tfMin) * tfMin;
  const nd = new Date(d);
  nd.setSeconds(0); nd.setMilliseconds(0);
  if(nextMin >= 60){
    nd.setHours(d.getHours()+1);
    nd.setMinutes(0);
  } else {
    nd.setMinutes(nextMin);
  }
  if(nd.getTime() <= ms) nd.setMinutes(nd.getMinutes() + tfMin);
  return nd;
}

function normalize(x, clamp=1){
  if(!isFinite(x)) return 0;
  if(x > clamp) return clamp;
  if(x < -clamp) return -clamp;
  return x;
}

function tfNormalize(tf){
  if(tf === 1) return -1;
  if(tf === 3) return 0;
  return 1;
}

async function fetchCandlesTwelveData(symbol, intervalMin, count=120){
  const key = getApiKey();
  if(!key) throw new Error("APIキーが未設定です");

  const interval = `${intervalMin}min`;
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(count));
  url.searchParams.set("format", "JSON");
  url.searchParams.set("apikey", key);

  const res = await fetch(url.toString());
  const data = await res.json();

  if(data.status === "error"){
    throw new Error(data.message || "APIエラー");
  }

  const values = data.values;
  if(!Array.isArray(values) || values.length < 30){
    throw new Error("データが少なすぎます");
  }

  const rows = values.slice().reverse();
  const high = rows.map(r => Number(r.high));
  const low  = rows.map(r => Number(r.low));
  const close= rows.map(r => Number(r.close));

  return { high, low, close };
}

function decideSignal(symbol, tfMin, ohlc){
  const {high, low, close} = ohlc;

  const bb = bollinger(close, 20, 2);
  const e = ema(close, 50);
  const r = rsi(close, 14);
  const a = atr(high, low, close, 14);

  if(!bb || e===null || r===null || a===null) {
    return { dir:"--", winrate:null, reason:"データ不足", features:null };
  }

  const last = close[close.length-1];
  const trend = last > e ? 1 : -1;

  const sd = (bb.upper - bb.mid) / 2;
  const bbZ = sd > 0 ? (last - bb.mid) / sd : 0;

  const tooVolatile = a/last > 0.005;
  if(tooVolatile){
    return { dir:"NO", winrate:0, reason:"ボラ高すぎ", features:null };
  }

  let dir = "NO";
  let base = 50;

  if(last <= bb.lower && r <= 35 && trend >= 0){
    dir = "HIGH";
    base += 20;
  }

  if(last >= bb.upper && r >= 65 && trend <= 0){
    dir = "LOW";
    base += 20;
  }

  if(dir === "NO"){
    return { dir:"NO", winrate:0, reason:"条件不足", features:null };
  }

  const features = [
    normalize(bbZ/2),
    normalize((r-50)/50),
    normalize((last-e)/e * 10),
    normalize((a/last) * 200),
    trend,
    tfNormalize(tfMin)
  ];

  const p = predict(features);
  const aiAdj = (p - 0.5) * 30;
  let winrate = Math.round(base + aiAdj);
  winrate = Math.max(40, Math.min(85, winrate));

  const reason = `BB:${bbZ.toFixed(2)} / RSI:${r.toFixed(1)}`;

  return { dir, winrate, reason, features };
}

function fmtTime(d){
  const pad = (n)=> String(n).padStart(2,"0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function tick(){
  const symbol = symbolSel.value;
  const tfMin = Number(tfSel.value);
  const leadSec = Number(leadSel.value);

  const next = nextBarTime(tfMin);
  const diffMs = next.getTime() - nowJST().getTime();
  const diffSec = Math.max(0, Math.ceil(diffMs/1000));
  countdownEl.textContent = `${diffSec}秒（次の判定 ${fmtTime(next)}）`;

  if(diffSec === leadSec){
    try{
      const ohlc = await fetchCandlesTwelveData(symbol, tfMin, 120);
      const out = decideSignal(symbol, tfMin, ohlc);

      signalEl.textContent = out.dir;
      winrateEl.textContent = out.dir === "HIGH" || out.dir === "LOW"
        ? `${out.winrate}%`
        : "--";

      reasonEl.textContent = out.reason;

      if(out.features && (out.dir === "HIGH" || out.dir === "LOW")){
        lastSignal = {
          time: new Date().toLocaleString(),
          symbol,
          tf: tfMin,
          dir: out.dir,
          winrate: out.winrate,
          reason: out.reason,
          features: out.features
        };
        winBtn.disabled = false;
        loseBtn.disabled = false;
        setHistory(lastSignal);
      } else {
        lastSignal = null;
        winBtn.disabled = true;
        loseBtn.disabled = true;
      }

    }catch(err){
      signalEl.textContent = "ERR";
      winrateEl.textContent = "--";
      reasonEl.textContent = String(err?.message || err);
    }
  }
}

function start(){
  if(timer) return;

  signalEl.textContent = "--";
  winrateEl.textContent = "--";
  reasonEl.textContent = "--";
  historyEl.innerHTML = "";
  lastSignal = null;
  winBtn.disabled = true;
  loseBtn.disabled = true;

  startBtn.disabled = true;
  stopBtn.disabled = false;

  timer = setInterval(tick, 1000);
  tick();
}

function stop(){
  if(timer){
    clearInterval(timer);
    timer = null;
  }
  startBtn.disabled = false;
  stopBtn.disabled = true;
  countdownEl.textContent = "--";
}

saveKeyBtn.addEventListener("click", ()=>{
  const k = apiKeyInput.value.trim();
  if(!k){
    localStorage.removeItem(LS_KEY);
    setKeyStatus("APIキーを削除しました");
    return;
  }
  localStorage.setItem(LS_KEY, k);
  apiKeyInput.value = "";
  setKeyStatus("APIキーを保存しました（端末内）");
});

winBtn.addEventListener("click", ()=>{
  if(!lastSignal) return;
  train(lastSignal.features, 1);
  pushResult(true);
  renderRealWinrate();
  alert("記録しました（勝ち）");
  winBtn.disabled = true;
  loseBtn.disabled = true;
  lastSignal = null;
});

loseBtn.addEventListener("click", ()=>{
  if(!lastSignal) return;
  train(lastSignal.features, 0);
  pushResult(false);
  renderRealWinrate();
  alert("記録しました（負け）");
  winBtn.disabled = true;
  loseBtn.disabled = true;
  lastSignal = null;
});
startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);
(()=>{
  const k = getApiKey();
  setKeyStatus(k ? "APIキー保存済み" : "未設定（上で保存してください）");
  renderRealWinrate();
})();

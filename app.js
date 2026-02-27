import { bollinger, ema, rsi, atr } from "./indicators.js";
import { predict, train } from "./ai.js";

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
let lastEvalTargetMs = null;

/* ================= API ================= */

function getApiKey(){
  return localStorage.getItem(LS_KEY) || "";
}

async function fetchCandles(symbol, tfMin, count=120){
  const key = getApiKey();
  if(!key) throw new Error("APIキー未設定");

  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", `${tfMin}min`);
  url.searchParams.set("outputsize", count);
  url.searchParams.set("format", "JSON");
  url.searchParams.set("apikey", key);

  const res = await fetch(url.toString());
  const data = await res.json();

  if(data.status === "error"){
    throw new Error(data.message || "APIエラー");
  }

  if(!data.values || !Array.isArray(data.values)){
    throw new Error("データ取得失敗");
  }

  const rows = data.values.slice().reverse();

  const high = rows.map(r=>Number(r.high));
  const low  = rows.map(r=>Number(r.low));
  const close= rows.map(r=>Number(r.close));

  return { high, low, close };
}

/* ================= ロジック ================= */

function decideSignal(symbol, tfMin, ohlc){

  const { high, low, close } = ohlc;

  if(!close || close.length < 30){
    return { dir:"NO", winrate:null, reason:"データ不足", features:null };
  }

  const bb = bollinger(close,20,2);
  const r  = rsi(close,14);
  const e  = ema(close,50);

  if(!bb || r==null || e==null){
    return { dir:"NO", winrate:null, reason:"計算不可", features:null };
  }

  const last = close[close.length-1];
  const trend = last > e ? 1 : -1;

  let dir="NO";
  let base=50;

  if(last <= bb.lower && r <= 35 && trend >= 0){
    dir="HIGH"; base+=20;
  }

  if(last >= bb.upper && r >= 65 && trend <= 0){
    dir="LOW"; base+=20;
  }

  if(dir==="NO"){
    return { dir:"NO", winrate:0, reason:"条件不足", features:null };
  }

  const winrate = Math.max(40, Math.min(85, base));

  return {
    dir,
    winrate,
    reason:`BB / RSI:${r.toFixed(1)}`,
    features:[trend,r]
  };
}

/* ================= 時間管理 ================= */

function nextBarTime(tfMin){
  const now = new Date();
  const m = now.getMinutes();
  const nextMin = Math.ceil(m/tfMin)*tfMin;
  const nd = new Date(now);
  nd.setSeconds(0);
  nd.setMilliseconds(0);
  nd.setMinutes(nextMin);
  if(nd<=now) nd.setMinutes(nd.getMinutes()+tfMin);
  return nd;
}

/* ================= メイン ================= */

async function tick(){

  const symbol = symbolSel.value;
  const tfMin = Number(tfSel.value);
  const leadSec = Number(leadSel.value);

  const next = nextBarTime(tfMin);
  const diffSec = Math.max(0, Math.ceil((next - new Date())/1000));

  countdownEl.textContent =
    `${diffSec}秒 (次の判定 ${next.toLocaleTimeString()})`;

  const targetMs = next.getTime();

  if(diffSec <= leadSec && lastEvalTargetMs !== targetMs){

    lastEvalTargetMs = targetMs;

    try{

      const ohlc = await fetchCandles(symbol, tfMin);

      if(!ohlc || !ohlc.close || !ohlc.close.length){
        throw new Error("価格データ取得失敗");
      }

      const out = decideSignal(symbol, tfMin, ohlc);

      signalEl.textContent = out.dir;
      winrateEl.textContent =
        (out.dir==="HIGH"||out.dir==="LOW")
          ? `${out.winrate}%`
          : "--";

      reasonEl.textContent = out.reason;

      if(out.features && (out.dir==="HIGH"||out.dir==="LOW")){
        lastSignal = out;
        winBtn.disabled=false;
        loseBtn.disabled=false;
      }else{
        lastSignal=null;
        winBtn.disabled=true;
        loseBtn.disabled=true;
      }

    }catch(err){
      signalEl.textContent="ERR";
      winrateEl.textContent="--";
      reasonEl.textContent=err.message;
    }
  }
}

/* ================= 開始停止 ================= */

function start(){
  if(timer) return;
  timer=setInterval(tick,1000);
  tick();
  startBtn.disabled=true;
  stopBtn.disabled=false;
}

function stop(){
  clearInterval(timer);
  timer=null;
  startBtn.disabled=false;
  stopBtn.disabled=true;
}

startBtn.addEventListener("click",start);
stopBtn.addEventListener("click",stop);

saveKeyBtn.addEventListener("click",()=>{
  const k = apiKeyInput.value.trim();
  if(!k){
    localStorage.removeItem(LS_KEY);
    keyStatus.textContent="APIキー削除";
    return;
  }
  localStorage.setItem(LS_KEY,k);
  keyStatus.textContent="APIキー保存済み";
});

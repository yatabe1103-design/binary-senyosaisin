export function sma(values, period){
  if(values.length < period) return null;
  let s = 0;
  for(let i=values.length-period; i<values.length; i++) s += values[i];
  return s/period;
}

export function std(values, period){
  const m = sma(values, period);
  if(m === null) return null;
  let v = 0;
  for(let i=values.length-period; i<values.length; i++){
    const d = values[i]-m;
    v += d*d;
  }
  return Math.sqrt(v/period);
}

export function bollinger(close, period=20, mult=2){
  const mid = sma(close, period);
  const s = std(close, period);
  if(mid===null || s===null) return null;
  return { mid, upper: mid + mult*s, lower: mid - mult*s };
}

export function ema(values, period){
  if(values.length < period) return null;
  const k = 2/(period+1);
  let e = values[values.length - period];
  for(let i=values.length - period + 1; i<values.length; i++){
    e = values[i]*k + e*(1-k);
  }
  return e;
}

export function rsi(values, period=14){
  if(values.length < period+1) return null;
  let gains=0, losses=0;
  for(let i=values.length-period; i<values.length; i++){
    const diff = values[i]-values[i-1];
    if(diff>=0) gains += diff;
    else losses += -diff;
  }
  const avgGain = gains/period;
  const avgLoss = losses/period;
  if(avgLoss === 0) return 100;
  const rs = avgGain/avgLoss;
  return 100 - (100/(1+rs));
}

export function atr(high, low, close, period=14){
  if(close.length < period+1) return null;
  const tr = [];
  for(let i=1; i<close.length; i++){
    const h = high[i], l = low[i], pc = close[i-1];
    tr.push(Math.max(h-l, Math.abs(h-pc), Math.abs(l-pc)));
  }
  if(tr.length < period) return null;
  let s=0;
  for(let i=tr.length-period; i<tr.length; i++) s += tr[i];
  return s/period;
}

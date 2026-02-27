const KEY = "simple_ai_v1";

function load(){
  try { 
    return JSON.parse(localStorage.getItem(KEY)) ?? { w:[0,0,0,0,0,0], b:0 }; 
  } catch { 
    return { w:[0,0,0,0,0,0], b:0 }; 
  }
}

function save(m){ 
  localStorage.setItem(KEY, JSON.stringify(m)); 
}

function sigmoid(z){ 
  return 1/(1+Math.exp(-z)); 
}

export function predict(features){
  const m = load();
  let z = m.b;
  for(let i=0;i<m.w.length;i++) z += m.w[i]*(features[i] ?? 0);
  const p = sigmoid(z);
  return p; // 0..1
}

export function train(features, label){
  // label: 1=勝ち, 0=負け
  const lr = 0.2; 
  const m = load();
  let z = m.b;
  for(let i=0;i<m.w.length;i++) z += m.w[i]*(features[i] ?? 0);
  const p = sigmoid(z);
  const err = (label - p);

  for(let i=0;i<m.w.length;i++){
    m.w[i] += lr * err * (features[i] ?? 0);
  }
  m.b += lr * err;

  save(m);
}

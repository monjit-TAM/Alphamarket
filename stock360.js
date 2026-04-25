// Stock 360 — DYOR Light Theme (Black + Red only)
window.s360ShowInfo=function(type){
  var info={
    alphascore:{t:'AlphaScore\u2122',b:'<b>0-100 composite score</b> blending 40+ factors across 5 dimensions.<br><br><b>Technical (25%)</b> \u2014 RSI, MACD, SMA, Bollinger, Supertrend, volume<br><b>Fundamental (25%)</b> \u2014 PE, ROE, D/E, dividend yield<br><b>Ownership (20%)</b> \u2014 Accumulation, Minervini template<br><b>Momentum (15%)</b> \u2014 Relative strength, weekly momentum<br><b>Risk-Alpha (15%)</b> \u2014 Drawdown, recovery, volatility<br><br><b>Grades:</b> A+ (80+) STRONG BUY \u00B7 A (70+) BUY \u00B7 B+ (60+) ACCUMULATE \u00B7 B (50+) HOLD \u00B7 C (40+) WATCH \u00B7 D (30+) REDUCE \u00B7 F (<30) AVOID'},
    confluence:{t:'Confluence Engine\u2122',b:'<b>Signal convergence probability</b> backtested across 5 years.<br><br>22 signals across 4 categories. 16 backtested combinations with hit rates and sample sizes. Higher % = more signals aligned = higher conviction.'},
    smartmoney:{t:'Smart Money Flow\u2122',b:'<b>Institutional conviction tracker.</b><br><br>6 components: Accumulation (25%), Minervini (20%), Volume Quality (20%), Fundamental (15%), Momentum (10%), Trend (10%). Tracks where big money is moving.'}
  };
  var i=info[type];if(!i)return;
  var m=document.getElementById('s360-detail-modal');
  if(!m){m=document.createElement('div');m.id='s360-detail-modal';m.style.cssText='display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);align-items:center;justify-content:center';m.onclick=function(){m.style.display='none'};m.innerHTML='<div onclick="event.stopPropagation()" style="background:#fff;border:2px solid #dc2626;border-radius:8px;max-width:560px;width:90%;max-height:80vh;overflow:auto;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,0.15)"><div style="display:flex;justify-content:space-between;margin-bottom:12px"><div id="s360-info-title" style="font-size:16px;font-weight:700;color:#dc2626"></div><button onclick="document.getElementById(\\x27s360-detail-modal\\x27).style.display=\\x27none\\x27" style="background:none;border:none;font-size:18px;cursor:pointer;color:#666">\u2715</button></div><div id="s360-info-body" style="font-size:13px;color:#333;line-height:1.7"></div><div style="text-align:center;margin-top:12px;padding-top:10px;border-top:1px solid #eee;font-size:9px;color:#999">AlphaMarket\u2122 Proprietary Intelligence \u00B7 Patent Pending</div></div>';document.body.appendChild(m)}
  m.style.display='flex';m.querySelector('#s360-info-title').innerHTML=i.t;m.querySelector('#s360-info-body').innerHTML=i.b;
};
window.load360=function load360(){var el=document.getElementById('s360-content');if(el)el.innerHTML='<div style="text-align:center;padding:60px;color:#999">Enter a stock symbol and click ANALYZE</div>'}
window.analyze360=function analyze360(){
  var sym=document.getElementById('s360-sym').value.trim().toUpperCase();if(!sym)return;
  var el=document.getElementById('s360-content');el.innerHTML='<div style="text-align:center;padding:60px;color:#999">Analyzing '+sym+'...</div>';
  fetch('/dyor/api/stock360/'+sym,{credentials:'include'}).then(function(r){return r.json()}).then(function(d){if(d.detail){el.innerHTML='<div style="text-align:center;padding:60px;color:#dc2626">'+d.detail+'</div>';return}render360(d)}).catch(function(e){el.innerHTML='<div style="text-align:center;padding:60px;color:#dc2626">Error: '+e.message+'</div>'})
}
function draw360Chart(id,data,price){
  var c=document.getElementById(id);if(!c||!data||!data.length)return;
  var ctx=c.getContext('2d');var W=c.width=c.offsetWidth*2,H=c.height=c.offsetHeight*2;ctx.scale(2,2);var w=c.offsetWidth,h=c.offsetHeight;
  var d=data.slice(-200);var highs=d.map(function(x){return x.high}),lows=d.map(function(x){return x.low});
  var mx=Math.max.apply(null,highs)*1.02,mn=Math.min.apply(null,lows)*0.98,rng=mx-mn||1;var bw=Math.max(1,(w-40)/d.length);
  function yP(p){return 8+(1-(p-mn)/rng)*(h-24)}
  ctx.strokeStyle='#eee';ctx.lineWidth=0.5;
  for(var i=0;i<5;i++){var gy=8+i*(h-24)/4;ctx.beginPath();ctx.moveTo(35,gy);ctx.lineTo(w,gy);ctx.stroke();ctx.fillStyle='#999';ctx.font='7px monospace';ctx.textAlign='right';ctx.fillText((mx-i*rng/4).toFixed(0),33,gy+3)}
  d.forEach(function(x,i){var xp=38+i*bw,o=yP(x.open),cl=yP(x.close),hi=yP(x.high),lo=yP(x.low);var bull=x.close>=x.open;ctx.strokeStyle=bull?'#16a34a':'#dc2626';ctx.fillStyle=bull?'#16a34a':'#dc2626';ctx.beginPath();ctx.moveTo(xp+bw/2,hi);ctx.lineTo(xp+bw/2,lo);ctx.stroke();ctx.fillRect(xp+1,Math.min(o,cl),bw-2,Math.max(1,Math.abs(cl-o)))});
  var closes=d.map(function(x){return x.close});function calcSMA(arr,p){var r=[];for(var i=0;i<arr.length;i++){if(i<p-1)r.push(null);else{var s=0;for(var j=i-p+1;j<=i;j++)s+=arr[j];r.push(s/p)}}return r}
  function drawSMA(vals,col){ctx.strokeStyle=col;ctx.lineWidth=0.8;ctx.beginPath();var st=false;vals.forEach(function(v,i){if(v&&i<d.length){var x=38+i*bw+bw/2,y=yP(v);if(!st){ctx.moveTo(x,y);st=true}else ctx.lineTo(x,y)}});ctx.stroke()}
  drawSMA(calcSMA(closes,20),'#2563eb');drawSMA(calcSMA(closes,50),'#f59e0b');if(closes.length>=200)drawSMA(calcSMA(closes,200),'#dc2626');
  var ly=yP(price);ctx.fillStyle='#dc2626';ctx.fillRect(w-42,ly-6,42,12);ctx.fillStyle='#fff';ctx.font='bold 7px monospace';ctx.textAlign='left';ctx.fillText(price.toFixed(0),w-40,ly+3);
  var vols=d.map(function(x){return x.volume||0});var mxV=Math.max.apply(null,vols)||1;
  d.forEach(function(x,i){var xp=38+i*bw,vH=(x.volume/mxV)*(h*0.1);ctx.fillStyle=x.close>=x.open?'rgba(22,163,106,0.15)':'rgba(220,38,38,0.15)';ctx.fillRect(xp,h-vH,bw-1,vH)});
  ctx.font='7px monospace';ctx.textAlign='left';ctx.fillStyle='#2563eb';ctx.fillText('SMA20',40,h-2);ctx.fillStyle='#f59e0b';ctx.fillText('SMA50',75,h-2);ctx.fillStyle='#dc2626';ctx.fillText('SMA200',115,h-2);
}
function render360(d){
  var av=d.alphaview||{},as=d.alphascore||{},cf=d.confluence||{},sm=d.smart_money||{},pt=d.patterns||{};
  var s=av.summary||{},t=av.technicals||{},f=av.fundamentals||{},ma=av.moving_averages||{},r=av.ratings||{},rs=av.relative_strength||{},lv=av.levels||{};
  var chg=s.change_pct||0,chgC=chg>=0?'#16a34a':'#dc2626',chgS=chg>=0?'+':'';
  var gc={'A+':'#16a34a','A':'#16a34a','B+':'#16a34a','B':'#f59e0b','C':'#f59e0b','D':'#dc2626','F':'#dc2626'};
  var asC=gc[as.grade]||'#333';
  var ccM={'VERY_HIGH':'#16a34a','HIGH':'#16a34a','MODERATE':'#f59e0b','LOW':'#dc2626','VERY_LOW':'#dc2626'};
  var cfC=ccM[cf.conviction]||'#333';
  var vcM={'STRONG_ACCUMULATION':'#16a34a','ACCUMULATION':'#16a34a','NEUTRAL':'#f59e0b','DISTRIBUTION':'#dc2626','STRONG_DISTRIBUTION':'#dc2626'};
  var smC=vcM[sm.verdict]||'#333';
  var trend=r.trend||'NEUTRAL';var tC=trend.includes('BULL')?'#16a34a':trend.includes('BEAR')?'#dc2626':'#f59e0b';

  function bar(v){var p=Math.min(100,Math.max(0,v));var c=p>=60?'#16a34a':p>=40?'#f59e0b':'#dc2626';return '<div style="display:flex;align-items:center;gap:3px"><div style="flex:1;height:3px;background:#eee;border-radius:2px;overflow:hidden"><div style="width:'+p+'%;height:100%;background:'+c+'"></div></div><span style="font-size:10px;color:#666;min-width:20px;text-align:right">'+Math.round(v)+'</span></div>'}
  function kv(k,v,c){return '<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #f3f4f6"><span style="color:#666;font-size:10px">'+k+'</span><span style="font-size:11px;font-weight:600;color:'+(c||'#111')+';font-family:monospace">'+v+'</span></div>'}
  function pill(txt,col){return '<span style="display:inline-block;padding:1px 5px;border-radius:8px;font-size:8px;border:1px solid '+(col||'#dc2626')+';color:'+(col||'#dc2626')+';margin:1px">'+txt+'</span>'}
  function fmtN(n){if(!n&&n!==0)return'\u2014';if(typeof n==='number')return n.toLocaleString('en-IN',{maximumFractionDigits:1});return n}
  function fmtP(n){if(!n&&n!==0)return'\u2014';return(n>=0?'+':'')+Number(n).toFixed(1)+'%'}
  function fmtCr(n){if(!n)return'\u2014';if(n>1e9)return(n/1e7).toFixed(0)+'Cr';if(n>1e7)return(n/1e7).toFixed(0)+'Cr';return fmtN(n)}

  var h='<div id="s360-dashboard" style="font-family:Inter,system-ui,sans-serif;padding:16px;background:#fafbfc;border-radius:10px">';

  // HEADER
  h+='<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0 14px;border-bottom:3px solid #dc2626;margin-bottom:14px">';
  h+='<div style="display:flex;align-items:baseline;gap:10px"><span style="font-size:26px;font-weight:800;color:#111;letter-spacing:-0.5px">'+d.symbol+'</span><span style="font-size:11px;color:#666">'+(av.name||'')+'</span>';
  if(av.cap_segment)h+='<span style="font-size:8px;padding:2px 6px;border-radius:3px;background:#dc262615;color:#dc2626;font-weight:700">'+av.cap_segment+'</span>';
  h+='<span style="font-size:9px;color:#999">'+(av.sector||'')+' \u00B7 '+(av.industry||'')+'</span></div>';
  h+='<div style="display:flex;align-items:baseline;gap:8px"><span style="font-size:26px;font-weight:800;color:#111;letter-spacing:-0.5px">\u20B9'+fmtN(s.price)+'</span>';
  h+='<span style="font-size:13px;font-weight:700;color:'+chgC+'">'+chgS+fmtN(s.change)+' ('+chgS+fmtN(s.change_pct)+'%)</span>';
  h+='<span style="font-size:9px;color:#999">Vol:'+fmtN(s.volume)+' \u00B7 VR:'+fmtN(s.volume_ratio)+'x</span></div>';
  h+='<div style="display:flex;gap:4px"><button onclick="download360(\\x27pdf\\x27)" style="padding:6px 14px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#333;font-size:10px;cursor:pointer;font-weight:600;transition:all 0.2s">\u{1F4C4} PDF</button>';
  h+='<button onclick="download360(\\x27jpeg\\x27)" style="padding:6px 14px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#333;font-size:10px;cursor:pointer;font-weight:600;transition:all 0.2s">\u{1F4F7} IMAGE</button></div></div>';

  // CHART
  var cd=av.chart||[];
  h+='<div style="height:220px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.04)"><canvas id="s360chart" style="width:100%;height:100%"></canvas></div>';

  // STATS BAR
  h+='<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:3px;margin-bottom:6px">';
  [{l:'52W HI',v:'\u20B9'+fmtN(s.high_52w)},{l:'52W LO',v:'\u20B9'+fmtN(s.low_52w)},{l:'OFF HI',v:fmtP(s.off_high_pct),c:s.off_high_pct>=-5?'#16a34a':'#dc2626'},{l:'OFF LO',v:fmtP(s.off_low_pct)},{l:'MKTCAP',v:fmtCr(s.market_cap_cr)+'Cr'},{l:'BETA',v:fmtN(s.beta)},{l:'P/E',v:fmtN(f.pe_trailing)},{l:'P/B',v:fmtN(f.pb)}].forEach(function(st){
    h+='<div style="text-align:center;padding:8px 6px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,0.04)"><div style="font-size:8px;color:#888;text-transform:uppercase;font-weight:600;letter-spacing:0.5px">'+st.l+'</div><div style="font-size:11px;font-weight:700;color:'+(st.c||'#111')+';font-family:monospace">'+st.v+'</div></div>'});
  h+='</div>';

  // 3 INTELLIGENCE CARDS
  h+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">';
  // AlphaScore
  h+='<div style="padding:10px;border:1px solid #eee;border-radius:4px;background:#fff">';
  h+='<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.5px;font-weight:700">AlphaScore\u2122</span><span onclick="s360ShowInfo(\\x27alphascore\\x27)" style="cursor:pointer;color:#dc2626;font-size:10px">\u24D8</span></div>';
  h+='<div style="display:flex;align-items:baseline;gap:4px"><span style="font-size:28px;font-weight:800;color:'+asC+'">'+Math.round(as.alphascore||0)+'</span><span style="font-size:10px;color:'+asC+';font-weight:700">'+(as.grade||'')+' \u2022 '+(as.signal||'').replace(/_/g,' ')+'</span></div>';
  var dm=as.dimensions||{};h+=bar(dm.technical||0)+'<span style="font-size:7px;color:#999">TECH</span>'+bar(dm.fundamental||0)+'<span style="font-size:7px;color:#999">FUND</span>'+bar(dm.ownership||0)+'<span style="font-size:7px;color:#999">OWN</span>'+bar(dm.momentum||0)+'<span style="font-size:7px;color:#999">MOM</span>'+bar(dm.risk_alpha||0)+'<span style="font-size:7px;color:#999">RISK</span>';
  h+='</div>';
  // Confluence
  h+='<div style="padding:10px;border:1px solid #eee;border-radius:4px;background:#fff">';
  h+='<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.5px;font-weight:700">Confluence\u2122</span><span onclick="s360ShowInfo(\\x27confluence\\x27)" style="cursor:pointer;color:#dc2626;font-size:10px">\u24D8</span></div>';
  h+='<div style="display:flex;align-items:baseline;gap:4px"><span style="font-size:28px;font-weight:800;color:'+cfC+'">'+(cf.probability||0).toFixed(0)+'%</span><span style="font-size:10px;color:'+cfC+';font-weight:700">'+(cf.conviction||'').replace(/_/g,' ')+'</span></div>';
  h+='<div style="font-size:9px;color:#666;margin-bottom:3px">'+(cf.active_signal_count||0)+' signals \u00B7 '+(cf.category_diversity||0)+'/4 categories</div>';
  (cf.active_signals||[]).slice(0,6).forEach(function(sig){h+='<span style="display:inline-block;padding:1px 4px;border-radius:6px;font-size:7px;border:1px solid #dc262640;color:#dc2626;margin:1px">'+sig.name+'</span>'});
  if(cf.best_combination)h+='<div style="font-size:8px;color:#16a34a;margin-top:3px">'+cf.best_combination.hit_rate+'% hit \u00B7 '+cf.best_combination.sample_size+' samples</div>';
  h+='</div>';
  // Smart Money
  h+='<div style="padding:10px;border:1px solid #eee;border-radius:4px;background:#fff">';
  h+='<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.5px;font-weight:700">Smart Money\u2122</span><span onclick="s360ShowInfo(\\x27smartmoney\\x27)" style="cursor:pointer;color:#dc2626;font-size:10px">\u24D8</span></div>';
  h+='<div style="display:flex;align-items:baseline;gap:4px"><span style="font-size:28px;font-weight:800;color:'+smC+'">'+(sm.smart_money_score||0).toFixed(0)+'</span><span style="font-size:10px;color:'+smC+';font-weight:700">'+(sm.verdict||'').replace(/_/g,' ')+'</span></div>';
  var comp=sm.components||{};h+=bar(comp.accumulation||0)+'<span style="font-size:7px;color:#999">ACCUM</span>'+bar(comp.minervini||0)+'<span style="font-size:7px;color:#999">MINERV</span>'+bar(comp.volume_quality||0)+'<span style="font-size:7px;color:#999">VOL Q</span>';
  h+='</div></div>';

  // ROW 2: Technicals + Fundamentals + Patterns
  h+='<div style="display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:6px;margin-bottom:6px">';
  // Technicals
  h+='<div style="padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.04)">';
  h+='<div style="font-size:11px;color:#dc2626;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Technicals</div>';
  var rsiC=t.rsi>70?'#dc2626':t.rsi<30?'#16a34a':'#111';
  h+=kv('RSI',fmtN(t.rsi),rsiC)+kv('MACD',fmtN(t.macd),t.macd>t.macd_signal?'#16a34a':'#dc2626')+kv('MACD Signal',fmtN(t.macd_signal))+kv('ADX',fmtN(t.adx),t.adx>25?'#16a34a':'#999')+kv('Stoch %K/%D',fmtN(t.stoch_k)+'/'+fmtN(t.stoch_d))+kv('BB Width',fmtN(t.bb_width)+'%')+kv('ATR',fmtN(t.atr))+kv('Supertrend',t.supertrend_bullish?'\u25B2 BULL':'\u25BC BEAR',t.supertrend_bullish?'#16a34a':'#dc2626');
  h+='<div style="margin-top:3px;border-top:1px solid #eee;padding-top:3px">'+kv('SMA 20','\u20B9'+fmtN(ma.sma20),s.price>ma.sma20?'#16a34a':'#dc2626')+kv('SMA 50','\u20B9'+fmtN(ma.sma50),s.price>ma.sma50?'#16a34a':'#dc2626')+kv('SMA 200','\u20B9'+fmtN(ma.sma200),s.price>ma.sma200?'#16a34a':'#dc2626')+'</div></div>';
  // Fundamentals
  h+='<div style="padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.04)">';
  h+='<div style="font-size:11px;color:#dc2626;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Fundamentals</div>';
  h+=kv('EPS',fmtN(f.eps))+kv('P/E (TTM)',fmtN(f.pe_trailing))+kv('P/E (Fwd)',fmtN(f.pe_forward))+kv('P/B',fmtN(f.pb))+kv('ROE',fmtN(f.roe)+'%',f.roe>15?'#16a34a':f.roe>10?'#111':'#dc2626')+kv('ROCE',fmtN(f.roce)+'%')+kv('D/E',fmtN(f.debt_equity),f.debt_equity<0.5?'#16a34a':f.debt_equity<1?'#111':'#dc2626')+kv('Div Yield',fmtN(f.dividend_yield)+'%')+kv('Rev Growth',fmtN(f.revenue_growth)+'%',f.revenue_growth>10?'#16a34a':'#111')+kv('EPS Growth',fmtN(f.earnings_growth)+'%')+kv('Profit Margin',fmtN(f.profit_margin)+'%')+kv('Promoter %',fmtN(f.promoter_holding)+'%');
  h+='</div>';
  // Patterns
  h+='<div style="padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.04)">';
  h+='<div style="font-size:11px;color:#dc2626;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Patterns & Signals</div>';
  var pats=pt.patterns_detected||[];
  if(pats.length>0){pats.slice(0,4).forEach(function(p){var stC=p.status==='FORMING'?'#f59e0b':p.status==='CONFIRMED'?'#16a34a':'#dc2626';h+='<div style="padding:3px 5px;margin-bottom:3px;border:1px solid '+stC+'30;border-radius:3px"><div style="display:flex;justify-content:space-between"><span style="font-size:10px;font-weight:700;color:#111">'+p.name+'</span><span style="font-size:7px;padding:1px 3px;border-radius:2px;background:'+stC+'15;color:'+stC+'">'+p.status+'</span></div>';if(p.target)h+='<div style="font-size:8px;color:#16a34a">Target: \u20B9'+fmtN(p.target)+'</div>';h+='</div>'})}else h+='<div style="font-size:10px;color:#999;padding:4px 0">No chart patterns detected</div>';
  var sigs2=pt.signals||[];if(sigs2.length>0){h+='<div style="margin-top:4px;font-size:9px;color:#999;font-weight:700">SIGNALS</div><div style="margin-top:2px;line-height:1.8">';sigs2.slice(0,8).forEach(function(sg){var sgC=sg.type==='bullish'?'#16a34a':'#dc2626';h+='<span style="display:inline-block;padding:1px 4px;border-radius:6px;font-size:7px;border:1px solid '+sgC+'40;color:'+sgC+';margin:1px">'+(sg.name||sg)+'</span>'});h+='</div>'}
  if(lv.pivot){h+='<div style="margin-top:4px;font-size:9px;color:#999;font-weight:700">SUPPORT / RESISTANCE</div>'+kv('Pivot','\u20B9'+fmtN(lv.pivot))+kv('R1 / R2','\u20B9'+fmtN(lv.r1)+' / \u20B9'+fmtN(lv.r2),'#16a34a')+kv('S1 / S2','\u20B9'+fmtN(lv.s1)+' / \u20B9'+fmtN(lv.s2),'#dc2626')}
  h+='</div></div>';

  // ROW 2.5: Snapshot + Narrative + Verdict
  h+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">';
  h+='<div style="padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.04)"><div style="font-size:11px;color:#dc2626;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Fundamental Snapshot</div>';
  var snap='';var pe=f.pe_trailing||0,pf=f.pe_forward||0,pb_r=f.pb||0,roe=f.roe||0,rg=f.revenue_growth||0,eg=f.earnings_growth||0,pm=f.profit_margin||0,om=f.operating_margin||0,ph=f.promoter_holding||0,dy=f.dividend_yield||0,de=f.debt_equity||0,eps_v=f.eps||0,bv=f.book_value||0,dr=f.dividend_rate||0;
  var rsn=d.alphaview&&d.alphaview.relative_strength?d.alphaview.relative_strength:{};
  snap+=d.symbol+' trades at a ';
  if(pe>0){if(pe<15)snap+='cheap valuation with a trailing P/E of '+fmtN(pe);else if(pe<25)snap+='fair valuation with a trailing P/E of '+fmtN(pe);else snap+='premium valuation with a trailing P/E of '+fmtN(pe);if(pf>0)snap+=' (forward P/E '+fmtN(pf)+', suggesting '+(pf<pe?'earnings expansion ahead':'earnings pressure')+')';snap+='. ';}
  if(roe>0||pm>0){snap+='On profitability, ';if(roe>0){snap+='ROE of '+fmtN(roe)+'% is ';if(roe>20)snap+='excellent, indicating efficient capital deployment';else if(roe>15)snap+='healthy';else if(roe>10)snap+='acceptable but not outstanding';else snap+='below average, suggesting inefficient capital usage';}snap+='. ';if(pm>0)snap+='Profit margin of '+fmtN(pm)+'%'+(om>0?' (operating margin '+fmtN(om)+'%)':'')+' is '+(pm>20?'robust':pm>10?'moderate':'thin, indicating limited pricing power')+'. ';}
  if(rg||eg){snap+='Growth trajectory shows ';var gp=[];if(rg)gp.push('revenue '+(rg>0?'expanding':'contracting')+' at '+fmtN(Math.abs(rg))+'% YoY');if(eg)gp.push('EPS growth of '+fmtN(eg)+'%'+(eg>25?' (accelerating)':eg>0?' (steady)':' (declining)'));snap+=gp.join(' with ')+'. ';if(eps_v>0)snap+='Trailing EPS stands at \u20B9'+fmtN(eps_v)+'. ';}
  snap+='Balance sheet ';if(de>0){if(de<10)snap+='is clean with minimal debt (D/E '+fmtN(de)+'). ';else if(de<50)snap+='carries moderate leverage (D/E '+fmtN(de)+'). ';else snap+='is heavily leveraged (D/E '+fmtN(de)+'). ';}else snap+='appears debt-free. ';
  if(ph>0){snap+='Promoter holds '+fmtN(ph)+'% '+(ph>60?'\u2014 strong skin in the game. ':ph>40?'\u2014 moderate conviction. ':'\u2014 relatively low. ');}
  if(dy>0)snap+='Dividend yield of '+fmtN(dy)+'%'+(dr>0?' (\u20B9'+fmtN(dr)+'/share)':'')+' '+(dy>3?'is attractive for income investors. ':dy>1?'provides modest income. ':'is nominal. ');
  if(rsn.rs_1m!==undefined){var p1m=rsn.rs_1m||0,p3m=rsn.rs_3m||0;snap+='vs NIFTY: '+(p1m>0?'outperforming':'underperforming')+' by '+Math.abs(p1m).toFixed(1)+'% (1M), '+Math.abs(p3m).toFixed(1)+'% (3M). ';}
  h+='<div style="font-size:11px;color:#333;line-height:1.5">'+snap+'</div></div>';
  // Narrative
  h+='<div style="padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.04)"><div style="font-size:11px;color:#dc2626;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Technical Narrative</div>';
  var tn=pt.narrative||'';if(!tn){tn=d.symbol+' trading at \u20B9'+fmtN(s.price)+'. RSI '+fmtN(t.rsi)+(t.rsi>70?' (overbought)':t.rsi<30?' (oversold)':t.rsi>50?' (bullish)':' (bearish)')+'. MACD '+(t.macd>t.macd_signal?'above':'below')+' signal. '+(ma.above_200dma?'Above':'Below')+' 200 DMA. Supertrend '+(t.supertrend_bullish?'bullish.':'bearish.')}
  h+='<div style="font-size:11px;color:#444;line-height:1.7">'+tn+'</div></div>';
  // Verdict
  h+='<div style="padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.04)"><div style="font-size:11px;color:#dc2626;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Verdict</div>';
  var ptScore=pt.score||0;var bullSig=pt.bullish_signals||0;var bearSig=pt.bearish_signals||0;
  h+='<div style="text-align:center;margin:6px 0"><span style="font-size:14px;font-weight:800;color:'+tC+'">Score: '+ptScore+'</span></div>';
  h+='<div style="display:flex;justify-content:center;gap:10px;font-size:10px"><span style="color:#16a34a">Bull: '+bullSig+'</span><span style="color:#dc2626">Bear: '+bearSig+'</span></div>';
  h+='<div style="text-align:center;font-size:12px;font-weight:700;color:'+tC+';margin-top:4px">'+trend+'</div></div></div>';

  // ROW 3: RS + Assessment + Intelligence Summary
  h+='<div style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:10px;margin-bottom:12px">';
  // RS
  h+='<div style="padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.04)"><div style="font-size:11px;color:#dc2626;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Relative Strength vs Nifty</div>';
  h+=kv('1M RS',fmtP(rs.rs_1m),rs.rs_1m>0?'#16a34a':'#dc2626')+kv('3M RS',fmtP(rs.rs_3m),rs.rs_3m>0?'#16a34a':'#dc2626')+kv('6M RS',fmtP(rs.rs_6m),rs.rs_6m>0?'#16a34a':'#dc2626')+kv('1Y RS',fmtP(rs.rs_1y),rs.rs_1y>0?'#16a34a':'#dc2626');
  var sr=rs.stock_return||{},nr=rs.nifty_return||{};h+='<div style="margin-top:3px;font-size:8px;color:#999">Stock: '+fmtP(sr['1m'])+' / '+fmtP(sr['3m'])+' / '+fmtP(sr['1y'])+'<br>Nifty: '+fmtP(nr['1m'])+' / '+fmtP(nr['3m'])+' / '+fmtP(nr['1y'])+'</div></div>';
  // Assessment
  var assess=av.assessment||{};if(!assess.value&&r){assess={value:{score:Math.round((r.fundamentals||50)*0.7+(r.accumulation||50)*0.3),label:r.fundamentals>70?'STRONG VALUE':r.fundamentals>50?'VALUE':'EXPENSIVE'},growth:{score:Math.round((r.momentum||50)*0.5+(r.trend_rating||50)*0.5),label:r.momentum>70?'HIGH GROWTH':r.momentum>50?'GROWTH':'MODERATE'},quality:{score:Math.round((r.fundamentals||50)*0.4+(r.accumulation||50)*0.3+(r.sentiment||50)*0.3),label:r.fundamentals>60?'QUALITY':'AVERAGE'}}}
  h+='<div style="padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.04)"><div style="font-size:11px;color:#dc2626;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Assessment</div>';
  h+='<div style="display:flex;gap:6px;text-align:center;margin-bottom:4px">';
  ['value','growth','quality'].forEach(function(k){var v=assess[k]||{};var sc=v.score||0;var lb=v.label||'\u2014';var c2=sc>=70?'#16a34a':sc>=40?'#f59e0b':'#dc2626';h+='<div style="flex:1;padding:4px;border:1px solid '+c2+'30;border-radius:3px"><div style="font-size:8px;color:#888;text-transform:uppercase;font-weight:600">'+k+'</div><div style="font-size:16px;font-weight:800;color:'+c2+'">'+sc+'</div><div style="font-size:7px;color:'+c2+'">'+lb+'</div></div>'});
  h+='</div>'+kv('Momentum',r.momentum+'/100')+kv('Fundamentals',r.fundamentals+'/100')+kv('Accumulation',r.accumulation+'/100')+kv('Trend',r.trend_rating+'/100')+kv('Sentiment',r.sentiment+'/100')+'</div>';
  // Intelligence Summary
  var asc2=as.alphascore||0,prob=cf.probability||0,sms=sm.smart_money_score||0;
  h+='<div style="padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.04)"><div style="font-size:11px;color:#dc2626;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">\u{1F3AF} Intelligence Summary</div>';
  h+='<div style="font-size:11px;color:#333;line-height:1.6"><b>'+d.symbol+'</b> ';
  if(asc2>=70)h+='is in <b style="color:#16a34a">strong shape</b> (AlphaScore '+Math.round(asc2)+'). ';else if(asc2>=60)h+='shows <b style="color:#16a34a">above-average</b> characteristics ('+Math.round(asc2)+'). ';else if(asc2>=50)h+='is in <b style="color:#f59e0b">neutral territory</b> ('+Math.round(asc2)+'). ';else if(asc2>=40)h+='is showing <b style="color:#dc2626">weakness</b> ('+Math.round(asc2)+'). ';else h+='is in <b style="color:#dc2626">poor shape</b> ('+Math.round(asc2)+'). ';
  if(prob>=70)h+='<b style="color:#16a34a">High confluence</b> ('+prob.toFixed(0)+'%). ';else if(prob>=50)h+='Moderate confluence ('+prob.toFixed(0)+'%). ';
  if(sms>=60)h+='Smart money accumulating. ';else if(sms>=40)h+='Smart money neutral. ';else h+='<b style="color:#dc2626">Smart money distributing.</b> ';
  h+='</div>';
  h+='<div style="margin-top:6px;padding:6px;border-radius:3px;font-size:11px;font-weight:600;';
  if(asc2>=60&&prob>=60)h+='background:#16a34a10;border:1px solid #16a34a30;color:#16a34a">SIGNAL: Consider entering with proper sizing and stop loss.';
  else if(asc2>=60)h+='background:#f59e0b10;border:1px solid #f59e0b30;color:#f59e0b">SIGNAL: Add to watchlist. Wait for confluence trigger.';
  else if(asc2<50&&prob>=60)h+='background:#f59e0b10;border:1px solid #f59e0b30;color:#dc2626">SIGNAL: Potential bounce \u2014 risky. Tight stops only.';
  else if(asc2<40)h+='background:#dc262610;border:1px solid #dc262630;color:#dc2626">SIGNAL: Avoid new positions.';
  else h+='background:#f59e0b10;border:1px solid #f59e0b30;color:#f59e0b">SIGNAL: Wait for clarity. Mixed signals.';
  h+='</div>';
  h+='<div style="font-size:7px;color:#999;margin-top:4px">AlphaScore\u2122, Confluence Engine\u2122, Smart Money Flow\u2122 are proprietary metrics by AlphaMarket. Patent Pending. Not investment advice.</div></div></div>';

  // WHAT THIS MEANS
  h+='<div style="padding:8px;border:1px solid #eee;border-radius:4px;background:#fff;margin-bottom:4px">';
  h+='<div style="font-size:12px;font-weight:700;color:#dc2626;margin-bottom:6px">\u{1F4CA} What This Means for '+d.symbol+'</div>';
  h+='<div style="font-size:11px;color:#333;line-height:1.7">';
  h+='<b>Overall Health (AlphaScore '+Math.round(asc2)+'/100)</b> <span onclick="s360ShowInfo(\\x27alphascore\\x27)" style="color:#dc2626;cursor:pointer;font-size:10px">\u24D8</span>: ';
  if(asc2>=60)h+=d.symbol+' shows above-average characteristics. Most dimensions positive. ';else if(asc2>=50)h+=d.symbol+' is in neutral territory. Mixed signals. ';else h+=d.symbol+' is showing weakness. Caution advised. ';
  var dm2=as.dimensions||{};var bk=Object.keys(dm2);if(bk.length){var best=bk.reduce(function(a,b){return dm2[a]>dm2[b]?a:b});var worst=bk.reduce(function(a,b){return dm2[a]<dm2[b]?a:b});var dn={technical:"Technical",fundamental:"Fundamental",ownership:"Ownership",momentum:"Momentum",risk_alpha:"Risk"};h+='Strongest: <b style="color:#16a34a">'+dn[best]+' ('+dm2[best].toFixed(0)+')</b>. Weakest: <b style="color:#dc2626">'+dn[worst]+' ('+dm2[worst].toFixed(0)+')</b>. '}
  h+='</div>';
  h+='<div style="font-size:11px;color:#333;line-height:1.7;margin-top:6px"><b>Signal Confluence ('+prob.toFixed(0)+'%)</b> <span onclick="s360ShowInfo(\\x27confluence\\x27)" style="color:#dc2626;cursor:pointer;font-size:10px">\u24D8</span>: ';
  if(prob>=70)h+='<b style="color:#16a34a">Multiple signals firing simultaneously</b>. '+(cf.active_signal_count||0)+' signals across '+(cf.category_diversity||0)+' categories. ';
  else if(prob>0)h+='Moderate/weak confluence. Monitor for more alignment. ';
  else h+='No signals active. ';h+='</div>';
  h+='<div style="font-size:11px;color:#333;line-height:1.7;margin-top:6px"><b>Smart Money ('+sms.toFixed(0)+'/100)</b> <span onclick="s360ShowInfo(\\x27smartmoney\\x27)" style="color:#dc2626;cursor:pointer;font-size:10px">\u24D8</span>: ';
  if(sms>=60)h+='Institutions accumulating. ';else if(sms>=40)h+='Neutral institutional activity. ';else h+='<b style="color:#dc2626">Smart money distributing.</b> ';
  h+='</div></div>';

  h+='</div>'; // close dashboard
  document.getElementById('s360-content').innerHTML=h;
  setTimeout(function(){draw360Chart('s360chart',cd,s.price||0)},100);
}
window.download360=function download360(type){
  var el=document.getElementById('s360-dashboard');if(!el){alert('Analyze a stock first');return}
  var wmEl=document.getElementById('s360-whatmeans');
  var includeNarrative=true;
  if(wmEl){includeNarrative=confirm('Include "What This Means" section?\n\nOK = include\nCancel = exclude');if(!includeNarrative)wmEl.style.display='none';}
  function doCapture(){html2canvas(el,{backgroundColor:'#ffffff',scale:2,useCORS:true}).then(function(canvas){if(wmEl&&!includeNarrative)wmEl.style.display='';var sym=document.getElementById('s360-sym').value.toUpperCase();var dt=new Date().toISOString().slice(0,10);if(type==='pdf'){function makePdf(){var img=canvas.toDataURL('image/jpeg',0.95);var w=canvas.width,h=canvas.height;var pW=w*0.264583,pH=h*0.264583;var pdf=new window.jspdf.jsPDF({orientation:pW>pH?'l':'p',unit:'mm',format:[pW,pH]});pdf.addImage(img,'JPEG',0,0,pW,pH);pdf.save('Stock360_'+sym+'_'+dt+'.pdf')}if(typeof window.jspdf==='undefined'){var s=document.createElement('script');s.src='https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js';s.onload=makePdf;document.head.appendChild(s)}else makePdf()}else{var a=document.createElement('a');a.href=canvas.toDataURL('image/jpeg',0.95);a.download='Stock360_'+sym+'_'+dt+'.jpg';a.click()}})}
  if(typeof html2canvas==='undefined'){var s=document.createElement('script');s.src='https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js';s.onload=doCapture;document.head.appendChild(s)}else doCapture()
}


// Event delegation for Stock 360 buttons (fallback for inline onclick)
document.addEventListener('click', function(e){
  var t = e.target;
  // Check for PDF/Image buttons
  if(t.textContent && t.textContent.indexOf('PDF') !== -1 && t.closest && t.closest('#s360-dashboard')){
    e.preventDefault(); window.download360('pdf'); return;
  }
  if(t.textContent && t.textContent.indexOf('IMAGE') !== -1 && t.closest && t.closest('#s360-dashboard')){
    e.preventDefault(); window.download360('jpeg'); return;
  }
  // Check for info buttons (circled i)
  var infoBtn = t.closest ? t.closest('[onclick*="s360ShowInfo"]') : null;
  if(infoBtn){
    var m = infoBtn.getAttribute('onclick');
    if(m && m.indexOf('alphascore') !== -1) window.s360ShowInfo('alphascore');
    else if(m && m.indexOf('confluence') !== -1) window.s360ShowInfo('confluence');
    else if(m && m.indexOf('smartmoney') !== -1) window.s360ShowInfo('smartmoney');
    return;
  }
  // Scanner info buttons
  var scanBtn = t.closest ? t.closest('[onclick*="showScannerInfo"]') : null;
  if(scanBtn){
    var m2 = scanBtn.getAttribute('onclick');
    if(m2 && m2.indexOf('arb') !== -1 && typeof showScannerInfo === 'function') showScannerInfo('arb');
    else if(m2 && m2.indexOf('job') !== -1 && typeof showScannerInfo === 'function') showScannerInfo('job');
    else if(m2 && m2.indexOf('scal') !== -1 && typeof showScannerInfo === 'function') showScannerInfo('scal');
    return;
  }
});

// Add publish button to Stock 360 header
document.addEventListener('click', function(e){
  var dashboard = document.getElementById('s360-dashboard');
  if(!dashboard) return;
  if(!window._isAmAdvisor) return;
  if(document.getElementById('s360-pub-btn')) return;
  var headerDiv = dashboard.querySelector('div > div:last-child');
  if(headerDiv && headerDiv.querySelector('button')){
    var pb = document.createElement('button');
    pb.id = 's360-pub-btn';
    pb.style.cssText = 'padding:6px 14px;border:1px solid var(--accent);border-radius:6px;background:rgba(220,38,38,0.08);color:var(--accent);font-size:10px;cursor:pointer;font-weight:600;margin-left:4px';
    pb.textContent = 'Publish';
    pb.onclick = function(ev){
      ev.stopPropagation();
      var symEl = dashboard.querySelector('[style*="font-size:26px"]') || dashboard.querySelector('[style*="font-size:22px"]');
      var sym = symEl ? symEl.textContent.trim() : '';
      var priceEls = dashboard.querySelectorAll('[style*="font-weight:800"]');
      var price = 0;
      for(var i=0;i<priceEls.length;i++){var m=priceEls[i].textContent.match(/[\d,.]+/);if(m&&parseFloat(m[0].replace(/,/g,''))>10){price=parseFloat(m[0].replace(/,/g,''));break;}}
      if(sym && typeof openPublish === 'function') openPublish(sym, price, 'Stock 360 Analysis', false);
    };
    headerDiv.appendChild(pb);
  }
});

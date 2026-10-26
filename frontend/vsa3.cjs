const puppeteer=require('C:/Users/MANIVEL M/AppData/Local/Temp/ptst/node_modules/puppeteer-core');
const CHROME='C:/Users/MANIVEL M/.cache/puppeteer/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe';
const APP='http://localhost:5410';
const {token,user}=require('./stok.json');
let pass=0,fail=0;
const ok=(c,m,d)=>{ if(c){pass++;console.log('PASS  '+m+(d?'   :: '+d:''));} else {fail++;console.log('FAIL  '+m+(d?'   :: '+d:''));} };
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
  const p=await b.newPage();
  const errs=[];
  p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.setViewport({width:1440,height:1000});
  await p.evaluateOnNewDocument((t,u)=>{localStorage.setItem('token',t);localStorage.setItem('user',JSON.stringify(u));},token,user);

  await p.goto(APP+'/student/analysis',{waitUntil:'networkidle2',timeout:60000});
  await wait(5000);

  const r=await p.evaluate(()=>{
    const q=s=>document.querySelectorAll(s).length;
    const txt=document.body.innerText;
    return {
      url: location.pathname,
      evalBar: q('.eval-bar-wrap')+q('.eval-black-fill')+q('.eval-white-fill')+q('.eval-marker'),
      gameAnalysisSection: /Game Analysis/.test(txt),
      threeLines: /Max 5s . 3 lines/.test(txt),
      linesHeader: /Lines \(/.test(txt),
      playBest: /Play best|Play \w{2,}/.test(txt) && !!document.querySelector('button'),
      sections: [...document.querySelectorAll('.ab-section-head')].map(x=>x.textContent.trim()),
      boardSquares: q('[data-square]')+q('.chess-square')+q('td'),
    };
  });
  ok(r.url==='/student/analysis','Play Arena page loads',r.url);
  ok(r.evalBar===0,'no eval bar / black-white pipe beside the board',String(r.evalBar));
  ok(!r.gameAnalysisSection,'"Game Analysis" section removed');
  ok(!r.threeLines,'three-line engine indicator removed');
  ok(!r.linesHeader,'"Lines (…)" engine readout removed');
  console.log('      sections now: '+r.sections.join(' | '));
  ok(!r.sections.some(s=>/Game Analysis/i.test(s)),'section list has no Game Analysis',r.sections.length+' sections');
  ok(r.sections.some(s=>/Engine/i.test(s)),'Engine section itself retained',r.sections.find(s=>/Engine/i.test(s)));

  // board still renders and is interactive
  await p.screenshot({path:'arena.png'});
  console.log('page errors: '+errs.length+(errs.length?' :: '+errs.join(' | '):''));
  ok(errs.length===0,'no page errors');
  console.log('RESULT '+(pass+fail)+' :: '+pass+' passed, '+fail+' failed');
  await b.close();
})().catch(e=>{console.log('FATAL '+e.message);process.exit(1);});

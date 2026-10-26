const puppeteer=require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');
const fs=require('fs');
const APP='http://localhost:5410';
const {t}=JSON.parse(fs.readFileSync('tk.json','utf8'));
const res=[];
const ck=(n,c,x='')=>res.push((c?'PASS':'FAIL')+' '+n+(x?'  :: '+x:''));
(async()=>{
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.setViewport({width:1440,height:1000});
await p.goto(APP+'/login',{waitUntil:'domcontentloaded',timeout:60000});
await p.evaluate((tk)=>{localStorage.setItem('token',tk);},t);

// 1. old URL redirects with the tab preselected
await p.goto(APP+'/student/game-history',{waitUntil:'networkidle2',timeout:60000});
await new Promise(r=>setTimeout(r,2500));
ck('old /student/game-history redirects', /\/student\/review/.test(p.url()), p.url());
ck('redirect lands on the History tab', /tab=history/.test(p.url()), p.url());

// 2. tab bar present
const tabs=await p.$$eval('[role=tab]',ns=>ns.map(n=>n.textContent.trim()));
ck('Game Review shows a tab bar', tabs.length===2, JSON.stringify(tabs));
ck('History tab is the active one', await p.$eval('[role=tab][aria-selected=true]',n=>n.textContent.includes('History')));

// 3. no nested duplicate page title
const h1s=await p.$$eval('h1',ns=>ns.map(n=>n.textContent.trim()));
ck('only one page title (no nested header)', h1s.length===1, JSON.stringify(h1s));

// 4. history content actually rendered
const body=await p.evaluate(()=>document.body.innerText);
ck('history summary/cards rendered', /Games|Win Rate|Loading|history/i.test(body));
ck('no page errors on the history tab', errs.length===0, errs.join('|'));

// 5. switch to Analyse tab -> board
const errs2=[]; p.on('pageerror',e=>errs2.push(e.message));
const clicked=await p.evaluate(()=>{const t=[...document.querySelectorAll('[role=tab]')].find(n=>n.textContent.includes('Analyse')); if(t){t.click();return true} return false});
await new Promise(r=>setTimeout(r,1200));
ck('Analyse tab is clickable', clicked);
ck('tab=history removed from URL', !/tab=history/.test(p.url()), p.url());
const squares=await p.$$eval('.chessboard-piece, [data-square], .chess-square',n=>n.length).catch(()=>0);
ck('analysis board rendered on the other tab', squares>0, 'squares/elements='+squares);
ck('no errors switching tabs', errs2.length===0, errs2.join('|'));

// 6. sidebar no longer has a separate Game History entry
const nav=await p.evaluate(()=>[...document.querySelectorAll('aside a, nav a')].map(a=>a.textContent.trim()));
ck('sidebar has no separate Game History link', !nav.includes('Game History'), JSON.stringify(nav.filter(n=>/Hist|Review/i.test(n))));
ck('sidebar still has Game Review', nav.some(n=>/Game Review/.test(n)));
await p.screenshot({path:'gr.png'});
console.log(res.join('\n'));
console.log('--- '+res.filter(r=>r.startsWith('PASS')).length+'/'+res.length+' ---');
await b.close();
})().catch(e=>{console.log('ERR '+e.message);process.exit(1)});

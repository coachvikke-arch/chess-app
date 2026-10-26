const puppeteer=require('C:/Users/MANIVEL M/AppData/Local/Temp/ptst/node_modules/puppeteer-core');
const CHROME='C:/Users/MANIVEL M/.cache/puppeteer/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe';
const APP=process.env.APP_URL||'http://localhost:5410';
const {token,user}=require('./tok.json');
let pass=0,fail=0;
const ok=(c,m,d)=>{ if(c){pass++;console.log('PASS  '+m+(d?'   :: '+d:''));} else {fail++;console.log('FAIL  '+m+(d?'   :: '+d:''));} };
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
  const p=await b.newPage();
  const errs=[];
  p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.setViewport({width:1440,height:900});
  // seed auth before any app script runs
  await p.evaluateOnNewDocument((t,u)=>{
    localStorage.setItem('token',t);
    localStorage.setItem('user',JSON.stringify(u));
  },token,user);

  // ---- login lands on the dashboard, not /super
  await p.goto(APP+'/login',{waitUntil:'networkidle2',timeout:45000}).catch(e=>console.log('goto: '+e.message));
  await wait(1500);
  await p.goto(APP+'/',{waitUntil:'networkidle2',timeout:45000}).catch(e=>{});
  await wait(2500);
  const dashLink=await p.evaluate(()=>{const a=[...document.querySelectorAll('a')].find(x=>/Dashboard/i.test(x.textContent));return a?a.getAttribute('href'):null;});
  ok(dashLink==='/admin/dashboard','Dashboard link points at the admin dashboard',String(dashLink));

  // ---- homeForRole drives the post-login target
  const home=await p.evaluate(async()=>{const m=await import('/src/utils/roles.js');return {super:m.homeForRole('superadmin'),admin:m.homeForRole('admin'),stu:m.homeForRole('student')};});
  ok(home.super==='/admin/dashboard','homeForRole(superadmin) = /admin/dashboard',JSON.stringify(home));
  ok(home.stu==='/student/dashboard','homeForRole(student) unchanged',home.stu);

  // ---- Super Admin sections
  await p.goto(APP+'/super',{waitUntil:'networkidle2',timeout:45000});
  await wait(3000);
  const secs=await p.$$eval('.perm-tab',n=>n.map(x=>x.textContent.trim()));
  ok(secs.some(t=>/Register account/i.test(t)),'Super Admin has a Register-account section',secs.join(' | '));
  ok(secs.some(t=>/Feature Access/i.test(t)),'Super Admin has a Feature Access section');

  const clicked=await p.evaluate(()=>{const x=[...document.querySelectorAll('.perm-tab')].find(e=>/Feature Access/i.test(e.textContent));if(x){x.click();return true;}return false;});
  await wait(3000);
  ok(clicked,'Feature Access section opens');

  const toggles=await p.$$eval('[role="switch"]',n=>n.length);
  ok(toggles>=30,'toggles render inside Super Admin',String(toggles));
  const inner=await p.$$eval('.perm-tab',n=>n.map(x=>x.textContent.trim()));
  ok(inner.some(t=>/Role Access/i.test(t)),'inner Role Access tab present');
  ok(inner.some(t=>/User Overrides/i.test(t)),'inner User Overrides tab present');
  ok(inner.some(t=>/Audit Log/i.test(t)),'inner Audit Log tab present');
  const rows=await p.$$eval('.perm-row:not(.perm-row--head)',n=>n.length).catch(()=>0);
  ok(rows>=18,'18 feature rows render',String(rows));
  ok(await p.evaluate(()=>[...document.querySelectorAll('button')].some(x=>/Enable all/.test(x.textContent))),'bulk actions present');
  ok(await p.evaluate(()=>!!document.querySelector('input[placeholder*="Name, key"]')),'feature search present');

  // ---- old route redirect
  await p.goto(APP+'/super/features',{waitUntil:'networkidle2',timeout:30000});
  await wait(2000);
  ok(/\/super\/?(\?|$)/.test(p.url())&&!/\/super\/features/.test(p.url()),'/super/features redirects into /super',p.url());

  // ---- sidebar no longer lists a separate Feature Access entry
  await p.goto(APP+'/admin/dashboard',{waitUntil:'networkidle2',timeout:45000});
  await wait(2500);
  const nav=await p.$$eval('nav a',n=>n.map(x=>x.textContent.trim()));
  ok(!nav.some(t=>/Feature Access/i.test(t)),'sidebar has no separate Feature Access entry',nav.filter(t=>/Super|Feature/i.test(t)).join(' | '));
  ok(nav.some(t=>/Super Admin/i.test(t)),'sidebar still lists Super Admin');

  console.log('page errors: '+errs.length+(errs.length?' :: '+errs.join(' | '):''));
  ok(errs.length===0,'no page errors');
  console.log('RESULT '+(pass+fail)+' :: '+pass+' passed, '+fail+' failed');
  await b.close();
})().catch(e=>{console.log('FATAL '+e.message);process.exit(1);});

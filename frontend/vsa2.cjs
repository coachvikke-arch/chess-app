const puppeteer=require('C:/Users/MANIVEL M/AppData/Local/Temp/ptst/node_modules/puppeteer-core');
const CHROME='C:/Users/MANIVEL M/.cache/puppeteer/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe';
const APP='http://localhost:5410';
const {token,user}=require('./tok.json');
let pass=0,fail=0;
const ok=(c,m,d)=>{ if(c){pass++;console.log('PASS  '+m+(d?'   :: '+d:''));} else {fail++;console.log('FAIL  '+m+(d?'   :: '+d:''));} };
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
  const p=await b.newPage();
  await p.setViewport({width:1440,height:900});
  await p.evaluateOnNewDocument((t,u)=>{localStorage.setItem('token',t);localStorage.setItem('user',JSON.stringify(u));},token,user);

  // the real post-login destination, as a coach/admin sees it from the app header
  await p.goto(APP+'/admin/dashboard',{waitUntil:'networkidle2',timeout:45000});
  await wait(3000);
  const info=await p.evaluate(()=>{
    const links=[...document.querySelectorAll('a')];
    const dash=links.find(a=>/Dashboard/i.test(a.textContent));
    return { href: dash?dash.getAttribute('href'):null, text: dash?dash.textContent.trim():null, url: location.pathname };
  });
  ok(info.href==='/admin/dashboard','header Dashboard link -> /admin/dashboard',JSON.stringify(info));
  ok(info.url==='/admin/dashboard','superadmin lands on the admin dashboard',info.url);

  // a wrong-role visit should bounce superadmin to the dashboard, not /super
  await p.goto(APP+'/student/dashboard',{waitUntil:'networkidle2',timeout:45000});
  await wait(2500);
  ok(!/\/student\//.test(p.url()),'superadmin on a student URL is redirected away',p.url());

  console.log('RESULT '+(pass+fail)+' :: '+pass+' passed, '+fail+' failed');
  await b.close();
})().catch(e=>{console.log('FATAL '+e.message);process.exit(1);});

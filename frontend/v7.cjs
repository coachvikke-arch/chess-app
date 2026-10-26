const puppeteer=require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');
const fs=require('fs');
const {t,email,role,name}=JSON.parse(fs.readFileSync('tk2.json','utf8'));
(async()=>{
 const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
 const p=await b.newPage();
 const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.setViewport({width:1440,height:1100});
 await p.goto('http://localhost:5380/',{waitUntil:'domcontentloaded'});
 await p.evaluate((a)=>{localStorage.setItem('token',a.t);localStorage.setItem('user',JSON.stringify({email:a.email,role:a.role,name:a.name}));},{t,email,role,name});
 await p.goto('http://localhost:5380/student/settings',{waitUntil:'networkidle2'});
 await new Promise(r=>setTimeout(r,2500));
 const r=await p.evaluate(()=>{
   const m=document.body.innerText.match(/Live preview · (.+)/);
   const sq=[...document.querySelectorAll('div')].filter(d=>d.style.backgroundColor);
   return {preview:m?m[1]:null, hasIceOption:document.body.innerText.includes('\nIce\n')};
 });
 console.log('user has board_theme=ice saved');
 console.log('  preview now renders ->',r.preview);
 console.log('  "Ice" still offered? ->',r.hasIceOption,'(expected false)');
 console.log('  page errors ->',errs.length);
 await b.close();
})().catch(e=>{console.log('FAIL',e.message);process.exit(1);});

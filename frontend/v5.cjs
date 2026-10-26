const puppeteer=require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');
const fs=require('fs');
const {t,email}=JSON.parse(fs.readFileSync('tk.json','utf8'));
(async()=>{
 const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
 const p=await b.newPage();
 await p.setViewport({width:1440,height:1200});
 await p.goto('http://localhost:5380/',{waitUntil:'domcontentloaded'});
 await p.evaluate((tok,em)=>{localStorage.setItem('token',tok);localStorage.setItem('user',JSON.stringify({email:em,role:'student',name:'Manivel'}));},t,email);
 await p.goto('http://localhost:5380/settings',{waitUntil:'networkidle2'});
 await new Promise(r=>setTimeout(r,3000));
 console.log('--- first 900 chars of body text ---');
 console.log((await p.evaluate(()=>document.body.innerText)).slice(0,900));
 await b.close();
})().catch(e=>{console.log('FAIL',e.message);process.exit(1);});

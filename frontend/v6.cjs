const puppeteer=require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');
const fs=require('fs');
const {t,email}=JSON.parse(fs.readFileSync('tk.json','utf8'));
(async()=>{
 const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
 const p=await b.newPage();
 const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.setViewport({width:1440,height:1100});
 await p.goto('http://localhost:5380/',{waitUntil:'domcontentloaded'});
 await p.evaluate((tok,em)=>{localStorage.setItem('token',tok);localStorage.setItem('user',JSON.stringify({email:em,role:'student',name:'Manivel'}));},t,email);
 await p.goto('http://localhost:5380/student/settings',{waitUntil:'networkidle2'});
 await new Promise(r=>setTimeout(r,2500));
 const r=await p.evaluate(()=>{
   const titles=[...document.querySelectorAll('button[title]')].map(b=>b.getAttribute('title'));
   const pieces=titles.filter(t=>['Classic','Wood','Glass','Metal','Cburnett','Unicode','Merida','Emerald','Emerald Black'].includes(t));
   const boards=titles.filter(t=>t.match(/Green|Brown|Ocean|Wood|Mode|Jade|Emerald|Contrast|Faded|Ice|Coral|Marble/));
   return {pieceCount:pieces.length,pieces,boardCount:boards.length,boards};
 });
 console.log('PIECES',r.pieceCount,JSON.stringify(r.pieces));
 console.log('BOARDS',r.boardCount,JSON.stringify(r.boards));
 // click through the piece carousel to prove nav still cycles cleanly
 const before=r.pieces.length;
 await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Next');b&&b.click();});
 await new Promise(r=>setTimeout(r,1500));
 const after=await p.evaluate(()=>{const m=document.body.innerText.match(/Live preview · (.+)/);return m?m[1]:null;});
 console.log('after one Next ->',after);
 await p.screenshot({path:'st.png',clip:{x:0,y:150,width:1440,height:900}});
 console.log('errors',errs.length,errs.slice(0,2));
 await b.close();
})().catch(e=>{console.log('FAIL',e.message);process.exit(1);});

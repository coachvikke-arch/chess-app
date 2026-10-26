const puppeteer=require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');
const fs=require('fs');
const {t}=JSON.parse(fs.readFileSync('tk.json','utf8'));
(async()=>{
 const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
 const p=await b.newPage();
 const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.setViewport({width:1440,height:1200});
 await p.goto('http://localhost:5380/',{waitUntil:'domcontentloaded'});
 await p.evaluate((tok)=>{localStorage.setItem('token',tok);},t);
 await p.goto('http://localhost:5380/settings',{waitUntil:'networkidle2'});
 await new Promise(r=>setTimeout(r,2500));
 const r=await p.evaluate(()=>{
   const txt=[...document.querySelectorAll('button[title]')].map(b=>b.getAttribute('title'));
   const all=document.body.innerText;
   return {
     pieceBtns:txt.length,
     pieces:txt.slice(0,40),
     hasEmeraldBlack:txt.includes('Emerald Black'),
     hasEmerald:txt.includes('Emerald'),
     banned:['Bubblegum','Graffiti','Emoji','Fairy Tale','Retro Cards','Minimal Text','Geometric','Cburnett','Royal','Neo','Cases','Bases'].filter(n=>txt.includes(n)),
     boardHasIce:all.includes('Ice'),
     boardHasCoral:all.includes('Coral'),
     boardHasMarble:all.includes('Marble'),
   };
 });
 console.log(JSON.stringify(r,null,1));
 console.log('errors',errs.length,errs.slice(0,2));
 await b.close();
})().catch(e=>{console.log('FAIL',e.message);process.exit(1);});

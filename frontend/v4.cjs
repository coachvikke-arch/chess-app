const puppeteer=require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');
const fs=require('fs');
const {t,email}=JSON.parse(fs.readFileSync('tk.json','utf8'));
(async()=>{
 const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
 const p=await b.newPage();
 const errs=[];p.on('pageerror',e=>errs.push(e.message));
 p.on('response',async res=>{ if(res.url().includes('/api/auth/me')){ console.log('me ->',res.status()); }});
 await p.setViewport({width:1440,height:1200});
 await p.goto('http://localhost:5380/',{waitUntil:'domcontentloaded'});
 // seed both keys, then let /auth/me validate
 await p.evaluate((tok,em)=>{localStorage.setItem('token',tok);localStorage.setItem('user',JSON.stringify({email:em,role:'student',name:'Manivel'}));},t,email);
 await p.goto('http://localhost:5380/student/settings',{waitUntil:'networkidle2'});
 await new Promise(r=>setTimeout(r,2500));
 const url=p.url();
 const r=await p.evaluate(()=>{
   const txt=[...document.querySelectorAll('button[title]')].map(b=>b.getAttribute('title'));
   const body=document.body.innerText;
   return { pieceBtns:txt.length, pieces:txt,
     banned:['Bubblegum','Graffiti','Emoji','Fairy Tale','Retro Cards','Minimal Text','Geometric','Cburnett','Royal','Neo','Cases','Bases','Medieval','Circled','Squares','Merida'].filter(n=>txt.includes(n)),
     boardRemoved:['Ice','Coral','Marble','Faded Board'].filter(n=>body.includes('\n'+n)),
     kept:['Classic Green','Classic Brown','Blue Ocean','Tournament Wood','Dark Mode','Royal Jade','Royal Emerald'].filter(n=>body.includes(n)),
   };
 });
 console.log('url',url);
 console.log(JSON.stringify(r,null,1));
 console.log('errors',errs.length);
 await b.close();
})().catch(e=>{console.log('FAIL',e.message);process.exit(1);});


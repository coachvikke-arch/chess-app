const puppeteer=require('C:/Users/MANIVEL M/AppData/Local/Temp/opencode/node_modules/puppeteer');
(async()=>{
 const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});
 const p=await b.newPage();
 await p.setViewport({width:1440,height:900});
 const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto('http://localhost:5360/',{waitUntil:'networkidle2'});
 await new Promise(r=>setTimeout(r,1200));
 const r=await p.evaluate(()=>{
   const wm=document.querySelector('img.brand-wordmark');
   const lg=document.querySelector('img.brand-logo');
   if(!wm) return {found:false};
   const a=wm.getBoundingClientRect(), c=lg.getBoundingClientRect();
   return {found:true,complete:wm.complete,natural:wm.naturalWidth+'x'+wm.naturalHeight,
     wmBox:[Math.round(a.width),Math.round(a.height)],logoBox:[Math.round(c.width),Math.round(c.height)],
     gap:Math.round(a.left-c.right), alt:wm.alt, brandText:document.body.innerText.includes('MATE ZONE CHESS ACADEMY')};
 });
 console.log(JSON.stringify(r));
 await p.screenshot({path:'hdr.png',clip:{x:0,y:0,width:1440,height:110}});
 await p.setViewport({width:390,height:844});
 await new Promise(r=>setTimeout(r,600));
 const m=await p.evaluate(()=>{const w=document.querySelector('img.brand-wordmark').getBoundingClientRect();return {w:Math.round(w.width),h:Math.round(w.height),visible:w.width>0};});
 console.log('mobile',JSON.stringify(m));
 console.log('errors',errs.length);
 await b.close();
})().catch(e=>{console.log('FAIL',e.message);process.exit(1);});


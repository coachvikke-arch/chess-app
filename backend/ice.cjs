const db=require('c:/Users/MANIVEL M/Downloads/Files/chess-academy/backend/src/config/database');
const jwt=require('c:/Users/MANIVEL M/Downloads/Files/chess-academy/backend/node_modules/jsonwebtoken');
const fs=require('fs');
(async()=>{
 const r=await db.query("SELECT id,email,role,piece_set,board_theme FROM users WHERE board_theme='ice' LIMIT 1");
 const u=r.rows[0];
 if(!u){console.log('no ice user');process.exit(0);}
 const sec=fs.readFileSync('.env','utf8').match(/^JWT_SECRET=(.*)$/m)[1].trim();
 const t=jwt.sign({id:u.id,email:u.email,role:u.role},sec,{expiresIn:'2h'});
 fs.writeFileSync('C:/Users/MANIVEL M/Downloads/Files/chess-academy/frontend/tk2.json',JSON.stringify({t,email:u.email,role:u.role,name:'IceUser'}));
 console.log('ice user',u.email,'theme',u.board_theme);
 process.exit(0);
})().catch(e=>{console.log('ERR',e.message);process.exit(1);});

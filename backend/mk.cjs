const jwt=require('jsonwebtoken');
const db=require('./src/config/database');
require('dotenv').config();
(async()=>{
  const r=await db.query("SELECT id,email,role FROM users WHERE role='superadmin' LIMIT 1");
  if(!r.rows.length){console.log('no superadmin');process.exit(1);}
  const u=r.rows[0];
  const t=jwt.sign({id:u.id,email:u.email,role:u.role},process.env.JWT_SECRET,{expiresIn:'2h'});
  require('fs').writeFileSync('../frontend/tok.json',JSON.stringify({token:t,user:u}));
  console.log('superadmin: '+u.email+' id='+u.id);
  await db.pool.end();
})().catch(e=>{console.log('ERR '+e.message);process.exit(1);});

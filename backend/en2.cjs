const db=require('./src/config/database');
(async()=>{
  const c=await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='role_permissions' ORDER BY ordinal_position");
  console.log('cols: '+c.rows.map(r=>r.column_name).join(', '));
  await db.pool.end();
})().catch(e=>{console.log('ERR '+e.message);process.exit(1);});

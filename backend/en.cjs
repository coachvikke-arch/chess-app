const db=require('./src/config/database');
(async()=>{
  const r=await db.query("UPDATE role_permissions SET is_enabled=TRUE WHERE feature_key IN ('live_game','game_analysis') AND role='student' RETURNING feature_key, role");
  console.log(JSON.stringify(r.rows));
  await db.pool.end();
})().catch(e=>{console.log('ERR '+e.message);process.exit(1);});

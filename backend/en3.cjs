const db=require('./src/config/database');
(async()=>{
  const r=await db.query("UPDATE role_permissions SET is_enabled=TRUE WHERE feature_id IN (SELECT id FROM features WHERE key IN ('live_game','game_analysis')) AND role='student' RETURNING feature_id, role");
  console.log('enabled: '+JSON.stringify(r.rows));
  await db.pool.end();
})().catch(e=>{console.log('ERR '+e.message);process.exit(1);});

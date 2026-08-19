const pool = require('./src/config/db');

async function check() {
  const res = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'liquidacion_item';
  `);
  console.log(res.rows);
  const res2 = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'item_categoria';
  `);
  console.log(res2.rows);
  process.exit(0);
}
check();

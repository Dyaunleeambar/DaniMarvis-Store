const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync('backend/danimarvis.db'));
  const st = db.prepare('SELECT images FROM publications WHERE images != "[]" LIMIT 8');
  const found = [];
  while (st.step()) {
    const imgs = JSON.parse(st.getAsObject().images || '[]');
    for (const i of imgs) {
      const f = String(i).replace(/\\/g, '/').split('/').pop();
      const p = path.join('backend', 'uploads', f);
      if (fs.existsSync(p)) { found.push(p); break; }
    }
    if (found.length >= 1) break;
  }
  st.free();
  console.log(found.length ? found[0] : 'ninguna');
});
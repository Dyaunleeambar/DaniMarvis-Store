import initSqlJs from 'sql.js';
import fs from 'fs';
import { createHash } from 'node:crypto';

const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync('danimarvis.db'));
const s = db.prepare('SELECT auth_secret FROM settings WHERE id = 1');
s.step();
const secret = s.getAsObject().auth_secret;
s.free();
const payload = { id: 'cli-retry', exp: Date.now() + 3600000 };
const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = createHash('sha256').update(`${body}.${secret}`).digest('base64url');
process.stdout.write(`${body}.${sig}`);

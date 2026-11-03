// Builds the deployable web app into web/: copies src/, stamps the service worker with a
// content hash and the full precache list, and writes sync config from env vars if given.
// Usage: node tools/build-web.js   (optional: RECALL_SUPABASE_URL, RECALL_SUPABASE_ANON_KEY)
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const src = path.join(__dirname, '..', 'src'); const out = path.join(__dirname, '..', 'web');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

const url = process.env.RECALL_SUPABASE_URL, key = process.env.RECALL_SUPABASE_ANON_KEY;
if (url && key) fs.writeFileSync(path.join(out, 'config.js'), `window.RECALL_CONFIG = ${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key }, null, 2)};\n`);

const files = []; const hash = crypto.createHash('sha256');
(function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name); const rel = path.relative(out, p).split(path.sep).join('/');
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (rel === 'sw.js') continue;
    files.push('./' + rel); hash.update(rel); hash.update(fs.readFileSync(p));
  }
})(out);
files.push('./');
const version = hash.digest('hex').slice(0, 12);
const swPath = path.join(out, 'sw.js');
fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replace("const VERSION = 'dev';", `const VERSION = '${version}';`).replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(files)};`));
console.log(`Built web/ (${files.length} files, version ${version})${url && key ? ' with sync config' : ''}`);

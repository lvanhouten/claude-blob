// Fails when a packaged app.asar is missing a module its pages load. electron-builder
// drops node_modules files by pattern (it strips every examples/ folder), and a
// missing import leaves the window blank with no error anywhere visible.
// Runs under Electron so it reads the archive exactly as the app does:
//   ELECTRON_RUN_AS_NODE=1 npx electron tools/check-package.js     (every app.asar under dist/)
//   ELECTRON_RUN_AS_NODE=1 npx electron tools/check-package.js <app.asar>...
const fs = require('fs');
const path = require('path');

const PAGES = ['index.html', 'gallery.html', 'color.html'];

function findAsars(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.name === 'app.asar') return [p];
    return d.isDirectory() && !d.isSymbolicLink() ? findAsars(p) : [];
  });
}

function check(archive) {
  const has = (p) => fs.existsSync(path.join(archive, p));
  const read = (p) => fs.readFileSync(path.join(archive, p), 'utf8');
  const missing = [];
  const seen = new Set();

  function visit(file, from, imports) {
    if (seen.has(file)) return;
    seen.add(file);
    if (!has(file)) return missing.push(`${file} (loaded by ${from})`);
    const src = read(file);
    const specs = [...src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(?\s*['"]([^'"]+)['"]/g)]
      .map((m) => m[1] ?? m[2]);
    for (const spec of specs) visit(resolve(spec, file, imports), file, imports);
  }

  function resolve(spec, from, imports) {
    if (spec.startsWith('.') || spec.startsWith('/')) return path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    const key = Object.keys(imports).filter((k) => spec === k || (k.endsWith('/') && spec.startsWith(k)))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) return `<unmapped ${spec}>`;
    return path.posix.normalize(imports[key] + spec.slice(key.length));
  }

  for (const page of PAGES) {
    if (!has(page)) { missing.push(`${page} (a page)`); continue; }
    const html = read(page);
    const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
    const imports = map ? JSON.parse(map[1]).imports : {};
    for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"?]+)"/g)) visit(path.posix.normalize(src), page, imports);
  }
  return { missing, count: seen.size };
}

const archives = process.argv.length > 2 ? process.argv.slice(2) : findAsars(path.join(__dirname, '..', 'dist'));
if (!archives.length) {
  console.error('check-package: no app.asar under dist/; run npm run dist first');
  process.exit(1);
}
let failed = false;
for (const archive of archives) {
  const { missing, count } = check(archive);
  console.log(`${path.relative(process.cwd(), archive)}: ${count} modules, ${missing.length} missing`);
  for (const m of missing) console.log(`  missing ${m}`);
  failed ||= missing.length > 0;
}
process.exit(failed ? 1 : 0);

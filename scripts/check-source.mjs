import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// A static-host build check. Do not import product modules or execute authored tests.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(root, 'web');
const modules = ['domain.mjs', 'app.mjs'];
let imports = 0;
for (const name of modules) {
  const filename = path.join(web, name);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) throw new Error(`Invalid owned module: ${name}`);
  execFileSync(process.execPath, ['--check', filename], { stdio: 'pipe' });
  const text = fs.readFileSync(filename, 'utf8');
  for (const match of text.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    if (!match[1].startsWith('./')) throw new Error(`Unexpected product import in ${name}`);
    const target = path.resolve(web, match[1]);
    if (!target.startsWith(`${web}${path.sep}`) || !fs.statSync(target).isFile()) throw new Error(`Missing local import in ${name}`);
    imports++;
  }
}
const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
if (ids.length !== new Set(ids).size) throw new Error('Duplicate template IDs');
for (const match of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) {
  if (!/^\.\/[a-z][a-z0-9.-]*$/.test(match[1]) || !fs.statSync(path.join(web, match[1])).isFile()) throw new Error('Invalid local asset reference');
}
for (const name of ['package.json', 'vercel.json']) JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
process.stdout.write(`${JSON.stringify({ kind: 'static-source-check', modules: modules.length, relativeImports: imports, uniqueIds: ids.length, productTestsExecuted: 0, productImportsExecuted: 0 })}\n`);

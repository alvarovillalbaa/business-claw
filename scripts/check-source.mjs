import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// A static-host build check. Do not import product modules or execute authored tests.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(root, 'web');
const modules = ['web/domain.mjs', 'web/app.mjs', 'web/server-client.mjs', 'runtime/config-observation.mjs',
  'server/data.mjs', 'server/access.mjs', 'server/policy.mjs', 'server/membership.mjs',
  'server/postgres-store.mjs', 'server/auth.mjs', 'server/http.mjs', 'api/v1.mjs',
  'runtime/compute-provider.mjs', 'runtime/artifact-admission.mjs', 'server/runtime-ledger.mjs'];
const modulePaths = new Set(modules.map(name => path.join(root, name)));
let imports = 0, builtins = 0, dependencies = 0;
for (const name of modules) {
  const filename = path.join(root, name), moduleRoot = path.dirname(filename);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) throw new Error(`Invalid owned module: ${name}`);
  execFileSync(process.execPath, ['--check', filename], { stdio: 'pipe' });
  const text = fs.readFileSync(filename, 'utf8');
  for (const match of text.matchAll(/(?:\bfrom\s+|\bimport\(\s*)["']([^"']+)["']/g)) {
    if ((name.startsWith('server/') || name.startsWith('api/') || name.startsWith('runtime/')) && match[1] === 'node:crypto') { builtins++; continue; }
    if (name === 'api/v1.mjs' && match[1] === 'pg') { dependencies++; continue; }
    if (!match[1].startsWith('./') && !match[1].startsWith('../')) throw new Error(`Unexpected product import in ${name}`);
    const target = path.resolve(moduleRoot, match[1]);
    if (!modulePaths.has(target) || !fs.statSync(target).isFile()
      || (name.startsWith('web/') && !target.startsWith(`${web}${path.sep}`))) throw new Error(`Missing owned import in ${name}`);
    imports++;
  }
}
const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
if (ids.length !== new Set(ids).size) throw new Error('Duplicate template IDs');
for (const match of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) {
  if (!/^\.\/[a-z][a-z0-9.-]*$/.test(match[1]) || !fs.statSync(path.join(web, match[1])).isFile()) throw new Error('Invalid local asset reference');
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
if (pkg.dependencies?.pg !== '8.23.1' || lock.packages?.['node_modules/pg']?.version !== '8.23.1'
  || JSON.stringify(pkg.dependencies) !== JSON.stringify(lock.packages[''].dependencies)) throw new Error('Dependency lock mismatch');
process.stdout.write(`${JSON.stringify({ kind: 'static-source-check', modules: modules.length, relativeImports: imports, builtinImports: builtins, dependencyImports: dependencies, uniqueIds: ids.length, productTestsExecuted: 0, productImportsExecuted: 0 })}\n`);

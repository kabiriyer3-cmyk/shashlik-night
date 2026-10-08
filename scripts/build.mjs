// Builds dist/index.html: one self-contained file with the game code and the Python-generated models inlined.
// Usage: npm run build   (runs the Python model generator first, then bundles with esbuild)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => path.join(root, ...p);
const t0 = Date.now();

// 1. models, textures, rigs, animations (numpy + Pillow)
if (!process.argv.includes('--skip-models') || !fs.existsSync(r('build/assets.glb.gz'))) {
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  console.log('> generating models with', py);
  execFileSync(py, [r('tools/build_models.py')], { stdio: 'inherit', cwd: r('tools') });
}

// 2. game code: src/game/*.js are consecutive parts of one module, glued in order
const parts = fs.readdirSync(r('src/game')).filter(f => f.endsWith('.js')).sort();
fs.writeFileSync(r('src/.main.gen.js'), parts.map(f => fs.readFileSync(r('src/game', f), 'utf8')).join(''));
const out = await build({
  entryPoints: [r('src/.main.gen.js')], bundle: true, format: 'iife', minify: true, target: 'es2020',
  write: false, logLevel: 'warning', legalComments: 'none',
});
fs.rmSync(r('src/.main.gen.js'));
const js = out.outputFiles[0].text.replace(/<\/script>/g, '<\\/script>');

// 3. inline everything into the HTML shell
const assets = fs.readFileSync(r('build/assets.glb.gz')).toString('base64');
let html = fs.readFileSync(r('src/template.html'), 'utf8');
html = html.replace('<!--ASSETS-->', () => `<script>window.__ASSETS="${assets}";</script>`)
           .replace('<!--BUNDLE-->', () => `<script>${js}</script>`);
fs.rmSync(r('dist'), { recursive: true, force: true });
fs.mkdirSync(r('dist'), { recursive: true });
fs.writeFileSync(r('dist/index.html'), html);
// 4. static extras (e.g. your own ice.json with TURN servers)
if (fs.existsSync(r('public'))) fs.cpSync(r('public'), r('dist'), { recursive: true });
fs.writeFileSync(r('dist/.nojekyll'), '');
console.log(`> dist/index.html ${(html.length / 1e6).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

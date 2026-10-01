import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  minify: !watch,
  external: ['vscode'],
  logLevel: 'info',
};

mkdirSync('dist', { recursive: true });
copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm', 'dist/sql-wasm.wasm');

const jobs = [
  { ...shared, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' },
  { ...shared, entryPoints: ['src/switch/helper/switch-helper.ts'], outfile: 'dist/switch-helper.js' },
];

if (watch) {
  for (const j of jobs) {
    await (await context(j)).watch();
  }
} else {
  for (const j of jobs) {
    await build(j);
  }
}

import { existsSync } from 'fs';
import { join } from 'path';

const electronDir = import.meta.dir + '/..';
const required = [
  'dist/main.cjs',
  'dist/bootstrap-preload.cjs',
  'dist/browser-toolbar-preload.cjs',
  'dist/interceptor.cjs',
  'dist/renderer/index.html',
  'dist/resources',
  'package.json',
];

let ok = true;
for (const rel of required) {
  const full = join(electronDir, rel);
  if (!existsSync(full)) {
    console.error(`❌ Missing: ${rel}`);
    ok = false;
  }
}

if (ok) {
  console.log('✅ All required assets present');
} else {
  process.exit(1);
}

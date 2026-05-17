import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'glasses-app');
const dst = join(root, 'dist');

if (existsSync(dst)) {
  try {
    rmSync(dst, { recursive: true, force: true });
  } catch (e) {
    console.warn('Could not remove dist directory:', e.message);
  }
}
mkdirSync(dst, { recursive: true });
if (existsSync(src)) cpSync(src, dst, { recursive: true });

console.log('built:', dst);

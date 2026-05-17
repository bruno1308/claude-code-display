import process from 'node:process';
import fs from 'node:fs';
import { PtySession } from './pty-session.js';

const captureArgIndex = process.argv.indexOf('--capture');
const capturePath = captureArgIndex >= 0 ? process.argv[captureArgIndex + 1] : null;
const captureStream = capturePath ? fs.createWriteStream(capturePath) : null;

const session = new PtySession({
  cwd: process.cwd(),
  cols: process.stdout.columns,
  rows: process.stdout.rows,
});

session.on('data', (chunk: string) => {
  process.stdout.write(chunk);
  captureStream?.write(chunk);
});

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => session.write(chunk.toString()));
process.stdout.on('resize', () =>
  session.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 30),
);

session.on('exit', (code: number) => {
  captureStream?.end();
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(code);
});

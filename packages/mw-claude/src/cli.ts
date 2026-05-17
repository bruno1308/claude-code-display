import process from 'node:process';
import { PtySession } from './pty-session.js';

const session = new PtySession({
  cwd: process.cwd(),
  cols: process.stdout.columns,
  rows: process.stdout.rows,
});

session.on('data', (chunk: string) => process.stdout.write(chunk));

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => session.write(chunk.toString()));
process.stdout.on('resize', () =>
  session.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 30),
);

session.on('exit', (code: number) => {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(code);
});

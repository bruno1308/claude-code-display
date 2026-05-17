import * as pty from 'node-pty';
import process from 'node:process';
import * as path from 'node:path';
import * as os from 'node:os';

const shell = process.platform === 'win32'
  ? path.join(os.homedir(), '.local', 'bin', 'claude.exe')
  : 'claude';

const child = pty.spawn(shell, [], {
  name: 'xterm-256color',
  cols: process.stdout.columns ?? 120,
  rows: process.stdout.rows ?? 30,
  cwd: process.cwd(),
  env: process.env as Record<string, string>,
});

// child -> parent terminal
child.onData((data) => {
  process.stdout.write(data);
});

// parent terminal -> child
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.on('data', (chunk) => {
  child.write(chunk.toString());
});

// resize forwarding
process.stdout.on('resize', () => {
  child.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 30);
});

child.onExit(({ exitCode }) => {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(exitCode ?? 0);
});

// SPIKE: after 10 seconds, programmatically inject a prompt
setTimeout(() => {
  console.error('\n[mw-claude spike] injecting test prompt in 1s...\n');
  setTimeout(() => {
    child.write('say hello in five words\r');
  }, 1000);
}, 10000);

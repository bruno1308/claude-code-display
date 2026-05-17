import process from 'node:process';
import { PtySession } from './pty-session.js';
import { LocalServer } from './local-server.js';
import { segmentReplies } from './output-parser.js';

const PORT = Number(process.env.MW_CLAUDE_PORT ?? 7878);

const session = new PtySession({
  cwd: process.cwd(),
  cols: process.stdout.columns,
  rows: process.stdout.rows,
});

const server = new LocalServer(PORT);

const segmenter = segmentReplies((text) => server.sendReply(text));

session.on('data', (chunk: string) => {
  process.stdout.write(chunk);
  segmenter.feed(chunk);
});

server.on('prompt', (text: string) => {
  session.write(text + '\r');
});

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => session.write(chunk.toString()));
process.stdout.on('resize', () =>
  session.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 30),
);

session.on('exit', (code: number) => {
  segmenter.flush();
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(code);
});

server.start().then(() => {
  process.stderr.write(`[mw-claude] local UI on http://127.0.0.1:${PORT}\n`);
});

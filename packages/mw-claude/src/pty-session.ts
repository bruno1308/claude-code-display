import * as pty from 'node-pty';
import { EventEmitter } from 'node:events';

export interface PtySessionEvents {
  data: (chunk: string) => void;
  exit: (code: number) => void;
}

export class PtySession extends EventEmitter {
  private child: pty.IPty;

  constructor(opts: { cwd?: string; cols?: number; rows?: number }) {
    super();
    const shell = process.platform === 'win32' ? 'claude.exe' : 'claude';
    // --dangerously-skip-permissions: hands-free use means the user can't see
    // or answer permission prompts from the glasses/phone. Set the env var
    // CCDISPLAY_SAFE_MODE=1 to opt out and get the normal permission flow.
    const args = process.env.CCDISPLAY_SAFE_MODE === '1' ? [] : ['--dangerously-skip-permissions'];
    this.child = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      cwd: opts.cwd ?? process.cwd(),
      env: process.env as Record<string, string>,
    });
    this.child.onData((data) => this.emit('data', data));
    this.child.onExit(({ exitCode }) => this.emit('exit', exitCode ?? 0));
  }

  write(text: string): void {
    this.child.write(text);
  }

  resize(cols: number, rows: number): void {
    this.child.resize(cols, rows);
  }

  kill(): void {
    this.child.kill();
  }
}

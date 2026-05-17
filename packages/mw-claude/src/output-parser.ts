import ansiRegex from 'ansi-regex';

export function stripAnsi(input: string): string {
  return input.replace(ansiRegex(), '');
}

/**
 * Streaming segmenter that detects Claude TUI prompt-redraw boundaries and
 * emits cleaned assistant reply text between them.
 *
 * The Claude Code TUI renders the prompt input box as:
 *   ────...────\r\n> <user input>\r\n────...────
 * Each time a new turn begins, this box is redrawn. Content between two
 * consecutive prompt-box redraws is one assistant "turn". Within that turn,
 * the actual reply is prefixed by a `●` bullet character (Claude Code's
 * streaming output indicator), followed by the reply text.
 */

/** A regex matching the prompt box pattern (two dash lines sandwiching `> ...`). */
const PROMPT_BOX_RE = /─{10,}\r?\n>[^\r\n]*\r?\n─{10,}/;

export interface Segmenter {
  feed(chunk: string): void;
  flush(): void;
}

export function segmentReplies(onReply: (text: string) => void): Segmenter {
  let buf = '';

  function processBuffer(): void {
    let found = true;
    while (found) {
      const match = PROMPT_BOX_RE.exec(buf);
      if (!match) {
        found = false;
        break;
      }
      const before = buf.slice(0, match.index);
      buf = buf.slice(match.index + match[0].length);

      // Extract replies: the ● bullet prefix marks actual assistant output
      for (const m of before.matchAll(/●([^\r\n]+)/g)) {
        const reply = m[1].trim();
        if (reply.length > 0) {
          onReply(reply);
        }
      }
    }
  }

  return {
    feed(chunk: string): void {
      buf += stripAnsi(chunk);
      processBuffer();
    },

    flush(): void {
      // Emit any ● replies remaining in the buffer (e.g. last turn with no trailing prompt)
      for (const m of buf.matchAll(/●([^\r\n]+)/g)) {
        const reply = m[1].trim();
        if (reply.length > 0) {
          onReply(reply);
        }
      }
      buf = '';
    },
  };
}

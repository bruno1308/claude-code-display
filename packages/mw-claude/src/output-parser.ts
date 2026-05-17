import ansiRegex from 'ansi-regex';

export function stripAnsi(input: string): string {
  return input.replace(ansiRegex(), '');
}

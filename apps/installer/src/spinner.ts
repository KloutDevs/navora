import process from 'node:process';
import { c } from './colors.js';

const FRAMES = ['/', '-', '\\', '|'] as const;
const INTERVAL = 80;

export interface Spinner {
  message(text: string): void;
  stop(text?: string): void;
  fail(text?: string): void;
}

export function createSpinner(initialText: string): Spinner {
  let text = initialText;
  let frame = 0;

  const tick = () => {
    const line = `  ${c.p3}${FRAMES[frame % FRAMES.length]}${c.reset}  ${text}`;
    process.stdout.write(`\r${line}                    `); // trailing spaces clear leftovers
    frame++;
  };

  tick();
  const id = setInterval(tick, INTERVAL);

  return {
    message(newText: string) {
      text = newText;
    },
    stop(finalText?: string) {
      clearInterval(id);
      const line = `  ${c.ok}✓${c.reset}  ${finalText ?? text}`;
      process.stdout.write(`\r${line}                    \n`);
    },
    fail(finalText?: string) {
      clearInterval(id);
      const line = `  ${c.err}✗${c.reset}  ${finalText ?? text}`;
      process.stdout.write(`\r${line}                    \n`);
    },
  };
}

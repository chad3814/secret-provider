import type { Provider } from './provider.ts';
import { ProviderError } from './provider-error.ts';

/**
 * The part of a terminal input stream this needs.
 *
 * Structural rather than `NodeJS.ReadStream`, so the public surface stays free
 * of `NodeJS.*` and consumers do not need `@types/node` to typecheck against
 * it. `process.stdin` is assignable to it.
 */
export interface PromptInput {
  isTTY?: boolean | undefined;
  setRawMode?: ((mode: boolean) => void) | undefined;
  // Narrowed to the one encoding this ever sets: a wider `string` parameter
  // would not accept `process.stdin`, whose own parameter is `BufferEncoding`.
  setEncoding?: ((encoding: 'utf8') => void) | undefined;
  resume?: (() => void) | undefined;
  // Chunks arrive as bytes unless the stream was put into a text encoding, and
  // `setEncoding` is optional here, so both have to be handled.
  on: (event: 'data', listener: (chunk: string | Uint8Array) => void) => void;
  off: (event: 'data', listener: (chunk: string | Uint8Array) => void) => void;
}

/** The part of a terminal output stream this needs. */
export interface PromptOutput {
  write: (chunk: string) => void;
}

export interface PromptOptions {
  /**
   * What to echo per character typed. `false`, the default, echoes nothing at
   * all, so the secret's length is not revealed to anyone watching the screen
   * or a recorded session. Pass a character such as `'*'` to show progress.
   */
  mask?: false | string | undefined;
  /** Where keystrokes come from. Defaults to `process.stdin`. */
  input?: PromptInput | undefined;
  /**
   * Where the prompt is written. Defaults to `process.stderr`, the convention
   * for password prompts, so a CLI's stdout stays clean for piping.
   */
  output?: PromptOutput | undefined;
}

const ENTER = '\r';
const NEWLINE = '\n';
const BACKSPACE = '\u007f';
const BACKSPACE_ALT = '\b';
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';

/** Erase the last echoed character: back up, overwrite with a space, back up. */
const ERASE = '\b \b';

/**
 * Ask the user for a credential on the terminal.
 *
 * Reads with echo suppressed, so nothing typed is displayed. The prompt goes to
 * stderr rather than stdout, keeping piped output clean.
 *
 * Falls through to the next link in a chain when there is no terminal to prompt
 * on — in CI, behind a pipe, or in a daemon — and likewise when the user submits
 * nothing. Aborting with Ctrl-C halts the chain instead: an explicit refusal
 * should not quietly fall back to some other credential source.
 *
 * The prompt happens on every resolution, so wrap this in {@link memoize} unless
 * you genuinely want to ask again each time.
 */
export function fromPrompt(
  prompt: string,
  options: PromptOptions = {},
): Provider<string> {
  const {
    mask = false,
    input = process.stdin,
    output = process.stderr,
  } = options;

  return async () => {
    if (input.isTTY !== true) {
      throw new ProviderError(
        'cannot prompt for a credential: the input is not a TTY',
      );
    }

    const value = await read(prompt, input, output, mask);

    if (value === '') {
      throw new ProviderError('the prompt was submitted empty');
    }

    return value;
  };
}

function read(
  prompt: string,
  input: PromptInput,
  output: PromptOutput,
  mask: false | string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let value = '';
    // Per call, not shared: a streaming decoder carries state across chunks so
    // a multi-byte character split between two reads still decodes correctly.
    const decoder = new TextDecoder();

    const finish = (outcome: () => void): void => {
      input.off('data', onData);
      input.setRawMode?.(false);
      // The suppressed Enter never reached the terminal, so close the line.
      output.write('\n');
      outcome();
    };

    const onData = (chunk: string | Uint8Array): void => {
      const text =
        typeof chunk === 'string'
          ? chunk
          : decoder.decode(chunk, { stream: true });

      for (const character of text) {
        switch (character) {
          case ENTER:
          case NEWLINE:
          case CTRL_D: {
            finish(() => {
              resolve(value);
            });
            return;
          }
          case CTRL_C: {
            finish(() => {
              reject(new ProviderError('the prompt was cancelled', false));
            });
            return;
          }
          case BACKSPACE:
          case BACKSPACE_ALT: {
            if (value !== '') {
              value = value.slice(0, -1);
              if (mask !== false) {
                output.write(ERASE);
              }
            }
            break;
          }
          default: {
            value += character;
            if (mask !== false) {
              output.write(mask);
            }
          }
        }
      }
    };

    output.write(prompt);
    input.setEncoding?.('utf8');
    input.setRawMode?.(true);
    input.resume?.();
    input.on('data', onData);
  });
}

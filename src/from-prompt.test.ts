import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { fromPrompt } from './from-prompt.ts';
import { ProviderError } from './provider-error.ts';

/** A stand-in terminal, so these tests never need a real TTY. */
class FakeInput extends EventEmitter {
  isTTY: boolean;
  rawModeCalls: boolean[] = [];
  encoding: string | undefined;

  constructor(isTTY = true) {
    super();
    this.isTTY = isTTY;
  }

  setRawMode(mode: boolean): void {
    this.rawModeCalls.push(mode);
  }

  setEncoding(encoding: string): void {
    this.encoding = encoding;
  }

  resume(): void {}
  pause(): void {}

  /** Deliver keystrokes the way a raw-mode stdin would. */
  type(...chunks: string[]): void {
    for (const chunk of chunks) {
      this.emit('data', chunk);
    }
  }

  /** Deliver a chunk exactly as given, so byte chunks can be exercised too. */
  typeRaw(chunk: string | Uint8Array): void {
    this.emit('data', chunk);
  }
}

class FakeOutput {
  written = '';

  write(chunk: string): void {
    this.written += chunk;
  }
}

test('resolves what the user typed, submitted with Enter', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const resolve = fromPrompt('API key: ', { input, output });
  const pending = resolve();
  input.type('s3cret', '\r');

  assert.equal(await pending, 's3cret');
});

test('writes the prompt to the output stream', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('s3cret', '\r');
  await pending;

  assert.match(output.written, /API key: /);
});

test('echoes nothing by default, not even the length', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('s3cret', '\r');
  await pending;

  const afterPrompt = output.written.replace('API key: ', '');
  assert.equal(afterPrompt.includes('s3cret'), false, 'the secret must not be echoed');
  assert.equal(/\*/.test(afterPrompt), false, 'nothing should stand in for the characters');
});

test('accepts a newline as submission too', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('s3cret\n');

  assert.equal(await pending, 's3cret');
});

test('treats CRLF as a single submission', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('s3cret\r\n');

  assert.equal(await pending, 's3cret');
});

test('reads one keystroke at a time, as a raw terminal delivers them', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('s', '3', 'c', 'r', 'e', 't', '\r');

  assert.equal(await pending, 's3cret');
});

test('restores the terminal and stops listening once it is done', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('s3cret', '\r');
  await pending;

  assert.deepEqual(input.rawModeCalls, [true, false], 'raw mode must be restored');
  assert.equal(input.listenerCount('data'), 0, 'the data listener must be removed');
});

test('falls through when the input is not a TTY', async () => {
  const input = new FakeInput(false);
  const output = new FakeOutput();

  await assert.rejects(fromPrompt('API key: ', { input, output })(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    assert.match(error.message, /TTY/);
    return true;
  });
});

test('does not write a prompt when there is no TTY to prompt on', async () => {
  const input = new FakeInput(false);
  const output = new FakeOutput();

  await assert.rejects(fromPrompt('API key: ', { input, output })());

  assert.equal(output.written, '');
});

test('falls through when the user submits nothing', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('\r');

  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    assert.match(error.message, /empty/);
    return true;
  });
});

test('masks with the given character when asked, one per keystroke', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output, mask: '*' })();
  input.type('s3cret', '\r');
  await pending;

  const afterPrompt = output.written.replace('API key: ', '');
  assert.equal(afterPrompt.includes('s3cret'), false, 'still never the secret itself');
  assert.equal((afterPrompt.match(/\*/g) ?? []).length, 6);
});

test('backspace removes the last character', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('s3crex', '\u007f', 't', '\r');

  assert.equal(await pending, 's3cret');
});

test('backspace on empty input does not underflow', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('\u007f', '\u007f', 'ok', '\r');

  assert.equal(await pending, 'ok');
});

test('halts the chain when the user aborts with Ctrl-C', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('par', '\u0003');

  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(
      error.tryNextLink,
      false,
      'an explicit abort must not fall through to another source',
    );
    return true;
  });
  assert.deepEqual(input.rawModeCalls, [true, false], 'the terminal is restored on abort');
});

test('decodes byte chunks from a stream that never got setEncoding', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.typeRaw(new TextEncoder().encode('s3cret'));
  input.typeRaw('\r');

  assert.equal(await pending, 's3cret');
});

test('prompts at resolution, not at construction', () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  fromPrompt('API key: ', { input, output });

  assert.equal(output.written, '', 'constructing must not touch the terminal');
  assert.deepEqual(input.rawModeCalls, []);
});

const CTRL_A = '\u0001';
const CTRL_E = '\u0005';
const CTRL_L = '\u000c';
const CTRL_U = '\u0015';
const ESC = '\u001b';

test('Ctrl-U discards everything typed so far', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('wr0ng-t9ped', CTRL_U, 's3cret', '\r');

  assert.equal(await pending, 's3cret');
});

test('Ctrl-U on empty input is a no-op', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type(CTRL_U, CTRL_U, 's3cret', '\r');

  assert.equal(await pending, 's3cret');
});

test('Ctrl-U then Enter submits empty, so it falls through', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('typo', CTRL_U, '\r');

  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    assert.match(error.message, /empty/);
    return true;
  });
});

test('Ctrl-U erases the echoed placeholders when masking', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output, mask: '*' })();
  input.type('abcdef', CTRL_U, 'xy', '\r');
  await pending;

  const eraseSeq = String.fromCharCode(8) + " " + String.fromCharCode(8);
  const erases = output.written.split(eraseSeq).length - 1;
  assert.equal(erases, 6, 'one erase per discarded placeholder');
});

test('does not count Ctrl-U as a keystroke to mask', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output, mask: '*' })();
  input.type('abc', CTRL_U, 'xy', '\r');
  await pending;

  // 3 for 'abc', then 2 for 'xy' — nothing for the Ctrl-U itself.
  assert.equal((output.written.match(/\*/g) ?? []).length, 5);
  assert.equal(output.written.includes(CTRL_U), false);
});

test('ignores control characters instead of putting them in the secret', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  // Cursor motion and redraw keys are meaningless with nothing rendered.
  input.type('s3', CTRL_A, 'c', CTRL_E, 'r', CTRL_L, 'et', '\r');

  assert.equal(await pending, 's3cret');
});

test('ignores arrow keys rather than injecting their escape sequence', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('s3c', `${ESC}[A`, `${ESC}[D`, 'ret', '\r');

  assert.equal(await pending, 's3cret');
});

test('ignores Home and End style escape sequences', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('s3c', `${ESC}OH`, `${ESC}[F`, 'ret', '\r');

  assert.equal(await pending, 's3cret');
});

test('ignores a multi-character function key sequence', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('s3c', `${ESC}[15~`, 'ret', '\r');

  assert.equal(await pending, 's3cret');
});

test('ignores an escape sequence split across chunks', async () => {
  const input = new FakeInput();
  const output = new FakeOutput();

  const pending = fromPrompt('API key: ', { input, output })();
  input.type('s3c', ESC, '[', 'A', 'ret', '\r');

  assert.equal(await pending, 's3cret');
});

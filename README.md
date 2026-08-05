# @chad3814/secret-provider

Composable async credential providers: a chain of sources where the first to
resolve wins, with memoization and an explicit distinction between "this source
isn't configured" and "this source is broken".

A provider is just an async thunk:

```ts
type Provider<T> = () => Promise<T>;
```

Which means anything can be a link — an env var, a file, a subprocess, an HTTP
call to a vault. The shape is deliberately the same as the AWS SDK's
`fromEnv()` / `fromIni()` credential providers, generalised to any secret.

ESM-only, zero runtime dependencies, Node >= 22.18.

## Install

```sh
npm install @chad3814/secret-provider
```

## Usage

```ts
import {
  chain,
  fromEnv,
  fromFile,
  fromStatic,
  memoize,
} from '@chad3814/secret-provider';

const apiKey = memoize(
  chain(
    fromEnv('POSTFUL_API_KEY'),
    fromFile('/run/secrets/postful_api_key'),
    fromStatic('development-key'),
  ),
);

// Resolved once, on first use, then cached.
const key = await apiKey();
```

Because a provider is only a function, a source this package doesn't ship is
still a one-liner — and the secret goes straight from its source into the
closure without ever landing in a file on disk:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chain, fromEnv, memoize, type Provider } from '@chad3814/secret-provider';

const run = promisify(execFile);

const fromOnePassword = (reference: string): Provider<string> => async () => {
  const { stdout } = await run('op', ['read', reference]);
  return stdout.trimEnd();
};

const apiKey = memoize(
  chain(fromEnv('POSTFUL_API_KEY'), fromOnePassword('op://Private/Postful/credential')),
);
```

## Absent vs. broken

The distinction the pattern lives or dies on. A source that simply isn't
configured should be skipped; a source that answered and refused should stop
everything, rather than silently handing back a weaker credential.

`ProviderError` carries `tryNextLink` to say which happened:

```ts
throw new ProviderError('POSTFUL_API_KEY not set');        // skip to next link
throw new ProviderError('vault rejected the token', false); // halt the chain
```

Any error that isn't a `ProviderError` is treated as absent, so an ordinary
throw in a custom provider falls through. When every link fails, `chain` throws
with all the failure messages aggregated, so you can see each source that was
tried and why it didn't answer:

```text
no provider resolved a value (POSTFUL_API_KEY not set; /run/secrets/api_key does not exist)
```

## API

### `chain<T>(...providers: Provider<T>[]): Provider<T>`

First provider to resolve wins. Skips links that report themselves absent,
halts immediately on a `ProviderError` with `tryNextLink: false`, and throws an
aggregated error if the links run out.

### `memoize<T>(provider, isExpired?): Provider<T>`

Caches the resolved value. Concurrent callers share a single in-flight
resolution, so ten requests at cold start make one round-trip rather than ten.
Rejections are not cached, leaving a failed lookup retryable. Pass `isExpired`
to re-resolve a value that has gone stale:

```ts
const token = memoize(fetchToken, (t) => t.expiresAt < Date.now());
```

### `fromEnv(name: string): Provider<string>`

### `fromEnv<T>(read: (env: Environment) => T | undefined, label: string): Provider<T>`

Reads the process environment on every resolution, so a variable set later is
picked up. The reader form can parse into any type:

```ts
const port = fromEnv((env) => {
  const raw = env.PORT;
  return raw === undefined ? undefined : Number.parseInt(raw, 10);
}, 'PORT');
```

### `fromFile(path: string): Provider<string>`

Reads a credential from disk — a Docker or Kubernetes secret mount, a
`/run/secrets` entry. Trailing whitespace is trimmed, so a file written with a
final newline yields the credential rather than one with a stray `\n`. Interior
newlines are preserved, so a multi-line PEM key survives intact.

### `fromPrompt(prompt: string, options?: PromptOptions): Provider<string>`

Asks the person at the keyboard. Reads from the terminal with echo suppressed,
so nothing typed is displayed — not even its length. The prompt is written to
**stderr**, the convention for password prompts, so a CLI's stdout stays clean
for piping.

```ts
const apiKey = memoize(
  chain(
    fromEnv('POSTFUL_API_KEY'),
    fromFile('/run/secrets/postful_api_key'),
    fromPrompt('Postful API key: '),
  ),
);
```

`memoize` matters more here than anywhere else: without it, every resolution
asks again.

Because there is nothing to prompt *on* in CI, behind a pipe, or in a daemon, a
missing TTY simply falls through to the next link — so the same chain works in
both a developer's terminal and a deployed process. Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `mask` | `false` | `false` echoes nothing at all. A character such as `'*'` echoes one per keystroke, at the cost of revealing the length. |
| `input` | `process.stdin` | Where keystrokes come from. |
| `output` | `process.stderr` | Where the prompt is written. |

Editing keys behave the way muscle memory from readline expects:

| Key | Effect |
| --- | --- |
| Backspace / Ctrl-H | delete the last character |
| Ctrl-U | discard the whole line and start again |
| Enter, Ctrl-D | submit |
| Ctrl-C | **halt the chain** |

Ctrl-C halts rather than falling through: an explicit refusal should not quietly
fall back to some other credential source.

Every other control character is **dropped**, and ANSI escape sequences are
swallowed whole. Cursor keys, Home, End and function keys are meaningless when
nothing is rendered, and the alternative is worse than useless — an arrow key
sends `ESC [ A`, so appending what arrives would silently bury `[A` inside the
credential where nobody can see it.

### `fromStatic<T>(value: T): Provider<T>`

Wraps an already-known value. Useful as an explicit last link, and for
supplying a credential in tests.

## When a source counts as absent

The built-in providers treat a present-but-empty value as absent, on the grounds
that an empty credential is a misconfiguration and would otherwise surface as a
confusing downstream auth failure.

| Condition | Result |
| --- | --- |
| `fromEnv` — variable unset | falls through |
| `fromEnv` — variable set to `''` | falls through |
| `fromFile` — path does not exist | falls through |
| `fromFile` — file empty or whitespace-only | falls through |
| `fromFile` — no permission, is a directory, bad path prefix | **halts the chain** |
| `fromPrompt` — no TTY to prompt on | falls through |
| `fromPrompt` — submitted empty | falls through |
| `fromPrompt` — cancelled with Ctrl-C | **halts the chain** |

## Accepting a provider in your own library

If you are writing a client or library that needs a credential, take a provider
rather than a resolved string. The caller then decides where the secret comes
from — env, file, vault, `op read` — and you stop forcing them to have it in
hand before they can construct your object.

**You do not need to depend on this package to accept one.** `Provider<T>` is
structurally just a function, so declaring it inline is enough, and your users
can pass anything of that shape whether or not they use this library:

```ts
type Provider<T> = () => Promise<T>;

export interface PostfulClientOptions {
  /** An API key, or anything that resolves one. A string is used as-is. */
  apiKey: string | Provider<string>;
}
```

Normalise once at the boundary, then resolve at each point of use:

```ts
import { fromStatic, memoize, type Provider } from '@chad3814/secret-provider';

export class PostfulClient {
  readonly #apiKey: Provider<string>;

  constructor(options: PostfulClientOptions) {
    this.#apiKey = memoize(
      typeof options.apiKey === 'string'
        ? fromStatic(options.apiKey)
        : options.apiKey,
    );
  }

  async send(body: string): Promise<Response> {
    // Resolved per request, so a rotated credential is picked up without
    // rebuilding the client.
    const apiKey = await this.#apiKey();

    return fetch('https://api.postful.ai/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body,
    });
  }
}
```

A few things worth getting right:

- **Resolve at use, not in the constructor.** Resolving once up front makes
  construction async and freezes the credential for the object's lifetime, so
  expiry and rotation never take effect.
- **Take `() => Promise<T>`, not `Promise<T>`.** A promise resolves once,
  eagerly, and cannot be re-resolved after expiry or retried after a failure.
  The thunk is what makes those possible.
- **Call `memoize` yourself, once.** Then resolving per request costs nothing,
  and a caller who forgot to memoize does not get a vault round-trip per call.
  Pass `isExpired` through if your credential has a lifetime.
- **Let `ProviderError` propagate.** Catching it and rethrowing something
  generic destroys both the `tryNextLink` distinction and the aggregated list of
  sources that were tried — which is the part that makes a misconfiguration
  diagnosable.
- **Keep the resolved value local.** Don't log it, don't put it in an error
  message, don't attach it to anything that gets serialised. It should live in
  the closure and the outbound request, nowhere else.

## Types

`Environment` is a structural `Readonly<Record<string, string | undefined>>`
rather than `NodeJS.ProcessEnv`, so you don't need `@types/node` installed to
typecheck against this package.

`Provider<T>` is exported as a type for convenience, but as above it is only
`() => Promise<T>` — nothing stops a consumer from satisfying it structurally.

`PromptInput` and `PromptOutput` are likewise structural, describing only the
handful of members `fromPrompt` touches. `process.stdin` and `process.stderr`
satisfy them without a cast, and so does a test double.

## License

MIT

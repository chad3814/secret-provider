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

```
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

### `fromStatic<T>(value: T): Provider<T>`

Wraps an already-known value. Useful as an explicit last link, and for
supplying a credential in tests.

## When a source counts as absent

Both built-in readers treat a present-but-empty value as absent, on the grounds
that an empty credential is a misconfiguration and would otherwise surface as a
confusing downstream auth failure.

| Condition | Result |
| --- | --- |
| `fromEnv` — variable unset | falls through |
| `fromEnv` — variable set to `''` | falls through |
| `fromFile` — path does not exist | falls through |
| `fromFile` — file empty or whitespace-only | falls through |
| `fromFile` — no permission, is a directory, bad path prefix | **halts the chain** |

## Types

`Environment` is a structural `Readonly<Record<string, string | undefined>>`
rather than `NodeJS.ProcessEnv`, so you don't need `@types/node` installed to
typecheck against this package.

## License

MIT

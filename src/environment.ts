/**
 * The shape of a process environment, as much of it as a reader needs.
 *
 * Deliberately structural rather than `NodeJS.ProcessEnv`: keeping the public
 * surface free of `NodeJS.*` means a consumer does not need `@types/node`
 * installed to typecheck against this package. `process.env` is assignable to
 * it.
 */
export type Environment = Readonly<Record<string, string | undefined>>;

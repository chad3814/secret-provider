# Releasing

Maintainer notes. This file is not published to npm.

## Why the tag is created separately

`npm version patch` bumps `package.json` **and** commits **and** tags, all on
whatever branch you are standing on. That breaks once `main` is protected:

- The bump commit has to go through a pull request.
- A **squash** or **rebase** merge rewrites that commit into a new SHA, so the
  commit the tag points at never lands on `main`.
- The tag is then stranded on an orphaned commit.

`.github/workflows/publish.yml` refuses to stage a publish from a tag that is
not contained in `main`, so this shows up as a failed run rather than a release
built from a commit that isn't on the mainline.

Only a merge commit (`--no-ff`) preserves the original SHA. Rather than depend on
always picking that strategy, bump and tag as two separate steps.

## Steps

1. On a branch, bump the version without letting npm commit or tag:

   ```sh
   npm version patch --no-git-tag-version   # or minor / major
   ```

2. Commit the bump and open a pull request:

   ```sh
   git commit -am "$(node -p 'require("./package.json").version')"
   gh pr create --fill
   ```

3. Merge it. Any strategy is fine — squash, rebase, or merge commit.

4. Tag `main` itself, where the released commit actually is:

   ```sh
   git checkout main
   git pull --ff-only
   npm run tag          # signed annotated tag, version read from package.json
   git push origin "v$(node -p 'require("./package.json").version')"
   ```

   Pushing the tag triggers `Stage publish`. It verifies the tag matches
   `package.json`, confirms the commit is contained in `main`, runs the full
   gate, and stages the tarball.

5. Approve the staged release. This cannot be automated — it needs a 2FA
   challenge, which is the point of staging:

   ```sh
   npm stage list
   npm stage download <stage-id>   # optional: inspect the tarball first
   npm stage approve <stage-id>
   ```

   Or approve it on npmjs.com.

6. Optionally cut a GitHub Release against the tag for changelog purposes. It
   does not trigger anything:

   ```sh
   gh release create "v$(node -p 'require("./package.json").version')" --generate-notes
   ```

## Notes

- `npm run tag` uses `git tag -s`, which signs with the configured SSH signing
  key, matching how commits in this repo are signed.
- The workflow can also be run manually via `workflow_dispatch`. A manual run
  skips the tag/version and containment checks, since there is no tag involved —
  useful for re-staging after a rejected stage, but it trusts you to have
  `main` checked out at the right commit.
- A version already on npm cannot be staged again. If a stage is rejected, fix
  the problem and bump the version rather than retrying the same one.

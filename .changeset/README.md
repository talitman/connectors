# Changesets

Every change to a published package needs a changeset. Run `pnpm changeset`, pick the affected packages and a bump type (patch, minor, major), and write one sentence for the changelog. Commit the generated file under `.changeset/` with your change.

On merge to `main`, the release workflow opens or updates a "Version Packages" pull request that applies the pending changesets. Merging that PR publishes the bumped packages to npm.

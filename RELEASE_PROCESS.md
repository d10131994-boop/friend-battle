# Release process

## Pull requests into main

- Every pull request targeting `main` must come from a source branch whose name contains `release` (case-insensitive).
- The GitHub Actions check is named **Release branch name**.
- The check only reports whether the source branch name is allowed. To make it a merge requirement, configure a ruleset or branch protection rule for `main` that:
  - requires pull requests before merging;
  - requires the **Release branch name** status check and the normal CI checks;
  - blocks direct pushes and does not allow routine bypasses.
- The repository settings must be configured by an administrator. A workflow alone cannot prevent merging when required checks and branch protection are not enabled.

## Preparing the version for a release

1. Create/update the release branch from the latest `main`.
2. Run **Actions → Prepare release version → Run workflow** on that release branch before opening (or updating) its PR to `main`.
3. For a branch named `friend-battle-05-release`, the workflow infers `0.5.0`. The convention is `friend-battle-NN-release` → `0.NN.0`.
4. For any other branch name that merely contains `release`, provide an explicit SemVer version (for example, `0.5.0`) when running the workflow.
5. The workflow updates both `package.json` and `package-lock.json` and commits the change to the release branch. Then open/update the PR to `main`; CI validates the resulting PR contents.
6. Merge the PR. Vercel's Production Branch should remain `main`, so the merge produces the production deployment. The version is already part of the merged commit; no post-merge version commit or second production deployment is needed.

## Version convention

The package version is the source of truth. Release branch names only provide a convenient default for calculating the next version; they do not replace the package version. Use an explicit version input when the branch does not follow the `friend-battle-NN-release` convention.

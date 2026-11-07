# Pinned CI and image tools: manual bumps

Dependabot (`.github/dependabot.yml`) updates npm packages, the `node` base image in `infrastructure/docker/Dockerfile.*` (literal `FROM` lines) and the GitHub Actions, which are pinned to commit SHAs. It cannot see the pins below, so they are bumped by hand. Check them monthly, and at once when an advisory names one of them.

Pick only stable releases that are at least two weeks old, and take every digest or checksum from the vendor's own release. Bump each pin in its own pull request, so that the CI run shows the new version working.

| Pin                                                                      | Where                                                                                | How to bump                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trivy image `aquasec/trivy:<version>@sha256:<digest>`                    | `TRIVY_IMAGE` in the `security` job of `.github/workflows/ci.yml`                    | Read the release at <https://github.com/aquasecurity/trivy/releases>, then run `docker buildx imagetools inspect aquasec/trivy:<version>` and copy the index `Digest`. Update both the tag and the digest. |
| osv-scanner image `ghcr.io/google/osv-scanner:<version>@sha256:<digest>` | `OSV_IMAGE` in the `security-source` job                                             | Read the release at <https://github.com/google/osv-scanner/releases>, then run `docker buildx imagetools inspect ghcr.io/google/osv-scanner:<version>` and copy the `Digest`.                              |
| gitleaks binary version and SHA-256                                      | `GITLEAKS_VERSION` and `GITLEAKS_SHA256` in the `security-source` job                | Download `gitleaks_<version>_checksums.txt` from <https://github.com/gitleaks/gitleaks/releases> and copy the line for `gitleaks_<version>_linux_x64.tar.gz`. Update both values.                          |
| `corepack@<version>`                                                     | The `base` stage of each `infrastructure/docker/Dockerfile.*` (all three)            | Run `npm view corepack version time --json`. Node 25 and later no longer bundle corepack, so the images install it.                                                                                        |
| pnpm `10.28.2`                                                           | `packageManager` in `package.json`, and `corepack prepare pnpm@…` in each Dockerfile | Change them together. Dependabot does not bump `packageManager`.                                                                                                                                           |

After a bump:

- CI must be green, including `build` (which smoke-tests the images) and both security jobs.
- An ignore in `.trivyignore` or `osv-scanner.toml` that a new version makes unnecessary is removed in the same pull request.
- Ignores carry a reason and an expiry date (Ruling R29). An expired ignore fails the scan, which is intended: re-assess it, then fix or extend it with a new reason.

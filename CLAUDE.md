# Working on Homeport

## Versioning: every commit that changes behaviour bumps a version

Two version files, both date-based (`YYYY.MM.DD`, then `.2`, `.3`… for further builds the same
day, back to the plain date the next day). Bump in the **same commit** as the change, not
afterwards:

| Changed | Bump | Why separate |
|---|---|---|
| App code: `server/`, `public/`, `Dockerfile`, `package*.json` | `VERSION` (repo root) | Shown in Settings via `/api/version`; tagged on the published image |
| Deployment scripts: anything under `deploy/` | `deploy/VERSION` | `publish.yml` skips the image build for `deploy/`-only pushes, so script changes don't restart running containers. Bumping the root `VERSION` for them would trigger that rebuild |
| Both | Both | |

Docs-only changes (README, comments) don't need a bump, and Markdown-only pushes skip the image build too.

Before finishing any task that changed code, check `git diff --stat` and confirm the matching
version file is in it.

## Deploying

- The repo is public, but **not open source**: there's no license, all rights reserved.
  Don't add one.
- Images are built by GitHub Actions and published to `ghcr.io/johnjelercic/homeport`. Nothing
  builds on the devices themselves.
- John pushes from his Mac. Commit locally; don't expect GitHub credentials in the sandbox.
- Raspberry Pi appliance: `deploy/pi/` (see its README and WIFI-SETUP.md). DIY Docker:
  `deploy/docker/`.
- Shell scripts must pass `shellcheck`. `install.sh` must stay safe to re-run, and anything it
  adds must be reversed by `uninstall.sh`.

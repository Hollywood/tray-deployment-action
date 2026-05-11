# Tray.ai SDLC GitHub Action

[![CI](https://github.com/tray-io/tray-sdlc-action/actions/workflows/ci.yml/badge.svg)](https://github.com/tray-io/tray-sdlc-action/actions/workflows/ci.yml)

A GitHub Action that automates Tray.ai's project promotion pipeline (export -> validate -> import -> version -> optionally publish solution) using the public [Projects](https://tray.io/documentation/developer/platform-apis/projects) and [Solutions](https://tray.io/documentation/developer/platform-apis/solutions) APIs.

## What it does

For a single Tray project version, the action runs the [recommended SDLC pipeline](https://tray.io/documentation/platform/enterprise-core/lifecycle-management/automated-pipeline):

1. List source project versions and resolve the requested version (or `latest`).
2. Export the source version as JSON.
3. (Optional) Check import requirements and verify required auth mappings are provided.
4. Preview the import; surface project/solution impact and breaking-change flags in the GitHub job summary.
5. Import the project into the destination workspace with the supplied auth, config, connector, and service mappings.
6. Create a matching version in the destination workspace (defaults to the source version number for consistency).
7. (Optional, when `scope: platform-and-solutions`) Run a Solutions publish preview and publish the solution.

The action fails fast on breaking changes by default and supports `dry-run` mode to validate a deployment without making changes.

## Prerequisites

- A source and destination Tray workspace, each containing the target project (projects cannot currently be created via API and must be set up manually in both workspaces).
- A user or master token with access to both workspaces. Tokens are environment- and region-specific. Store the token as a GitHub secret (e.g. `TRAY_API_TOKEN`).
- All required authentications must already exist in the destination workspace; their IDs are mapped via `auth-mappings` (or via the config file).
- At least one saved version of the source project (created via the UI or `POST /core/v1/projects/{id}/versions/{n}`).

## Quick start

```yaml
name: Deploy Tray project to staging

on:
  workflow_dispatch:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: tray-io/tray-sdlc-action@v1
        with:
          api-token: ${{ secrets.TRAY_API_TOKEN }}
          config-path: .tray/deployment.yml
```

With a config file at `.tray/deployment.yml`:

```yaml
apiBaseUrl: https://api.tray.io
sourceProjectId: 11111111-1111-1111-1111-111111111111
destinationProjectId: 22222222-2222-2222-2222-222222222222
sourceVersion: latest
scope: platform-and-solutions
solutionId: 33333333-3333-3333-3333-333333333333
failOnBreakingChanges: true
authMappings:
  - authExportId: salesforce-prod
    authenticationId: 44444444-4444-4444-4444-444444444444
configOverrides:
  ENVIRONMENT: staging
```

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `api-token` | yes | - | Tray.ai user or master token. Pass via a secret. |
| `api-base-url` | no | `https://api.tray.io` | Region-specific API base URL. |
| `config-path` | no | `.tray/deployment.yml` | Path to a YAML/JSON config file. Empty string disables file loading. |
| `source-project-id` | no | from config | UUID of the source project. |
| `destination-project-id` | no | from config | UUID of the destination project. |
| `source-version` | no | `latest` | Source version number, or `latest` to auto-resolve the newest. |
| `destination-version` | no | source version | Version number to create in the destination after import. |
| `version-title` | no | auto | Title for the destination version. |
| `version-description` | no | auto | Description for the destination version. |
| `scope` | no | `platform-only` | `platform-only` or `platform-and-solutions`. |
| `solution-id` | no | from config | Required when `scope=platform-and-solutions`. |
| `auth-mappings` | no | from config | JSON array `[{authExportId, authenticationId}]`. |
| `config-overrides` | no | from config | JSON object passed as `configOverride`. |
| `connector-mappings` | no | from config | JSON array of `{from:{name,version},to:{name,version}}`. |
| `service-mappings` | no | from config | JSON array of `{from:{name,version},to:{name,version}}`. |
| `fail-on-breaking-changes` | no | `true` | Abort before import if the preview reports breaking changes. |
| `dry-run` | no | `false` | Stop after preview; no import, version, or publish. |
| `skip-requirements-check` | no | `false` | Skip the `POST /imports/requirements` call. |

Action inputs always override the matching values in the config file. Secrets (the API token) are never read from the config file.

## Outputs

| Name | Description |
| --- | --- |
| `source-version-number` | Version number exported from the source workspace. |
| `destination-version-number` | Version number created in the destination workspace. |
| `import-metadata-json` | JSON-encoded `importMetadata` object from `POST /imports`. |
| `project-impact-json` | JSON-encoded `projectImpact` object. |
| `solution-impact-json` | JSON-encoded `solutionImpact` object (when applicable). |
| `release-id` | Solution release ID (when `scope=platform-and-solutions`). |

## Examples

See [`examples/`](examples/) for a complete config file and consumer workflow.

## Development

```bash
npm ci
npm run all   # format, lint, typecheck, test, build
```

The compiled bundle at `dist/index.js` is committed to the repo (required for Node-based GitHub Actions). CI verifies that the committed bundle matches `npm run build` output.

## License

MIT - see [LICENSE](LICENSE).

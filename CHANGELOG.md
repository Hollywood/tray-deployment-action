# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release of the Tray.ai SDLC GitHub Action.
- Support for the full Projects API promotion pipeline: list versions, export, requirements, preview, import, and create destination version.
- Optional Solutions publish preview and publish steps via `scope: platform-and-solutions`.
- Layered configuration via `.tray/deployment.yml` plus action inputs (inputs override file).
- `dry-run`, `fail-on-breaking-changes`, and `skip-requirements-check` modes.
- Markdown job summary with project and solution impact details.

[Unreleased]: https://github.com/tray-io/tray-sdlc-action/compare/v1.0.0...HEAD

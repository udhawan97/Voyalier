# Contributing to Voyalier

Thanks for helping build a calmer, more trustworthy way to plan travel.

## Before opening a pull request

1. Search existing issues and discussions.
2. For a significant product, security, storage, provider, or contract change, open an issue or ADR first.
3. Keep changes focused. Do not mix generated assets, dependency upgrades, refactors, and product behavior without a clear reason.
4. Add tests and update relevant documentation.

## Local setup

```bash
make bootstrap
make dev
make check
```

See [AGENTS.md](AGENTS.md) for architecture and trust boundaries.

## Pull requests

Pull requests should explain:

- what changed and why;
- user, privacy, data-license, and performance impact;
- how the change was tested;
- screenshots or recordings for visible UI changes;
- new external services, model files, or data sources.

## Commit style

Use short, imperative commit subjects. Conventional Commit prefixes are welcome but not required.

## Data and AI contributions

Do not submit scraped datasets, credentials, personal travel documents, copyrighted destination copy, or model weights without a verified redistribution license. Synthetic fixtures must not resemble a real person's itinerary or confirmation number.

## License

By contributing, you agree that your contribution is licensed under Apache-2.0.

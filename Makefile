.PHONY: bootstrap dev web docs check rust-check clean

bootstrap:
	./scripts/bootstrap.sh

dev:
	pnpm dev

web:
	pnpm dev:web

docs:
	pnpm dev:docs

check:
	./scripts/check.sh

rust-check:
	cargo fmt --all -- --check
	cargo clippy -p voyalier-core -p voyalier-server --all-targets -- -D warnings
	cargo test -p voyalier-core -p voyalier-server

clean:
	rm -rf target apps/web/dist docs-site/dist

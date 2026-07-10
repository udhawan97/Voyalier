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
	cargo clippy --locked -p voyalier-core -p voyalier-app -p voyalier-server -p voyalier-desktop --all-targets -- -D warnings
	cargo test --locked -p voyalier-core -p voyalier-app -p voyalier-server -p voyalier-desktop

clean:
	rm -rf target apps/web/dist docs-site/dist

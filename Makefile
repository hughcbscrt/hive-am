# hive-am: releases and npm publishing.
#   make help
.DEFAULT_GOAL := help
SHELL := /bin/bash

VERSION := $(shell node -p "require('./package.json').version")
BUMP    ?= patch
NPM_TAG ?= latest
FORCE   ?=
ALLOW_BRANCH ?=
PUSH    ?= 1

.PHONY: help typecheck build changelog-add changelog-show release-preview release npm-build npm-pack npm-check npm-publish publish clean

help: ## Show this help
	@echo "hive-am $(VERSION)"
	@echo
	@echo "0) Changelog (Keep a Changelog: Added, Changed, Deprecated, Removed, Fixed, Security)"
	@echo "     make changelog-add [TYPE=Added|Changed|Deprecated|Removed|Fixed|Security] [MSG=\"...\"]   add an entry to 'Unreleased'"
	@echo "     make changelog-show                                       print what is waiting for the next release"
	@echo
	@echo "1) Release (asks for the changes, bumps versions, updates CHANGELOG.md, commits, tags and pushes)"
	@echo "     make release-preview [BUMP=patch|minor|major|x.y.z]   show the new version and the changelog entry"
	@echo "     make release [BUMP=patch|minor|major|x.y.z]           do it (clean tree on main, everything pushed)"
	@echo "       YES=1            do not ask for confirmation"
	@echo "       PUSH=0           commit and tag locally without pushing"
	@echo "       ALLOW_BRANCH=1   release from a branch other than main"
	@echo
	@echo "2) Publish to npm (needs 'npm login' first)"
	@echo "     make npm-build                    assemble the package in dist/npm"
	@echo "     make npm-pack                     build and list what would be published (npm pack --dry-run)"
	@echo "     make npm-publish [NPM_TAG=next]   build and publish dist/npm (HEAD must be the release tag; FORCE=1 to skip)"
	@echo
	@echo "Other: make typecheck | build | clean"

typecheck: ## Type-check server and web
	npm run typecheck

build: ## Build the web UI (development build folder)
	npm run build

changelog-add: ## Add an entry to the unreleased section
	node scripts/changelog.mjs add "$(TYPE)" "$(MSG)"

changelog-show: ## Print the unreleased section
	node scripts/changelog.mjs show

release-preview: ## Show what a release would do
	node scripts/release.mjs $(BUMP) --dry-run

release: ## Bump versions, update the changelog, commit, tag and push
	node scripts/release.mjs $(BUMP) $(if $(filter 0,$(PUSH)),--no-push,) $(if $(ALLOW_BRANCH),--allow-branch,) $(if $(YES),--yes,)

npm-build: ## Assemble the npm package in dist/npm
	node scripts/build-npm.mjs

npm-pack: npm-build ## List the files that would be published
	cd dist/npm && npm pack --dry-run

npm-check: ## Checks before publishing: npm login, version not published, HEAD is the release tag
	@npm whoami >/dev/null 2>&1 || { echo "Not logged in to npm: run 'npm login' first."; exit 1; }
	@if npm view hive-am@$(VERSION) version >/dev/null 2>&1; then echo "hive-am@$(VERSION) is already published. Run 'make release' to bump the version."; exit 1; fi
	@if [ -z "$(FORCE)" ]; then \
	  [ -z "$$(git status --porcelain)" ] || { echo "The working tree has uncommitted changes (FORCE=1 to ignore)."; exit 1; }; \
	  [ "$$(git describe --exact-match --tags 2>/dev/null)" = "v$(VERSION)" ] || { echo "HEAD is not tagged v$(VERSION). Run 'make release' first (FORCE=1 to ignore)."; exit 1; }; \
	fi

npm-publish: npm-check npm-build ## Build and publish dist/npm to npm
	cd dist/npm && npm publish --access public --tag $(NPM_TAG)
	@echo "Published hive-am@$(VERSION) with tag $(NPM_TAG)."

publish: npm-publish ## Alias of npm-publish

clean: ## Remove dist/
	rm -rf dist

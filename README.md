# @oomol-lab/resource-cache

[![Docs](https://img.shields.io/badge/Docs-read-%23fdf9f5)](https://oomol-lab.github.io/resource-cache)
[![Build Status](https://github.com/oomol-lab/resource-cache/actions/workflows/build.yml/badge.svg)](https://github.com/oomol-lab/resource-cache/actions/workflows/build.yml)
[![npm-version](https://img.shields.io/npm/v/@oomol-lab/resource-cache.svg)](https://www.npmjs.com/package/@oomol-lab/resource-cache)
[![Coverage Status](https://oomol-lab.github.io/resource-cache/coverage-badges/@oomol-lab/resource-cache.svg)](https://oomol-lab.github.io/resource-cache/coverage/)
[![minified-size](https://deno.bundlejs.com/badge?q=@oomol-lab/resource-cache&treeshake=[*])](https://deno.bundlejs.com/?q=@oomol-lab/resource-cache&treeshake=[*])

Persistent and session-scoped resource caching with freshness tracking and conditional revalidation.

## Install

```
npm add @oomol-lab/resource-cache
```

## Development

### Publish New Version

You can use [npm version](https://docs.npmjs.com/cli/v10/commands/npm-version) to bump version.

```
npm version patch
```

Push the tag to remote and CI will publish the new version to npm.

```
git push --follow-tags
```

### CI Auto Publish

If you want to publish the package in CI, you need to enable [trusted publishing](https://docs.npmjs.com/trusted-publishers) in npmjs.com. However, the [settings page](https://www.npmjs.com/package/@oomol-lab/resource-cache/access) is only visible when the package already exists. So you will have to publish the package manually for the first time.

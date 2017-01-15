# download-counts

> Average daily download counts for every npm package.

This package:

- collects download counts from npm's [download-counts](https://github.com/npm/download-counts) web service.
- collects one year's worth of download data for each package.
- is a key-value object. Keys are package names, values are average daily downloads.
- works offline. It's just an offline dataset, and doesn't make any network requests.
- weighs about 8 MB.
- is updated every day using a Heroku bot. See
[script/release.sh](https://github.com/zeke/download-counts/blob/master/script/release.sh) and
[zeke.sikelianos.com/npm-and-github-automation-with-heroku/](http://zeke.sikelianos.com/npm-and-github-automation-with-heroku/) for info on how that works.
- does not include scoped packages (e.g. `@foo/bar`), as npm does
[not provide them](https://github.com/npm/registry/issues/59).

```js
const counts = require('download-counts')

// get average daily downloads for a package
counts.express
// 218212

// top ten most downloaded packages
Object.keys(counts).slice(0, 10)
// [ 'glob',
//   'readable-stream',
//   'async',
//   'lodash',
//   'minimatch',
//   'minimist',
//   'source-map',
//   'qs',
//   'inherits',
//   'isarray' ]
```

## Installation

```sh
yarn add download-counts
```

## Tests

```sh
yarn && yarn test
```

## Dependencies

None

## Dev Dependencies

- [chai](https://github.com/chaijs/chai): BDD/TDD assertion library for node.js and the browser. Test framework agnostic.
- [got](http://ghub.io/got): Simplified HTTP requests
- [human-interval](https://github.com/rschmukler/human-interval): Human readable time measurements
- [lodash](http://ghub.io/lodash): Lodash modular utilities.
- [mocha](https://github.com/mochajs/mocha): simple, flexible, fun test framework
- [package-stream](https://github.com/zeke/package-stream): An endless stream of clean package data from the npm registry.
- [require-dir](https://github.com/aseemk/requireDir): Helper to require() directories.
- [standard](https://github.com/feross/standard): JavaScript Standard Style
- [standard-markdown](http://ghub.io/standard-markdown): Test your Markdown files for Standard JavaScript Style™

## License

MIT

# download-counts

> Average daily download counts for every npm package. Works offline.

This package collects download counts from npm's
[download-counts](https://github.com/npm/download-counts) web service.
For each package, **one year's worth** of downloads are fetched,
then averaged. The result is an object with package names as keys
and average downloads per day as values:

```js
const counts = require('download-counts')

// get average daily downloads for a package
counts.express
// 218212

// top ten packages
Object.keys(counts).slice(0, 5)
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

Note: Scoped packages (e.g. `@foo/bar`) are not included, as npm does
not provide download counts for those.

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

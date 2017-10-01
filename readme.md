# download-counts

> Average daily download counts for every npm package.

This package:

- collects download counts from npm's [download-counts](https://github.com/npm/download-counts) web service.
- collects one year's worth of download data for each package.
- is a key-value object. Keys are package names, values are average daily downloads.
- works offline. It's just a big JSON object.
- weighs about 12 MB.
- includes scoped package names
- is regularly updated using a Heroku bot. See
[script/release.sh](https://github.com/zeke/download-counts/blob/master/script/release.sh) and
[zeke.sikelianos.com/npm-and-github-automation-with-heroku/](http://zeke.sikelianos.com/npm-and-github-automation-with-heroku/) for info on how that works.

## Installation

```sh
yarn add download-counts
```

## Usage

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

## Stats

87% of the packages in the registry are downloaded 0-1 times per day.

Downloads per Day | Packages
--- | ---
0-0 | 269045
1-9 | 210471
10-99 | 44155
100-249 | 6589
250-499 | 3426
500-999 | 2676
1000-4999 | 3457
5000-9999 | 951
10000-24999 | 755
25000-49999 | 481
50000-99999 | 385
100000-10000000 | 768


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

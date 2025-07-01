# download-counts

The https://npmjs.org/package/download-counts package, updated with a new version twice per month, just exports a single giant static object whose keys are package names and whose values are monthly download counts.

To check monthly download counts of individual packages:

```
> const downloadCounts = require('download-counts')
undefined
> downloadCounts.lodash
310086369
> downloadCounts.react
169846525
> downloadCounts.typescript
365742011
> downloadCounts.nonexistentpackage
undefined
```

To get the top *n* packages, just sort the package & count pairs by count, then take the top *n*. e.g.:

```javascript
/** Print the top n packages by download count */
function printTopPackages(n) {
  for (const [name, count] of Object.entries(downloadCounts).sort(
    ([_, cnt1], [__, cnt2]) => cnt2 - cnt1
  ).slice(0, n)) {
    console.log(name, count);
  }
}
```

```
> printTopPackages(10)
semver 1819920988
ansi-styles 1714990182
debug 1587998302
chalk 1430249785
supports-color 1427520560
minimatch 1238345778
ms 1212057951
tslib 1140382329
strip-ansi 1114443532
ansi-regex 1028842864
```


### History/Maintenance/Contributing/Debugging

A version of download-counts was written by [@zeke](https://github.com/zeke) in 2017, then abandoned. It was replaced by a new version by [@ExplodingCabbage](https://github.com/ExplodingCabbage) in 2025.

The build process for generating a new release runs twice per month. It runs in GitHub Actions (for free), where a scheduled job repeatedly calls a single script that, whenever it's called, advances the build a bit by fetching more download counts from the npm API and recording them in source control on a branch specific to that release.

Please report bugs (including the npm package not getting updated with new versions) as [GitHub issues](https://github.com/nice-registry/download-counts/issues).

Hopefully all this will keep working for years and publishing new versions without needing any maintenance. If not, [@ExplodingCabbage](https://github.com/ExplodingCabbage) has maintainer access on GitHub and will try to fix it. He can be contacted at markrobertamery@gmail.com.

Failures in the build process will result in a failed GitHub Action, visible at https://github.com/nice-registry/download-counts/actions. The logged output there may be sufficient to debug; if not, you can checkout the latest build branch locally and run `node buildAndRelease.js` yourself. Credentials are only needed for pushing commits to GitHub and publishing to npm; the rest of what the script does does not require any creds. Change the remote `origin` to a fork you have push access to before testing in order to allow Git pushes to succeed.

# download-counts

The https://npmjs.org/package/download-counts package, updated with a new version twice per month, just exports a single giant static object whose keys are package names and whose values are monthly download counts.

Usage:

```
TODO: add usage example here using the real package, showing counts for like react or lodash or leftpad or something
TODO: also add copy-and-paste-ready example showing getting the top 100 packages which is what 99% of users will wanna do
```

### History/Maintenance/Contributing/Debugging

A version of download-counts was written by [@zeke](https://github.com/zeke) in 2017, then abandoned. It was replaced by a new version by [@ExplodingCabbage](https://github.com/ExplodingCabbage) in 2025.

The build process for generating a new release runs twice per month. It runs in GitHub Actions (for free), where a scheduled job repeatedly calls a single script that, whenever it's called, advances the build a bit by fetching more download counts from the npm API and recording them in source control on a branch specific to that release.

Please report bugs (including the npm package not getting updated with new versions) as [GitHub issues](https://github.com/nice-registry/download-counts/issues).

Hopefully all this will keep working for years and publishing new versions without needing any maintenance. If not, [TODO: who is gonna maintain stuff? In particular, who will have publish rights on npm & ability to update secrets on GitHub? Their names should be mentioned here I guess.]

Failures in the build process will result in a failed GitHub Action, visible at https://github.com/nice-registry/download-counts/actions. The logged output there may be sufficient to debug; if not, you can checkout the latest build branch locally and run `node buildAndRelease.js` yourself. Credentials are only needed for pushing commits to GitHub and publishing to npm; the rest of what the script does does not require any creds. Change the remote `origin` to a fork you have push access to before testing in order to allow Git pushes to succeed.

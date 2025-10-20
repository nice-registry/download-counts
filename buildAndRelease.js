import fs from 'node:fs';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import pkg from './package.json' with {type: 'json'};

// File we use to record (on a branch in source control) the progress of the
// build process, which takes place over many invocations of this script:
const STATE_PATH = 'state.json';

// Maximum number of packages that can be listed in a single bulk query to the
// npm API's download endpoint, per
// https://github.com/npm/registry/blob/main/docs/download-counts.md
const BULK_QUERY_BATCH_SIZE = 128;

/**
 * The version number we'll use on npm for the release we're currently building.
 */
function getVersion() {
  // We do two releases per month, which should start building on the 1st and
  // 15th of the month, and use data from whatever the latest
  // all-the-package-names release is when the build starts.
  // Version number format is 2.YYYYMMDD
  // Reasons for this:
  // * Major version number of 2 distinguishes these builds from ones built
  //   with different code that were discontinued in 2017
  // * It's useful to be able to immediately see from the version how outdated
  //   the data is without checking the release date on npm
  // * This format means that the default version specifier npm or yarn will
  //   put in a user's package.json, of something like ^2.20250615, will allow
  //   them to upgrade to the latest version automatically until such time as
  //   we increment the "2." to a "3.", which is what we want
  // * Valid package versions need to have 3 parts, so we stick a '.0' on the
  //   end to keep npm happy.
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(today.getUTCDate() >= 15 ? 15 : 1).padStart(2, '0');
  return `2.${yyyy}${mm}${dd}.0`;
}

const version = getVersion();

console.log("Proceeding with work on version", version);

async function git(...command) {
  return await promisify(execFile)('git', command);
}

// We checkout a branch dedicated to the build for this version (creating it
// now if it doesn't exist). We'll store the state of the build after
// intermediate steps on this branch. Once the build is finished, the branch is
// expendable - we deliberately don't put any of this stuff on the master
// branch to allow trivially deleting old branches and avoid permanently
// bloating the size of the repo whenever a build runs.
const branchName = `build-${version}`;
try {
  await git('fetch', 'origin', branchName);
  await git('switch', branchName);
} catch (e) {
  await git('switch', '-c', branchName);
}
console.log("Switched to branch", branchName);

async function gitCommitAndPush(message) {
  // Can't just use --author here - we need a *committer* identity, not just an
  // author identity, to be allowed to commit at all.
  // Specifying user.name & user.email provides both.
  // We don't set this via the `git config` command because that would mess
  // with your configured identity when you run this code locally.
  await git(
    '-c', 'user.name=download-counts bot',
    '-c', 'user.email=markrobertamery+download-counts@gmail.com',
    'commit',
    '-m', message
  );
  await git('push', 'origin', `${branchName}:refs/heads/${branchName}`);
}

// SCENARIO 1: We don't have a build in progress.
// Initiate the state file, update the
// version number in package.json, commit, and exit. Real work will begin on
// the next call to the script.
if (!fs.existsSync(STATE_PATH)) {
  console.log(STATE_PATH, "doesn't yet exist. Creating it...");

  // Read package.json now (before the install below); we'll modify it later.
  const pkgJson = JSON.parse(fs.readFileSync('package.json').toString());

  // We'll use the latest all-the-package-names package list:
  await promisify(execFile)('npm', ['install', 'all-the-package-names@latest']);

  // Normally you'd just `import "all-the-package-names"` to use it, but since
  // we're installing it dynamically when our (ESM) script is already running,
  // we can't, so we reach into its innards ourselves instead:
  let packageNames = JSON.parse(
    fs.readFileSync('node_modules/all-the-package-names/names.json')
  );

  // npm lets you publish scoped packages with a '..' in their name, like
  // @chee/.. or @explodingcabbage/..
  // However, essentially everything in the registry fails to handle these
  // properly because the registry requires you to pass package names as URL
  // segments and a segment of '..' gets parsed (per the URL specs!) as having
  // the same meaning as in a file path - i.e. a URL like
  //   https://api.npmjs.org/downloads/point/last-month/@chee/..
  // gets rewritten (clientside by browsers, but also serverside by the npm
  // API) to
  //   https://api.npmjs.org/downloads/point/last-month
  // which will return the total download count of ALL packages in the last
  // month. There is no way to actually get the download count for these
  // mischievous packages, so we filter them out. Similar consideration applies
  // to packages with a single dot as a segment.
  packageNames = packageNames.filter(
    name => !name.split('/').includes('.') && !name.split('/').includes('..')
  );

  // Scoped and unscoped packages need to be handled differently, since the
  // downloads API only allows bulk requests for unscoped packages. So we split
  // them up front into two queues, one of individual scoped packages and the
  // other of batches of unscoped packages we can query in bulk:
  const singlePackages = packageNames.filter(name => name.includes('/'));
  const unscopedPackageBatches = [];
  let batch = [];
  for (const pkg of packageNames.filter(name => !name.includes('/'))) {
    batch.push(pkg);
    if (batch.length == BULK_QUERY_BATCH_SIZE) {
      unscopedPackageBatches.push(batch);
      batch = [];
    }
  }
  if (batch.length) {
    unscopedPackageBatches.push(batch);
  }

  fs.writeFileSync(
    STATE_PATH,
    JSON.stringify({
      countsFilesSoFar: 0,
      singlePackages,
      unscopedPackageBatches,
      status403Packages: [],
    })
  );

  // In practice, this way of updating package.json preserves key order and
  // formatting, so it's okay (even though this pattern for updating a JSON
  // file is not guaranteed to always preserve those things in general):
  pkgJson.version = version;
  fs.writeFileSync(
    'package.json',
    JSON.stringify(pkgJson, null, 2)
  );

  await git('add', STATE_PATH, 'package.json');
  await gitCommitAndPush(
    `Initiate state file and update package.json for build ${version}`
  );
  console.log("Committed and pushed new state file; exiting");
  process.exit();
}

// If we haven't already exited, we must have a state file committed already
// that will tell us how far the build for this release has gotten, and so what
// we need to do next:
const state = JSON.parse(fs.readFileSync(STATE_PATH).toString());

// SCENARIO 5: We've already completed the entire build process and published
//             a new version to npm.
if (state.published) {
  console.log(version, 'was already published to npm. Nothing left to do!');
  process.exit();
}

// SCENARIO 4: We have completed the build process but not yet published it to
//             npm; it's time to publish.
if (fs.existsSync(pkg.main)) {
  await promisify(execFile)('npm', ['publish']);
  state.published = true;
  fs.writeFileSync(STATE_PATH, JSON.stringify(state));
  await git('add', STATE_PATH);
  await gitCommitAndPush(`Version ${version} is now published to npm`);
  console.log('Published version', version, 'to npm successfully. Hooray!');
  process.exit();
}

// Scenario 3: We've fetched download counts for every package, but haven't
//             consolidated them into a single file ready to publish to npm.
//             So we do that and commit it.
if (state.singlePackages.length == 0 && state.unscopedPackageBatches.length == 0) {
  const counts = JSON.parse(fs.readFileSync('counts0.json'));
  for (let i = 1; i < state.countsFilesSoFar; i++) {
    Object.assign(
      counts,
      JSON.parse(fs.readFileSync(`counts${i}.json`))
    );
  }
  fs.writeFileSync(pkg.main, JSON.stringify(counts))
  await git('add', pkg.main);
  await gitCommitAndPush(`Wrote ${pkg.main}`);
  console.log(`${pkg.main} created. Next run should publish it to npm.`);
  process.exit();
}

// Scenario 2: We still need to hit the npm API to fetch download counts for
//             some packages.

// How many calls we should make to the npm registry before we commit our work
// and exit. Fairly arbitrary; we just want something low enough that 1. an
// unexpected crash of the script won't lose us too much work, and 2. if
// there's ever a persistent crash at a particular point, we can kick off the
// script from not long before then to debug it.
let queriesRemaining = 100000;

// Object in which we'll store the package counts we fetched from the API on
// this run of the script. We'll commit these to an intermediate counts file
// at the end of the script run.
const counts = {};

// Logic for rate limiting calls to the npm API follows.
//
// I don't know exactly what the rate limit is on api.npmjs.org/downloads,
// beyond the 5 million per month limit on total calls to all npm APIs
// described in npm's terms of service, because there are absolutely no
// non-archived docs for the download API that I can find anywhere and npm for
// some reason seem to have a policy of not disclosing the rate limits on their
// APIs. Community requests for such numbers simply go unanswered - see
// https://github.com/orgs/community/discussions/152515#discussioncomment-13094301
// for an example.
//
// Therefore any software that wants to query the registry in bulk must first
// try to determine through trial and error a rate of requests that won't result
// in getting 429 rate limiting errors. Empirically, there's a very aggressive
// limit on the /downloads endpoint, and hitting it with an access token
// (sometimes claimed to relax npm rate limits) does not make the limit any
// more liberal.
//
// The self-imposed throttling described by the two constants below seems to
// avoid ever getting a 429 error. Unfortunately, it also means a full build of
// a new release will take almost a day. So be it; it can't be helped (except
// by distributing the work over multiple IPs to dodge the rate limit).
//
// We:
// * Run this many "threads" sending requests...
const MAX_SIMULTANEOUS_REQUESTS = 20;
// * ... and have each thread wait at least this many ms after starting one
// request before it starts the next
const MIN_REQUEST_INTERVAL_MS = 500
// Just in case, though, we ALSO pause if we get a 429 response and wait for
// the number of seconds indicated in the Retry-After header. If that happens,
// the timestamp to wait until gets stored in this variable and respected by
// all "threads":
let retryAfterTimestampMs = 0;
// We also keep track of whether we ever got rate-limited, so that we can exit
// with an error status code at the end of the script to mark the GitHub Action
// as failed and notify the maintainers that something bad happened.
let gotRateLimited = false;
function createThrottledFetcher() {
  let throttlingWait = null;
  return async function throttledFetch(...args) {
    // First make sure we've waiting at least MIN_REQUEST_INTERVAL_MS between
    // request starts.
    await throttlingWait;

    // THEN make sure we're also obeying any demands from the API that we wait
    // until a given time (communicated via a Retry-After header) to make more
    // requests, including any that come in (on another thread) while we're
    // waiting.
    while (retryAfterTimestampMs - new Date() > 0) {
      await new Promise(resolve => {
        setTimeout(resolve, retryAfterTimestampMs - new Date())
      });
    }

    // Then set up the wait for the next request on this thread:
    throttlingWait = new Promise(resolve => {
      setTimeout(resolve, MIN_REQUEST_INTERVAL_MS)
    });

    // Finally(ish), actually make the request:
    const resp = await fetch(...args);

    // Then handle rate limiting responses, if we get them:
    if (resp.status == 429) {
      gotRateLimited = true;
      // (The download endpoint always just returns a number in its Retry-After
      // header, not a date)
      const retryAfter = Number(resp.headers.get('Retry-After'));
      if (retryAfter) {
        retryAfterTimestampMs = Math.max(
          retryAfterTimestampMs,
          retryAfter * 1000 + Number(new Date())
        );
        return await throttledFetch(...args);
      } else {
        console.error(
          'Got a 429 error without the expected integer Retry-After header.'
        );
        // Let's just sleep for an hour to be conservative. Multiple things
        // need fixing in this script if we ever reach this branch, anyway.
        retryAfterTimestampMs = Math.max(
          retryAfterTimestampMs,
          60 * 60 * 1000 + Number(new Date())
        );
        return await throttledFetch(...args);
      }
    }

    return resp
  }
}

// How many "unexpected"/"random" request failures (i.e. ones of types we have
// no special handling for) have we seen? This would include e.g. 500s or
// network errors. Occasionally getting these due to e.g. outages on npm's side
// is no big deal, but if we see lots of them, something seems to be wrong, so
// we abort and fail the GitHub Action by exiting with an error status code.
let nRequestErrors = 0;
const MAX_REQUEST_ERRORS = 80;
function recordUnexpectedError() {
  nRequestErrors++;
  if (nRequestErrors >= MAX_REQUEST_ERRORS) {
    console.error(
      `Got alarmingly many (${nRequestErrors}) unexpected errors querying API.`
    );
    process.exit(1);
  }
}

// We start many "threads" running this function, each of which loops repeatedly
// pulling either a batch of unscoped packages or a single scoped package from
// the queue, fetches the download count(s) for it, and records them.
async function startFetcherThread() {
  const throttledFetch = createThrottledFetcher();

  while (
    queriesRemaining >= 0 &&
    (state.unscopedPackageBatches.length > 0 || state.singlePackages.length > 0)
  ) {
    if (state.unscopedPackageBatches.length > 0) {
      await fetchCountsForUnscopedBatch(
        state.unscopedPackageBatches.pop(),
        throttledFetch
      );
    } else if (state.singlePackages.length > 0) {
      await fetchCountForSinglePackage(
        state.singlePackages.pop(),
        throttledFetch
      );
    } else throw 'unreachable';

    queriesRemaining--;
    if (queriesRemaining % 250 == 0) {
      console.log(
        new Date(),
        queriesRemaining,
        'more API requests to make before next save point'
      );
    }
  }
}

const TIME_RANGE = 'last-month';

async function fetchCountsForUnscopedBatch(batch, throttledFetch) {
  const batchStr = batch.join(',');
  let resp;
  try {
    resp = await throttledFetch(
      `https://api.npmjs.org/downloads/point/${TIME_RANGE}/${batchStr}`
    );
  } catch (e) {
    // An error here means we didn't get a response AT ALL, e.g. due to a
    // network error or total server outage. This is almost certainly
    // temporary so we should retry.
    console.error(
      `Failed to fetch ${batchStr}. Putting back in the queue to retry.`
    );
    state.unscopedPackageBatches.push(batch);
    recordUnexpectedError();
    return;
  }
  if (resp.status == 400 || resp.status === 403) {
    // 400s
    // ----
    // The API enforces a maximum request length; if we go beyond that, we get
    // a 400 error with a body saying "Request Header Or Cookie Too Large".
    // This only happens in practice when we have a batch entirely made up of
    // unusually long package names.
    // Example URL: https://api.npmjs.org/downloads/point/last-month/coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-2wonk-dluohs-uoy-tahw,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-31xob-kcalb-a-sa-seifilauq-tahw,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-32emink-htiw-ledom-etagorrus-a-gniterpretni-dna-gnipoleved,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-33lmi-rof-lacitirc-si-gnireenigne-erutaef-yhw,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-3tciderp-sledom-ruoy-yhw-dna-tahw-eht-gnidnatsrednu,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-41sledom-xob-kcalb-evah-ew-od-yhw,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-42ecnatropmi-erutaef-noitatumrep,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-43sdnert-tnecer-dna-sleroc,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-4sedoc-nosaer-dna-ecnatropmi-elbairav,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-51ffoedart-ytilibaterpretni-ycarucca-eht-si-tahw,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-52omed-ecnatropmi-erutaef-labolg,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-53iax-erolpxe-ot-gniunitnoc,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-5iax-dna-lmi-gnirapmoc,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-61iax-tsniaga-tnemugra-eht,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-62seulav-yelpahs-rof-noitiutni-na-gnipoleved,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-6tnenimorp-erom-melborp-iax-eht-gnikam-ia-ni-sdnert,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-71emink-gnicudortni,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-72pahs-gnicudortni,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-7snoitanalpxe-labolg-dna-lacol,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-81emink-ni-sledom-gnidliub,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-82skrowten-laruen-rof-snoitanalpxe-lacol-edivorp-ot-emil-gnisu,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-8sledom-gniggubed-rof-iax,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-91emink-ni-gnipool-gnidnatsrednu,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-92slautcafretnuoc-era-tahw,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-9snoitanalpxe-lacol-dna-labolg-fo-troppus-emink,coursedio-14snoitulos-gninrael-enihcam-elbaterpretni-dna-iax-ia-elbanialpxe-gnicudorp-snoitadnuof-ia-dna-gninrael-enihcam-excercise,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-01gniddebme-na-gnisoohc,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-02krowemarf-tnega-tcaer-eht-ot-noitcudortni,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-0xedniamall-dna-niahcgnal-htiw-sppa-ia-lacol-gnidliub,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-11xedniamall-htiw-gar,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-12tnega-tcaer-a-gnitnemelpmi,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-1wonk-dluohs-uoy-tahw,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-21niahcgnal-htiw-gar,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-22sessenkaew-dna-shtgnerts-xedniamall-dna-niahcgnal-egnellahc,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-2sppa-ia-gnidliub-rof-tnemnorivne-ruoy-pu-gnittes,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-31noitazirammus-tnemucod-egnellahc,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-32sessenkaew-dna-shtgnerts-xedniamall-dna-niahcgnal-noitulos,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-3stpecnoc-noitartsehcro-ia,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-41noitazirammus-tnemucod-noitulos,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-42sreenigne-ppa-ia-rof-spets-txen,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-4ipa-ianepo-eht-htiw-ppa-na-gnidliub,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-51swolfkrow-xelpmoc-erom-dna-gniniahc-rof-stpecnoc-ppa,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-5smll-lacol-gninnur,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-61mll-eht-fo-tuo-nosj-gnitteg,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-6ppa-niahcgnal-tsrif-ruoy,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-71gnillac-noitcnuf-mll,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-7ppa-xedniamall-tsrif-ruoy,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-81gnidaolffo-ksat-mll-lacol-egnellahc,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-8sppa-ia-gniggubed,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-91gnidaolffo-ksat-mll-lacol-noitulos,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-9noitareneg-detnemgua-laveirter-stnemucod-lacol-revo-ia,coursedio-15xedniamall-dna-niahcgnal-htiw-noitartsehcro-ia-ot-noitcudortni-excercise,coursedio-19lmotua-ot-ediug-evitucexe-01esahp-gniledom-eht-gnirud-seitilibapac-s-lmotua,coursedio-19lmotua-ot-ediug-evitucexe-0smaet-scitylana-gnignahc-si-lmotua-woh,coursedio-19lmotua-ot-ediug-evitucexe-11noitaulave-ssenisub-dna-ycarucca-ledom-gnirapmoc,coursedio-19lmotua-ot-ediug-evitucexe-1wonk-dluohs-uoy-tahw,coursedio-19lmotua-ot-ediug-evitucexe-21sledom-gniniatniam-dna-gnirotinom,coursedio-19lmotua-ot-ediug-evitucexe-2lmotua-si-tahw,coursedio-19lmotua-ot-ediug-evitucexe-31epacsdnal-rodnev-lmotua-eht,coursedio-19lmotua-ot-ediug-evitucexe-3atad-derutcurts-no-gninrael-enihcam-desivrepus-gnidnatsrednu,coursedio-19lmotua-ot-ediug-evitucexe-41emink-htiw-lmotua-gnitartsnomed,coursedio-19lmotua-ot-ediug-evitucexe-4spo-lm-dna-gnireenigne-atad,coursedio-19lmotua-ot-ediug-evitucexe-51lmotua-rof-rohpatem-a,coursedio-19lmotua-ot-ediug-evitucexe-5elcycefil-lm-eht-gnidnatsrednu,coursedio-19lmotua-ot-ediug-evitucexe-61noitisopmoc-maet-rof-ecivda,coursedio-19lmotua-ot-ediug-evitucexe-6noitinifed-melborp-lm-fo-egnellahc-eht,coursedio-19lmotua-ot-ediug-evitucexe-71spets-txen,coursedio-19lmotua-ot-ediug-evitucexe-7yllufsseccus-tsom-detamotua-neeb-evah-sesahp-hcihw,coursedio-19lmotua-ot-ediug-evitucexe-8gnidnatsrednu-atad-gnitamotua-fo-egnellahc-eht,coursedio-19lmotua-ot-ediug-evitucexe-9perp-atad-gnirud-od-t-nac-dna-nac-lmotua-tahw,coursedio-1sadnap-decnavda-01sadnap-gnisu-snoitagergga-dna-ybpuorg,coursedio-1sadnap-decnavda-0level-txen-eht-ot-sadnap-ekat,coursedio-1sadnap-decnavda-11kcats-tovip-semarfatad-gnipahser,coursedio-1sadnap-decnavda-1sadnap-htiw-detrats-gnitteg,coursedio-1sadnap-decnavda-21semarfatad-tacnoc-gnitanetacnoc-dna-nioj-egrem-gnigrem,coursedio-1sadnap-decnavda-2sadnap-gnisu-semarfatad-ot-ortni,coursedio-1sadnap-decnavda-31spuorg-otni-selbairav-gnippam,coursedio-1sadnap-decnavda-3sadnap-gnisu-snoitcnuf-pot,coursedio-1sadnap-decnavda-41sadnap-htiw-gnittolp,coursedio-1sadnap-decnavda-4sadnap-gnisu-snoitpo-gnirugifnoc,coursedio-1sadnap-decnavda-51snoitcnuf-lacitsitats-dna-snoitalerroc,coursedio-1sadnap-decnavda-5sadnap-gnisu-snoisrevnoc-epyt-atad,coursedio-1sadnap-decnavda-61gniliforp-sadnap-htiw-ade-etarelecca,coursedio-1sadnap-decnavda-6sadnap-gnisu-sgnirts-htiw-gnikrow,coursedio-1sadnap-decnavda-71sadnapoeg-htiw-atad-cihpargoeg-erolpxe,coursedio-1sadnap-decnavda-7sadnap-gnisu-setad-htiw-gnikrow,coursedio-1sadnap-decnavda-81kraps-salaok-dna-ksad-htiw-sadnap-dnoyeb,coursedio-1sadnap-decnavda-8sadnap-gnisu-atad-gnissim-htiw-gnilaed,coursedio-1sadnap-decnavda-91snoitcnuf-sadnap-decnavda-gnisu-drawrof-htap-ruoy,coursedio-1sadnap-decnavda-9pamylppa-pam-ylppa,coursedio-1sadnap-decnavda-excercise,coursedio-21erutcip-gib-eht-ia-eruza-01tpg-s-ianepo-htiw-tahc-gniogno-na-etaerc,coursedio-21erutcip-gib-eht-ia-eruza-02rosivda-scirtem,coursedio-21erutcip-gib-eht-ia-eruza-0weiv-toof---a-morf-ia-eruza,coursedio-21erutcip-gib-eht-ia-eruza-11snoitelpmoc-eruza-htiw-srewsna-txet-elpmis,coursedio-21erutcip-gib-eht-ia-eruza-12hcraes-evitingoc,coursedio-21erutcip-gib-eht-ia-eruza-1esruoc-siht-fo-tuo-tsom-eht-teg,coursedio-21erutcip-gib-eht-ia-eruza-21e-llad-htiw-ia-evitareneg,coursedio-21erutcip-gib-eht-ia-eruza-22scimoneg-tfosorcim,coursedio-21erutcip-gib-eht-ia-eruza-2ia-eruza-fo-weivrevo-na,coursedio-21erutcip-gib-eht-ia-eruza-31soiduts-eruza-eht,coursedio-21erutcip-gib-eht-ia-eruza-32mroftalp-iasnob,coursedio-21erutcip-gib-eht-ia-eruza-3seman-ecivres-ia-eruza-eht,coursedio-21erutcip-gib-eht-ia-eruza-41oiduts-noisiv-htiw-sisylana-egami,coursedio-21erutcip-gib-eht-ia-eruza-42ytefas-tnetnoc-ia-eruza,coursedio-21erutcip-gib-eht-ia-eruza-4secivres-ia-eruza-eht-fo-ruot-trohs-a,coursedio-21erutcip-gib-eht-ia-eruza-51oiduts-egaugnal-htiw-sisylana-egaugnal,coursedio-21erutcip-gib-eht-ia-eruza-52yenruoj-ruoy-eunitnoc,coursedio-21erutcip-gib-eht-ia-eruza-5gninrael-enihcam-eruza-fo-scisab-eht,coursedio-21erutcip-gib-eht-ia-eruza-61oiduts-hceeps-htiw-noitaerc-oidua-dna-sisylana-hceeps,coursedio-21erutcip-gib-eht-ia-eruza-6oiduts-gninrael-enihcam-eruza,coursedio-21erutcip-gib-eht-ia-eruza-71ecivres-tob-eruza,coursedio-21erutcip-gib-eht-ia-eruza-7wolf-tpmorp-htiw-stpmorp-retteb-dliub,coursedio-21erutcip-gib-eht-ia-eruza-81ecnegilletni-tnemucod-eruza,coursedio-21erutcip-gib-eht-ia-eruza-8ecivres-ianepo-eruza-fo-scisab-eht,coursedio-21erutcip-gib-eht-ia-eruza-91redaer-evisremmi,coursedio-21erutcip-gib-eht-ia-eruza-9oiduts-ia-eruza-eht-erolpxe,coursedio-21nohtyp-secivres-gninrael-enihcam-revres-lqs-01revres-lqs-ot-tes-tluser-a-tuptuo,coursedio-21nohtyp-secivres-gninrael-enihcam-revres-lqs-02emarf-atad-a-elpmas-noitulos,coursedio-21nohtyp-secivres-gninrael-enihcam-revres-lqs-03erudecorp-derots-a-etirw-egnellahc,coursedio-21nohtyp-secivres-gninrael-enihcam-revres-lqs-0nohtyp-htiw-atad-revres-lqs-ezylana,coursedio-21nohtyp-secivres-gninrael-enihcam-revres-lqs-11sllaftip-xatnys-nohtyp,coursedio-21nohtyp-secivres-gninrael-enihcam-revres-lqs-12seires-dna-sexedni-htiw-seulav-nruter,coursedio-21nohtyp-secivres-gninrael-enihcam-revres-lqs-13erudecorp-derots-a-etirw-noitulos,coursedio-21nohtyp-secivres-gninrael-enihcam-revres-lqs-1wonk-dluohs-uoy-tahw,coursedio-21nohtyp-secivres-gninrael-enihcam-revres-lqs-21emarf-atad-a-tropmi-egnellahc,coursedio-21nohtyp-secivres-gninrael-enihcam-revres-lqs-22emarf-atad-a-ot-seires-a-trevnoc,coursedio-21nohtyp-secivres-gninrael-enihcam-revres-lqs-23revres-enoladnats-a-no-slm-llatsni
    // The fix for this is just to split the batch into two smaller batches and
    // try again.
    //
    // 403s
    // ----
    // The /downloads API sits behind some Cloudflare service - maybe it's
    // Cloudflare WAF? - that heuristically blocks requests that it thinks look
    // like attacks. Some package names - and some COMBINATIONS of package
    // names that are okay on their own - trigger this blocking, causing a 403
    // with a Cloudflare-generated error page that says:
    // "Sorry, you have been blocked" & "You are unable to access npmjs.org".
    // There doesn't appear to be any lasting block applied to your IP as this
    // might imply, but retrying the SAME request will yield the same result.
    // Whenever we hit this on a bulk request, we split the batch of package
    // names into two batches of half the size and try again. If we are lucky,
    // they will both be accepted by the WAF! If not we keep going until either
    // we succeed or we get down to "batches" consisting of single package
    // names, at which point we stick them in singlePackages for
    // fetchCountForSinglePackage to handle.
    // Example URLs that trigger the 403:
    // * https://api.npmjs.org/downloads/point/last-month/leads-notify-vkm,leads-parser,leads-router,leads-shared,leads-switch-btn-vkm,leadsender_s3,leadshark-models,leadsheetjs,leadsimple-kve3lq75zd,leadsitelib,leadsmithaiv2,leadsoft-leadtrust-plugin,leadsoft-react-ui-kit,leadspent-far-cover,leadsquared,leadssu-webmaster-api,leadsx10-email-editor,leadsy,leadsync,leadsyncapp,leadtech-lib-datadog-build-tools,leadtech-lib-datadog-utils,leadtracker,leadup,leadutils,leadvm,leadwatch,leadzai-design-system,leaf,leaf-ai.js,leaf-along0,leaf-assistant.js,leaf-auth,leaf-auth-express,leaf-auth-router,leaf-body,leaf-boss-cbd-gummies-read-shocking-report,leaf-chart,leaf-cli,leaf-cli-asdasd,leaf-collapse-component-vue,leaf-components,leaf-connect,leaf-connect-cli,leaf-converter,leaf-cookies,leaf-crowd-thrown,leaf-cts-middleware,leaf-dashboard,leaf-db,leaf-dust,leaf-engine,leaf-fence-when-somehow,leaf-fix-deep,leaf-flip,leaf-flux-dispatcher,leaf-frame,leaf-framework,leaf-glucose,leaf-grid,leaf-it-to-me,leaf-javascript,leaf-jts,leaf-koa,leaf-koala,leaf-lib,leaf-log,leaf-machine,leaf-mate-premium-cbd-oil-must-read-shocking-reviews,leaf-mdns,leaf-observable,leaf-occur,leaf-onerror,leaf-orient,leaf-pkginfo,leaf-proto,leaf-protocol,leaf-query.js,leaf-react,leaf-react-ui,leaf-require,leaf-require-cli,leaf-reset,leaf-rule,leaf-sale-web3-official,leaf-scripts,leaf-semantic-core,leaf-server,leaf-simplest-round-ride,leaf-store,leaf-swam-longer,leaf-tools,leaf-tour,leaf-ts,leaf-typography,leaf-ui,leaf-ui-components,leaf-ui-font-test,leaf-ui-theme,leaf-utils,leaf-validation,leaf-validator,leaf-weather,leaf-web-cli,leaf-web-lib,leaf-webapp-lib,leaf-webpack-dev-middleware,leaf-wheel,leaf-wind-demo,leaf-yjx,leaf.js,leaf.seed,leaf4monkey-object-utils,leaf4monkey-xml,leaf_test,leaf_zs,leafage,leafast,leafbox,leafcase-assetlist,leafcase-authentication,leafcase-base,leafcase-caching,leafcase-couchdb,leafcase-couchdb-designdocument-manager,leafcase-data,leafcase-elasticsearch,leafcase-events
    // * TODO: an example with a single package
    console.warn('Got', resp.status, 'response for batch', batchStr);
    if (batch.length <= 3) {
      for (const pkg of batch) {
        state.singlePackages.push(pkg);
      }
    } else {
      const splitPoint = Math.trunc(batch.length / 2);
      state.unscopedPackageBatches.push(batch.slice(0, splitPoint));
      state.unscopedPackageBatches.push(batch.slice(splitPoint));
    }
    return;
  } else if (resp.status !== 200) {
    // We've never seen this, but it seems possible we'll get e.g. a 500
    // during some kind of outage. Retry.
    console.error(
      new Date(),
      `Got unexpected ${resp.status} when trying to get batch ${batchStr}`
    );
    state.unscopedPackageBatches.push(batch);
    recordUnexpectedError();
    return;
  }
  const respJson = await resp.json();
  for (const [pkgName, pkgData] of Object.entries(respJson)) {
    // (If a package doesn't exist at all - e.g. because it was unpublished -
    // then pkgData itself will be null)
    if (pkgData?.downloads != null) {
      counts[pkgName] = pkgData?.downloads;
    }
  }
}

async function fetchCountForSinglePackage(packageName, throttledFetch) {
  // See comments in fetchCountsForUnscopedBatch - error handling is similar
  let resp;
  try {
    resp = await throttledFetch(
      `https://api.npmjs.org/downloads/point/${TIME_RANGE}/${packageName}`
    );
  } catch (e) {
    console.error(
      `Failed to fetch ${packageName}. Putting back in the queue to retry.`
    );
    state.singlePackages.push(packageName);
    recordUnexpectedError();
    return;
  }
  if (resp.status === 403) {
    // The Cloudflare WAF simply won't allow us to query download counts for
    // this package. We record this fact and move on.
    // TODO: Use web scraping to get these counts instead?
    console.error('Got a 403 error for package', packageName);
    state.status403Packages.push(packageName);
    return;
  } else if (resp.status === 404) {
    // This status code is ONLY returned when you're querying downloads for a
    // SINGLE package - never bulk requests, even if ALL the packages you're
    // querying for don't exist.
    // We expect to see these when recently-published packages make it into an
    // all-the-package-names release but then get unpublished from the registry
    // before this script runs.
    // That's fine - we just leave it out from our data and move on.
    console.log('Got 404 for (presumably unpublished) package', packageName);
    return;
  } else if (resp.status !== 200) {
    console.error(
      new Date(),
      `Got unexpected ${resp.status} when trying to get ${packageName}`
    );
    state.singlePackages.push(packageName);
    recordUnexpectedError();
    return;
  }
  const downloads = (await resp.json()).downloads;
  if (downloads != null) {
    counts[packageName] = downloads;
  }
}

const threads = [];
for (let i = 0; i < MAX_SIMULTANEOUS_REQUESTS; i++) {
  threads.push(startFetcherThread());
}
await Promise.all(threads);

const counts_path = `counts${state.countsFilesSoFar}.json`;
fs.writeFileSync(
  counts_path,
  JSON.stringify(counts)
);
state.countsFilesSoFar++;
fs.writeFileSync(
  STATE_PATH,
  JSON.stringify(state)
);

await git('add', counts_path);
await git('add', STATE_PATH);
await gitCommitAndPush(`Fetched download counts for some packages`);

console.log("Committed and pushed latest counts file");

if (gotRateLimited) {
  console.error(
    'Ran to completion - but along the way we got rate limited with 429s.',
    'That should never happen!'
  );
  process.exit(1);
}

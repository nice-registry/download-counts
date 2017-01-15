#!/usr/bin/env bash

set -x            # print commands before execution
set -o errexit    # always exit on error
set -o pipefail   # honor exit codes when piping
set -o nounset    # fail on unset variables

# clone the repo and fetch new names
git clone https://github.com/zeke/download-counts
cd download-counts
npm run build
npm test

# bail if no changes are present
[[ `git status --porcelain` ]] || exit

count=$(cat index.json | wc -l)
git add index.json
git config user.email "zeke@sikelianos.com"
git config user.name "Zeke Sikelianos"
git commit -m "$count packages"
npm version minor -m "bump minor to %s"
npm publish
git push origin master --follow-tags

# clean up
cd ..
rm -rf download-counts

const fs = require('fs')
const path = require('path')
const {difference} = require('lodash')
const Bottleneck = require('bottleneck')
const got = require('got')
const {chain} = require('lodash')
const isNumber = require('is-number')
const humanInterval = require('human-interval')
const allNames = require('all-the-package-names')

const {filenameToPackageName, packageNameToFilename} = require('../lib/util')
const dataPath = path.join(__dirname, '../data')
const MAX_PER_BATCH = 10000
const MAX_CONCURRENCY = 4

const existingFiles = fs.readdirSync(dataPath)
const existingNames = existingFiles
  .filter(name => name.includes('.json'))
  .map(filenameToPackageName)
const missingNames = difference(allNames, existingNames)
const startDate = new Date(new Date() - humanInterval('1 year')).toISOString().substr(0, 10)
const endDate = new Date().toISOString().substr(0, 10)
const limiter = new Bottleneck(MAX_CONCURRENCY)

let targets

if (missingNames.length > 250) {
  // numerous new packages are published every hour, so let them pile up a bit.
  // otherwise this conditional will always be true and the `else` will never be run.
  console.log(`Found ${missingNames.length} packages without download counts. Fetching now...`)
  // Some packages have never had their downloads counted
  targets = missingNames
    .slice(0, MAX_PER_BATCH)
} else {
  console.log(`All packages have download counts. Updating ${MAX_PER_BATCH} of the most out-of-date counts...`)
  // Find the most out-of-date files and update them.
  targets = existingFiles
    .map(filename => {
      return {
        name: filename, 
        time: fs.statSync(path.join(dataPath, filename)).mtime.getTime()
      }
    })
    .sort((a, b) => a.time - b.time)
    .slice(0, MAX_PER_BATCH)
    .map(filenameToPackageName)
}

targets.forEach(pkg => {
  limiter.schedule(getDownloads, pkg)
})

limiter.on('idle', () => {
  console.log('done')
  process.exit()
})

function getDownloads (pkgName) {
  const url = `https://api.npmjs.org/downloads/range/${startDate}:${endDate}/${pkgName}`
  const filename = path.join(dataPath, packageNameToFilename(pkgName))

  return got(url, {json: true})
    .then(result => {
      const downloads = result.body.downloads
      if (!downloads) return
      if (isNumber(pkgName)) return
      const total = chain(downloads).map('downloads').reduce((a, b) => a + b, 0).value()
      const days = downloads.length
      const average = Math.floor(total / days)
      
      console.log(pkgName, average)
      fs.writeFileSync(filename, average)
    })
    .catch(error => {
      if (error && error.statusCode === 404) {
        console.log(pkgName, 0,  '(404 response)')
        fs.writeFileSync(filename, 0)
      } else {
        console.error('Error!')
        console.error(url)
        console.error(error)
      }
    })
}
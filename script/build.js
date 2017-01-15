const registry = require('package-stream')()
const got = require('got')
const humanInterval = require('human-interval')
const lodash = require('lodash')
const startDate = new Date(new Date() - humanInterval('1 year')).toISOString().substr(0, 10)
const endDate = new Date().toISOString().substr(0, 10)
const counts = []

registry
  .on('package', getDownloads)
  .on('up-to-date', finish)

function getDownloads (pkg) {
  if (!pkg || !pkg.name) return
  const url = `https://api.npmjs.org/downloads/range/${startDate}:${endDate}/${pkg.name}`

  got(url, {json: true})
    .then(result => {
      const downloads = result.body.downloads
      if (!downloads) return
      console.error(result.body.package)
      const total = lodash.map(downloads, 'downloads').reduce((a, b) => a + b, 0)
      const days = downloads.length
      const average = Math.floor(total / days)
      counts.push({name: pkg.name, average: average})

      // shortcut for debugging:
      if (Object.keys(counts).length > 100) return finish()
    })
    .catch(error => {
      console.error('Error!')
      console.error(error)
    })
}

function finish () {
  const obj = {}
  counts
    .sort((a, b) => b.average - a.average)
    .forEach(pkg => {
      obj[pkg.name] = pkg.average
    })
  process.stdout.write(JSON.stringify(obj, null, 2))
  process.exit()
}

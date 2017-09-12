const requireDir = require('require-dir')
const fs = require('fs')
const path = require('path')
const {filenameToPackageName} = require('../lib/util')
const blacklist = [
  '?'
]

const counts = fs.readdirSync(path.join(__dirname, '../data'))
  // .slice(0, 1000)
  .map(filename => {
    return {
      name: filenameToPackageName(filename),
      count: require(`../data/${filename}`)
    }
  })
  .filter(pkg => !blacklist.includes(pkg.name))
  .sort((a, b) => b.count - a.count)
  .reduce((all, pkg) => {
    all[pkg.name] = pkg.count
    return all
  }, {})

fs.writeFileSync(
  path.join(__dirname, '../index.json'),
  JSON.stringify(counts, null, 2)
)
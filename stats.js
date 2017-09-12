const counts = require('.')
const packages = Object.keys(counts)
  .map(key => {
    return {
      name: key,
      count: counts[key]
    }
  })

const intervals = [
  0, 1, 10, 100, 250, 500, 1000, 5000, 10000, 25000, 50000, 100000
]

console.log(`
Downloads per Day | Packages
--- | ---`)

intervals.forEach((min, i) => {
  const max = (i === intervals.length - 1) ? 10000000 : intervals[i+1]-1
  const matches = packages.filter(pkg => pkg.count >= min && pkg.count <= max).length
  console.log(`${min}-${max} | ${matches}`)
})
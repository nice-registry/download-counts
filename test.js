const expect = require('chai').expect
const describe = require('mocha').describe
const it = require('mocha').it
const counts = require('.')
const keys = Object.keys(counts)

describe('download-counts', () => {
  it('is an object with keys as names and download counts as values', () => {
    expect(counts).to.be.an('object')
  })

  it('is has hella packages', () => {
    expect(keys.length).to.be.above(370 * 1000)
  })

  it('sorts keys by count, descending', () => {
    expect(counts[keys[0]] > counts[keys[1]]).to.be.true
  })
})

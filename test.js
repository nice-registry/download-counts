require('chai').should()
const {describe, it} = require('mocha')
const counts = require('.')
const keys = Object.keys(counts)

describe('download-counts', () => {
  it('is an object with keys as names and download counts as values', () => {
    (typeof counts).should.eq('object')
  })

  it('has hella packages', () => {
    keys.length.should.be.above(500 * 1000)
  })

  it('sorts keys by count, descending', () => {
    (counts[keys[0]] > counts[keys[1]]).should.eq(true)
  })
})

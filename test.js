const expect = require('chai').expect
const describe = require('mocha').describe
const it = require('mocha').it
const counts = require('.')

describe('download-counts', () => {
  it('is an object with keys as names and download counts as values', () => {
    expect(counts).to.be.an('object')
  })

  // it('sorts keys by count, descending', () => {
  //   const keys = Object.keys(counts)
  //   expect(keys[0] > keys[1]).to.be.true
  // })
})

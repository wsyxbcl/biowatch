/**
 * Tests for the URL state helpers used by the Deployments tab to mirror
 * selectedDeployment in ?deploymentID=…
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveSelectedDeployment,
  withDeploymentParam
} from '../../../src/renderer/src/deployments/urlState.js'

describe('resolveSelectedDeployment', () => {
  const deployments = [
    { deploymentID: 'd1', locationID: 'loc1' },
    { deploymentID: 'd2', locationID: 'loc2' }
  ]

  test('returns null when no param is set', () => {
    const params = new URLSearchParams('')
    assert.equal(resolveSelectedDeployment(params, deployments), null)
  })

  test('returns the matching deployment when param is set and valid', () => {
    const params = new URLSearchParams('deploymentID=d2')
    const result = resolveSelectedDeployment(params, deployments)
    assert.equal(result.deploymentID, 'd2')
  })

  test('returns null when the deploymentID is not in the list', () => {
    const params = new URLSearchParams('deploymentID=does-not-exist')
    assert.equal(resolveSelectedDeployment(params, deployments), null)
  })

  test('returns null when the param is empty', () => {
    const params = new URLSearchParams('deploymentID=')
    assert.equal(resolveSelectedDeployment(params, deployments), null)
  })

  test('returns null when the param matches a locationID only', () => {
    const params = new URLSearchParams('deploymentID=loc1')
    assert.equal(resolveSelectedDeployment(params, deployments), null)
  })

  test('returns null when deployments list is null/undefined', () => {
    const params = new URLSearchParams('deploymentID=d1')
    assert.equal(resolveSelectedDeployment(params, null), null)
    assert.equal(resolveSelectedDeployment(params, undefined), null)
  })
})

describe('withDeploymentParam', () => {
  test('sets the param when given a deploymentID', () => {
    const params = new URLSearchParams('foo=bar')
    const next = withDeploymentParam(params, 'd1')
    assert.equal(next.get('deploymentID'), 'd1')
    assert.equal(next.get('foo'), 'bar')
  })

  test('removes the param when given null', () => {
    const params = new URLSearchParams('deploymentID=d1&foo=bar')
    const next = withDeploymentParam(params, null)
    assert.equal(next.has('deploymentID'), false)
    assert.equal(next.get('foo'), 'bar')
  })

  test('overwrites an existing param', () => {
    const params = new URLSearchParams('deploymentID=d1')
    const next = withDeploymentParam(params, 'd2')
    assert.equal(next.get('deploymentID'), 'd2')
  })

  test('returns a new URLSearchParams (does not mutate input)', () => {
    const params = new URLSearchParams('deploymentID=d1')
    const next = withDeploymentParam(params, 'd2')
    assert.equal(params.get('deploymentID'), 'd1')
    assert.notEqual(next, params)
  })
})

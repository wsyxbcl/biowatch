import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localArchiveCandidates } from '../../../../src/main/services/ml/localArchive.js'

const win = { platform: 'win32', arch: 'x64' }

test('common environment archives may use the fixed platform alias', () => {
  assert.deepEqual(localArchiveCandidates('common-0.1.4-Windows.tar.gz', win), [
    'common-Windows.tar.gz',
    'common-0.1.4-Windows.tar.gz'
  ])
  assert.deepEqual(
    localArchiveCandidates('common-0.1.4-macOS.tar.gz', { platform: 'darwin', arch: 'arm64' }),
    ['common-macOS-arm64.tar.gz', 'common-0.1.4-macOS.tar.gz']
  )
})

test('other archives never resolve to the common alias', () => {
  assert.deepEqual(localArchiveCandidates('heinishi-0.1.0-Windows.tar.gz', win), [
    'heinishi-0.1.0-Windows.tar.gz'
  ])
  assert.deepEqual(localArchiveCandidates('maze-speciesnet-jingxi-0.0.1.tar.gz', win), [
    'maze-speciesnet-jingxi-0.0.1.tar.gz'
  ])
})

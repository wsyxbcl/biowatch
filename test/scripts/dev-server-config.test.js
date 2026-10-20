import { test } from 'node:test'
import assert from 'node:assert/strict'
import config from '../../electron.vite.config.mjs'

test('development renderer binds IPv4 loopback explicitly', () => {
  assert.equal(config.renderer.server?.host, '127.0.0.1')
})

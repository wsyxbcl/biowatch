import { test } from 'node:test'
import assert from 'node:assert/strict'

test('local configuration is opt-in, development and Linux only', async () => {
  const { resolveLocalJingxi } = await import('../../../../src/main/services/ml/localJingxi.js')
  assert.equal(resolveLocalJingxi({ isDev: true, env: {} }), null)
  assert.equal(resolveLocalJingxi({ isDev: false, env: { MAZE_JINGXI_BUNDLE_PATH: '/bad' } }), null)
  assert.equal(resolveLocalJingxi({ isDev: true, platform: 'win32', env: {} }), null)
  const partial = resolveLocalJingxi({
    isDev: true,
    env: { MAZE_JINGXI_BUNDLE_PATH: '/private/path' }
  })
  assert.equal(partial.model.ready, false)
  assert.match(partial.model.configurationError, /both/)
  assert.equal(JSON.stringify(partial.model).includes('/private/path'), false)
})

test('names and version are independent of immutable delivery', async () => {
  const { jingxiModel, JINGXI_DELIVERY_VERSION } =
    await import('../../../../src/shared/jingxiModel.js')
  assert.equal(jingxiModel.name, 'Heinishi Test type 001')
  assert.equal(jingxiModel.nameCN, '平西丸 Test type 001')
  assert.equal(jingxiModel.reference.version, '0.0.1')
  assert.equal(JINGXI_DELIVERY_VERSION, '0.1.0-experimental')
})

test('Heinishi is a regular modelZoo entry, offered only where its environment is packaged', async () => {
  const { modelZoo, findModel, findPythonEnvironment, isModelSupportedOnPlatform } =
    await import('../../../../src/shared/mlmodels.js')
  const { JINGXI_ID, JINGXI_VERSION } = await import('../../../../src/shared/jingxiModel.js')
  const model = findModel({ id: JINGXI_ID, version: JINGXI_VERSION })
  assert.ok(modelZoo.includes(model))
  const env = findPythonEnvironment(model.pythonEnvironment)
  assert.equal(env.reference.id, 'heinishi')
  assert.equal(isModelSupportedOnPlatform(model, 'win32'), true)
  assert.equal(isModelSupportedOnPlatform(model, 'linux'), false)
  assert.equal(isModelSupportedOnPlatform(model, 'darwin'), false)
  // Bare filenames: archives are looked up in offline-assets/, never downloaded.
  assert.equal(model.downloadURL, 'maze-speciesnet-jingxi-0.0.1.tar.gz')
  assert.equal(env.platform.windows.downloadURL, 'heinishi-0.1.0-Windows.tar.gz')
  for (const other of modelZoo.filter((m) => m !== model))
    assert.equal(isModelSupportedOnPlatform(other, 'linux'), true)
})

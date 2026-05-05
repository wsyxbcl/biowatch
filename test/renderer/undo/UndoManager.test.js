import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { UndoManager } from '../../../src/renderer/src/undo/UndoManager.js'

function makeCommand(overrides = {}) {
  const calls = { forward: 0, inverse: 0, redo: 0 }
  return {
    calls,
    command: {
      entry: { type: 'update-bbox', mediaId: 'm1', observationId: 'o1', before: {}, after: {} },
      forward: async () => {
        calls.forward++
      },
      inverse: async () => {
        calls.inverse++
      },
      redo: async () => {
        calls.redo++
      },
      ...overrides
    }
  }
}

describe('UndoManager', () => {
  test('exec runs forward and pushes to undoStack', async () => {
    const mgr = new UndoManager()
    const { command, calls } = makeCommand()

    await mgr.exec(command)

    assert.equal(calls.forward, 1)
    assert.equal(mgr.canUndo(), true)
    assert.equal(mgr.canRedo(), false)
  })

  test('undo pops from undoStack, runs inverse, pushes to redoStack', async () => {
    const mgr = new UndoManager()
    const { command, calls } = makeCommand()

    await mgr.exec(command)
    await mgr.undo()

    assert.equal(calls.inverse, 1)
    assert.equal(mgr.canUndo(), false)
    assert.equal(mgr.canRedo(), true)
  })

  test('redo pops from redoStack, runs redo, pushes back to undoStack', async () => {
    const mgr = new UndoManager()
    const { command, calls } = makeCommand()

    await mgr.exec(command)
    await mgr.undo()
    await mgr.redo()

    assert.equal(calls.redo, 1)
    assert.equal(mgr.canUndo(), true)
    assert.equal(mgr.canRedo(), false)
  })

  test('a fresh exec clears the redoStack', async () => {
    const mgr = new UndoManager()
    const a = makeCommand()
    const b = makeCommand()

    await mgr.exec(a.command)
    await mgr.undo()
    assert.equal(mgr.canRedo(), true)

    await mgr.exec(b.command)
    assert.equal(mgr.canRedo(), false)
  })

  test('caps undoStack at 100 entries — drops oldest on overflow', async () => {
    const mgr = new UndoManager()
    for (let i = 0; i < 105; i++) {
      await mgr.exec(makeCommand().command)
    }
    assert.equal(mgr.undoStackSize(), 100)
  })

  test('undo failure drops the entry and emits no redo', async () => {
    const mgr = new UndoManager()
    const failing = makeCommand({
      inverse: async () => {
        throw new Error('IPC failed')
      }
    })

    await mgr.exec(failing.command)

    let onErrorMsg = null
    mgr.onError((msg) => {
      onErrorMsg = msg
    })

    await mgr.undo()

    assert.match(onErrorMsg ?? '', /IPC failed/)
    assert.equal(mgr.canUndo(), false)
    assert.equal(mgr.canRedo(), false)
  })

  test('emits pulse(observationId) after a successful undo', async () => {
    const mgr = new UndoManager()
    const { command } = makeCommand()
    const pulses = []
    mgr.onPulse((id) => pulses.push(id))

    await mgr.exec(command)
    await mgr.undo()

    assert.deepEqual(pulses, ['o1'])
  })

  test('emits onApplied(entry, kind) on exec/undo/redo', async () => {
    const mgr = new UndoManager()
    const { command } = makeCommand()
    const applied = []
    mgr.onApplied((entry, kind) => applied.push([entry.observationId, kind]))

    await mgr.exec(command)
    await mgr.undo()
    await mgr.redo()

    assert.deepEqual(applied, [
      ['o1', 'forward'],
      ['o1', 'inverse'],
      ['o1', 'redo']
    ])
  })

  test('emits applied before pulse on undo (so cache patch precedes pulse)', async () => {
    const mgr = new UndoManager()
    const { command } = makeCommand()
    const events = []
    mgr.onApplied(() => events.push('applied'))
    mgr.onPulse(() => events.push('pulse'))

    await mgr.exec(command)
    events.length = 0
    await mgr.undo()

    assert.deepEqual(events, ['applied', 'pulse'])
  })

  test('buffers pendingPulse for late-mounted bboxes; consumePendingPulse fires once', async () => {
    const mgr = new UndoManager()
    const { command } = makeCommand()

    await mgr.exec(command)
    await mgr.undo()

    // First call after undo: pulse is buffered for 'o1'
    assert.equal(mgr.consumePendingPulse('o1'), true)
    // Second call: buffer was cleared on consume
    assert.equal(mgr.consumePendingPulse('o1'), false)
  })

  test('consumePendingPulse ignores mismatched observation id', async () => {
    const mgr = new UndoManager()
    const { command } = makeCommand()

    await mgr.exec(command)
    await mgr.undo()

    assert.equal(mgr.consumePendingPulse('different-id'), false)
    // Original buffer is still consumable for the right id
    assert.equal(mgr.consumePendingPulse('o1'), true)
  })

  test('clear() empties both stacks', async () => {
    const mgr = new UndoManager()
    await mgr.exec(makeCommand().command)
    await mgr.exec(makeCommand().command)
    await mgr.undo()

    mgr.clear()

    assert.equal(mgr.canUndo(), false)
    assert.equal(mgr.canRedo(), false)
  })

  test('navigateTo handler is called when entry.mediaId differs from currentMediaId', async () => {
    const navigated = []
    const mgr = new UndoManager({
      getCurrentMediaId: () => 'mB',
      navigateTo: async (mediaId) => {
        navigated.push(mediaId)
      }
    })
    const { command } = makeCommand() // entry.mediaId = 'm1'

    await mgr.exec(command)
    await mgr.undo()

    assert.deepEqual(navigated, ['m1'])
  })

  test('navigateTo not called when entry.mediaId matches current', async () => {
    const navigated = []
    const mgr = new UndoManager({
      getCurrentMediaId: () => 'm1',
      navigateTo: async (mediaId) => {
        navigated.push(mediaId)
      }
    })
    const { command } = makeCommand()

    await mgr.exec(command)
    await mgr.undo()

    assert.deepEqual(navigated, [])
  })

  test('navigates back to pre-undo image when inverse fails after auto-nav', async () => {
    let currentId = 'mB'
    const navigated = []
    const mgr = new UndoManager({
      getCurrentMediaId: () => currentId,
      navigateTo: async (mediaId) => {
        navigated.push(mediaId)
        currentId = mediaId
      }
    })
    const failing = makeCommand({
      inverse: async () => {
        throw new Error('IPC failed')
      }
    })

    await mgr.exec(failing.command) // pushes onto undoStack; entry.mediaId = 'm1'
    navigated.length = 0

    await mgr.undo()

    // Manager navigated to 'm1' for the inverse, failed, then back to 'mB'.
    assert.deepEqual(navigated, ['m1', 'mB'])
    // Stack state is consistent: entry was dropped, no redo available.
    assert.equal(mgr.canUndo(), false)
    assert.equal(mgr.canRedo(), false)
  })

  test('navigation-back failure is swallowed (does not double-error)', async () => {
    let currentId = 'mB'
    let navAttempts = 0
    const errors = []
    const mgr = new UndoManager({
      getCurrentMediaId: () => currentId,
      navigateTo: async (mediaId) => {
        navAttempts++
        // Forward nav succeeds; back-nav fails. The original IPC error
        // should still be the only one surfaced.
        if (navAttempts === 1) {
          currentId = mediaId
          return
        }
        throw new Error('back nav failed')
      }
    })
    mgr.onError((msg) => errors.push(msg))
    const failing = makeCommand({
      inverse: async () => {
        throw new Error('original IPC failure')
      }
    })

    await mgr.exec(failing.command)
    await mgr.undo()

    assert.equal(errors.length, 1)
    assert.match(errors[0], /original IPC failure/)
  })
})

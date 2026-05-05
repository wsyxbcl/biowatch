const STACK_CAP = 100
// How long a pulse buffered for a not-yet-mounted bbox stays consumable.
// 1s comfortably covers a React commit + paint, while still being short
// enough that a stale pulse won't fire on an unrelated later mount.
const PENDING_PULSE_TTL_MS = 1000

export class UndoManager {
  constructor({ getCurrentMediaId, navigateTo } = {}) {
    this.undoStack = []
    this.redoStack = []
    this.getCurrentMediaId = getCurrentMediaId ?? (() => null)
    this.navigateTo = navigateTo ?? (async () => {})
    this.errorListeners = new Set()
    this.pulseListeners = new Set()
    this.changeListeners = new Set()
    this.appliedListeners = new Set()
    // Buffered pulse for a target that may not be mounted yet — undo-of-delete
    // recreates the bbox via the onApplied cache patch, but React commits the
    // mount on a later tick, after _emitPulse has fired its listeners. Mounted
    // EditableBbox checks this on mount and consumes it.
    this.pendingPulse = null
  }

  canUndo() {
    return this.undoStack.length > 0
  }

  canRedo() {
    return this.redoStack.length > 0
  }

  undoStackSize() {
    return this.undoStack.length
  }

  redoStackSize() {
    return this.redoStack.length
  }

  async exec(command) {
    await command.forward()
    this.undoStack.push(command)
    if (this.undoStack.length > STACK_CAP) {
      this.undoStack.shift()
    }
    this.redoStack.length = 0
    this._emitApplied(command.entry, 'forward')
    this._notifyChange()
  }

  async undo() {
    if (this.undoStack.length === 0) return
    const command = this.undoStack.pop()
    const preNavMediaId = this.getCurrentMediaId()
    try {
      await this._navigateIfNeeded(command.entry.mediaId)
      await command.inverse()
    } catch (err) {
      this._emitError(`Couldn't undo: ${err.message}`)
      // If we navigated away before failing, return the user to where they
      // were so they're not stranded on an unrelated image with no redo path.
      await this._tryRestoreNav(preNavMediaId)
      this._notifyChange()
      return
    }
    this.redoStack.push(command)
    // Apply *before* pulse: the cache patch in the onApplied listener may
    // need to re-add a previously-deleted bbox row. Pulse listeners that
    // already exist still fire (e.g., on bbox-update / classification undo),
    // and the pendingPulse buffer covers freshly-mounted bboxes.
    this._emitApplied(command.entry, 'inverse')
    this._setPendingPulse(command.entry.observationId)
    this._emitPulse(command.entry.observationId)
    this._notifyChange()
  }

  async redo() {
    if (this.redoStack.length === 0) return
    const command = this.redoStack.pop()
    const preNavMediaId = this.getCurrentMediaId()
    try {
      await this._navigateIfNeeded(command.entry.mediaId)
      await command.redo()
    } catch (err) {
      this._emitError(`Couldn't redo: ${err.message}`)
      await this._tryRestoreNav(preNavMediaId)
      this._notifyChange()
      return
    }
    this.undoStack.push(command)
    this._emitApplied(command.entry, 'redo')
    this._setPendingPulse(command.entry.observationId)
    this._emitPulse(command.entry.observationId)
    this._notifyChange()
  }

  clear() {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this._notifyChange()
  }

  onError(fn) {
    this.errorListeners.add(fn)
    return () => this.errorListeners.delete(fn)
  }

  onPulse(fn) {
    this.pulseListeners.add(fn)
    return () => this.pulseListeners.delete(fn)
  }

  onChange(fn) {
    this.changeListeners.add(fn)
    return () => this.changeListeners.delete(fn)
  }

  // Fires after every successful exec / undo / redo with the entry that was
  // applied and a kind: 'forward' | 'inverse' | 'redo'. Used by the renderer
  // to keep the React Query cache in sync without waiting for a refetch.
  onApplied(fn) {
    this.appliedListeners.add(fn)
    return () => this.appliedListeners.delete(fn)
  }

  // Bbox components call this on mount to consume a pulse target that was
  // emitted before they were rendered (notably after an undo-of-delete).
  // Returns true if the caller should run its pulse animation; the buffer
  // is cleared on consumption so it can't fire twice.
  consumePendingPulse(observationId) {
    if (!this.pendingPulse) return false
    if (this.pendingPulse.observationId !== observationId) return false
    if (Date.now() > this.pendingPulse.expiresAt) {
      this.pendingPulse = null
      return false
    }
    this.pendingPulse = null
    return true
  }

  async _navigateIfNeeded(mediaId) {
    if (mediaId && this.getCurrentMediaId() !== mediaId) {
      await this.navigateTo(mediaId)
    }
  }

  // Best-effort: if a failed undo/redo moved the user to a different image,
  // navigate them back. Swallow errors so a broken back-nav can't itself
  // throw and obscure the original failure.
  async _tryRestoreNav(targetMediaId) {
    if (!targetMediaId) return
    if (this.getCurrentMediaId() === targetMediaId) return
    try {
      await this.navigateTo(targetMediaId)
    } catch {
      // ignore — user is already aware via the error toast
    }
  }

  _emitError(msg) {
    for (const fn of this.errorListeners) fn(msg)
  }

  _emitPulse(id) {
    for (const fn of this.pulseListeners) fn(id)
  }

  _notifyChange() {
    for (const fn of this.changeListeners) fn()
  }

  _emitApplied(entry, kind) {
    for (const fn of this.appliedListeners) fn(entry, kind)
  }

  _setPendingPulse(observationId) {
    if (!observationId) return
    this.pendingPulse = {
      observationId,
      expiresAt: Date.now() + PENDING_PULSE_TTL_MS
    }
  }
}

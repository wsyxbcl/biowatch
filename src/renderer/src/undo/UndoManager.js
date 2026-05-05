const STACK_CAP = 100

export class UndoManager {
  constructor({ getCurrentMediaId, navigateTo } = {}) {
    this.undoStack = []
    this.redoStack = []
    this.getCurrentMediaId = getCurrentMediaId ?? (() => null)
    this.navigateTo = navigateTo ?? (async () => {})
    this.errorListeners = new Set()
    this.pulseListeners = new Set()
    this.changeListeners = new Set()
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
    this._notifyChange()
  }

  async undo() {
    if (this.undoStack.length === 0) return
    const command = this.undoStack.pop()
    try {
      await this._navigateIfNeeded(command.entry.mediaId)
      await command.inverse()
    } catch (err) {
      this._emitError(`Couldn't undo: ${err.message}`)
      this._notifyChange()
      return
    }
    this.redoStack.push(command)
    this._emitPulse(command.entry.observationId)
    this._notifyChange()
  }

  async redo() {
    if (this.redoStack.length === 0) return
    const command = this.redoStack.pop()
    try {
      await this._navigateIfNeeded(command.entry.mediaId)
      await command.redo()
    } catch (err) {
      this._emitError(`Couldn't redo: ${err.message}`)
      this._notifyChange()
      return
    }
    this.undoStack.push(command)
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

  async _navigateIfNeeded(mediaId) {
    if (mediaId && this.getCurrentMediaId() !== mediaId) {
      await this.navigateTo(mediaId)
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
}

/**
 * Overview tab — IPC handlers
 */

import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import { getOverviewStats } from '../database/index.js'

export function registerOverviewIPCHandlers() {
  ipcMain.handle('overview:get-stats', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }
      const stats = await getOverviewStats(dbPath)
      return { data: stats }
    } catch (error) {
      log.error('Error getting overview stats:', error)
      return { error: error.message }
    }
  })
}

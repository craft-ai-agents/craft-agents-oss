import log from 'electron-log/renderer'

// Export scoped logger for renderer process
export const rendererLog = log.scope('renderer')

export default log

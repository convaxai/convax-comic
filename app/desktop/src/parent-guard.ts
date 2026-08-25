// Loaded by the independent Node process before the DSH entrypoint. The IPC
// channel is the lifetime lease from Electron; losing it must enter DSH's
// SIGTERM disposal path even if the desktop Host plugin has not mounted yet.
if (typeof process.send === 'function') {
  process.once('disconnect', () => {
    process.kill(process.pid, 'SIGTERM')
  })
}

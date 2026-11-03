const {app, BrowserWindow} = require('electron');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const run = process.argv[2];
const userData = path.join(run, 'userData');
app.setPath('userData', userData);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { win.restore(); win.show(); win.focus(); }
  });
  const entry = path.resolve(__dirname, '../dist-electron/platform/main/flowEditorEntry.js');
  process.argv = [process.execPath, entry, path.join(run,'project'), userData, '--workbench'];
  import(pathToFileURL(entry).href);
}

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    sendSignalingMessage: (message) => ipcRenderer.send('send-signaling-message', message), 
    onSignalingMessage: (callback) => ipcRenderer.on('signaling-message', (event, message) => callback(message)),
    onSignalingStatus: (callback) => ipcRenderer.on('signaling-status', (event, status) => callback(status)), 
    sendControlCommand: (command) => ipcRenderer.send('control-command', command),  
    getDesktopSources: (options) => ipcRenderer.invoke('get-desktop-sources', options),
});
 
import { contextBridge, ipcRenderer } from 'electron'

const ALLOWED_INVOKE = [
  'runs:list', 'runs:get', 'runs:create', 'runs:test', 'runs:cancel',
  'runs:approve', 'runs:reject', 'runs:delete', 'run:events:get',
  'runs:diff', 'workspace:open-in-cursor',
  'config:get', 'config:save',
  'auth:me', 'auth:login', 'auth:logout',
  'github:repos', 'github:issues', 'github:createIssue', 'github:issue-detail',
  'shell:open-external',
  'poller:sync',
]

const ALLOWED_ON = ['run:event', 'auth:success']

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel: string, ...args: unknown[]) => {
    if (!ALLOWED_INVOKE.includes(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (!ALLOWED_ON.includes(channel)) {
      throw new Error(`Blocked IPC channel: ${channel}`)
    }
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => {
      ipcRenderer.removeListener(channel, subscription)
    }
  },
})

/**
 * Daemon management stubs for MVP.
 * In production, these would spawn/kill the auto-issue daemon process.
 */

export function spawnDaemon(): void {
  console.log('[daemon] spawnDaemon called — no-op in MVP')
}

export function killDaemon(): void {
  // no-op in MVP
}

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SANDBOX_FAILURE = 'Render sandbox unavailable. Check sandbox dependencies and host security policy. Use --no-sandbox only to explicitly permit unrestricted rendering.'

export interface RenderLaunch {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
  cwd?: string
  isolated?: boolean
  cleanup?: () => Promise<void>
}

export function renderWorkerCommand(mode = '--internal-render-worker'): string[] {
  const bun = globalThis as typeof globalThis & { Bun?: { isStandaloneExecutable?: boolean } }
  if (bun.Bun?.isStandaloneExecutable) return [process.execPath, mode]
  const entry = fileURLToPath(new URL('./main' + (import.meta.url.endsWith('.ts') ? '.ts' : '.js'), import.meta.url))
  return process.versions.bun
    ? [process.execPath, '--no-install', entry, mode]
    : [process.execPath, ...(entry.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : []), entry, mode]
}

export function spawnRenderProcess(launch: RenderLaunch) {
  return spawn(launch.command, launch.args, {
    env: launch.env, cwd: launch.cwd, stdio: ['pipe', 'pipe', 'pipe'],
    detached: launch.isolated, windowsHide: true,
  })
}

export function stopRenderProcess(child: ChildProcess, isolated: boolean): void {
  if (isolated && child.pid) {
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  } else child.kill('SIGKILL')
}

export async function sandboxLaunch(command: string[]): Promise<RenderLaunch> {
  if (process.platform !== 'linux' && process.platform !== 'darwin') throw new Error(SANDBOX_FAILURE)
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-render-'))
  const [executable, ...args] = renderWorkerCommand('--internal-sandbox-launcher')
  return {
    command: executable, args: [...args, JSON.stringify(command), directory],
    env: {
      MDVIEW_PARENT_PID: String(process.pid), PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: directory, TMPDIR: directory,
      LANG: 'C.UTF-8', NODE_NO_WARNINGS: '1', TSX_DISABLE_CACHE: '1',
    },
    cwd: directory, isolated: true,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}

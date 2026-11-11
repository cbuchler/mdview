import { execFile, spawn } from 'node:child_process'
import { readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const runFile = promisify(execFile)
export const SANDBOX_FAILURE = 'Render sandbox unavailable. Linux requires Bubblewrap with user namespaces and ldd. Use --no-sandbox only to explicitly permit unrestricted rendering.'

export interface RenderLaunch {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
  cwd?: string
}

export function spawnRenderProcess(launch: RenderLaunch) {
  // Bubblewrap preserves passed descriptors. Keep the worker's descriptor set explicit.
  return spawn(launch.command, launch.args, {
    env: launch.env, cwd: launch.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
}

export async function sandboxLaunch(command: string[]): Promise<RenderLaunch> {
  if (process.platform !== 'linux') throw new Error(SANDBOX_FAILURE)
  try {
    const executable = await realpath(command[0])
    // Inspect only our trusted runtime, never an executable selected by document text.
    const { stdout } = await runFile('/usr/bin/ldd', [executable], {
      env: {}, timeout: 1000, maxBuffer: 64 * 1024,
    })
    const libraries = [...new Set(stdout.match(/\/[^\s()]+/g) ?? [])]
    if (!libraries.length || stdout.includes('not found')) throw new Error('Cannot resolve runtime libraries')
    const args = [
      '--unshare-all', '--unshare-user', '--disable-userns', '--assert-userns-disabled',
      '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
      '--setenv', 'PATH', '/nonexistent', '--setenv', 'HOME', '/nonexistent',
      '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'NODE_NO_WARNINGS', '1',
      '--setenv', 'TSX_DISABLE_CACHE', '1',
      '--proc', '/proc', '--remount-ro', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/app',
      '--chdir', '/app', '--ro-bind', executable, '/runtime',
    ]
    for (const library of libraries) args.push('--ro-bind', await realpath(library), library)

    const bun = globalThis as typeof globalThis & { Bun?: { isStandaloneExecutable?: boolean } }
    let workerArgs = command.slice(1)
    if (!bun.Bun?.isStandaloneExecutable) {
      const directory = path.dirname(fileURLToPath(import.meta.url))
      const root = path.dirname(directory)
      const relativeDirectory = path.basename(directory)
      // Mount application assets only. The checkout can also contain documents and secrets.
      for (const name of await readdir(directory)) {
        if (/\.(?:js|ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) {
          args.push('--ro-bind', path.join(directory, name), `/app/${relativeDirectory}/${name}`)
        }
      }
      args.push('--ro-bind', path.join(root, 'package.json'), '/app/package.json',
        '--ro-bind', path.join(root, 'node_modules'), '/app/node_modules')
      workerArgs = workerArgs.map((arg) => {
        if (arg.startsWith(root + '/')) return '/app' + arg.slice(root.length)
        if (arg.startsWith('file:')) {
          const file = fileURLToPath(arg)
          if (file.startsWith(root + '/')) return pathToFileURL('/app' + file.slice(root.length)).href
        }
        return arg
      })
    }
    args.push('--remount-ro', '/', '--', '/runtime', ...workerArgs)
    // Clear the launcher's environment too, before its dynamic loader can read it.
    return { command: '/usr/bin/bwrap', args, env: {}, cwd: '/' }
  } catch {
    throw new Error(SANDBOX_FAILURE)
  }
}

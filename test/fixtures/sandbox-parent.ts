import { sandboxLaunch, spawnRenderProcess } from '../../src/render-sandbox.js'

const launch = await sandboxLaunch([process.execPath, '-e', 'process.stdout.write("ready"); while (true) {}'])
if (process.env.MDVIEW_TEST_LAUNCHER) {
  launch.command = process.env.MDVIEW_TEST_LAUNCHER
  launch.args = ['--internal-sandbox-launcher', ...launch.args.slice(-2)]
}
const child = spawnRenderProcess(launch)
child.stdout!.once('data', () => process.stdout.write(JSON.stringify({ pid: child.pid, directory: launch.cwd }) + '\n'))
child.stderr!.pipe(process.stderr)

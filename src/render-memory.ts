export const RENDER_MEMORY_MIB = 256
export const RENDER_MEMORY_BYTES = RENDER_MEMORY_MIB * 1024 * 1024
export const MEMORY_READY = 'mdview-memory-ready-v1\n'

// Scope creation alone does not prove the memory controller is active.
export const VERIFY_MEMORY_SCOPE = `
set -eu
IFS=: read -r hierarchy controllers group < /proc/self/cgroup
[ "$hierarchy:$controllers" = '0:' ]
IFS= read -r memory < "/sys/fs/cgroup$group/memory.max"
IFS= read -r swap < "/sys/fs/cgroup$group/memory.swap.max"
IFS= read -r oom < "/sys/fs/cgroup$group/memory.oom.group"
[ "$memory" = '${RENDER_MEMORY_BYTES}' ] && [ "$swap" = 0 ] && [ "$oom" = 1 ]
exec "$@"
`

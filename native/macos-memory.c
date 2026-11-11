#include <dlfcn.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

extern char **environ;

int main(int argc, char **argv) {
  if (argc < 5) return 90;
  char *end;
  long limit = strtol(argv[2], &end, 10);
  if (*end || limit < 32 || limit > 4096) return 90;
  typedef int (*configure_limit)(posix_spawnattr_t *, short, int, int, int);
  configure_limit configure = (configure_limit)dlsym(RTLD_DEFAULT, "posix_spawnattr_setjetsam_ext");
  if (!configure) { fputs("macOS memory API unavailable\n", stderr); return 90; }
  posix_spawnattr_t attributes;
  int error = posix_spawnattr_init(&attributes);
  if (!error) error = posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETEXEC);
  if (!error) error = configure(&attributes, 0x04 | 0x08, 0, (int)limit, (int)limit);
  if (error) { fprintf(stderr, "macOS memory setup failed: %d\n", error); return 90; }
  if (setenv("DYLD_INSERT_LIBRARIES", argv[1], 1) || setenv("MDVIEW_MEMORY_MIB", argv[2], 1) ||
      setenv("MDVIEW_SANDBOX_PROFILE", argv[3], 1)) return 90;
  // SETEXEC applies the limit to the runtime itself; another exec would discard it.
  pid_t child;
  error = posix_spawn(&child, argv[4], NULL, &attributes, &argv[4], environ);
  fprintf(stderr, "macOS bounded runtime launch failed: %d\n", error);
  posix_spawnattr_destroy(&attributes);
  return 90;
}

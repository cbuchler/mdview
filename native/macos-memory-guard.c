#include <sandbox.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

__attribute__((constructor)) static void restrict_process(void) {
  const char *value = getenv("MDVIEW_MEMORY_MIB");
  char *end;
  long expected = value ? strtol(value, &end, 10) : 0;
  if (!value || *end || expected < 32 || expected > 4096) {
    fputs("macOS memory launch configuration missing\n", stderr);
    _exit(90);
  }
  char *error = NULL;
  if (sandbox_init("(version 1)(allow default)(deny process-fork)(deny process-exec)", 0, &error)) {
    fprintf(stderr, "macOS process restriction failed: %s\n", error ? error : "unknown");
    _exit(90);
  }
  unsetenv("DYLD_INSERT_LIBRARIES");
  unsetenv("MDVIEW_MEMORY_MIB");
  // The trusted launcher withholds input until the bounded exec has loaded this guard.
  static const char ready[] = "mdview-memory-ready-v1\n";
  if (write(3, ready, sizeof(ready) - 1) != sizeof(ready) - 1) _exit(90);
  close(3);
}

#include <sandbox.h>
#include <stdio.h>
#include <unistd.h>

__attribute__((constructor)) static void restrict_process(void) {
  char *error = NULL;
  if (sandbox_init("(version 1)(allow default)(deny process-fork)(deny process-exec)", 0, &error)) {
    fprintf(stderr, "process_policy_failed=%s\n", error ? error : "unknown");
    _exit(90);
  }
  fprintf(stderr, "process_policy_active\n");
}

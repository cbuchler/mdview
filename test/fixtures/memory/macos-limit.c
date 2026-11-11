#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  const rlim_t limit = 96UL * 1024 * 1024;
  int result;
  if (!strcmp(argv[1], "jetsam")) {
    result = syscall(SYS_memorystatus_control, 6, getpid(), 96, NULL, 0);
  } else {
    struct rlimit bound = { limit, limit };
    result = setrlimit(!strcmp(argv[1], "rss") ? RLIMIT_RSS : RLIMIT_AS, &bound);
  }
  printf("limit_setup=%d errno=%d\n", result, errno);
  fflush(stdout);
  if (result) return 3;
  // Touch a bounded allocation so virtual reservation alone cannot count as enforcement.
  for (int i = 0; i < 192; i++) {
    volatile unsigned char *page = malloc(1024 * 1024);
    if (!page) { printf("allocation_failed_mb=%d\n", i); return 4; }
    for (int n = 0; n < 1024 * 1024; n += 4096) page[n] = 1;
  }
  puts("allocation_completed_mb=192");
  return 0;
}

#include <dlfcn.h>
#include <errno.h>
#include <mach/mach.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  const rlim_t limit = 96UL * 1024 * 1024;
  if (!strcmp(argv[1], "spawn") || !strcmp(argv[1], "raise-spawn")) {
    typedef int (*set_jetsam)(posix_spawnattr_t *, short, int, int, int);
    set_jetsam configure = (set_jetsam)dlsym(RTLD_DEFAULT, "posix_spawnattr_setjetsam_ext");
    if (!configure) { puts("spawn_api_unavailable"); return 3; }
    posix_spawnattr_t attr;
    posix_spawnattr_init(&attr);
    int mb = !strcmp(argv[1], "raise-spawn") ? 384 : 96;
    int result = configure(&attr, 0x04 | 0x08, 0, mb, mb);
    printf("spawn_limit_setup=%d uid=%d\n", result, getuid());
    fflush(stdout);
    if (result) return 3;
    pid_t child;
    char *args[] = { argv[0], argc > 2 ? argv[2] : "allocate", NULL };
    result = posix_spawn(&child, argv[0], NULL, &attr, args, environ);
    posix_spawnattr_destroy(&attr);
    printf("spawn_result=%d\n", result);
    if (result) return 3;
    int status;
    if (waitpid(child, &status, 0) < 0) return 5;
    printf("child_signal=%d child_exit=%d\n", WIFSIGNALED(status) ? WTERMSIG(status) : 0, WIFEXITED(status) ? WEXITSTATUS(status) : -1);
    return 0;
  }
  if (!strcmp(argv[1], "fork") || !strcmp(argv[1], "respawn")) {
    pid_t child;
    if (!strcmp(argv[1], "fork")) {
      child = fork();
      if (child == 0) argv[1] = "allocate";
      else if (child < 0) return 5;
    } else {
      char *args[] = { argv[0], "allocate", NULL };
      int error = posix_spawn(&child, argv[0], NULL, NULL, args, environ);
      if (error) { printf("respawn_error=%d\n", error); return 5; }
    }
    if (child != 0) {
      int status;
      waitpid(child, &status, 0);
      printf("descendant_signal=%d descendant_exit=%d\n", WIFSIGNALED(status) ? WTERMSIG(status) : 0, WIFEXITED(status) ? WEXITSTATUS(status) : -1);
      return 0;
    }
  }
  if (!strcmp(argv[1], "exec")) {
    execl(argv[0], argv[0], "allocate", NULL);
    return 5;
  }
  int result = 0;
  if (!strcmp(argv[1], "jetsam")) {
    result = syscall(SYS_memorystatus_control, 6, getpid(), 96, NULL, 0);
  } else if (!strcmp(argv[1], "footprint")) {
    typedef kern_return_t (*set_footprint)(task_t, int, int *);
    set_footprint configure = (set_footprint)dlsym(RTLD_DEFAULT, "task_set_phys_footprint_limit");
    int old_limit = 0;
    result = configure ? configure(mach_task_self(), 96, &old_limit) : -1;
    printf("mach_result=%d old_limit=%d\n", result, old_limit);
  } else if (strcmp(argv[1], "allocate")) {
    rlim_t requested = limit;
    if (!strcmp(argv[1], "relative-as")) {
      mach_task_basic_info_data_t info;
      mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
      if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&info, &count)) return 5;
      printf("baseline_virtual=%llu baseline_resident=%llu\n", (unsigned long long)info.virtual_size, (unsigned long long)info.resident_size);
      requested += info.virtual_size;
    }
    struct rlimit bound = { requested, requested };
    result = setrlimit(RLIMIT_AS, &bound);
  }
  printf("limit_setup=%d errno=%d\n", result, errno);
  fflush(stdout);
  if (result) return 3;
  // Touch a bounded allocation so virtual reservation alone cannot count as enforcement.
  for (int i = 0; i < 192; i++) {
    volatile unsigned char *page = mmap(NULL, 1024 * 1024, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
    if (page == MAP_FAILED) { printf("allocation_failed_mb=%d errno=%d\n", i, errno); return 4; }
    for (int n = 0; n < 1024 * 1024; n += 4096) page[n] = 1;
    if ((i + 1) % 32 == 0) { printf("touched_mb=%d\n", i + 1); fflush(stdout); }
  }
  puts("allocation_completed_mb=192");
  return 0;
}

#define _GNU_SOURCE
#include <errno.h>
#include <sched.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Invalid arguments distinguish the filter's errno from kernel validation. */
int main(void) {
  if (syscall(SYS_socket, AF_UNIX, SOCK_STREAM, 0) != -1 || errno != EPERM) return 1;
  if (syscall(SYS_socket, AF_VSOCK, SOCK_STREAM, 0) != -1 || errno != EPERM) return 2;
  if (syscall(SYS_io_uring_setup, 0, 0) != -1 || errno != EPERM) return 3;
  if (syscall(SYS_unshare, 0) != -1 || errno != EPERM) return 4;
  if (syscall(SYS_clone3, 0, 0) != -1 || errno != ENOSYS) return 5;
  if (syscall(SYS_clone, CLONE_NEWUSER | SIGCHLD, 0, 0, 0, 0) != -1 || errno != EPERM) return 6;
  if (syscall(SYS_mount, 0, 0, 0, 0, 0) != -1 || errno != EPERM) return 7;
  int pair[2];
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair)) return 8;
  close(pair[0]); close(pair[1]);
  return 0;
}

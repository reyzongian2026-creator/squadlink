// Detached updater for a prepared .app on the same volume. No elevated privileges.
#include <sys/event.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

extern char **environ;

static int run(char *const args[]) {
    pid_t child;
    if (posix_spawn(&child, args[0], NULL, NULL, args, environ) != 0) return -1;
    int status;
    while (waitpid(child, &status, 0) < 0) if (errno != EINTR) return -1;
    return WIFEXITED(status) && WEXITSTATUS(status) == 0 ? 0 : -1;
}

static int verify(char *app) {
    char *args[] = {"/usr/bin/codesign", "--verify", "--deep", "--strict", app, NULL};
    return run(args);
}

static int same_bundle(const char *path, uint64_t device, uint64_t inode) {
    struct stat st;
    return lstat(path, &st) == 0 && S_ISDIR(st.st_mode) &&
           (uint64_t)st.st_dev == device && (uint64_t)st.st_ino == inode;
}

static void clean(char *work) {
    char *args[] = {"/bin/rm", "-rf", work, NULL};
    run(args);
}

static int launch_and_confirm(char *installed, char *profile) {
    char executable[PATH_MAX];
    if (snprintf(executable,sizeof executable,"%s/Contents/MacOS/Electron",installed) >= (int)sizeof executable) return -1;
    // Avoid fd 3 when constructing the pipe (it is reserved for the child's acknowledgement).
    int fds[2];
    if (pipe(fds) != 0) return -1;
    int output = fcntl(fds[1], F_DUPFD_CLOEXEC, 4);
    close(fds[1]);
    if (output < 0) { close(fds[0]); return -1; }
    fcntl(fds[0], F_SETFD, FD_CLOEXEC);

    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, output, 3);
    posix_spawn_file_actions_addclose(&actions, output);
    setenv("SQUADLINK_MAC_UPDATE_READY","3",1);
    char *args[] = {executable, profile, NULL};
    pid_t child;
    int launched = posix_spawn(&child,executable,&actions,NULL,args,environ);
    posix_spawn_file_actions_destroy(&actions);
    unsetenv("SQUADLINK_MAC_UPDATE_READY");
    close(output);
    if (launched != 0) { close(fds[0]); return -1; }

    char response[6] = {0};
    size_t offset = 0;
    const time_t deadline = time(NULL) + 90;
    for (;;) {
        int status;
        if (waitpid(child, &status, WNOHANG) == child) { close(fds[0]); return -1; }
        if (time(NULL) >= deadline) break;
        struct pollfd p = {.fd=fds[0], .events=POLLIN};
        if (poll(&p,1,250) > 0) {
            ssize_t n = read(fds[0],response + offset,sizeof response - offset);
            if (n <= 0) break;
            offset += (size_t)n;
            if (offset == sizeof response) {
                if (memcmp(response,"READY\n",sizeof response) == 0) { close(fds[0]); return 0; }
                break;
            }
        }
    }
    close(fds[0]);
    // The candidate did not finish initialization. Only signal the child we started.
    // Never replace a bundle underneath a process that is still running.
    kill(child, SIGTERM);
    for (int i = 0; i < 100; ++i) {
        if (waitpid(child,NULL,WNOHANG) == child) return -1;
        usleep(100000);
    }
    return -2;
}

int main(int argc, char **argv) {
    if (argc != 8) return 1;
    char profile_arg[PATH_MAX+32], *profile=NULL;
    if (*argv[7]) {
        if (argv[7][0] != '/' || snprintf(profile_arg,sizeof profile_arg,"--user-data-dir=%s",argv[7]) >= (int)sizeof profile_arg) return 1;
        profile=profile_arg;
    }
    pid_t parent = (pid_t)strtol(argv[1],NULL,10);
    if (parent <= 1 || parent != getppid()) return 1;
    char *installed=argv[2], *work=argv[3], staged[PATH_MAX], log[PATH_MAX];
    const char *base = strrchr(work,'/'), *appbase = strrchr(installed,'/');
    struct stat dir;
    if (!base || !appbase || !strstr(appbase,".app") || base-work != appbase-installed ||
        strncmp(work,installed,(size_t)(base-work)) || strncmp(base,"/.squadlink-update-",19) ||
        lstat(work,&dir) || !S_ISDIR(dir.st_mode) || dir.st_uid != getuid() || (dir.st_mode & 077)) return 1;
    if (snprintf(staged,sizeof staged,"%s/Squadlink Moderno.app",work) >= (int)sizeof staged ||
        snprintf(log,sizeof log,"%s/install.log",work) >= (int)sizeof log) return 1;
    uint64_t dev=strtoull(argv[4],NULL,10), old=strtoull(argv[5],NULL,10), next=strtoull(argv[6],NULL,10);
    if (!same_bundle(installed,dev,old) || !same_bundle(staged,dev,next)) return 1;

    int queue=kqueue();
    struct kevent event;
    EV_SET(&event,(uintptr_t)parent,EVFILT_PROC,EV_ADD|EV_ONESHOT,NOTE_EXIT,0,NULL);
    if (queue < 0 || kevent(queue,&event,1,NULL,0,NULL) < 0) return 1;
    int logfd=open(log,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
    if (logfd < 0) return 1;
    dup2(logfd,STDERR_FILENO);
    close(logfd);
    if (write(STDOUT_FILENO,"READY\n",6) != 6) return 1;
    // Do not retain the IPC pipe after the callback in Electron finishes.
    dup2(STDERR_FILENO,STDOUT_FILENO);
    const struct timespec timeout = {.tv_sec=120};
    int exited;
    do { exited=kevent(queue,NULL,0,&event,1,&timeout); } while (exited < 0 && errno == EINTR);
    close(queue);
    if (exited != 1 || (event.flags & EV_ERROR)) { clean(work); return 1; }
    char *restart[] = {"/usr/bin/open","-n",installed,profile ? "--args" : NULL,profile,NULL};
    if (!same_bundle(installed,dev,old) || !same_bundle(staged,dev,next) || verify(staged) != 0 ||
        renamex_np(installed,staged,RENAME_SWAP) != 0) {
        if (same_bundle(installed,dev,old)) run(restart);
        clean(work);
        return 1;
    }
    int result = launch_and_confirm(installed,profile);
    if (result == 0) { clean(work); return 0; }
    if (result == -2 || !same_bundle(installed,dev,next) || !same_bundle(staged,dev,old) ||
        renamex_np(installed,staged,RENAME_SWAP) != 0) {
        fprintf(stderr,"Se conserva la copia anterior en %s.\n",staged);
        return 1;
    }
    run(restart);
    clean(work);
    return 1;
}

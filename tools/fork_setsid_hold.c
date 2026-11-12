#define _GNU_SOURCE

#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <unistd.h>

static void hold_forever(void) {
    for (;;) {
        sleep(1);
    }
}

int main(void) {
    pid_t child = fork();
    if (child < 0) {
        perror("fork");
        return EXIT_FAILURE;
    }
    if (child == 0) {
        if (setsid() < 0) {
            perror("setsid");
            return EXIT_FAILURE;
        }
        printf("child_pid=%d session_id=%d\n", getpid(), getsid(0));
        fflush(stdout);
        hold_forever();
    }
    printf("parent_pid=%d child_pid=%d\n", getpid(), child);
    fflush(stdout);
    hold_forever();
    return EXIT_SUCCESS;
}

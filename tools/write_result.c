#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: write_result PATH\n");
        return EXIT_FAILURE;
    }
    FILE *file = fopen(argv[1], "wb");
    if (file == NULL) {
        perror("fopen");
        return EXIT_FAILURE;
    }
    const char payload[] = "gpu-scavenger-result\n";
    if (fwrite(payload, 1, sizeof(payload) - 1, file) != sizeof(payload) - 1) {
        perror("fwrite");
        fclose(file);
        return EXIT_FAILURE;
    }
    if (fclose(file) != 0) {
        perror("fclose");
        return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
}

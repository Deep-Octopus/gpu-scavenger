#include <cuda_runtime.h>

#include <atomic>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <csignal>
#include <string>
#include <thread>
#include <unistd.h>

namespace {

volatile std::sig_atomic_t checkpoint_requested = 0;

void request_checkpoint(int) {
    checkpoint_requested = 1;
}

bool write_checkpoint(const char* path) {
    const std::string temporary = std::string(path) + ".tmp";
    const int fd = open(temporary.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) {
        std::perror("open checkpoint");
        return false;
    }
    const std::string payload = "gpu-scavenger-checkpoint pid=" +
        std::to_string(static_cast<int>(getpid())) + "\n";
    const ssize_t written = write(fd, payload.data(), payload.size());
    const bool flushed = written == static_cast<ssize_t>(payload.size()) && fsync(fd) == 0;
    const bool closed = close(fd) == 0;
    if (!flushed || !closed) {
        std::perror("flush checkpoint");
        return false;
    }
    if (rename(temporary.c_str(), path) != 0) {
        std::perror("rename checkpoint");
        return false;
    }
    std::printf("checkpoint_ready path=%s bytes=%zu\n", path, payload.size());
    std::fflush(stdout);
    return true;
}

}  // namespace

int main() {
    const char* checkpoint_path = std::getenv("GPU_SCAVENGER_CHECKPOINT_PATH");
    if (checkpoint_path == nullptr || checkpoint_path[0] == '\0') {
        std::fprintf(stderr, "GPU_SCAVENGER_CHECKPOINT_PATH is required\n");
        return EXIT_FAILURE;
    }
    std::signal(SIGUSR1, request_checkpoint);

    constexpr std::size_t kBytes = 256ULL * 1024ULL * 1024ULL;
    void* buffer = nullptr;
    if (cudaSetDevice(0) != cudaSuccess || cudaMalloc(&buffer, kBytes) != cudaSuccess) {
        return EXIT_FAILURE;
    }
    if (cudaMemset(buffer, 0, kBytes) != cudaSuccess || cudaDeviceSynchronize() != cudaSuccess) {
        cudaFree(buffer);
        return EXIT_FAILURE;
    }
    std::printf("checkpoint_hold pid=%d bytes=%zu\n", static_cast<int>(getpid()), kBytes);
    std::fflush(stdout);
    for (;;) {
        if (checkpoint_requested != 0) {
            checkpoint_requested = 0;
            if (!write_checkpoint(checkpoint_path)) {
                cudaFree(buffer);
                return EXIT_FAILURE;
            }
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
}

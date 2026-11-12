#include <cuda_runtime.h>

#include <chrono>
#include <cstdio>
#include <thread>
#include <unistd.h>

int main() {
    constexpr std::size_t kBytes = 256ULL * 1024ULL * 1024ULL;
    void* buffer = nullptr;
    if (cudaSetDevice(0) != cudaSuccess) {
        return 2;
    }
    if (cudaMalloc(&buffer, kBytes) != cudaSuccess) {
        return 3;
    }
    if (cudaMemset(buffer, 0, kBytes) != cudaSuccess) {
        cudaFree(buffer);
        return 4;
    }
    if (cudaDeviceSynchronize() != cudaSuccess) {
        cudaFree(buffer);
        return 5;
    }
    std::printf("cuda_hold pid=%d bytes=%zu\n", static_cast<int>(getpid()), kBytes);
    std::fflush(stdout);
    for (;;) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }
}

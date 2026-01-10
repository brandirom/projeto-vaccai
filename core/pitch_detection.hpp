#ifndef PITCH_DETECTION_HPP
#define PITCH_DETECTION_HPP

#include <vector>
#include <cmath>   // Essencial para log2
#include <algorithm> // Essencial para max/min

namespace PitchAlgo {
    // Declaração da função
    float find_fundamental(const float* buffer, int size, int sample_rate);
    
    // Implementação inline da conversão (seguro manter aqui)
    inline float hz_to_midi(float hz) {
        if (hz <= 0) return 0.0f;
        // log2 faz parte de cmath e deve ser chamado com std::
        return 69.0f + 12.0f * std::log2(hz / 440.0f);
    }
}

#endif
#ifndef PITCH_DETECTION_HPP
#define PITCH_DETECTION_HPP

#include <vector>
#include <cmath>     
#include <algorithm>

namespace PitchAlgo {

    struct PitchResult {
        float frequency; // A frequência fundamental detectada em Hz
        float clarity;   // Grau de certeza (0.0 a 1.0). Voz limpa tende a 1.0, ruído tende a 0.
    };

    /**
     * @brief Detector de Frequência Fundamental (f0)
     * * @param buffer O pedaço de áudio bruto a ser analisado.
     * @param size Tamanho do buffer.
     * @param sample_rate Taxa de amostragem.
     */
    PitchResult find_fundamental(const float* buffer, int size, int sample_rate);
    
    // Converte Hertz para escala MIDI (Ex: 440Hz -> 69)
    inline float hz_to_midi(float hz) {
        if (hz <= 0) return 0.0f;
        return 69.0f + 12.0f * std::log2(hz / 440.0f);
    }
}

#endif
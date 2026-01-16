#ifndef PITCH_DETECTION_HPP
#define PITCH_DETECTION_HPP

#include <vector>
#include <cmath>     
#include <algorithm>

namespace PitchAlgo {

    /**
     * @brief Calcula a frequência fundamental (f0) de um buffer de áudio.
     * * Utiliza o método de Autocorrelação no domínio do tempo para identificar
     * a periodicidade do sinal.
     * * @param buffer Ponteiro para o array de floats contendo o áudio bruto.
     * @param size Tamanho do buffer (número de amostras).
     * @param sample_rate Taxa de amostragem.
     * @return float A frequência detectada em Hz, ou 0.0f se não detectada.
     */
    float find_fundamental(const float* buffer, int size, int sample_rate);
    
    /**
     * @brief Converte uma frequência em Hertz para o número da nota MIDI.
     * * @param hz Frequência em Hertz.
     * @return float O número da nota MIDI (ex: 69.0 para A4, 60.0 para C4).
     * Retorna valores fracionários (ex: 60.5 indica um C4 desafinado para cima).
     */
    inline float hz_to_midi(float hz) {
        // Proteção contra log de zero ou negativo
        if (hz <= 0) return 0.0f;
        
        // Fórmula: m = 69 + 12 * log2(f / 440)
        // 69 é o número MIDI da nota Lá (A4) de 440Hz.
        return 69.0f + 12.0f * std::log2(hz / 440.0f);
    }
}

#endif // PITCH_DETECTION_HPP
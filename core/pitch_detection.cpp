#include "pitch_detection.hpp"
#include <vector>
#include <cmath>

namespace PitchAlgo {

    float find_fundamental(const float* buffer, int size, int sample_rate) {
        // Implementação básica de Autocorrelação para teste
        float best_correlation = 0.0f;
        int best_lag = -1;

        // Definindo limites de busca (aprox 50Hz a 1000Hz)
        int min_lag = sample_rate / 1000; 
        int max_lag = sample_rate / 50;   

        // Segurança para não estourar o buffer
        if (max_lag >= size) max_lag = size - 1;

        for (int lag = min_lag; lag < max_lag; lag++) {
            float correlation = 0.0f;
            // O loop interno deve parar antes de estourar buffer[i + lag]
            for (int i = 0; i < size - lag; i++) {
                correlation += buffer[i] * buffer[i + lag];
            }
            
            // Normalização simples (opcional, mas ajuda na precisão)
            if (correlation > best_correlation) {
                best_correlation = correlation;
                best_lag = lag;
            }
        }

        if (best_lag > 0) {
            return (float)sample_rate / (float)best_lag;
        }
        
        return 0.0f;
    }

}
#include "pitch_detection.hpp"
#include <vector>
#include <cmath>
#include <algorithm> // Necessário para std::abs

namespace PitchAlgo {

    float find_fundamental(const float* buffer, int size, int sample_rate) {
        float best_correlation = 0.0f;
        int best_lag = -1;

        // Limites de busca (50Hz - 1000Hz)
        int min_lag = sample_rate / 1000; 
        int max_lag = sample_rate / 50;   

        if (max_lag >= size) max_lag = size - 1;

        // 1. Busca Bruta (Autocorrelação)
        for (int lag = min_lag; lag < max_lag; lag++) {
            float correlation = 0.0f;

            // Autocorrelação enviesada (biased)
            for (int i = 0; i < size - lag; i++) {
                correlation += buffer[i] * buffer[i + lag];
            }
            
            if (correlation > best_correlation) {
                best_correlation = correlation;
                best_lag = lag;
            }
        }

        // 2. Refinamento (Interpolação Parabólica)
        // Isso resolve o problema dos degraus/picos, calculando a frequência "entre" as amostras
        if (best_lag > min_lag && best_lag < max_lag - 1) {
            
            float corr_prev = 0.0f;
            float corr_next = 0.0f;

            // Calcula correlação dos vizinhos (lag-1 e lag+1)
            for (int i = 0; i < size - (best_lag - 1); i++) 
                corr_prev += buffer[i] * buffer[i + (best_lag - 1)];

            for (int i = 0; i < size - (best_lag + 1); i++) 
                corr_next += buffer[i] * buffer[i + (best_lag + 1)];

            // Fórmula da Interpolação Parabólica
            float denominator = 2.0f * best_correlation - corr_prev - corr_next;
            
            if (std::abs(denominator) > 0.0001f) {
                float delta = 0.5f * (corr_next - corr_prev) / denominator;
                return (float)sample_rate / ((float)best_lag + delta);
            }
        }
        
        // Retorno padrão se a interpolação não for possível
        if (best_lag > 0) {
            return (float)sample_rate / (float)best_lag;
        }
        
        return 0.0f;
    }
}
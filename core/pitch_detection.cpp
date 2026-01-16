#include "pitch_detection.hpp"
#include <vector>
#include <cmath>

namespace PitchAlgo {

    float find_fundamental(const float* buffer, int size, int sample_rate) {
        // Inicializa a melhor correlação encontrada como 0
        float best_correlation = 0.0f;
        // O 'best_lag' representará o período (em amostras) da onda fundamental
        int best_lag = -1;

        // =========================================================
        // Definição dos Limites de Busca (Janela de Frequência)
        // =========================================================
        // Frequência = sample_rate / lag
        // Logo, lag = sample_rate / Frequência
        
        // Lag mínimo corresponde à frequência máxima (1000Hz). 
        // Ex: Em 48kHz, 48000/1000 = 48 amostras.
        int min_lag = sample_rate / 1000; 
        
        // Lag máximo corresponde à frequência mínima (50Hz).
        // Ex: Em 48kHz, 48000/50 = 960 amostras.
        int max_lag = sample_rate / 50;   

        // Segurança: O lag não pode ser maior que o tamanho do buffer,
        // senão tentaríamos acessar memória fora do array.
        if (max_lag >= size) max_lag = size - 1;

        // =========================================================
        // Loop de Autocorrelação (Força Bruta)
        // =========================================================
        // Testamos cada possível atraso (lag) dentro da faixa vocal humana.
        for (int lag = min_lag; lag < max_lag; lag++) {
            float correlation = 0.0f;

            // Multiplica o sinal original pelo sinal deslocado (atrasado por 'lag').
            // O limite (size - lag) garante que 'i + lag' nunca exceda 'size'.
            for (int i = 0; i < size - lag; i++) {
                correlation += buffer[i] * buffer[i + lag];
            }
            
            // Se a soma dos produtos (correlação) atual for maior que a melhor já vista,
            // significa que encontramos um alinhamento melhor da onda.
            if (correlation > best_correlation) {
                best_correlation = correlation;
                best_lag = lag;
            }
        }

        // =========================================================
        // Cálculo da Frequência Final
        // =========================================================
        // Se encontramos um lag válido, convertemos o período (amostras) para frequência (Hz).
        if (best_lag > 0) {
            return (float)sample_rate / (float)best_lag;
        }
        
        // Retorna 0.0f se nenhuma correlação significativa for encontrada
        return 0.0f;
    }

}
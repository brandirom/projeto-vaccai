#include "pitch_detection.hpp"
#include <vector>
#include <cmath>
#include <algorithm>
#include <cfloat>

namespace PitchAlgo {

    PitchResult find_fundamental(const float* buffer, int size, int sample_rate) {
        // Define a faixa de busca humana (aprox. 50Hz a 1000Hz)
        // Lag (atraso) maior = frequência menor (graves).
        int min_lag = sample_rate / 1000;
        int max_lag = sample_rate / 50; 
        
        if (max_lag > size / 2) max_lag = size / 2;

        std::vector<float> yin_buffer(max_lag, 0.0f);

        // --- PASSO 1: Diferença Quadrática ---
        // Em vez de procurar onde o sinal é MAIS parecido (correlação),
        // procuramos onde a diferença é MENOR (perto de zero).
        for (int tau = 0; tau < max_lag; tau++) {
            float diff_sum = 0.0f;
            for (int i = 0; i < (size / 2); i++) { 
                float delta = buffer[i] - buffer[i + tau];
                diff_sum += delta * delta;
            }
            yin_buffer[tau] = diff_sum;
        }

        // --- PASSO 2: CMNDF (Normalização Cumulativa) ---
        // O "atraso zero" sempre tem diferença zero (sinal comparado com ele mesmo).
        // Essa etapa normaliza o erro para evitar que o algoritmo escolha o zero
        // ou harmônicos errados (erros de oitava).
        yin_buffer[0] = 1.0f;
        float running_sum = 0.0f;
        
        for (int tau = 1; tau < max_lag; tau++) {
            running_sum += yin_buffer[tau];
            if (running_sum == 0) {
                yin_buffer[tau] = 1.0f;
            } else {
                yin_buffer[tau] *= tau / running_sum;
            }
        }

        // --- PASSO 3: Seleção do Melhor Candidato (Vale) ---
        // Procuramos o primeiro "vale" no gráfico de erro que seja fundo o suficiente.
        // O Threshold define o quão tolerante somos a "sujeira" no som.
        int best_tau = -1;
        float min_val = 1000.0f;
        const float YIN_THRESHOLD = 0.15f; // Aceita som com até 15% de aperiodicidade

        for (int tau = min_lag; tau < max_lag; tau++) {
            if (yin_buffer[tau] < YIN_THRESHOLD) {
                // Achamos um candidato válido! Agora procuramos o fundo exato desse vale.
                while (tau + 1 < max_lag && yin_buffer[tau + 1] < yin_buffer[tau]) {
                    tau++;
                }
                best_tau = tau;
                min_val = yin_buffer[tau];
                break; // Encontrou a fundamental! Para aqui para evitar pegar a oitava errada.
            }
        }

        // Fallback: Se a voz for muito ruidosa e nenhum vale cruzar o limiar,
        // pegamos a melhor opção disponível (mínimo global).
        if (best_tau == -1) {
            int global_min_tau = -1;
            float global_min_val = 1000.0f;
            for (int tau = min_lag; tau < max_lag; tau++) {
                if (yin_buffer[tau] < global_min_val) {
                    global_min_val = yin_buffer[tau];
                    global_min_tau = tau;
                }
            }
            best_tau = global_min_tau;
            min_val = global_min_val;
        }

        // --- PASSO 4: Refinamento Parabólico (Precisão Sub-sample) ---
        // O pico real pode estar "entre" duas amostras digitais.
        // Ajustamos uma parábola nos vizinhos para achar o vértice exato.
        // Isso garante a precisão de "Cents" necessária para música.
        float final_tau = (float)best_tau;
        if (best_tau > 0 && best_tau < max_lag - 1) {
            float s0 = yin_buffer[best_tau - 1];
            float s1 = yin_buffer[best_tau];
            float s2 = yin_buffer[best_tau + 1];
            float denominator = 2.0f * s1 - s2 - s0;
            if (std::abs(denominator) > 0.0001f) {
                final_tau += (s2 - s0) / (2.0f * denominator);
            }
        }

        // Cálculo Final: Frequência = Amostras por Segundo / Atraso
        float clarity = 1.0f - std::min(min_val, 1.0f);
        float frequency = (float)sample_rate / final_tau;

        return { frequency, clarity };
    }
}
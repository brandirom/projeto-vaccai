#ifndef DSP_ENGINE_HPP
#define DSP_ENGINE_HPP

#include <vector>
#include <cmath>
#include <cstdint> // Para tipos de inteiros

// Estrutura de dados que será devolvida para o Javascript
struct AnalysisResult {
    float frequency;      
    float midi_note;      
    float pitch_error;    
    float stability;      
    float rms_amplitude;
    // Mudamos para std::vector para facilitar o binding com JS
    std::vector<float> chroma; 
};

class DSPEngine {
public:
    DSPEngine(int sample_rate, int buffer_size);
    ~DSPEngine();

    // A assinatura muda ligeiramente: Embind lida melhor com endereços de memória
    // passados como 'int' ou 'uintptr_t' vindo do JS.
    AnalysisResult process(uintptr_t input_buffer_ptr);

private:
    int sample_rate;
    int buffer_size;

    // Métodos internos
    void compute_fft(const float* buffer); // Será implementado depois com KissFFT

    std::vector<float> pitch_history;
};

#endif
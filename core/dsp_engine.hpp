#ifndef DSP_ENGINE_HPP
#define DSP_ENGINE_HPP

#include <vector>
#include <cmath>
#include <cstdint>

struct AnalysisResult {
    float frequency;      // Frequência SUAVIZADA (EWMA)
    float raw_frequency;  // Frequência BRUTA (para debug)
    float midi_note;      
    float pitch_error;    
    float stability;      // Nova métrica: 0.0 (caos) a 1.0 (tom puro)
    float rms_amplitude;
    std::vector<float> chroma; 
};

class DSPEngine {
public:
    DSPEngine(int sample_rate, int buffer_size);
    ~DSPEngine();

    AnalysisResult process(uintptr_t input_buffer_ptr);

private:
    int sample_rate;
    int buffer_size;

    // --- ESTADO PERSISTENTE (MEMÓRIA) ---
    float smoothed_frequency; // O valor acumulado do filtro EWMA
    float smoothing_factor;   // O Alpha (0.0 a 1.0). Quanto menor, mais suave e lento.

    // Métodos internos
    void remove_dc_offset(float* buffer, int size);
    float compute_rms(const float* buffer, int size);
};

#endif
#ifndef DSP_ENGINE_HPP
#define DSP_ENGINE_HPP

#include <vector>
#include <cmath>
#include <cstdint>
#include <algorithm> // Necessário para sort

struct AnalysisResult {
    float frequency;      
    float midi_note;      
    float pitch_error;    
    float stability;      
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
    
    // FILTRO DE MEDIANA
    // Guardaremos os últimos 5 valores de frequência bruta
    std::vector<float> median_buffer; 
    int median_idx;

    // Métodos internos
    float compute_rms(const float* buffer, int size);
    void remove_dc_offset(float* buffer, int size);
    float apply_median_filter(float new_freq);
};

#endif
#ifndef DSP_ENGINE_HPP
#define DSP_ENGINE_HPP

#include <vector>
#include <cmath>
#include <cstdint>
#include <algorithm>

struct AnalysisResult {
    float frequency;      
    float midi_note;      
    float pitch_error;    
    float stability;      
    float rms_amplitude;
    std::vector<float> chroma;
    
    // NOVO: Informação da Escala Detectada
    int detected_key;   // 0=C, 1=C#, etc... -1 se incerto
    int detected_mode;  // 0=Major, 1=Minor
};

class DSPEngine {
public:
    DSPEngine(int sample_rate, int buffer_size);
    ~DSPEngine();

    AnalysisResult process(uintptr_t input_buffer_ptr);

private:
    int sample_rate;
    int buffer_size;
    
    // Filtro de Mediana
    std::vector<float> median_buffer; 
    int median_idx;

    // NOVO: Histórico de Notas para detecção de escala
    std::vector<float> key_accumulator; // Tamanho 12

    float compute_rms(const float* buffer, int size);
    void remove_dc_offset(float* buffer, int size);
    float apply_median_filter(float new_freq);
    
    // NOVO: Função que calcula a escala
    void update_key_detector(float midi_note, int& out_key, int& out_mode);
};

#endif
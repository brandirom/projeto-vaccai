#ifndef DSP_ENGINE_HPP
#define DSP_ENGINE_HPP

#include <vector>
#include <cmath>
#include <cstdint>
#include <algorithm>

/**
 * @brief Estrutura de dados que contém o resultado da análise de um frame de áudio.
 * É esta estrutura que será retornada para o JavaScript/Front-end.
 */
struct AnalysisResult {
    float frequency;      // Frequência fundamental em Hz
    float midi_note;      // Nota MIDI com fração
    float pitch_error;    // Erro de afinação em centésimos
    float stability;      // Métrica de estabilidade (0.0 = Instável, 1.0 = Sólido)
    float rms_amplitude;  // Volume/Energia do sinal
    std::vector<float> chroma; // Vetor de intensidade das 12 notas
    
    // --- Detecção de Tonalidade (Key Detection) ---
    int detected_key;   // Tônica detectada: 0=C, 1=C# ... 11=B
    int detected_mode;  // Modo detectado: 0=Major, 1=Minor
};

/**
 * @brief Motor principal de processamento de sinal (Digital Signal Processing).
 */
class DSPEngine {
public:
    DSPEngine(int sample_rate, int buffer_size);
    ~DSPEngine();

    AnalysisResult process(uintptr_t input_buffer_ptr);

private:
    int sample_rate;
    int buffer_size;
    
    // --- NOVAS VARIÁVEIS PARA MELHORAR A ESTABILIDADE ---
    
    // 1. Filtro de Suavização (Low Pass Filter)
    // Guarda a frequência do frame anterior para fazer uma média ponderada
    float smoothed_frequency; 

    // 2. Mecanismo de Hold (Preencher Buracos)
    // Guarda a última nota válida para usar caso o som falhe por milissegundos
    float last_valid_freq;    
    int frames_since_valid;   

    // ----------------------------------------------------

    // --- Filtro de Mediana ---
    std::vector<float> median_buffer; 
    int median_idx;

    // --- Métrica de Estabilidade ---
    std::vector<float> stability_buffer; 
    int stability_idx;

    // --- Algoritmo de Detecção de Escala (HMM) ---
    std::vector<float> key_accumulator; 

    // --- Métodos Auxiliares ---
    float compute_rms(const float* buffer, int size);
    void remove_dc_offset(float* buffer, int size);
    float apply_median_filter(float new_freq);
    void update_key_detector(float midi_note, int& out_key, int& out_mode);
};

#endif
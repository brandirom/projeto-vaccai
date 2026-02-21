#ifndef DSP_ENGINE_HPP
#define DSP_ENGINE_HPP

#include <vector>
#include <cmath>
#include <cstdint>
#include <algorithm>

// O pacote de dados final que a UI recebe a cada quadro
struct AnalysisResult {
    float frequency;      // Frequência Hz (suavizada)
    float midi_note;      // Nota MIDI (ex: 60.0 = Dó Central)
    float pitch_error;    // Desvio em Cents (-50 a +50)
    float stability;      // Quão firme está a voz (0.0 a 1.0)
    float rms_amplitude;  // Volume
    
    std::vector<float> chroma; // Probabilidade de cada uma das 12 notas
    
    int detected_key;   // Tom detectado (0=C, 1=C#...)
    int detected_mode;  // 0=Maior, 1=Menor
};

class DSPEngine {
public:
    DSPEngine(int sample_rate, int buffer_size);
    ~DSPEngine();

    // Processa um buffer de áudio e retorna a análise
    AnalysisResult process(uintptr_t input_buffer_ptr);

private:
    int sample_rate;
    int buffer_size;
    
    // --- FILTRO DEBOUNCE (ANTI-ESCADA) ---
    // Evita que a nota mude bruscamente por um erro de milissegundos.
    float pending_freq;      
    int pending_duration;    

    // --- VARIÁVEIS DE ESTABILIDADE ---
    // Mantém o valor anterior para criar uma transição suave no gráfico.
    float smoothed_frequency; 
    float last_valid_freq;    
    int frames_since_valid;   

    // --- BUFFERS DE FILTRAGEM ---
    std::vector<float> median_buffer; // Remove picos errados (outliers)
    int median_idx;

    std::vector<float> stability_buffer; // Histórico para calcular o score de estabilidade
    int stability_idx;

    // --- HMM (TONALIDADE) ---
    // Acumula a probabilidade de cada tom ao longo do tempo (Memória musical)
    std::vector<float> key_accumulator; 

    // --- MÉTODOS AUXILIARES ---
    float compute_rms(const float* buffer, int size); // Calcula Volume
    float compute_zcr(const float* buffer, int size); // Calcula "Chiado" (Zero Crossings)
    void remove_dc_offset(float* buffer, int size);   // Centraliza a onda no zero
    float apply_median_filter(float new_freq);        // Filtro estatístico
    
    // O "Detetive Harmônico" que descobre o tom da música
    void update_key_detector(float midi_note, int& out_key, int& out_mode);
};

#endif
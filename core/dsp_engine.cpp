#include "dsp_engine.hpp"
#include "pitch_detection.hpp"
#include <cmath>
#include <vector>
#include <algorithm> // Para std::min/max
#include <emscripten/bind.h>

using namespace emscripten;

DSPEngine::DSPEngine(int sr, int bs) : sample_rate(sr), buffer_size(bs) {
    // Inicialização do Estado
    smoothed_frequency = 0.0f;
    
    // FATOR ALPHA (Afinado manualmente)
    // 0.1 = Muito lento (robótico)
    // 0.9 = Muito rápido (instável)
    // 0.3 a 0.5 = O "Sweet Spot" para voz humana
    smoothing_factor = 0.4f; 
}

DSPEngine::~DSPEngine() {}

void DSPEngine::remove_dc_offset(float* buffer, int size) {
    float sum = 0.0f;
    for (int i = 0; i < size; i++) sum += buffer[i];
    float mean = sum / size;
    for (int i = 0; i < size; i++) buffer[i] -= mean;
}

float DSPEngine::compute_rms(const float* buffer, int size) {
    float sum = 0.0f;
    for (int i = 0; i < size; i++) sum += buffer[i] * buffer[i];
    return std::sqrt(sum / size);
}

AnalysisResult DSPEngine::process(uintptr_t input_buffer_ptr) {
    float* audio_buffer = reinterpret_cast<float*>(input_buffer_ptr);
    AnalysisResult res;

    // 1. Pré-processamento
    remove_dc_offset(audio_buffer, buffer_size);
    res.rms_amplitude = compute_rms(audio_buffer, buffer_size);

    // Threshold de silêncio
    const float NOISE_THRESHOLD = 0.005f;

    if (res.rms_amplitude > NOISE_THRESHOLD) {
        
        // 2. Detecção Bruta (Raw)
        float current_raw = PitchAlgo::find_fundamental(audio_buffer, buffer_size, sample_rate);
        res.raw_frequency = current_raw;

        // Filtro de sanidade (50Hz - 1400Hz)
        if (current_raw > 50.0f && current_raw < 1400.0f) {
            
            // 3. LÓGICA EWMA (STATEFUL)
            if (smoothed_frequency == 0.0f) {
                // Se vinhamos de silêncio, não suaviza a entrada (Snap to note)
                // Isso evita o efeito "slide" no ataque da nota
                smoothed_frequency = current_raw;
            } else {
                // Aplica o filtro: Novo = Alpha * Bruto + (1-Alpha) * Antigo
                // Verificação de Pulo Grande: Se a nota mudar mais de 50Hz num frame (mudança de oitava abrupta),
                // resetamos o filtro para responder rápido.
                if (std::abs(current_raw - smoothed_frequency) > 50.0f) {
                     smoothed_frequency = current_raw;
                } else {
                     smoothed_frequency = (smoothing_factor * current_raw) + 
                                          ((1.0f - smoothing_factor) * smoothed_frequency);
                }
            }

            res.frequency = smoothed_frequency;

            // 4. CÁLCULO DE ESTABILIDADE RELATIVA
            // Compara o desvio entre o Bruto e o Suavizado
            // Se o bruto está variando muito em torno da média, stability cai.
            float deviation = std::abs(res.raw_frequency - res.frequency);
            
            // Normaliza a estabilidade (Se desvio > 5Hz, estabilidade tende a zero)
            float stability_metric = 1.0f - (deviation / 5.0f);
            res.stability = std::max(0.0f, std::min(1.0f, stability_metric));

            // 5. Cálculos Finais de Nota
            res.midi_note = PitchAlgo::hz_to_midi(res.frequency);
            float note_nearest = std::round(res.midi_note);
            res.pitch_error = (res.midi_note - note_nearest) * 100.0f;

        } else {
            // Frequência inválida detectada
            // Não zeramos smoothed_frequency imediatamente aqui para tolerar micro-falhas de detecção
            // mas marcamos o resultado como inválido
            res.frequency = 0;
            res.midi_note = 0;
            res.pitch_error = 0;
            res.stability = 0;
        }

    } else {
        // SILÊNCIO ABSOLUTO (RESET DE ESTADO)
        // Isso garante que a próxima frase comece "limpa"
        smoothed_frequency = 0.0f;
        
        res.frequency = 0;
        res.raw_frequency = 0;
        res.midi_note = 0;
        res.pitch_error = 0;
        res.stability = 0;
    }

    res.chroma.resize(12, 0.0f);
    return res;
}

EMSCRIPTEN_BINDINGS(vox_engine) {
    register_vector<float>("FloatVector");
    value_object<AnalysisResult>("AnalysisResult")
        .field("frequency", &AnalysisResult::frequency)
        .field("raw_frequency", &AnalysisResult::raw_frequency) // Novo campo
        .field("midi_note", &AnalysisResult::midi_note)
        .field("pitch_error", &AnalysisResult::pitch_error)
        .field("stability", &AnalysisResult::stability)
        .field("rms_amplitude", &AnalysisResult::rms_amplitude)
        .field("chroma", &AnalysisResult::chroma);

    class_<DSPEngine>("DSPEngine")
        .constructor<int, int>()
        .function("process", &DSPEngine::process, allow_raw_pointers());
}
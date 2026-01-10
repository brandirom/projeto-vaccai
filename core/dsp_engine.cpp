#include "dsp_engine.hpp"
#include "pitch_detection.hpp"
#include <cmath>
#include <vector>
#include <numeric>
#include <algorithm>
#include <emscripten/bind.h>

using namespace emscripten;

DSPEngine::DSPEngine(int sr, int bs) : sample_rate(sr), buffer_size(bs) {
    median_buffer.resize(5, 0.0f);
    median_idx = 0;
    
    // Inicializa acumulador com zeros
    key_accumulator.resize(12, 0.0f);
}

DSPEngine::~DSPEngine() {}

// ... (Mantenha remove_dc_offset, compute_rms e apply_median_filter IGUAIS ao anterior) ...
// ... Copie as funções do passo anterior aqui ...
// Vou pular a cópia para economizar espaço, mas mantenha elas no arquivo!

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

float DSPEngine::apply_median_filter(float new_freq) {
    median_buffer[median_idx] = new_freq;
    median_idx = (median_idx + 1) % median_buffer.size();
    std::vector<float> sorted = median_buffer;
    std::sort(sorted.begin(), sorted.end());
    return sorted[2];
}

// ==================================================
// ALGORITMO DE DETECÇÃO DE ESCALA (KEY DETECTION)
// ==================================================
void DSPEngine::update_key_detector(float midi_note, int& out_key, int& out_mode) {
    // 1. Decaimento (Memória de curto prazo)
    // Multiplicamos por 0.995 a cada frame. Notas antigas vão sumindo.
    for(int i=0; i<12; i++) {
        key_accumulator[i] *= 0.995f;
    }

    // 2. Adiciona a nota atual
    if (midi_note > 0) {
        int note_idx = (int)round(midi_note) % 12;
        // Adiciona energia. Usamos 1.0. Se quiser ser mais chique, pode usar a amplitude.
        key_accumulator[note_idx] += 1.0f;
    }

    // 3. Comparação com Templates (Major e Minor)
    // Perfil Krumhansl-Schmuckler Simplificado (Binário para performance)
    // 1 = Nota pertence à escala, 0 = Não pertence
    const int profile_major[12] = {1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1}; // Intervalos: W-W-H-W-W-W-H
    const int profile_minor[12] = {1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0}; // Natural Minor

    float best_score = -1.0f;
    out_key = -1;
    out_mode = 0; // 0=Major, 1=Minor

    // Testa as 12 tônicas possíveis para Escala Maior
    for (int root = 0; root < 12; root++) {
        float score = 0.0f;
        for (int i = 0; i < 12; i++) {
            // Rotaciona o perfil para a tônica atual
            int interval = (i - root + 12) % 12;
            if (profile_major[interval] == 1) {
                score += key_accumulator[i];
            } else {
                // Penalidade para notas fora da escala
                score -= key_accumulator[i] * 0.5f; 
            }
        }
        if (score > best_score) {
            best_score = score;
            out_key = root;
            out_mode = 0;
        }
    }

    // Testa as 12 tônicas possíveis para Escala Menor
    for (int root = 0; root < 12; root++) {
        float score = 0.0f;
        for (int i = 0; i < 12; i++) {
            int interval = (i - root + 12) % 12;
            if (profile_minor[interval] == 1) {
                score += key_accumulator[i];
            } else {
                score -= key_accumulator[i] * 0.5f;
            }
        }
        if (score > best_score) {
            best_score = score;
            out_key = root;
            out_mode = 1;
        }
    }
}

AnalysisResult DSPEngine::process(uintptr_t input_buffer_ptr) {
    float* audio_buffer = reinterpret_cast<float*>(input_buffer_ptr);
    AnalysisResult res;
    
    // ... (Pré-processamento igual) ...
    remove_dc_offset(audio_buffer, buffer_size);
    res.rms_amplitude = compute_rms(audio_buffer, buffer_size);

    const float NOISE_THRESHOLD = 0.005f;
    float raw_frequency = 0.0f;

    if (res.rms_amplitude > NOISE_THRESHOLD) {
        raw_frequency = PitchAlgo::find_fundamental(audio_buffer, buffer_size, sample_rate);
    }

    float filtered_frequency = apply_median_filter(raw_frequency);

    if (filtered_frequency > 55.0f && filtered_frequency < 1400.0f) {
        res.frequency = filtered_frequency;
        res.midi_note = PitchAlgo::hz_to_midi(res.frequency);
        float note_nearest = std::round(res.midi_note);
        res.pitch_error = (res.midi_note - note_nearest) * 100.0f;
    } else {
        res.frequency = 0; res.midi_note = 0; res.pitch_error = 0;
    }
    
    // Stub Chroma e Stability
    res.chroma.resize(12, 0.0f);
    res.stability = 0.0f;

    // NOVO: Atualiza a detecção de escala
    update_key_detector(res.midi_note, res.detected_key, res.detected_mode);

    return res;
}

EMSCRIPTEN_BINDINGS(vox_engine) {
    register_vector<float>("FloatVector");
    value_object<AnalysisResult>("AnalysisResult")
        .field("frequency", &AnalysisResult::frequency)
        .field("midi_note", &AnalysisResult::midi_note)
        .field("pitch_error", &AnalysisResult::pitch_error)
        .field("stability", &AnalysisResult::stability)
        .field("rms_amplitude", &AnalysisResult::rms_amplitude)
        .field("chroma", &AnalysisResult::chroma)
        .field("detected_key", &AnalysisResult::detected_key)   // NOVO
        .field("detected_mode", &AnalysisResult::detected_mode); // NOVO

    class_<DSPEngine>("DSPEngine")
        .constructor<int, int>()
        .function("process", &DSPEngine::process, allow_raw_pointers());
}
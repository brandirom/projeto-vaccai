#include "dsp_engine.hpp"
#include "pitch_detection.hpp"
#include <cmath>
#include <vector>
#include <numeric>
#include <algorithm>
#include <emscripten/bind.h>

using namespace emscripten;

// ==================================================
// MATRIZ DE TRANSIÇÃO (Círculo de Quintas)
// ==================================================
std::vector<std::vector<float>> build_transition_matrix() {
    std::vector<std::vector<float>> trans(24, std::vector<float>(24, 0.0f));
    for (int from = 0; from < 24; from++) {
        for (int to = 0; to < 24; to++) {
            int from_note = from % 12;
            int to_note = to % 12;
            bool from_is_minor = (from >= 12);
            bool to_is_minor = (to >= 12);

            int diff = std::abs(to_note - from_note);
            int harmonic_dist = (diff * 7) % 12;
            if (harmonic_dist < 0) harmonic_dist += 12;
            harmonic_dist = std::min(harmonic_dist, 12 - harmonic_dist);

            float prob = 0.001f; 

            if (from_is_minor == to_is_minor) {
                if (harmonic_dist == 0) prob = 0.80f;      
                else if (harmonic_dist == 1) prob = 0.08f; 
            } else {
                // Relativas (ex: C Major <-> A Minor)
                int semitone_diff = std::abs((from % 12) - (to % 12));
                if (semitone_diff == 9 || semitone_diff == 3) prob = 0.10f;
            }
            trans[from][to] = prob;
        }
    }
    return trans;
}

static std::vector<std::vector<float>> TRANSITION_MATRIX = build_transition_matrix();

// ==================================================
// IMPLEMENTAÇÃO DSPEngine
// ==================================================

DSPEngine::DSPEngine(int sr, int bs) : sample_rate(sr), buffer_size(bs) {
    median_buffer.resize(5, 0.0f);
    median_idx = 0;
    
    // MUDANÇA: 24 estados com Probabilidade inicial uniforme
    key_accumulator.resize(24, 1.0f / 24.0f); 
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

float DSPEngine::apply_median_filter(float new_freq) {
    median_buffer[median_idx] = new_freq;
    median_idx = (median_idx + 1) % median_buffer.size();
    std::vector<float> sorted = median_buffer;
    std::sort(sorted.begin(), sorted.end());
    return sorted[2];
}

// ALGORITMO DE DETECÇÃO HMM (Forward Simplificado)
void DSPEngine::update_key_detector(float midi_note, int& out_key, int& out_mode) {
    if (midi_note <= 0) return; 

    // 1. PROBABILIDADE DE EMISSÃO
    std::vector<float> emission(24, 0.0f);
    int note_idx = (int)std::round(midi_note) % 12;

    const int profile_major[12] = {1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1}; 
    const int profile_minor[12] = {1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0}; 

    for (int k = 0; k < 24; k++) {
        int root = k % 12;
        bool is_minor = k >= 12;
        int interval = (note_idx - root + 12) % 12;
        bool in_scale = is_minor ? profile_minor[interval] : profile_major[interval];
        emission[k] = in_scale ? 1.0f : 0.05f; 
    }

    // 2. ATUALIZAÇÃO HMM
    std::vector<float> next_probs(24, 0.0f);
    
    // Normalização para evitar drift numérico
    float sum_prev = 0.0f;
    for(float p : key_accumulator) sum_prev += p;
    if(sum_prev > 0) {
        for(int i=0; i<24; i++) key_accumulator[i] /= sum_prev;
    } else {
        for(int i=0; i<24; i++) key_accumulator[i] = 1.0f / 24.0f;
    }

    // Encontra o melhor estado anterior (Vencedor leva tudo para estabilidade)
    int best_prev_k = 0;
    float max_prev = -1.0f;
    for(int i=0; i<24; i++) {
        if(key_accumulator[i] > max_prev) {
            max_prev = key_accumulator[i];
            best_prev_k = i;
        }
    }

    // Calcula novo estado baseado em Bayes simplificado
    for (int k = 0; k < 24; k++) {
        float transition_prob = TRANSITION_MATRIX[best_prev_k][k];
        next_probs[k] = emission[k] * (key_accumulator[k] * 0.9f + transition_prob * 0.1f);
    }

    key_accumulator = next_probs;

    // 3. ENCONTRA O VENCEDOR
    float best_score = -1.0f;
    int winner_idx = 0;
    for (int k = 0; k < 24; k++) {
        if (key_accumulator[k] > best_score) {
            best_score = key_accumulator[k];
            winner_idx = k;
        }
    }

    out_key = winner_idx % 12;
    out_mode = (winner_idx >= 12) ? 1 : 0;
}

AnalysisResult DSPEngine::process(uintptr_t input_buffer_ptr) {
    float* audio_buffer = reinterpret_cast<float*>(input_buffer_ptr);
    AnalysisResult res;
    
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
    
    res.chroma.resize(12, 0.0f);
    res.stability = 0.0f;

    update_key_detector(res.midi_note, res.detected_key, res.detected_mode);

    return res;
}

// ==================================================
// BINDINGS PARA WEB ASSEMBLY
// ==================================================

EMSCRIPTEN_BINDINGS(vox_engine) {
    register_vector<float>("FloatVector");
    value_object<AnalysisResult>("AnalysisResult")
        .field("frequency", &AnalysisResult::frequency)
        .field("midi_note", &AnalysisResult::midi_note)
        .field("pitch_error", &AnalysisResult::pitch_error)
        .field("stability", &AnalysisResult::stability)
        .field("rms_amplitude", &AnalysisResult::rms_amplitude)
        .field("chroma", &AnalysisResult::chroma)
        .field("detected_key", &AnalysisResult::detected_key)
        .field("detected_mode", &AnalysisResult::detected_mode);

    class_<DSPEngine>("DSPEngine")
        .constructor<int, int>()
        .function("process", &DSPEngine::process, allow_raw_pointers());
}
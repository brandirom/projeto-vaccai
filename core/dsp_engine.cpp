#include "dsp_engine.hpp"
#include "pitch_detection.hpp"
#include <cmath>
#include <vector>
#include <numeric>
#include <algorithm>
#include <emscripten/bind.h>

using namespace emscripten;

// ==================================================
// MATRIZ DE TRANSIÇÃO (Lógica Musical / Círculo de Quintas)
// ==================================================
std::vector<std::vector<float>> build_transition_matrix() {
    // 24 estados: 0-11 (Maior), 12-23 (Menor)
    std::vector<std::vector<float>> trans(24, std::vector<float>(24, 0.0f));
    
    for (int from = 0; from < 24; from++) {
        for (int to = 0; to < 24; to++) {
            int from_note = from % 12;
            int to_note = to % 12;
            bool from_is_minor = (from >= 12);
            bool to_is_minor = (to >= 12);

            // Calcula distância no Círculo de Quintas
            int diff = std::abs(to_note - from_note);
            int harmonic_dist = (diff * 7) % 12; 
            if (harmonic_dist < 0) harmonic_dist += 12;
            harmonic_dist = std::min(harmonic_dist, 12 - harmonic_dist);

            float prob = 0.001f; // Probabilidade base

            if (from_is_minor == to_is_minor) {
                // Mesmo modo
                if (harmonic_dist == 0) prob = 0.80f;      // Inércia
                else if (harmonic_dist == 1) prob = 0.08f; // Dominante/Subdominante
            } else {
                // Mudança de Modo (Relativas)
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
    // Inicializa buffers de processamento
    median_buffer.resize(5, 0.0f);
    median_idx = 0;
    
    stability_buffer.resize(15, 0.0f);
    stability_idx = 0;
    
    // Inicializa detector de escala com probabilidade uniforme
    key_accumulator.resize(24, 1.0f / 24.0f); 

    // --- INICIALIZAÇÃO DAS NOVAS VARIÁVEIS (HOLD E LPF) ---
    smoothed_frequency = 0.0f;
    last_valid_freq = 0.0f;
    frames_since_valid = 0;
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

// Filtro Não-Linear (Mediana)
float DSPEngine::apply_median_filter(float new_freq) {
    median_buffer[median_idx] = new_freq;
    median_idx = (median_idx + 1) % median_buffer.size();
    
    // 'static' para evitar realocação a cada frame
    static std::vector<float> sort_buffer;
    
    if (sort_buffer.size() != median_buffer.size()) {
        sort_buffer = median_buffer;
    } else {
        std::copy(median_buffer.begin(), median_buffer.end(), sort_buffer.begin());
    }
    
    std::sort(sort_buffer.begin(), sort_buffer.end());
    
    return sort_buffer[2]; // Retorna a mediana
}

// ==================================================
// ALGORITMO DE DETECÇÃO HMM (GAUSSIANO / FUZZY)
// ==================================================
void DSPEngine::update_key_detector(float midi_note, int& out_key, int& out_mode) {
    if (midi_note <= 0) return; 

    static const std::vector<int> major_intervals = {0, 2, 4, 5, 7, 9, 11};
    static const std::vector<int> minor_intervals = {0, 2, 3, 5, 7, 8, 10};

    const float sigma = 0.4f; 
    const float two_sigma_sq = 2.0f * sigma * sigma;

    std::vector<float> emission(24, 0.0f);

    for (int k = 0; k < 24; k++) {
        int root = k % 12;
        bool is_minor = k >= 12;
        const auto& scale_intervals = is_minor ? minor_intervals : major_intervals;

        float min_dist = 100.0f; 
        float note_chroma = fmod(midi_note, 12.0f); 
        if (note_chroma < 0) note_chroma += 12.0f;

        for (int interval : scale_intervals) {
            float target = fmod((float)(root + interval), 12.0f);
            float dist = std::abs(note_chroma - target);
            if (dist > 6.0f) dist = 12.0f - dist;
            if (dist < min_dist) min_dist = dist;
        }

        emission[k] = std::exp(-(min_dist * min_dist) / two_sigma_sq);
        emission[k] += 0.01f; 
    }

    std::vector<float> next_probs(24, 0.0f);
    
    int best_prev_k = 0;
    float max_prev = -1.0f;
    for(int i=0; i<24; i++) {
        if(key_accumulator[i] > max_prev) {
            max_prev = key_accumulator[i];
            best_prev_k = i;
        }
    }

    for (int k = 0; k < 24; k++) {
        float transition_prob = TRANSITION_MATRIX[best_prev_k][k];
        next_probs[k] = emission[k] * (key_accumulator[k] * 0.9f + transition_prob * 0.1f);
    }

    float sum_new = 0.0f;
    for (float p : next_probs) sum_new += p;
    
    if (sum_new > 0) {
        for (int i = 0; i < 24; i++) next_probs[i] /= sum_new;
    } else {
        for (int i = 0; i < 24; i++) next_probs[i] = 1.0f / 24.0f;
    }

    key_accumulator = next_probs;

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

// ==================================================
// FUNÇÃO PRINCIPAL DE PROCESSAMENTO
// ==================================================
AnalysisResult DSPEngine::process(uintptr_t input_buffer_ptr) {
    float* audio_buffer = reinterpret_cast<float*>(input_buffer_ptr);
    AnalysisResult res;
    
    // 1. Pré-processamento
    remove_dc_offset(audio_buffer, buffer_size);
    res.rms_amplitude = compute_rms(audio_buffer, buffer_size);

    // Ajuste de Threshold para pegar dinâmicas mais suaves
    const float NOISE_THRESHOLD = 0.002f; 
    float raw_frequency = 0.0f;

    if (res.rms_amplitude > NOISE_THRESHOLD) {
        raw_frequency = PitchAlgo::find_fundamental(audio_buffer, buffer_size, sample_rate);
    }

    // ===========================================================
    // NOVO: Mecanismo de HOLD (Preenche Buracos)
    // ===========================================================
    // Se o pitch caiu para zero (erro/consoante), mas faz pouco tempo que ouvimos algo válido,
    // mantemos a nota anterior.
    const int MAX_HOLD_FRAMES = 8; // ~130ms a 60fps (Ajustável)

    if (raw_frequency > 50.0f) {
        // Sinal válido detectado: atualiza memória e reseta contador
        last_valid_freq = raw_frequency;
        frames_since_valid = 0;
    } else {
        // Sinal inválido ou silêncio
        if (frames_since_valid < MAX_HOLD_FRAMES && last_valid_freq > 50.0f) {
            // Estamos no "tempo de carência", mantenha a nota!
            raw_frequency = last_valid_freq;
            frames_since_valid++;
        } else {
            // Tempo esgotou, é silêncio real ou pausa longa.
            raw_frequency = 0.0f;
            last_valid_freq = 0.0f; // Reseta para não "glissar" do nada na próxima nota
        }
    }

    // 3. Filtro de Mediana (Tira erros grosseiros/pulos de oitava)
    float median_freq = apply_median_filter(raw_frequency);

    // ===========================================================
    // NOVO: Filtro Passa-Baixa (LPF - Smoothing)
    // ===========================================================
    // Suaviza a transição entre frequências para remover o "serrilhado" (jitter).
    // Alpha: 0.6f é um bom equilíbrio para voz pop.
    const float alpha = 0.6f; 

    if (median_freq > 0.0f) {
        if (smoothed_frequency <= 0.0f) {
            // Primeiro frame de som (Ataque): pule direto para o valor (sem inércia)
            smoothed_frequency = median_freq;
        } else {
            // Frames subsequentes (Sustentação): aplique a suavização exponencial
            smoothed_frequency = (smoothed_frequency * (1.0f - alpha)) + (median_freq * alpha);
        }
    } else {
        // Release rápido no silêncio
        smoothed_frequency = 0.0f;
    }

    // Usamos a frequência suavizada para o resto da lógica
    float final_frequency = smoothed_frequency;

    // 4. Validação e Conversão
    if (final_frequency > 55.0f && final_frequency < 1400.0f) {
        res.frequency = final_frequency;
        res.midi_note = PitchAlgo::hz_to_midi(res.frequency);
        
        float note_nearest = std::round(res.midi_note);
        res.pitch_error = (res.midi_note - note_nearest) * 100.0f;
    } else {
        res.frequency = 0; res.midi_note = 0; res.pitch_error = 0;
    }
    
    res.chroma.resize(12, 0.0f); 

    // --- CÁLCULO DE ESTABILIDADE (Desvio Padrão) ---
    if (res.frequency > 0) {
        stability_buffer[stability_idx] = res.midi_note;
        stability_idx = (stability_idx + 1) % stability_buffer.size();

        float sum = 0.0f;
        for (float v : stability_buffer) sum += v;
        float mean = sum / stability_buffer.size();

        float sq_sum = 0.0f;
        for (float v : stability_buffer) sq_sum += (v - mean) * (v - mean);
        float variance = sq_sum / stability_buffer.size();
        float stdev = std::sqrt(variance);

        res.stability = 1.0f - std::min(stdev / 0.5f, 1.0f); 
    } else {
        res.stability = 0.0f;
    }

    // 5. Detecção de Tonalidade (HMM)
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
        .field("detected_key", &AnalysisResult::detected_key)
        .field("detected_mode", &AnalysisResult::detected_mode);

    class_<DSPEngine>("DSPEngine")
        .constructor<int, int>()
        .function("process", &DSPEngine::process, allow_raw_pointers());
}
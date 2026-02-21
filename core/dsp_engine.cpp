#include "dsp_engine.hpp"
#include "pitch_detection.hpp"
#include <cmath>
#include <vector>
#include <numeric>
#include <algorithm>
#include <emscripten/bind.h>

using namespace emscripten;

// ==================================================
// MATRIZ DE TRANSIÇÃO (HMM - Tonalidade)
// ==================================================
// Define a probabilidade da música mudar de tom.
// Baseado no Círculo de Quintas: Mudar para um tom vizinho é provável,
// mudar para um tom distante é improvável. Cria uma "inércia musical".
std::vector<std::vector<float>> build_transition_matrix() {
    std::vector<std::vector<float>> trans(24, std::vector<float>(24, 0.0f));
    for (int from = 0; from < 24; from++) {
        for (int to = 0; to < 24; to++) {
            int from_note = from % 12;
            int to_note = to % 12;
            bool from_is_minor = (from >= 12);
            bool to_is_minor = (to >= 12);
            
            // Calcula distância harmônica no Círculo de Quintas
            int diff = std::abs(to_note - from_note);
            int harmonic_dist = (diff * 7) % 12; 
            if (harmonic_dist < 0) harmonic_dist += 12;
            harmonic_dist = std::min(harmonic_dist, 12 - harmonic_dist);
            
            float prob = 0.001f; // Probabilidade base mínima
            
            // Regras de modulação comuns (ex: Relativa Menor, Dominante, Subdominante)
            if (from_is_minor == to_is_minor) {
                if (harmonic_dist == 0) prob = 0.80f; // Mesmo tom (alta chance)
                else if (harmonic_dist == 1) prob = 0.08f; // Vizinho próximo
            } else {
                int semitone_diff = std::abs((from % 12) - (to % 12));
                if (semitone_diff == 9 || semitone_diff == 3) prob = 0.10f; // Relativa
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
    // Inicializa buffers com zeros
    median_buffer.resize(5, 0.0f);
    median_idx = 0;
    stability_buffer.resize(15, 0.0f);
    stability_idx = 0;
    
    // Inicia com probabilidade igual para todos os tons (1/24)
    key_accumulator.resize(24, 1.0f / 24.0f); 

    smoothed_frequency = 0.0f;
    last_valid_freq = 0.0f;
    frames_since_valid = 0;
    pending_freq = 0.0f;
    pending_duration = 0;
}

DSPEngine::~DSPEngine() {}

// Centraliza o sinal verticalmente para o zero
void DSPEngine::remove_dc_offset(float* buffer, int size) {
    float sum = 0.0f; for (int i = 0; i < size; i++) sum += buffer[i];
    float mean = sum / size; for (int i = 0; i < size; i++) buffer[i] -= mean;
}

// Calcula Energia (Volume)
float DSPEngine::compute_rms(const float* buffer, int size) {
    float sum = 0.0f; for (int i = 0; i < size; i++) sum += buffer[i] * buffer[i];
    return std::sqrt(sum / size);
}

// Calcula Taxa de Cruzamento por Zero (Identifica ruído vs sons puros)
// Sons de "Sss" ou "Fff" cruzam o zero muitas vezes. Voz cantada cruza menos.
float DSPEngine::compute_zcr(const float* buffer, int size) {
    int crossings = 0;
    for (int i = 1; i < size; i++) {
        if ((buffer[i] >= 0 && buffer[i-1] < 0) || (buffer[i] < 0 && buffer[i-1] >= 0)) {
            crossings++;
        }
    }
    return (float)crossings / (float)size;
}

// Filtro de Mediana: Remove picos de erro isolados (spikes) sem atrasar muito o sinal
float DSPEngine::apply_median_filter(float new_freq) {
    median_buffer[median_idx] = new_freq;
    median_idx = (median_idx + 1) % median_buffer.size();
    static std::vector<float> sort_buffer;
    sort_buffer = median_buffer;
    std::sort(sort_buffer.begin(), sort_buffer.end());
    return sort_buffer[2]; // Retorna o valor do meio
}

// Lógica probabilística para descobrir o tom da música (HMM Fuzzy)
void DSPEngine::update_key_detector(float midi_note, int& out_key, int& out_mode) {
    if (midi_note <= 0) return; 
    
    // Intervalos da escala Maior e Menor Natural
    static const std::vector<int> major_intervals = {0, 2, 4, 5, 7, 9, 11};
    static const std::vector<int> minor_intervals = {0, 2, 3, 5, 7, 8, 10};
    
    // Calcula "Probabilidade de Emissão":
    // Qual a chance da nota cantada pertencer a cada um dos 24 tons?
    // Usa uma lógica "Fuzzy" (não binária) para aceitar notas levemente desafinadas.
    const float sigma = 0.4f; const float two_sigma_sq = 2.0f * sigma * sigma;
    std::vector<float> emission(24, 0.0f);
    
    for (int k = 0; k < 24; k++) {
        int root = k % 12; bool is_minor = k >= 12;
        const auto& scale_intervals = is_minor ? minor_intervals : major_intervals;
        
        // Acha a distância da nota atual para a nota mais próxima da escala k
        float min_dist = 100.0f; 
        float note_chroma = fmod(midi_note, 12.0f); 
        if (note_chroma < 0) note_chroma += 12.0f;
        
        for (int interval : scale_intervals) {
            float target = fmod((float)(root + interval), 12.0f);
            float dist = std::abs(note_chroma - target);
            if (dist > 6.0f) dist = 12.0f - dist; // Distância circular (relógio)
            if (dist < min_dist) min_dist = dist;
        }
        // Gaussiana: Quanto menor a distância, maior a probabilidade
        emission[k] = std::exp(-(min_dist * min_dist) / two_sigma_sq) + 0.01f; 
    }

    // Combina a observação atual com a memória (Inércia + Matriz de Transição)
    std::vector<float> next_probs(24, 0.0f);
    int best_prev_k = 0; float max_prev = -1.0f;
    for(int i=0; i<24; i++) { if(key_accumulator[i] > max_prev) { max_prev = key_accumulator[i]; best_prev_k = i; } }
    
    for (int k = 0; k < 24; k++) {
        float transition_prob = TRANSITION_MATRIX[best_prev_k][k];
        // 90% memória, 10% transição * emissão atual
        next_probs[k] = emission[k] * (key_accumulator[k] * 0.9f + transition_prob * 0.1f);
    }

    // Normaliza para que a soma das probabilidades seja 100%
    float sum_new = 0.0f; for (float p : next_probs) sum_new += p;
    if (sum_new > 0) { for (int i = 0; i < 24; i++) next_probs[i] /= sum_new; } 
    else { for (int i = 0; i < 24; i++) next_probs[i] = 1.0f / 24.0f; }
    
    key_accumulator = next_probs;

    // Vencedor é quem tem a maior probabilidade acumulada
    float best_score = -1.0f; int winner_idx = 0;
    for (int k = 0; k < 24; k++) { if (key_accumulator[k] > best_score) { best_score = key_accumulator[k]; winner_idx = k; } }
    
    out_key = winner_idx % 12; out_mode = (winner_idx >= 12) ? 1 : 0;
}

// ==================================================
// PROCESSAMENTO PRINCIPAL (MAIN LOOP)
// ==================================================
AnalysisResult DSPEngine::process(uintptr_t input_buffer_ptr) {
    float* audio_buffer = reinterpret_cast<float*>(input_buffer_ptr);
    AnalysisResult res;
    
    // 1. Pré-processamento e Métricas
    remove_dc_offset(audio_buffer, buffer_size);
    res.rms_amplitude = compute_rms(audio_buffer, buffer_size);
    float zcr = compute_zcr(audio_buffer, buffer_size);

    // 2. Noise Gate com Histerese (Schmitt Trigger)
    // Evita que o microfone fique "piscando" (chattering) no limite do silêncio.
    static bool is_gate_open = false;
    const float GATE_OPEN = 0.003f;  // Precisa falar alto para abrir
    const float GATE_CLOSE = 0.001f; // Precisa ficar bem quieto para fechar
    const float ZCR_MAX = 0.20f;     // Se tiver muito chiado, é ruído, não voz.

    if (res.rms_amplitude > GATE_OPEN && zcr < ZCR_MAX) {
        is_gate_open = true;
    } else if (res.rms_amplitude < GATE_CLOSE || zcr > 0.30f) {
        is_gate_open = false;
    }

    float detected_freq = 0.0f;
    float detected_clarity = 0.0f;

    if (is_gate_open) {
        // 3. Chama o "Ouvido" (YIN) para achar a frequência
        PitchAlgo::PitchResult result = PitchAlgo::find_fundamental(audio_buffer, buffer_size, sample_rate);
        detected_freq = result.frequency;
        detected_clarity = result.clarity;
    }

    // Filtra sons pouco claros (ex: sussurros ou batidas)
    if (detected_clarity < 0.60f) {
        detected_freq = 0.0f;
    }

    // 4. Debounce Dinâmico
    // Impede pulos bruscos de oitava (ex: voz falhando) exigindo confirmação
    // de frames consecutivos se a mudança for muito grande.
    float clean_frequency = 0.0f;
    float diff_semitones = 0.0f;
    
    if (last_valid_freq > 0 && detected_freq > 0) {
        diff_semitones = std::abs(12.0f * std::log2(detected_freq / last_valid_freq));
    }

    int required_frames = (diff_semitones > 2.0f) ? 2 : 1; // Se pulou > 2 semitons, exige confirmação

    if (std::abs(detected_freq - pending_freq) < (pending_freq * 0.05f) && detected_freq > 50.0f) {
        pending_duration++;
    } else {
        pending_freq = detected_freq;
        pending_duration = 0;
    }

    if (pending_duration >= required_frames) {
        clean_frequency = pending_freq;
    }

    // 5. Hold Inteligente (Sustentação)
    // Se a voz falhar por uma fração de segundo, mantém a nota anterior
    // para não causar "buracos" no gráfico visual.
    const int MAX_HOLD_FRAMES = 8; 
    float processing_freq = 0.0f;

    if (clean_frequency > 50.0f) {
        last_valid_freq = clean_frequency;
        frames_since_valid = 0;
        processing_freq = clean_frequency;
    } else {
        if (frames_since_valid < MAX_HOLD_FRAMES && last_valid_freq > 50.0f && zcr < 0.25f) {
            processing_freq = last_valid_freq;
            frames_since_valid++;
        } else {
            processing_freq = 0.0f;
        }
    }

    // 6. Suavização Final (Filtro IIR + Mediana)
    // Deixa o movimento da agulha/gráfico orgânico e fluido.
    float median_freq = apply_median_filter(processing_freq);
    const float alpha = 0.50f; // 50% novo valor, 50% valor antigo

    if (median_freq > 0.0f) {
        if (smoothed_frequency <= 0.0f) {
            smoothed_frequency = median_freq; 
        } else {
            smoothed_frequency = (smoothed_frequency * (1.0f - alpha)) + (median_freq * alpha);
        }
    } else {
        smoothed_frequency = 0.0f;
    }

    // 7. Montagem do Resultado Final para enviar ao Javascript
    res.frequency = (smoothed_frequency > 55.0f) ? smoothed_frequency : 0;
    
    if (res.frequency > 0) {
        res.midi_note = PitchAlgo::hz_to_midi(res.frequency);
        res.pitch_error = (res.midi_note - std::round(res.midi_note)) * 100.0f; // Erro em Cents
        
        // Cálculo de Estabilidade (Desvio Padrão das últimas 15 notas)
        stability_buffer[stability_idx] = res.midi_note;
        stability_idx = (stability_idx + 1) % stability_buffer.size();
        float sum = 0.0f; for (float v : stability_buffer) sum += v;
        float mean = sum / stability_buffer.size();
        float sq_sum = 0.0f; for (float v : stability_buffer) sq_sum += (v - mean) * (v - mean);
        res.stability = 1.0f - std::min(std::sqrt(sq_sum / stability_buffer.size()) / 0.5f, 1.0f);
    } else {
        res.midi_note = 0; res.pitch_error = 0; res.stability = 0;
    }
    
    res.chroma.resize(12, 0.0f); 
    
    // Atualiza a detecção de tom
    update_key_detector(res.midi_note, res.detected_key, res.detected_mode);

    return res;
}

// Binds do Emscripten (Conexão C++ -> Javascript)
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
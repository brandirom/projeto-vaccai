#include "dsp_engine.hpp"
#include "pitch_detection.hpp"
#include <cmath>
#include <vector>
#include <numeric>
#include <algorithm> // Para std::sort
#include <emscripten/bind.h>

using namespace emscripten;

DSPEngine::DSPEngine(int sr, int bs) : sample_rate(sr), buffer_size(bs) {
    // Inicializa o buffer da mediana com 5 zeros
    median_buffer.resize(5, 0.0f);
    median_idx = 0;
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

// Lógica do Filtro de Mediana
float DSPEngine::apply_median_filter(float new_freq) {
    // 1. Adiciona novo valor no buffer circular
    median_buffer[median_idx] = new_freq;
    median_idx = (median_idx + 1) % median_buffer.size();

    // 2. Cria uma cópia para ordenar (não podemos ordenar o buffer original senão perdemos a ordem temporal)
    std::vector<float> sorted = median_buffer;
    std::sort(sorted.begin(), sorted.end());

    // 3. Retorna o valor do meio
    // Se tiver spikes (0 ou 1000), eles vão para as pontas e são ignorados
    return sorted[2]; // Índice 2 é o meio de 5 (0,1,2,3,4)
}

AnalysisResult DSPEngine::process(uintptr_t input_buffer_ptr) {
    float* audio_buffer = reinterpret_cast<float*>(input_buffer_ptr);
    AnalysisResult res;
    
    // Inicializa chroma
    res.chroma.resize(12, 0.0f);

    // 1. Pré-processamento
    remove_dc_offset(audio_buffer, buffer_size);
    res.rms_amplitude = compute_rms(audio_buffer, buffer_size);

    // Threshold de silêncio
    const float NOISE_THRESHOLD = 0.005f;

    float raw_frequency = 0.0f;

    if (res.rms_amplitude > NOISE_THRESHOLD) {
        raw_frequency = PitchAlgo::find_fundamental(audio_buffer, buffer_size, sample_rate);
    }

    // 2. APLICA O FILTRO DE MEDIANA (A Mágica acontece aqui)
    // Passamos o raw_frequency (que pode ser 0 ou um spike) pelo filtro
    float filtered_frequency = apply_median_filter(raw_frequency);

    // Só consideramos válido se o filtro mediano disser que é válido
    // Isso evita que um único frame de barulho "acenda" o gráfico
    if (filtered_frequency > 55.0f && filtered_frequency < 1400.0f) {
        res.frequency = filtered_frequency;
        res.midi_note = PitchAlgo::hz_to_midi(res.frequency);
        
        float note_nearest = std::round(res.midi_note);
        res.pitch_error = (res.midi_note - note_nearest) * 100.0f;
    } else {
        res.frequency = 0;
        res.midi_note = 0;
        res.pitch_error = 0;
    }

    res.stability = 0.0f; // Stub

    return res;
}

// Bindings (Mantém igual)
EMSCRIPTEN_BINDINGS(vox_engine) {
    register_vector<float>("FloatVector");
    value_object<AnalysisResult>("AnalysisResult")
        .field("frequency", &AnalysisResult::frequency)
        .field("midi_note", &AnalysisResult::midi_note)
        .field("pitch_error", &AnalysisResult::pitch_error)
        .field("stability", &AnalysisResult::stability)
        .field("rms_amplitude", &AnalysisResult::rms_amplitude)
        .field("chroma", &AnalysisResult::chroma);

    class_<DSPEngine>("DSPEngine")
        .constructor<int, int>()
        .function("process", &DSPEngine::process, allow_raw_pointers());
}
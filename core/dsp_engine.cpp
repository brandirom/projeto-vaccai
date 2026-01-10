#include "dsp_engine.hpp"
#include "pitch_detection.hpp"
#include <cmath>
#include <vector>
#include <emscripten/bind.h>

using namespace emscripten;

DSPEngine::DSPEngine(int sr, int bs) : sample_rate(sr), buffer_size(bs) {
    // Inicializa vetor chroma
}

DSPEngine::~DSPEngine() {}

// Função auxiliar para calcular volume (RMS)
float compute_rms(const float* buffer, int size) {
    float sum = 0.0f;
    for (int i = 0; i < size; i++) {
        sum += buffer[i] * buffer[i];
    }
    return std::sqrt(sum / size);
}

AnalysisResult DSPEngine::process(uintptr_t input_buffer_ptr) {
    const float* audio_buffer = reinterpret_cast<const float*>(input_buffer_ptr);
    AnalysisResult res;
    
    // 1. CALCULAR VOLUME (RMS)
    res.rms_amplitude = compute_rms(audio_buffer, buffer_size);

    // 2. NOISE GATE (O FILTRO MÁGICO)
    // Se o volume for menor que 0.02 (2%), consideramos silêncio/ruído.
    // Isso evita que o gráfico fique pulando com o ar condicionado.
    const float NOISE_THRESHOLD = 0.02f;

    if (res.rms_amplitude > NOISE_THRESHOLD) {
        
        // Só calcula Pitch se tiver som alto o suficiente
        res.frequency = PitchAlgo::find_fundamental(audio_buffer, buffer_size, sample_rate);
        
        // Filtro extra: Se a frequência for absurda (ex: > 1200Hz ou < 60Hz), ignora
        if (res.frequency > 60.0f && res.frequency < 1200.0f) {
            res.midi_note = PitchAlgo::hz_to_midi(res.frequency);
            float note_nearest = std::round(res.midi_note);
            res.pitch_error = (res.midi_note - note_nearest) * 100.0f;
        } else {
            // Frequência inválida
            res.frequency = 0;
            res.midi_note = 0;
            res.pitch_error = 0;
        }

    } else {
        // Silêncio
        res.frequency = 0;
        res.midi_note = 0;
        res.pitch_error = 0;
    }

    res.chroma.resize(12, 0.0f); // Stub
    res.stability = 0.9f; // Stub

    return res;
}

// BINDINGS (Mantém igual)
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
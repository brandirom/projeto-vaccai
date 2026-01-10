#include "dsp_engine.hpp"
#include "pitch_detection.hpp"
#include <cmath>
#include <vector>
#include <emscripten/bind.h>

using namespace emscripten;

DSPEngine::DSPEngine(int sr, int bs) : sample_rate(sr), buffer_size(bs) {
    // Inicializa o vetor chroma com 12 zeros
    // Isso evita lixo de memória
}

DSPEngine::~DSPEngine() {}

AnalysisResult DSPEngine::process(uintptr_t input_buffer_ptr) {
    // Converte o endereço de memória (int) de volta para ponteiro float
    // reinterpret_cast é a forma C++ de dizer "eu sei que esse int é um ponteiro"
    const float* audio_buffer = reinterpret_cast<const float*>(input_buffer_ptr);

    AnalysisResult res;
    
    // Inicializa vetor chroma
    res.chroma.resize(12, 0.0f);

    // 1. Detectar Frequência
    res.frequency = PitchAlgo::find_fundamental(audio_buffer, buffer_size, sample_rate);
    
    // 2. Converter para Nota MIDI
    res.midi_note = PitchAlgo::hz_to_midi(res.frequency);
    
    // 3. Calcular Erro (Cents)
    if (res.frequency > 0) {
        float note_nearest = std::round(res.midi_note);
        res.pitch_error = (res.midi_note - note_nearest) * 100.0f;
    } else {
        res.pitch_error = 0.0f;
        res.midi_note = 0.0f;
    }

    // Stub para amplitude (implementaremos RMS real depois)
    res.rms_amplitude = 0.5f; 
    res.stability = 0.9f;

    return res;
}

// ==========================================
// EXPORTAÇÃO PARA JAVASCRIPT (WebAssembly)
// ==========================================

EMSCRIPTEN_BINDINGS(vox_engine) {
    // 1. Precisamos ensinar ao JS o que é um vector<float>
    register_vector<float>("FloatVector");

    // 2. Ensinar o que é o AnalysisResult
    value_object<AnalysisResult>("AnalysisResult")
        .field("frequency", &AnalysisResult::frequency)
        .field("midi_note", &AnalysisResult::midi_note)
        .field("pitch_error", &AnalysisResult::pitch_error)
        .field("stability", &AnalysisResult::stability)
        .field("rms_amplitude", &AnalysisResult::rms_amplitude)
        .field("chroma", &AnalysisResult::chroma);

    // 3. Exportar a classe principal
    class_<DSPEngine>("DSPEngine")
        .constructor<int, int>()
        .function("process", &DSPEngine::process, allow_raw_pointers());
}
#include "dsp_engine.hpp"
#include "pitch_detection.hpp"
#include <cmath>
#include <vector>
#include <numeric> // Para std::accumulate
#include <emscripten/bind.h>

using namespace emscripten;

DSPEngine::DSPEngine(int sr, int bs) : sample_rate(sr), buffer_size(bs) {
    // Construtor
}

DSPEngine::~DSPEngine() {}

// Função para centralizar a onda (Remove DC Offset)
void remove_dc_offset(float* buffer, int size) {
    float sum = 0.0f;
    for (int i = 0; i < size; i++) sum += buffer[i];
    float mean = sum / size;
    
    for (int i = 0; i < size; i++) buffer[i] -= mean;
}

// Função auxiliar para calcular volume (RMS)
float compute_rms(const float* buffer, int size) {
    float sum = 0.0f;
    for (int i = 0; i < size; i++) {
        sum += buffer[i] * buffer[i];
    }
    return std::sqrt(sum / size);
}

AnalysisResult DSPEngine::process(uintptr_t input_buffer_ptr) {
    // Precisamos de acesso de escrita e leitura, então não usamos const aqui
    float* audio_buffer = reinterpret_cast<float*>(input_buffer_ptr);
    
    AnalysisResult res;

    // 1. LIMPEZA DE SINAL (CRUCIAL PARA NOTAS LONGAS)
    // Se a onda estiver "torta" (descentralizada), a autocorrelação falha.
    remove_dc_offset(audio_buffer, buffer_size);

    // 2. CALCULAR VOLUME (RMS)
    res.rms_amplitude = compute_rms(audio_buffer, buffer_size);

    // 3. NOISE GATE AJUSTADO
    // Baixamos de 0.02 para 0.005 (muito mais sensível, mas ignora silêncio absoluto)
    const float NOISE_THRESHOLD = 0.005f;

    if (res.rms_amplitude > NOISE_THRESHOLD) {
        
        // Calcula Pitch
        res.frequency = PitchAlgo::find_fundamental(audio_buffer, buffer_size, sample_rate);
        
        // Filtro de Frequência Humana (50Hz a 1200Hz)
        if (res.frequency > 50.0f && res.frequency < 1400.0f) {
            res.midi_note = PitchAlgo::hz_to_midi(res.frequency);
            float note_nearest = std::round(res.midi_note);
            res.pitch_error = (res.midi_note - note_nearest) * 100.0f;
        } else {
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

    res.chroma.resize(12, 0.0f); 
    res.stability = 0.0f; 

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
        .field("chroma", &AnalysisResult::chroma);

    class_<DSPEngine>("DSPEngine")
        .constructor<int, int>()
        .function("process", &DSPEngine::process, allow_raw_pointers());
}
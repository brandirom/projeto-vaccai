// Variáveis Globais
let audioContext = null;
let dspEngine = null;
let wasmModule = null;
let inputBufferPtr = null; // Ponteiro para a memória do C++
const BUFFER_SIZE = 2048;

// Elementos da UI
const elStatus = document.getElementById('status');
const elFreq = document.getElementById('freq');
const elMidi = document.getElementById('midi');
const elError = document.getElementById('error');
const btnStart = document.getElementById('startBtn');

// 1. Inicializar o Módulo Wasm
VoxEngine().then(module => {
    wasmModule = module;
    elStatus.innerText = "Wasm Carregado! Pronto para iniciar.";
    btnStart.disabled = false;
    console.log("Módulo Wasm carregado com sucesso.");
});

// 2. Função para iniciar o áudio
btnStart.addEventListener('click', async () => {
    try {
        elStatus.innerText = "Solicitando microfone...";
        
        // Inicializa AudioContext
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        
        // Captura Microfone
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const source = audioContext.createMediaStreamSource(stream);

        // Instancia a classe C++
        dspEngine = new wasmModule.DSPEngine(audioContext.sampleRate, BUFFER_SIZE);
        
        // ALOCAÇÃO DE MEMÓRIA:
        // Precisamos criar um espaço na memória do C++ para receber o áudio do JS.
        // float tem 4 bytes.
        const byteSize = BUFFER_SIZE * 4; 
        inputBufferPtr = wasmModule._malloc(byteSize);

        elStatus.innerText = "Processando Áudio em Tempo Real...";
        setupAudioProcessing(source);

    } catch (err) {
        console.error(err);
        elStatus.innerText = "Erro: " + err.message;
    }
});

function setupAudioProcessing(source) {
    // Para teste rápido, usamos ScriptProcessor (depois mudaremos para AudioWorklet para performance máxima)
    const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
    
    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
        if (!dspEngine || !inputBufferPtr) return;

        // 1. Pegar os dados brutos do microfone (Float32Array)
        const inputData = e.inputBuffer.getChannelData(0);

        // 2. Copiar dados do JS para a memória do Wasm (HEAPF32)
        // inputBufferPtr >> 2 divide por 4 bytes para achar o índice no array de floats
        wasmModule.HEAPF32.set(inputData, inputBufferPtr >> 2);

        // 3. Chamar a função C++ Process
        // Passamos o PONTEIRO (endereço de memória), não o array
        const result = dspEngine.process(inputBufferPtr);

        // 4. Atualizar UI
        updateUI(result);
    };
}

function updateUI(result) {
    // result é o objeto AnalysisResult definido no C++
    if (result.frequency > 0) {
        elFreq.innerText = result.frequency.toFixed(2);
        elMidi.innerText = result.midi_note.toFixed(2);
        elError.innerText = result.pitch_error.toFixed(1);
        
        // Feedback visual simples de cor
        if (Math.abs(result.pitch_error) < 15) elError.style.color = "#0f0"; // Verde
        else elError.style.color = "#f00"; // Vermelho
    }
}
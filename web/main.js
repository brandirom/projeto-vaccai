// ==========================================
// VARIÁVEIS GLOBAIS
// ==========================================
let audioContext = null;
let dspEngine = null;
let wasmModule = null;
let inputBufferPtr = null;

// Variáveis de fluxo de áudio (precisam ser globais para o Stop funcionar)
let mediaStream = null;
let source = null;
let processor = null;

const BUFFER_SIZE = 2048;

// Elementos da UI
const elStatus = document.getElementById('status');
const elFreq = document.getElementById('freq');
const elMidi = document.getElementById('midi');
const elError = document.getElementById('error');
const btnStart = document.getElementById('startBtn');
const btnStop = document.getElementById('stopBtn');

// ==========================================
// 1. INICIALIZAÇÃO DO WASM
// ==========================================
VoxEngine().then(module => {
    wasmModule = module;
    elStatus.innerText = "Sistema pronto.";
    btnStart.disabled = false;
    console.log("Módulo Wasm carregado.");
});

// ==========================================
// 2. CONTROLE DE ÁUDIO (START)
// ==========================================
btnStart.addEventListener('click', async () => {
    try {
        // Previne múltiplos cliques
        btnStart.disabled = true;
        elStatus.innerText = "Iniciando...";

        // Cria ou resume o AudioContext (necessário por políticas de navegador)
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        } else if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        // Instancia a Engine C++ (se ainda não existir)
        if (!dspEngine) {
            dspEngine = new wasmModule.DSPEngine(audioContext.sampleRate, BUFFER_SIZE);
            const byteSize = BUFFER_SIZE * 4; // float = 4 bytes
            inputBufferPtr = wasmModule._malloc(byteSize);
        }

        // Captura o Microfone
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        source = audioContext.createMediaStreamSource(mediaStream);

        // Cria o Processador (ScriptProcessor por enquanto)
        processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

        // Conecta: Mic -> Processador -> Destino (Caixa de som - cuidado com feedback!)
        // Nota: Conectar ao destination é necessário para o script rodar, 
        // mas se der eco, desconectaremos o output depois.
        source.connect(processor);
        processor.connect(audioContext.destination);

        // Define o loop de processamento
        processor.onaudioprocess = processAudioBlock;

        // Atualiza UI
        elStatus.innerText = "Capturando...";
        btnStop.disabled = false;
        elStatus.style.color = "#0f0";

    } catch (err) {
        console.error(err);
        elStatus.innerText = "Erro: " + err.message;
        btnStart.disabled = false;
    }
});

// ==========================================
// 3. CONTROLE DE ÁUDIO (STOP)
// ==========================================
btnStop.addEventListener('click', async () => {
    // 1. Primeiro: Para o processamento de áudio para evitar erros de 'undefined'
    if (processor) {
        processor.onaudioprocess = null; // Anula a função antes de desconectar
        processor.disconnect();
        processor = null;
    }

    // 2. Segundo: Desconecta a fonte do microfone
    if (source) {
        source.disconnect();
        source = null;
    }

    // 3. Terceiro: Desliga a luz do microfone no navegador
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    // 4. Quarto: Coloca o AudioContext para dormir (ECONOMIA DE CPU)
    if (audioContext && audioContext.state !== 'closed') {
        await audioContext.suspend(); 
    }

    // 5. Reseta a UI
    resetUI();
});

function resetUI() {
    btnStart.disabled = false;
    btnStop.disabled = true;
    elStatus.innerText = "Monitoramento encerrado.";
    elStatus.style.color = "yellow";
    elFreq.innerText = "0.0";
    elMidi.innerText = "0.0";
    elError.innerText = "0.0";
    elError.style.color = "";
}

// ==========================================
// 4. LOOP DE PROCESSAMENTO
// ==========================================
function processAudioBlock(e) {
    // Se o stop foi clicado, processor será null e saímos imediatamente
    if (!processor || !dspEngine || !inputBufferPtr || !wasmModule.HEAPF32) return;

    const inputData = e.inputBuffer.getChannelData(0);
    wasmModule.HEAPF32.set(inputData, inputBufferPtr >> 2);

    const result = dspEngine.process(inputBufferPtr);
    updateUI(result);
}

function updateUI(result) {
    if (result.frequency > 0) {
        elFreq.innerText = result.frequency.toFixed(1);
        elMidi.innerText = result.midi_note.toFixed(1);
        elError.innerText = result.pitch_error.toFixed(0);
        
        // Feedback Visual Simples
        if (Math.abs(result.pitch_error) < 15) {
            elError.style.color = "#0f0"; // Verde = Afinado
        } else if (Math.abs(result.pitch_error) < 40) {
            elError.style.color = "#ff0"; // Amarelo = Quase
        } else {
            elError.style.color = "#f00"; // Vermelho = Desafinado
        }
    }
}
// ==========================================
// VARIÁVEIS GLOBAIS
// ==========================================
let audioContext = null;
let dspEngine = null;
let wasmModule = null;
let inputBufferPtr = null;

let mediaStream = null;
let source = null;
let processor = null;

const BUFFER_SIZE = 2048;

// UI Elements
const elStatus = document.getElementById('status');
const elNoteName = document.getElementById('noteName'); // Novo
const elFreq = document.getElementById('freq');
const elError = document.getElementById('error');
const btnStart = document.getElementById('startBtn');
const btnStop = document.getElementById('stopBtn');

// Nomes das notas para conversão
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// ==========================================
// HELPER: MIDI -> TEXTO (Ex: 69 -> A4)
// ==========================================
function getNoteString(midiValue) {
    if (midiValue <= 0) return "--";
    const noteIndex = Math.round(midiValue) % 12;
    const octave = Math.floor(Math.round(midiValue) / 12) - 1;
    return NOTE_NAMES[noteIndex] + octave;
}

// Verifica se uma nota é sustenido (Tecla Preta)
function isBlackKey(midiValue) {
    const i = midiValue % 12;
    return (i === 1 || i === 3 || i === 6 || i === 8 || i === 10);
}

// ==========================================
// RENDERIZAÇÃO DO PIANO ROLL
// ==========================================
class GraphRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        
        // Sincroniza resolução
        this.width = this.canvas.offsetWidth;
        this.height = this.canvas.offsetHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        // RANGE AMPLO (C1 até C8 - Cobre quase todo o espectro musical)
        this.minMidi = 24; // C1 (~32Hz)
        this.maxMidi = 108; // C8 (~4186Hz)
        
        this.historySize = 600; 
        this.history = new Array(this.historySize).fill(null);
        
        this.draw(); 
    }

    pushData(midiNote) {
        if (midiNote > 0) {
            // AUTO-RANGE: Se a nota sair do limite, expandimos o limite dinamicamente
            if (midiNote < this.minMidi) this.minMidi = Math.floor(midiNote) - 2;
            if (midiNote > this.maxMidi) this.maxMidi = Math.ceil(midiNote) + 2;
            this.history.push(midiNote);
        } else {
            this.history.push(null);
        }

        if (this.history.length > this.historySize) this.history.shift();
    }

    mapMidiToY(note) {
        // Cálculo da altura do semitom baseada no range atual
        const range = this.maxMidi - this.minMidi;
        const normalized = (note - this.minMidi) / range;
        return this.height - (normalized * this.height);
    }

    draw() {
        if (!this.canvas) return;
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        const range = this.maxMidi - this.minMidi;
        const semitoneHeight = this.height / range;

        // 1. DESENHAR O GRID (PIANO ROLL)
        for (let i = this.minMidi; i <= this.maxMidi; i++) {
            const y = this.mapMidiToY(i);
            const isBlack = isBlackKey(i);
            
            // Faixas horizontais
            this.ctx.fillStyle = isBlack ? "#181818" : "#222";
            this.ctx.fillRect(0, y - semitoneHeight, this.width, semitoneHeight);

            // Linha de oitava (Dó) mais forte
            if (i % 12 === 0) {
                this.ctx.strokeStyle = "#444";
                this.ctx.lineWidth = 1.5;
                this.ctx.beginPath();
                this.ctx.moveTo(0, y);
                this.ctx.lineTo(this.width, y);
                this.ctx.stroke();

                this.ctx.fillStyle = "#aaa";
                this.ctx.font = "bold 11px Arial";
                this.ctx.fillText(getNoteString(i), 5, y - 5);
            }
        }

        // 2. LINHA DA VOZ (Logarítmica por natureza via MIDI)
        this.ctx.lineWidth = 2.5;
        this.ctx.strokeStyle = "#00ffcc";
        this.ctx.shadowBlur = 4;
        this.ctx.shadowColor = "#00ffcc";
        this.ctx.beginPath();

        const stepX = this.width / this.historySize;
        let started = false;

        for (let i = 0; i < this.history.length; i++) {
            const note = this.history[i];
            const x = i * stepX;

            if (note === null) {
                this.ctx.stroke();
                this.ctx.beginPath();
                started = false;
                continue;
            }

            const y = this.mapMidiToY(note);
            if (!started) {
                this.ctx.moveTo(x, y);
                started = true;
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;

        requestAnimationFrame(() => this.draw());
    }
}
let graph = null;

// ==========================================
// INICIALIZAÇÃO
// ==========================================
VoxEngine().then(module => {
    wasmModule = module;
    elStatus.innerText = "Sistema pronto.";
    btnStart.disabled = false;
    graph = new GraphRenderer('pitchGraph');
});

// START
btnStart.addEventListener('click', async () => {
    try {
        btnStart.disabled = true;
        if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        else if (audioContext.state === 'suspended') await audioContext.resume();

        if (!dspEngine) {
            dspEngine = new wasmModule.DSPEngine(audioContext.sampleRate, BUFFER_SIZE);
            inputBufferPtr = wasmModule._malloc(BUFFER_SIZE * 4);
        }
        const constraints = {
            audio: {
                echoCancellation: true,
                autoGainControl: false,
                noiseSuppression: false,
                latency: 0
            }
        };

        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        source = audioContext.createMediaStreamSource(mediaStream);
        processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

        source.connect(processor);
        processor.connect(audioContext.destination);
        processor.onaudioprocess = processAudioBlock;

        elStatus.innerText = "Ouvindo...";
        elStatus.style.color = "#0f0";
        btnStop.disabled = false;
    } catch (err) {
        console.error(err);
        elStatus.innerText = "Erro: " + err.message;
        btnStart.disabled = false;
    }
});

// STOP
// STOP - Ajustado para desligamento total
btnStop.addEventListener('click', async () => {
    // 1. Mata o callback de áudio IMEDIATAMENTE
    if (processor) {
        processor.onaudioprocess = null; 
        processor.disconnect();
        processor = null;
    }

    // 2. Desconecta a fonte
    if (source) {
        source.disconnect();
        source = null;
    }

    // 3. Desliga a luz do microfone (Tracks)
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }

    // 4. Suspende o AudioContext para economizar CPU e zerar o clock
    if (audioContext && audioContext.state !== 'closed') {
        await audioContext.suspend();
    }

    if (graph) {
        graph.minMidi = 24;
        graph.maxMidi = 108;
        graph.history.fill(null);
    }

    // 5. Reseta a interface
    btnStart.disabled = false;
    btnStop.disabled = true;
    elStatus.innerText = "Monitoramento parado.";
    elStatus.style.color = "yellow";
    
    // Limpa os displays
    elNoteName.innerText = "--";
    elFreq.innerText = "0.0";
    elError.innerText = "0.0";
});

// LOOP
function processAudioBlock(e) {
    // Se o processor foi anulado pelo Stop, saímos na hora
    if (!processor || !dspEngine || !inputBufferPtr) return;

    const inputData = e.inputBuffer.getChannelData(0);

    // Proteção adicional para o acesso à memória Wasm
    if (wasmModule && wasmModule.HEAPF32) {
        wasmModule.HEAPF32.set(inputData, inputBufferPtr >> 2);
        
        const result = dspEngine.process(inputBufferPtr);
        updateUI(result);
    }
}

function updateUI(result) {
    if (result.frequency > 0) {
        // Atualiza Note Name (Ex: A#4)
        elNoteName.innerText = getNoteString(result.midi_note);
        
        elFreq.innerText = result.frequency.toFixed(1);
        elError.innerText = result.pitch_error.toFixed(0);
        
        // Cor do texto de erro
        if (Math.abs(result.pitch_error) < 15) elError.style.color = "#0f0";
        else if (Math.abs(result.pitch_error) < 40) elError.style.color = "#ff0";
        else elError.style.color = "#f00";

        // Manda pro gráfico
        if (graph) graph.pushData(result.midi_note);
    } else {
        if (graph) graph.pushData(0); // Silêncio
        elNoteName.innerText = "--";
    }
}
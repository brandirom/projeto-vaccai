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

const elScaleDisplay = document.createElement('div');
elScaleDisplay.style = "position: absolute; top: 10px; right: 20px; color: cyan; font-size: 1.5em; font-weight: bold;";
elScaleDisplay.innerText = "Detectando Tom...";
document.body.appendChild(elScaleDisplay);


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
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        
        this.minMidi = 40; 
        this.maxMidi = 76; 
        this.semitoneHeight = this.height / (this.maxMidi - this.minMidi);

        this.historySize = 300; 
        this.history = new Array(this.historySize).fill(null);
        
        // Estado da Escala
        this.detectedKey = -1; // 0-11
        this.detectedMode = 0; // 0=Major, 1=Minor
        
        this.draw(); 
    }
    
    // Atualiza o estado da escala vindo do C++
    setKey(key, mode) {
        this.detectedKey = key;
        this.detectedMode = mode;
        
        // Atualiza texto na tela
        if (key >= 0) {
            const rootName = NOTE_NAMES[key];
            const modeName = mode === 0 ? "Maior" : "Menor";
            elScaleDisplay.innerText = `Tom Provável: ${rootName} ${modeName}`;
        } else {
            elScaleDisplay.innerText = "Analisando...";
        }
    }

    pushData(midiNote) {
        // ... (Lógica de suavização igual) ...
        // Simplifiquei aqui para caber na resposta, use o código anterior de suavização
        this.history.push(midiNote > 0 ? midiNote : null);
        if (this.history.length > this.historySize) this.history.shift();
    }

    mapMidiToY(note) {
        return this.height - ((note - this.minMidi) * this.semitoneHeight);
    }
    
    // Verifica se uma nota pertence à escala detectada
    isInScale(midiNote) {
        if (this.detectedKey < 0) return true; // Se não sabe, tudo é válido
        
        const noteIndex = midiNote % 12;
        const interval = (noteIndex - this.detectedKey + 12) % 12;
        
        const majorScale = [1,0,1,0,1,1,0,1,0,1,0,1];
        const minorScale = [1,0,1,1,0,1,0,1,1,0,1,0];
        
        const scaleProfile = this.detectedMode === 0 ? majorScale : minorScale;
        return scaleProfile[interval] === 1;
    }

    draw() {
        if (!this.canvas) return;
        this.ctx.clearRect(0, 0, this.width, this.height);

        // 1. DESENHAR O FUNDO INTELIGENTE
        for (let i = this.minMidi; i <= this.maxMidi; i++) {
            const y = this.mapMidiToY(i);
            
            // Verifica se essa linha é "segura" (dentro da escala)
            const isSafe = this.isInScale(i);
            const isBlack = (i % 12 === 1 || i % 12 === 3 || i % 12 === 6 || i % 12 === 8 || i % 12 === 10);
            
            // Lógica de Cores:
            // - Dentro da Escala: Cinza mais claro
            // - Fora da Escala: Cinza muito escuro (quase preto)
            // - Nota atual cantada: Highlight (opcional)

            if (isSafe) {
                this.ctx.fillStyle = isBlack ? "#252525" : "#353535"; 
            } else {
                this.ctx.fillStyle = "#111"; // Zona perigosa (fora do tom)
            }
            
            this.ctx.fillRect(0, y - this.semitoneHeight, this.width, this.semitoneHeight);
            
            // Linha divisória
            this.ctx.fillStyle = "#000";
            this.ctx.fillRect(0, y, this.width, 1);

            // Nome das notas (Destaque para a tônica)
            if (i % 12 === this.detectedKey) {
                this.ctx.fillStyle = "#0ff"; // Ciano para a Tônica
                this.ctx.font = "bold 10px monospace";
                this.ctx.fillText(getNoteString(i), 5, y - 2);
            } else if (i % 12 === 0) {
                this.ctx.fillStyle = "#444";
                this.ctx.font = "10px monospace";
                this.ctx.fillText(getNoteString(i), 5, y - 2);
            }
        }

        // 2. DESENHAR A LINHA DA VOZ
        this.ctx.lineWidth = 4;
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        const stepX = this.width / this.historySize;
        
        // Vamos desenhar segmento por segmento para mudar a cor dinamicamente
        for (let i = 1; i < this.history.length; i++) {
            const note = this.history[i];
            const prevNote = this.history[i-1];

            if (note === null || prevNote === null) continue;

            const x1 = (i - 1) * stepX;
            const y1 = this.mapMidiToY(prevNote);
            const x2 = i * stepX;
            const y2 = this.mapMidiToY(note);

            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            
            // COR DA LINHA:
            // Se estiver na escala: Verde/Azul
            // Se estiver fora: Laranja/Vermelho
            if (this.isInScale(Math.round(note))) {
                this.ctx.strokeStyle = "#00ffcc"; // Safe
                this.ctx.shadowColor = "#00ffcc";
            } else {
                this.ctx.strokeStyle = "#ff4400"; // Danger!
                this.ctx.shadowColor = "#ff4400";
            }
            
            this.ctx.shadowBlur = 5;
            this.ctx.stroke();
        }
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
        if (graph) {
        graph.setKey(result.detected_key, result.detected_mode);
        
        if (result.frequency > 0) {
             graph.pushData(result.midi_note);
        } else {
             graph.pushData(0);
        }
    }
}
}
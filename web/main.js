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
const elNoteName = document.getElementById('noteName');
const elFreq = document.getElementById('freq');
const elMidi = document.getElementById('midi'); // Referência ao span MIDI
const elError = document.getElementById('error');
const elAudioSource = document.getElementById('audioSource');
const btnStart = document.getElementById('startBtn');
const btnStop = document.getElementById('stopBtn');

<<<<<<< HEAD
const elScaleDisplay = document.createElement('div');
elScaleDisplay.style = "position: absolute; top: 10px; right: 20px; color: cyan; font-size: 1.5em; font-weight: bold;";
elScaleDisplay.innerText = "Detectando Tom...";
document.body.appendChild(elScaleDisplay);


// Nomes das notas para conversão
=======
>>>>>>> 288c467c4be036d1501a0fe0115a1ea851d3593f
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// ==========================================
// 1. GESTÃO DE DISPOSITIVOS
// ==========================================

async function getConnectedDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        
        const currentValue = elAudioSource.value;
        elAudioSource.innerHTML = '';
        
        audioInputs.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Microfone ${index + 1}`;
            elAudioSource.appendChild(option);
        });

        if (currentValue && [...elAudioSource.options].some(opt => opt.value === currentValue)) {
            elAudioSource.value = currentValue;
        }
    } catch (err) {
        console.error("Erro ao listar dispositivos:", err);
    }
}

// Inicializa lista e monitora mudanças (ex: fone plugado)
getConnectedDevices();
navigator.mediaDevices.ondevicechange = getConnectedDevices;

// ==========================================
// 2. HELPERS
// ==========================================

function getNoteString(midiValue) {
    if (midiValue <= 0) return "--";
    const noteIndex = Math.round(midiValue) % 12;
    const octave = Math.floor(Math.round(midiValue) / 12) - 1;
    return NOTE_NAMES[noteIndex] + octave;
}

function isBlackKey(midiValue) {
    const i = Math.round(midiValue) % 12;
    return (i === 1 || i === 3 || i === 6 || i === 8 || i === 10);
}

// ==========================================
// 3. RENDERIZAÇÃO GRÁFICA
// ==========================================

class GraphRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        
<<<<<<< HEAD
        this.minMidi = 40; 
        this.maxMidi = 76; 
        this.semitoneHeight = this.height / (this.maxMidi - this.minMidi);

        this.historySize = 300; 
=======
        this.width = this.canvas.offsetWidth;
        this.height = this.canvas.offsetHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.minMidi = 24; 
        this.maxMidi = 108; 
        this.historySize = 600; 
>>>>>>> 288c467c4be036d1501a0fe0115a1ea851d3593f
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
<<<<<<< HEAD
        // ... (Lógica de suavização igual) ...
        // Simplifiquei aqui para caber na resposta, use o código anterior de suavização
        this.history.push(midiNote > 0 ? midiNote : null);
=======
        if (midiNote > 0) {
            if (midiNote < this.minMidi) this.minMidi = Math.floor(midiNote) - 2;
            if (midiNote > this.maxMidi) this.maxMidi = Math.ceil(midiNote) + 2;
            this.history.push(midiNote);
        } else {
            this.history.push(null);
        }
>>>>>>> 288c467c4be036d1501a0fe0115a1ea851d3593f
        if (this.history.length > this.historySize) this.history.shift();
    }

    mapMidiToY(note) {
<<<<<<< HEAD
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
=======
        const range = this.maxMidi - this.minMidi;
        const normalized = (note - this.minMidi) / range;
        return this.height - (normalized * this.height);
>>>>>>> 288c467c4be036d1501a0fe0115a1ea851d3593f
    }

    draw() {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.width, this.height);

<<<<<<< HEAD
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
=======
        // Grid
        for (let i = this.minMidi; i <= this.maxMidi; i++) {
            const y = this.mapMidiToY(i);
            this.ctx.fillStyle = isBlackKey(i) ? "#181818" : "#222";
            this.ctx.fillRect(0, y - semitoneHeight, this.width, semitoneHeight);

            if (i % 12 === 0) {
                this.ctx.strokeStyle = "#444";
                this.ctx.beginPath();
                this.ctx.moveTo(0, y);
                this.ctx.lineTo(this.width, y);
                this.ctx.stroke();
                this.ctx.fillStyle = "#aaa";
                this.ctx.font = "bold 11px Arial";
                this.ctx.fillText(getNoteString(i), 5, y - 5);
            }
        }

        // Linha de Pitch
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
            if (!started) { this.ctx.moveTo(x, y); started = true; }
            else { this.ctx.lineTo(x, y); }
>>>>>>> 288c467c4be036d1501a0fe0115a1ea851d3593f
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
// 4. INICIALIZAÇÃO WASM
// ==========================================

VoxEngine().then(module => {
    wasmModule = module;
    elStatus.innerText = "Sistema pronto.";
    btnStart.disabled = false;
    graph = new GraphRenderer('pitchGraph');
});

// ==========================================
// 5. EVENTOS START / STOP
// ==========================================

btnStart.addEventListener('click', async () => {
    try {
        btnStart.disabled = true;
        elAudioSource.disabled = true;

        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        } else if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        if (!dspEngine) {
            dspEngine = new wasmModule.DSPEngine(audioContext.sampleRate, BUFFER_SIZE);
            inputBufferPtr = wasmModule._malloc(BUFFER_SIZE * 4);
        }

        const selectedDeviceId = elAudioSource.value;
        const constraints = {
            audio: {
                deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false,
                latency: 0
            }
        };

        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Atualiza labels (nomes) dos microfones após permissão concedida
        getConnectedDevices().then(() => {
            if (selectedDeviceId) elAudioSource.value = selectedDeviceId;
        });

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
        elAudioSource.disabled = false;
    }
});

btnStop.addEventListener('click', async () => {
    // 1. Para o processamento IMEDIATAMENTE
    if (processor) {
        processor.onaudioprocess = null; 
        processor.disconnect();
        processor = null;
    }

    // 2. Desconecta fonte e para tracks (apaga a luz do microfone)
    if (source) {
        source.disconnect();
        source = null;
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }

    // 3. Suspende áudio para economizar energia
    if (audioContext && audioContext.state !== 'closed') {
        await audioContext.suspend();
    }

    // 4. Limpa interface e Gráfico
    if (graph) {
        graph.minMidi = 24;
        graph.maxMidi = 108;
        graph.history.fill(null);
    }

    btnStart.disabled = false;
    btnStop.disabled = true;
    elAudioSource.disabled = false;
    elStatus.innerText = "Monitoramento parado.";
    elStatus.style.color = "yellow";
    
    elNoteName.innerText = "--";
    elFreq.innerText = "0.0";
    if (elMidi) elMidi.innerText = "0.0";
    elError.innerText = "0.0";
});

// ==========================================
// 6. LOOP DE PROCESSAMENTO
// ==========================================

function processAudioBlock(e) {
    if (!processor || !dspEngine || !inputBufferPtr || !wasmModule) return;

    const inputData = e.inputBuffer.getChannelData(0);

    if (wasmModule.HEAPF32) {
        wasmModule.HEAPF32.set(inputData, inputBufferPtr >> 2);
        const result = dspEngine.process(inputBufferPtr);
        updateUI(result);
    }
}

function updateUI(result) {
    if (result.frequency > 0) {
        elNoteName.innerText = getNoteString(result.midi_note);
        elFreq.innerText = result.frequency.toFixed(1);
        elError.innerText = result.pitch_error.toFixed(0);
        if (elMidi) elMidi.innerText = result.midi_note.toFixed(1);
        
        // Cor do erro (Cents)
        const err = Math.abs(result.pitch_error);
        if (err < 15) elError.style.color = "#0f0";
        else if (err < 40) elError.style.color = "#ff0";
        else elError.style.color = "#f00";

<<<<<<< HEAD
        // Manda pro gráfico
        if (graph) {
        graph.setKey(result.detected_key, result.detected_mode);
        
        if (result.frequency > 0) {
             graph.pushData(result.midi_note);
        } else {
             graph.pushData(0);
        }
=======
        if (graph) graph.pushData(result.midi_note);
    } else {
        if (graph) graph.pushData(0); // Silêncio no gráfico
        elNoteName.innerText = "--";
>>>>>>> 288c467c4be036d1501a0fe0115a1ea851d3593f
    }
}
}
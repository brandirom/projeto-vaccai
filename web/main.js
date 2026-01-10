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
        
        this.width = this.canvas.offsetWidth;
        this.height = this.canvas.offsetHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.minMidi = 24; 
        this.maxMidi = 108; 
        this.historySize = 600; 
        this.history = new Array(this.historySize).fill(null);
        
        this.draw(); 
    }

    pushData(midiNote) {
        if (midiNote > 0) {
            if (midiNote < this.minMidi) this.minMidi = Math.floor(midiNote) - 2;
            if (midiNote > this.maxMidi) this.maxMidi = Math.ceil(midiNote) + 2;
            this.history.push(midiNote);
        } else {
            this.history.push(null);
        }
        if (this.history.length > this.historySize) this.history.shift();
    }

    mapMidiToY(note) {
        const range = this.maxMidi - this.minMidi;
        const normalized = (note - this.minMidi) / range;
        return this.height - (normalized * this.height);
    }

    draw() {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        const range = this.maxMidi - this.minMidi;
        const semitoneHeight = this.height / range;

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
        }
        this.ctx.stroke();
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

        if (graph) graph.pushData(result.midi_note);
    } else {
        if (graph) graph.pushData(0); // Silêncio no gráfico
        elNoteName.innerText = "--";
    }
}
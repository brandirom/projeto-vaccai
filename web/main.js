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
const elMidi = document.getElementById('midi'); // Opcional, se existir no HTML
const elError = document.getElementById('error');
const elAudioSource = document.getElementById('audioSource');
const btnStart = document.getElementById('startBtn');
const btnStop = document.getElementById('stopBtn');
const elVolumeBar = document.getElementById('volumeBar');

// Cria o display de tom se não existir
let elScaleDisplay = document.getElementById('scaleDisplay');
if (!elScaleDisplay) {
    elScaleDisplay = document.createElement('div');
    elScaleDisplay.id = 'scaleDisplay';
    elScaleDisplay.style = "position: absolute; top: 10px; right: 20px; color: cyan; font-size: 1.5em; font-weight: bold;";
    elScaleDisplay.innerText = "Aguardando...";
    document.body.appendChild(elScaleDisplay);
}

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

        // Tenta manter a seleção anterior
        if (currentValue && [...elAudioSource.options].some(opt => opt.value === currentValue)) {
            elAudioSource.value = currentValue;
        }
    } catch (err) {
        console.error("Erro ao listar dispositivos:", err);
    }
}

// Inicializa lista e monitora mudanças
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

        // --- AJUSTE DO EIXO Y (Range Vocal Amplo: C2 a C6) ---
        this.minMidi = 36; 
        this.maxMidi = 84; 
        this.semitoneHeight = this.height / (this.maxMidi - this.minMidi);

        this.historySize = 400; // Aumentado para um scroll mais suave
        this.history = new Array(this.historySize).fill(null);
        
        this.detectedKey = -1;
        this.detectedMode = 0;
        
        this.draw(); 
    }
    
    setKey(key, mode) {
        this.detectedKey = key;
        this.detectedMode = mode;
        
        if (key >= 0) {
            const rootName = NOTE_NAMES[key];
            const modeName = mode === 0 ? "Maior" : "Menor";
            elScaleDisplay.innerText = `Tom: ${rootName} ${modeName}`;
            elScaleDisplay.style.color = "#00ffcc";
        } else {
            elScaleDisplay.innerText = "Analisando Tom...";
            elScaleDisplay.style.color = "#666";
        }
    }

    pushData(midiNote) {
        this.history.push(midiNote > 0 ? midiNote : null);
        if (this.history.length > this.historySize) this.history.shift();
    }

    mapMidiToY(note) {
        // Inverte o eixo para que notas altas fiquem no topo
        return this.height - ((note - this.minMidi) * this.semitoneHeight);
    }
    
    isInScale(midiNote) {
        if (this.detectedKey < 0) return true;
        const noteIndex = Math.round(midiNote) % 12;
        const interval = (noteIndex - this.detectedKey + 12) % 12;
        const majorScale = [1,0,1,0,1,1,0,1,0,1,0,1];
        const minorScale = [1,0,1,1,0,1,0,1,1,0,1,0];
        const scaleProfile = this.detectedMode === 0 ? majorScale : minorScale;
        return scaleProfile[interval] === 1;
    }

    draw() {
        if (!this.canvas) return;
        const ctx = this.ctx;

        // 1. FUNDO COM GRADIENTE
        const bgGrad = ctx.createLinearGradient(0, 0, 0, this.height);
        bgGrad.addColorStop(0, "#0b0e14");
        bgGrad.addColorStop(1, "#1a1f2c");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, this.width, this.height);

        // 2. GRID DE SEMITONS (Piano Roll Style)
        for (let i = this.minMidi; i <= this.maxMidi; i++) {
            const y = this.mapMidiToY(i);
            const isBlackKey = [1, 3, 6, 8, 10].includes(i % 12);
            const isRoot = (i % 12 === this.detectedKey);
            
            // Faixas horizontais
            ctx.fillStyle = isBlackKey ? "rgba(0, 0, 0, 0.2)" : "rgba(255, 255, 255, 0.02)";
            ctx.fillRect(0, y - this.semitoneHeight, this.width, this.semitoneHeight);

            // Linhas de grade sutis
            ctx.beginPath();
            ctx.strokeStyle = isRoot ? "rgba(0, 255, 204, 0.2)" : "rgba(255, 255, 255, 0.05)";
            ctx.lineWidth = isRoot ? 2 : 1;
            ctx.moveTo(0, y);
            ctx.lineTo(this.width, y);
            ctx.stroke();

            // Labels das Notas (apenas C e a nota tônica para não poluir)
            if (i % 12 === 0 || isRoot) {
                ctx.fillStyle = isRoot ? "#00ffcc" : "#555";
                ctx.font = isRoot ? "bold 11px Inter, sans-serif" : "10px Inter, sans-serif";
                ctx.fillText(getNoteString(i), 8, y - 4);
            }
        }

        // 3. DESENHAR A LINHA DE PITCH (O rastro da voz)
        const stepX = this.width / (this.historySize - 1);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        
        for (let i = 1; i < this.history.length; i++) {
            const note = this.history[i];
            const prevNote = this.history[i-1];

            if (note === null || prevNote === null) continue;

            // Se a diferença for muito grande (salto de oitava ou quebra), não conecte com linha
            if (Math.abs(note - prevNote) > 2) continue;

            const x1 = (i - 1) * stepX;
            const y1 = this.mapMidiToY(prevNote);
            const x2 = i * stepX;
            const y2 = this.mapMidiToY(note);

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            
            const inScale = this.isInScale(note);
            
            // Efeito de brilho (Glow)
            ctx.shadowBlur = inScale ? 12 : 4;
            ctx.strokeStyle = inScale ? "#00ffcc" : "#ff4455";
            ctx.shadowColor = ctx.strokeStyle;
            ctx.lineWidth = 3;
            
            ctx.stroke();
            
            // Pequena partícula na ponta atual (opcional, apenas para o último ponto)
            if (i === this.history.length - 1) {
                ctx.beginPath();
                ctx.arc(x2, y2, 4, 0, Math.PI * 2);
                ctx.fillStyle = ctx.strokeStyle;
                ctx.fill();
            }
        }
        
        // Reset do shadow para performance
        ctx.shadowBlur = 0;

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
        
        // Atualiza nomes após permissão
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
    if (processor) {
        processor.onaudioprocess = null; 
        processor.disconnect();
        processor = null;
    }
    if (source) {
        source.disconnect();
        source = null;
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }

    if (graph) {
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
    if (elVolumeBar) elVolumeBar.style.width = "0%";
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
    // 1. Atualizar Barra de Volume (Sempre, mesmo em silêncio)
    if (elVolumeBar) {
        const volPercent = Math.min(100, result.rms_amplitude * 100 * 5); 
        elVolumeBar.style.width = volPercent + "%";
        // Vermelho se som baixo (silêncio), Lime se som detectado
        elVolumeBar.style.backgroundColor = result.rms_amplitude < 0.005 ? "#500" : "#0f0";
    }

    // 2. Atualizar UI de Texto (Apenas se tiver nota)
    if (result.frequency > 0) {
        elNoteName.innerText = getNoteString(result.midi_note);
        elFreq.innerText = result.frequency.toFixed(1);
        elError.innerText = result.pitch_error.toFixed(0);
        if (elMidi) elMidi.innerText = result.midi_note.toFixed(1);
        
        const err = Math.abs(result.pitch_error);
        if (err < 15) elError.style.color = "#0f0";
        else if (err < 40) elError.style.color = "#ff0";
        else elError.style.color = "#f00";
    } else {
        elNoteName.innerText = "--";
    }

    // 3. Atualizar Gráfico e Escala (SEMPRE)
    // O gráfico precisa receber 0 para desenhar as pausas
    if (graph) {
        graph.setKey(result.detected_key, result.detected_mode);
        
        if (result.frequency > 0) {
             graph.pushData(result.midi_note);
        } else {
             graph.pushData(0);
        }
    }
}
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
let mediaRecorder = null;
let audioChunks = [];
let audioUrl = null;

const BUFFER_SIZE = 2048;

// UI Elements
const elStatus = document.getElementById('status');
const elNoteName = document.getElementById('noteName');
const elFreq = document.getElementById('freq');
const elMidi = document.getElementById('midi');
const elError = document.getElementById('error');
const elCents = document.getElementById('centsDisplay');
const elAudioSource = document.getElementById('audioSource');
const elVolumeBar = document.getElementById('volumeBar');
const elScaleDisplay = document.getElementById('scaleDisplay');

const btnStart = document.getElementById('startBtn');
const btnStop = document.getElementById('stopBtn');
const btnConfig = document.getElementById('configBtn');
const btnAnalyze = document.getElementById('analyzeBtn');
const chkRecord = document.getElementById('recordToggle');

// Custom Player Elements
const elCustomPlayer = document.getElementById('customPlayer');
const elAudioPlayer = document.getElementById('audioPlayer'); // Oculto
const btnPlayPause = document.getElementById('playPauseBtn');
const elProgressContainer = document.getElementById('progressContainer');
const elProgressFill = document.getElementById('progressFill');
const elCurrentTime = document.getElementById('currentTime');
const elTotalTime = document.getElementById('totalTime');

const elMicMenu = document.getElementById('micMenu');
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// ==========================================
// 1. LÓGICA DO PLAYER CUSTOMIZADO
// ==========================================

function formatTime(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

// Play/Pause Botão
btnPlayPause.addEventListener('click', () => {
    if (elAudioPlayer.paused) {
        elAudioPlayer.play();
        btnPlayPause.innerText = "⏸";
    } else {
        elAudioPlayer.pause();
        btnPlayPause.innerText = "▶";
    }
});

// Atualização da Barra de Progresso (Visual)
elAudioPlayer.addEventListener('timeupdate', () => {
    if (elAudioPlayer.duration) {
        const pct = (elAudioPlayer.currentTime / elAudioPlayer.duration) * 100;
        elProgressFill.style.width = `${pct}%`;
        elCurrentTime.innerText = formatTime(elAudioPlayer.currentTime);
    }
});

elAudioPlayer.addEventListener('loadedmetadata', () => {
    elTotalTime.innerText = formatTime(elAudioPlayer.duration);
    elCurrentTime.innerText = "0:00";
});

elAudioPlayer.addEventListener('ended', () => {
    btnPlayPause.innerText = "▶";
    elProgressFill.style.width = "0%";
    if (graph) graph.playheadPos = -1; // Remove a bolinha
});

// Clicar na barra de progresso do player
elProgressContainer.addEventListener('click', (e) => {
    const rect = elProgressContainer.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    elAudioPlayer.currentTime = pos * elAudioPlayer.duration;
});


// ==========================================
// 2. INTERFACE GERAL & MENU
// ==========================================

btnConfig.addEventListener('click', (e) => {
    e.stopPropagation();
    elMicMenu.classList.toggle('hidden');
    if (!elMicMenu.classList.contains('hidden')) getConnectedDevices(); 
});

document.addEventListener('click', (e) => {
    if (!elMicMenu.classList.contains('hidden') && !elMicMenu.contains(e.target) && e.target !== btnConfig) {
        elMicMenu.classList.add('hidden');
    }
});

btnAnalyze.addEventListener('click', () => {
    if (graph) {
        graph.togglePrecisionMode();
        if (graph.renderMode === 'precision') {
            btnAnalyze.innerText = "🔙 Voltar";
            btnAnalyze.classList.add('active');
        } else {
            btnAnalyze.innerText = "👁️ Precisão";
            btnAnalyze.classList.remove('active');
        }
    }
});

// --- CLIQUE NO GRÁFICO (CORRIGIDO) ---
document.getElementById('pitchGraph').addEventListener('click', (e) => {
    // CORREÇÃO: Verificamos se 'graph.recording' é falso (não estamos gravando)
    // e se temos um áudio carregado.
    if (!audioUrl || !elAudioPlayer.duration || (graph && graph.recording)) return; 
    
    const rect = e.target.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    
    // Pede ao gráfico para calcular o tempo baseado nos dados visíveis
    const targetTime = graph.getSyncTime(clickX, elAudioPlayer.duration);
    
    if (targetTime >= 0) {
        elAudioPlayer.currentTime = targetTime;
        
        // Se estava pausado, começa a tocar e atualiza o ícone
        if (elAudioPlayer.paused) {
            elAudioPlayer.play();
            btnPlayPause.innerText = "⏸";
        }
    }
});

async function getConnectedDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        const currentVal = elAudioSource.value;
        elAudioSource.innerHTML = '';
        audioInputs.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Microfone ${index + 1}`;
            elAudioSource.appendChild(option);
        });
        if (currentVal) elAudioSource.value = currentVal;
    } catch (err) { console.error(err); }
}

function getNoteString(midiValue) {
    if (midiValue <= 0) return "--";
    const noteIndex = Math.round(midiValue) % 12;
    const octave = Math.floor(Math.round(midiValue) / 12) - 1;
    return NOTE_NAMES[noteIndex] + octave;
}

// ==========================================
// 3. GRAPH RENDERER
// ==========================================
class GraphRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.dataPoints = []; 
        this.recording = false;
        this.renderMode = 'standard'; 

        this.initialPixelsPerFrame = 2; 
        this.minMidi = 45; 
        this.maxMidi = 75; 
        this.detectedKey = -1;
        this.detectedMode = 0;

        this.resizeObserver = new ResizeObserver(() => this.fitDimensions());
        this.resizeObserver.observe(this.canvas.parentElement);
        this.fitDimensions();
        this.drawLoop();
    }

    togglePrecisionMode() { this.renderMode = (this.renderMode === 'standard') ? 'precision' : 'standard'; }
    
    fitDimensions() {
        const parent = this.canvas.parentElement;
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
    }

    setKey(key, mode) {
        this.detectedKey = key; this.detectedMode = mode;
        if (key >= 0) {
            const root = NOTE_NAMES[key];
            const m = mode === 0 ? "Maior" : "Menor";
            elScaleDisplay.innerText = `Tom: ${root} ${m}`;
        } else { elScaleDisplay.innerText = "Analisando..."; }
    }

    pushData(midiNote, pitchError) {
        if (!this.recording) return;
        let inKey = true;
        if (this.detectedKey >= 0 && midiNote > 0) {
            const noteIndex = Math.round(midiNote) % 12;
            const interval = (noteIndex - this.detectedKey + 12) % 12;
            const major = [1,0,1,0,1,1,0,1,0,1,0,1];
            const minor = [1,0,1,1,0,1,0,1,1,0,1,0];
            const scale = this.detectedMode === 0 ? major : minor;
            inKey = scale[interval] === 1;
        }
        this.dataPoints.push({ val: midiNote, inKey: inKey, error: pitchError });
        if (midiNote > 0) {
            if (midiNote < this.minMidi + 2) this.minMidi = Math.floor(midiNote - 4);
            if (midiNote > this.maxMidi - 2) this.maxMidi = Math.ceil(midiNote + 4);
        }
    }

    mapMidiToY(midi) {
        const range = this.maxMidi - this.minMidi;
        const safeZone = this.canvas.height * 0.9;
        const padding = this.canvas.height * 0.05;
        return (this.canvas.height - padding) - ((midi - this.minMidi) * (safeZone / range));
    }

    getPrecisionColor(error) {
        const absErr = Math.abs(error);
        if (absErr < 15) return "#04d361"; 
        if (absErr < 40) return "#fba94c"; 
        return "#e96379"; 
    }

    getSyncTime(clickX, totalDuration) {
        const totalPoints = this.dataPoints.length;
        if (totalPoints === 0) return 0;
        let stepX = this.initialPixelsPerFrame;
        if (totalPoints * stepX > this.canvas.width) {
            stepX = this.canvas.width / (totalPoints - 1);
        }
        let index = Math.floor(clickX / stepX);
        if (index < 0) index = 0;
        if (index >= totalPoints) return totalDuration;
        return (index / totalPoints) * totalDuration;
    }

    drawLoop() {
        requestAnimationFrame(() => this.drawLoop());
        const ctx = this.ctx; const w = this.canvas.width; const h = this.canvas.height;
        ctx.fillStyle = "#09090a"; ctx.fillRect(0, 0, w, h);

        const totalPoints = this.dataPoints.length;
        let stepX = this.initialPixelsPerFrame;
        if (totalPoints * stepX > w) stepX = w / (totalPoints - 1);

        // Grid
        const range = this.maxMidi - this.minMidi;
        const noteHeight = (h * 0.9) / range;
        for (let m = Math.floor(this.minMidi); m <= Math.ceil(this.maxMidi); m++) {
            const y = this.mapMidiToY(m);
            const noteIndex = m % 12;
            if ([1, 3, 6, 8, 10].includes(noteIndex)) {
                ctx.fillStyle = "rgba(255,255,255, 0.03)"; ctx.fillRect(0, y - noteHeight/2, w, noteHeight);
            }
            if (this.detectedKey >= 0 && noteIndex === this.detectedKey) {
                ctx.strokeStyle = "rgba(4, 211, 97, 0.15)"; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
            }
            if (noteIndex === 0 || noteIndex === 5) {
                ctx.fillStyle = "rgba(255,255,255, 0.15)"; ctx.font = "10px monospace"; 
                ctx.fillText(NOTE_NAMES[noteIndex] + (Math.floor(m/12)-1), 5, y + 3);
            }
        }

        if (totalPoints < 2) return;

        // Desenha Linha da Voz
        ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
        let penDown = false;
        
        for (let i = 0; i < totalPoints; i++) {
            const pt = this.dataPoints[i];
            const x = i * stepX;
            if (pt.val <= 0) { if (penDown) ctx.stroke(); penDown = false; continue; }
            const y = this.mapMidiToY(pt.val);
            
            let color;
            if (this.renderMode === 'standard') color = pt.inKey ? "#04d361" : "#e96379";
            else color = this.getPrecisionColor(pt.error);

            if (!penDown) {
                ctx.beginPath(); ctx.moveTo(x, y); ctx.strokeStyle = color; penDown = true;
            } else {
                ctx.lineTo(x, y);
                const prev = this.dataPoints[i-1];
                let prevColor = (this.renderMode === 'standard') ? (prev.inKey ? "#04d361" : "#e96379") : this.getPrecisionColor(prev.error);
                if (color !== prevColor) {
                    ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y); ctx.strokeStyle = color;
                }
            }
        }
        if (penDown) ctx.stroke();

        // --- PONTO DESLIZANTE SUAVE ---
        if (elAudioPlayer.duration > 0 && !this.recording) {
            const progress = elAudioPlayer.currentTime / elAudioPlayer.duration;
            const exactIndex = progress * totalPoints;
            const floorIndex = Math.floor(exactIndex);
            
            if (floorIndex >= 0 && floorIndex < totalPoints) {
                const pt = this.dataPoints[floorIndex];
                if (pt && pt.val > 0) {
                    const cx = floorIndex * stepX;
                    const cy = this.mapMidiToY(pt.val);
                    
                    ctx.beginPath();
                    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
                    ctx.fillStyle = "#fff";
                    ctx.fill();
                    
                    ctx.shadowColor = "#fff";
                    ctx.shadowBlur = 15;
                    ctx.stroke(); 
                    ctx.shadowBlur = 0;
                }
            }
        }
    }
    clear() { this.dataPoints = []; this.minMidi = 45; this.maxMidi = 75; }
}

let graph = null;

VoxEngine().then(module => {
    wasmModule = module;
    elStatus.innerText = "Pronto";
    btnStart.disabled = false;
    graph = new GraphRenderer('pitchGraph');
});

// ==========================================
// 4. START / STOP 
// ==========================================
btnStart.addEventListener('click', async () => {
    try {
        btnStart.disabled = true;
        btnAnalyze.disabled = true;
        chkRecord.disabled = true;
        elAudioSource.disabled = true;
        elMicMenu.classList.add('hidden');
        elCustomPlayer.classList.remove('visible'); // Esconde player

        if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
        if (graph) {
            graph.clear();
            graph.recording = true;
            if (graph.renderMode === 'precision') graph.togglePrecisionMode();
            btnAnalyze.innerText = "👁️ Precisão";
            btnAnalyze.classList.remove('active');
        }

        if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        if (audioContext.state === 'suspended') await audioContext.resume();

        if (!dspEngine) {
            dspEngine = new wasmModule.DSPEngine(audioContext.sampleRate, BUFFER_SIZE);
            inputBufferPtr = wasmModule._malloc(BUFFER_SIZE * 4);
        }

        const constraints = {
            audio: {
                deviceId: elAudioSource.value ? { exact: elAudioSource.value } : undefined,
                echoCancellation: false, autoGainControl: false, noiseSuppression: false, latency: 0
            }
        };
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

        if (chkRecord.checked) {
            mediaRecorder = new MediaRecorder(mediaStream);
            audioChunks = [];
            mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
            mediaRecorder.start();
        }

        source = audioContext.createMediaStreamSource(mediaStream);
        processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
        source.connect(processor);
        processor.connect(audioContext.destination);
        processor.onaudioprocess = processAudioBlock;

        elStatus.innerText = chkRecord.checked ? "Gravando..." : "Monitorando...";
        elStatus.style.color = "var(--accent)";
        btnStop.disabled = false;

    } catch (err) {
        console.error(err);
        elStatus.innerText = "Erro: " + err.message;
        btnStart.disabled = false;
        chkRecord.disabled = false;
        elAudioSource.disabled = false;
    }
});

btnStop.addEventListener('click', async () => {
    if (graph) graph.recording = false;
    if (processor) { processor.disconnect(); processor = null; }
    if (source) { source.disconnect(); source = null; }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        await new Promise(resolve => {
            mediaRecorder.onstop = () => {
                const blob = new Blob(audioChunks, { type: 'audio/webm' });
                audioUrl = URL.createObjectURL(blob);
                elAudioPlayer.src = audioUrl;
                elCustomPlayer.classList.add('visible'); // Mostra player custom
                resolve();
            };
            mediaRecorder.stop();
        });
        mediaRecorder = null;
    }

    if (mediaStream) { 
        mediaStream.getTracks().forEach(t => t.stop()); 
        mediaStream = null; 
    }

    btnStart.disabled = false;
    btnStop.disabled = true;
    btnAnalyze.disabled = false;
    chkRecord.disabled = false;
    elAudioSource.disabled = false;
    
    elStatus.innerText = "Parado";
    elStatus.style.color = "var(--text-secondary)";
    elVolumeBar.style.height = "0%";
    elNoteName.innerText = "--";
});

function processAudioBlock(e) {
    if (!processor || !dspEngine || !inputBufferPtr || !wasmModule) return;
    const inputData = e.inputBuffer.getChannelData(0);
    wasmModule.HEAPF32.set(inputData, inputBufferPtr >> 2);
    const result = dspEngine.process(inputBufferPtr);
    updateUI(result);
}

function updateUI(result) {
    if (elVolumeBar) {
        const vol = Math.min(100, result.rms_amplitude * 100 * 5); 
        elVolumeBar.style.height = vol + "%";
    }
    if (result.frequency > 0) {
        elNoteName.innerText = getNoteString(result.midi_note);
        elFreq.innerText = result.frequency.toFixed(1) + " Hz";
        elMidi.innerText = result.midi_note.toFixed(1);
        elError.innerText = result.pitch_error.toFixed(0);
        const sign = result.pitch_error > 0 ? "+" : "";
        elCents.innerText = `${sign}${result.pitch_error.toFixed(0)} cents`;
        
        const absErr = Math.abs(result.pitch_error);
        if (absErr < 15) elCents.style.color = "var(--accent)";
        else if (absErr < 40) elCents.style.color = "var(--warning)";
        else elCents.style.color = "var(--danger)";
    } else {
        elCents.innerText = "--";
        elCents.style.color = "var(--text-secondary)";
    }
    if (graph) {
        graph.setKey(result.detected_key, result.detected_mode);
        graph.pushData(result.frequency > 0 ? result.midi_note : 0, result.pitch_error);
    }
}
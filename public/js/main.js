// js/main.js
import { AudioManager } from './audio-manager.js';
import { GraphRenderer } from './graph-renderer.js';
import { UIController } from './ui-controller.js';
import { LyricsUI } from './lyrics.js';

// ============================================================================
// 1. INSTANCIAMENTO E CONFIGURAÇÃO INICIAL
// ============================================================================
// Inicializa os módulos principais (mas não o áudio ainda, que precisa de clique)
const audioManager = new AudioManager();
const ui = new UIController();
const lyricsUI = new LyricsUI(ui.elBackingAudio); // A letra precisa saber quem toca a música

const graph = new GraphRenderer('pitchGraph');
// Liga a barra de rolagem HTML ao Canvas do gráfico
graph.bindScrollbar('graphScrollbar', 'graphScrollGhost');

// ============================================================================
// 2. MODAL DE INSTRUÇÕES (POP-UP)
// ============================================================================
// Exibe as boas-vindas e fecha com animação suave
const modal = document.getElementById('introModal');
const btnCloseModal = document.getElementById('btnCloseModal');

if (modal && btnCloseModal) {
    btnCloseModal.addEventListener('click', () => {
        modal.style.transition = "opacity 0.3s";
        modal.style.opacity = "0";
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    });
}

// ============================================================================
// 3. CONTROLES DO CABEÇALHO (MIC, ARQUIVO, TOM)
// ============================================================================

// --- Menu de Microfone ---
const btnMicMenu = document.getElementById('btnMicMenu');
const micList = document.getElementById('micList');

btnMicMenu.addEventListener('click', async (e) => {
    e.stopPropagation();
    // Pede permissão e lista dispositivos ao clicar no ícone do mic
    micList.classList.toggle('show');
    if (micList.classList.contains('show')) {
        const devices = await audioManager.getDevices();
        ui.populateDeviceList(devices);
    }
});
// Fecha o menu se clicar fora
document.addEventListener('click', () => micList && micList.classList.remove('show'));

// --- Backing Track (Upload) ---
// Apenas atualiza o nome do arquivo na tela quando o usuário escolhe um MP3/WAV
document.getElementById('backingInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        document.getElementById('fileNameDisplay').innerText = file.name;
    }
});

// --- Escala e Tom (Manual vs Auto) ---
const elKeyRoot = document.getElementById('keyRoot');
const elKeyMode = document.getElementById('keyMode');

function updateGraphScale() {
    const root = parseInt(elKeyRoot.value);
    const mode = parseInt(elKeyMode.value);
    
    // Se selecionado "Auto" (-1), deixa o algoritmo C++ decidir
    if (root === -1) {
        graph.setAutoDetection();
        elKeyRoot.style.borderColor = "#2e2e33";
    } else {
        // Senão, força a escala visual para colorir as notas certas/erradas
        graph.setManualScale(root, mode);
        elKeyRoot.style.borderColor = "#04d361";
    }
}
elKeyRoot.addEventListener('change', updateGraphScale);
elKeyMode.addEventListener('change', updateGraphScale);

// ============================================================================
// 4. CONTROLES DE GRAVAÇÃO
// ============================================================================

// --- Iniciar Gravação ---
ui.btnStart.addEventListener('click', async () => {
    try {
        // 1. Prepara a UI (Bloqueia botões, acende luz vermelha)
        ui.setRecordingState(true);
        document.querySelector('.record-ctrl').classList.add('recording');
        ui.resetPlayerVisuals(); 
        
        // 2. Reseta o Gráfico
        graph.clear();
        graph.recording = true;
        
        // 3. Inicia Letra e Música de Fundo
        lyricsUI.startTimer();
        ui.playBackingTrack();

        // 4. Liga o motor de áudio e começa a capturar
        const deviceId = ui.elAudioSource.value;
        const shouldRecord = true; // Grava o arquivo final para download
        await audioManager.start(deviceId, shouldRecord);

    } catch (err) {
        console.error(err);
        // Em caso de erro (sem mic, etc), aborta tudo com segurança
        ui.stopBackingTrack();
        ui.setRecordingState(false);
        lyricsUI.stopTimer(); 
        document.querySelector('.record-ctrl').classList.remove('recording');
        alert("Erro: " + err.message);
    }
});

// --- Parar Gravação ---
ui.btnStop.addEventListener('click', async () => {
    // 1. Para o fluxo de dados do gráfico
    graph.recording = false;
    document.querySelector('.record-ctrl').classList.remove('recording');
    
    // 2. Para timers e áudio de fundo
    lyricsUI.stopTimer();
    ui.stopBackingTrack();

    // 3. Finaliza o arquivo de áudio (.webm)
    const audioUrl = await audioManager.stop();
    
    // 4. Prepara o modo de Revisão
    ui.setRecordingState(false); 
    ui.resetMetrics(); 
    graph.fitToScreen(); // Dá zoom out para mostrar a música inteira
    
    if (audioUrl) {
        ui.loadPlayer(audioUrl); // Carrega a voz no player
        ui.enableDownload(audioUrl); // Habilita botão de download
    }
});

// ============================================================================
// 5. PLAYER DE REVISÃO E SINCRONIA VISUAL
// ============================================================================

// --- Conecta eventos do Player de Áudio à Letra ---
ui.elAudioPlayer.addEventListener('play', () => lyricsUI.startTimer());
ui.elAudioPlayer.addEventListener('pause', () => lyricsUI.stopTimer());
ui.elAudioPlayer.addEventListener('ended', () => lyricsUI.stopTimer());

// --- Lógica de Seek (Clicar no gráfico para pular o som) ---
graph.onSeek = (time) => {
    if (ui.elAudioPlayer.src) {
        // Garante que não pule para fora do arquivo
        const safeTime = Math.min(time, ui.elAudioPlayer.duration || 1000);
        ui.elAudioPlayer.currentTime = safeTime;
        
        // Sincroniza a Backing Track (considerando o offset de início)
        if (ui.elBackingAudio.src && ui.chkPlayBacking.checked) {
             let startOffset = parseFloat(ui.elBackingStart.value) || 0;
             ui.elBackingAudio.currentTime = startOffset + safeTime;
             ui.elBackingAudio.play();
        }

        // Dá play automático e atualiza ícones
        ui.elAudioPlayer.play();
        ui.isPlaying = true;
        ui.updatePlayButtonIcon(true);
        
        lyricsUI.startTimer();
    }
};

// --- Loop Principal de Animação (Game Loop) ---
function syncLoop() {
    requestAnimationFrame(syncLoop);
    
    // Só roda se NÃO estiver gravando (durante a gravação, o fluxo é empurrado pelo AudioProcessor)
    if (!graph.recording) {
        // Decide quem é o mestre do tempo (Voz ou Música)
        const master = ui.elAudioPlayer.src ? ui.elAudioPlayer : ui.elBackingAudio;
        
        if (master && !master.paused) {
            // 1. Atualiza a posição da "agulha" no gráfico
            graph.setPlaybackState(master.currentTime, master.duration);

            // 2. Se estiver tocando a voz gravada, recupera os dados históricos (Pitch/Erro)
            // para animar o afinador como se fosse ao vivo.
            if (master === ui.elAudioPlayer) {
                const recordedData = graph.getDataAtTime(master.currentTime);
                
                if (recordedData) {
                    ui.updateMetrics({
                        midi_note: recordedData.val,
                        frequency: recordedData.frequency,
                        pitch_error: recordedData.error
                    });
                } else {
                    // Zera os ponteiros em momentos de silêncio
                    ui.updateMetrics({
                        midi_note: 0,
                        frequency: 0,
                        pitch_error: 0
                    });
                }
            }
        }
    }
}
syncLoop();

// ============================================================================
// 6. INICIALIZAÇÃO DA ENGINE (WASM)
// ============================================================================
let lastUiUpdate = 0;
const UI_REFRESH_RATE = 1000 / 30; // Limita a UI a 30fps para economizar CPU

// Carrega o módulo C++ compilado (VaccaiEngine)
VaccaiEngine().then(module => {
    audioManager.init(module);
    
    // Informa ao gráfico a taxa de amostragem real do hardware
    if (audioManager.audioContext) {
        graph.updateSampleRate(audioManager.audioContext.sampleRate);
    }
    
    // --- CÁLCULO DE LATÊNCIA AUTOMÁTICA ---
    // Estima o atraso total do sistema para alinhar o gráfico perfeitamente
    const ctx = audioManager.audioContext;
    const sysLatency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    const bufferLatency = 2048 / ctx.sampleRate;
    const autoLatency = sysLatency + bufferLatency + 0.01; // +10ms de segurança

    console.log(`[Auto-Sync] Latência detectada: ${(autoLatency * 1000).toFixed(0)}ms`);
    graph.setBaseLatency(autoLatency);
    
    // --- CALLBACK DE ANÁLISE (Onde a mágica acontece) ---
    // Chamado ~43 vezes por segundo com novos dados do microfone
    audioManager.onAnalysisResult = (result) => {
        if (graph.recording) {
            graph.pushData(result);
            if (result.detected_key !== graph.detectedKey && !graph.isManualKey) {
                graph.setKey(result.detected_key, result.detected_mode);
            }
        }
        
        const now = performance.now();
        if (now - lastUiUpdate > UI_REFRESH_RATE) {
            ui.updateMetrics(result);
            lastUiUpdate = now;
        }

        // Libera a memória do std::vector no C++
        if (result.chroma) {
            result.chroma.delete(); 
        }
    };
    console.log("Engine Ready");
    ui.btnStart.disabled = false;
});
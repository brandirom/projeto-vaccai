// js/ui-controller.js
import { midiToNote, formatTime, COLORS, mapRange, clamp } from './utils.js';

// ============================================================================
// CONTROLADOR DE INTERFACE (DOM & INTERAÇÃO)
// ============================================================================

export class UIController {
    constructor() {
        // --- ELEMENTOS DE TEXTO (HUD) ---
        // Referências aos spans que mostram a nota, frequência e erro em cents
        this.elNoteName = document.getElementById('noteName') || {innerText: ''};
        this.elFreq = document.getElementById('freq') || {innerText: ''};
        this.elError = document.getElementById('error') || {innerText: ''};
        this.elCents = document.getElementById('centsDisplay') || {innerText: ''};

        // --- CANVAS DO AFINADOR (AGULHA) ---
        this.tunerCanvas = document.getElementById('tunerCanvas');
        this.ctxTuner = this.tunerCanvas ? this.tunerCanvas.getContext('2d') : null;

        // --- PLAYERS DE ÁUDIO (HTML5) ---
        this.elAudioPlayer = document.getElementById('audioPlayer');   // Voz gravada
        this.elBackingAudio = document.getElementById('backingAudio'); // Música de fundo
        
        // --- RODAPÉ (CONTROLES) ---
        this.btnPlayPause = document.getElementById('playPauseBtn');
        
        // Ícones SVG (Alternância Play/Pause)
        this.elIconPlay = document.getElementById('iconPlay');
        this.elIconPause = document.getElementById('iconPause');

        // Barra de Progresso
        this.elProgressFill = document.getElementById('progressFill');
        this.elCurrentTime = document.getElementById('currentTime');
        this.elTotalTime = document.getElementById('totalTime');
        this.elProgressContainer = document.getElementById('progressContainer');

        // Botões de Ação
        this.btnStart = document.getElementById('startBtn');
        this.btnStart.disabled = true;
        this.btnStop = document.getElementById('stopBtn');
        this.btnDownload = document.getElementById('btnDownload');
        
        // Checkbox "Ouvir Música no Playback"
        this.chkPlayBacking = document.getElementById('playBackingToggle');
        
        this.currentAudioUrl = null; 
        
        if (this.btnDownload) {
            this.btnDownload.addEventListener('click', () => this.downloadVoice());
        }
        
        // --- SELEÇÃO DE MICROFONE ---
        this.elAudioSource = document.getElementById('audioSource');
        this.micList = document.getElementById('micList');
        this.btnMicMenu = document.getElementById('btnMicMenu');

        // --- CONTROLES DE BACKING TRACK (UPLOAD) ---
        this.elBackingInput = document.getElementById('backingInput');
        this.elBackingName = document.getElementById('fileNameDisplay');
        this.elBackingVolume = document.getElementById('backingVolume');
        this.elBackingStart = document.getElementById('backingStart');
        this.btnRemoveBacking = document.getElementById('btnRemoveBacking');
        
        // --- ESTADO INTERNO ---
        this.currentNeedleValue = 0; // Posição atual da agulha (para animação suave)
        this.isPlaying = false;

        // Inicialização
        this.updatePlayButtonIcon(false);
        this.setupPlayerEvents();
        this.setupBackingTrackEvents();
        this.setupHudToggles();
    }

    // Alterna visualmente os ícones SVG dentro do botão de Play
    updatePlayButtonIcon(isPlaying) {
        if (!this.elIconPlay || !this.elIconPause) return;
        
        if (isPlaying) {
            this.elIconPlay.style.display = 'none';
            this.elIconPause.style.display = 'block';
        } else {
            this.elIconPlay.style.display = 'block';
            this.elIconPause.style.display = 'none';
        }
    }

    // Permite minimizar as janelas flutuantes (Afinador)
    setupHudToggles() {
        const huds = ['floatingTuner'];
        
        huds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            
            // Botão de minimizar (-)
            const btnMin = el.querySelector('.btn-minimize');
            if (btnMin) {
                btnMin.addEventListener('click', (e) => {
                    e.stopPropagation(); 
                    el.classList.add('minimized');
                });
            }
            // Clique no corpo para restaurar
            el.addEventListener('click', () => {
                if (el.classList.contains('minimized')) {
                    el.classList.remove('minimized');
                }
            });
        });
    }

    // Ativa o botão de download após a gravação terminar
    enableDownload(url) {
        if (url) {
            this.currentAudioUrl = url;
            this.btnDownload.disabled = false;
            this.btnDownload.style.color = "#fff";
            this.btnDownload.style.opacity = "1";
        } else {
            this.btnDownload.disabled = true;
            this.btnDownload.style.opacity = "0.5";
        }
    }

    downloadVoice() {
        if (!this.currentAudioUrl) return;
        
        const a = document.createElement('a');
        a.href = this.currentAudioUrl;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.download = `voz_${timestamp}.webm`;
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // Preenche o menu suspenso com os microfones encontrados
    populateDeviceList(devices) {
        this.elAudioSource.innerHTML = '';
        const defOpt = document.createElement('option');
        defOpt.value = ""; defOpt.text = "Mic Padrão";
        this.elAudioSource.appendChild(defOpt);

        this.micList.innerHTML = '';
        if (devices.length === 0) {
            this.micList.innerHTML = '<div class="mic-option">Nenhum mic encontrado</div>';
            return;
        }

        devices.forEach((device, index) => {
            // Opção oculta (select nativo)
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Microfone ${index + 1}`;
            this.elAudioSource.appendChild(option);

            // Opção visual (menu customizado)
            const div = document.createElement('div');
            div.className = 'mic-option';
            div.innerText = device.label || `Microfone ${index + 1}`;
            div.onclick = () => {
                this.elAudioSource.value = device.deviceId;
                this.btnMicMenu.style.color = '#8257e5'; // Roxo (Vaccai) ao selecionar
                this.micList.classList.remove('show');
            };
            this.micList.appendChild(div);
        });
    }

    // --- ATUALIZAÇÃO VISUAL (LOOP DE 30FPS) ---
    // Chamado pelo main.js com os dados vindos do backend
    updateMetrics(result) {
        if (result.frequency > 0) {
            // 1. Atualiza textos
            this.elNoteName.innerText = midiToNote(result.midi_note);
            if(this.elFreq) this.elFreq.innerText = result.frequency.toFixed(1);
            if(this.elError) this.elError.innerText = result.pitch_error.toFixed(0);
            
            // 2. Formata Cents (+/-)
            const sign = result.pitch_error > 0 ? "+" : "";
            this.elCents.innerText = `${sign}${result.pitch_error.toFixed(0)} cents`;
            
            // 3. Define cor baseada na precisão
            const absErr = Math.abs(result.pitch_error);
            let color = COLORS.danger; // Vermelho (>40 cents)
            if (absErr < 15) color = COLORS.accent; // Verde (<15 cents)
            else if (absErr < 40) color = COLORS.warning; // Laranja (<40 cents)
            this.elCents.style.color = color;

            // 4. Desenha a agulha
            this.drawTuner(result.pitch_error);
        } else {
            // Silêncio
            this.elCents.innerText = "--";
            this.elCents.style.color = COLORS.textSec;
            this.drawTuner(null); // Agulha repousa
        }
    }

    resetMetrics() {
        this.elNoteName.innerText = "--";
        if(this.elFreq) this.elFreq.innerText = "0.0";
        if(this.elError) this.elError.innerText = "0";
        
        this.elCents.innerText = "--";
        this.elCents.style.color = COLORS.textSec;

        this.drawTuner(null);
    }
    
    // Reseta o player de áudio para o estado inicial
    resetPlayerVisuals() {
        this.isPlaying = false;
        this.updatePlayButtonIcon(false); 

        this.elProgressFill.style.width = "0%";
        this.elCurrentTime.innerText = "0:00";
        this.elTotalTime.innerText = "0:00";

        if (this.elAudioPlayer.src) {
            this.elAudioPlayer.pause();
            this.elAudioPlayer.removeAttribute('src'); 
            this.elAudioPlayer.load(); 
        }
        this.currentAudioUrl = null;
        this.btnDownload.disabled = true;
        this.btnDownload.style.opacity = "0.5";
    }

    // --- GERENCIAMENTO DE ARQUIVOS (BACKING TRACK) ---
    setupBackingTrackEvents() {
        // Carregar arquivo do computador
        this.elBackingInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const fileURL = URL.createObjectURL(file);
                this.elBackingAudio.src = fileURL;
                this.elBackingName.innerText = file.name;
                this.elBackingName.style.color = COLORS.primary;
                
                // Limpa gravação antiga para evitar tocar duas coisas ao mesmo tempo
                this.elAudioPlayer.src = "";
                this.elTotalTime.innerText = "0:00";

                if (this.btnRemoveBacking) this.btnRemoveBacking.style.display = 'flex';
            }
        });

        // Controle de Volume
        this.elBackingVolume.addEventListener('input', (e) => {
            this.elBackingAudio.volume = e.target.value;
        });

        // Botão Lixeira (Remover arquivo)
        if (this.btnRemoveBacking) {
            this.btnRemoveBacking.addEventListener('click', (e) => {
                e.preventDefault(); 
                
                this.elBackingAudio.pause();
                this.elBackingAudio.removeAttribute('src'); 
                this.elBackingAudio.load();
                
                this.elBackingInput.value = '';
                this.elBackingName.innerText = "Carregar Música...";
                this.elBackingName.style.color = "var(--text-main)";
                this.btnRemoveBacking.style.display = 'none';
            });
        }
    }

    playBackingTrack() {
        if (this.elBackingAudio.src) {
            let startTime = parseFloat(this.elBackingStart.value);
            if (isNaN(startTime) || startTime < 0) startTime = 0;
            this.elBackingAudio.currentTime = startTime;
            this.elBackingAudio.play().catch(err => console.error(err));
        }
    }

    stopBackingTrack() {
        if (this.elBackingAudio.src) {
            this.elBackingAudio.pause();
            let startTime = parseFloat(this.elBackingStart.value);
            if (isNaN(startTime)) startTime = 0;
            this.elBackingAudio.currentTime = startTime;
        }
    }

    // --- PLAYER DE REVISÃO (FOOTER) ---
    setupPlayerEvents() {
        // Botão Principal Play/Pause
        this.btnPlayPause.addEventListener('click', () => {
            // Só toca se houver gravação carregada
            const hasVoice = !!(this.elAudioPlayer.src && this.elAudioPlayer.src !== window.location.href);
            if (!hasVoice) return;

            const hasBacking = !!(this.elBackingAudio.src && this.elBackingAudio.src !== window.location.href);

            if (this.isPlaying) {
                this.elAudioPlayer.pause();
                this.elBackingAudio.pause();
                this.isPlaying = false;
                this.updatePlayButtonIcon(false);
            } else {
                this.elAudioPlayer.play();
                // Toca a música de fundo junto (se o checkbox estiver marcado)
                if (hasBacking && this.chkPlayBacking.checked) {
                    let startOffset = parseFloat(this.elBackingStart.value) || 0;
                    this.elBackingAudio.currentTime = startOffset + this.elAudioPlayer.currentTime;
                    this.elBackingAudio.play();
                }
                this.isPlaying = true;
                this.updatePlayButtonIcon(true);
            }
        });

        // Atualiza a barra de progresso
        setInterval(() => {
            if (!this.isPlaying) return;
            const master = this.elAudioPlayer;
            
            if (master && master.duration) {
                const pct = (master.currentTime / master.duration) * 100;
                this.elProgressFill.style.width = `${pct}%`;
                this.elCurrentTime.innerText = formatTime(master.currentTime);
                this.elTotalTime.innerText = formatTime(master.duration);
            }
            
            // Quando acaba, reseta tudo
            if (master && master.ended) {
                this.isPlaying = false;
                this.updatePlayButtonIcon(false);
                this.elProgressFill.style.width = "0%";
                this.elAudioPlayer.pause();
                this.elBackingAudio.pause();
                
                this.elAudioPlayer.currentTime = 0;
                let startOffset = parseFloat(this.elBackingStart.value) || 0;
                this.elBackingAudio.currentTime = startOffset;
            }
        }, 100);

        // Clique na barra de progresso (Seek)
        this.elProgressContainer.addEventListener('click', (e) => {
            if (!this.elAudioPlayer.src || this.elAudioPlayer.src === window.location.href) return;

            const master = this.elAudioPlayer;
            if (!master.duration) return;

            const rect = this.elProgressContainer.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            const newTime = pos * master.duration;

            this.elAudioPlayer.currentTime = newTime;
            
            // Sincroniza a música de fundo também
            if (this.elBackingAudio.src && this.chkPlayBacking.checked) {
                let startOffset = parseFloat(this.elBackingStart.value) || 0;
                this.elBackingAudio.currentTime = startOffset + newTime;
            }

            // Se estava pausado, começa a tocar
            if (!this.isPlaying) {
                this.elAudioPlayer.play();
                if (this.elBackingAudio.src && this.chkPlayBacking.checked) {
                    this.elBackingAudio.play();
                }
                this.isPlaying = true;
                this.updatePlayButtonIcon(true);
            }
        });
    }

    // Carrega o Blob gravado no player de áudio
    loadPlayer(audioUrl) {
        if (audioUrl) {
            console.log("Carregando gravação no player:", audioUrl);
            this.elAudioPlayer.src = audioUrl;
            
            this.updatePlayButtonIcon(false);
            
            this.isPlaying = false;
            this.elProgressFill.style.width = "0%";
            this.elCurrentTime.innerText = "0:00";
            
            // Corrige bug do Chrome onde duration pode vir como Infinity para streams
            this.elAudioPlayer.onloadedmetadata = () => {
                if (this.elAudioPlayer.duration === Infinity) {
                    this.elAudioPlayer.currentTime = 1e101;
                    this.elAudioPlayer.ontimeupdate = () => {
                        this.elAudioPlayer.ontimeupdate = null;
                        this.elAudioPlayer.currentTime = 0;
                        this.elTotalTime.innerText = formatTime(this.elAudioPlayer.duration);
                    };
                } else {
                    this.elTotalTime.innerText = formatTime(this.elAudioPlayer.duration);
                }
            };
        }
    }

    // --- DESENHO DO AFINADOR (AGULHA) ---
    drawTuner(cents) {
        if (!this.ctxTuner) return;
        const ctx = this.ctxTuner;
        const w = this.tunerCanvas.width; const h = this.tunerCanvas.height;
        const cx = w / 2; const cy = h - 10; const radius = h - 20;

        let target = (cents === null) ? 0 : cents;
        // Suavização (Lerp) para a agulha não pular bruscamente
        this.currentNeedleValue += (target - this.currentNeedleValue) * 0.5;

        // 1. Fundo e Arco Base
        ctx.clearRect(0, 0, w, h);
        ctx.beginPath(); ctx.arc(cx, cy, radius, Math.PI, 2 * Math.PI);
        ctx.lineWidth = 6; ctx.strokeStyle = "#222"; ctx.stroke();

        // 2. Zona Segura (Verde) - Indica onde a afinação é aceitável
        ctx.beginPath();
        const startSafe = Math.PI + mapRange(-15, -50, 50, 0, Math.PI);
        const endSafe = Math.PI + mapRange(15, -50, 50, 0, Math.PI);
        ctx.arc(cx, cy, radius, startSafe, endSafe);
        ctx.strokeStyle = "rgba(4, 211, 97, 0.4)"; ctx.lineWidth = 6; ctx.stroke();

        // 3. A Agulha
        const isSilence = (cents === null);
        const val = clamp(this.currentNeedleValue, -50, 50);
        const angle = Math.PI + mapRange(val, -50, 50, 0, Math.PI);
        const px = cx + radius * 0.9 * Math.cos(angle);
        const py = cy + radius * 0.9 * Math.sin(angle);

        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py);
        ctx.lineWidth = 4; ctx.lineCap = "round";
        ctx.strokeStyle = isSilence ? "#444" : (Math.abs(val) < 15 ? COLORS.accent : COLORS.danger);
        ctx.stroke();

        // 4. Base da Agulha (Pivô)
        ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 2*Math.PI);
        ctx.fillStyle = isSilence ? "#444" : "#fff"; ctx.fill();
    }

    // Trava/Destrava a interface durante a gravação
    setRecordingState(isRecording) {
        if (isRecording) {
            this.btnStart.disabled = true; this.btnStop.disabled = false;
            this.btnDownload.disabled = true; 
            this.btnDownload.style.opacity = "0.5";
            
            // Ao gravar, paramos o player de revisão para não dar eco
            this.resetPlayerVisuals(); 
            
            // Trava configurações
            this.elAudioSource.disabled = true;
            this.btnMicMenu.disabled = true;
            this.elBackingInput.disabled = true; this.elBackingStart.disabled = true;
        } else {
            this.btnStart.disabled = false; this.btnStop.disabled = true;
            
            // Destrava configurações
            this.elAudioSource.disabled = false;
            this.btnMicMenu.disabled = false;
            this.elBackingInput.disabled = false; this.elBackingStart.disabled = false;
        }
    }
}
// js/graph-renderer.js
import { NOTE_NAMES, COLORS } from './utils.js';

// ============================================================================
// RENDERIZADOR DO GRÁFICO (PIANO ROLL & CURVA DE PITCH)
// ============================================================================

export class GraphRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.dataPoints = []; // Armazena todo o histórico da gravação
        this.recording = false;

        // Playback Sync (Sincronia Visual)
        this.playbackTime = 0;
        this.totalDuration = 0;

        // --- MOTOR DE SINCRONIA ---
        // Define a relação entre pixels e tempo.
        // 2048 amostras / 44100 Hz ~= 46ms por ponto no gráfico.
        this.samplesPerBlock = 2048;
        this.sampleRate = 44100;
        this.secondsPerPoint = this.samplesPerBlock / this.sampleRate;
        
        // Compensação de Latência (Ajuste fino para alinhar áudio e vídeo)
        this.latencyOffset = 0.0; 

        // --- ZOOM & PAN (Navegação) ---
        this.scaleX = 1.0;     // Zoom horizontal
        this.offsetX = 0;      // Deslocamento horizontal (Scroll)
        this.basePixelsPerFrame = 2; // Largura base de cada ponto

        // Limites Verticais (Range de notas visíveis)
        // Ajustam-se dinamicamente conforme o usuário canta mais grave ou agudo.
        this.minMidi = 45; 
        this.maxMidi = 75; 
        
        // --- DETECÇÃO DE TOM (Estado) ---
        this.detectedKey = -1;
        this.detectedMode = 0;
        this.isManualKey = false; 

        // Responsividade: Redimensiona o canvas se a janela mudar
        this.resizeObserver = new ResizeObserver(() => this.fitDimensions());
        this.resizeObserver.observe(this.canvas.parentElement);
        this.fitDimensions();
        
        this.setupInteractions();
        this.drawLoop(); // Inicia o loop de renderização (60fps)
    }

    // Conecta a barra de rolagem customizada (HTML) ao canvas
    bindScrollbar(containerId, contentId) {
        this.scrollContainer = document.getElementById(containerId);
        this.scrollGhost = document.getElementById(contentId);

        // Quando o usuário mexe na barra, atualiza o gráfico
        this.scrollContainer.addEventListener('scroll', () => {
            if (this.ignoreScrollEvent) return; 
            this.offsetX = -this.scrollContainer.scrollLeft;
        });
    }

    // Atualiza o tamanho da barra de rolagem baseado no zoom atual
    updateScrollbarUI() {
        if (!this.scrollContainer || !this.scrollGhost) return;

        const totalPoints = this.dataPoints.length;
        const virtualWidth = totalPoints * (this.basePixelsPerFrame * this.scaleX);
        
        this.scrollGhost.style.width = `${virtualWidth}px`;

        // Sincroniza posição sem disparar loop infinito de eventos
        this.ignoreScrollEvent = true;
        this.scrollContainer.scrollLeft = -this.offsetX;
        this.ignoreScrollEvent = false;
    }

    // Ajusta o cálculo de tempo se a taxa de amostragem do hardware for diferente (ex: 48kHz)
    updateSampleRate(realSampleRate) {
        if (realSampleRate > 0) {
            this.sampleRate = realSampleRate;
            this.secondsPerPoint = this.samplesPerBlock / this.sampleRate;
            console.log(`[Graph] Calibrado para ${this.sampleRate} Hz`);
        }
    }

    // Define o atraso visual calculado automaticamente no main.js
    setBaseLatency(seconds) {
        this.latencyOffset = seconds; 
        console.log(`[Graph] Latência final aplicada: ${(this.latencyOffset * 1000).toFixed(1)} ms`);
    }
    
    fitDimensions() {
        const parent = this.canvas.parentElement;
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
    }

    // --- MÉTODOS DE CONTROLE DE ESCALA ---

    setManualScale(rootNote, mode) {
        this.isManualKey = true;
        this.detectedKey = rootNote;
        this.detectedMode = mode;
        console.log(`[Graph] Escala TRAVADA em: ${rootNote} (${mode===0?'Maior':'Menor'})`);
    }

    setAutoDetection() {
        this.isManualKey = false;
        console.log("[Graph] Escala em modo AUTO");
    }

    setKey(key, mode) {
        if (this.isManualKey) return;
        this.detectedKey = key; 
        this.detectedMode = mode;
    }

    // Atualiza a posição da "agulha" de reprodução (Playhead)
    setPlaybackState(currentTime, totalDuration) {
        this.playbackTime = currentTime;
        this.totalDuration = totalDuration;
    }

    // --- GRAVAÇÃO DE DADOS ---
    // Recebe o pacote de análise do C++ e salva no histórico
    pushData(result) {
        if (!this.recording) return;
        
        const midiNote = result.midi_note;
        const pitchError = result.pitch_error;

        // Verifica se a nota cantada pertence à escala detectada (para colorir verde/vermelho)
        let inKey = true;
        if (this.detectedKey >= 0 && midiNote > 0) {
            const noteIndex = Math.round(midiNote) % 12;
            const interval = (noteIndex - this.detectedKey + 12) % 12;
            const major = [1,0,1,0,1,1,0,1,0,1,0,1]; // Intervalos Escala Maior
            const minor = [1,0,1,1,0,1,0,1,1,0,1,0]; // Intervalos Escala Menor
            const scale = this.detectedMode === 0 ? major : minor;
            inKey = scale[interval] === 1;
        }

        // Salva o ponto
        this.dataPoints.push({ 
            val: midiNote, 
            inKey: inKey, 
            error: pitchError,
            frequency: result.frequency,
        });

        // Expande o gráfico verticalmente se a nota sair da tela
        if (midiNote > 0) {
            if (midiNote < this.minMidi + 2) this.minMidi = Math.floor(midiNote - 4);
            if (midiNote > this.maxMidi - 2) this.maxMidi = Math.ceil(midiNote + 4);
        }
        
        // Auto-scroll: Mantém o gráfico seguindo a gravação
        if (this.recording) {
            this.scaleX = 1.0;
            this.offsetX = 0; 
        }
    }

    // --- RECUPERAÇÃO DE DADOS (PLAYBACK) ---
    // Retorna os dados gravados correspondentes a um tempo específico do áudio
    getDataAtTime(time) {
        if (this.dataPoints.length === 0) return null;
        
        // Compensa a latência para que o gráfico bata com o som que o usuário ouve
        const correctedTime = Math.max(0, time + this.latencyOffset);
        
        // Converte tempo (segundos) -> índice do array
        const index = Math.floor(correctedTime / this.secondsPerPoint);

        if (index >= 0 && index < this.dataPoints.length) {
            return this.dataPoints[index];
        }
        return null;
    }

    setupInteractions() {
        this.onSeek = null; // Callback para avisar o main.js que o usuário clicou

        // Clique para mudar a posição do áudio (Seek)
        this.canvas.addEventListener('click', (e) => {
            if (this.recording || this.dataPoints.length === 0) return;

            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const time = this.getSyncTime(x);

            if (this.onSeek) {
                this.onSeek(time);
            }
        });

        // Roda do mouse para Zoom
        this.canvas.addEventListener('wheel', (e) => {
            if (this.recording) return;
            e.preventDefault();
            const zoomIntensity = 0.001;
            const newScale = this.scaleX + (e.deltaY * -zoomIntensity);
            this.scaleX = Math.min(Math.max(0.01, newScale), 50); // Limites do zoom
        });
    }

    // Converte posição do clique (pixels) -> Tempo (segundos)
    getSyncTime(clickX) {
        const totalPoints = this.dataPoints.length;
        if (totalPoints === 0) return 0;
        
        const effectiveStep = this.basePixelsPerFrame * this.scaleX;
        let index = (clickX - this.offsetX) / effectiveStep;
        if (index < 0) index = 0;
        
        const time = index * this.secondsPerPoint;
        return time;
    }

    // Converte nota MIDI -> Posição Y no Canvas
    mapMidiToY(midi) {
        const range = this.maxMidi - this.minMidi;
        const safeZone = this.canvas.height * 0.8; 
        const padding = this.canvas.height * 0.1;
        return (this.canvas.height - padding) - ((midi - this.minMidi) * (safeZone / range));
    }

    // ========================================================================
    // LOOP DE DESENHO (60 FPS)
    // ========================================================================
    drawLoop() {
        requestAnimationFrame(() => this.drawLoop());

        // Pula o desenho se não há nada acontecendo
        if (!this.recording && !document.getElementById('audioPlayer').src && !document.getElementById('backingAudio').src) {
            return; 
        }

        const ctx = this.ctx; 
        const w = this.canvas.width; 
        const h = this.canvas.height;
        
        // Limpa o fundo
        ctx.fillStyle = "#09090a"; 
        ctx.fillRect(0, 0, w, h);

        const totalPoints = this.dataPoints.length;
        let stepX = this.basePixelsPerFrame * this.scaleX;

        this.updateScrollbarUI();

        // Se estiver gravando, comprime o gráfico para caber na tela
        if (this.recording && totalPoints * stepX > w) {
             stepX = w / (totalPoints - 1);
        }

        // --- 1. DESENHA O GRID (PIANO ROLL) ---
        const range = this.maxMidi - this.minMidi;
        const noteHeight = (h * 0.8) / range;
        
        for (let m = Math.floor(this.minMidi); m <= Math.ceil(this.maxMidi); m++) {
            const y = this.mapMidiToY(m);
            const noteIndex = m % 12;
            
            // Destaca notas que pertencem à escala detectada
            let isScaleNote = false;
            
            if (this.detectedKey >= 0) {
                const interval = (noteIndex - this.detectedKey + 12) % 12;
                const major = [1,0,1,0,1,1,0,1,0,1,0,1];
                const minor = [1,0,1,1,0,1,0,1,1,0,1,0];
                const scale = this.detectedMode === 0 ? major : minor;
                if (scale[interval] === 1) isScaleNote = true;
            } else {
                // Se não detectou nada, destaca notas naturais (Teclas brancas)
                if ([0, 2, 4, 5, 7, 9, 11].includes(noteIndex)) isScaleNote = true;
            }

            if (isScaleNote) {
                ctx.fillStyle = (this.detectedKey >= 0) ? "rgba(4, 211, 97, 0.05)" : "rgba(255, 255, 255, 0.02)";
                ctx.fillRect(0, y - noteHeight/2, w, noteHeight);
            }

            // Linha fina da nota
            ctx.fillStyle = "rgba(255,255,255, 0.02)"; 
            ctx.fillRect(0, y - noteHeight/2, w, 1);

            // Destaca a Tônica (Nota principal do tom)
            if (this.detectedKey >= 0 && noteIndex === this.detectedKey) {
                ctx.fillStyle = "rgba(130, 87, 229, 0.15)";
                ctx.fillRect(0, y - noteHeight/2, w, noteHeight);
            }
            
            // Nome da nota na lateral esquerda
            if (noteIndex === 0 || (this.detectedKey >= 0 && noteIndex === this.detectedKey)) {
                ctx.fillStyle = "rgba(255,255,255, 0.3)"; 
                ctx.font = "10px monospace"; 
                ctx.fillText(NOTE_NAMES[noteIndex] + (Math.floor(m/12)-1), 5, y + 3);
            }
        }

        if (totalPoints < 2) return;

        // --- 2. DESENHA A LINHA DA MELODIA ---
        ctx.lineWidth = 3 * Math.sqrt(this.scaleX); 
        if(ctx.lineWidth < 1.5) ctx.lineWidth = 1.5;
        if(ctx.lineWidth > 5) ctx.lineWidth = 5;

        ctx.lineCap = "round"; ctx.lineJoin = "round";
        let penDown = false;
        
        // Otimização: Só desenha o que está visível na tela
        let startIndex = 0;
        let endIndex = totalPoints;

        if (!this.recording) {
            startIndex = Math.floor(-this.offsetX / stepX);
            endIndex = Math.ceil((w - this.offsetX) / stepX);
            if (startIndex < 0) startIndex = 0;
            if (endIndex > totalPoints) endIndex = totalPoints;
        }

        for (let i = startIndex; i < endIndex; i++) {
            const pt = this.dataPoints[i];
            const x = (i * stepX) + (this.recording ? 0 : this.offsetX);
            
            // Pula silêncio
            if (pt.val <= 0) { 
                if (penDown) ctx.stroke(); 
                penDown = false; 
                continue; 
            }
            
            const y = this.mapMidiToY(pt.val);
            
            // Cor: Verde se no tom, Vermelho se fora
            const color = pt.inKey ? COLORS.accent : COLORS.danger;

            if (!penDown) {
                ctx.beginPath(); ctx.moveTo(x, y); ctx.strokeStyle = color; penDown = true;
            } else {
                ctx.lineTo(x, y);
                // Se a cor mudou (entrou/saiu do tom), termina o traço e começa outro
                if (i > 0) {
                   const prev = this.dataPoints[i-1];
                   if(prev) {
                       const prevColor = prev.inKey ? COLORS.accent : COLORS.danger;
                       
                       if (color !== prevColor) {
                           ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y); ctx.strokeStyle = color;
                       }
                   }
                }
            }
        }
        if (penDown) ctx.stroke();

        // --- 3. DESENHA O PLAYHEAD (BOLINHA BRANCA) ---
        if (this.totalDuration > 0 && !this.recording && this.playbackTime > 0) {
            const correctedTime = this.playbackTime + this.latencyOffset;
            const exactIndex = correctedTime / this.secondsPerPoint;
            
            const cx = (exactIndex * stepX) + this.offsetX;
            
            // Só desenha se estiver na tela
            if (cx > -20 && cx < w + 20) {
                const floorIndex = Math.floor(exactIndex);
                
                if (floorIndex >= 0 && floorIndex < totalPoints) {
                    const pt = this.dataPoints[floorIndex];
                    if (pt && pt.val > 0) {
                        const cy = this.mapMidiToY(pt.val);
                        
                        ctx.beginPath();
                        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
                        ctx.fillStyle = "#fff";
                        ctx.fill();
                        ctx.shadowColor = "#fff"; ctx.shadowBlur = 10;
                        ctx.stroke(); ctx.shadowBlur = 0;
                    }
                }
            }
        }
    }

    clear() { 
        this.dataPoints = []; 
        this.minMidi = 45; 
        this.maxMidi = 75; 
        this.playbackTime = 0;
        this.scaleX = 1.0;
        this.offsetX = 0;
    }

    // Zoom Fit: Ajusta o gráfico inteiro para caber na tela
    fitToScreen() {
        const totalPoints = this.dataPoints.length;
        if (totalPoints === 0) return;

        const screenWidth = this.canvas.width;
        this.scaleX = (screenWidth / (totalPoints * this.basePixelsPerFrame)) * 0.98;
        this.offsetX = 0; 
        this.updateScrollbarUI();
    }
}
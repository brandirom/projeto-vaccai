// js/lyrics.js
import { formatTime } from './utils.js';

// ============================================================================
// SERVIÇO DE API (BUSCA DE LETRAS)
// ============================================================================

export class LyricsService {
    constructor() {
        // Usa a API pública LRCLIB para buscar letras sincronizadas (.lrc)
        this.lyricsApiUrl = 'https://lrclib.net/api'; 
    }

    /**
     * Busca músicas por Nome e Artista.
     * Filtra apenas resultados que tenham letra (sincronizada ou texto puro).
     */
    async searchTracks(trackName, artistName) {
        try {
            const query = `${trackName} ${artistName}`.trim();
            if (!query) return [];

            const url = `${this.lyricsApiUrl}/search?q=${encodeURIComponent(query)}`;
            const response = await fetch(url);
            
            if (response.ok) {
                const results = await response.json();
                // Retorna apenas se tiver letra utilizável
                return Array.isArray(results) ? results.filter(r => r.syncedLyrics || r.plainLyrics) : [];
            }
            return [];
        } catch (error) {
            console.error('Erro Lyrics Search:', error);
            return [];
        }
    }
}

// ============================================================================
// INTERFACE DE USUÁRIO E SINCRONIA
// ============================================================================

export class LyricsUI {
    constructor(audioElement) {
        // --- REFERÊNCIAS DE ÁUDIO ---
        // Precisamos saber o estado dos players para sincronizar a letra
        this.audioPlayer = document.getElementById('audioPlayer'); // Player da voz gravada
        this.backingAudio = document.getElementById('backingAudio'); // Player da música de fundo

        this.service = new LyricsService();
        
        // --- ELEMENTOS DO DOM ---
        this.container = document.getElementById('lyrics-scroll'); 
        this.panelSearch = document.getElementById('lyrics-search-panel');
        this.inputTrack = document.getElementById('searchTrackName');
        this.inputArtist = document.getElementById('searchArtistName');
        this.resultsContainer = document.getElementById('searchResults');
        
        // Botões
        this.btnToggle = document.getElementById('btnToggleSearch');
        this.btnClose = document.getElementById('btnCloseSearch');
        this.btnDoSearch = document.getElementById('btnDoSearch');

        // Controles de Sync
        this.inputStart = document.getElementById('lyricsStartTime'); // Ajuste fino manual
        this.inputBackingStart = document.getElementById('backingStart'); // Onde a música de fundo começa
        this.chkSync = document.getElementById('chkLyricsSync'); // Checkbox "Sincronizar"
        
        // --- ESTADO INTERNO ---
        this.currentLyrics = null; // Array de objetos {time, text}
        this.syncInterval = null;  // O timer do loop de atualização
        
        this.isRunning = false; 
        this.manualTimestampStart = 0; 
        this.manualOffset = 0;

        this.setupEvents();
    }

    setupEvents() {
        // Abrir/Fechar painel de busca
        this.btnToggle.addEventListener('click', () => { this.panelSearch.classList.add('open'); this.inputTrack.focus(); });
        this.btnClose.addEventListener('click', () => { this.panelSearch.classList.remove('open'); });

        // Gatilhos de busca (Botão ou Enter)
        this.btnDoSearch.addEventListener('click', () => this.runManualSearch());
        const handleEnter = (e) => { if(e.key === 'Enter') this.runManualSearch(); };
        this.inputTrack.addEventListener('keypress', handleEnter);
        this.inputArtist.addEventListener('keypress', handleEnter);

        // Se "Sincronizar" estiver marcado, desabilita o ajuste manual de tempo
        this.chkSync.addEventListener('change', () => {
            this.inputStart.disabled = this.chkSync.checked;
        });
    }

    // Preenche automaticamente os campos de busca (chamado quando o usuário carrega um arquivo)
    setMetadataSuggestion(title, artist) {
        this.inputTrack.value = title || "";
        this.inputArtist.value = artist || "";
    }

    // Executa a busca na API
    async runManualSearch() {
        const track = this.inputTrack.value;
        const artist = this.inputArtist.value;
        this.resultsContainer.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">Pesquisando...</div>';
        const results = await this.service.searchTracks(track, artist);
        this.renderResults(results);
    }

    // Renderiza a lista de músicas encontradas
    renderResults(results) {
        this.resultsContainer.innerHTML = '';
        if (!results || results.length === 0) {
            this.resultsContainer.innerHTML = '<div style="padding:20px; text-align:center; color:#e96379;">Nenhum resultado encontrado.</div>';
            return;
        }

        results.forEach(item => {
            const el = document.createElement('div');
            el.className = 'result-item';
            const durationStr = formatTime(item.duration);
            el.innerHTML = `
                <div class="result-title">${item.trackName}</div>
                <div class="result-info">
                    <span>${item.artistName} • ${item.albumName || 'Single'}</span>
                    <span style="color:var(--primary)">${durationStr}</span>
                </div>
            `;
            el.addEventListener('click', () => this.selectTrack(item));
            this.resultsContainer.appendChild(el);
        });
    }

    // Escolhe uma música e processa a letra (.lrc)
    selectTrack(data) {
        if (data.syncedLyrics) {
            this.currentLyrics = this._parseLRC(data.syncedLyrics);
            this.container.innerHTML = `<div style="margin-top:20px; color:#444;">Letra Sincronizada Carregada:<br><b style="color:#fff">${data.trackName}</b></div>`;
        } else if (data.plainLyrics) {
            this.currentLyrics = null;
            this.container.innerHTML = `
                <div style="color:#fff; margin-bottom:10px;"><b>${data.trackName}</b></div>
                <div style="text-align:left; white-space: pre-wrap; padding:10px;">${data.plainLyrics}</div>
            `;
        }
        this.panelSearch.classList.remove('open');
    }

    // Parser simples de formato LRC: [mm:ss.xx] Texto
    _parseLRC(lrcString) {
        const lines = lrcString.split('\n');
        const result = [];
        const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
        lines.forEach(line => {
            const match = timeRegex.exec(line);
            if (match) {
                const min = parseInt(match[1]);
                const sec = parseInt(match[2]);
                const ms = parseInt(match[3]);
                const time = min * 60 + sec + (ms / 100);
                const text = line.replace(timeRegex, '').trim();
                result.push({ time, text });
            }
        });
        return result;
    }

    // --- MOTOR DE SINCRONIA ---

    // Inicia o loop de atualização da letra (chamado no Play ou Gravar)
    startTimer() {
        this.isRunning = true;
        this.manualOffset = parseFloat(this.inputStart.value) || 0;
        this.manualTimestampStart = performance.now();
        this._startLoop();
    }

    stopTimer() {
        this.isRunning = false;
        // Nota: Não limpamos o intervalo aqui para permitir que o "Seek" (clique no gráfico)
        // atualize a letra mesmo pausado, se necessário.
    }

    // O coração da sincronização
    _startLoop() {
        if (this.syncInterval) clearInterval(this.syncInterval);
        
        this.syncInterval = setInterval(() => {
            if (!this.currentLyrics) return;

            let currentTime = 0;
            const isSyncedMode = this.chkSync.checked;

            if (isSyncedMode) {
                // --- LÓGICA DE PRIORIDADE DE RELÓGIO ---
                
                // 1. MÚSICA DE FUNDO (Backing Track)
                // Se existe e está tocando, ela é o mestre do tempo.
                if (this.backingAudio && !this.backingAudio.paused && this.backingAudio.duration > 0) {
                    currentTime = this.backingAudio.currentTime;
                }
                
                // 2. PLAYER DE VOZ (Revisão)
                // Se estamos ouvindo a gravação, usamos o tempo dela + o deslocamento de início configurado.
                else if (this.audioPlayer && !this.audioPlayer.paused) {
                    const songStartOffset = parseFloat(this.inputBackingStart.value) || 0;
                    currentTime = this.audioPlayer.currentTime + songStartOffset;
                }
                
                // Se nada toca e não estamos gravando, sai.
                else if (!this.isRunning) {
                    return;
                }
                
                // 3. FALLBACK: Gravação Acapella
                // Se estamos gravando sem música de fundo, usa o relógio do sistema.
                else if (this.isRunning) {
                     const now = performance.now();
                     const delta = (now - this.manualTimestampStart) / 1000;
                     currentTime = this.manualOffset + delta;
                }

            } else {
                // --- MODO MANUAL (Dessincronizado) ---
                // O usuário define manualmente onde a letra começa. Útil para ensaios específicos.
                if (this.isRunning) {
                    const now = performance.now();
                    const delta = (now - this.manualTimestampStart) / 1000;
                    currentTime = this.manualOffset + delta;
                } else {
                    return;
                }
            }

            // --- RENDERIZAÇÃO ---
            // Encontra qual linha deve ser mostrada agora
            const idx = this.currentLyrics.findIndex((line, i) => {
                const next = this.currentLyrics[i + 1];
                return currentTime >= line.time && (!next || currentTime < next.time);
            });

            if (idx !== -1) {
                const prev = this.currentLyrics[idx - 1]?.text || "";
                const curr = this.currentLyrics[idx]?.text || "...";
                const next = this.currentLyrics[idx + 1]?.text || "";

                // Atualiza o HTML (Linha anterior apagada, Atual destacada, Próxima apagada)
                this.container.innerHTML = `
                    <div style="height:40%; display:flex; flex-direction:column; justify-content:flex-end; padding-bottom:10px;">
                        <div class="lyric-line" style="opacity:0.5">${prev}</div>
                    </div>
                    <div class="lyric-line active" style="font-size:1.2rem; color:var(--primary);">${curr}</div>
                    <div style="height:40%; padding-top:10px;">
                        <div class="lyric-line" style="opacity:0.5">${next}</div>
                    </div>
                `;
            }
        }, 100); // Atualiza a cada 100ms (10fps é suficiente para texto)
    }
}
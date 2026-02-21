// js/audio-manager.js

// ============================================================================
// GERENCIADOR DE ÁUDIO (A PONTE JS <-> WASM)
// ============================================================================

export class AudioManager {
    constructor(bufferSize = 2048) {
        this.bufferSize = bufferSize; // Tamanho do "pacote" de áudio (2048 amostras ~ 46ms)
        this.audioContext = null;     // O contexto de áudio do navegador
        this.dspEngine = null;        // A instância da classe C++ (DSPEngine)
        this.wasmModule = null;       // O módulo WASM carregado
        this.inputBufferPtr = null;   // Ponteiro para a memória compartilhada (Heap)
        
        // Elementos do Grafo de Áudio
        this.stream = null;
        this.source = null;
        this.processor = null;
        
        // Gravação do Arquivo (para download/revisão)
        this.mediaRecorder = null;
        this.audioChunks = [];
        
        // Callback: Função que recebe o resultado da análise (do main.js)
        this.onAnalysisResult = null; 
    }

    // Inicializa o contexto de áudio (deve ser chamado após interação do usuário)
    async init(wasmModule) {
        this.wasmModule = wasmModule;
        // Cria o contexto forçando 44.1kHz para consistência com o backend
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    }

    // Lista os microfones disponíveis no computador/celular
    async getDevices() {
        if (!navigator.mediaDevices?.enumerateDevices) return [];
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter(device => device.kind === 'audioinput');
    }

    /**
     * Inicia a captura e o processamento.
     * @param {string} deviceId - ID do microfone escolhido (ou vazio para padrão).
     * @param {boolean} shouldRecord - Se deve salvar o áudio para download depois.
     */
    async start(deviceId, shouldRecord = false) {
        // Garante que o áudio não está suspenso (comum em navegadores modernos)
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        // Instancia o Motor C++ se ainda não existir
        if (!this.dspEngine) {
            this.dspEngine = new this.wasmModule.DSPEngine(this.audioContext.sampleRate, this.bufferSize);
            // Aloca memória no "Lado C++" para receber o áudio
            this.inputBufferPtr = this.wasmModule._malloc(this.bufferSize * 4); // 4 bytes por float
        }

        // --- CONFIGURAÇÃO DE HARDWARE ---
        // AutoGain: Ligado para ajudar microfones de notebook que captam muito baixo.
        // EchoCancellation: Desligado pois queremos o som puro (raw) para análise musical.
        const constraints = {
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                echoCancellation: false, 
                autoGainControl: true,  
                noiseSuppression: false, 
                latency: 0
            }
        };

        this.stream = await navigator.mediaDevices.getUserMedia(constraints);

        // Configura o gravador de arquivo (para o usuário ouvir depois)
        if (shouldRecord) {
            this.mediaRecorder = new MediaRecorder(this.stream);
            this.audioChunks = [];
            this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
            this.mediaRecorder.start();
        }

        // Monta o Grafo de Processamento:
        // Microfone -> Processador (Script) -> Saída (Mudo, necessário para o navegador rodar)
        this.source = this.audioContext.createMediaStreamSource(this.stream);
        this.processor = this.audioContext.createScriptProcessor(this.bufferSize, 1, 1);
        
        // A cada ~46ms, essa função é chamada com novo áudio
        this.processor.onaudioprocess = (e) => this.process(e);
        
        this.source.connect(this.processor);
        this.processor.connect(this.audioContext.destination);
    }

    // O "Loop" de processamento em tempo real
    process(e) {
        if (!this.onAnalysisResult) return;
        
        // 1. Pega os dados crus do JS (Float32Array)
        const inputData = e.inputBuffer.getChannelData(0);
        
        // 2. Copia para a memória do WebAssembly (Heap)
        // O deslocamento (>> 2) é porque HEAPF32 usa índices de float (4 bytes), não bytes puros.
        this.wasmModule.HEAPF32.set(inputData, this.inputBufferPtr >> 2);
        
        // 3. Roda o motor C++ e recebe a struct de resultado
        const result = this.dspEngine.process(this.inputBufferPtr);
        
        // 4. Devolve para a UI
        this.onAnalysisResult(result);
    }

    // Para tudo, limpa memória e gera o arquivo de áudio final
    async stop() {
        // Desconecta os nós de áudio
        if (this.processor) { this.processor.disconnect(); this.processor = null; }
        if (this.source) { this.source.disconnect(); this.source = null; }
        
        let audioUrl = null;

        // Finaliza a gravação do arquivo .webm
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            audioUrl = await new Promise(resolve => {
                this.mediaRecorder.onstop = () => {
                    const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                    const url = URL.createObjectURL(blob);
                    resolve(url);
                };
                this.mediaRecorder.stop();
            });
            this.mediaRecorder = null;
        }

        // Desliga o led da câmera/microfone
        if (this.stream) { 
            this.stream.getTracks().forEach(t => t.stop()); 
            this.stream = null; 
        }

        return audioUrl;
    }
}
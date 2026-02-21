// js/utils.js

// ============================================================================
// CONSTANTES GLOBAIS
// ============================================================================

// Nomes das 12 notas da escala cromática ocidental
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Paleta de cores centralizada (Tema Vaccai)
// Se precisar mudar a cor do site, muda-se aqui e reflete em tudo (Canvas, Textos, etc).
export const COLORS = {
    primary: "#8257e5", // Roxo principal
    accent: "#04d361",  // Verde (Sucesso/Afinação correta)
    danger: "#e96379",  // Vermelho (Erro/Desafinação)
    warning: "#fba94c", // Laranja (Alerta)
    textSec: "#a8a8b3", // Cinza texto secundário
    surface: "#202024"  // Fundo de painéis
};

// ============================================================================
// FUNÇÕES DE FORMATAÇÃO MUSICAL
// ============================================================================

/**
 * Converte um número MIDI para notação textual.
 * Exemplo: 60 -> "C4" (Dó Central)
 * @param {number} midi - O número da nota MIDI (com ou sem decimais).
 */
export function midiToNote(midi) {
    if (midi <= 0) return "--";
    const noteIndex = Math.round(midi) % 12;
    const octave = Math.floor(Math.round(midi) / 12) - 1;
    return NOTE_NAMES[noteIndex] + octave;
}

/**
 * Formata segundos em string de tempo "MM:SS".
 * Útil para os players de áudio e cronômetros.
 * Exemplo: 75 -> "1:15"
 */
export function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

// ============================================================================
// UTILITÁRIOS MATEMÁTICOS
// ============================================================================

/**
 * Mapeia um valor de uma escala para outra (Regra de 3).
 * Usado para converter erro de afinação em posição no canvas, etc.
 * Ex: mapRange(0.5, 0, 1, 0, 100) -> 50
 */
export function mapRange(value, inMin, inMax, outMin, outMax) {
    return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

/**
 * Restringe um valor entre um mínimo e um máximo.
 * Impede que agulhas ou gráficos desenhem fora da tela.
 */
export function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
}
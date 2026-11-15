import type { HistoryEntry } from '../types/constellation';

export interface HistoryViewEntry {
  /** Posição na lista original (para editar/apagar a entrada certa). */
  index: number;
  date: string;
  /** Linha pequena sob a data: o Aspecto a que a entrada se refere. */
  aspect: string;
  /** Texto principal: o capítulo, ou "Desbloqueou X" nos registros automáticos. */
  title: string;
  /** Registro automático ainda sem título de capítulo (aparece em itálico, com convite a nomear). */
  untitled: boolean;
}

/**
 * Entradas da Linha do Tempo prontas para exibir, da mais recente para a
 * mais antiga. `nameOf` resolve o nome atual do Aspecto; para um Aspecto já
 * removido, o Editor cai no nome guardado na própria entrada.
 */
export function buildHistoryView(history: HistoryEntry[], nameOf: (nodeId: string) => string): HistoryViewEntry[] {
  return history
    .map((entry, index) => {
      const aspect = (entry.nodeId ? nameOf(entry.nodeId) : '') || entry.nodeName || '';
      const automatic = entry.kind === 'unlock';
      const title = entry.chapterTitle || (automatic ? `Desbloqueou ${aspect || 'um Aspecto'}` : '');
      return {
        index,
        date: entry.date,
        aspect: entry.chapterTitle || !automatic ? aspect : '',
        title,
        untitled: automatic && !entry.chapterTitle,
      };
    })
    .reverse();
}

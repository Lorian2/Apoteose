import type { HistoryEntry } from '../types/constellation';

/**
 * Mantém o registro cronológico da lenda do personagem (GDD, seção 12).
 * Pequeno de propósito: é o lugar natural para a ordenação, a edição e o
 * desfazer do registro automático, sem mexer no ConstellationService.
 */
export class HistoryService {
  appendEntry(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
    return [...history, entry];
  }

  /** Desfazer um desbloqueio apaga o registro automático mais recente dele. */
  removeLatestUnlock(history: HistoryEntry[], nodeId: string): HistoryEntry[] {
    const index = history.map((entry) => entry.kind === 'unlock' && entry.nodeId === nodeId).lastIndexOf(true);
    return index < 0 ? history : history.filter((_entry, position) => position !== index);
  }

  updateEntry(
    history: HistoryEntry[],
    index: number,
    changes: Partial<Pick<HistoryEntry, 'chapterTitle' | 'date'>>,
  ): HistoryEntry[] {
    return history.map((entry, position) => (position === index ? { ...entry, ...changes } : entry));
  }
}
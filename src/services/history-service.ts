import type { HistoryEntry } from '../types/constellation';

/**
 * Mantém o registro cronológico da lenda do personagem (GDD, seção 12).
 * Deliberadamente pequeno hoje — o lugar natural para crescer (ordenação,
 * validação de datas, etc.) sem mexer no ConstellationService.
 */
export class HistoryService {
  appendEntry(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
    return [...history, entry];
  }
}

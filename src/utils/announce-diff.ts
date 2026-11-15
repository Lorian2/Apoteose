import type { PlayerVisibleNode } from '../types/constellation';

/** Foto mínima de uma constelação: o que cada Aspecto visível já era (ID → desbloqueado?). */
export type NodeSnapshot = Map<string, boolean>;

export function snapshotNodes(nodes: PlayerVisibleNode[]): NodeSnapshot {
  return new Map(nodes.map((node) => [node.id, node.unlocked]));
}

export interface AnnouncementEvents {
  /** Aspectos que acabaram de ser desbloqueados. */
  unlocked: PlayerVisibleNode[];
  /** Estrelas que acabaram de surgir no céu (reveladas, ainda não desbloqueadas). */
  revealed: PlayerVisibleNode[];
}

/**
 * O que mudou para o jogador entre duas versões do Estado do Jogador.
 * Um Aspecto que surge já desbloqueado conta só como desbloqueado: o
 * jogador não precisa de dois avisos pela mesma estrela.
 */
export function diffNodes(before: NodeSnapshot, after: PlayerVisibleNode[]): AnnouncementEvents {
  const events: AnnouncementEvents = { unlocked: [], revealed: [] };
  for (const node of after) {
    const wasUnlocked = before.get(node.id);
    if (node.unlocked && !wasUnlocked) events.unlocked.push(node);
    else if (wasUnlocked === undefined) events.revealed.push(node);
  }
  return events;
}

import type { PathConnection } from '../types/constellation';

interface NodeLike {
  id: string;
  unlocked: boolean;
}

/**
 * Trava de compra em cadeia: calcula quais nós ainda não podem ser
 * desbloqueados porque nenhum Aspecto de ORIGEM (um caminho que chega até
 * ele) foi desbloqueado ainda. Basta UM caminho de origem já comprado pra
 * liberar — ramos alternativos (dois caminhos partindo do mesmo Aspecto)
 * continuam livres entre si, sem exigir os dois.
 *
 * Um nó sem nenhum caminho de CHEGADA (`toNodeId === node.id`) nunca é
 * travado por esta regra — cobre o nó inicial (sempre `unlocked` desde a
 * criação, então nem entra no loop) e qualquer Aspecto solto sem
 * pré-requisito modelado no grafo.
 *
 * Independente de `computeBlockedNodeIds` (exclusão mútua, permanente) —
 * esta trava é temporária: assim que uma origem for comprada, o nó libera.
 */
export function computePrerequisiteLockedNodeIds(nodes: NodeLike[], connections: PathConnection[]): Set<string> {
  const unlockedIds = new Set(nodes.filter((node) => node.unlocked).map((node) => node.id));
  const locked = new Set<string>();

  for (const node of nodes) {
    if (node.unlocked) {
      continue;
    }

    const incoming = connections.filter((connection) => connection.toNodeId === node.id);
    if (incoming.length === 0) {
      continue;
    }

    const hasUnlockedOrigin = incoming.some((connection) => unlockedIds.has(connection.fromNodeId));
    if (!hasUnlockedOrigin) {
      locked.add(node.id);
    }
  }

  return locked;
}

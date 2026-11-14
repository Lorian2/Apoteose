import type { PathConnection } from '../types/constellation';

interface NodeLike {
  id: string;
  unlocked: boolean;
}

/**
 * Calcula quais nós ficaram permanentemente inalcançáveis por exclusão
 * mútua (Banco de Dados, seção 5): um nó é "bloqueado" quando TODOS os
 * caminhos que chegam até ele (onde ele é origem ou destino) já fecharam
 * — ou seja, cada um desses caminhos tem pelo menos um nó em
 * `excludedByNodeIds` que já foi desbloqueado. Um nó sem nenhum caminho
 * incidente nunca é bloqueado por esta regra (ex.: o nó inicial da
 * constelação).
 *
 * Compartilhado entre o Editor (pra mostrar a estrela cinza em tempo real
 * pro Mestre) e o Observatório (pra remover o botão de compra do
 * jogador), além de servir de validação final no `ConstellationService`
 * antes de gravar um desbloqueio.
 */
export function computeBlockedNodeIds(nodes: NodeLike[], connections: PathConnection[]): Set<string> {
  const unlockedIds = new Set(nodes.filter((node) => node.unlocked).map((node) => node.id));
  const blocked = new Set<string>();

  for (const node of nodes) {
    if (node.unlocked) {
      continue; // já conquistado — exclusão não importa mais pra ele
    }

    const incidentConnections = connections.filter(
      (connection) => connection.fromNodeId === node.id || connection.toNodeId === node.id,
    );
    if (incidentConnections.length === 0) {
      continue; // sem caminhos, não há como bloquear (ex.: nó inicial)
    }

    const allClosed = incidentConnections.every((connection) =>
      (connection.excludedByNodeIds ?? []).some((excluderId) => unlockedIds.has(excluderId)),
    );
    if (allClosed) {
      blocked.add(node.id);
    }
  }

  return blocked;
}

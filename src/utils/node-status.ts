import type { ExclusionPair, NodeStatus, PathConnection } from '../types/constellation';

interface NodeLike {
  id: string;
  unlocked: boolean;
}

/**
 * Situação de cada Aspecto (ver `NodeStatus`). Regras:
 *
 * 1. Desbloqueado vence tudo.
 * 2. Exclusão mútua: se o par de um Aspecto já foi desbloqueado, ele fecha.
 * 3. Ramo morto: um Aspecto cujos caminhos de chegada vêm TODOS de Aspectos
 *    fechados também fecha (propaga até estabilizar). Assim o ramo inteiro
 *    atrás de uma escolha rival aparece fechado, não "aguardando".
 * 4. Pré-requisito: com caminhos de chegada, basta UMA origem desbloqueada.
 *    Sem caminho de chegada (nó solto ou inicial), está disponível.
 *
 * Usada pelo serviço (validação do desbloqueio), pelo Editor (cores no
 * canvas) e pelo repositório, que grava o resultado no Estado do Jogador:
 * o jogador recebe a situação pronta e nunca vê as exclusões nem os nós
 * ocultos que a determinaram.
 */
export function computeNodeStatuses(
  nodes: NodeLike[],
  connections: PathConnection[],
  exclusions: ExclusionPair[] = [],
): Map<string, NodeStatus> {
  const unlocked = new Set(nodes.filter((node) => node.unlocked).map((node) => node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));

  const incoming = new Map<string, string[]>();
  for (const connection of connections) {
    if (!nodeIds.has(connection.fromNodeId) || !nodeIds.has(connection.toNodeId)) {
      continue;
    }
    const list = incoming.get(connection.toNodeId);
    if (list) {
      list.push(connection.fromNodeId);
    } else {
      incoming.set(connection.toNodeId, [connection.fromNodeId]);
    }
  }

  const excluded = new Set<string>();
  for (const { a, b } of exclusions) {
    if (unlocked.has(a) && !unlocked.has(b)) excluded.add(b);
    if (unlocked.has(b) && !unlocked.has(a)) excluded.add(a);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (unlocked.has(node.id) || excluded.has(node.id)) continue;
      const origins = incoming.get(node.id);
      if (origins?.length && origins.every((originId) => excluded.has(originId))) {
        excluded.add(node.id);
        changed = true;
      }
    }
  }

  const statuses = new Map<string, NodeStatus>();
  for (const node of nodes) {
    if (unlocked.has(node.id)) {
      statuses.set(node.id, 'unlocked');
    } else if (excluded.has(node.id)) {
      statuses.set(node.id, 'excluded');
    } else {
      const origins = incoming.get(node.id);
      const ready = !origins?.length || origins.some((originId) => unlocked.has(originId));
      statuses.set(node.id, ready ? 'available' : 'prerequisite');
    }
  }
  return statuses;
}

/** IDs dos Aspectos em exclusão mútua com `nodeId`. */
export function exclusivePartners(nodeId: string, exclusions: ExclusionPair[]): string[] {
  const partners: string[] = [];
  for (const { a, b } of exclusions) {
    if (a === nodeId) partners.push(b);
    else if (b === nodeId) partners.push(a);
  }
  return partners;
}

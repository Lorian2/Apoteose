/**
 * Testes da lógica pura (sem Foundry): situação dos nós, migração de
 * schema, Estado do Jogador e a fila de escrita do serviço.
 * Rodar: npm test
 */
import assert from 'node:assert/strict';
import { computeNodeStatuses } from '../src/utils/node-status';
import { derivePlayerState, migrateDefinition } from '../src/data/constellation-repository';
import { ConstellationService } from '../src/services/constellation-service';
import { callModuleHook, onUntypedHook } from '../src/utils/hooks';
import { currentDateLabel, formatAethelgardDay } from '../src/utils/game-date';
import { buildHistoryView } from '../src/utils/history-view';
import { diffNodes, snapshotNodes } from '../src/utils/announce-diff';
import type { ConstellationRepository } from '../src/data/constellation-repository';
import type { PermissionGate } from '../src/services/permission-gate';
import type { AspectNode, ConstellationDefinition } from '../src/types/constellation';

let passed = 0;
const tests: [string, () => void | Promise<void>][] = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

function node(id: string, extra: Partial<AspectNode> = {}): AspectNode {
  return {
    id,
    name: id,
    media: {},
    rarityId: 'common',
    type: 'narrative',
    position: { x: 0, y: 0 },
    visibility: 'revealed',
    unlocked: false,
    ...extra,
  };
}

function link(from: string, to: string) {
  return { id: `${from}-${to}`, fromNodeId: from, toNodeId: to };
}

function definition(partial: Partial<ConstellationDefinition>): ConstellationDefinition {
  return {
    schemaVersion: 3,
    actorId: 'actor',
    initialNodeId: 'O',
    unspentPoints: 0,
    nodes: [],
    connections: [],
    exclusions: [],
    categories: [],
    rarities: [{ id: 'common', label: 'Comum', color: '#a896c1', order: 0 }],
    history: [],
    ...partial,
  };
}

// O → A, O → B, A → A2, B → B2, A2 → F, B2 → F ; A ⟂ B
const branching = () => ({
  nodes: [node('O', { unlocked: true }), node('A'), node('B'), node('A2'), node('B2'), node('F')],
  connections: [link('O', 'A'), link('O', 'B'), link('A', 'A2'), link('B', 'B2'), link('A2', 'F'), link('B2', 'F')],
  exclusions: [{ a: 'A', b: 'B' }],
});

test('nó com origem desbloqueada está disponível; sem origem, aguarda', () => {
  const { nodes, connections, exclusions } = branching();
  const status = computeNodeStatuses(nodes, connections, exclusions);
  assert.equal(status.get('O'), 'unlocked');
  assert.equal(status.get('A'), 'available');
  assert.equal(status.get('B'), 'available');
  assert.equal(status.get('A2'), 'prerequisite');
  assert.equal(status.get('F'), 'prerequisite');
});

test('exclusão é simétrica e fecha o ramo inteiro do rival', () => {
  const { nodes, connections, exclusions } = branching();
  nodes.find((n) => n.id === 'B')!.unlocked = true;
  const status = computeNodeStatuses(nodes, connections, exclusions);
  assert.equal(status.get('A'), 'excluded', 'desbloquear B fecha A (sentido B → A)');
  assert.equal(status.get('A2'), 'excluded', 'A2 só é alcançável por A');
  assert.equal(status.get('B2'), 'available');
  assert.equal(status.get('F'), 'prerequisite', 'F continua alcançável por B2');
});

test('convergência: nó com uma origem viva não fecha', () => {
  const { nodes, connections, exclusions } = branching();
  nodes.find((n) => n.id === 'A')!.unlocked = true;
  const status = computeNodeStatuses(nodes, connections, exclusions);
  assert.equal(status.get('B'), 'excluded');
  assert.equal(status.get('B2'), 'excluded');
  assert.equal(status.get('F'), 'prerequisite');
});

test('caminho novo até um nó excluído não o reabre (bug da 0.1.0)', () => {
  const { nodes, connections, exclusions } = branching();
  nodes.find((n) => n.id === 'B')!.unlocked = true;
  connections.push(link('O', 'A2'));
  const status = computeNodeStatuses(nodes, connections, exclusions);
  assert.equal(status.get('A'), 'excluded');
  assert.equal(status.get('A2'), 'available', 'A2 agora tem uma origem viva própria');
});

test('ciclo sem entrada viva não trava o cálculo', () => {
  const nodes = [node('O', { unlocked: true }), node('X'), node('Y')];
  const connections = [link('X', 'Y'), link('Y', 'X')];
  const status = computeNodeStatuses(nodes, connections, []);
  assert.equal(status.get('X'), 'prerequisite');
  assert.equal(status.get('Y'), 'prerequisite');
});

test('migração v2 → v3 converte exclusões por caminho em pares', () => {
  // Como o painel antigo gravava "A exclui B": A em todos os caminhos que tocam B.
  const v2 = {
    ...definition({}),
    schemaVersion: 2,
    nodes: [node('O', { unlocked: true }), node('A'), node('B'), node('B2')],
    connections: [
      { ...link('O', 'A'), excludedByNodeIds: [] },
      { ...link('O', 'B'), excludedByNodeIds: ['A'] },
      { ...link('B', 'B2'), excludedByNodeIds: ['A'] },
    ],
  } as unknown as ConstellationDefinition;
  delete (v2 as Partial<ConstellationDefinition>).exclusions;

  const v3 = migrateDefinition(v2);
  assert.equal(v3.schemaVersion, 3);
  assert.deepEqual(v3.exclusions, [{ a: 'A', b: 'B' }]);
  assert.ok(v3.connections.every((connection) => !('excludedByNodeIds' in connection)));
  assert.equal(migrateDefinition(v3), v3, 'documento atual volta com a mesma referência');
});

test('migração v1 → v3 em cadeia', () => {
  const v1 = { ...definition({ nodes: [node('O')] }), schemaVersion: 1 } as ConstellationDefinition;
  delete (v1 as Partial<ConstellationDefinition>).exclusions;
  const migrated = migrateDefinition(v1);
  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(migrated.exclusions, []);
});

test('Estado do Jogador: sem nós ocultos, sem exclusões, com situação calculada no todo', () => {
  const { nodes, connections, exclusions } = branching();
  nodes.find((n) => n.id === 'B')!.unlocked = true;
  nodes.find((n) => n.id === 'B')!.visibility = 'hidden';
  nodes.find((n) => n.id === 'A')!.gmNotes = 'segredo';
  const state = derivePlayerState(
    definition({ nodes, connections, exclusions, history: [{ date: 'x', nodeId: 'B', chapterTitle: 'Traição' }] }),
  );

  assert.ok(!state.nodes.some((n) => n.id === 'B'), 'B oculto não vai ao jogador');
  assert.equal(state.nodes.find((n) => n.id === 'A')!.status, 'excluded', 'situação usa o nó oculto');
  assert.ok(!('gmNotes' in state.nodes.find((n) => n.id === 'A')!));
  assert.ok(!('exclusions' in state));
  assert.ok(!state.connections.some((c) => c.fromNodeId === 'B' || c.toNodeId === 'B'));
  assert.equal(state.history[0].nodeId, '', 'histórico não entrega o ID de nó oculto');
});

test('serviço: escritas simultâneas não se perdem (fila por Ator)', async () => {
  let stored = definition({ nodes: [node('O', { unlocked: true })] });
  const repository = {
    async getMasterDefinition() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return structuredClone(stored);
    },
    async saveMasterDefinition(_actorId: string, next: ConstellationDefinition) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      stored = structuredClone(next);
    },
  } as unknown as ConstellationRepository;
  const gate = { assertGM() {} } as PermissionGate;
  const service = new ConstellationService(repository, gate);

  await Promise.all([
    service.grantPoint('actor'),
    service.createNode('actor', { x: 10.4, y: 20.6 }),
    service.grantPoint('actor'),
    service.updateNode('actor', 'O', { name: 'Origem' }),
  ]);
  assert.equal(stored.unspentPoints, 2);
  assert.equal(stored.nodes.length, 2);
  assert.deepEqual(stored.nodes[1].position, { x: 10, y: 21 });
  assert.equal(stored.nodes[0].name, 'Origem');
});

test('serviço: desbloqueio respeita exclusão, pré-requisito e pontos', async () => {
  const { nodes, connections, exclusions } = branching();
  let stored = definition({ nodes, connections, exclusions, unspentPoints: 1 });
  const repository = {
    async getMasterDefinition() {
      return structuredClone(stored);
    },
    async saveMasterDefinition(_actorId: string, next: ConstellationDefinition) {
      stored = structuredClone(next);
    },
  } as unknown as ConstellationRepository;
  const service = new ConstellationService(repository, { assertGM() {} } as PermissionGate);

  await assert.rejects(service.unlockNode('actor', 'A2'), { code: 'PREREQUISITE_NOT_MET' });
  await service.unlockNode('actor', 'B');
  assert.equal(stored.unspentPoints, 0);
  await service.grantPoint('actor');
  await assert.rejects(service.unlockNode('actor', 'A'), { code: 'NODE_EXCLUDED' });
  await service.unlockNode('actor', 'B2');
  await assert.rejects(service.unlockNode('actor', 'F'), { code: 'NO_POINTS_AVAILABLE' });
  await assert.rejects(service.removeNode('actor', 'O'), { code: 'INITIAL_NODE' });
  await assert.rejects(service.connectNodes('actor', 'B', 'O'), { code: 'INVALID_CONNECTION' });

  await service.removeNode('actor', 'A');
  assert.equal(stored.exclusions.length, 0, 'remover um nó leva as exclusões dele junto');
});

test('histórico: desbloquear registra sozinho, desfazer apaga, título é editável', async () => {
  const { nodes, connections, exclusions } = branching();
  let stored = definition({ nodes, connections, exclusions, unspentPoints: 2 });
  const repository = {
    async getMasterDefinition() {
      return structuredClone(stored);
    },
    async saveMasterDefinition(_actorId: string, next: ConstellationDefinition) {
      stored = structuredClone(next);
    },
  } as unknown as ConstellationRepository;
  const service = new ConstellationService(repository, { assertGM() {} } as PermissionGate);

  await service.unlockNode('actor', 'A');
  await service.unlockNode('actor', 'A2');
  assert.deepEqual(
    stored.history.map((entry) => [entry.kind, entry.nodeId, entry.nodeName]),
    [['unlock', 'A', 'A'], ['unlock', 'A2', 'A2']],
  );
  assert.ok(stored.history[0].date, 'a entrada leva uma data');

  await service.updateHistoryEntry('actor', 0, { chapterTitle: 'O Juramento' });
  assert.equal(stored.history[0].chapterTitle, 'O Juramento');
  assert.equal(stored.history[0].kind, 'unlock', 'editar o título mantém o tipo');

  await service.lockNode('actor', 'A2');
  assert.deepEqual(stored.history.map((entry) => entry.nodeId), ['A'], 'desfazer apaga só o registro de A2');
});

test('data do histórico: usa o calendário do Aethelgard quando disponível', () => {
  assert.equal(formatAethelgardDay({ day: 11, monthName: 'Novilúnio', year: 362 }), '11 Novilúnio, 362');
  assert.equal(formatAethelgardDay({ day: 11, monthName: 'Novilúnio', year: 362, era: 'EC' }), '11 Novilúnio, 362 EC');
  assert.equal(formatAethelgardDay({ intercalary: true, festival: 'Noite Longa', monthName: 'x', year: 362 }), 'Noite Longa, 362');
  // sem o módulo (ou com ele inativo) cai na data real
  assert.match(currentDateLabel(), /\d/);
  (globalThis as { game?: unknown }).game = {
    modules: new Map([['aethelgard-calendar', { active: true, api: { engine: { describe: () => ({ day: 3, monthName: 'Ventos', year: 7 }) } } }]]),
  };
  assert.equal(currentDateLabel(), '3 Ventos, 7');
  (globalThis as { game?: unknown }).game = {
    modules: new Map([['aethelgard-calendar', { active: true, api: { engine: { describe: () => { throw new Error('falha'); } } } }]]),
  };
  assert.match(currentDateLabel(), /\d/, 'uma falha no calendário nunca impede o registro');
  delete (globalThis as { game?: unknown }).game;
});

test('histórico do jogador: sem Aspecto oculto, sem nome guardado, título do Mestre preservado', () => {
  const { nodes, connections } = branching();
  nodes.find((n) => n.id === 'B')!.visibility = 'hidden';
  const state = derivePlayerState(
    definition({
      nodes,
      connections,
      history: [
        { date: 'd1', nodeId: 'A', nodeName: 'A', kind: 'unlock' },
        { date: 'd2', nodeId: 'B', nodeName: 'B', kind: 'unlock' },
        { date: 'd3', nodeId: 'B', nodeName: 'B', kind: 'unlock', chapterTitle: 'Pacto' },
        { date: 'd4', nodeId: '', chapterTitle: 'Manual' },
      ],
    }),
  );
  assert.deepEqual(
    state.history.map((entry) => [entry.date, entry.nodeId]),
    [['d1', 'A'], ['d3', ''], ['d4', '']],
    'o registro automático de um Aspecto oculto some; o que tem título perde o vínculo',
  );
  assert.ok(state.history.every((entry) => !('nodeName' in entry)));
  const view = buildHistoryView(definition({ history: [{ date: 'd', nodeId: 'X', nodeName: 'Removido', kind: 'unlock' }] }).history, () => '');
  assert.equal(view[0].title, 'Desbloqueou Removido', 'a Definição Mestra usa o nome guardado se o Aspecto sumiu');
  assert.equal(view[0].untitled, true);
});

test('aviso de conquista: só o que realmente mudou para o jogador', () => {
  const visible = (id: string, unlocked: boolean) =>
    ({ id, name: id, unlocked, media: {}, rarityId: 'common', type: 'narrative', position: { x: 0, y: 0 } }) as never;
  const before = snapshotNodes([visible('O', true), visible('A', false)]);

  // sem mudança → nada
  assert.deepEqual(diffNodes(before, [visible('O', true), visible('A', false)]), { unlocked: [], revealed: [] });

  const events = diffNodes(before, [visible('O', true), visible('A', true), visible('B', false), visible('C', true)]);
  assert.deepEqual(events.unlocked.map((n) => n.id), ['A', 'C'], 'A foi desbloqueado; C já surgiu desbloqueado');
  assert.deepEqual(events.revealed.map((n) => n.id), ['B'], 'B só surgiu; C não conta duas vezes');

  // desfazer um desbloqueio não avisa ninguém
  const undone = diffNodes(snapshotNodes([visible('A', true)]), [visible('A', false)]);
  assert.deepEqual(undone, { unlocked: [], revealed: [] });
});

test('hooks do módulo funcionam com o Hooks da V14 (sem chamada solta)', () => {
  const received: unknown[] = [];
  onUntypedHook('constelacaoApoteose.pointGranted', ((...args: unknown[]) => received.push(args)) as never);
  callModuleHook('constelacaoApoteose.pointGranted', 'ator', 2);
  assert.deepEqual(received, [['ator', 2]]);
});

for (const [name, fn] of tests) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}
console.log(`${passed}/${tests.length} testes passaram`);

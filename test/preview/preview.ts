/**
 * Pré-visualização do canvas fora do Foundry (npm run preview).
 * Usa uma constelação de exemplo em memória; os callbacks aplicam as
 * mudanças localmente e registram no log, para testar a interação.
 */
import { NebulaCanvas, type NebulaCanvasMode } from '../../src/rendering/nebula-canvas';
import { computeNodeStatuses } from '../../src/utils/node-status';
import type { AspectNode, ConstellationDefinition } from '../../src/types/constellation';

const rarities = [
  { id: 'common', label: 'Comum', color: '#a896c1', order: 0 },
  { id: 'rare', label: 'Raro', color: '#c9b6e4', order: 2 },
  { id: 'legendary', label: 'Lendário', color: '#e8d9a0', order: 4 },
];

const n = (id: string, name: string, x: number, y: number, extra: Partial<AspectNode> = {}): AspectNode => ({
  id, name, media: {}, rarityId: 'common', type: 'narrative', position: { x, y }, visibility: 'revealed', unlocked: false, ...extra,
});

const definition: ConstellationDefinition = {
  schemaVersion: 3, actorId: 'preview', initialNodeId: 'O', unspentPoints: 2,
  nodes: [
    n('O', 'Origem', 0, 0, { unlocked: true }),
    n('A', 'Juramento de Ferro', -160, -120, { rarityId: 'rare' }),
    n('B', 'Pacto com a Sombra', 160, -120, { rarityId: 'rare' }),
    n('A2', 'Escudo do Bastião', -220, -260),
    n('B2', 'Olhos do Abismo', 220, -260),
    n('F', 'O Último Bastião', 0, -380, { rarityId: 'legendary', type: 'final' }),
    n('S', 'Segredo do Mestre', 320, 40, { visibility: 'hidden' }),
  ],
  connections: [
    { id: 'c1', fromNodeId: 'O', toNodeId: 'A' },
    { id: 'c2', fromNodeId: 'O', toNodeId: 'B' },
    { id: 'c3', fromNodeId: 'A', toNodeId: 'A2' },
    { id: 'c4', fromNodeId: 'B', toNodeId: 'B2' },
    { id: 'c5', fromNodeId: 'A2', toNodeId: 'F' },
    { id: 'c6', fromNodeId: 'B2', toNodeId: 'F' },
  ],
  exclusions: [{ a: 'A', b: 'B' }],
  categories: [], rarities, history: [],
};

const log = (message: string) => {
  const element = document.getElementById('log')!;
  element.textContent = `${message}\n${element.textContent}`.slice(0, 4000);
};

let canvas: NebulaCanvas;
const draw = () => {
  const statuses = computeNodeStatuses(definition.nodes, definition.connections, definition.exclusions);
  canvas.render(
    definition.nodes.map((node) => ({
      id: node.id, name: node.name, position: node.position, color: node.color, icon: node.media.icon,
      rarityId: node.rarityId, revealed: node.visibility === 'revealed', status: statuses.get(node.id)!,
    })),
    definition.connections, rarities, definition.exclusions,
  );
};

let selected: string | null = null;
canvas = new NebulaCanvas(document.getElementById('canvas')!, {
  onNodeSelected: (id) => { selected = id; log(`selecionado: ${id}`); },
  onConnectionSelected: (id) => log(`caminho selecionado: ${id}`),
  onNodeMoved: (id, position) => {
    definition.nodes.find((node) => node.id === id)!.position = position;
    log(`movido: ${id} → ${Math.round(position.x)}, ${Math.round(position.y)}`); draw();
  },
  onConnectionRequested: (from, to) => {
    definition.connections.push({ id: `c${Date.now()}`, fromNodeId: from, toNodeId: to });
    log(`caminho: ${from} → ${to}`); draw();
  },
  onCreateRequested: (position) => {
    const id = `N${Date.now() % 10000}`;
    definition.nodes.push(n(id, 'Novo Aspecto', Math.round(position.x), Math.round(position.y)));
    log(`criado: ${id}`); draw();
  },
  onNodeRemoveRequested: (id) => {
    definition.nodes = definition.nodes.filter((node) => node.id !== id);
    definition.connections = definition.connections.filter((c) => c.fromNodeId !== id && c.toNodeId !== id);
    log(`removido: ${id}`); draw();
  },
  onConnectionRemoveRequested: (id) => {
    definition.connections = definition.connections.filter((c) => c.id !== id);
    log(`caminho removido: ${id}`); draw();
  },
}, { editable: true });
draw();

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) =>
  button.addEventListener('click', () => { canvas.setMode(button.dataset.mode as NebulaCanvasMode); log(`modo: ${button.dataset.mode}`); }),
);
document.getElementById('unlock')!.addEventListener('click', () => {
  const node = definition.nodes.find((candidate) => candidate.id === selected);
  if (node) { node.unlocked = !node.unlocked; log(`${node.unlocked ? 'desbloqueado' : 'bloqueado'}: ${node.id}`); draw(); }
});
document.getElementById('reveal')!.addEventListener('click', () => {
  const node = definition.nodes.find((candidate) => candidate.id === selected);
  if (node) { node.visibility = node.visibility === 'revealed' ? 'hidden' : 'revealed'; draw(); }
});
document.getElementById('fit')!.addEventListener('click', () => canvas.fitView());

(window as unknown as { preview: unknown }).preview = { canvas, definition, draw };

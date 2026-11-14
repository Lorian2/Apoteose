import type { PathConnection, Position, RarityTier } from '../types/constellation';
import { CameraController } from './camera-controller';
import { PathLine } from './path-line';
import { StarNode } from './star-node';
import { ParticleField } from './particle-field';

// Tamanho do ladrilho de fundo (Container#world, mesma unidade que a
// posição dos nós) — bem maior que qualquer área de pan/zoom razoável, pra
// dar a sensação de fundo infinito sem precisar recalcular posição do
// tiling a cada frame de câmera.
const BACKGROUND_TILE_EXTENT = 40000;

export interface RenderableNode {
  id: string;
  position: Position;
  color?: string;
  icon?: string;
  rarityId: string;
  revealed: boolean;
  unlocked: boolean;
  blocked?: boolean;
  prerequisiteLocked?: boolean;
}

export type NebulaCanvasMode = 'select' | 'connect' | 'create' | 'remove';

export interface NebulaCanvasCallbacks {
  onNodeSelected?: (nodeId: string | null) => void;
  onNodeMoved?: (nodeId: string, position: Position) => void;
  onConnectionRequested?: (fromNodeId: string, toNodeId: string) => void;
  onCreateRequested?: (position: Position) => void;
  onNodeRemoveRequested?: (nodeId: string) => void;
  onConnectionRemoveRequested?: (connectionId: string) => void;
}

/**
 * Container PIXI de topo (Arquitetura de Software, seção 3). Recebe um
 * modelo de visualização já pronto e emite eventos de interação para cima
 * via callbacks — nunca lê ou escreve dados por conta própria.
 */
export class NebulaCanvas {
  readonly #app: PIXI.Application;
  readonly #world: PIXI.Container;
  readonly #camera: CameraController;
  readonly #callbacks: NebulaCanvasCallbacks;
  readonly #resizeObserver: ResizeObserver;

  #stars = new Map<string, StarNode>();
  #lines = new Map<string, { connection: PathConnection; line: PathLine }>();
  #connectionsByNode = new Map<string, Set<string>>();
  #mode: NebulaCanvasMode = 'select';
  #selectedNodeId: string | null = null;
  #pendingConnectionSource: string | null = null;
  #draggingNodeId: string | null = null;
  #hasCenteredWorld = false;
  #lastCreatedConnectionId: string | null = null;
  #backgroundSprite: PIXI.TilingSprite | undefined;
  #backgroundPath: string | undefined;
  #particleField: ParticleField;

  constructor(container: HTMLElement, callbacks: NebulaCanvasCallbacks = {}) {
    this.#callbacks = callbacks;

    // Chute inicial razoável — a medida de verdade vem do primeiro callback
    // do ResizeObserver logo abaixo, depois que o grid CSS já se ajustou.
    const initialWidth = container.clientWidth || 640;
    const initialHeight = container.clientHeight || 480;

    this.#app = new PIXI.Application({
      width: initialWidth,
      height: initialHeight,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    container.appendChild(this.#app.view as HTMLCanvasElement);

    this.#world = new PIXI.Container();
    this.#app.stage.addChild(this.#world);

    this.#particleField = new ParticleField();
    this.#app.ticker.add(this.#onTick);

    this.#camera = new CameraController(this.#app.view as HTMLCanvasElement, this.#world);

    this.#app.stage.eventMode = 'static';
    this.#app.stage.hitArea = this.#app.screen;
    this.#app.stage.on('pointertap', this.#onStageTap);
    this.#app.stage.on('pointermove', this.#onStagePointerMove);
    this.#app.stage.on('pointerup', this.#onStagePointerUp);
    this.#app.stage.on('pointerupoutside', this.#onStagePointerUp);

    // O tamanho real do container só é confiável depois que o layout (grid
    // CSS de três colunas) termina de se resolver — medir de forma síncrona
    // no construtor pega, às vezes, um valor pequeno/errado. O
    // ResizeObserver corrige isso automaticamente, e também mantém o canvas
    // correto se a janela for redimensionada depois (ela é `resizable`).
    this.#resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) {
        return;
      }
      this.#app.renderer.resize(width, height);
      this.#app.stage.hitArea = this.#app.screen;
      if (!this.#hasCenteredWorld) {
        this.#world.x = width / 2;
        this.#world.y = height / 2;
        this.#hasCenteredWorld = true;
      }
    });
    this.#resizeObserver.observe(container);
  }

  setMode(mode: NebulaCanvasMode): void {
    this.#mode = mode;
    this.#pendingConnectionSource = null;
  }

  #onTick = (): void => {
    this.#particleField.update(this.#app.ticker.deltaMS);
  };

  /** Recentraliza a câmera e volta o zoom a 100% (botão "Recentralizar" da toolbar). */
  recenterView(): void {
    this.#camera.resetView(this.#app.screen.width, this.#app.screen.height);
  }

  render(nodes: RenderableNode[], connections: PathConnection[], rarities: RarityTier[]): void {
    // Limpa estrelas antigas
    for (const star of this.#stars.values()) {
      star.destroy();
    }

    // Limpa linhas antigas
    for (const entry of this.#lines.values()) {
      entry.line.destroy();
    }

    this.#world.removeChildren();
    this.#stars.clear();
    this.#lines.clear();
    this.#connectionsByNode.clear();

    // Poeira cósmica sempre atrás de conexões/estrelas — o fundo (se houver)
    // entra depois disso, via setBackground(), forçado pra posição 0 (mais
    // atrás ainda). O container em si nunca é recriado, só reencaixado aqui
    // a cada render() — a animação contínua dele não é afetada.
    this.#world.addChild(this.#particleField.container);

    const rarityColor = new Map(rarities.map((rarity) => [rarity.id, rarity.color]));
    const positionById = new Map(nodes.map((node) => [node.id, node.position]));

    for (const connection of connections) {
      const from = positionById.get(connection.fromNodeId);
      const to = positionById.get(connection.toNodeId);
      if (!from || !to) {
        continue;
      }

      // Só a conexão marcada como criada faz fade-in; todas as outras aparecem já visíveis
      const shouldAnimate = connection.id === this.#lastCreatedConnectionId;
      const hasExclusions = (connection.excludedByNodeIds?.length ?? 0) > 0;
      const line = new PathLine(from, to, !shouldAnimate, hasExclusions);

      line.graphics.eventMode = 'static';
      line.graphics.cursor = 'pointer';
      line.graphics.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation();
        this.#onLinePointerDown(connection.id);
      });
      this.#world.addChild(line.graphics);
      this.#lines.set(connection.id, { connection, line });

      this.#trackConnectionForNode(connection.fromNodeId, connection.id);
      this.#trackConnectionForNode(connection.toNodeId, connection.id);
    }

    // Limpa o flag depois de usar (só anima a linha uma vez)
    this.#lastCreatedConnectionId = null;

    for (const node of nodes) {
      const star = new StarNode(node.id, node.position, node.color ?? rarityColor.get(node.rarityId), node.icon);
      star.setRevealed(node.revealed);
      star.setUnlocked(node.unlocked);
      star.setBlocked(node.blocked ?? false);
      star.setPrerequisiteLocked(node.prerequisiteLocked ?? false);
      star.setSelected(node.id === this.#selectedNodeId);
      star.graphics.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation();
        this.#onStarPointerDown(node.id, star);
      });
      this.#world.addChild(star.graphics);
      this.#stars.set(node.id, star);
    }
  }

  /**
   * Imagem de fundo ladrilhada/infinita (GDD — imagem sem costura, repete
   * pelo canvas). Vive num TilingSprite bem grande, filho do próprio
   * `#world` — assim acompanha pan/zoom automaticamente, sem precisar
   * recalcular offset a cada frame. Só recria a textura quando o caminho
   * muda de verdade; `render()` chama `removeChildren()` a cada
   * atualização, então sempre reinserimos o sprite (já existente) na
   * posição 0 depois, sem recarregar nada.
   */
  setBackground(path: string | undefined): void {
    if (path === this.#backgroundPath) {
      if (this.#backgroundSprite && !this.#backgroundSprite.parent) {
        this.#world.addChildAt(this.#backgroundSprite, 0);
      }
      return;
    }

    this.#backgroundSprite?.destroy();
    this.#backgroundSprite = undefined;
    this.#backgroundPath = path;

    if (!path) {
      return;
    }

    const texture = PIXI.Texture.from(path);
    this.#backgroundSprite = new PIXI.TilingSprite(texture, BACKGROUND_TILE_EXTENT, BACKGROUND_TILE_EXTENT);
    this.#backgroundSprite.anchor.set(0.5);
    this.#backgroundSprite.eventMode = 'none'; // nunca rouba clique/drag do que está por cima
    this.#world.addChildAt(this.#backgroundSprite, 0);
  }

  destroy(): void {
    // Cancela animações de pulsação de todas as estrelas
    for (const star of this.#stars.values()) {
      star.destroy();
    }
    this.#app.ticker.remove(this.#onTick);
    this.#particleField.destroy();
    this.#resizeObserver.disconnect();
    this.#camera.destroy();
    this.#app.destroy(true, { children: true });
  }

  #trackConnectionForNode(nodeId: string, connectionId: string): void {
    const existing = this.#connectionsByNode.get(nodeId);
    if (existing) {
      existing.add(connectionId);
    } else {
      this.#connectionsByNode.set(nodeId, new Set([connectionId]));
    }
  }

  /** Redesenha toda linha que toca o nó informado, na posição atual dele. */
  #updateLinesForNode(nodeId: string): void {
    const connectionIds = this.#connectionsByNode.get(nodeId);
    if (!connectionIds) {
      return;
    }
    for (const connectionId of connectionIds) {
      const entry = this.#lines.get(connectionId);
      if (!entry) {
        continue;
      }
      const fromPosition = this.#stars.get(entry.connection.fromNodeId)?.position;
      const toPosition = this.#stars.get(entry.connection.toNodeId)?.position;
      if (fromPosition && toPosition) {
        entry.line.setEndpoints(fromPosition, toPosition);
      }
    }
  }

  #onStarPointerDown(nodeId: string, star: StarNode): void {
    if (this.#mode === 'remove') {
      this.#callbacks.onNodeRemoveRequested?.(nodeId);
      return;
    }

    if (this.#mode === 'connect') {
      if (!this.#pendingConnectionSource) {
        this.#pendingConnectionSource = nodeId;
        star.setSelected(true);
        return;
      }
      if (this.#pendingConnectionSource !== nodeId) {
        this.#callbacks.onConnectionRequested?.(this.#pendingConnectionSource, nodeId);
      }
      this.#stars.get(this.#pendingConnectionSource)?.setSelected(false);
      this.#pendingConnectionSource = null;
      return;
    }

    this.#selectNode(nodeId);
    this.#draggingNodeId = nodeId;
    this.#camera.setPanningEnabled(false);
  }

  #onLinePointerDown(connectionId: string): void {
    if (this.#mode === 'remove') {
      this.#callbacks.onConnectionRemoveRequested?.(connectionId);
    }
  }

  #onStageTap = (event: PIXI.FederatedPointerEvent): void => {
    if (event.target !== this.#app.stage) {
      return;
    }
    if (this.#mode === 'create') {
      const local = this.#world.toLocal(event.global);
      this.#callbacks.onCreateRequested?.({ x: local.x, y: local.y });
      return;
    }
    this.#selectNode(null);
  };

  #onStagePointerMove = (event: PIXI.FederatedPointerEvent): void => {
    if (!this.#draggingNodeId) {
      return;
    }
    const star = this.#stars.get(this.#draggingNodeId);
    if (!star) {
      return;
    }
    const local = this.#world.toLocal(event.global);
    star.setPosition({ x: local.x, y: local.y });
    this.#updateLinesForNode(this.#draggingNodeId);
  };

  #onStagePointerUp = (): void => {
    if (!this.#draggingNodeId) {
      return;
    }
    const star = this.#stars.get(this.#draggingNodeId);
    if (star) {
      this.#callbacks.onNodeMoved?.(this.#draggingNodeId, star.position);
    }
    this.#draggingNodeId = null;
    this.#camera.setPanningEnabled(true);
  };

  #selectNode(nodeId: string | null): void {
    if (this.#selectedNodeId) {
      this.#stars.get(this.#selectedNodeId)?.setSelected(false);
    }
    this.#selectedNodeId = nodeId;
    if (nodeId) {
      this.#stars.get(nodeId)?.setSelected(true);
    }
    this.#callbacks.onNodeSelected?.(nodeId);
  }

}

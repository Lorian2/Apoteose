import type { ExclusionPair, NodeStatus, PathConnection, Position, RarityTier } from '../types/constellation';
import { CameraController } from './camera-controller';
import { PathLine, type PathLineState } from './path-line';
import { NODE_RADIUS, StarNode } from './star-node';
import { ParticleField } from './particle-field';
import { SkyBackground } from './sky';

// Tamanho do ladrilho de fundo, na unidade do mundo — bem maior que
// qualquer área de pan/zoom razoável, para parecer infinito.
const BACKGROUND_TILE_EXTENT = 40000;
const DRAG_THRESHOLD_PX = 4;
const DOUBLE_TAP_MS = 350;

export interface RenderableNode {
  id: string;
  name: string;
  position: Position;
  color?: string;
  icon?: string;
  rarityId: string;
  revealed: boolean;
  status: NodeStatus;
}

export type NebulaCanvasMode = 'select' | 'connect' | 'create' | 'remove';

export interface NebulaCanvasCallbacks {
  onNodeSelected?: (nodeId: string | null) => void;
  onConnectionSelected?: (connectionId: string) => void;
  onNodeMoved?: (nodeId: string, position: Position) => void;
  onConnectionRequested?: (fromNodeId: string, toNodeId: string) => void;
  onCreateRequested?: (position: Position) => void;
  onNodeRemoveRequested?: (nodeId: string) => void;
  onConnectionRemoveRequested?: (connectionId: string) => void;
}

export interface NebulaCanvasOptions {
  /** Editor do Mestre: arrastar, criar, conectar e remover. Falso no Observatório. */
  editable: boolean;
  /** Movimento decorativo (cintilação, estrelas cadentes, fluxo). Padrão: ligado. */
  animated?: boolean;
}

const instances = new Set<NebulaCanvas>();

/** Aplica a configuração "Céu animado" a todo canvas aberto. */
export function setAllCanvasesAnimated(animated: boolean): void {
  for (const canvas of instances) canvas.setAnimated(animated);
}

/**
 * Container PIXI de topo. Recebe um modelo de visualização pronto e emite
 * eventos de interação via callbacks — nunca lê ou escreve dados.
 *
 * Camadas fixas (criadas uma vez): fundo → poeira → exclusões → caminhos →
 * estrelas → sobreposição (linha-prévia da conexão). `render()` só refaz
 * exclusões, caminhos e estrelas, destruindo os objetos antigos.
 *
 * Animações automáticas entre renderizações: estrela que não existia
 * surge (revelada/criada), estrela que passou a desbloqueada solta uma
 * onda de luz, caminho novo acende devagar.
 */
export class NebulaCanvas {
  readonly #app: PIXI.Application;
  readonly #world = new PIXI.Container();
  readonly #backgroundLayer = new PIXI.Container();
  readonly #exclusionLayer = new PIXI.Container();
  readonly #lineLayer = new PIXI.Container();
  readonly #starLayer = new PIXI.Container();
  readonly #overlay = new PIXI.Graphics();
  readonly #camera: CameraController;
  readonly #callbacks: NebulaCanvasCallbacks;
  readonly #options: NebulaCanvasOptions;
  readonly #resizeObserver: ResizeObserver;
  readonly #container: HTMLElement;
  readonly #particleField = new ParticleField();
  readonly #sky = new SkyBackground();
  #animated = true;
  #lastRender: [RenderableNode[], PathConnection[], RarityTier[], ExclusionPair[]] | null = null;

  #stars = new Map<string, StarNode>();
  #lines = new Map<string, { connection: PathConnection; line: PathLine }>();
  #exclusionLines: { pair: ExclusionPair; line: PathLine }[] = [];
  #mode: NebulaCanvasMode = 'select';
  #selectedNodeId: string | null = null;
  #selectedConnectionId: string | null = null;
  #connectSourceId: string | null = null;
  #pointerWorld: Position | null = null;
  #drag: { nodeId: string; startGlobal: Position; offset: Position; moved: boolean } | null = null;
  #lastStageTap = { time: 0, x: 0, y: 0 };
  #backgroundSprite: PIXI.TilingSprite | undefined;
  #backgroundPath: string | undefined;
  #previousUnlocked: Map<string, boolean> | null = null;
  #knownConnectionIds = new Set<string>();
  #needsInitialFit = true;
  #hasSize = false;

  constructor(container: HTMLElement, callbacks: NebulaCanvasCallbacks, options: NebulaCanvasOptions) {
    this.#callbacks = callbacks;
    this.#options = options;

    this.#app = new PIXI.Application({
      width: container.clientWidth || 640,
      height: container.clientHeight || 480,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    container.appendChild(this.#app.view as HTMLCanvasElement);

    this.#overlay.eventMode = 'none';
    this.#exclusionLayer.eventMode = 'none';
    this.#world.addChild(
      this.#backgroundLayer,
      this.#particleField.container,
      this.#exclusionLayer,
      this.#lineLayer,
      this.#starLayer,
      this.#overlay,
    );
    this.#app.stage.addChild(this.#sky.container, this.#world);
    this.#app.ticker.add(this.#onTick);

    this.#camera = new CameraController(this.#app.view as HTMLCanvasElement, this.#world);

    this.#app.stage.eventMode = 'static';
    this.#app.stage.hitArea = this.#app.screen;
    this.#app.stage.on('pointertap', this.#onStageTap);
    this.#app.stage.on('pointermove', this.#onStagePointerMove);
    this.#app.stage.on('pointerup', this.#onStagePointerUp);
    this.#app.stage.on('pointerupoutside', this.#onStagePointerUp);

    // O tamanho real do container só é confiável depois do layout em grid.
    this.#container = container;
    this.#resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) this.#applySize(rect.width, rect.height);
    });
    this.#resizeObserver.observe(container);
    this.setAnimated(options.animated ?? true);
    instances.add(this);

    // O PIXI desenha os nomes com a fonte disponível no momento; se a
    // Cinzel ainda estiver carregando, redesenha quando ela chegar.
    if (document.fonts && document.fonts.status !== 'loaded') {
      void document.fonts.ready.then(() => {
        if (instances.has(this) && this.#lastRender) {
          const previous = this.#previousUnlocked;
          this.render(...this.#lastRender);
          this.#previousUnlocked = previous;
        }
      });
    }
  }

  setMode(mode: NebulaCanvasMode): void {
    this.#mode = mode;
    this.#cancelConnect();
    this.#app.stage.cursor = mode === 'create' ? 'crosshair' : 'default';
  }

  /** Liga/desliga o movimento decorativo (céu, poeira, fluxo nos caminhos). */
  setAnimated(animated: boolean): void {
    this.#animated = animated;
    this.#sky.setAnimated(animated);
    for (const { line } of this.#lines.values()) line.setAnimated(animated);
  }

  get mode(): NebulaCanvasMode {
    return this.#mode;
  }

  /** Enquadra todas as estrelas (botão ◎ e tecla F). */
  fitView(animate = true): void {
    const bounds = this.#computeBounds();
    if (!bounds) {
      this.#camera.animateTo({ x: this.#app.screen.width / 2, y: this.#app.screen.height / 2, scale: 1 }, 400);
      return;
    }
    this.#camera.fit(bounds, this.#app.screen, animate);
  }

  /** Centraliza uma estrela sem mudar o zoom. */
  focusNode(nodeId: string): void {
    const star = this.#stars.get(nodeId);
    if (!star) return;
    const scale = this.#camera.scale;
    this.#camera.animateTo(
      {
        x: this.#app.screen.width / 2 - star.position.x * scale,
        y: this.#app.screen.height / 2 - star.position.y * scale,
        scale,
      },
      400,
    );
  }

  /** Ponto do mundo no centro da tela (para criar um Aspecto pelo teclado). */
  viewCenter(): Position {
    const point = this.#world.toLocal(new PIXI.Point(this.#app.screen.width / 2, this.#app.screen.height / 2));
    return { x: point.x, y: point.y };
  }

  selectConnection(connectionId: string | null): void {
    this.#selectedConnectionId = connectionId;
    for (const [id, entry] of this.#lines) entry.line.setSelected(id === connectionId);
  }

  render(
    nodes: RenderableNode[],
    connections: PathConnection[],
    rarities: RarityTier[],
    exclusions: ExclusionPair[] = [],
  ): void {
    this.#lastRender = [nodes, connections, rarities, exclusions];
    this.#clearScene();
    const rarityColor = new Map(rarities.map((rarity) => [rarity.id, rarity.color]));
    // Brilho por raridade: posição na ordem, de 0 (mais comum) a 1 (mais rara).
    const ranked = [...rarities].sort((a, b) => a.order - b.order);
    const brilliance = new Map(ranked.map((rarity, index) => [rarity.id, ranked.length > 1 ? index / (ranked.length - 1) : 0.5]));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const animate = this.#previousUnlocked !== null;

    for (const pair of exclusions) {
      const a = nodeById.get(pair.a);
      const b = nodeById.get(pair.b);
      if (!a || !b) continue;
      const line = new PathLine(a.position, b.position, 'exclusion');
      this.#exclusionLayer.addChild(line.graphics);
      this.#exclusionLines.push({ pair, line });
    }

    for (const connection of connections) {
      const from = nodeById.get(connection.fromNodeId);
      const to = nodeById.get(connection.toNodeId);
      if (!from || !to) continue;

      const line = new PathLine(from.position, to.position, lineState(from.status, to.status));
      line.setAnimated(this.#animated);
      line.setSelected(connection.id === this.#selectedConnectionId);
      if (animate && !this.#knownConnectionIds.has(connection.id)) line.playFadeIn();
      line.graphics.eventMode = 'static';
      line.graphics.cursor = this.#options.editable ? 'pointer' : 'default';
      line.graphics.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation();
        this.#onLinePointerDown(connection.id);
      });
      this.#lineLayer.addChild(line.graphics);
      this.#lines.set(connection.id, { connection, line });
    }
    this.#knownConnectionIds = new Set(connections.map((connection) => connection.id));

    for (const node of nodes) {
      const star = new StarNode({
        id: node.id,
        name: node.name,
        position: node.position,
        color: node.color || rarityColor.get(node.rarityId),
        brilliance: brilliance.get(node.rarityId),
        icon: node.icon,
        revealed: node.revealed,
        status: node.status,
      });
      star.setSelected(node.id === this.#selectedNodeId || node.id === this.#connectSourceId);
      if (animate) {
        const wasUnlocked = this.#previousUnlocked!.get(node.id);
        if (wasUnlocked === undefined) star.playReveal();
        else if (!wasUnlocked && node.status === 'unlocked') star.playUnlock();
      }
      star.graphics.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation();
        this.#onStarPointerDown(node.id, event);
      });
      star.graphics.on('pointerover', () => star.setHovered(true));
      star.graphics.on('pointerout', () => star.setHovered(false));
      this.#starLayer.addChild(star.graphics);
      this.#stars.set(node.id, star);
    }
    this.#previousUnlocked = new Map(nodes.map((node) => [node.id, node.status === 'unlocked']));

    if (this.#selectedNodeId && !this.#stars.has(this.#selectedNodeId)) this.#selectedNodeId = null;
    if (this.#selectedConnectionId && !this.#lines.has(this.#selectedConnectionId)) this.#selectedConnectionId = null;
    this.#tryInitialFit();
  }

  /** Imagem de fundo ladrilhada, filha do mundo — acompanha pan/zoom. */
  setBackground(path: string | undefined): void {
    if (path === this.#backgroundPath) return;
    this.#backgroundSprite?.destroy();
    this.#backgroundSprite = undefined;
    this.#backgroundPath = path;
    if (!path) return;

    const texture = PIXI.Texture.from(path);
    this.#backgroundSprite = new PIXI.TilingSprite(texture, BACKGROUND_TILE_EXTENT, BACKGROUND_TILE_EXTENT);
    this.#backgroundSprite.anchor.set(0.5);
    this.#backgroundSprite.eventMode = 'none';
    this.#backgroundLayer.addChild(this.#backgroundSprite);
  }

  destroy(): void {
    instances.delete(this);
    this.#app.ticker.remove(this.#onTick);
    this.#clearScene();
    this.#resizeObserver.disconnect();
    this.#camera.destroy();
    this.#app.destroy(true, { children: true });
  }

  // -------------------------------------------------------------------

  #clearScene(): void {
    for (const star of this.#stars.values()) star.destroy();
    for (const { line } of this.#lines.values()) line.destroy();
    for (const { line } of this.#exclusionLines) line.destroy();
    this.#stars.clear();
    this.#lines.clear();
    this.#exclusionLines = [];
  }

  #tryInitialFit(): void {
    if (!this.#needsInitialFit || !this.#hasSize || this.#stars.size === 0) return;
    this.#needsInitialFit = false;
    this.fitView(false);
  }

  #computeBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (this.#stars.size === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const star of this.#stars.values()) {
      minX = Math.min(minX, star.position.x - star.labelHalfWidth);
      minY = Math.min(minY, star.position.y);
      maxX = Math.max(maxX, star.position.x + star.labelHalfWidth);
      maxY = Math.max(maxY, star.position.y + NODE_RADIUS * 2); // espaço do nome
    }
    return { minX, minY, maxX, maxY };
  }

  /**
   * Avança as animações e desenha na hora, sem depender do ticker. Serve à
   * pré-visualização e a testes (o navegador não gera quadros com a janela
   * oculta); devolve o quadro como PNG.
   */
  renderNow(elapsedMs = 0, steps = 1): string {
    this.#applySize(this.#container.clientWidth, this.#container.clientHeight);
    for (let i = 0; i < steps; i++) this.#step(elapsedMs / steps);
    this.#app.render();
    return (this.#app.view as HTMLCanvasElement).toDataURL('image/png');
  }

  #applySize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    if (this.#hasSize && width === this.#app.screen.width && height === this.#app.screen.height) return;
    this.#app.renderer.resize(width, height);
    this.#app.stage.hitArea = this.#app.screen;
    this.#sky.resize(width, height);
    if (!this.#hasSize) {
      this.#hasSize = true;
      this.#world.position.set(width / 2, height / 2);
    }
    this.#tryInitialFit();
  }

  #onTick = (): void => {
    this.#step(this.#app.ticker.deltaMS);
  };

  #step(deltaMs: number): void {
    this.#sky.update(deltaMs, { x: this.#world.x, y: this.#world.y, scale: this.#world.scale.x });
    if (this.#animated) this.#particleField.update(deltaMs);
    for (const star of this.#stars.values()) star.update(deltaMs);
    for (const { line } of this.#lines.values()) line.update(deltaMs);
    this.#drawConnectPreview();
  }

  #drawConnectPreview(): void {
    this.#overlay.clear();
    const source = this.#connectSourceId ? this.#stars.get(this.#connectSourceId) : undefined;
    if (!source || !this.#pointerWorld) return;
    this.#overlay.lineStyle(2, 0xe8d9a0, 0.7);
    this.#overlay.moveTo(source.position.x, source.position.y);
    this.#overlay.lineTo(this.#pointerWorld.x, this.#pointerWorld.y);
  }

  #updateLinesForNode(nodeId: string): void {
    for (const { connection, line } of this.#lines.values()) {
      if (connection.fromNodeId !== nodeId && connection.toNodeId !== nodeId) continue;
      const from = this.#stars.get(connection.fromNodeId)?.position;
      const to = this.#stars.get(connection.toNodeId)?.position;
      if (from && to) line.setEndpoints(from, to);
    }
    for (const { pair, line } of this.#exclusionLines) {
      if (pair.a !== nodeId && pair.b !== nodeId) continue;
      const a = this.#stars.get(pair.a)?.position;
      const b = this.#stars.get(pair.b)?.position;
      if (a && b) line.setEndpoints(a, b);
    }
  }

  #starAt(world: Position): string | null {
    for (const [id, star] of this.#stars) {
      if (Math.hypot(star.position.x - world.x, star.position.y - world.y) <= NODE_RADIUS + 8) return id;
    }
    return null;
  }

  #cancelConnect(): void {
    if (this.#connectSourceId && this.#connectSourceId !== this.#selectedNodeId) {
      this.#stars.get(this.#connectSourceId)?.setSelected(false);
    }
    this.#connectSourceId = null;
    this.#overlay.clear();
  }

  #onStarPointerDown(nodeId: string, event: PIXI.FederatedPointerEvent): void {
    if (event.button !== 0) return;
    const editable = this.#options.editable;

    if (editable && this.#mode === 'remove') {
      this.#callbacks.onNodeRemoveRequested?.(nodeId);
      return;
    }

    // Modo Conectar (clique, clique) ou Shift+arrastar a partir da estrela.
    if (editable && (this.#mode === 'connect' || event.shiftKey)) {
      if (!this.#connectSourceId) {
        this.#connectSourceId = nodeId;
        this.#stars.get(nodeId)?.setSelected(true);
        this.#pointerWorld = this.#world.toLocal(event.global);
        this.#camera.setPanningEnabled(false); // volta no pointerup
        return;
      }
      if (this.#connectSourceId !== nodeId) {
        this.#callbacks.onConnectionRequested?.(this.#connectSourceId, nodeId);
      }
      this.#cancelConnect();
      return;
    }

    this.#selectNode(nodeId);
    if (editable) {
      const star = this.#stars.get(nodeId)!;
      const local = this.#world.toLocal(event.global);
      this.#drag = {
        nodeId,
        startGlobal: { x: event.global.x, y: event.global.y },
        offset: { x: star.position.x - local.x, y: star.position.y - local.y },
        moved: false,
      };
    }
    this.#camera.setPanningEnabled(false);
  }

  #onLinePointerDown(connectionId: string): void {
    if (!this.#options.editable) return;
    if (this.#mode === 'remove') {
      this.#callbacks.onConnectionRemoveRequested?.(connectionId);
      return;
    }
    if (this.#mode === 'select') {
      this.#selectNode(null, false);
      this.selectConnection(connectionId);
      this.#callbacks.onConnectionSelected?.(connectionId);
    }
  }

  #onStageTap = (event: PIXI.FederatedPointerEvent): void => {
    if (event.target !== this.#app.stage) return;
    if (this.#camera.consumePanFlag()) return;
    const local = this.#world.toLocal(event.global);

    if (this.#connectSourceId && this.#mode === 'connect') {
      this.#cancelConnect();
      return;
    }

    if (this.#options.editable) {
      const now = performance.now();
      const isDoubleTap =
        now - this.#lastStageTap.time < DOUBLE_TAP_MS &&
        Math.hypot(event.global.x - this.#lastStageTap.x, event.global.y - this.#lastStageTap.y) < 8;
      this.#lastStageTap = { time: isDoubleTap ? 0 : now, x: event.global.x, y: event.global.y };

      if (this.#mode === 'create' || (this.#mode === 'select' && isDoubleTap)) {
        this.#callbacks.onCreateRequested?.({ x: local.x, y: local.y });
        return;
      }
    }

    this.selectConnection(null);
    this.#selectNode(null);
  };

  #onStagePointerMove = (event: PIXI.FederatedPointerEvent): void => {
    if (this.#connectSourceId) {
      this.#pointerWorld = this.#world.toLocal(event.global);
    }

    if (!this.#drag) return;
    if (!this.#drag.moved) {
      const distance = Math.hypot(event.global.x - this.#drag.startGlobal.x, event.global.y - this.#drag.startGlobal.y);
      if (distance < DRAG_THRESHOLD_PX) return;
      this.#drag.moved = true;
    }
    const star = this.#stars.get(this.#drag.nodeId);
    if (!star) return;
    const local = this.#world.toLocal(event.global);
    star.setPosition({ x: local.x + this.#drag.offset.x, y: local.y + this.#drag.offset.y });
    this.#updateLinesForNode(this.#drag.nodeId);
  };

  #onStagePointerUp = (event: PIXI.FederatedPointerEvent): void => {
    // Shift+arrastar: soltar em cima de outra estrela cria o caminho.
    if (this.#connectSourceId && this.#mode !== 'connect') {
      const target = this.#starAt(this.#world.toLocal(event.global));
      if (target && target !== this.#connectSourceId) {
        this.#callbacks.onConnectionRequested?.(this.#connectSourceId, target);
      }
      this.#cancelConnect();
    }

    if (this.#drag?.moved) {
      const star = this.#stars.get(this.#drag.nodeId);
      if (star) this.#callbacks.onNodeMoved?.(this.#drag.nodeId, star.position);
    }
    this.#drag = null;
    this.#camera.setPanningEnabled(true);
  };

  #selectNode(nodeId: string | null, notify = true): void {
    if (this.#selectedNodeId) this.#stars.get(this.#selectedNodeId)?.setSelected(false);
    this.#selectedNodeId = nodeId;
    if (nodeId) {
      this.#stars.get(nodeId)?.setSelected(true);
      this.selectConnection(null);
    }
    if (notify) this.#callbacks.onNodeSelected?.(nodeId);
  }

  /** Mantém a seleção visual em sincronia quando o painel muda a seleção. */
  setSelectedNode(nodeId: string | null): void {
    this.#selectNode(nodeId, false);
  }
}

function lineState(from: NodeStatus, to: NodeStatus): PathLineState {
  if (to === 'excluded' || from === 'excluded') return 'closed';
  if (from === 'unlocked' && to === 'unlocked') return 'traversed';
  if (from === 'unlocked') return 'open';
  return 'dormant';
}

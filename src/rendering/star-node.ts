import type { NodeStatus, Position } from '../types/constellation';

const DEFAULT_COLOR = 0xc9b6e4; // lavanda
const EXCLUDED_COLOR = 0x4a4550; // cinza neutro — caminho fechado para sempre
const PREREQUISITE_OUTLINE = 0x8a8398;
const SELECTED_OUTLINE = 0xe8d9a0; // dourado-pálido
const PEARL = 0xf5f3ff;

export const NODE_RADIUS = 12;
const ICON_SIZE = NODE_RADIUS * 1.5;
const GLOW_LAYERS = [
  { radius: NODE_RADIUS + 18, alpha: 0.06 },
  { radius: NODE_RADIUS + 11, alpha: 0.12 },
  { radius: NODE_RADIUS + 5, alpha: 0.22 },
];
const LABEL_MAX_CHARS = 26;

const PULSE_CYCLE_MS = 3200; // respiração lenta
const REVEAL_DURATION_MS = 1100;
const UNLOCK_DURATION_MS = 1600;

function parseColor(value: string | undefined): number {
  if (!value) return DEFAULT_COLOR;
  const parsed = Number.parseInt(value.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : DEFAULT_COLOR;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export interface StarNodeData {
  id: string;
  name: string;
  position: Position;
  color?: string;
  icon?: string;
  /** Falso só na visão do Mestre, para nós ainda ocultos ao jogador. */
  revealed: boolean;
  status: NodeStatus;
}

/**
 * Um Aspecto no canvas. Todas as animações rodam por `update(deltaMs)`,
 * chamado pelo ticker do canvas — nada de requestAnimationFrame próprio
 * por estrela, e `destroy()` libera tudo que foi criado no PIXI.
 *
 * Estados visuais:
 * - desbloqueado: halo que respira, contorno perolado
 * - disponível: cor da raridade, contorno suave
 * - aguardando anterior: opacidade reduzida, contorno acinzentado
 * - caminho fechado: cinza, sem halo
 * - oculto (só Mestre): fantasmagórico
 * - selecionado/realçado: contorno dourado e núcleo maior
 */
export class StarNode {
  readonly graphics: PIXI.Container;
  readonly nodeId: string;
  #data: StarNodeData;
  #color: number;
  #glow = new PIXI.Graphics();
  #core = new PIXI.Graphics();
  #ring = new PIXI.Graphics();
  #icon: PIXI.Sprite | undefined;
  #label: PIXI.Text;
  #position: Position;
  #selected = false;
  #hovered = false;
  #elapsedMs = Math.random() * PULSE_CYCLE_MS; // estrelas não respiram em uníssono
  #revealProgress = 1;
  #unlockProgress = 1;

  constructor(data: StarNodeData) {
    this.nodeId = data.id;
    this.#data = data;
    this.#color = data.status === 'excluded' ? EXCLUDED_COLOR : parseColor(data.color);
    this.#position = { ...data.position };

    this.graphics = new PIXI.Container();
    this.graphics.eventMode = 'static';
    this.graphics.cursor = 'pointer';
    this.graphics.hitArea = new PIXI.Circle(0, 0, NODE_RADIUS + 6);
    this.graphics.position.set(data.position.x, data.position.y);

    this.#ring.eventMode = 'none';
    this.graphics.addChild(this.#ring, this.#glow, this.#core);

    if (data.icon) {
      this.#icon = PIXI.Sprite.from(data.icon);
      this.#icon.anchor.set(0.5);
      this.#icon.width = ICON_SIZE;
      this.#icon.height = ICON_SIZE;
      this.#icon.eventMode = 'none';
      this.graphics.addChild(this.#icon);
    }

    const name = data.name.length > LABEL_MAX_CHARS ? `${data.name.slice(0, LABEL_MAX_CHARS - 1)}…` : data.name;
    this.#label = new PIXI.Text(name, {
      fontFamily: ['Cinzel', 'Times New Roman', 'serif'],
      fontSize: 12,
      fill: PEARL,
      align: 'center',
      dropShadow: true,
      dropShadowColor: 0x0b0a1f,
      dropShadowBlur: 4,
      dropShadowDistance: 0,
      dropShadowAlpha: 0.9,
    });
    this.#label.resolution = 2;
    this.#label.anchor.set(0.5, 0);
    this.#label.position.set(0, NODE_RADIUS + 7);
    this.#label.eventMode = 'none';
    this.graphics.addChild(this.#label);

    this.#redraw();
  }

  get position(): Position {
    return this.#position;
  }

  setPosition(position: Position): void {
    this.#position = { ...position };
    this.graphics.position.set(position.x, position.y);
  }

  setSelected(selected: boolean): void {
    if (this.#selected === selected) return;
    this.#selected = selected;
    this.#redraw();
  }

  setHovered(hovered: boolean): void {
    if (this.#hovered === hovered) return;
    this.#hovered = hovered;
    this.#redraw();
  }

  /** Surge do nada: cresce e acende (nó recém-revelado ou recém-criado). */
  playReveal(): void {
    this.#revealProgress = 0;
    this.#applyRevealTransform();
  }

  /** Onda de luz que se expande a partir da estrela (nó recém-desbloqueado). */
  playUnlock(): void {
    this.#unlockProgress = 0;
  }

  update(deltaMs: number): void {
    this.#elapsedMs += deltaMs;

    if (this.#revealProgress < 1) {
      this.#revealProgress = Math.min(1, this.#revealProgress + deltaMs / REVEAL_DURATION_MS);
      this.#applyRevealTransform();
    }

    if (this.#data.status === 'unlocked') {
      const phase = (this.#elapsedMs % PULSE_CYCLE_MS) / PULSE_CYCLE_MS;
      this.#glow.alpha = 0.75 + 0.25 * Math.sin(phase * Math.PI * 2);
    }

    if (this.#unlockProgress < 1) {
      this.#ring.clear();
      this.#unlockProgress = Math.min(1, this.#unlockProgress + deltaMs / UNLOCK_DURATION_MS);
      if (this.#unlockProgress >= 1) return;
      const eased = easeOutCubic(this.#unlockProgress);
      const fade = 1 - this.#unlockProgress;
      this.#ring.lineStyle(2.5, this.#color, 0.8 * fade);
      this.#ring.drawCircle(0, 0, NODE_RADIUS + eased * 70);
      this.#ring.lineStyle(1.5, PEARL, 0.5 * fade);
      this.#ring.drawCircle(0, 0, NODE_RADIUS + eased * 45);
    }
  }

  destroy(): void {
    // Não destrói a textura do ícone: ela fica no cache do PIXI e é
    // reaproveitada pela próxima renderização.
    this.graphics.destroy({ children: true });
  }

  #applyRevealTransform(): void {
    const eased = easeOutCubic(this.#revealProgress);
    this.graphics.scale.set(0.3 + 0.7 * eased);
    this.graphics.alpha = eased;
  }

  #redraw(): void {
    const { status, revealed } = this.#data;
    const unlocked = status === 'unlocked';
    const highlighted = this.#selected || this.#hovered;
    let opacity = revealed ? 1 : 0.4;
    if (status === 'prerequisite') opacity *= 0.6;
    if (status === 'excluded') opacity *= 0.7;

    this.#glow.clear();
    if (unlocked || highlighted) {
      const strength = unlocked ? 1 : 0.6;
      for (const layer of GLOW_LAYERS) {
        this.#glow.beginFill(this.#color, layer.alpha * strength * opacity);
        this.#glow.drawCircle(0, 0, layer.radius);
        this.#glow.endFill();
      }
    }

    this.#core.clear();
    if (this.#selected) {
      this.#core.lineStyle(3, SELECTED_OUTLINE, 0.95);
    } else if (this.#hovered) {
      this.#core.lineStyle(2, SELECTED_OUTLINE, 0.6);
    } else if (unlocked) {
      this.#core.lineStyle(2, PEARL, 0.7);
    } else if (status === 'prerequisite') {
      this.#core.lineStyle(1.5, PREREQUISITE_OUTLINE, 0.7);
    } else if (!revealed) {
      this.#core.lineStyle(1.5, PEARL, 0.5);
    } else {
      this.#core.lineStyle(1.5, PEARL, 0.3);
    }
    this.#core.beginFill(this.#color, opacity);
    this.#core.drawCircle(0, 0, this.#selected ? NODE_RADIUS + 3 : NODE_RADIUS);
    this.#core.endFill();
    if (unlocked) {
      // brilho interno: um ponto claro no centro dá volume à estrela
      this.#core.beginFill(PEARL, 0.55 * opacity);
      this.#core.drawCircle(0, 0, NODE_RADIUS * 0.35);
      this.#core.endFill();
    }

    if (this.#icon) this.#icon.alpha = opacity;
    this.#label.alpha = (highlighted ? 1 : status === 'excluded' ? 0.45 : 0.8) * (revealed ? 1 : 0.6);
    this.#label.style.fontStyle = revealed ? 'normal' : 'italic';
  }
}

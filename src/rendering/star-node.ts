import type { NodeStatus, Position } from '../types/constellation';
import { flareTexture, glowTexture } from './textures';

const DEFAULT_COLOR = 0xc9b6e4; // lavanda
const EXCLUDED_COLOR = 0x4a4550; // cinza neutro — caminho fechado para sempre
const PREREQUISITE_OUTLINE = 0x8a8398;
const SELECTED_OUTLINE = 0xe8d9a0; // dourado-pálido
const PEARL = 0xf5f3ff;

export const NODE_RADIUS = 12;
const ICON_SIZE = NODE_RADIUS * 1.5;
const LABEL_MAX_CHARS = 26;

const PULSE_CYCLE_MS = 3600; // respiração lenta
const REVEAL_DURATION_MS = 1100;
const UNLOCK_DURATION_MS = 1700;

function parseColor(value: string | undefined): number {
  if (!value) return DEFAULT_COLOR;
  const parsed = Number.parseInt(value.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : DEFAULT_COLOR;
}

/** Clareia uma cor em direção ao branco (0 = igual, 1 = branco). */
function lighten(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
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
  /**
   * 0 (raridade mais comum) a 1 (mais rara). A raridade nunca grita: ela
   * aparece como luminosidade — halo maior e raios de luz mais longos.
   */
  brilliance?: number;
}

/**
 * Um Aspecto no canvas. Camadas, de trás para frente: halo (brilho aditivo
 * com a cor da raridade) → raios de luz (só desbloqueadas) → onda de
 * desbloqueio → anel de seleção → núcleo → ponto quente → ícone → nome.
 *
 * Todas as animações rodam por `update(deltaMs)`, chamado pelo ticker do
 * canvas; `destroy()` libera tudo que foi criado no PIXI.
 */
export class StarNode {
  readonly graphics: PIXI.Container;
  readonly nodeId: string;
  #data: StarNodeData;
  #color: number;
  #brilliance: number;
  #halo: PIXI.Sprite;
  #flare: PIXI.Sprite;
  #ring = new PIXI.Graphics();
  #selection = new PIXI.Graphics();
  #core = new PIXI.Graphics();
  #hot: PIXI.Sprite;
  #icon: PIXI.Sprite | undefined;
  #label: PIXI.Text;
  #position: Position;
  #selected = false;
  #hovered = false;
  #elapsedMs = Math.random() * PULSE_CYCLE_MS; // estrelas não respiram em uníssono
  #revealProgress = 1;
  #unlockProgress = 1;
  #haloBase = { size: 0, alpha: 0 };
  #flareBase = { size: 0, alpha: 0 };

  constructor(data: StarNodeData) {
    this.nodeId = data.id;
    this.#data = data;
    this.#brilliance = Math.min(1, Math.max(0, data.brilliance ?? 0.3));
    this.#color = data.status === 'excluded' ? EXCLUDED_COLOR : parseColor(data.color);
    this.#position = { ...data.position };

    this.graphics = new PIXI.Container();
    this.graphics.eventMode = 'static';
    this.graphics.cursor = 'pointer';
    this.graphics.hitArea = new PIXI.Circle(0, 0, NODE_RADIUS + 6);
    this.graphics.position.set(data.position.x, data.position.y);

    this.#halo = this.#additiveSprite(glowTexture(), this.#color);
    this.#flare = this.#additiveSprite(flareTexture(), lighten(this.#color, 0.4));
    this.#hot = this.#additiveSprite(glowTexture(), 0xffffff);
    for (const child of [this.#ring, this.#selection, this.#core]) child.eventMode = 'none';
    this.graphics.addChild(this.#halo, this.#flare, this.#ring, this.#selection, this.#core, this.#hot);

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
      letterSpacing: 0.5,
      dropShadow: true,
      dropShadowColor: 0x0b0a1f,
      dropShadowBlur: 5,
      dropShadowDistance: 0,
      dropShadowAlpha: 1,
    });
    this.#label.resolution = 2;
    this.#label.anchor.set(0.5, 0);
    this.#label.position.set(0, NODE_RADIUS + 9);
    this.#label.eventMode = 'none';
    this.graphics.addChild(this.#label);

    this.#redraw();
  }

  get position(): Position {
    return this.#position;
  }

  /** Metade da largura do nome desenhado (o enquadramento da câmera precisa dela para não cortar o texto). */
  get labelHalfWidth(): number {
    return Math.max(NODE_RADIUS, this.#label.width / 2);
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
    const phase = (this.#elapsedMs % PULSE_CYCLE_MS) / PULSE_CYCLE_MS;
    const breath = Math.sin(phase * Math.PI * 2);

    if (this.#revealProgress < 1) {
      this.#revealProgress = Math.min(1, this.#revealProgress + deltaMs / REVEAL_DURATION_MS);
      this.#applyRevealTransform();
    }

    // Halo respira; nas desbloqueadas, mais fundo.
    const status = this.#data.status;
    const depth = status === 'unlocked' ? 0.18 : status === 'available' ? 0.1 : 0;
    const haloSize = this.#haloBase.size * (1 + depth * breath);
    this.#halo.width = haloSize;
    this.#halo.height = haloSize;
    this.#halo.alpha = this.#haloBase.alpha * (1 + depth * 0.8 * breath);

    if (this.#flareBase.alpha > 0) {
      this.#flare.rotation = Math.sin(this.#elapsedMs / 9000) * 0.12;
      this.#flare.alpha = this.#flareBase.alpha * (0.8 + 0.2 * breath);
    }

    if (this.#selected) this.#selection.rotation += deltaMs / 6000;

    if (this.#unlockProgress < 1) {
      this.#ring.clear();
      this.#unlockProgress = Math.min(1, this.#unlockProgress + deltaMs / UNLOCK_DURATION_MS);
      if (this.#unlockProgress >= 1) return;
      const eased = easeOutCubic(this.#unlockProgress);
      const fade = 1 - this.#unlockProgress;
      this.#ring.lineStyle(3, lighten(this.#color, 0.3), 0.85 * fade);
      this.#ring.drawCircle(0, 0, NODE_RADIUS + eased * 80);
      this.#ring.lineStyle(1.5, PEARL, 0.55 * fade);
      this.#ring.drawCircle(0, 0, NODE_RADIUS + eased * 50);
      // o halo também "acende" junto com a onda
      this.#halo.alpha += 0.6 * fade;
    }
  }

  destroy(): void {
    // Texturas ficam no cache compartilhado (e a do ícone, no cache do PIXI).
    this.graphics.destroy({ children: true });
  }

  #additiveSprite(texture: PIXI.Texture, tint: number): PIXI.Sprite {
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.tint = tint;
    sprite.blendMode = PIXI.BLEND_MODES.ADD;
    sprite.eventMode = 'none';
    return sprite;
  }

  #applyRevealTransform(): void {
    const eased = easeOutCubic(this.#revealProgress);
    this.graphics.scale.set(0.3 + 0.7 * eased);
    this.graphics.alpha = eased;
  }

  #redraw(): void {
    const { status, revealed } = this.#data;
    const b = this.#brilliance;
    const unlocked = status === 'unlocked';
    const highlighted = this.#selected || this.#hovered;
    let opacity = revealed ? 1 : 0.4;
    if (status === 'prerequisite') opacity *= 0.55;
    if (status === 'excluded') opacity *= 0.7;

    // Halo: tamanho e força crescem com a raridade e com a conquista.
    const haloByStatus: Record<NodeStatus, { size: number; alpha: number }> = {
      unlocked: { size: 90 + 70 * b, alpha: 0.75 + 0.25 * b },
      available: { size: 60 + 40 * b, alpha: 0.38 + 0.2 * b },
      prerequisite: { size: 44, alpha: 0.16 },
      excluded: { size: 0, alpha: 0 },
    };
    const halo = haloByStatus[status];
    this.#haloBase = {
      size: halo.size * (highlighted ? 1.15 : 1),
      alpha: Math.min(1, (halo.alpha + (highlighted ? 0.2 : 0)) * opacity),
    };
    this.#halo.visible = this.#haloBase.alpha > 0;

    // Raios de luz: só estrelas acesas; mais longos quanto mais rara.
    this.#flareBase = unlocked
      ? { size: 70 + 110 * b, alpha: (0.35 + 0.45 * b) * opacity }
      : { size: 0, alpha: 0 };
    this.#flare.visible = this.#flareBase.alpha > 0;
    this.#flare.width = this.#flareBase.size;
    this.#flare.height = this.#flareBase.size;

    // Anel de seleção tracejado, girando devagar.
    this.#selection.clear();
    if (this.#selected || this.#hovered) {
      const radius = NODE_RADIUS + 8;
      const segments = 16;
      this.#selection.lineStyle(this.#selected ? 1.6 : 1, SELECTED_OUTLINE, this.#selected ? 0.9 : 0.5);
      for (let i = 0; i < segments; i++) {
        const start = (i / segments) * Math.PI * 2;
        const end = start + (Math.PI * 2) / segments / 2;
        this.#selection.moveTo(Math.cos(start) * radius, Math.sin(start) * radius);
        this.#selection.arc(0, 0, radius, start, end);
      }
    }

    // Núcleo.
    this.#core.clear();
    if (this.#selected) {
      this.#core.lineStyle(2.2, SELECTED_OUTLINE, 0.95);
    } else if (unlocked) {
      this.#core.lineStyle(1.6, PEARL, 0.75);
    } else if (status === 'prerequisite') {
      this.#core.lineStyle(1.2, PREREQUISITE_OUTLINE, 0.7);
    } else if (!revealed) {
      this.#core.lineStyle(1.2, PEARL, 0.45);
    } else {
      this.#core.lineStyle(1.2, PEARL, 0.35);
    }
    const coreColor = unlocked ? lighten(this.#color, 0.25) : this.#color;
    this.#core.beginFill(coreColor, opacity * (unlocked ? 1 : 0.85));
    this.#core.drawCircle(0, 0, this.#selected ? NODE_RADIUS + 2 : NODE_RADIUS);
    this.#core.endFill();

    // Ponto quente no centro: dá volume e "luz própria".
    const hot = unlocked ? 0.95 : status === 'available' ? 0.45 : 0;
    this.#hot.visible = hot > 0;
    this.#hot.alpha = hot * opacity;
    this.#hot.width = NODE_RADIUS * (unlocked ? 2.6 : 1.8);
    this.#hot.height = this.#hot.width;

    if (this.#icon) this.#icon.alpha = opacity;
    this.#label.alpha = (highlighted ? 1 : status === 'excluded' ? 0.4 : unlocked ? 0.95 : 0.75) * (revealed ? 1 : 0.6);
    this.#label.style.fill = unlocked ? 0xf6efd6 : PEARL;
    this.#label.style.fontStyle = revealed ? 'normal' : 'italic';
  }
}

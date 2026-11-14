import type { Position } from '../types/constellation';

const DEFAULT_COLOR = '#c9b6e4'; // lavanda (cor padrão etérea)
const BLOCKED_COLOR = 0x4a4550; // cinza neutro — Aspecto permanentemente inalcançável (exclusão mútua)
const PREREQUISITE_OUTLINE = 0x8a8398; // contorno acinzentado — pré-requisito pendente (trava temporária, não permanente)
const NODE_RADIUS = 12;
const GLOW_RADIUS = NODE_RADIUS + 8;
const ICON_SIZE = NODE_RADIUS * 1.5; // levemente menor que o núcleo, pra sobrar uma borda colorida visível

// Pulsação: 2 segundos de ciclo completo (respirando, não frenético)
const PULSE_CYCLE_MS = 2000;
const PULSE_MIN_OPACITY = 0.3;
const PULSE_MAX_OPACITY = 0.7;

function hexStringToNumber(hex: string): number {
  return Number(hex.replace('#', '0x'));
}

/**
 * Representação visual de um Aspecto no canvas (Arquitetura de Software,
 * seção 3 · GDD, seção 8 — brilho e pulsação etérea). Seleção e arraste
 * são tratados via eventos do PIXI; quem decide o que fazer com esses
 * eventos (persistir, atualizar o painel) é sempre uma camada acima,
 * passada por callback.
 *
 * Estados visuais:
 * - Oculto: sem brilho, cor acinzentada
 * - Revelado, não desbloqueado: brilho suave, sem pulsação
 * - Desbloqueado: brilho + pulsação lenta (respirando)
 * - Selecionado: brilho intenso, contorno dourado
 * - Bloqueado (exclusão mútua fechou todos os caminhos): cinza neutro,
 *   sem brilho — visualmente "morto", independente da cor de raridade
 * - Travado por pré-requisito (nenhuma origem conectada ainda comprada):
 *   cor de raridade normal, opacidade reduzida, contorno acinzentado —
 *   diferente do bloqueio, é temporário: libera assim que uma origem for
 *   desbloqueada
 */
export class StarNode {
  readonly graphics: PIXI.Container;
  readonly nodeId: string;
  #glowGraphics: PIXI.Graphics;
  #coreGraphics: PIXI.Graphics;
  #iconSprite: PIXI.Sprite | undefined;
  #position: Position;
  #color: string | undefined;
  #revealed = true;
  #unlocked = false;
  #selected = false;
  #blocked = false;
  #prerequisiteLocked = false;
  #isPulsing = false;
  #animationFrameId: number | null = null;
  #pulseStartTime = 0;

  constructor(nodeId: string, position: Position, color: string | undefined, icon?: string) {
    this.nodeId = nodeId;
    this.#position = position;
    this.#color = color;

    // Container que agrupa glow + núcleo
    this.graphics = new PIXI.Container();
    this.graphics.eventMode = 'static';
    this.graphics.cursor = 'pointer';
    this.graphics.x = position.x;
    this.graphics.y = position.y;

    // Glow (sempre por baixo do núcleo, pra simular brilho)
    this.#glowGraphics = new PIXI.Graphics();
    this.graphics.addChild(this.#glowGraphics);

    // Núcleo (a estrela em si)
    this.#coreGraphics = new PIXI.Graphics();
    this.graphics.addChild(this.#coreGraphics);

    // Ícone (opcional — Banco de Dados, seção 2, MediaRefs.icon), sempre por
    // cima do núcleo, deixando uma borda colorida da raridade visível ao redor.
    if (icon) {
      this.#iconSprite = PIXI.Sprite.from(icon);
      this.#iconSprite.anchor.set(0.5);
      this.#iconSprite.width = ICON_SIZE;
      this.#iconSprite.height = ICON_SIZE;
      this.#iconSprite.eventMode = 'none'; // não rouba eventos de clique/drag do núcleo
      this.graphics.addChild(this.#iconSprite);
    }

    this.#redraw();
  }

  get position(): Position {
    return this.#position;
  }

  setPosition(position: Position): void {
    this.#position = position;
    this.graphics.x = position.x;
    this.graphics.y = position.y;
  }

  setSelected(selected: boolean): void {
    if (this.#selected === selected) {
      return;
    }
    this.#selected = selected;
    this.#redraw();
  }

  /** Controla a visibilidade (nó oculto = fantasmagórico, revelado = normal). */
  setRevealed(revealed: boolean): void {
    if (this.#revealed === revealed) {
      return;
    }
    this.#revealed = revealed;
    this.#redraw();
  }

  /** Controla a pulsação (desbloqueado = pulsa lentamente, respirando). */
  setUnlocked(unlocked: boolean): void {
    if (this.#unlocked === unlocked) {
      return;
    }
    this.#unlocked = unlocked;

    // Se começa a pulsar, inicia a animação; se para, limpa
    if (unlocked && !this.#isPulsing) {
      this.#startPulsing();
    } else if (!unlocked && this.#isPulsing) {
      this.#stopPulsing();
    }

    this.#redraw();
  }

  /** Nó permanentemente inalcançável (exclusão mútua fechou todos os caminhos até ele). */
  setBlocked(blocked: boolean): void {
    if (this.#blocked === blocked) {
      return;
    }
    this.#blocked = blocked;
    this.#redraw();
  }

  /** Nó temporariamente travado (nenhum Aspecto de origem foi comprado ainda). */
  setPrerequisiteLocked(locked: boolean): void {
    if (this.#prerequisiteLocked === locked) {
      return;
    }
    this.#prerequisiteLocked = locked;
    this.#redraw();
  }

  destroy(): void {
    this.#stopPulsing();
  }

  #redraw(): void {
    const isBlocked = this.#blocked && !this.#unlocked;
    const isPrerequisiteLocked = this.#prerequisiteLocked && !this.#unlocked && !isBlocked;
    const fill = isBlocked ? BLOCKED_COLOR : hexStringToNumber(this.#color ?? DEFAULT_COLOR);
    const revealOpacity = this.#revealed ? 1 : 0.35; // nó oculto fica fantasmagórico
    const opacity = isPrerequisiteLocked ? revealOpacity * 0.6 : revealOpacity;
    const coreRadius = this.#selected ? NODE_RADIUS + 3 : NODE_RADIUS;

    // Glow — círculo maior semi-transparente, só visível se revelado e desbloqueado
    this.#glowGraphics.clear();
    if (this.#revealed && this.#unlocked) {
      // A opacidade do glow é controlada pela pulsação
      const glowOpacity = this.#isPulsing ? 0.5 : 0.4; // pausa visível mesmo sem pulsar
      this.#glowGraphics.beginFill(fill, glowOpacity * opacity);
      this.#glowGraphics.drawCircle(0, 0, GLOW_RADIUS);
      this.#glowGraphics.endFill();
    }

    // Núcleo — a estrela em si
    this.#coreGraphics.clear();
    this.#coreGraphics.beginFill(fill, opacity);

    // Contorno: dourado se selecionado, branco suave se desbloqueado, acinzentado
    // se travado por pré-requisito, quase invisível no caso comum (revelado)
    if (this.#selected) {
      this.#coreGraphics.lineStyle(3, 0xe8d9a0, 0.9); // dourado-pálido do CSS
    } else if (this.#unlocked) {
      this.#coreGraphics.lineStyle(2, 0xf5f3ff, 0.6); // branco-perolado para desbloqueado
    } else if (isPrerequisiteLocked) {
      this.#coreGraphics.lineStyle(1.5, PREREQUISITE_OUTLINE, 0.7);
    } else {
      this.#coreGraphics.lineStyle(1.5, 0xf5f3ff, 0.3); // contorno quase invisível para revelado
    }

    this.#coreGraphics.drawCircle(0, 0, coreRadius);
    this.#coreGraphics.endFill();

    // Ícone acompanha a mesma opacidade do núcleo (fantasmagórica quando oculto,
    // reduzida quando travado por pré-requisito)
    if (this.#iconSprite) {
      this.#iconSprite.alpha = opacity;
    }
  }

  #startPulsing(): void {
    if (this.#isPulsing) {
      return;
    }
    this.#isPulsing = true;
    this.#pulseStartTime = Date.now();
    this.#animationFrameId = requestAnimationFrame(() => this.#updatePulse());
  }

  #stopPulsing(): void {
    if (this.#animationFrameId !== null) {
      cancelAnimationFrame(this.#animationFrameId);
      this.#animationFrameId = null;
    }
    this.#isPulsing = false;
  }

  #updatePulse = (): void => {
    if (!this.#isPulsing) {
      return;
    }

    // Calcula a posição no ciclo (0 a 1 e volta)
    const elapsed = Date.now() - this.#pulseStartTime;
    const progress = (elapsed % PULSE_CYCLE_MS) / PULSE_CYCLE_MS;

    // Onda senoidal suave: começa em max, desce pra min, sobe de volta (seno)
    const sineWave = Math.sin(progress * Math.PI * 2);
    const pulseOpacity = PULSE_MIN_OPACITY + ((sineWave + 1) / 2) * (PULSE_MAX_OPACITY - PULSE_MIN_OPACITY);

    // Atualiza só o glow com a nova opacidade (núcleo fica fixo)
    const fill = hexStringToNumber(this.#color ?? DEFAULT_COLOR);
    this.#glowGraphics.clear();
    if (this.#revealed && this.#unlocked) {
      this.#glowGraphics.beginFill(fill, pulseOpacity);
      this.#glowGraphics.drawCircle(0, 0, GLOW_RADIUS);
      this.#glowGraphics.endFill();
    }

    // Continua animando
    this.#animationFrameId = requestAnimationFrame(() => this.#updatePulse());
  };
}

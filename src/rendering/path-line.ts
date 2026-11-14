import type { Position } from '../types/constellation';
import { NODE_RADIUS } from './star-node';

const FADE_IN_MS = 900;
const HIT_AREA_WIDTH = 18; // faixa invisível larga para facilitar o clique
const ARROW_SIZE = 6;
const DASH = 7;
const GAP = 6;

const PEARL = 0xf5f3ff;
const GOLD = 0xe8d9a0;

/**
 * - `traversed`: as duas pontas desbloqueadas — o caminho que a lenda já percorreu.
 * - `open`: a origem está desbloqueada; o destino pode ser o próximo passo.
 * - `dormant`: nenhuma das pontas leva a lugar algum ainda.
 * - `closed`: o destino ficou fora de alcance (exclusão).
 * - `exclusion`: não é caminho — liga dois Aspectos em exclusão mútua (só Mestre).
 */
export type PathLineState = 'traversed' | 'open' | 'dormant' | 'closed' | 'exclusion';

interface LineStyle {
  color: number;
  alpha: number;
  width: number;
  glow: number; // opacidade do brilho difuso por baixo
  flow?: { color: number; speed: number; spacing: number; alpha: number }; // pontos de luz correndo no sentido do caminho
}

const STYLE: Record<PathLineState, LineStyle> = {
  traversed: { color: GOLD, alpha: 0.85, width: 2, glow: 0.22, flow: { color: 0xfff6dc, speed: 38, spacing: 70, alpha: 0.9 } },
  open: { color: PEARL, alpha: 0.5, width: 1.6, glow: 0.1, flow: { color: PEARL, speed: 22, spacing: 110, alpha: 0.55 } },
  dormant: { color: PEARL, alpha: 0.22, width: 1.2, glow: 0 },
  closed: { color: 0x6f6780, alpha: 0.22, width: 1.2, glow: 0 },
  exclusion: { color: GOLD, alpha: 0.55, width: 1.4, glow: 0 },
};

/**
 * Um caminho entre dois Aspectos: brilho difuso, linha, seta discreta no
 * meio e, nos caminhos vivos, pontos de luz fluindo da origem ao destino.
 * Linhas novas acendem com fade gradual (GDD §8: nunca um "pop").
 * Animação via `update(deltaMs)`, chamado pelo ticker do canvas.
 */
export class PathLine {
  readonly graphics = new PIXI.Container();
  #line = new PIXI.Graphics();
  #flow = new PIXI.Graphics();
  #from: Position;
  #to: Position;
  #state: PathLineState;
  #selected = false;
  #fade = 1;
  #flowOffset = Math.random() * 1000;
  #animated = true;

  constructor(from: Position, to: Position, state: PathLineState) {
    this.#from = from;
    this.#to = to;
    this.#state = state;
    this.#flow.eventMode = 'none';
    this.#flow.blendMode = PIXI.BLEND_MODES.ADD;
    this.graphics.addChild(this.#line, this.#flow);
    this.#redraw();
  }

  setEndpoints(from: Position, to: Position): void {
    this.#from = from;
    this.#to = to;
    this.#redraw();
  }

  setSelected(selected: boolean): void {
    if (this.#selected === selected) return;
    this.#selected = selected;
    this.#redraw();
  }

  setAnimated(animated: boolean): void {
    this.#animated = animated;
    if (!animated) this.#flow.clear();
  }

  playFadeIn(): void {
    this.#fade = 0;
    this.#redraw();
  }

  update(deltaMs: number): void {
    if (this.#fade < 1) {
      this.#fade = Math.min(1, this.#fade + deltaMs / FADE_IN_MS);
      this.#redraw();
    }
    const flow = STYLE[this.#state].flow;
    if (flow && this.#animated) {
      this.#flowOffset += (deltaMs / 1000) * flow.speed;
      this.#drawFlow(flow);
    }
  }

  destroy(): void {
    this.graphics.destroy({ children: true });
  }

  #segment(): { start: Position; ux: number; uy: number; length: number } | null {
    const dx = this.#to.x - this.#from.x;
    const dy = this.#to.y - this.#from.y;
    const total = Math.hypot(dx, dy);
    if (total < NODE_RADIUS * 2.5) return null;
    const ux = dx / total;
    const uy = dy / total;
    // Começa e termina fora das estrelas, não no centro.
    const inset = NODE_RADIUS + 3;
    return { start: { x: this.#from.x + ux * inset, y: this.#from.y + uy * inset }, ux, uy, length: total - inset * 2 };
  }

  #drawFlow(flow: NonNullable<LineStyle['flow']>): void {
    const g = this.#flow;
    g.clear();
    const segment = this.#segment();
    if (!segment) return;
    const { start, ux, uy, length } = segment;
    for (let d = this.#flowOffset % flow.spacing; d < length; d += flow.spacing) {
      // some nas pontas, para não "bater" nas estrelas
      const edge = Math.min(d, length - d) / 24;
      const alpha = flow.alpha * Math.min(1, edge) * this.#fade;
      if (alpha <= 0.01) continue;
      const x = start.x + ux * d;
      const y = start.y + uy * d;
      g.beginFill(flow.color, alpha * 0.25);
      g.drawCircle(x, y, 4.5);
      g.endFill();
      g.beginFill(flow.color, alpha);
      g.drawCircle(x, y, 1.6);
      g.endFill();
    }
  }

  #redraw(): void {
    const g = this.#line;
    g.clear();
    const segment = this.#segment();
    if (!segment) return;
    const { start, ux, uy, length } = segment;
    const end = { x: start.x + ux * length, y: start.y + uy * length };

    const style = STYLE[this.#state];
    const color = this.#selected ? GOLD : style.color;
    const alpha = (this.#selected ? 1 : style.alpha) * this.#fade;
    const width = this.#selected ? style.width + 1 : style.width;

    if (this.#state === 'exclusion') {
      g.lineStyle(width, color, alpha);
      for (let offset = 0; offset < length; offset += DASH + GAP) {
        const segmentEnd = Math.min(offset + DASH, length);
        g.moveTo(start.x + ux * offset, start.y + uy * offset);
        g.lineTo(start.x + ux * segmentEnd, start.y + uy * segmentEnd);
      }
      return;
    }

    // Área de clique.
    g.lineStyle(HIT_AREA_WIDTH, color, 0.001);
    g.moveTo(start.x, start.y);
    g.lineTo(end.x, end.y);

    // Brilho difuso: duas passadas largas e fracas.
    const glow = this.#selected ? 0.25 : style.glow;
    if (glow > 0) {
      for (const [extra, strength] of [[10, 0.35], [5, 0.7]] as const) {
        g.lineStyle(width + extra, color, glow * strength * this.#fade);
        g.moveTo(start.x, start.y);
        g.lineTo(end.x, end.y);
      }
    }

    g.lineStyle(width, color, alpha);
    g.moveTo(start.x, start.y);
    g.lineTo(end.x, end.y);

    // Seta discreta no meio, apontando para o destino.
    const midX = (start.x + end.x) / 2 + ux * ARROW_SIZE * 0.5;
    const midY = (start.y + end.y) / 2 + uy * ARROW_SIZE * 0.5;
    g.lineStyle(0);
    g.beginFill(color, alpha);
    g.moveTo(midX, midY);
    g.lineTo(midX - ux * ARROW_SIZE - uy * ARROW_SIZE * 0.55, midY - uy * ARROW_SIZE + ux * ARROW_SIZE * 0.55);
    g.lineTo(midX - ux * ARROW_SIZE + uy * ARROW_SIZE * 0.55, midY - uy * ARROW_SIZE - ux * ARROW_SIZE * 0.55);
    g.closePath();
    g.endFill();
  }
}

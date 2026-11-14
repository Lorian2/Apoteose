import type { Position } from '../types/constellation';
import { NODE_RADIUS } from './star-node';

const FADE_IN_MS = 900;
const HIT_AREA_WIDTH = 18; // faixa invisível larga para facilitar o clique
const ARROW_SIZE = 7;
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

const STYLE: Record<PathLineState, { color: number; alpha: number; width: number }> = {
  traversed: { color: GOLD, alpha: 0.85, width: 2.5 },
  open: { color: PEARL, alpha: 0.55, width: 2 },
  dormant: { color: PEARL, alpha: 0.25, width: 1.5 },
  closed: { color: 0x6f6780, alpha: 0.25, width: 1.5 },
  exclusion: { color: GOLD, alpha: 0.6, width: 1.5 },
};

/**
 * Um caminho entre dois Aspectos, com seta no meio indicando o sentido.
 * Linhas novas acendem com fade gradual (GDD §8: nunca um "pop").
 * Animação via `update(deltaMs)`, chamado pelo ticker do canvas.
 */
export class PathLine {
  readonly graphics = new PIXI.Graphics();
  #from: Position;
  #to: Position;
  #state: PathLineState;
  #selected = false;
  #fade = 1;

  constructor(from: Position, to: Position, state: PathLineState) {
    this.#from = from;
    this.#to = to;
    this.#state = state;
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

  playFadeIn(): void {
    this.#fade = 0;
    this.#redraw();
  }

  update(deltaMs: number): void {
    if (this.#fade >= 1) return;
    this.#fade = Math.min(1, this.#fade + deltaMs / FADE_IN_MS);
    this.#redraw();
  }

  destroy(): void {
    this.graphics.destroy();
  }

  #redraw(): void {
    const g = this.graphics;
    g.clear();

    const dx = this.#to.x - this.#from.x;
    const dy = this.#to.y - this.#from.y;
    const length = Math.hypot(dx, dy);
    if (length < NODE_RADIUS * 2) return;
    const ux = dx / length;
    const uy = dy / length;

    // Começa e termina na borda das estrelas, não no centro.
    const start = { x: this.#from.x + ux * NODE_RADIUS, y: this.#from.y + uy * NODE_RADIUS };
    const end = { x: this.#to.x - ux * NODE_RADIUS, y: this.#to.y - uy * NODE_RADIUS };

    const style = STYLE[this.#state];
    const color = this.#selected ? GOLD : style.color;
    const alpha = (this.#selected ? 1 : style.alpha) * this.#fade;
    const width = this.#selected ? style.width + 1 : style.width;

    if (this.#state !== 'exclusion') {
      g.lineStyle(HIT_AREA_WIDTH, color, 0.001);
      g.moveTo(start.x, start.y);
      g.lineTo(end.x, end.y);
    }

    g.lineStyle(width, color, alpha);
    if (this.#state === 'exclusion') {
      const total = Math.hypot(end.x - start.x, end.y - start.y);
      for (let offset = 0; offset < total; offset += DASH + GAP) {
        const segmentEnd = Math.min(offset + DASH, total);
        g.moveTo(start.x + ux * offset, start.y + uy * offset);
        g.lineTo(start.x + ux * segmentEnd, start.y + uy * segmentEnd);
      }
      return;
    }

    g.moveTo(start.x, start.y);
    g.lineTo(end.x, end.y);

    // Seta no meio do caminho, apontando para o destino.
    const midX = (start.x + end.x) / 2 + ux * ARROW_SIZE * 0.5;
    const midY = (start.y + end.y) / 2 + uy * ARROW_SIZE * 0.5;
    g.lineStyle(0);
    g.beginFill(color, alpha);
    g.moveTo(midX, midY);
    g.lineTo(midX - ux * ARROW_SIZE - uy * ARROW_SIZE * 0.6, midY - uy * ARROW_SIZE + ux * ARROW_SIZE * 0.6);
    g.lineTo(midX - ux * ARROW_SIZE + uy * ARROW_SIZE * 0.6, midY - uy * ARROW_SIZE - ux * ARROW_SIZE * 0.6);
    g.closePath();
    g.endFill();
  }
}

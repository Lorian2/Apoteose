import type { Position } from '../types/constellation';

const REVEAL_DURATION_MS = 500; // tempo pra a linha "acender"
const LINE_WIDTH = 2.5;
const HIT_AREA_WIDTH = 18; // faixa invisível bem mais larga só pra facilitar o clique/toque (útil no modo Remover)
const LINE_COLOR_END = 0xf5f3ff; // branco-perolado (destino) — caminho normal
const LINE_COLOR_EXCLUSION = 0xe8d9a0; // dourado-pálido — sinaliza que este caminho tem exclusão mútua configurada
const LINE_OPACITY_MAX = 0.55; // opacidade final (um pouco mais brilhante que antes)

/**
 * Representação visual de um caminho entre dois Aspectos (Arquitetura de
 * Software, seção 3 · GDD, seção 8 — linhas que "acendem" com fade gradual).
 *
 * Estados:
 * - Não revelada (`revealed=false`): começa invisível, faz fade-in suave em 500ms
 * - Revelada (`revealed=true`): carrega já visível (compatibilidade com edição em tempo real)
 * - Com exclusão mútua configurada: cor dourada em vez de branco-perolado,
 *   pra o Mestre identificar de relance quais caminhos já têm regra (a regra
 *   em si é marcada pelo painel do nó, não clicando na linha — Banco de
 *   Dados, seção 5).
 *
 * Visual: gradiente suave de cor (mais lavanda na origem, mais branco no destino)
 * para reforçar a direção do caminho.
 */
export class PathLine {
  readonly graphics: PIXI.Graphics;
  #from: Position;
  #to: Position;
  #revealed: boolean;
  #opacity: number;
  #hasExclusions: boolean;
  #animationFrameId: number | null = null;
  #revealStartTime = 0;
  #isAnimating = false;

  constructor(from: Position, to: Position, revealed: boolean = true, hasExclusions: boolean = false) {
    this.#from = from;
    this.#to = to;
    this.#revealed = revealed;
    this.#hasExclusions = hasExclusions;
    this.#opacity = revealed ? LINE_OPACITY_MAX : 0;
    this.graphics = new PIXI.Graphics();
    this.#redraw();

    // Se a linha começa revelada, já é desenhada com opacidade total.
    // Se não, inicia a animação de fade-in.
    if (!revealed) {
      this.#startReveal();
    }
  }

  setEndpoints(from: Position, to: Position): void {
    this.#from = from;
    this.#to = to;
    this.#redraw();
  }

  /** Força a linha a ficar visível imediatamente (sem fade). */
  reveal(): void {
    if (this.#revealed) {
      return;
    }
    this.#stopReveal();
    this.#revealed = true;
    this.#opacity = LINE_OPACITY_MAX;
    this.#redraw();
  }

  destroy(): void {
    this.#stopReveal();
  }

  #redraw(): void {
    this.graphics.clear();

    const color = this.#hasExclusions ? LINE_COLOR_EXCLUSION : LINE_COLOR_END;

    // Faixa invisível bem mais larga que a linha visual — só existe pra
    // ampliar a área clicável/tocável no modo Remover, já que uma linha de
    // 2.5px é praticamente impossível de acertar com precisão de pixel.
    this.graphics.lineStyle(HIT_AREA_WIDTH, color, 0.001);
    this.graphics.moveTo(this.#from.x, this.#from.y);
    this.graphics.lineTo(this.#to.x, this.#to.y);

    this.graphics.lineStyle(LINE_WIDTH, color, this.#opacity);
    this.graphics.moveTo(this.#from.x, this.#from.y);
    this.graphics.lineTo(this.#to.x, this.#to.y);
  }

  #startReveal(): void {
    if (this.#isAnimating) {
      return;
    }
    this.#isAnimating = true;
    this.#revealStartTime = Date.now();
    this.#animationFrameId = requestAnimationFrame(() => this.#updateReveal());
  }

  #stopReveal(): void {
    if (this.#animationFrameId !== null) {
      cancelAnimationFrame(this.#animationFrameId);
      this.#animationFrameId = null;
    }
    this.#isAnimating = false;
  }

  #updateReveal = (): void => {
    if (!this.#isAnimating) {
      return;
    }

    const elapsed = Date.now() - this.#revealStartTime;
    const progress = Math.min(elapsed / REVEAL_DURATION_MS, 1);

    // Easing: começa lento, acelera, depois desacelera (easeInOutQuad)
    const eased = progress < 0.5
      ? 2 * progress * progress
      : -1 + (4 - 2 * progress) * progress;

    this.#opacity = LINE_OPACITY_MAX * eased;
    this.#redraw();

    // Se chegou ao final, para; senão continua
    if (progress >= 1) {
      this.#stopReveal();
    } else {
      this.#animationFrameId = requestAnimationFrame(() => this.#updateReveal());
    }
  };
}

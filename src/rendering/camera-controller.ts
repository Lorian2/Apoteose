const MIN_SCALE = 0.2;
const MAX_SCALE = 3;
const ZOOM_FACTOR_IN = 1.2; // por "clique" da roda do mouse
const ZOOM_FACTOR_OUT = 1 / 1.15;
const ZOOM_DURATION_MS = 220;
const PAN_THRESHOLD_PX = 4; // abaixo disso, foi um clique, não um arraste

interface CameraTarget {
  x: number;
  y: number;
  scale: number;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Pan e zoom do canvas, operando direto sobre o container do "mundo".
 *
 * - Zoom pela roda do mouse, multiplicativo e na direção do cursor (o
 *   ponto sob o mouse fica parado na tela).
 * - Pan arrastando o fundo. `consumePanFlag()` diz se o último gesto foi
 *   um arraste — o canvas usa isso para não tratar o fim de um pan como
 *   clique no vazio (que desmarcaria a estrela selecionada).
 * - `animateTo` / `fit` para enquadrar a constelação com easing.
 */
export class CameraController {
  readonly #world: PIXI.Container;
  readonly #view: HTMLCanvasElement;
  #isPointerDown = false;
  #panningEnabled = true;
  #panned = false;
  #downPointer = { x: 0, y: 0 };
  #lastPointer = { x: 0, y: 0 };
  #animationFrameId: number | null = null;

  constructor(view: HTMLCanvasElement, world: PIXI.Container) {
    this.#view = view;
    this.#world = world;
    this.#view.addEventListener('wheel', this.#onWheel, { passive: false });
    this.#view.addEventListener('pointerdown', this.#onPointerDown);
    window.addEventListener('pointermove', this.#onPointerMove);
    window.addEventListener('pointerup', this.#onPointerUp);
  }

  get scale(): number {
    return this.#world.scale.x;
  }

  /** Pausado enquanto o usuário arrasta uma estrela (evita competir pelo mesmo gesto). */
  setPanningEnabled(enabled: boolean): void {
    this.#panningEnabled = enabled;
    if (!enabled) {
      this.#isPointerDown = false;
    }
  }

  /** Verdadeiro (uma vez) se o último gesto no fundo foi um arraste de câmera. */
  consumePanFlag(): boolean {
    const panned = this.#panned;
    this.#panned = false;
    return panned;
  }

  /**
   * Enquadra o retângulo informado (coordenadas do mundo) na tela, com
   * margem. A escala fica entre 0.4 e 1.4 para uma estrela solitária não
   * virar um planeta nem um mapa enorme virar poeira.
   */
  fit(
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    viewport: { width: number; height: number },
    animate = true,
  ): void {
    const padding = 80;
    const width = Math.max(bounds.maxX - bounds.minX, 1);
    const height = Math.max(bounds.maxY - bounds.minY, 1);
    const scale = Math.min(
      1.4,
      Math.max(0.4, Math.min((viewport.width - padding * 2) / width, (viewport.height - padding * 2) / height)),
    );
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const target = { x: viewport.width / 2 - centerX * scale, y: viewport.height / 2 - centerY * scale, scale };
    if (animate) {
      this.animateTo(target, 450);
    } else {
      this.#stopAnimation();
      this.#apply(target);
    }
  }

  animateTo(target: CameraTarget, durationMs: number): void {
    this.#stopAnimation();
    const start = { x: this.#world.x, y: this.#world.y, scale: this.#world.scale.x };
    const startTime = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - startTime) / durationMs, 1);
      const eased = easeOutCubic(progress);
      this.#apply({
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        scale: start.scale + (target.scale - start.scale) * eased,
      });
      this.#animationFrameId = progress < 1 ? requestAnimationFrame(step) : null;
    };
    this.#animationFrameId = requestAnimationFrame(step);
  }

  destroy(): void {
    this.#stopAnimation();
    this.#view.removeEventListener('wheel', this.#onWheel);
    this.#view.removeEventListener('pointerdown', this.#onPointerDown);
    window.removeEventListener('pointermove', this.#onPointerMove);
    window.removeEventListener('pointerup', this.#onPointerUp);
  }

  #apply(target: CameraTarget): void {
    this.#world.scale.set(target.scale);
    this.#world.x = target.x;
    this.#world.y = target.y;
  }

  #stopAnimation(): void {
    if (this.#animationFrameId !== null) {
      cancelAnimationFrame(this.#animationFrameId);
      this.#animationFrameId = null;
    }
  }

  #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.#view.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    // Ponto do mundo sob o cursor, calculado sobre a escala de destino de
    // uma animação em andamento — várias "clicadas" seguidas se acumulam.
    const currentScale = this.#world.scale.x;
    const factor = event.deltaY < 0 ? ZOOM_FACTOR_IN : ZOOM_FACTOR_OUT;
    const targetScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, currentScale * factor));
    if (targetScale === currentScale) return;

    const worldX = (anchor.x - this.#world.x) / currentScale;
    const worldY = (anchor.y - this.#world.y) / currentScale;
    this.animateTo(
      { x: anchor.x - worldX * targetScale, y: anchor.y - worldY * targetScale, scale: targetScale },
      ZOOM_DURATION_MS,
    );
  };

  #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) return;
    this.#isPointerDown = true;
    this.#panned = false;
    this.#downPointer = { x: event.clientX, y: event.clientY };
    this.#lastPointer = { ...this.#downPointer };
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (!this.#isPointerDown || !this.#panningEnabled) {
      return;
    }
    if (!this.#panned) {
      const distance = Math.hypot(event.clientX - this.#downPointer.x, event.clientY - this.#downPointer.y);
      if (distance < PAN_THRESHOLD_PX) return;
      this.#panned = true;
      this.#stopAnimation();
    }
    this.#world.x += event.clientX - this.#lastPointer.x;
    this.#world.y += event.clientY - this.#lastPointer.y;
    this.#lastPointer = { x: event.clientX, y: event.clientY };
  };

  #onPointerUp = (): void => {
    this.#isPointerDown = false;
  };
}

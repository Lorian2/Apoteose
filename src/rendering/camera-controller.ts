const MIN_SCALE = 0.25;
const MAX_SCALE = 3;
const ZOOM_STEP_IN = 0.22; // zoom in mais rápido — pedido do usuário
const ZOOM_STEP_OUT = 0.1;
const ZOOM_DURATION_MS = 300; // tempo pra interpolar o zoom (suave, não frenético)

/**
 * Pan e zoom do canvas (Arquitetura de Software, seção 3 · GDD, seção
 * "Interface": "Zoom e Pan devem ser extremamente fluidos"). Opera
 * diretamente sobre o container que representa o "mundo" — o restante do
 * NebulaCanvas não sabe como o pan/zoom é implementado.
 *
 * Zoom: interpola suavemente com easing (não salta de repente).
 * Pan: imediato (segue o mouse naturalmente).
 */
export class CameraController {
  readonly #world: PIXI.Container;
  readonly #view: HTMLCanvasElement;
  #isDragging = false;
  #panningEnabled = true;
  #lastPointer = { x: 0, y: 0 };

  // Animação de zoom
  #isZooming = false;
  #zoomAnimationFrameId: number | null = null;
  #zoomStartScale = 1;
  #zoomTargetScale = 1;
  #zoomStartTime = 0;

  constructor(view: HTMLCanvasElement, world: PIXI.Container) {
    this.#view = view;
    this.#world = world;
    this.#attachListeners();
  }

  /** Pausado enquanto o usuário arrasta uma estrela (evita competir pelo mesmo gesto). */
  setPanningEnabled(enabled: boolean): void {
    this.#panningEnabled = enabled;
    if (!enabled) {
      this.#isDragging = false;
    }
  }

  /** Recentraliza o mundo na tela e volta o zoom a 100% — "Recentralizar" na toolbar. */
  resetView(viewportWidth: number, viewportHeight: number): void {
    this.#stopZoomAnimation();
    this.#world.scale.set(1);
    this.#world.x = viewportWidth / 2;
    this.#world.y = viewportHeight / 2;
  }

  #attachListeners(): void {
    this.#view.addEventListener('wheel', this.#onWheel, { passive: false });
    this.#view.addEventListener('pointerdown', this.#onPointerDown);
    this.#view.addEventListener('pointermove', this.#onPointerMove);
    this.#view.addEventListener('pointerup', this.#onPointerUp);
    this.#view.addEventListener('pointerleave', this.#onPointerUp);
  }

  destroy(): void {
    this.#stopZoomAnimation();
    this.#view.removeEventListener('wheel', this.#onWheel);
    this.#view.removeEventListener('pointerdown', this.#onPointerDown);
    this.#view.removeEventListener('pointermove', this.#onPointerMove);
    this.#view.removeEventListener('pointerup', this.#onPointerUp);
    this.#view.removeEventListener('pointerleave', this.#onPointerUp);
  }

  #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const zoomingIn = event.deltaY < 0;
    const direction = zoomingIn ? 1 : -1;
    const step = zoomingIn ? ZOOM_STEP_IN : ZOOM_STEP_OUT;
    const nextScale = this.#world.scale.x + direction * step;
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    
    // Inicia animação suave pra esse novo scale
    this.#startZoomAnimation(clamped);
  };

  #onPointerDown = (event: PointerEvent): void => {
    if (!this.#panningEnabled) {
      return;
    }
    this.#isDragging = true;
    this.#lastPointer = { x: event.clientX, y: event.clientY };
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (!this.#isDragging || !this.#panningEnabled) {
      return;
    }
    const dx = event.clientX - this.#lastPointer.x;
    const dy = event.clientY - this.#lastPointer.y;
    this.#world.x += dx;
    this.#world.y += dy;
    this.#lastPointer = { x: event.clientX, y: event.clientY };
  };

  #onPointerUp = (): void => {
    this.#isDragging = false;
  };

  #startZoomAnimation(targetScale: number): void {
    this.#zoomStartScale = this.#world.scale.x;
    this.#zoomTargetScale = targetScale;
    this.#zoomStartTime = Date.now();
    
    if (!this.#isZooming) {
      this.#isZooming = true;
      this.#zoomAnimationFrameId = requestAnimationFrame(() => this.#updateZoom());
    }
  }

  #stopZoomAnimation(): void {
    if (this.#zoomAnimationFrameId !== null) {
      cancelAnimationFrame(this.#zoomAnimationFrameId);
      this.#zoomAnimationFrameId = null;
    }
    this.#isZooming = false;
  }

  #updateZoom = (): void => {
    if (!this.#isZooming) {
      return;
    }

    const elapsed = Date.now() - this.#zoomStartTime;
    const progress = Math.min(elapsed / ZOOM_DURATION_MS, 1);

    // Easing: easeInOutQuad (suave aceleração e desaceleração)
    const eased = progress < 0.5
      ? 2 * progress * progress
      : -1 + (4 - 2 * progress) * progress;

    const currentScale = this.#zoomStartScale + (this.#zoomTargetScale - this.#zoomStartScale) * eased;
    this.#world.scale.set(currentScale);

    if (progress >= 1) {
      this.#stopZoomAnimation();
    } else {
      this.#zoomAnimationFrameId = requestAnimationFrame(() => this.#updateZoom());
    }
  };
}

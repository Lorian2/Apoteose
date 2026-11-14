import { flareTexture, glowTexture, nebulaTexture, seededRandom, starfieldTexture } from './textures';

/**
 * Camada de paralaxe: quanto menor o fator, mais "longe" — anda menos no
 * pan e quase não muda com o zoom.
 */
interface ParallaxLayer {
  sprite: PIXI.TilingSprite;
  factor: number;
  drift: { x: number; y: number }; // deriva lenta própria (px/s), para o céu nunca parecer parado
}

interface Twinkle {
  sprite: PIXI.Sprite;
  baseX: number;
  baseY: number;
  factor: number;
  baseAlpha: number;
  phase: number;
  speed: number;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  ageMs: number;
  lifeMs: number;
}

const TWINKLE_COUNT = 70;
const TWINKLE_TINTS = [0xffffff, 0xf5f3ff, 0xd6e2ff, 0xe8d9a0, 0xc9b6e4];

export interface SkyCamera {
  x: number;
  y: number;
  scale: number;
}

/**
 * O céu atrás da constelação, em coordenadas de tela (fora do "mundo"):
 * nebulosa → três campos de estrelas → estrelas que cintilam → estrelas
 * cadentes raras. Lê a câmera a cada quadro para o efeito de profundidade.
 */
export class SkyBackground {
  readonly container = new PIXI.Container();
  #layers: ParallaxLayer[] = [];
  #twinkles: Twinkle[] = [];
  #shooting: ShootingStar[] = [];
  #shootingGraphics = new PIXI.Graphics();
  #twinkleLayer = new PIXI.Container();
  #width = 1;
  #height = 1;
  #elapsedMs = 0;
  #driftMs = 0;
  #nextShootingMs: number;
  #animated = true;
  #random = Math.random;

  constructor() {
    this.container.eventMode = 'none';

    const add = (texture: PIXI.Texture, factor: number, alpha: number, drift: { x: number; y: number }, additive = false) => {
      const sprite = new PIXI.TilingSprite(texture, 1, 1);
      sprite.alpha = alpha;
      if (additive) sprite.blendMode = PIXI.BLEND_MODES.ADD;
      this.container.addChild(sprite);
      this.#layers.push({ sprite, factor, drift });
    };

    add(nebulaTexture(), 0.04, 1, { x: 1.2, y: 0.4 }, true);
    add(starfieldTexture(11, 1.6, 0.9, 0.7), 0.08, 0.85, { x: 0.6, y: 0.2 });
    add(starfieldTexture(23, 0.45, 1.6, 0.9), 0.18, 0.9, { x: 0.9, y: 0.3 });
    add(starfieldTexture(37, 0.08, 2.4, 1), 0.32, 1, { x: 1.4, y: 0.5 });

    const random = seededRandom(101);
    for (let i = 0; i < TWINKLE_COUNT; i++) {
      const bright = random() < 0.18;
      const sprite = new PIXI.Sprite(bright ? flareTexture() : glowTexture());
      sprite.anchor.set(0.5);
      sprite.tint = TWINKLE_TINTS[Math.floor(random() * TWINKLE_TINTS.length)];
      sprite.blendMode = PIXI.BLEND_MODES.ADD;
      const size = bright ? 18 + random() * 22 : 5 + random() * 7;
      sprite.width = size;
      sprite.height = size;
      if (bright) sprite.rotation = random() * 0.4 - 0.2;
      this.#twinkleLayer.addChild(sprite);
      this.#twinkles.push({
        sprite,
        baseX: random(),
        baseY: random(),
        factor: 0.12 + random() * 0.25,
        baseAlpha: bright ? 0.55 + random() * 0.35 : 0.35 + random() * 0.5,
        phase: random() * Math.PI * 2,
        speed: 0.4 + random() * 1.2,
      });
    }
    this.#twinkleLayer.eventMode = 'none';
    this.container.addChild(this.#twinkleLayer, this.#shootingGraphics);
    this.#nextShootingMs = 6000 + Math.random() * 10000;
  }

  /** Desliga cintilação, deriva e estrelas cadentes (configuração "Céu animado"). */
  setAnimated(animated: boolean): void {
    this.#animated = animated;
    if (!animated) {
      this.#shooting = [];
      this.#shootingGraphics.clear();
    }
  }

  resize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
    for (const { sprite } of this.#layers) {
      sprite.width = width;
      sprite.height = height;
    }
  }

  update(deltaMs: number, camera: SkyCamera): void {
    if (this.#animated) {
      this.#elapsedMs += deltaMs;
      this.#driftMs += deltaMs;
    }
    const seconds = this.#driftMs / 1000;

    for (const { sprite, factor, drift } of this.#layers) {
      // zoom quase não afeta o fundo distante: só um leve "respiro" de escala
      const scale = 1 + (camera.scale - 1) * factor * 0.6;
      sprite.tileScale.set(scale);
      sprite.tilePosition.set(camera.x * factor + drift.x * seconds, camera.y * factor + drift.y * seconds);
    }

    const t = this.#elapsedMs / 1000;
    const spanX = this.#width + 80;
    const spanY = this.#height + 80;
    for (const star of this.#twinkles) {
      const x = mod(star.baseX * spanX + camera.x * star.factor, spanX) - 40;
      const y = mod(star.baseY * spanY + camera.y * star.factor, spanY) - 40;
      star.sprite.position.set(x, y);
      const twinkle = this.#animated ? 0.55 + 0.45 * Math.sin(t * star.speed + star.phase) : 0.8;
      star.sprite.alpha = star.baseAlpha * twinkle;
    }

    if (this.#animated) this.#updateShootingStars(deltaMs);
  }

  destroy(): void {
    // As texturas ficam no cache compartilhado; só os objetos de cena saem.
    this.container.destroy({ children: true });
  }

  #updateShootingStars(deltaMs: number): void {
    this.#nextShootingMs -= deltaMs;
    if (this.#nextShootingMs <= 0) {
      this.#nextShootingMs = 14000 + this.#random() * 26000; // raras: a cada 14–40 s
      const angle = Math.PI * (0.62 + this.#random() * 0.16); // descendo para a esquerda
      const speed = 0.9 + this.#random() * 0.6; // px/ms
      this.#shooting.push({
        x: this.#width * (0.35 + this.#random() * 0.65),
        y: this.#height * this.#random() * 0.45,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        length: 90 + this.#random() * 110,
        ageMs: 0,
        lifeMs: 700 + this.#random() * 500,
      });
    }

    const g = this.#shootingGraphics;
    g.clear();
    this.#shooting = this.#shooting.filter((star) => (star.ageMs += deltaMs) < star.lifeMs);
    for (const star of this.#shooting) {
      const progress = star.ageMs / star.lifeMs;
      const fade = Math.sin(progress * Math.PI); // acende e apaga suave
      const headX = star.x + star.vx * star.ageMs;
      const headY = star.y + star.vy * star.ageMs;
      const speed = Math.hypot(star.vx, star.vy);
      const ux = star.vx / speed;
      const uy = star.vy / speed;
      const segments = 12;
      for (let i = 0; i < segments; i++) {
        const a = i / segments;
        const b = (i + 1) / segments;
        g.lineStyle(2.2 * (1 - a), 0xf5f3ff, 0.75 * fade * (1 - a));
        g.moveTo(headX - ux * star.length * a, headY - uy * star.length * a);
        g.lineTo(headX - ux * star.length * b, headY - uy * star.length * b);
      }
      g.lineStyle(0);
      g.beginFill(0xffffff, 0.9 * fade);
      g.drawCircle(headX, headY, 1.6);
      g.endFill();
    }
  }
}

function mod(value: number, span: number): number {
  return ((value % span) + span) % span;
}

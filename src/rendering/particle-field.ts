// Poeira cósmica sutil atrás das estrelas (GDD, seção 8 — "textura: poeira
// cósmica como névoa suave" / seção 11 — Observatório com "partículas
// discretas"). Deliberadamente discreta: baixa contagem, baixa opacidade,
// movimento bem lento — o objetivo é dar sensação de profundidade e "céu
// vivo", nunca competir visualmente com as estrelas de verdade.
const PARTICLE_COUNT = 70;
const FIELD_HALF_EXTENT = 3000; // partículas distribuídas num quadrado de ±3000 ao redor da origem do mundo
const MIN_SPEED = 3; // unidades do mundo por segundo
const MAX_SPEED = 10;
const MIN_RADIUS = 0.6;
const MAX_RADIUS = 1.8;
const MIN_BASE_ALPHA = 0.08;
const MAX_BASE_ALPHA = 0.28;
const TWINKLE_CYCLE_MS = 6000; // bem mais lento que a pulsação de seleção da estrela — não deve chamar atenção

interface Particle {
  graphics: PIXI.Graphics;
  vx: number;
  vy: number;
  baseAlpha: number;
  twinkleOffsetMs: number;
}

/**
 * Uma leve névoa de pontinhos à deriva, sempre visível por trás das
 * estrelas e na frente do fundo ladrilhado. Vive fora do ciclo de
 * `NebulaCanvas#render()` — é criada uma vez e nunca precisa ser refeita
 * (só reencaixada no container certo depois de um `removeChildren()`),
 * porque não depende de nenhum dado da constelação.
 */
export class ParticleField {
  readonly container: PIXI.Container;
  #particles: Particle[] = [];
  #elapsedMs = 0;

  constructor() {
    this.container = new PIXI.Container();
    this.container.eventMode = 'none'; // nunca rouba clique/drag de nada

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const graphics = new PIXI.Graphics();
      const radius = MIN_RADIUS + Math.random() * (MAX_RADIUS - MIN_RADIUS);
      const baseAlpha = MIN_BASE_ALPHA + Math.random() * (MAX_BASE_ALPHA - MIN_BASE_ALPHA);

      graphics.beginFill(0xf5f3ff);
      graphics.drawCircle(0, 0, radius);
      graphics.endFill();
      graphics.x = (Math.random() * 2 - 1) * FIELD_HALF_EXTENT;
      graphics.y = (Math.random() * 2 - 1) * FIELD_HALF_EXTENT;
      graphics.alpha = baseAlpha;

      const angle = Math.random() * Math.PI * 2;
      const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);

      this.container.addChild(graphics);
      this.#particles.push({
        graphics,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        baseAlpha,
        twinkleOffsetMs: Math.random() * TWINKLE_CYCLE_MS,
      });
    }
  }

  /** Chamado a cada frame pelo ticker do PIXI — `deltaMs` já vem em milissegundos reais. */
  update(deltaMs: number): void {
    this.#elapsedMs += deltaMs;
    const deltaSeconds = deltaMs / 1000;

    for (const particle of this.#particles) {
      particle.graphics.x += particle.vx * deltaSeconds;
      particle.graphics.y += particle.vy * deltaSeconds;

      // Sai por um lado do campo, entra pelo outro — nunca "acaba" a poeira
      if (particle.graphics.x > FIELD_HALF_EXTENT) particle.graphics.x = -FIELD_HALF_EXTENT;
      if (particle.graphics.x < -FIELD_HALF_EXTENT) particle.graphics.x = FIELD_HALF_EXTENT;
      if (particle.graphics.y > FIELD_HALF_EXTENT) particle.graphics.y = -FIELD_HALF_EXTENT;
      if (particle.graphics.y < -FIELD_HALF_EXTENT) particle.graphics.y = FIELD_HALF_EXTENT;

      // Brilho variando bem devagar e fora de sincronia entre partículas —
      // "respirando", nunca piscando de forma perceptível/mecânica.
      const phase = ((this.#elapsedMs + particle.twinkleOffsetMs) % TWINKLE_CYCLE_MS) / TWINKLE_CYCLE_MS;
      const twinkle = 0.6 + 0.4 * Math.sin(phase * Math.PI * 2);
      particle.graphics.alpha = particle.baseAlpha * twinkle;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

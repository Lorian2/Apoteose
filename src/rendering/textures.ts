/**
 * Texturas geradas em tempo de execução (canvas 2D → PIXI.Texture), criadas
 * uma vez e compartilhadas por todos os canvases do módulo. Nada de arquivo
 * de imagem: o céu sai igual em qualquer mundo, sem depender de assets.
 *
 * As texturas de céu são "sem costura": tudo que encosta numa borda é
 * desenhado de novo do outro lado, para o TilingSprite repetir sem emenda.
 */

const cache = new Map<string, PIXI.Texture>();

function cached(key: string, create: () => HTMLCanvasElement): PIXI.Texture {
  let texture = cache.get(key);
  if (!texture) {
    texture = PIXI.Texture.from(create());
    cache.set(key, texture);
  }
  return texture;
}

function canvas2d(width: number, height = width): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return [element, element.getContext('2d')!];
}

/** PRNG determinístico (mulberry32): o mesmo céu em toda abertura. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Desenha nas 9 posições (centro + vizinhas) para a textura repetir sem emenda. */
function drawWrapped(size: number, x: number, y: number, radius: number, draw: (x: number, y: number) => void): void {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      const px = x + dx;
      const py = y + dy;
      if (px + radius < 0 || px - radius > size || py + radius < 0 || py - radius > size) continue;
      draw(px, py);
    }
  }
}

/** Brilho radial branco → transparente. Usado com tint e mistura aditiva. */
export function glowTexture(): PIXI.Texture {
  return cached('glow', () => {
    const size = 128;
    const [element, g] = canvas2d(size);
    const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.14)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
    return element;
  });
}

/** Raios de luz em cruz (difração), finos e suaves. */
export function flareTexture(): PIXI.Texture {
  return cached('flare', () => {
    const size = 256;
    const [element, g] = canvas2d(size);
    const center = size / 2;
    for (const horizontal of [true, false]) {
      g.save();
      g.translate(center, center);
      if (!horizontal) g.rotate(Math.PI / 2);
      g.scale(1, 0.035);
      const gradient = g.createRadialGradient(0, 0, 0, 0, 0, center);
      gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
      gradient.addColorStop(0.25, 'rgba(255,255,255,0.35)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gradient;
      g.beginPath();
      g.arc(0, 0, center, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    return element;
  });
}

/** Nebulosa: nuvens grandes e muito suaves de anil, ameixa e lavanda. */
export function nebulaTexture(): PIXI.Texture {
  return cached('nebula', () => {
    const size = 1024;
    const [element, g] = canvas2d(size);
    const random = seededRandom(7);
    const palette = [
      [58, 31, 77], // ameixa
      [36, 27, 78], // anil
      [88, 64, 140], // violeta
      [201, 182, 228], // lavanda
      [60, 70, 140], // azul-noite
      [232, 217, 160], // dourado-pálido (raro e bem fraco)
    ];
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 34; i++) {
      const [r, gr, b] = palette[i % 9 === 8 ? 5 : Math.floor(random() * 5)];
      const radius = 110 + random() * 340;
      const alpha = (i % 9 === 8 ? 0.04 : 0.08) + random() * 0.09;
      const x = random() * size;
      const y = random() * size;
      // nuvens alongadas, em direções variadas
      const stretch = 0.45 + random() * 0.55;
      const angle = random() * Math.PI;
      drawWrapped(size, x, y, radius, (px, py) => {
        g.save();
        g.translate(px, py);
        g.rotate(angle);
        g.scale(1, stretch);
        const gradient = g.createRadialGradient(0, 0, 0, 0, 0, radius);
        gradient.addColorStop(0, `rgba(${r},${gr},${b},${alpha})`);
        gradient.addColorStop(0.5, `rgba(${r},${gr},${b},${alpha * 0.45})`);
        gradient.addColorStop(1, `rgba(${r},${gr},${b},0)`);
        g.fillStyle = gradient;
        g.beginPath();
        g.arc(0, 0, radius, 0, Math.PI * 2);
        g.fill();
        g.restore();
      });
    }
    return element;
  });
}

const STAR_TINTS = ['255,255,255', '245,243,255', '214,226,255', '232,217,160', '201,182,228', '255,236,214'];

/**
 * Campo de estrelas distantes, sem costura. `density` = estrelas por
 * 100×100 px; `maxRadius` controla o tamanho das maiores.
 */
export function starfieldTexture(seed: number, density: number, maxRadius: number, brightness: number): PIXI.Texture {
  return cached(`stars-${seed}-${density}-${maxRadius}-${brightness}`, () => {
    const size = 1024;
    const [element, g] = canvas2d(size);
    const random = seededRandom(seed);
    const count = Math.round((size * size * density) / 10000);
    for (let i = 0; i < count; i++) {
      const x = random() * size;
      const y = random() * size;
      // poucas grandes, muitas pequenas
      const radius = 0.35 + Math.pow(random(), 3) * maxRadius;
      const alpha = Math.min(1, (0.25 + random() * 0.75) * brightness);
      const tint = STAR_TINTS[Math.floor(random() * STAR_TINTS.length)];
      drawWrapped(size, x, y, radius * 4, (px, py) => {
        if (radius > 1.1) {
          const halo = g.createRadialGradient(px, py, 0, px, py, radius * 4);
          halo.addColorStop(0, `rgba(${tint},${alpha * 0.35})`);
          halo.addColorStop(1, `rgba(${tint},0)`);
          g.fillStyle = halo;
          g.beginPath();
          g.arc(px, py, radius * 4, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = `rgba(${tint},${alpha})`;
        g.beginPath();
        g.arc(px, py, radius, 0, Math.PI * 2);
        g.fill();
      });
    }
    return element;
  });
}

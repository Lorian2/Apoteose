# Guia de Customização — Constelação da Apoteose

Este documento é um mapa de "onde mexer" para adaptar o módulo a outro
cenário: outro nome, outra paleta de cores, outros textos padrão. Ele não
cobre lógica/comportamento — só o que é **texto, cor, ou valor numérico**
que dá pra trocar sem entender o resto do código.

Depois de qualquer mudança nos arquivos `.ts`, sempre rode `npm run build`
antes de testar no Foundry. Mudanças em `.hbs`, `.css`, `.json` **não**
precisam de build — o Foundry lê esses arquivos direto.

---

## 1. Nome, descrição e identidade do módulo

**Arquivo: `module.json`**

```json
{
  "id": "constelacao-da-apoteose",
  "title": "Constelação da Apoteose",
  "description": "Sistema de evolução narrativa para Foundry VTT...",
  "authors": [{ "name": "Luan" }]
}
```

- `title` e `description`: o que aparece na lista de módulos do Foundry.
- `id`: **evite trocar** a menos que esteja começando um projeto do zero —
  é a chave usada em todas as flags salvas nos Atores/Journals. Trocar o
  `id` depois de já ter dados salvos faz o módulo "esquecer" tudo que
  existia antes (as flags antigas continuam lá, só que sob outro nome).

> ⚠️ O `id` também aparece hardcoded em `src/constants.ts`
> (`export const MODULE_ID = 'constelacao-da-apoteose';`) — se um dia
> trocar o `id` no `module.json`, troque aqui junto, senão os dois ficam
> dessincronizados e o módulo quebra.

---

## 2. Textos da interface

Isso é o ponto mais importante pra quem for adaptar pra outro cenário —
**a maior parte dos textos NÃO está centralizada num arquivo de idioma**,
diferente do que costuma ser padrão em módulos Foundry. Só um punhado de
strings usa o sistema de localização; o resto está direto nos templates.

### 2.1 — O pouco que É localizado

**Arquivo: `lang/pt-BR.json`**

```json
{
  "CONSTELACAO_APOTEOSE.ModuleTitle": "Constelação da Apoteose",
  "CONSTELACAO_APOTEOSE.EditorTitle": "Constelação da Apoteose — Editor",
  "CONSTELACAO_APOTEOSE.ObservatoryTitle": "Minha Constelação",
  "CONSTELACAO_APOTEOSE.OpenButtonLabel": "Constelação da Apoteose",
  "CONSTELACAO_APOTEOSE.OpenObservatoryButtonLabel": "Minha Constelação"
}
```

Só os títulos das janelas e dos botões de abrir. Edite os valores à
direita livremente.

### 2.2 — O resto (a maioria): direto nos templates `.hbs`

Pasta `templates/`:

| Arquivo | O que tem lá |
|---|---|
| `editor-toolbar.hbs` | Rótulos dos botões da barra de ferramentas do Editor (Conectar, Criar, Remover, Conceder/Remover Ponto) |
| `editor-panel.hbs` | Rótulos de campo (Nome, Subtítulo, Categoria...), textos de "Exclusão mútua", "Mídia (Mestre)", "Configurações da Constelação", "Linha do Tempo da Jornada" |
| `observatory-panel.hbs` | Textos que o jogador vê: "Desbloquear (1 Ponto da Apoteose)", mensagens de caminho fechado/pré-requisito, "Linha do Tempo da Jornada" |
| `editor-canvas.hbs` / `observatory-canvas.hbs` | Só o botão "◎" de recentralizar (o `title="Recentralizar câmera"` é o texto do tooltip) |

É só abrir o `.hbs` e editar o texto entre as tags — não precisa saber
Handlebars pra isso, só não mexer no que está dentro de `{{ }}` (essas
chaves puxam dados, não são texto fixo).

### 2.3 — Mensagens de aviso/erro (`ui.notifications`)

Essas ficam espalhadas nos arquivos `.ts` em `src/applications/` e
`src/services/`, em chamadas como:

```ts
ui.notifications?.info('Ponto da Apoteose concedido!');
ui.notifications?.warn('É preciso manter pelo menos uma raridade.');
ui.notifications?.error(error.message);
```

Não tem como listar todas aqui (são dezenas) — a forma mais rápida de
achar e trocar uma mensagem específica é abrir a pasta `src/` no seu
editor de código e buscar (Ctrl+F / Cmd+F em todos os arquivos) pelo
texto exato que você viu aparecer no jogo.

### 2.4 — Nomenclatura do próprio conceito ("Aspecto", "Ponto da Apoteose"...)

Não existe um único lugar pra trocar "Aspecto" por outra palavra (ex.:
"Talento", "Marca", "Estrela") — esses termos estão espalhados nos textos
fixos descritos acima (2.2 e 2.3) e também em comentários de código (que
não afetam o jogo, só documentação interna). Pra uma re-temática completa,
o caminho é: buscar pelo termo em todos os arquivos `.hbs` e `.ts` dentro
de `templates/` e `src/`, e trocar um por um. Não há atalho — o módulo não
foi construído com um sistema de "strings de tema" trocável em bloco.

---

## 3. Cores e aparência visual

### 3.1 — Paleta principal (a mexida com mais retorno)

**Arquivo: `styles/constelacao.css`**, bem no topo, dentro de
`.constelacao-apoteose`:

```css
--constelacao-void: #0b0a1f;          /* fundo mais escuro (o "vazio" do céu) */
--constelacao-indigo-deep: #161034;   /* fundo dos painéis */
--constelacao-indigo: #241b4e;
--constelacao-plum: #3a1f4d;          /* hover de botões, realces */
--constelacao-gold-pale: #e8d9a0;     /* destaque dourado (títulos, avisos) */
--constelacao-lavender: #c9b6e4;      /* cor de acento principal */
--constelacao-pearl: #f5f3ff;         /* quase-branco, texto de maior contraste */
```

Como praticamente todo o CSS do módulo usa essas variáveis (em vez de
cores soltas), trocar os valores aqui já muda a cara de quase tudo —
painéis, bordas, textos de destaque — de uma vez só. É o primeiro lugar a
mexer se o cenário novo pedir outra paleta (ex.: tons de vermelho/fogo em
vez de azul/roxo etéreo).

Duas fontes também vivem aqui, se quiser trocar a tipografia:

```css
--constelacao-font-legend: 'Cinzel', 'Times New Roman', serif;   /* nomes, títulos */
--constelacao-font-quote: 'Cormorant Garamond', Georgia, serif;  /* citações */
```

(A importação da fonte do Google Fonts está uma linha acima, no
`@import url(...)` — troque o nome da fonte lá também se decidir usar
outra.)

### 3.2 — Cor das estrelas no canvas

Essas cores **não** usam as variáveis CSS acima — o canvas é desenhado via
PIXI.js (WebGL), que não lê CSS. Ficam em constantes separadas:

**Arquivo: `src/rendering/star-node.ts`** (topo do arquivo):

```ts
const DEFAULT_COLOR = '#c9b6e4';        // cor de fallback se o Aspecto não tiver cor/raridade
const BLOCKED_COLOR = 0x4a4550;         // cinza — Aspecto travado permanentemente (exclusão mútua)
const PREREQUISITE_OUTLINE = 0x8a8398;  // contorno acinzentado — travado por pré-requisito (temporário)
```

> Nota: a cor "normal" de cada estrela vem da **Raridade** configurada por
> você mesmo dentro do Editor (seção "Configurações da Constelação" →
> Raridades) — não precisa mexer em código pra isso, só usar a interface.
> As raridades padrão de uma constelação **nova** (antes de você editar
> qualquer coisa) vêm de `src/constants.ts` (seção 4 abaixo).

**Arquivo: `src/rendering/path-line.ts`** (cor dos caminhos que ligam as estrelas):

```ts
const LINE_COLOR_END = 0xf5f3ff;        // branco-perolado — caminho normal
const LINE_COLOR_EXCLUSION = 0xe8d9a0;  // dourado — caminho com exclusão mútua configurada
```

Essas cores usam formato hexadecimal `0xRRGGBB` (com `0x` na frente, não
`#`) — é a notação que o PIXI.js espera, diferente do CSS.

---

## 4. Valores padrão de uma constelação nova

**Arquivo: `src/constants.ts`**

```ts
export const DEFAULT_RARITIES: RarityTier[] = [
  { id: 'common', label: 'Comum', color: '#a896c1', order: 0 },
  { id: 'uncommon', label: 'Incomum', color: '#b8a4d4', order: 1 },
  { id: 'rare', label: 'Raro', color: '#c9b6e4', order: 2 },
  { id: 'epic', label: 'Épico', color: '#d9c8f0', order: 3 },
  { id: 'legendary', label: 'Lendário', color: '#e8d9a0', order: 4 },
  { id: 'singular', label: 'Singular', color: '#f5f3ff', order: 5 },
];

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'war', label: 'Guerra' },
  { id: 'magic', label: 'Magia' },
  ...
];
```

Isso só é usado **uma vez**, no momento em que uma constelação é criada
pela primeira vez (primeira vez que o Editor é aberto pra aquele Ator).
Editar aqui muda o ponto de partida das constelações futuras — mas **não
precisa mexer neste arquivo pra mudar categorias/raridades de uma
constelação que já existe**: use a própria interface do Editor
("Configurações da Constelação" → Categorias/Raridades), que já tem botão
de adicionar, renomear, trocar cor e remover.

Também aqui: os rótulos dos **tipos de Aspecto** (mecânico, narrativo,
histórico, secreto, final, lendário, exclusivo):

```ts
export const ASPECT_TYPE_LABELS: Record<string, string> = {
  mechanical: 'Mecânico',
  narrative: 'Narrativo',
  ...
};
```

Trocar só o texto à direita (o `label`) é seguro. As chaves à esquerda
(`mechanical`, `narrative`...) são usadas internamente pra lógica — não
troque essas a menos que também entenda o resto do código que as usa.

---

## 5. Comportamento "de sensação" (zoom, tamanho das estrelas, volume padrão)

Não são cores nem textos, mas são os números mais prováveis de você
querer ajustar num cenário diferente:

| O quê | Arquivo | Constante |
|---|---|---|
| Velocidade do zoom (aproximar/afastar) | `src/rendering/camera-controller.ts` | `ZOOM_STEP_IN`, `ZOOM_STEP_OUT`, `ZOOM_DURATION_MS` |
| Limites de zoom | `src/rendering/camera-controller.ts` | `MIN_SCALE`, `MAX_SCALE` |
| Tamanho da estrela / ícone / glow | `src/rendering/star-node.ts` | `NODE_RADIUS`, `ICON_SIZE`, `GLOW_RADIUS` |
| Velocidade da pulsação da estrela selecionada | `src/rendering/star-node.ts` | `PULSE_CYCLE_MS`, `PULSE_MIN_OPACITY`, `PULSE_MAX_OPACITY` |
| Espessura/opacidade dos caminhos | `src/rendering/path-line.ts` | `LINE_WIDTH`, `LINE_OPACITY_MAX` |
| Tamanho do ladrilho de fundo infinito | `src/rendering/nebula-canvas.ts` | `BACKGROUND_TILE_EXTENT` |
| Volume padrão (efeitos / música) | `src/services/sound-settings.ts` | `default: 80` / `default: 50` (dentro de `game.settings.register`) |

---

## 6. O que NÃO fica em nenhum arquivo de configuração

Pra não criar expectativa errada: coisas como a lógica de exclusão mútua,
pré-requisito de compra, migração de schema, e a estrutura de dados
(quais campos um Aspecto tem) não são "customização de cenário" — são
comportamento do sistema, exigem entender o código de verdade pra mexer
com segurança. Este guia cobre só a superfície (texto/cor/número solto),
que é o que costuma mudar quando o mesmo módulo é reaproveitado pra uma
mesa ou jogo diferente.

# Banco de Dados, Flags e Modelos — Constelação da Apoteose
### Documento vivo do projeto · Módulo para Foundry VTT

**Versão do documento:** 1.2
**Data:** 12/07/2026 (revisado em 13/07/2026, revisado em 25/07/2026)
**Depende de:** GDD v1.2 · TDD v1.0 · Arquitetura de Software v1.0 · Estrutura de Pastas v1.0 (todos aprovados)
**Status:** Aprovado — reflete o schema real em produção (schemaVersion 3)

> **Changelog v1.4 (15/11/2026, módulo 0.4.0):** `HistoryEntry` ganha `kind` e `nodeName` (opcionais, sem mudança de `schemaVersion`). No Estado do Jogador, uma entrada ligada a um Aspecto oculto ou removido perde `nodeId`; se for um registro automático sem título de capítulo, some por inteiro. Os diários da Definição Mestra passam a ficar na pasta "Constelação da Apoteose (Mestre)" (marcada por `flags.constelacao-da-apoteose.role` = `root` ou `orphans`).
>
> **Changelog v1.3 (14/11/2026, módulo 0.2.0):** schema v3. A exclusão mútua sai de `PathConnection.excludedByNodeIds` e vira `ConstellationDefinition.exclusions` (pares simétricos de Aspectos, seção 5). `PlayerVisibleNode` ganha `status`, calculado pelo Mestre (seção 5.2). A flag `unlockRequest` do Ator deixa de existir (o jogador não pede mais desbloqueio pelo módulo) e é apagada na migração. A migração 2→3 roda sozinha quando o Mestre ativo entra no mundo.

> **Changelog v1.2 (25/07/2026):** o schema evoluiu de `schemaVersion: 1` para `2` durante a implementação, com uma migração real e automática entre as duas versões (seção 9, reescrita por completo — deixou de ser um placeholder). Mudanças de schema desta versão:
> - Novo campo `backgroundMusic?: string` em `ConstellationDefinition` e `PlayerConstellationState` (seções 6 e 7) — música de fundo da constelação, mesmo padrão de `background`.
> - `PathConnection.excludedByNodeIds` (seção 5) passou a ter a garantia de **sempre existir como array** depois de uma leitura (nunca `undefined`) — normalizado pela migração 1→2, mesmo que o campo continue tecnicamente opcional no tipo TypeScript por compatibilidade com dados ainda não migrados.
> - Seção 10 atualizada: categorias e raridades deixaram de ser só "valores de semente editáveis manualmente no futuro" — hoje já existe interface completa no Editor para criar, editar e remover ambas, sem precisar tocar em `constants.ts`.
>
> **Changelog v1.1:** adicionado o campo `unspentPoints` (seções 6 e 7) — faltava um contador persistente de Pontos da Apoteose ainda não gastos, necessário para o fluxo do GDD em que conceder e investir um ponto são passos separados no tempo.

---

## 0. Sobre este documento

Este documento define o schema real de dados — o conteúdo que vive em `src/types/constellation.ts` e é lido/escrito exclusivamente pelo `ConstellationRepository` (Arquitetura de Software, seção 5). Tudo aqui é a materialização direta da separação Definição Mestra / Estado do Jogador fixada no TDD (seção 3.2).

---

## 1. Visão geral do modelo

Cada personagem (Ator) tem **dois documentos de dados**, nunca um só:

- **Definição Mestra** — tudo, inclusive nós ainda ocultos. Vive numa flag de um `JournalEntry` oculto, com permissão `None` para jogadores.
- **Estado do Jogador** — só o que já foi revelado. Vive numa flag do próprio `Actor`.

O `ConstellationRepository` é o único código autorizado a ler/escrever essas flags; todo o resto do módulo trabalha só com os tipos abaixo.

---

## 2. Tipos fundamentais

```typescript
type AspectType =
  | 'mechanical'   // Aspecto mecânico
  | 'narrative'    // Aspecto narrativo
  | 'historical'   // Aspecto histórico
  | 'secret'       // Aspecto secreto
  | 'final'        // Aspecto final
  | 'legendary'    // Aspecto lendário
  | 'exclusive';   // Aspecto exclusivo

interface RarityTier {
  id: string;        // ex.: "common", "singular"
  label: string;      // nome de exibição (localizável)
  color: string;      // cor usada na aparência do nó
  order: number;      // ordem visual, do mais comum ao mais raro (hoje é só metadado — nada no código ordena por ele ainda)
}

interface Category {
  id: string;
  label: string;
  color?: string;
}

interface MediaRefs {
  icon?: string;
  image?: string;
  background?: string;
  soundReveal?: string;
  soundUnlock?: string;
  soundSelect?: string;
}

interface Position {
  x: number;
  y: number;
}
```

> Nota de implementação: `MediaRefs.background` (dentro de um nó individual) nunca chegou a ser usado — o fundo implementado de verdade é o de **constelação inteira** (`ConstellationDefinition.background`, seção 6), não por nó. O campo continua no tipo por não atrapalhar nada, mas não tem nenhum código lendo `AspectNode.media.background`.

---

## 3. AspectNode — nó dentro da Definição Mestra

```typescript
interface AspectNode {
  id: string;                          // identificador estável, referenciado por conexões
  name: string;
  subtitle?: string;
  description?: string;                // texto rico (HTML)
  quote?: string;
  media: MediaRefs;
  color?: string;                      // sobrescreve a cor padrão da raridade, se definida
  categoryId?: string;                 // referencia Category.id
  rarityId: string;                    // referencia RarityTier.id
  type: AspectType;
  position: Position;
  requirements?: string;               // descrição livre da Missão exigida (controle fica fora do módulo)
  gmNotes?: string;                    // observações do Mestre — nunca copiado ao Estado do Jogador
  visibility: 'hidden' | 'revealed';   // controla se este nó já foi revelado pelo Mestre
  unlocked: boolean;                   // se um Ponto da Apoteose já foi gasto aqui
}
```

`visibility` e `unlocked` são independentes de propósito: um nó pode estar `revealed` e ainda não `unlocked` — é exatamente esse o estado dos "próximos caminhos disponíveis" que o GDD descreve (seção "Nós Secretos"). Um nó `revealed` e não `unlocked` também pode estar temporariamente inalcançável por dois motivos distintos, calculados ao vivo (nunca armazenados no próprio nó): **exclusão mútua** (seção 5, permanente) e **pré-requisito não cumprido** (seção 5.1, reversível conforme o resto da constelação muda).

---

## 4. PlayerVisibleNode — o que o jogador realmente recebe

```typescript
interface PlayerVisibleNode {
  id: string;
  name: string;
  subtitle?: string;
  description?: string;
  quote?: string;
  media: MediaRefs;
  color?: string;
  categoryId?: string;
  rarityId: string;
  type: AspectType;
  position: Position;
  unlocked: boolean;
}
```

Note o que **não** existe aqui: `visibility` (se está neste array, já é `revealed` por definição), `requirements` e `gmNotes` (informação de bastidor do Mestre). Um `AspectNode` só vira um `PlayerVisibleNode` no momento em que sua `visibility` passa para `'revealed'` — a cópia é feita pelo `ConstellationService`, nunca editada diretamente no Estado do Jogador.

---

## 5. PathConnection e ExclusionPair — caminhos e exclusão mútua

```typescript
interface PathConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

interface ExclusionPair {   // ConstellationDefinition.exclusions (schema v3)
  a: string;                // desbloquear um dos dois fecha o outro, nos dois sentidos
  b: string;
}
```

Uma conexão só aparece no Estado do Jogador se **ambos** `fromNodeId` e `toNodeId` já estiverem revelados — isso é calculado, não armazenado separadamente. As exclusões **nunca** vão para o Estado do Jogador.

A situação de cada Aspecto (`NodeStatus`: `unlocked`, `available`, `prerequisite`, `excluded`) é sempre calculada a partir dos nós desbloqueados, por `computeNodeStatuses` (`src/utils/node-status.ts`):

1. desbloqueado vence tudo;
2. se o par de exclusão de um Aspecto foi desbloqueado, ele fecha (`excluded`);
3. **ramo morto:** se todos os caminhos que chegam a um Aspecto vêm de Aspectos fechados, ele fecha também (propaga até estabilizar). Por isso basta marcar a exclusão entre as duas escolhas rivais; o resto do ramo segue sozinho;
4. pré-requisito (seção 5.1).

*Até o schema v2* a exclusão morava em `PathConnection.excludedByNodeIds` e só valia num sentido. Dois defeitos levaram à troca: um caminho novo até um Aspecto já excluído o reabria em silêncio, e marcar "A exclui B" marcava junto tudo que vinha depois de B. A migração 2→3 (seção 9) converte os dados antigos.

### 5.1 Pré-requisito de compra em cadeia

O pré-requisito **não tem um campo próprio no schema** — é derivado da direção dos caminhos: um Aspecto com caminhos de chegada só pode ser desbloqueado se pelo menos uma origem já estiver `unlocked`. Sem caminho de chegada (o nó inicial ou um nó solto), está disponível.

### 5.2 Estado do Jogador já traz a situação

`PlayerVisibleNode.status` é gravado pelo Mestre junto com o Estado do Jogador, calculado sobre a Definição Mestra inteira (inclusive nós ocultos e exclusões). O jogador recebe o resultado pronto e nunca vê o que o determinou.

---

## 6. ConstellationDefinition — documento raiz da Definição Mestra

```typescript
interface HistoryEntry {
  date: string;            // ex.: "12/08/2026"
  nodeId: string;          // pode ser "" quando a entrada não está ligada a um Aspecto específico
  chapterTitle?: string;   // ex.: "O Último Bastião"
  kind?: 'unlock';         // v1.4: registro automático feito ao desbloquear um Aspecto
  nodeName?: string;       // v1.4: nome do Aspecto no momento do registro (a entrada sobrevive se ele for removido); nunca vai ao jogador
}

interface ConstellationDefinition {
  schemaVersion: number;
  actorId: string;
  initialNodeId: string;
  unspentPoints: number;   // Pontos da Apoteose concedidos e ainda não investidos
  nodes: AspectNode[];
  connections: PathConnection[];
  categories: Category[];
  rarities: RarityTier[];
  background?: string;         // imagem de fundo da constelação inteira — ladrilhada/infinita no canvas, não estática
  backgroundMusic?: string;    // música de fundo, toca em loop enquanto o Editor/Observatório desta constelação estiver aberto
  history: HistoryEntry[];
}
```

---

## 7. PlayerConstellationState — documento raiz do Estado do Jogador

```typescript
interface PlayerConstellationState {
  schemaVersion: number;
  actorId: string;
  initialNodeId: string;
  unspentPoints: number;   // espelhado da Definição Mestra — não é segredo, o jogador precisa saber que tem um ponto para investir
  nodes: PlayerVisibleNode[];
  connections: PathConnection[];
  categories: Category[];
  rarities: RarityTier[];
  background?: string;
  backgroundMusic?: string;
  history: HistoryEntry[];
}
```

`categories`, `rarities`, `background`, `backgroundMusic` e `history` são espelhados integralmente (não têm componente secreto) — só `nodes` e `connections` passam pelo filtro de revelação. Uma ressalva sobre `history`: o campo em si é espelhado por inteiro, mas a **exibição** do nome de um Aspecto associado a uma entrada é responsabilidade da camada de aplicação, não deste schema — se o `nodeId` de uma entrada aponta pra um Aspecto que não está em `nodes` (ainda oculto pro jogador), a interface do jogador simplesmente não mostra o nome, só a data e o título do capítulo. Ver Arquitetura de Software / camada de aplicação para esse detalhe.

---

## 8. Mapeamento para flags do Foundry

| Documento | Chave da flag | Conteúdo |
|---|---|---|
| `Actor` | `constelacao-da-apoteose.playerState` | `PlayerConstellationState` |
| `Actor` | `constelacao-da-apoteose.masterJournalId` | id do `JournalEntry` mestre correspondente |
| `JournalEntry` (oculto — permissão `None` para jogadores, `Owner` para o Mestre) | `constelacao-da-apoteose.masterDefinition` | `ConstellationDefinition` |

O vínculo Ator → Definição Mestra é bidirecional por id: o Ator guarda o id do `JournalEntry`, e o `ConstellationRepository` usa esse id para buscar a definição completa sempre que o Mestre abre o Editor.

---

## 9. Versionamento e migração *(reescrita por completo na v1.2 — deixou de ser um placeholder)*

Tanto `ConstellationDefinition` quanto `PlayerConstellationState` carregam `schemaVersion`. A versão atual é `2` (`CURRENT_SCHEMA_VERSION` em `src/constants.ts`).

A engine de migração vive em `ConstellationRepository` (`src/data/constellation-repository.ts`) e é real, não mais um placeholder que lançava erro:

- Uma tabela `MIGRATIONS` mapeia **versão de origem → função de transformação**. Cada função migra de UMA versão pra próxima (nunca pula) e devolve o documento já com `schemaVersion` incrementado.
- `#migrate` aplica os degraus em cadeia, na ordem, até alcançar `CURRENT_SCHEMA_VERSION`. Se faltar um degrau na tabela, lança `ConstellationError('SCHEMA_MIGRATION_FAILED', ...)` — nunca segue em frente com dado parcialmente migrado.
- Se um documento estiver numa versão **mais nova** que `CURRENT_SCHEMA_VERSION` (ex.: salvo por uma build futura do módulo, depois revertida), também lança `SCHEMA_MIGRATION_FAILED` — nunca tenta "desmigrar".
- Depois de migrar de verdade (a referência do objeto muda), o resultado é persistido de volta na flag, pra não repetir a migração em toda leitura seguinte.
- `PlayerConstellationState` também é verificado: se ficar desatualizado (o Mestre nunca reabriu o Editor depois de uma migração), e for o Mestre lendo, o Estado do Jogador é re-derivado automaticamente da Definição Mestra já migrada. Se for o jogador lendo primeiro, ele recebe o documento como está — como os campos novos costumam ser opcionais, nada quebra, só demora até o Mestre abrir o Editor uma vez.

### Migração 1 → 2 (a única existente até agora)

```typescript
1: (raw) => ({
  ...raw,
  schemaVersion: 2,
  connections: raw.connections.map((connection) => ({
    ...connection,
    excludedByNodeIds: connection.excludedByNodeIds ?? [],
  })),
});
```

`backgroundMusic` não precisou de nenhuma transformação nessa migração — por ser um campo opcional, um documento antigo sem ele continua funcionando normalmente, só ganha o campo na próxima vez que a constelação for salva.

### Como adicionar uma migração nova no futuro

1. Incremente `CURRENT_SCHEMA_VERSION` em `src/constants.ts`.
2. Acrescente uma entrada na tabela `MIGRATIONS`, chaveada pela versão de origem (a que está saindo), transformando o documento pro formato novo.
3. Nunca faça só um dos dois passos — incrementar a versão sem a migração correspondente faz `#migrate` lançar `SCHEMA_MIGRATION_FAILED` pra qualquer documento antigo; escrever a migração sem incrementar a versão faz ela nunca ser executada.

---

## 10. Valores padrão ao criar uma nova constelação

Ao criar uma constelação nova, o módulo semeia `categories` e `rarities` com os exemplos do GDD (seções "Raridade" e "Categorias") — Comum a Singular, e Guerra/Magia/Divino/Destino/Abismo/Tecnologia/Natureza (`DEFAULT_RARITIES`/`DEFAULT_CATEGORIES` em `src/constants.ts`).

Isso só define o **ponto de partida**. Depois de criada, ambas as listas são totalmente editáveis pelo Mestre direto na interface do Editor (seção "Configurações da Constelação" → Categorias/Raridades) — adicionar, renomear, trocar cor, reordenar (raridade) e remover, sem precisar editar `constants.ts`. Editar `constants.ts` só muda o padrão de constelações **futuras**, nunca afeta uma já existente.

---

## 11. Compatibilidade com NPCs e chefes

O schema não faz nenhuma distinção entre PC, NPC ou chefe — todos são apenas um `actorId`. Qualquer Ator do Foundry pode ter sua própria Definição Mestra e Estado do Jogador, exatamente como o GDD exige (seção "Estrutura Geral").

---

## 12. Configurações que NÃO fazem parte deste schema

Duas coisas relacionadas a mídia vivem fora do schema da constelação, como configurações do Foundry por pessoa (`game.settings`, scope `client`), porque são preferência de quem está jogando, não dado da campanha:

- **Volume dos efeitos sonoros** (`soundReveal`/`soundUnlock`/`soundSelect`) — 0 a 100, padrão 80.
- **Volume da música de fundo** — 0 a 100, padrão 50.

Ambas ficam em `src/services/sound-settings.ts`. Zero funciona como "mudo" sem precisar de um campo booleano separado. Nenhuma delas é salva na `ConstellationDefinition`/`PlayerConstellationState` — não faz sentido essas preferências pessoais viajarem junto com os dados da constelação, e principalmente não fariam sentido replicadas por jogador dentro do mesmo documento.

---

## Próximos passos

Este documento reflete o schema real em produção. Junto com o GDD v1.2 e a API Interna v1.1, é isso que deve ser reanexado em qualquer conversa futura para retomar o projeto exatamente de onde parou. Frentes de schema que ainda podem crescer no futuro: formato de import/export (seção 13 do GDD, ainda não decidido) e, se o mixer de som dedicado sair do papel, provavelmente um novo campo por constelação pra volume "sugerido pelo Mestre" (hoje é 100% preferência de cada jogador, sem opinião nenhuma da campanha).

# API Interna — Constelação da Apoteose
### Documento vivo do projeto · Módulo para Foundry VTT

**Versão do documento:** 1.1
**Data:** 13/07/2026 (revisado em 25/07/2026)
**Depende de:** GDD v1.2 · TDD v1.0 · Arquitetura de Software v1.0 · Estrutura de Pastas v1.0 · Banco de Dados v1.2 · Wireframes v1.0 · Fluxo de Navegação v1.0
**Status:** Aprovado — reflete a API real do `ConstellationService` após a etapa de implementação

> **Changelog v1.1 (25/07/2026):** a v1.0 foi escrita como o "último documento antes do código de verdade" — a implementação real acrescentou métodos, códigos de erro e hooks que não estavam previstos. Este documento foi atualizado pra refletir a API como ela existe hoje:
> - Três novos códigos de erro (seção 2): `NODE_EXCLUDED`, `PREREQUISITE_NOT_MET`, `NOT_INITIALIZED`.
> - Novos métodos: `revokePoint` (contrapartida de `grantPoint`) e `updateConstellationSettings` (fundo/música da constelação inteira).
> - `updateCategories`, `updateRarities` e `addHistoryEntry` — já estavam na v1.0 como planejados, agora confirmados implementados e com interface própria no Editor.
> - `revokePoint` entrou na API pública (seção 8), ao lado de `grantPoint`.
> - Novo hook público: `constelacaoApoteose.pointRevoked` (seção 9).

---

## 0. Sobre este documento

Este documento descreve a API real do `ConstellationService` — a única porta de entrada pra ler/escrever dados da constelação (Arquitetura de Software, seção 4). O formato padronizado de erro, e como o módulo se expõe para macros e outros módulos do usuário, também estão aqui.

---

## 1. Convenções gerais

- Toda operação de escrita passa pelo `PermissionGate` antes de chegar ao `ConstellationRepository`; falha de permissão nunca retorna `null` silenciosamente — sempre lança `ConstellationError`.
- Todos os métodos são assíncronos (`Promise`), já que leem/escrevem documentos do Foundry.
- `actorId` é sempre o primeiro parâmetro — todo método da API opera sobre um personagem específico.

---

## 2. ConstellationError — códigos padronizados

```typescript
class ConstellationError extends Error {
  code:
    | 'NOT_GM'                  // operação de escrita tentada sem permissão de Mestre
    | 'ACTOR_NOT_FOUND'
    | 'NODE_NOT_FOUND'
    | 'CONNECTION_NOT_FOUND'
    | 'NO_POINTS_AVAILABLE'     // tentativa de desbloquear sem Pontos da Apoteose disponíveis
    | 'NODE_EXCLUDED'           // tentativa de desbloquear um nó com todos os caminhos fechados por exclusão mútua
    | 'PREREQUISITE_NOT_MET'    // tentativa de desbloquear sem nenhuma origem já desbloqueada (seção 5.1 do Banco de Dados)
    | 'SCHEMA_MIGRATION_FAILED' // documento com schemaVersion sem migração definida, ou mais novo que o módulo instalado
    | 'NOT_INITIALIZED';        // jogador tentou ler uma constelação que o Mestre ainda não abriu nenhuma vez
}
```

Os três últimos códigos (`NODE_EXCLUDED`, `PREREQUISITE_NOT_MET`, `NOT_INITIALIZED`) não existiam na v1.0 deste documento — surgiram durante a implementação, junto com as regras que eles protegem.

---

## 3. Métodos de leitura

```typescript
getPlayerState(actorId: string): Promise<PlayerConstellationState>   // lança NOT_INITIALIZED se o Mestre nunca abriu o Editor
getMasterDefinition(actorId: string): Promise<ConstellationDefinition>   // lança NOT_GM se quem chama não for Mestre
```

---

## 4. Métodos de escrita — nó

```typescript
createNode(actorId: string, position: Position, initialData?: Partial<Omit<AspectNode, 'id' | 'position'>>): Promise<AspectNode>
updateNode(actorId: string, nodeId: string, changes: Partial<AspectNode>): Promise<AspectNode>
removeNode(actorId: string, nodeId: string): Promise<void>
moveNode(actorId: string, nodeId: string, position: Position): Promise<void>
```

`createNode` semeia valores padrão razoáveis (nome "Novo Aspecto", raridade = primeira raridade da constelação, tipo "narrativo", `visibility: 'hidden'`, `unlocked: false`) — `initialData` sobrescreve qualquer um desses campos, exceto `id` e `position` (que têm parâmetro próprio).

---

## 5. Métodos de escrita — conexões

```typescript
connectNodes(actorId: string, fromNodeId: string, toNodeId: string): Promise<PathConnection>   // INVALID_CONNECTION se for laço ou duplicado
disconnectNodes(actorId: string, connectionId: string): Promise<void>
reverseConnection(actorId: string, connectionId: string): Promise<void>                       // troca origem e destino
setExclusive(actorId: string, nodeA: string, nodeB: string, exclusive: boolean): Promise<void>
```

`setExclusive` (v1.3, substitui `setExclusion`) liga ou desliga a exclusão mútua entre **dois Aspectos**, nos dois sentidos (Banco de Dados, seção 5). `removeNode` leva junto as exclusões do nó removido.

Todas as escritas passam por uma fila por Ator: duas chamadas seguidas (ex.: arrastar e editar um campo) nunca leem o mesmo documento e se sobrescrevem.

---

## 6. Métodos de escrita — visibilidade e progressão

```typescript
revealNode(actorId: string, nodeId: string): Promise<void>
hideNode(actorId: string, nodeId: string): Promise<void>     // desfazer revelação

grantPoint(actorId: string, amount?: number): Promise<void>   // incrementa unspentPoints (padrão: 1)
revokePoint(actorId: string, amount?: number): Promise<void>  // decrementa unspentPoints (padrão: 1) — nunca deixa negativo, satura em 0
unlockNode(actorId: string, nodeId: string): Promise<void>    // consome 1 unspentPoint; lança NO_POINTS_AVAILABLE, NODE_EXCLUDED ou PREREQUISITE_NOT_MET
lockNode(actorId: string, nodeId: string): Promise<void>      // desfazer desbloqueio; devolve o ponto consumido
```

`unlockNode` e `lockNode` são o par que sustenta o fluxo de "desfazer" descrito no Fluxo de Navegação (seção 4) — desfazer um desbloqueio devolve exatamente 1 ponto a `unspentPoints`, nunca cria ou destrói pontos.

`revokePoint` (novo na v1.1) é a contrapartida direta de `grantPoint` — existe pra o Mestre corrigir um ponto concedido por engano, sem precisar zerar e reconceder manualmente.

`unlockNode` verifica, nesta ordem: permissão de Mestre → existência do nó → já desbloqueado (não faz nada) → exclusão mútua (`NODE_EXCLUDED`) → pré-requisito de origem (`PREREQUISITE_NOT_MET`) → pontos disponíveis (`NO_POINTS_AVAILABLE`). O Aspecto inicial não pode ser removido nem bloqueado (`INITIAL_NODE`).

```typescript
removeHistoryEntry(actorId: string, index: number): Promise<void>
updateHistoryEntry(actorId: string, index: number, changes: { chapterTitle?: string; date?: string }): Promise<void>   // v1.4
organizeJournals(only?: JournalEntry[]): Promise<{ moved: number; orphans: string[] }>                                // v1.4: arruma os diários ocultos na pasta do módulo
restoreDefinition(actorId: string, snapshot: ConstellationDefinition): Promise<void>  // Desfazer/Refazer do Editor
migrateOutdatedPlayerStates(): Promise<number>                                         // chamado no `ready` pelo Mestre ativo
```

---

## 7. Métodos de escrita — configurações da constelação, categorias, raridades e histórico

```typescript
updateConstellationSettings(actorId: string, changes: Partial<Pick<ConstellationDefinition, 'background' | 'backgroundMusic'>>): Promise<void>
updateCategories(actorId: string, categories: Category[]): Promise<void>
updateRarities(actorId: string, rarities: RarityTier[]): Promise<void>
addHistoryEntry(actorId: string, entry: HistoryEntry): Promise<void>
```

`updateConstellationSettings` é novo na v1.1 — cobre fundo (imagem ladrilhada/infinita) e música de fundo da constelação inteira, que não pertencem a um Aspecto específico. `updateCategories`/`updateRarities` recebem a lista inteira já modificada (adicionar, renomear, remover ou reordenar são todos, na prática, "montar a lista nova e mandar de volta") — não existem métodos separados de "adicionar uma categoria" ou "remover uma raridade" na API, essa granularidade fica só do lado da interface.

---

## 8. API pública para macros e outros módulos

Um subconjunto curado do `ConstellationService` é exposto em `game.modules.get('constelacao-da-apoteose').api` durante o hook `init` — permitindo que o Mestre conceda ou remova pontos, revele nós, ou leia o estado por macro, sem abrir o Editor:

```typescript
game.modules.get('constelacao-da-apoteose').api = {
  grantPoint,
  revokePoint,      // novo na v1.1
  unlockNode,
  revealNode,
  getPlayerState,
  open,             // v1.3: (actorId) → Editor para o Mestre, Observatório para o dono do Ator
  openObservatory,  // v1.3: (actorId, nodeId?) → visão do jogador (o Mestre também pode usar); com nodeId, já seleciona o Aspecto
  diagnose,         // v1.4: relatório para o console (abre cada constelação, testa o canvas, lista diários órfãos)
  selfTest,         // v1.4: teste de ponta a ponta como Mestre; cria um Ator temporário e apaga no fim (usado por `npm run smoke`)
};
```

Exemplo de uso numa macro do Mestre:

```javascript
await game.modules.get('constelacao-da-apoteose').api.grantPoint(actor.id);
```

Apenas métodos considerados seguros para automação externa entram nessa lista — `removeNode` e `setExclusive`, por exemplo, ficam de fora da API pública por serem operações estruturais mais arriscadas para um script rodar sem supervisão direta no Editor.

---

## 9. Hooks públicos disparados pelo módulo

Para que outros módulos ou macros reajam a eventos sem precisar chamar a API diretamente:

| Hook | Quando dispara | Argumentos |
|---|---|---|
| `constelacaoApoteose.nodeRevealed` | Após `revealNode` | `(actorId, nodeId)` |
| `constelacaoApoteose.nodeUnlocked` | Após `unlockNode` | `(actorId, nodeId)` |
| `constelacaoApoteose.pointGranted` | Após `grantPoint` | `(actorId, amount)` |
| `constelacaoApoteose.pointRevoked` | Após `revokePoint` | `(actorId, amount)` — novo na v1.1 |

Esses hooks são locais (`Hooks.callAll`, não via socket) — disparam só no client de quem executou a ação. Como toda ação mutável roda do lado do Mestre, um macro/módulo que escuta esses hooks pensado pra reagir "sempre que algo mudar em qualquer client" também deveria escutar `updateActor`/`updateJournalEntry` do próprio Foundry, não só estes hooks do módulo.

---

## 10. Tabela-resumo

| Método | Exige Mestre | Pode lançar |
|---|---|---|
| `getPlayerState` | Não | `ACTOR_NOT_FOUND`, `NOT_INITIALIZED` |
| `getMasterDefinition` | Sim | `NOT_GM`, `ACTOR_NOT_FOUND` |
| `createNode` / `updateNode` / `removeNode` / `moveNode` | Sim | `NOT_GM`, `NODE_NOT_FOUND`, `INITIAL_NODE` |
| `connectNodes` / `disconnectNodes` / `reverseConnection` / `setExclusive` | Sim | `NOT_GM`, `NODE_NOT_FOUND`, `CONNECTION_NOT_FOUND`, `INVALID_CONNECTION` |
| `revealNode` / `hideNode` | Sim | `NOT_GM`, `NODE_NOT_FOUND` |
| `grantPoint` / `revokePoint` | Sim | `NOT_GM` |
| `unlockNode` | Sim | `NOT_GM`, `NODE_NOT_FOUND`, `NO_POINTS_AVAILABLE`, `NODE_EXCLUDED`, `PREREQUISITE_NOT_MET` |
| `lockNode` | Sim | `NOT_GM`, `NODE_NOT_FOUND` |
| `updateConstellationSettings` / `updateCategories` / `updateRarities` | Sim | `NOT_GM` |
| `addHistoryEntry` | Sim | `NOT_GM` |

---

## 11. Migração de schema — o que muda pra quem consome esta API

Quem chama `getMasterDefinition`/`getPlayerState` nunca precisa se preocupar com `schemaVersion` diretamente — a migração (Banco de Dados, seção 9) já acontece de forma transparente dentro do `ConstellationRepository`, antes do documento chegar ao `ConstellationService`. O único jeito de a migração vazar pra quem chama a API é através de `SCHEMA_MIGRATION_FAILED`, se um degrau de migração estiver faltando ou se o documento for de uma versão mais nova que o módulo instalado.

---

## Próximos passos

Esta é a API Interna como ela existe hoje, em conjunto com o GDD v1.2 e o Banco de Dados v1.2. Não há mais planejamento pendente aqui — qualquer método novo que surgir no futuro deve ser adicionado a este documento no mesmo momento em que for implementado, não depois, pra este arquivo não voltar a ficar desatualizado.

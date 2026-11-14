# Game Design Document — Constelação da Apoteose
### Documento vivo do projeto · Módulo para Foundry VTT

**Versão do documento:** 1.2
**Data:** 12/07/2026 (revisado em 13/07/2026, revisado em 25/07/2026)
**Status:** Aprovado — reflete o estado real do módulo após a etapa de implementação e refinamento

> **Changelog v1.2 (25/07/2026):** documento atualizado para refletir tudo que foi implementado, corrigido e adicionado durante a etapa 9 (implementação) — que foi bem além do MVP original definido na seção 15 da v1.1. Principais mudanças de design registradas aqui:
> - **Versão-alvo do Foundry corrigida para V13** (seção 2) — a v1.1 registrava V14 por engano; o comportamento real observado no Foundry (e várias correções de bugs específicas de API) confirmam V13.
> - **Nova regra de progressão: pré-requisito de compra em cadeia** (seção 6) — não existia na v1.1.
> - **Mecanismo real de exclusão mútua** (seção 9) documentado como efetivamente implementado — difere um pouco da descrição conceitual original.
> - **Som, mídia visual (ícone/imagem) e música de fundo** saíram de "fora do MVP" (v1.1, seção 15) para **implementados** (seção 15 atualizada).
> - **Versionamento/migração de schema** saiu de "fora do MVP" para **implementado de verdade** (seção 14).
> - **Linha do Tempo da Lenda** (seção 12) ganhou interface — antes só existia como conceito.
> - Escopo do MVP (seção 15) e Roadmap (seção 16) reescritos para refletir o que já foi entregue vs. o que ainda falta.

> **Changelog v1.1:** seção 6 (Ciclo de Progressão) ajustada para deixar explícito que a execução do desbloqueio é sempre do Mestre, mesmo quando é o jogador quem decide em qual nó investir o ponto — consistente com a seção 7 (jogadores nunca editam a constelação) e com o documento original do projeto.

---

## 0. Sobre este documento

Este GDD é a primeira etapa do processo definido para o projeto (GDD → TDD → Arquitetura → Estrutura de pastas → Modelos de dados → Wireframes → Fluxo de navegação → API interna → Implementação). Ele não contém decisões técnicas — isso pertence ao TDD. Aqui tratamos de **conceito, sensação, regras de design e experiência**.

Este arquivo deve ser tratado como fonte de verdade. Em conversas futuras, reanexe-o (junto dos demais documentos gerados) para que o trabalho continue exatamente de onde parou. Um guia complementar, `CUSTOMIZACAO.md`, cobre onde mexer no código pra adaptar textos/cores/valores padrão a outro cenário — não repete o que já está aqui.

---

## 1. Visão do Projeto

**Pitch central:** Constelação da Apoteose é um sistema de evolução narrativa para Foundry VTT em que cada personagem constrói, ao longo da campanha, uma constelação única e irrepetível de Aspectos — marcos que registram quem o personagem *se tornou*, não apenas o que ele *pode fazer*. A progressão é inteiramente controlada pelo Mestre e nunca é automática, reversível ou padronizada entre personagens.

### Pilares de Design (em ordem de prioridade)

1. **Identidade acima de poder.** Um Aspecto deve ser lembrado como "a cicatriz que o Luan carrega desde que traiu o Último Bastião", não como "+2 de dano".
2. **Escolha permanente e excludente.** Escolher um caminho deve doer um pouco — porque fecha outro para sempre.
3. **Mistério ativo.** A constelação nunca é um menu; é um céu que se revela aos poucos, no ritmo da história.
4. **Autoridade total do Mestre.** Nada acontece sozinho. Pontos, desbloqueios e revelações são sempre uma decisão humana do Mestre.
5. **Model agnosticism mecânico.** O módulo registra a lenda; a ficha do sistema (5e, PoE2 RPG, sistema autoral, etc.) é responsabilidade do grupo.

### O que este sistema **não é**

- Não é uma árvore de talentos numérica com "builds ótimas".
- Não é uma cópia visual ou estrutural de Path of Exile — a referência é apenas de *sensação de escala e descoberta*.
- Não é um sistema de progressão automática por XP, nível ou marcos de sistema.
- Não é compartilhado entre personagens — cada constelação é solitária e específica.

---

## 2. Decisões fundamentais já tomadas

| Decisão | Escolha | Justificativa |
|---|---|---|
| Versão-alvo do Foundry VTT | **V13**, usando ApplicationV2 | *(corrigido na v1.2 — a v1.1 registrava V14 por engano)* API moderna e com vida útil pela frente; evita reescrever a camada de UI logo após o lançamento. Atenção: V13 removeu algumas referências globais que existiam até a V12 (ex.: `AudioHelper` precisa ser acessado via `foundry.audio.AudioHelper`) — um detalhe que já causou pelo menos um bug real durante a implementação. |
| Direção visual/tom | **Mística e etérea** — cores suaves, onírico | Reforça a ideia de "lenda pessoal" e "céu vivo" sem cair no tom sombrio genérico de outros sistemas de progressão. |
| Foco do primeiro marco funcional (MVP) | **Editor do Mestre completo** | Sem uma ferramenta de criação sólida, não existe conteúdo para o jogador ver — o editor é o gargalo real do projeto. |

Essas três decisões condicionam todo o restante deste documento. Qualquer mudança futura nelas deve ser registrada aqui, com data e motivo.

---

## 3. Filosofia da Constelação

A Constelação da Apoteose representa a **lenda** do personagem — não sua ficha, não seu build, não seu inventário. Cada estrela é um Aspecto: um momento, uma escolha, uma marca deixada pela narrativa. Os caminhos entre estrelas representam as escolhas feitas ao longo da vida do personagem, e **nenhum personagem jamais completa sua constelação inteira** — escolher um ramo significa, por definição, abrir mão de outro.

A constelação deve parecer **viva**: ela cresce conforme o Mestre revela novos trechos do céu, nunca por uma barra de progresso ou contador que o jogador possa antecipar. O objetivo emocional é duplo:

- **Apego:** o jogador deve sentir que perder aquele personagem é perder uma história que não pode ser reconstruída.
- **Curiosidade:** o jogador deve genuinamente não saber o que existe além da próxima estrela visível.

---

## 4. Anatomia da Constelação (conceitual)

Uma constelação é composta por:

- **Nó Inicial** — obrigatório, ponto de partida de todo personagem.
- **Nós intermediários** — a maioria das estrelas; podem ou não ter efeito mecânico.
- **Nós finais** — marcos de grande peso narrativo, normalmente o fim de um ramo temático.
- **Nós puramente narrativos** — não concedem nada mecânico, apenas registram um acontecimento importante (ex.: "Luan testemunhou a queda do Bastião").
- **Nós secretos** — existem no design, mas são invisíveis até que o Mestre os revele.

As conexões entre nós formam **caminhos direcionais**, que podem:
- se ramificar (um nó leva a múltiplos seguintes);
- se cruzar (dois ramos distintos convergem em um nó comum);
- se **excluir mutuamente** (desbloquear um fecha permanentemente o acesso a outro, por decisão do Mestre).

O jogador, em qualquer momento, só enxerga: os nós já desbloqueados e os próximos nós **disponíveis** a partir deles. Tudo o resto — inclusive a existência de ramos inteiros — permanece oculto até revelação manual do Mestre.

---

## 5. Aspectos — a unidade central

### Tipos de Aspecto

| Tipo | Função |
|---|---|
| Mecânico | Efeito a ser aplicado manualmente na ficha do sistema em uso |
| Narrativo | Registro de um evento ou traço de personalidade, sem efeito mecânico |
| Histórico | Marca um fato consumado da campanha (ex.: uma morte, uma traição) |
| Secreto | Existe oculto até ser revelado pelo Mestre |
| Final | Encerra um ramo temático da constelação |
| Lendário | Aspecto de altíssimo impacto narrativo, tipicamente único na campanha |
| Exclusivo | Sua escolha bloqueia permanentemente um ou mais outros Aspectos |

### Campos de um Aspecto (nível conceitual — o esquema de dados exato é assunto do Banco de Dados)

Nome, Subtítulo, Descrição, Citação, Imagem, Ícone, Cor, Categoria, Fundo personalizado, Som personalizado, Raridade, Requisitos, Caminhos seguintes, Caminhos bloqueados, Observações do Mestre. **Todos esses campos estão implementados e funcionais**, incluindo ícone/imagem/sons — que na v1.1 ainda estavam listados como "fora do MVP" (ver seção 15).

### Raridade

Comum → Incomum → Raro → Épico → Lendário → Singular. A raridade é **puramente estética** (cor, brilho, moldura) e nunca implica poder mecânico proporcional — um Aspecto Comum pode ser tão decisivo narrativamente quanto um Singular.

A lista de raridades (nome, cor, ordem) é totalmente editável pelo Mestre direto na interface do Editor — adicionar, renomear, recolorir ou remover uma raridade não exige mexer em nenhum arquivo.

### Categorias

Livres e configuráveis pelo Mestre (ex.: Guerra, Magia, Divino, Destino, Abismo, Tecnologia, Natureza). Servem exclusivamente como filtro visual/organizacional, sem regra de jogo associada. Assim como raridades, a lista de categorias é totalmente editável pela interface do Editor.

---

## 6. Ciclo de Progressão

O ciclo nunca é automático. Ele sempre segue esta sequência:

1. O Mestre define, fora do módulo, uma **Missão** ou marco narrativo como requisito.
2. Quando o requisito é cumprido em jogo, o **Mestre marca manualmente** a missão como concluída.
3. O Mestre **concede manualmente** um Ponto da Apoteose ao personagem (nunca por XP, nível ou gatilho automático) — e pode, com a mesma facilidade, **remover** um ponto concedido por engano.
4. O jogador decide, fora do módulo, em qual nó já disponível deseja investir o ponto — mas quem **executa o desbloqueio** dentro do Editor é sempre o Mestre (seção 7: jogadores nunca editam a constelação diretamente). Na prática, o jogador também pode *solicitar* o desbloqueio pelo próprio Observatório — a solicitação é retransmitida e executada do lado do Mestre, então a regra "só o Mestre edita de verdade" continua valendo, só que sem exigir que o Mestre fique de campana clicando em cada pedido.
5. Ao desbloquear certos nós, o Mestre pode optar por **revelar novos caminhos** anteriormente ocultos — em tempo real, sem necessidade de recarregar o Foundry.
6. Efeitos mecânicos do Aspecto (se houver) são aplicados **manualmente** pelo jogador ou Mestre na ficha do sistema em uso.

### Pré-requisito de compra em cadeia *(novo na v1.2 — não existia na v1.1)*

Além da exclusão mútua (que **fecha** caminhos), existe uma segunda regra de progressão, complementar: um Aspecto só pode ser desbloqueado se **pelo menos um** dos Aspectos que levam diretamente até ele já estiver desbloqueado (o próprio Nó Inicial é a única exceção — ele nunca tem pré-requisito). Isso é automático a partir da própria direção dos caminhos já desenhados pelo Mestre no Editor — não é uma configuração extra que o Mestre precisa lembrar de marcar, ao contrário da exclusão mútua.

Quando um Aspecto tem **mais de uma origem** (dois ramos diferentes convergindo nele), basta **um** desses ramos já ter sido escolhido — não é necessário ter comprado todos. Isso mantém o espírito de "ramos alternativos" da constelação: convergir dois caminhos num nó comum não deveria forçar o jogador a ter feito as duas escolhas anteriores, só uma delas.

---

## 7. Papéis e Permissões

**Jogadores podem:**
- Ver apenas a própria constelação.
- Ver nós desbloqueados e os próximos caminhos disponíveis.
- Abrir o painel lateral de um Aspecto para ler suas informações.
- Abrir o Modo Observatório da própria constelação.
- Solicitar o desbloqueio de um Aspecto disponível (a execução de fato continua sendo do Mestre — ver seção 6).

**Jogadores nunca podem:**
- Editar qualquer parte da constelação.
- Revelar nós ocultos.
- Alterar requisitos, bloqueios ou conceder pontos a si mesmos.

**O Mestre pode:**
- Criar, editar e remover constelações inteiras (de PCs, NPCs e chefes).
- Revelar nós, conceder ou remover pontos, editar restrições e bloqueios.
- Editar em tempo real durante a sessão, com reflexo imediato para os jogadores — isso já funciona hoje através do próprio mecanismo de atualização de documentos do Foundry (ver seção 15), sem precisar de infraestrutura de socket dedicada.
- Editar categorias, raridades e registrar entradas na Linha do Tempo da Lenda (seção 12), tudo pela interface do Editor.
- Importar, exportar e compartilhar constelações com outros Mestres — **ainda não implementado**, continua fora do escopo atual (ver seção 15).

---

## 8. Identidade Visual — Direção Mística e Etérea

Com a direção "mística e etérea" escolhida, a identidade visual do módulo deve evocar suavidade, sonho e reverência — o oposto de um HUD agressivo de jogo de ação.

- **Paleta:** tons profundos de azul-anil e roxo-ameixa como base do céu, com acentos suaves em dourado-pálido, lavanda e branco-perolado para estrelas e linhas ativas. Evitar vermelhos saturados ou contrastes duros — a raridade se expressa por **luminosidade e sutileza de brilho**, não por cores gritantes.
- **Textura:** poeira cósmica como névoa suave (não ruído áspero), transições em gradiente, nunca bordas rígidas. O fundo por trás das estrelas pode ser uma imagem personalizada, ladrilhada de forma contínua (sem costura visível) pra dar sensação de céu infinito, em vez de uma única imagem estática limitada.
- **Movimento:** tudo se move como se estivesse respirando — pulsação lenta nas estrelas desbloqueadas, linhas que "acendem" com um fade gradual (nunca um "pop" instantâneo), zoom e pan com easing suave. O zoom de aproximar responde um pouco mais rápido que o de afastar, por preferência de uso — os dois continuam suaves, nunca abruptos.
- **Tipografia (conceitual):** serifada ou caligráfica para nomes de Aspectos e citações, para reforçar o tom de "lenda antiga sendo escrita"; interface funcional (painéis, botões) em fonte limpa e legível.
- **Som:** ambientes etéreos e reverberantes (coros distantes, sinos suaves, cordas longas) — nunca efeitos percussivos ou "de conquista de game arcade". Cada pessoa ajusta o próprio volume de efeitos e de música de fundo (0 funciona como mudo) — não é uma escolha imposta pelo Mestre pra mesa inteira.

Esta direção deve ser tratada como restrição de estilo em todas as telas futuras (editor, visão do jogador, Observatório).

---

## 9. Módulo em Foco: Editor do Mestre (prioridade do MVP)

Como o primeiro marco funcional prioriza o **Editor do Mestre completo**, esta seção recebe mais profundidade que as demais.

### Objetivo do Editor

Permitir que o Mestre construa uma constelação inteira — nós, conexões, restrições, mídia — sem jamais tocar em um arquivo JSON manualmente, com uma experiência comparável (em fluidez, não em escopo) a ferramentas como Unity ou Unreal.

### Áreas conceituais da tela do Editor

1. **Canvas de edição** — a nebulosa em modo de construção, zoom/pan livres, com botão de recentralizar a câmera pra quando o Mestre se perder navegando.
2. **Painel de propriedades do nó selecionado** — todos os campos de um Aspecto (seção 5), edição inline.
3. **Barra de ferramentas** — criar nó, conectar, remover conexão, remover nó, conceder/remover Ponto da Apoteose.
4. **Painel de configurações da constelação** (quando nenhum nó está selecionado) — fundo (imagem ladrilhada), música de fundo, gestão de categorias e raridades, e a Linha do Tempo da Lenda (seção 12).
5. **Painel de mídia por nó** — seleção de ícone, imagem, e os três sons (revelação, desbloqueio, seleção), com busca de arquivo integrada ao FilePicker do Foundry.

> A "Biblioteca lateral" de categorias/raridades/ícones arrastáveis, descrita na v1.1 como uma área conceitual separada, acabou implementada de outra forma: a gestão de categorias e raridades vive dentro do painel de configurações da constelação (item 4 acima), não como uma biblioteca visual de arrastar-e-soltar. O resultado funcional é o mesmo (o Mestre configura essas listas sem editar arquivo), só a interface ficou mais simples do que o conceito original previa.

### Fluxos principais (nível de experiência, não de implementação)

- **Criar uma estrela:** Mestre clica em "criar nó" no canvas → um nó em estado "rascunho" aparece → painel de propriedades abre automaticamente para preenchimento.
- **Conectar estrelas:** Mestre seleciona nó de origem → arrasta uma linha até o nó de destino → conexão é criada como caminho disponível.
- **Definir exclusão mútua:** Mestre abre o painel do Aspecto que, se escolhido, deve fechar outros ramos → marca, numa lista de "Aspectos-alvo" que aparece nesse mesmo painel, quais outros Aspectos ficam permanentemente inacessíveis quando este for desbloqueado. Um Aspecto-alvo só fica de fato travado quando **todos** os caminhos que levam até ele estiverem fechados — se ele ainda tiver outra rota aberta, continua acessível por ali. O sistema reflete essa relação visualmente (a estrela travada aparece acinzentada) tanto no Editor quanto, quando aplicável, na visão do jogador — um Aspecto que o jogador nunca chegou a ver revelado continua completamente invisível pra ele, exclusão mútua ou não.
- **Anexar mídia:** Mestre abre o painel de mídia do nó → escolhe arquivo de ícone (aparece sobreposto à própria estrela no canvas), imagem (aparece no painel de detalhes de quem clicar no Aspecto — inclusive do lado do jogador), e sons de revelação/desbloqueio/seleção, tudo com busca de arquivo integrada.

### Fora do escopo do Editor no momento atual

Ver seção 15 para a lista explícita do que ainda fica de fora.

---

## 10. Painel Lateral (Ficha do Aspecto)

Ao clicar em qualquer estrela (Editor ou visão do jogador), abre-se um **painel lateral fixo** — nunca um popup/modal flutuante — contendo nome, subtítulo, descrição, citação, imagem, categoria, raridade e (quando aplicável) observações do Mestre. Na visão do jogador, a imagem aparece flutuando no canto superior do painel, com o texto (citação/descrição) fluindo ao redor dela. Deve manter a estética etérea: transições suaves de abertura/fechamento, nunca um corte abrupto.

---

## 11. Modo Observatório

*(v1.1 registrava isso como "fora do MVP inicial", mantido "para consistência de visão nas próximas fases" — a v1.2 atualiza pra refletir o que já existe de verdade.)*

O Observatório (visão do jogador) hoje já tem: fundo animado/ladrilhado infinito, estrelas com pulsação suave, zoom/pan com easing, e trilha sonora configurável tocando em loop enquanto a janela estiver aberta. O que **ainda não existe** é o tratamento cinematográfico completo imaginado originalmente — partículas discretas flutuando pelo fundo, e um modo de tela cheia dedicado só à contemplação (hoje o Observatório é uma janela do Foundry como outra qualquer, não um modo de tela cheia separado). Ver seção 15 para o detalhamento exato do que falta.

---

## 12. Linha do Tempo da Lenda

Cada personagem mantém um registro cronológico de sua evolução (data, Aspecto relacionado — opcional —, e um "título de capítulo", como no exemplo do documento original: *"12/08/2026 — Luan despertou — 'O Último Bastião'"*). Este histórico pertence ao personagem e persiste independentemente de futuras edições da constelação em si.

**Implementado (v1.2):** o Mestre registra uma entrada quando quiser, pelo Editor, escrevendo o título do capítulo e (opcionalmente) associando a um Aspecto específico — não precisa estar necessariamente ligado ao exato momento de um desbloqueio. A linha do tempo aparece, mais recente primeiro, tanto no Editor quanto no Observatório do jogador. Uma entrada associada a um Aspecto que o jogador ainda não teve revelado aparece pra ele sem o nome desse Aspecto — a data e o título do capítulo continuam visíveis, mas sem vazar qual Aspecto é.

---

## 13. Importação, Exportação e Compartilhamento

Constelações podem ser exportadas e importadas em JSON, e compartilhadas entre Mestres. O compartilhamento é pensado como troca de **modelos/templates** de constelação — não como sincronização ao vivo entre mundos Foundry diferentes. **Ainda não implementado** — continua fora do escopo atual (seção 15).

---

## 14. Versionamento

Toda constelação carrega uma versão, permitindo que atualizações de estrutura (novos campos, novas regras) não quebrem campanhas já em andamento. **Implementado de verdade na v1.2** — o módulo tem uma cadeia real de migrações que atualiza automaticamente uma constelação salva por uma versão mais antiga do módulo, sem que o Mestre precise fazer nada manualmente. O detalhamento técnico de como isso funciona pertence ao Banco de Dados; aqui registramos que **compatibilidade retroativa é um requisito de design inegociável — e hoje é cumprido de fato, não só em princípio**.

---

## 15. Escopo Atual — o que existe vs. o que falta

*(Substitui a seção "Escopo do MVP" da v1.1, que já foi superada — quase tudo que estava listado como "fora do MVP" já foi implementado.)*

### Já implementado

- Canvas de criação/edição de nós com zoom e pan fluido, incluindo botão de recentralizar.
- Criar, mover, remover nós (com confirmação antes de remover — ação sem volta).
- Conectar e desconectar caminhos entre nós.
- Definir bloqueios/exclusões mútuas entre Aspectos (seção 9).
- Pré-requisito automático de compra em cadeia (seção 6) — **este é além do que a v1.1 previa**, não estava em nenhuma lista de escopo original.
- Editar todos os campos de um Aspecto (seção 5).
- Atribuir, criar, editar e remover categoria e raridade — tudo pela interface, sem editar arquivo.
- Anexar ícone, imagem e som (revelação/desbloqueio/seleção) por nó — ícone aparece na própria estrela do canvas, imagem aparece no painel de detalhes.
- Definir fundo por constelação — ladrilhado/infinito, não uma imagem estática única.
- Música de fundo por constelação, em loop, com volume configurável por pessoa.
- Persistência local da constelação (uma constelação por personagem/ator), com migração automática de schema entre versões do módulo.
- Visão do jogador (Observatório) respeitando nós ocultos, com painel lateral, pulsação, e recebendo atualização quase em tempo real quando o Mestre revela/desbloqueia algo — usando o próprio mecanismo de sincronização de documentos do Foundry (não uma infraestrutura de socket customizada, mas o efeito prático é o mesmo).
- Linha do Tempo da Lenda (seção 12), com interface tanto pro Mestre quanto pro jogador.

### Ainda fora do escopo

- **Modo Observatório cinematográfico completo:** partículas discretas flutuando pelo fundo, e um modo de tela cheia dedicado (hoje é uma janela normal do Foundry).
- **Importação/exportação em JSON e compartilhamento entre Mestres** (seção 13).
- **Vídeo como opção de fundo** — hoje só imagem (estática ou ladrilhada) é suportada.
- **Mixer de som dedicado dentro do módulo** — hoje o volume é ajustado nas configurações padrão do Foundry (por pessoa), não numa tela de mixagem própria do módulo.

### Critério de "pronto" (atualizado)

Um Mestre consegue, sem tocar em nenhum arquivo, criar do zero uma constelação com ramos excludentes e pré-requisitos encadeados, atribuir mídia completa (ícone/imagem/sons) e raridade a cada nó, configurar fundo e música da constelação, e registrar a linha do tempo da lenda — e um jogador consegue abrir sua própria constelação vendo corretamente apenas o que já foi desbloqueado/revelado, com atualização quase imediata quando o Mestre muda algo. **Esse critério já é cumprido hoje.**

---

## 16. Roadmap de Fases (atualizado)

1. ~~**Fase 1 (MVP):** Editor do Mestre completo + visão básica do jogador.~~ **Concluída, e superada.**
2. ~~**Fase 2:** Atualização em tempo real, painel lateral definitivo, refinamento da identidade visual mística/etérea na visão do jogador.~~ **Concluída** (via mecanismo nativo de sincronização de documentos do Foundry, não socket customizado — ver seção 15).
3. ~~**Fase 3:** Sistema de som (revelar/desbloquear/selecionar) e fundos em vídeo/animação.~~ **Som concluído. Fundos em vídeo/animação continuam pendentes** — hoje só imagem ladrilhada/infinita.
4. **Fase 4 (em andamento):** Modo Observatório completo — falta o tratamento cinematográfico (partículas, tela cheia dedicada).
5. **Fase 5 (não iniciada):** Importação/exportação JSON, compartilhamento entre Mestres.

---

## 17. Glossário (para consistência terminológica entre sessões)

- **Constelação da Apoteose:** a lenda visual de um personagem.
- **Aspecto:** cada estrela/nó da constelação.
- **Ponto da Apoteose:** unidade de progressão, concedida (ou removida) manualmente pelo Mestre.
- **Nó Secreto:** Aspecto existente mas invisível até revelação.
- **Caminho:** conexão direcional entre dois Aspectos.
- **Bloqueio mútuo (exclusão mútua):** relação de exclusão permanente entre caminhos/Aspectos — fecha um ramo pra sempre quando o rival é escolhido.
- **Pré-requisito de compra em cadeia:** regra de que um Aspecto só pode ser desbloqueado se pelo menos um de seus Aspectos de origem já estiver desbloqueado *(novo na v1.2)*.
- **Observatório:** modo de contemplação em tela cheia da constelação — ainda em desenvolvimento; hoje existe como janela normal, não em tela cheia.
- **Linha do Tempo da Lenda:** registro cronológico de capítulos marcantes da jornada de um personagem.

---

## 18. Perguntas que ficaram abertas para o TDD (na v1.1) — como foram resolvidas

Estas questões eram de natureza técnica e ficaram registradas na v1.1 pra não se perderem. A v1.2 registra como cada uma foi resolvida na prática, já detalhado no Banco de Dados / API Interna:

- **Modelo de armazenamento:** flags em `Actor`/`JournalEntry` — não um Document customizado. A Definição Mestra vive numa flag de um `JournalEntry` oculto (permissão `None` para jogadores); o Estado do Jogador vive numa flag do próprio `Actor`.
- **Mecanismo de atualização em tempo real:** resolvido usando o hook nativo `updateActor` do Foundry, sem precisar de um sistema de socket customizado — o Observatório escuta esse hook e se atualiza sozinho quando o Mestre muda algo.
- **Estratégia de renderização do canvas:** PixiJS (WebGL), não SVG nem Canvas2D puro — sustenta zoom/pan fluido, ladrilhamento de fundo infinito e ícones como sprites sobrepostos às estrelas.
- **Formato exato do schema JSON de import/export:** ainda não decidido — a funcionalidade de import/export em si continua fora do escopo atual (seção 15).

---

## Próximos passos

O módulo já passa do critério de "pronto" definido na seção 15. As frentes abertas que ficaram registradas (Observatório cinematográfico completo, import/export, mixer de som dedicado) são melhorias de polimento, não bloqueios — o projeto pode ser considerado funcionalmente completo pro uso em mesa, e essas frentes ficam como trabalho futuro opcional.

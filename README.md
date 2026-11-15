# Constelação da Apoteose

Módulo de evolução narrativa para **Foundry VTT**: cada personagem constrói, ao longo da campanha, uma constelação própria de **Aspectos**, marcos que registram quem ele se tornou. Tudo é controlado pelo Mestre: pontos, revelações e desbloqueios nunca acontecem sozinhos.

Compatível com Foundry **V13**, verificado na **V14** (14.364). Funciona com qualquer sistema: o módulo registra a lenda, e os efeitos mecânicos ficam na ficha do sistema.

## Instalação

No Foundry, abra **Módulos de Complemento → Instalar Módulo** e cole no campo **URL do Manifesto**:

```
https://github.com/Lorian2/Apoteose/releases/latest/download/module.json
```

Depois ative o módulo no mundo. O Foundry avisa e atualiza quando sair uma versão nova. Instalação manual: baixe o `constelacao-da-apoteose.zip` da [última release](https://github.com/Lorian2/Apoteose/releases/latest) e extraia em `Data/modules/constelacao-da-apoteose/`.

## Recursos

- **Editor do Mestre:** canvas com zoom e pan, criar e mover estrelas, ligar caminhos com sentido, exclusão mútua entre Aspectos rivais, raridades e categorias editáveis, mídia por Aspecto (ícone, imagem, sons), fundo e música da constelação, desfazer/refazer e atalhos de teclado.
- **Observatório do jogador:** só o que foi revelado, com a situação de cada Aspecto (desbloqueado, disponível, aguardando um anterior, caminho fechado), descrição formatada e animações quando o Mestre revela ou desbloqueia algo.
- **Mistério ativo:** a definição completa fica num diário oculto; o jogador recebe apenas o que pode ver.
- **Linha do Tempo da Jornada:** cada desbloqueio é registrado sozinho (com a data do calendário do Aethelgard, se ativo) e o Mestre dá título aos capítulos.
- **Aviso de conquista:** quando o Mestre revela ou desbloqueia um Aspecto, o dono do personagem vê um cartão discreto na tela; clicar abre o Observatório naquele Aspecto.
- **Organizado:** os diários ocultos ficam numa pasta própria, não soltos na barra lateral.

## Como usar

- Na ficha de um Ator, clique na ★ do cabeçalho, ou use o menu de contexto da lista de Atores.
- O Mestre abre o Editor; o dono do Ator abre o Observatório.
- Ciclo: o Mestre concede um Ponto da Apoteose → o jogador escolhe um Aspecto disponível → o Mestre marca o desbloqueio no Editor.

Atalhos do Editor: duplo clique no vazio cria um Aspecto, Shift+arrastar entre estrelas cria um caminho, Del remove a seleção, Ctrl+Z / Ctrl+Shift+Z desfazem e refazem, F enquadra tudo, Esc cancela.

## API para macros

```js
const api = game.modules.get('constelacao-da-apoteose').api;
await api.grantPoint(actor.id);   // concede um Ponto (Mestre)
api.open(actor.id);               // Editor para o Mestre, Observatório para o jogador
```

Veja `docs/API-Interna-Constelacao-da-Apoteose.md`.

## Desenvolvimento

TypeScript + esbuild. O Foundry carrega `dist/main.js`, que é gerado pelo build (não fica no repositório).

| Comando | O que faz |
|---|---|
| `npm ci` | instala as dependências |
| `npm run build` / `npm run watch` | gera `dist/main.js` |
| `npm run typecheck` | checagem de tipos |
| `npm test` | testes da lógica (situação dos nós, migração, Estado do Jogador, fila de escrita) |
| `npm run smoke` | teste de ponta a ponta no Foundry de verdade (navegador Edge/Chrome; exige `FOUNDRY_URL`, `FOUNDRY_USER`, `FOUNDRY_PASSWORD` de um Mestre de teste, que não pode estar conectado em outro lugar) |
| `npm run preview` | canvas fora do Foundry em http://127.0.0.1:5178/ (PIXI 7.4.3 por CDN, ou o do seu servidor via `PIXI_URL`) |

### Lançar uma versão

1. Escreva a seção `## [X.Y.Z] - AAAA-MM-DD` no `CHANGELOG.md`.
2. Rode `.\tools\release.ps1 X.Y.Z` (testes e tipos, versão no `module.json`, commit, tag `vX.Y.Z` e envio).
3. A Action [Release](.github/workflows/release.yml) roda testes e tipos, compila, grava versão e links no `module.json` e publica o `constelacao-da-apoteose.zip`. O manifesto `releases/latest/download/module.json` passa a apontar para a versão nova.

Documentos de design em `docs/`, guia de customização em `CUSTOMIZACAO.md`, histórico em `CHANGELOG.md`.

## Autor

Luan (Lorian2).

# Changelog — Constelação da Apoteose

## [0.2.0] - 2026-11-14

### Regras
- Só o Mestre desbloqueia (GDD §6–7). O botão "Desbloquear" do Observatório e o relé de pedidos pela flag do Ator saíram.
- Exclusão mútua passa a ser entre dois Aspectos, nos dois sentidos, e fecha o ramo inteiro que depende do Aspecto fechado.
- Schema v3, com migração automática feita pelo Mestre ativo ao entrar no mundo.

### Correções
- Um caminho novo até um Aspecto já excluído o reabria sem aviso.
- Escritas seguidas (arrastar e editar, por exemplo) podiam apagar umas às outras: agora entram numa fila por Ator.
- A leitura devolve uma cópia da flag em vez do objeto do documento, para a gravação sempre enxergar a mudança.
- Um clique simples numa estrela gravava a posição e atualizava todos os jogadores.
- No Observatório, o jogador conseguia arrastar estrelas (só na própria tela).
- Estrelas e linhas antigas não eram destruídas a cada redesenho (vazamento de memória no PIXI).
- O Observatório mostrava IDs (`common`, `narrative`) no lugar dos nomes de raridade, categoria e tipo.
- O Estado do Jogador revelava IDs de nós ocultos nas exclusões e no histórico.
- O Editor não se atualizava quando outro Mestre mexia na mesma constelação.
- O painel voltava ao topo a cada edição.
- Os 9 erros de tipo do `npm run typecheck` foram corrigidos.

### Editor
- Nome de cada estrela no canvas; seta indicando o sentido de cada caminho; linha tracejada para exclusões (só o Mestre vê).
- Zoom em direção ao cursor; botão e tecla F para enquadrar tudo; enquadramento automático ao abrir.
- Desfazer/refazer (Ctrl+Z, Ctrl+Shift+Z).
- Duplo clique no vazio cria um Aspecto; Shift+arrastar de uma estrela a outra cria um caminho, com linha-prévia.
- Clicar num caminho seleciona: inverter sentido ou remover.
- Atalhos: Del, Esc, F, N. O canvas segura o foco do teclado para não acionar atalhos da cena.
- Painel reorganizado em seções recolhíveis; campos de cor própria e requisito narrativo; entradas do histórico podem ser apagadas.
- Botão "ver como o jogador vê".

### Observatório
- Painel com imagem, citação, descrição formatada (com links @UUID), etiquetas e a situação do Aspecto explicada.
- Lista "Ao seu alcance" com os Aspectos disponíveis.
- Estrelas recém-reveladas surgem; recém-desbloqueadas soltam uma onda de luz; caminhos novos acendem devagar.

### Integração
- Item "Constelação da Apoteose" no menu de contexto da lista de Atores.
- Botão da ficha posicionado antes dos controles padrão, com tooltip.
- Compatível com V13, verificado na V14 (14.364).

### Desenvolvimento
- `npm test` (lógica de situação, migração, Estado do Jogador, fila do serviço) e `npm run preview` (canvas fora do Foundry).
- `.\tools\deploy.ps1 -Module apoteose` roda testes, typecheck e build e publica só os arquivos de execução.

# Changelog — Constelação da Apoteose

## [0.4.0] - a lançar

### Na mesa
- **Aviso de conquista:** quando o Mestre revela ou desbloqueia um Aspecto, o dono do personagem vê um cartão discreto no alto da tela, com o nome, a citação e a cor da raridade. Clicar abre o Observatório já naquele Aspecto. Só o dono recebe (nada vai para o chat, porque a constelação é solitária); o Mestre não recebe o próprio aviso. Passar o mouse pausa a contagem. Dá para desligar em "Avisar conquistas da constelação".
- **Linha do Tempo automática:** desbloquear um Aspecto registra sozinho "Desbloqueou X", com a data do calendário da campanha quando o Aethelgard está ativo (ex.: "12 Novilúnio, 362") e a data real caso contrário. O Mestre pode dar um título de capítulo à entrada (✎), que passa a aparecer no lugar do texto automático. Desfazer o desbloqueio apaga o registro. O jogador nunca recebe o registro automático de um Aspecto que ainda não vê.

### Organização
- Os diários ocultos de cada constelação vão para a pasta "Constelação da Apoteose (Mestre)", em vez de ficarem soltos na barra lateral. O Mestre ativo arruma os existentes ao entrar no mundo; diário que você já guardou em outra pasta não é mexido. Diários cujo Ator foi apagado vão para a subpasta "Sem Ator", e nunca são apagados.

### Qualidade
- `npm run smoke`: abre um navegador de verdade, entra no Foundry como Mestre e roda `api.selfTest()`, que cria um Ator temporário, exercita o Editor (inclusive o clique em "Criar"), o Observatório, o histórico, as pastas e os avisos, e apaga tudo no fim. Variáveis: `FOUNDRY_URL`, `FOUNDRY_USER`, `FOUNDRY_PASSWORD`.
- `api.selfTest()` também roda pelo console (F12). Sem quadros desenhados (janela oculta), a etapa do clique é marcada como pulada em vez de falhar.

### Correções
- Clicar na ★ da ficha com o Editor já aberto apagava o canvas da janela. Agora só traz a janela à frente, e as duas janelas remontam o canvas sozinhas se algo re-renderizar tudo.
- O título da janela e os tooltips apareciam como `CONSTELACAO_APOTEOSE.EditorTitle` em clientes sem tradução para o idioma deles. Há texto reserva em português e o idioma `en` aponta para o mesmo arquivo.
- O "enquadrar tudo" cortava o nome das estrelas das pontas.
- O aviso de conquista não cobre o astrolábio do Aethelgard.

## [0.3.0] - 2026-11-14

### Correção importante (Foundry V14)
- Na V14, os métodos estáticos de `Hooks` não podem ser chamados soltos. Uma chamada assim no início do módulo interrompia a inicialização: as configurações não eram registradas, o canvas do Editor não montava (as estrelas "sumiam" e o "Criar" não reagia), a migração automática não rodava, e a API e o menu de contexto não existiam. O mesmo defeito fazia falhar o aviso disparado depois de revelar, desbloquear ou conceder Pontos.
- Cada etapa da inicialização agora roda isolada, e as configurações têm valor padrão se não puderem ser lidas.
- Falhas ao montar ou desenhar o canvas e ao migrar constelações aparecem na tela, em vez de passarem em silêncio.
- Ator duplicado ganha uma constelação própria (copiada) em vez de dividir o diário com o original.
- O botão ★ não quebra quando a ficha do sistema reorganiza o cabeçalho.
- Novo `api.diagnose()` para o console: abre cada constelação, testa o canvas e devolve um relatório.

### Visual
- Céu em camadas: nebulosa suave em anil, ameixa e lavanda, três campos de estrelas distantes com paralaxe (o fundo se move menos que a constelação no pan e no zoom), estrelas que cintilam com raios de luz e, raramente, uma estrela cadente.
- Estrelas dos Aspectos com halo luminoso na cor da raridade, ponto de luz no centro e raios de luz nas desbloqueadas. Quanto mais rara, maior o halo e mais longos os raios: a raridade aparece como luminosidade, nunca como cor gritante.
- Anel de seleção tracejado girando devagar; onda de luz mais forte ao desbloquear.
- Caminhos com brilho difuso; nos já percorridos e nos abertos, pontos de luz correm no sentido do caminho.
- Vinheta nas bordas do canvas e cabeçalho da janela no tema.
- Os nomes das estrelas são redesenhados quando a fonte Cinzel termina de carregar.

### Configuração
- "Céu animado" (por usuário): desliga cintilação, estrelas cadentes, poeira e fluxo nos caminhos. Começa desligado se o sistema pedir movimento reduzido.

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

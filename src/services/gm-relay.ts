import { MODULE_ID } from '../constants';
import { ConstellationError, type ConstellationErrorCode } from '../errors';
import type { ConstellationService } from './constellation-service';

const FLAG_UNLOCK_REQUEST = 'unlockRequest';

interface UnlockRequestFlag {
  requestId: string;
  nodeId: string;
  userId: string;
  status: 'pending' | 'done' | 'error';
  errorCode?: ConstellationErrorCode;
  errorMessage?: string;
}

interface PendingRequest {
  resolve: () => void;
  reject: (error: ConstellationError) => void;
}

const pendingRequests = new Map<string, PendingRequest>();
// Evita reprocessar o mesmo pedido duas vezes no client do Mestre (ex.: o
// próprio unsetFlag/setFlag de conclusão também dispara updateActor).
const processedRequestIds = new Set<string>();

/**
 * Relé de pedidos de desbloqueio entre jogador e Mestre.
 *
 * TENTATIVA ANTERIOR (descartada): um canal de socket customizado
 * (`game.socket.emit('module.…', …)`). Diagnosticamos ao vivo que, neste
 * ambiente, o evento é emitido do lado do jogador mas nunca chega no
 * client do Mestre — sintoma de bloqueio de transporte (proxy/servidor),
 * não de lógica.
 *
 * MECANISMO ATUAL: o pedido vira uma flag no próprio `Actor`
 * (`constelacao-da-apoteose.unlockRequest`). O jogador tem permissão de
 * escrita nessa flag por ser dono do Ator — não depende do JournalEntry
 * oculto nem de socket algum. O Mestre reage via hook `updateActor`, que
 * já comprovadamente se propaga neste ambiente (é o mesmo mecanismo que
 * mantém o Observatório sincronizado). O Mestre processa e escreve o
 * resultado de volta na mesma flag; o jogador reage à mudança pelo mesmo
 * hook, do outro lado.
 */
export function registerGMRelay(service: ConstellationService): void {
  Hooks.on('updateActor', (actor: Actor) => {
    const request = actor.getFlag(MODULE_ID, FLAG_UNLOCK_REQUEST) as UnlockRequestFlag | undefined;
    if (!request) {
      return;
    }

    if (request.status === 'pending') {
      // Só o Mestre ativo processa — evita duplo-processamento se houver
      // mais de um Mestre conectado.
      if (game.user?.isGM && game.user.id === game.users?.activeGM?.id) {
        void handleUnlockRequest(service, actor, request);
      }
      return;
    }

    // status 'done' ou 'error': só interessa a quem está esperando esse
    // requestId específico (o jogador que pediu).
    handleUnlockResult(request);
  });
}

async function handleUnlockRequest(service: ConstellationService, actor: Actor, request: UnlockRequestFlag): Promise<void> {
  if (processedRequestIds.has(request.requestId)) {
    return;
  }
  processedRequestIds.add(request.requestId);

  const requestingUser = game.users?.get(request.userId);
  const isOwner = !!requestingUser && !!actor.testUserPermission(requestingUser, 'OWNER');

  if (!isOwner) {
    await actor.setFlag(MODULE_ID, FLAG_UNLOCK_REQUEST, {
      ...request,
      status: 'error',
      errorCode: 'NOT_GM',
      errorMessage: 'Você não tem permissão sobre este Ator.',
    } satisfies UnlockRequestFlag);
    return;
  }

  try {
    await service.unlockNode(actor.id ?? '', request.nodeId);
    await actor.setFlag(MODULE_ID, FLAG_UNLOCK_REQUEST, { ...request, status: 'done' } satisfies UnlockRequestFlag);
  } catch (error) {
    if (error instanceof ConstellationError) {
      await actor.setFlag(MODULE_ID, FLAG_UNLOCK_REQUEST, {
        ...request,
        status: 'error',
        errorCode: error.code,
        errorMessage: error.message,
      } satisfies UnlockRequestFlag);
    } else {
      await actor.setFlag(MODULE_ID, FLAG_UNLOCK_REQUEST, {
        ...request,
        status: 'error',
        errorMessage: 'Erro inesperado ao desbloquear o Aspecto.',
      } satisfies UnlockRequestFlag);
      throw error;
    }
  }
}

function handleUnlockResult(request: UnlockRequestFlag): void {
  const pending = pendingRequests.get(request.requestId);
  if (!pending) {
    return; // Não é um pedido pendente deste client (ex.: é o próprio Mestre vendo sua escrita).
  }
  pendingRequests.delete(request.requestId);

  if (request.status === 'done') {
    pending.resolve();
  } else if (request.status === 'error') {
    pending.reject(new ConstellationError(request.errorCode ?? 'NOT_GM', request.errorMessage ?? 'Falha ao desbloquear.'));
  }
}

/**
 * Chamado pelo client do jogador: pede ao Mestre ativo pra desbloquear um
 * nó em seu nome, escrevendo uma flag no próprio Ator (permissão de
 * dono, sem depender de socket). Rejeita com `ConstellationError` se
 * ninguém responder (nenhum Mestre conectado) ou se o desbloqueio falhar
 * por um motivo previsível (ex.: sem Pontos da Apoteose disponíveis).
 */
export function requestUnlockNode(actorId: string, nodeId: string, timeoutMs = 8000): Promise<void> {
  if (!game.users?.activeGM) {
    return Promise.reject(
      new ConstellationError('NOT_GM', 'Nenhum Mestre está conectado agora. Peça pra ele entrar na sessão.'),
    );
  }

  const actor = game.actors?.get(actorId);
  if (!actor) {
    return Promise.reject(new ConstellationError('ACTOR_NOT_FOUND', 'Ator não encontrado.'));
  }

  const requestId = foundry.utils.randomID();

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new ConstellationError('NOT_GM', 'O Mestre não respondeu a tempo. Tente de novo.'));
    }, timeoutMs);

    pendingRequests.set(requestId, {
      resolve: () => {
        clearTimeout(timeout);
        resolve();
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });

    void actor.setFlag(MODULE_ID, FLAG_UNLOCK_REQUEST, {
      requestId,
      nodeId,
      userId: game.user?.id ?? '',
      status: 'pending',
    } satisfies UnlockRequestFlag);
  });
}

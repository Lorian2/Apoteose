import { MODULE_ID } from '../constants';
import { openObservatory } from '../hooks/register-hooks';
import { diffNodes, snapshotNodes, type AnnouncementEvents, type NodeSnapshot } from '../utils/announce-diff';
import { escapeHTML } from '../utils/html';
import { playMediaSound } from '../utils/sound';
import type { PlayerConstellationState, PlayerVisibleNode } from '../types/constellation';
import { readSetting } from './display-settings';

const TOAST_LIFETIME_MS = 9000;
const MAX_VISIBLE = 3;
const CONTAINER_ID = 'constelacao-announcements';

/** O que cada cliente sabia da constelação de cada Ator, para comparar na próxima mudança. */
const known = new Map<string, NodeSnapshot>();

/**
 * Aviso de conquista: quando o Mestre revela ou desbloqueia um Aspecto,
 * o dono do personagem vê um cartão discreto no alto da tela (clique abre o
 * Observatório naquele Aspecto). Funciona comparando o Estado do Jogador
 * antes e depois — não precisa de socket, e só aparece para quem é dono
 * do Ator: a constelação é solitária, então nada vai para o chat.
 * O Mestre não recebe o aviso: foi ele quem fez a mudança.
 */
export function registerAnnouncements(): void {
  Hooks.once('ready', () => {
    if (game.user?.isGM) return;
    for (const actor of game.actors?.contents ?? []) {
      if (!actor.isOwner || !actor.id) continue;
      const state = actor.getFlag(MODULE_ID, 'playerState');
      if (state) known.set(actor.id, snapshotNodes(state.nodes));
    }
  });

  Hooks.on('updateActor', (actor: Actor, changes: object) => {
    if (game.user?.isGM || !actor.isOwner || !actor.id) return;
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.playerState`)) return;
    const state = actor.getFlag(MODULE_ID, 'playerState');
    if (!state) return;

    const before = known.get(actor.id);
    known.set(actor.id, snapshotNodes(state.nodes));
    // Sem foto anterior é a primeira vez que vemos esta constelação: só aprende.
    if (!before || !isAnnouncementEnabled()) return;

    const events = diffNodes(before, state.nodes);
    if (events.unlocked.length || events.revealed.length) showAnnouncements(actor, state, events);
  });
}

export function isAnnouncementEnabled(): boolean {
  return readSetting('announceProgress', true);
}

/** Mostra os cartões de um conjunto de mudanças (exportada: o diagnóstico e os testes ao vivo a chamam). */
export function showAnnouncements(actor: Actor, state: PlayerConstellationState, events: AnnouncementEvents): void {
  const items = [
    ...events.unlocked.map((node) => ({ node, kind: 'unlock' as const })),
    ...events.revealed.map((node) => ({ node, kind: 'reveal' as const })),
  ];
  const shown = items.slice(0, items.length > MAX_VISIBLE ? MAX_VISIBLE - 1 : MAX_VISIBLE);
  const rest = items.length - shown.length;

  const observatoryOpen = !!foundry.applications.instances.get(`constelacao-apoteose-observatory-${actor.id}`);
  for (const { node, kind } of shown) {
    toast(actor, state, node, kind);
    // Com o Observatório aberto, ele já toca o som: evita tocar duas vezes.
    if (!observatoryOpen) playMediaSound(kind === 'unlock' ? node.media?.soundUnlock : node.media?.soundReveal);
  }
  if (rest > 0) {
    toastText(
      'Novidades na sua constelação',
      `Mais ${rest} novidade(s) em ${actor.name}`,
      () => void openObservatory(actor.id!),
      'more',
    );
  }
}

function toast(actor: Actor, state: PlayerConstellationState, node: PlayerVisibleNode, kind: 'unlock' | 'reveal'): void {
  const rarity = state.rarities.find((candidate) => candidate.id === node.rarityId);
  const color = node.color || rarity?.color || '#c9b6e4';
  const kicker = kind === 'unlock' ? 'Aspecto desbloqueado' : 'Uma nova estrela surgiu';
  // Quem tem mais de um personagem com constelação precisa saber de qual é o aviso.
  const sub = ownedActorCount() > 1 ? actor.name : '';

  const element = document.createElement('div');
  element.className = `constelacao-toast constelacao-toast--${kind}`;
  element.style.setProperty('--aspect-color', color);
  element.innerHTML = `
    <span class="constelacao-toast-star"></span>
    <div class="constelacao-toast-body">
      <div class="constelacao-toast-kicker">${kicker}</div>
      <div class="constelacao-toast-title">${escapeHTML(node.name)}</div>
      ${node.quote ? `<div class="constelacao-toast-quote">${escapeHTML(node.quote)}</div>` : ''}
      ${sub ? `<div class="constelacao-toast-actor">${escapeHTML(sub)}</div>` : ''}
    </div>
    <button type="button" class="constelacao-toast-close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>`;
  mount(element, () => void openObservatory(actor.id!, node.id));
}

function toastText(kicker: string, title: string, onClick: () => void, kind: string): void {
  const element = document.createElement('div');
  element.className = `constelacao-toast constelacao-toast--${kind}`;
  element.innerHTML = `
    <span class="constelacao-toast-star"></span>
    <div class="constelacao-toast-body">
      <div class="constelacao-toast-kicker">${escapeHTML(kicker)}</div>
      <div class="constelacao-toast-title">${escapeHTML(title)}</div>
    </div>
    <button type="button" class="constelacao-toast-close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>`;
  mount(element, onClick);
}

function mount(element: HTMLElement, onClick: () => void): void {
  let container = document.getElementById(CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'constelacao-apoteose';
    document.body.appendChild(container);
  }
  container.appendChild(element);

  let timer = 0;
  const dismiss = () => {
    window.clearTimeout(timer);
    element.classList.add('leaving');
    window.setTimeout(() => element.remove(), 600);
  };
  element.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('.constelacao-toast-close')) {
      dismiss();
      return;
    }
    onClick();
    dismiss();
  });
  // Passar o mouse pausa a contagem: dá tempo de ler a citação.
  const arm = () => (timer = window.setTimeout(dismiss, TOAST_LIFETIME_MS));
  element.addEventListener('mouseenter', () => window.clearTimeout(timer));
  element.addEventListener('mouseleave', arm);
  arm();
}

function ownedActorCount(): number {
  return (game.actors?.contents ?? []).filter((actor) => actor.isOwner && actor.getFlag(MODULE_ID, 'playerState')).length;
}

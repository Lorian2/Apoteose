import { MODULE_ID } from '../constants';

/**
 * Mostra na tela uma falha que, de outro jeito, passaria em silêncio (o
 * canvas não montar deixa a janela aberta, mas vazia e sem reação).
 */
export function reportFailure(what: string, error: unknown): void {
  console.error(`${MODULE_ID} | ${what}:`, error);
  const message = error instanceof Error ? error.message : String(error);
  ui.notifications?.error(`Constelação da Apoteose — ${what}: ${message}. Detalhes no console (F12).`, {
    permanent: true,
  });
}

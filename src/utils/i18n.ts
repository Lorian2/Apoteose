/**
 * Texto traduzido com plano B. `localize` devolve a própria chave quando ela
 * não existe no idioma do cliente (o módulo só traz português), e isso
 * aparecia na tela como "CONSTELACAO_APOTEOSE.EditorTitle". Aqui, se a
 * resposta for a chave, usa o texto em português.
 */
export function t(key: string, fallback: string): string {
  try {
    const text = game.i18n?.localize(key);
    return text && text !== key ? text : fallback;
  } catch {
    return fallback;
  }
}

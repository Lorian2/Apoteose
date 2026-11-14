const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapa texto para interpolar em HTML montado à mão (diálogos, descrições). */
export function escapeHTML(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * Texto simples do Editor → HTML seguro: escapa tudo e transforma linhas
 * em branco em parágrafos e quebras simples em <br>. O resultado ainda
 * passa pelo `enrichHTML` do Foundry, então @UUID[...] continua virando link.
 */
export function plainTextToHTML(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHTML(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Data para a Linha do Tempo da Jornada. Com o Aethelgard ativo, usa a data
 * do calendário da campanha (ex.: "11 Novilúnio, 362"); sem ele, ou se algo
 * falhar, cai na data real. Nunca lança erro: registrar um momento não pode
 * depender de outro módulo.
 */
export function currentDateLabel(): string {
  const fallback = new Date().toLocaleDateString('pt-BR');
  try {
    const game = (globalThis as { game?: { modules?: Map<string, unknown> } }).game;
    const module = game?.modules?.get('aethelgard-calendar') as
      | { active?: boolean; api?: { engine?: { describe?: () => AethelgardDay } } }
      | undefined;
    if (!module?.active) return fallback;
    const info = module.api?.engine?.describe?.();
    if (!info) return fallback;
    return formatAethelgardDay(info) || fallback;
  } catch {
    return fallback;
  }
}

interface AethelgardDay {
  day?: number;
  monthName?: string;
  year?: number | string;
  era?: string;
  festival?: string | null;
  intercalary?: boolean;
}

/** Exportada para os testes. */
export function formatAethelgardDay(info: AethelgardDay): string {
  const year = info.year !== undefined ? `${info.year}${info.era ? ` ${info.era}` : ''}` : '';
  const dayPart = info.intercalary || !info.day ? (info.festival ?? info.monthName ?? '') : `${info.day} ${info.monthName ?? ''}`;
  return [dayPart.trim(), year].filter(Boolean).join(', ');
}

/**
 * Mapa dos hooks públicos do módulo (API Interna, seção 9) — fonte de
 * verdade própria, em vez de depender do mecanismo de augmentation global
 * do foundry-vtt-types (que espera hooks customizados registrados dentro
 * do próprio pacote de tipos, impraticável a partir de um módulo consumidor).
 */
export interface ModuleHookMap {
  'constelacaoApoteose.nodeRevealed': [actorId: string, nodeId: string];
  'constelacaoApoteose.nodeUnlocked': [actorId: string, nodeId: string];
  'constelacaoApoteose.pointGranted': [actorId: string, amount: number];
}

/**
 * Dispara um hook público do módulo com checagem de tipo completa dos
 * argumentos. O único `as` necessário fica isolado aqui — o resto do
 * código nunca precisa escapar do sistema de tipos para disparar um hook.
 */
export function callModuleHook<K extends keyof ModuleHookMap>(name: K, ...args: ModuleHookMap[K]): void {
  (Hooks.callAll as (hook: string, ...hookArgs: unknown[]) => boolean)(name, ...args);
}

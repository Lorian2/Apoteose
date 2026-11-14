/**
 * Roda a migração e a derivação do Estado do Jogador sobre definições reais
 * exportadas de um mundo (JSON em CONSTELACAO_DEFS). Não faz parte do npm test.
 */
import fs from 'node:fs';
import { derivePlayerState, migrateDefinition } from '../src/data/constellation-repository';
import { computeNodeStatuses } from '../src/utils/node-status';

const defs = JSON.parse(fs.readFileSync(process.env.CONSTELACAO_DEFS!, 'utf8'));
for (const { name, definition } of defs) {
  try {
    const migrated = migrateDefinition(structuredClone(definition));
    const state = derivePlayerState(migrated);
    computeNodeStatuses(migrated.nodes, migrated.connections, migrated.exclusions);
    console.log(`ok   v${definition.schemaVersion}→v${migrated.schemaVersion} ${name}: ${migrated.nodes.length} nós, exclusões=${JSON.stringify(migrated.exclusions)}, jogador vê ${state.nodes.length}`);
  } catch (error) {
    console.log(`FALHA ${name} (v${definition.schemaVersion}):`, (error as Error).stack);
    console.log('  chaves:', Object.keys(definition), 'conexões:', JSON.stringify(definition.connections?.slice(0, 2)));
  }
}

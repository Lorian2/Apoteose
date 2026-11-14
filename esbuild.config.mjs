import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/main.js',
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
  // O Foundry já expõe PIXI globalmente em tempo de execução (é o motor do
  // seu próprio canvas de cena) — nunca empacotar uma cópia própria aqui,
  // isso quebraria a renderização por ter duas instâncias de PIXI ativas.
  external: ['pixi.js'],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('esbuild: observando alterações em src/...');
} else {
  await esbuild.build(options);
  console.log('esbuild: build concluído em dist/main.js');
}

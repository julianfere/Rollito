#!/usr/bin/env node
// Mantenimiento a mano: libera espacio en la Pi.
//
//   node server/tools/cleanup.js            # sólo informa, no borra nada
//   node server/tools/cleanup.js --apply    # borra los huérfanos
//   node server/tools/cleanup.js --apply --archive-burnt
//
// Los huérfanos son archivos que ninguna fila referencia (subidas caídas,
// rollos borrados, seeds re-corridos). --archive-burnt además recomprime los
// originales de los rollos ya velados: eso es DESTRUCTIVO e irreversible.
import { sweepOrphanFiles, sweepBurntAlbums } from '../lib/archive.js';
import { sweepExpiredZips } from '../lib/zips.js';

const apply = process.argv.includes('--apply');
const burnt = process.argv.includes('--archive-burnt');
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
const log = {
  info: () => {},
  warn: (o, m) => console.warn('!', m, o),
  error: (o, m) => console.error('x', m, o),
};

const zips = sweepExpiredZips();
if (zips) console.log(`zips vencidos borrados: ${zips}`);

const orphans = sweepOrphanFiles({ dryRun: !apply, log });
console.log(`huérfanos: ${orphans.count} archivos, ${mb(orphans.bytes)}`);
for (const f of orphans.files.slice(0, 10)) console.log(`   ${f.path}  ${mb(f.bytes)}`);
if (orphans.count > 10) console.log(`   ... y ${orphans.count - 10} más`);

if (burnt) {
  if (!apply) {
    console.log('\n--archive-burnt necesita --apply: recomprimir es irreversible.');
  } else {
    const res = await sweepBurntAlbums(log);
    const freed = res.reduce((s, r) => s + r.freed, 0);
    console.log(`\nrollos velados archivados: ${res.length}, ${mb(freed)} liberados`);
  }
}

if (!apply) console.log('\n(simulación — nada se borró. Agregá --apply para hacerlo)');

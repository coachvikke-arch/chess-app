/* Copies the Stockfish 18 engines from node_modules into public/, where Vite
   serves them verbatim. Each single-file build locates its .wasm next to
   itself using its OWN basename, so matching names are required:

     stockfish.js / stockfish.wasm        — FULL NNUE build (large net, strong)
                                             used by GAME REVIEW (parity with
                                             Chess.com's classification needs the
                                             big network weights).
     stockfish-lite.js / stockfish-lite.wasm — LITE build (small net, ~7 MB, much
                                             faster to load) used by board
                                             ANALYSIS / engine bar / computer
                                             games — a deliberately separate,
                                             lighter engine.

   The two engines share the same wrapper but MUST NOT share a worker pool:
   every pool pins one distinct .wasm file. */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'node_modules', 'stockfish', 'bin');
const dstDir = join(root, 'public');

mkdirSync(dstDir, { recursive: true });
copyFileSync(join(srcDir, 'stockfish-18-single.js'), join(dstDir, 'stockfish.js'));
copyFileSync(join(srcDir, 'stockfish-18-single.wasm'), join(dstDir, 'stockfish.wasm'));
copyFileSync(join(srcDir, 'stockfish-18-lite-single.js'), join(dstDir, 'stockfish-lite.js'));
copyFileSync(join(srcDir, 'stockfish-18-lite-single.wasm'), join(dstDir, 'stockfish-lite.wasm'));
console.log('Stockfish 18 full NNUE (review) + lite (analysis) engines copied to public/');
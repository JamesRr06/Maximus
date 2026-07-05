#!/usr/bin/env node
/* Reconstruit Maximus.exe à partir de maximus.html (à jour dans le dépôt).
 *
 * Ce script fait tout le pipeline exe :
 *   1. extrait le code de jeu en clair de maximus.html
 *   2. l'obfusque (javascript-obfuscator)
 *   3. assemble le HTML de l'exe (head + musique + code obfusqué + beacon)
 *   4. génère payload.S (embarque le HTML via .incbin — compilation quasi instantanée)
 *   5. compile avec zig  ->  Maximus_new.exe
 *
 * PRÉREQUIS (une seule fois) :
 *   - Node.js (déjà là si tu développes le jeu)
 *   - npm install javascript-obfuscator      (dans le dossier dev/)
 *   - zig : soit "zig" dans le PATH (https://ziglang.org/download/),
 *           soit Python + "pip install ziglang" (le script détecte les deux).
 *
 * USAGE :   node dev/build-exe.mjs
 * puis, si le jeu n'était pas ouvert, renomme Maximus_new.exe -> Maximus.exe
 * (Maximus_new.exe est déjà dans .gitignore ; l'exe est verrouillé s'il tourne).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DEV = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DEV, '..');
const OUT = path.join(DEV, 'build');
fs.mkdirSync(OUT, { recursive: true });

// 1. extraire le code en clair
const html = fs.readFileSync(path.join(ROOT, 'maximus.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const codeMatch = blocks.find(b => b[1].includes('class Fighter'));
if (!codeMatch) { console.error('Code de jeu introuvable dans maximus.html'); process.exit(1); }
const clear = codeMatch[1];

// 2. obfusquer
let JO;
try { JO = require('javascript-obfuscator'); }
catch { console.error('Manque javascript-obfuscator : lance  npm install javascript-obfuscator  dans dev/'); process.exit(1); }
console.log('Obfuscation…');
const obf = JO.obfuscate(clear, {
  compact: true, selfDefending: true, stringArray: true, stringArrayThreshold: 0.8,
  stringArrayEncoding: ['base64'], controlFlowFlattening: false, renameGlobals: true,
}).getObfuscatedCode();

// 3. assembler le HTML de l'exe
const beacon = ";window.addEventListener('pagehide',function(){try{navigator.sendBeacon('/bye','')}catch(e){}});";
const exeHtml = html.slice(0, codeMatch.index + codeMatch[0].indexOf(clear)) + obf + beacon +
                html.slice(codeMatch.index + codeMatch[0].indexOf(clear) + clear.length);
fs.writeFileSync(path.join(OUT, 'exe.html'), exeHtml);
console.log('exe.html :', Buffer.byteLength(exeHtml), 'octets');

// 4. payload.S (.incbin) + en-tête extern + copies des sources du lanceur
fs.writeFileSync(path.join(OUT, 'game_html.h'),
  'extern const unsigned char GAME[];\nextern const unsigned int  GAME_LEN;\n');
// NB : le commentaire porte la taille de exe.html — indispensable, car zig met en
// cache payload.o d'après le contenu de payload.S et NON d'après le fichier .incbin.
// Sans ce marqueur, un rebuild réutiliserait l'ancien HTML embarqué.
fs.writeFileSync(path.join(OUT, 'payload.S'),
  `# payload exe.html = ${Buffer.byteLength(exeHtml)} octets (cache-buster)\n` +
  '    .section .rodata\n    .global GAME\nGAME:\n    .incbin "exe.html"\n.Lend:\n' +
  '    .p2align 2\n    .global GAME_LEN\nGAME_LEN:\n    .int .Lend - GAME\n');
for (const f of ['wrapper.c', 'icon.rc']) fs.copyFileSync(path.join(DEV, f), path.join(OUT, f));
fs.copyFileSync(path.join(ROOT, 'maximus.ico'), path.join(OUT, 'maximus.ico'));

// 5. compiler avec zig
const zigCmds = [
  ['zig', ['cc']],
  ['python', ['-m', 'ziglang', 'cc']],
  ['python3', ['-m', 'ziglang', 'cc']],
];
const args = ['-target', 'x86_64-windows-gnu', '-O2', 'wrapper.c', 'payload.S', 'icon.rc',
  '-o', 'Maximus_new.exe', '-lws2_32', '-lshell32', '-Wl,--subsystem,windows'];
let built = false;
for (const [cmd, pre] of zigCmds) {
  const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  if (probe.error) continue;
  console.log(`Compilation avec ${cmd} ${pre.join(' ')} … (la 1re fois, zig construit la CRT : ~2-3 min)`);
  const r = spawnSync(cmd, [...pre, ...args], { cwd: OUT, stdio: 'inherit' });
  if (r.status === 0 && fs.existsSync(path.join(OUT, 'Maximus_new.exe'))) { built = true; break; }
}
if (!built) {
  console.error('\nzig introuvable ou échec. Installe zig (https://ziglang.org/download/) ou  pip install ziglang,');
  console.error('puis relance. Les fichiers sont prêts dans dev/build/ ; commande manuelle :');
  console.error('  cd dev/build && zig cc ' + args.join(' '));
  process.exit(1);
}

// déployer à la racine du dépôt
fs.copyFileSync(path.join(OUT, 'Maximus_new.exe'), path.join(ROOT, 'Maximus_new.exe'));
console.log('\n✓ Maximus_new.exe créé à la racine du dépôt.');
console.log('  Ferme le jeu s\'il tourne, puis :  del Maximus.exe & ren Maximus_new.exe Maximus.exe');

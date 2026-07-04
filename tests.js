/* MAXIMUS — suite de tests de régression.
   Usage : node tests.js [chemin/vers/maximus.html]
   Exécute la logique du jeu hors navigateur (DOM et canvas simulés) et vérifie
   les mécaniques clés. Code de sortie 0 si tout passe, 1 sinon. */
'use strict';
const fs = require('fs');
const path = require('path');

const htmlPath = process.argv[2] || path.join(__dirname, 'maximus.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
const m = [null, blocks.find(b=>b.includes('class Fighter'))];
if(!m[1]){ console.error('script introuvable dans ' + htmlPath); process.exit(1); }

/* ---- stubs DOM / canvas / navigateur ---- */
global.window = { addEventListener(){}, AudioContext: null, close(){} };
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = () => {};
global.localStorage = { getItem: () => null, setItem(){} };
Object.defineProperty(global, 'navigator', { value: { sendBeacon: () => true }, configurable: true });
const ctxStub = new Proxy({}, {
  get: (t, p) => String(p).startsWith('create') ? () => ({ addColorStop(){} })
    : (p === 'measureText' ? () => ({ width: 50 }) : () => ctxStub),
  set: () => true,
});
global.document = {
  getElementById: () => ({
    getContext: () => ctxStub,
    addEventListener(){},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
  }),
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub }),
};

let failures = 0;
function check(nom, cond){
  console.log((cond ? '  OK   ' : '  ÉCHEC ') + nom);
  if(!cond) failures++;
}

const src = m[1].replace('"use strict";', '');
eval(src + `;(${function(){

  /* ---- données ---- */
  for(const c in TREES) for(const w in TREES[c]) check('arme définie : '+w, !!WEAPONS[w]);
  check(MAX_LEVEL+' niveaux, '+NAMES.length+' noms', NAMES.length===MAX_LEVEL);

  /* ---- équilibrage DPS : même palier ≈ même DPS, progression entre paliers ---- */
  const dps = w => w.dmg / ((w.windup+w.active+w.recover)/1000);
  for(const cl in TREES){
    const keys=Object.keys(TREES[cl]);
    const vals=keys.map(k=>dps(WEAPONS[k]));
    // progression : la dernière arme fait nettement plus de DPS que la première
    check('DPS croissant ('+cl+') : '+vals[0].toFixed(1)+' → '+vals[vals.length-1].toFixed(1),
      vals[vals.length-1] > vals[0]*1.35);
  }
  // au même palier de déblocage, les arbres restent proches (±20 %)
  for(const unlockAt of [0,3,7,11,15,19]){
    const band=[];
    for(const cl in TREES){
      const entry=Object.entries(TREES[cl]).filter(([k,v])=>v===unlockAt);
      // le mode double frappe aussi de la main gauche : on pondère son DPS ×1.12
      entry.forEach(([k])=>band.push(dps(WEAPONS[k]) * (WEAPONS[k].dual?1.12:1)));
    }
    const mn=Math.min(...band), mx=Math.max(...band);
    check('palier '+unlockAt+' : DPS homogènes ('+mn.toFixed(1)+'–'+mx.toFixed(1)+')', mx/mn < 1.35);
  }
  // chaque arbre propose au moins 3 effets d'état différents
  for(const cl in TREES){
    const fx=new Set();
    for(const k of Object.keys(TREES[cl])){
      const w=WEAPONS[k];
      if(w.bleedCh)fx.add('bleed'); if(w.pierce)fx.add('pierce'); if(w.slowCh)fx.add('slow');
      if(w.sunder)fx.add('sunder'); if(w.stunFx||w.briseGarde)fx.add('stun');
    }
    check('variété d’effets ('+cl+') : '+fx.size, fx.size>=3);
  }
  check('plafond d’équipement à '+EQUIP_MAX, EQUIP_MAX===8);
  check('boutique sans compétences', !SHOP_ITEMS.includes('celerite') && !SHOP_ITEMS.includes('riposte'));

  /* ---- génération d'ennemis ---- */
  run = newRun('Test');
  const a = makeEnemy(7), b = makeEnemy(7);
  check('ennemi déterministe par lignée', a.classe===b.classe && a.weapon===b.weapon);
  let bossOk = true;
  for(let s=0;s<20;s++){ run.seed=s*991+3;
    for(const lvl of [10,20,30,40]){
      const e=makeEnemy(lvl), tr=Object.keys(TREES[e.classe]);
      if(!e.boss || tr.indexOf(e.weapon) < tr.length-2) bossOk=false;
    }
  }
  check('boss : toujours boss, arme haut d’arbre', bossOk);
  check('difficulté : PV croissants', makeEnemy(1).hp < makeEnemy(15).hp && makeEnemy(15).hp < makeEnemy(30).hp);

  /* ---- poids des classes ---- */
  run=newRun('T'); run.classe='double';   const oD=playerOpts();
  run.classe='bouclier';                  const oB=playerOpts();
  run.classe='deuxmains';                 const oH=playerOpts();
  check('saut : double > bouclier > deux mains', oD.jumpV>oB.jumpV && oB.jumpV>oH.jumpV);
  check('roulade : léger moins chère', oD.rollCost<oB.rollCost && oB.rollCost<oH.rollCost);

  /* ---- combat ---- */
  run=newRun('T'); run.level=1; startFight();
  check('combat démarré', game.screen==='fight' && !!enemy.name);
  let fr=0;
  while(!player.dead && !enemy.dead && fr<30000){
    const dt=1/60;
    player.x += Math.sign(enemy.x-player.x)*(Math.abs(enemy.x-player.x)>player.w.range-10?150*dt:0);
    if(!player.busy && Math.abs(enemy.x-player.x)<player.w.range) player.startAttack();
    player.update(dt,enemy); enemy.update(dt,player); fr++;
  }
  check('un combat se termine ('+(fr/60).toFixed(1)+' s)', player.dead||enemy.dead);

  /* ---- défenses ---- */
  run=newRun('T'); run.level=1; startFight();
  enemy.dead=false; enemy.x=player.x+40; player.facing=1; player.stam=100;
  player.state='roll';  const h1=player.hp; player.takeHit(10,enemy,'mid');
  check('roulade invincible', player.hp===h1);
  player.state='dash';  const h2=player.hp; player.takeHit(10,enemy,'mid');
  check('esquive non protectrice', player.hp<h2);
  player.state='idle'; player.blocking=true; player.stam=100;
  const h3=player.hp; player.takeHit(10,enemy,'low');
  check('coup bas ignore la garde', h3-player.hp>=5);

  /* ---- bouclier ---- */
  player.state='idle'; player.stam=0; player.blocking=false;
  player.shield={has:true,broken:false,max:70,hp:70};
  player.takeHit(10,enemy,'mid');
  check('bouclier lâché sans endurance', !player.shield.has && shieldDrops.some(d=>d.owner===player));
  player.state='idle'; player.shield={has:true,broken:false,max:70,hp:4}; player.stam=100; player.blocking=true;
  player.takeHit(10,enemy,'mid');
  check('bouclier brisé sous les coups', player.shield.broken);
  /* l'IA Murmillo (non boss) lâche aussi le sien */
  let seedB=null;
  for(let s=0;s<80 && seedB===null;s++){ run.seed=s*777+5; const e=makeEnemy(3); if(e.classe==='bouclier') seedB=s; }
  run.seed=seedB*777+5; run.level=3; startFight();
  enemy.stam=0; enemy.state='idle'; enemy.blocking=false;
  player.x=enemy.x-40; player.facing=1; player.aw=player.w;
  enemy.takeHit(10, player, 'mid');
  check('IA non boss lâche son bouclier', !enemy.shield.has && shieldDrops.some(d=>d.owner===enemy));

  /* ---- lancer de lance ---- */
  run=newRun('T'); run.wins=7; run.weapon='hasta'; run.level=1; startFight();
  player.startThrow();
  check('lance jetée → poings + projectile', player.thrown && player.w.fists===true && spears.length===1);
  for(let i=0;i<300;i++) updateSpears(1/60);
  check('la lance atterrit (plantée ou touche)', spearDrops.length===1 || enemy.hp<enemy.maxHp);
  if(spearDrops.length){
    player.state='idle'; player.x=spearDrops[0].x; player.y=0;
    updateSpears(1/60);
    check('lance récupérée en marchant dessus', !player.thrown && player.w.lance===true);
  }
  /* couteaux et haches lançables aussi */
  run=newRun('T'); run.weapon='pugio'; run.level=1; startFight();
  player.startThrow();
  check('couteau lançable', player.thrown && spears.length===1 && spears[0].type==='couteau');
  run=newRun('T'); run.wins=15; run.weapon='securis'; run.level=1; startFight();
  player.startThrow();
  check('hache lançable', player.thrown && spears.length===1 && spears[0].type==='hache');
  check('gladius non lançable', !WEAPONS.gladius.throwType);
  /* le saut coûte de l'endurance */
  run=newRun('T'); run.level=1; startFight();
  const st0=player.stam; player.jump();
  check('saut : endurance consommée', player.stam < st0);
  player.y=0; player.vy=0; player.state='idle'; player.stam=2;
  player.jump();
  check('saut refusé sans endurance', player.y===0);

  /* ---- victoire parfaite → duel à deux, puis remise à zéro ---- */
  run=newRun('T'); run.level=1; startFight();
  enemy.hp=0; enemy.die(); endFight(true);
  check('victoire parfaite détectée', run.flawless===true);
  nextFightPrep(); startFight();
  check('duel à deux avec dégâts réduits', !!enemy2 && enemy.dmgMult < makeEnemy(run.level).dmgMult);
  enemy.hp=0; enemy.die(); enemy2.hp=0; enemy2.die(); endFight(true);
  nextFightPrep(); startFight();
  check('retour à un adversaire, mécanique remise à zéro', enemy2===null && run.flawless===false);

  /* ---- cooldown commun esquive/roulade (1 s) ---- */
  player.startRoll(1);
  check('roulade → cooldown armé', player.dodgeCd===1);
  player.state='idle'; player.t=0; player.startDash(1);
  check('esquive refusée pendant le cooldown', player.state==='idle');
  for(let i=0;i<70;i++) player.update(1/60, enemy);
  player.state='idle'; player.startDash(1);
  check('esquive à nouveau possible après 1 s', player.state==='dash');

  /* ---- ulti : rechargée sur boss, un seul usage ---- */
  run=newRun('T'); run.classe='bouclier'; run.level=10; startFight();
  enemy.hp=0; enemy.die(); endFight(true);
  check('ulti rechargée après un boss', run.ulti===true);
  nextFightPrep(); startFight();
  player.activateUlti();
  check('Égide : invincible, charge consommée', player.ultiT>0 && run.ulti===false);
  const hpU=player.hp; player.takeHit(50, enemy, 'mid');
  check('aucun dégât sous Égide', player.hp===hpU);

  /* ---- IA : lance ses armes de jet ---- */
  check('IA : chance de lancer présente', makeEnemy(20).throwCh > 0);

  /* ---- pièges du public (31-40) : zone franche centrale ---- */
  run=newRun('T'); run.level=35; startFight();
  player.x=W*.5; enemy.x=W*.52; if(enemy2){enemy2.x=W*.5;}
  traps.length=0;
  for(let i=0;i<200;i++) spawnTrap();
  check('aucun projectile du public au centre', !traps.some(tr=>tr.type==='projo'));
  traps.length=0; player.x=W*.1; enemy.x=W*.12; if(enemy2){enemy2.x=W*.1;}
  for(let i=0;i<200;i++) spawnTrap();
  check('projectiles du public près des bords', traps.some(tr=>tr.type==='projo'));

  /* ---- durabilité du casque et de la cuirasse ---- */
  run=newRun('T'); run.equip.casque=2; run.equip.cuirasse=2;
  run.dura={casque:duraMax(2), cuirasse:duraMax(2)};
  run.level=1; startFight();
  const defAvant=playerOpts().dmgTakenMult;
  enemy.dead=false; enemy.x=player.x+40; player.facing=1; enemy.aw=WEAPONS.gladius;
  for(let i=0;i<40 && run.dura.casque>0;i++){ player.state='idle'; player.hp=200; player.takeHit(20, enemy, 'high'); }
  check('le casque se brise sous les coups à la tête', run.dura.casque===0);
  check('casque brisé = bonus perdu', playerOpts().dmgTakenMult > defAvant);
  run.gold=500; repairEquip('casque');
  check('réparation : durabilité pleine, niveau conservé', run.dura.casque===duraMax(2) && run.equip.casque===2);
  check('réparer coûte moins cher qu acheter', repairPrice('casque') < equipPrice('casque'));
  for(let i=0;i<60 && run.dura.cuirasse>0;i++){ player.state='idle'; player.hp=200; player.takeHit(20, enemy, 'mid'); }
  check('la cuirasse se brise sous les coups au corps', run.dura.cuirasse===0);

  /* ---- boss : compétences spéciales ---- */
  run=newRun('T'); run.level=10; startFight();
  enemy.spT=0.01;
  let spOk=false;
  for(let i=0;i<300;i++){ enemy.update(1/60,player); player.update(1/60,enemy); if(enemy.sp){spOk=true;break;} }
  check('le boss déclenche sa compétence', spOk);
  run.level=30; startFight();
  enemy.hp=enemy.maxHp*.4; enemy.updateAI(1/60,player);
  check('boss 30 : fureur sous 50 % PV', enemy.enraged===true);

  /* ---- perks par classe ---- */
  run=newRun('T'); run.classe='deuxmains';
  let pool=new Set();
  for(let i=0;i<300;i++) rollPerks().forEach(k=>pool.add(k));
  run.classe='double'; pool=new Set();
  for(let i=0;i<300;i++) rollPerks().forEach(k=>pool.add(k));
  check('perks double : célérité+esquive, sans riposte', pool.has('celerite') && pool.has('esquive') && !pool.has('riposte'));

  run=newRun('T'); run.level=1; startFight();
  enemy.hp=0; enemy.die(); endFight(true);
  check('or gagné en victoire', run.gold>0);
  check('perks proposés et persistés', Array.isArray(run.pendingPerks) && run.pendingPerks.length===3);
  game.screen='title'; gotoSelect();
  check('perk en attente re-proposé', game.screen==='upgrade');
  choosePerk(game.perkChoices[0]);
  check('perk consommé', run.pendingPerks===null && game.screen==='boutique');
  run.gold=500; const lv0=run.equip.casque; buyEquip('casque');
  check('achat en boutique', run.equip.casque===lv0+1 && run.gold===500-(50+lv0*40));

  run.level=5;  check('arène I au niveau 5', arenaTier()===1);
  run.level=15; check('arène II au niveau 15', arenaTier()===2);
  run.level=25; check('arène III au niveau 25', arenaTier()===3);
  run.level=25; startFight();
  player.dead=true; traps.length=0; trapTimer=0.01; updateTraps(1);
  check('pièges figés après KO', traps.length===0);

  const vieux={name:'X',level:5,wins:4,dead:false,stats:{vie:0,armure:0,endurance:0},equip:{casque:1},weapon:'spatha'};
  migrateRun(vieux);
  check('migration : classe/seed/or/bouclier', vieux.classe==='bouclier' && !!vieux.seed && vieux.gold===0 && vieux.equip.bouclier===0);

  saveData.scores=[];
  for(let i=0;i<12;i++){ run.wins=i; pushScore(run); }
  check('scores plafonnés à 10, triés', saveData.scores.length===10 && saveData.scores[0].w===11);

  run=newRun('R'); run.level=1; startFight();
  for(const gq of ['low','medium','high']){
    saveData.gfx=gq;
    arenaCache.key=null;
    drawArena(1.0); drawFighter(player,1.0); drawFighter(enemy,1.0); drawHUD();
  }
  check('rendu sans erreur (3 qualités)', true);

}})()`);

console.log('');
if(failures){ console.error(failures + " test(s) en échec"); process.exit(1); }
console.log('Tous les tests passent.');

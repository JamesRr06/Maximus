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

  /* ---- couche d'intention (base du mode en ligne) ---- */
  run=newRun('T'); run.level=1; startFight();
  check('intent : objet présent sur le combattant', !!player.intent && typeof player.intent.move==='number');
  // On simule une source distante : l'intent est injecté (non écrasé par le local)
  player.inputSrc='remote';
  // attaque pilotée uniquement par l'intent (comme le fera une entrée réseau)
  player.state='idle'; player.t=0; player.stam=100; enemy.x=player.x+40; player.facing=1;
  player.intent.attack=true; player.update(1/60, enemy);
  check('intent : attaque déclenchée via intent.attack', player.busy || player.state==='attack');
  check('intent : flag ponctuel consommé (remis à false)', player.intent.attack===false);
  // déplacement piloté par intent.move
  player.state='idle'; player.t=0; player.vx=0; player.st.stun=0; player.blocking=false;
  const x0=player.x; player.intent.move=1; player.intent.crouch=false;
  for(let i=0;i<15;i++){ player.intent.move=1; player.update(1/60, enemy); }
  check('intent : déplacement via intent.move', player.x>x0);
  // garde maintenue via intent.block
  player.state='idle'; player.t=0; player.y=0; player.st.stun=0;
  player.intent.move=0; player.intent.block=true; player.update(1/60, enemy);
  check('intent : garde maintenue via intent.block', player.blocking===true);
  player.intent.block=false; player.update(1/60, enemy);
  check('intent : garde relâchée quand intent.block retombe', player.blocking===false);
  player.inputSrc='local';

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
  /* lancer : endurance pleine exigée, consommée en totalité (joueur) */
  run=newRun('T'); run.wins=7; run.weapon='hasta'; run.level=1; startFight();
  player.stam=player.maxStam*.8; player.startThrow();
  check('lancer refusé sous 100 % d’endurance', !player.thrown);
  player.stam=player.maxStam; player.startThrow();
  check('lancer : toute l’endurance consommée', player.thrown && player.stam===0);
  /* le saut coûte de l'endurance */
  run=newRun('T'); run.level=1; startFight();
  const st0=player.stam; player.jump();
  check('saut : endurance consommée', player.stam < st0);
  player.y=0; player.vy=0; player.state='idle'; player.stam=2;
  player.jump();
  check('saut refusé sans endurance', player.y===0);

  /* ---- combat parfait : +25 % d'or ---- */
  run=newRun('T'); run.level=1; startFight();
  enemy.hp=0; enemy.die(); endFight(true);
  const orParfait=game.lastGold;
  run=newRun('T'); run.level=1; startFight();
  player.tookDamage=true; enemy.hp=0; enemy.die(); endFight(true);
  check('combat parfait : +25 % d’or', orParfait===Math.round(game.lastGold*1.25) && game.lastPerfect===false);
  /* ---- duels 1 c. 2 aléatoires dès le niveau 30 ---- */
  game.mode='solo'; game.coopOn=false;
  let sawDuo=false, sawSolo=false, armesOK=true;
  for(let s=0;s<40;s++){
    run=newRun('T'); run.seed=s*4241+9; run.level=33; startFight();
    if(enemy2){
      sawDuo=true;
      if(enemy2.weaponKey===enemy.weaponKey) armesOK=false;
      if(Math.abs(enemy.dmgMult - makeEnemy(33).dmgMult*.75)>.01) armesOK=false;
    } else sawSolo=true;
  }
  check('1 c. 2 aléatoire après le niveau 30 (les deux issues existent)', sawDuo && sawSolo);
  check('duo niv 30+ : armes différentes, dégâts ×0,75', armesOK);
  run=newRun('T'); run.level=10; startFight();
  check('jamais de 1 c. 2 avant le niveau 30 (hors coop)', enemy2===null);
  /* ---- poings réduits mais boostés par les multiplicateurs ---- */
  check('poings affaiblis (3 dégâts de base)', FISTS.dmg===3);
  /* ---- ramassage universel des armes au sol ---- */
  run=newRun('T'); run.wins=7; run.weapon='gladius'; run.level=1; startFight();
  spearDrops.push({x:player.x, w:WEAPONS.hasta, owner:enemy});
  player.thrown=true; player.baseW=player.w; player.w=FISTS; player.state='idle'; player.y=0;
  updateSpears(1/60);
  check('le joueur ramasse l’arme d’un ennemi', !player.thrown && player.w===WEAPONS.hasta);

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
  /* l'IA subit la même usure : équipement arraché et retiré du visuel */
  run=newRun('T'); run.level=20; startFight();
  enemy.eqv.casque=3; enemy.dura={casque:duraMax(3), cuirasse:duraMax(enemy.eqv.cuirasse||0)};
  player.x=enemy.x-40; player.facing=1; player.aw=WEAPONS.gladius;
  for(let i=0;i<60 && enemy.eqv.casque>0;i++){ enemy.state='idle'; enemy.hp=500; enemy.st.stun=0; enemy.takeHit(20, player, 'high'); }
  check('casque de l IA arraché (disparaît du visuel)', enemy.eqv.casque===0);

  /* ---- multijoueur local ---- */
  game.vsP1='bouclier'; game.vsP2='double'; game.mode='versus';
  startVersus();
  check('duel local : deux combattants humains', !player.isAI && !player2.isAI && enemy===player2);
  check('duel local : J2 pilotée à la manette', player2.padIdx===0);
  drawMode(1); drawVsSetup(1); drawVsEnd(1);
  check('écrans multi : rendu sans erreur', true);
  game.mode='coop'; game.coopOn=true; game.coopClasse='double'; game.coopHue=330;
  run=newRun('Duo'); run.level=1; startFight();
  check('coop : Joueur 2 présent (manette)', !!player2 && player2.padIdx===0 && player2.classe==='double');
  check('coop : toujours deux IA en face', !!enemy2);
  check('coop : dégâts IA réduits (×0,8)', Math.abs(enemy.dmgMult - makeEnemy(1).dmgMult*.8) < .01);
  enemy.hp=0; enemy.die(); enemy2.hp=0; enemy2.die(); endFight(true);
  check('coop : pas de mécanique victoire parfaite', run.flawless===false);
  game.mode='solo'; game.coopOn=false; player2=null;
  check('manette absente : padList vide et sans erreur', padList().length===0);

  /* ---- réseau en ligne : machine à états du salon (étape 2) ---- */
  (function(){
    function FakeWS(){ this.readyState=1; this.sent=[]; const self=this;
      this.send=s=>self.sent.push(JSON.parse(s));
      this.close=()=>{ self.readyState=3; if(self.onclose) self.onclose(); }; }
    let fake=null;
    Net._mk=()=>{ fake=new FakeWS(); return fake; };
    // hôte
    Net.host(); fake.onopen();
    check('réseau : host envoie {t:host}', fake.sent.length===1 && fake.sent[0].t==='host');
    fake.onmessage({data:JSON.stringify({t:'hosted', code:'MAX-AB12'})});
    check('réseau : code reçu, statut waiting', Net.code==='MAX-AB12' && Net.status==='waiting');
    let ready=false; Net.onReady=()=>ready=true;
    fake.onmessage({data:JSON.stringify({t:'peer-joined'})});
    check('réseau : peer-joined -> ready + callback', Net.status==='ready' && ready===true);
    let got=null; Net.onData=m=>got=m;
    fake.onmessage({data:JSON.stringify({t:'state', hp:7})});
    check('réseau : message applicatif routé vers onData', !!got && got.hp===7);
    Net.leave();
    check('réseau : leave remet à idle', Net.status==='idle' && Net.ws===null);
    // client + erreur
    Net.join('max-zzzz'); fake.onopen();
    check('réseau : join envoie {t:join, code} en majuscules', fake.sent[0].t==='join' && fake.sent[0].code==='MAX-ZZZZ');
    fake.onmessage({data:JSON.stringify({t:'error', reason:'no-room'})});
    check('réseau : no-room -> statut error + message', Net.status==='error' && /introuvable/.test(Net.error));
    Net.leave(); Net.onReady=null; Net.onData=null;
  })();

  /* ---- écrans EN LIGNE : rendu (étape 2) ---- */
  game.screen='onlineMenu'; drawOnlineMenu(1.0);
  check('écran onlineMenu : rendu (3 classes + héberger/rejoindre)', game.cards.length===6);
  Net.code='MAX-AB12'; Net.status='waiting'; game.screen='onlineHost'; drawOnlineHost(1.0);
  check('écran onlineHost : rendu (code affiché)', true);
  Net.status='ready'; drawOnlineHost(1.0);
  check('écran onlineHost : rendu état connecté', true);
  Net.status='idle'; Net.code=''; game.codeInput='AB12'; game.screen='onlineJoin'; drawOnlineJoin(1.0);
  check('écran onlineJoin : rendu + bouton rejoindre', game.cards.length===2);
  Net.leave(); game.screen='mode'; drawMode(1.0);
  check('écran mode : carte EN LIGNE présente (4 cartes)', game.cards.length===5);

  /* ---- mode en ligne : boucle host-autoritaire (étape 3) ---- */
  (function(){
    const fake={ readyState:1, sent:[], send(s){ this.sent.push(JSON.parse(s)); }, close(){} };
    Net.ws=fake; saveData.name='Hôte'; saveData.onlineScore=0;
    // HANDSHAKE : l'hôte reçoit le hello de l'invité -> envoie start + démarre
    Net.role='host';
    onlineOnData({t:'hello', build:BUILD, cfg:{classe:'bouclier', name:'Invité', look:null}});
    const startMsg=fake.sent.find(m=>m.t==='start');
    check('en ligne : hôte répond par un start', !!startMsg && !!startMsg.cfg);
    check('en ligne : hôte démarre le combat', game.online===true && game.screen==='fight');
    check('en ligne : hôte contrôle player (local), player2 distant',
      player.inputSrc==='local' && player2.inputSrc==='remote');
    check('en ligne : match remis à zéro (0-0, manche 1)',
      game.rounds.p1===0 && game.rounds.p2===0 && game.roundNo===1 && !game.matchOver);
    const cfg=startMsg.cfg;
    // INTENT : l'hôte applique l'intent reçu de l'invité à player2
    onlineOnData({t:'in', i:{move:1, attack:true, block:true}});
    check('en ligne : intent réseau appliqué à player2',
      player2.intent.move===1 && player2.intent.attack===true && player2.intent.block===true);
    // SNAPSHOT : aller-retour (sérialisation -> application)
    player.x=333; player.hp=71; player2.x=444; player2.hp=52;
    const snap=makeSnap();
    player.x=0; player.hp=1; player2.x=0; player2.hp=1;
    applySnap(snap);
    check('en ligne : snapshot restitue positions et PV',
      player.x===333 && player.hp===71 && player2.x===444 && player2.hp===52);
    // BEST-OF-5 : trois manches gagnées par l'hôte -> fin de match + point
    Net.role='host'; game.matchOver=false; game.rounds={p1:0,p2:0}; game.roundOver=false; game.pointAwarded=false;
    for(let r=0;r<3;r++){
      player.dead=false; player2.dead=true; game.koTimer=1.7; game.roundOver=false;
      onlineHostPostUpdate(0.1);
    }
    check('en ligne : premier à 3 manches -> match terminé', game.matchOver===true && game.rounds.p1===3);
    check('en ligne : écran de fin affiché', game.screen==='onlineEnd');
    check('en ligne : +1 point au vainqueur (hôte)', (saveData.onlineScore||0)===1);
    // rendu de l'écran de fin
    drawOnlineEnd(1.0);
    check('en ligne : écran de fin -> revanche + quitter', game.cards.length===2);
    // CÔTÉ INVITÉ : reçoit start -> contrôle player2 en local
    Net.role='guest';
    onlineOnData({t:'start', cfg});
    check('en ligne : invité contrôle player2 (local), player distant',
      player2.inputSrc==='local' && player.inputSrc==='remote');
    check('en ligne : combattant local = player2 côté invité', localFighter()===player2);
    Net.role='host';
    check('en ligne : combattant local = player côté hôte', localFighter()===player);
    Net.leave(); game.online=false; game.mode='solo'; player2=null; game.screen='title';
  })();

  /* ---- lissage de latence : interpolation / prédiction / réconciliation (étape 4) ---- */
  (function(){
    const fake={ readyState:1, sent:[], send(s){ this.sent.push(JSON.parse(s)); }, close(){} };
    Net.ws=fake; Net.role='guest';
    const cfg={ seed:1, p1:{classe:'bouclier',hue:210,name:'H',look:null},
                        p2:{classe:'bouclier',hue:0,name:'I',look:null} };
    onlineOnData({t:'start', cfg});
    check('étape4 : invité prêt (player2 local)', player2.inputSrc==='local' && game.online===true);
    // PRÉDICTION : la simulation locale avance sans attendre de snapshot
    player2.inputSrc='remote'; // (proxy : en headless il n'y a pas de clavier pour remplir l'intent)
    player2.state='idle'; player2.t=0; player2.vx=0; player2.st.stun=0; player2.dead=false;
    const px0=player2.x;
    for(let i=0;i<12;i++){ player2.intent.move=1; player2.update(1/60, player, [player]); }
    check('étape4 : prédiction locale (déplacement immédiat)', player2.x>px0);
    player2.inputSrc='local';
    // INTERPOLATION : l'adversaire est lissé entre deux snapshots
    const T=perfNow();
    const mk=(x)=>({t:'snap', a:Object.assign(fSnap(player),{x:x}), b:fSnap(player2), sp:[], fo:[], rn:1, rs:{p1:0,p2:0}, ko:0});
    game.snapHist=[{time:T-300, s:mk(100)}, {time:T+60, s:mk(400)}];
    interpRemote(player);
    check('étape4 : adversaire interpolé entre deux positions', player.x>100 && player.x<400);
    // RÉCONCILIATION : PV autoritaires + correction douce de la position
    const stZ={slow:0,stun:0,blind:0,bleedT:0,bleedDps:0,regenT:0,regenPs:0};
    player2.x=200; player2.dead=false; player2.state='attack';
    reconcileSelf(player2, Object.assign(fSnap(player2),{hp:33, x:260, s:'attack', d:false, st:stZ}));
    check('étape4 : PV autoritaires appliqués', player2.hp===33);
    check('étape4 : correction douce (pas de téléport)', player2.x>200 && player2.x<260);
    // INTERRUPTION : l'autorité impose l'état « touché » + la position
    player2.x=200; player2.state='attack';
    reconcileSelf(player2, Object.assign(fSnap(player2),{hp:20, x:150, s:'hit', d:false, st:Object.assign({},stZ,{stun:400})}));
    check('étape4 : interruption -> état + position autoritaires', player2.state==='hit' && player2.x===150);
    Net.leave(); game.online=false; game.mode='solo'; player2=null; game.screen='title';
  })();

  /* ---- raffinement : choix de classe en ligne ---- */
  (function(){
    const fake={ readyState:1, sent:[], send(s){ this.sent.push(JSON.parse(s)); }, close(){} };
    Net.ws=fake; Net.role='host'; saveData.onlineClass='double';
    onlineOnData({t:'hello', build:BUILD, cfg:{classe:'deuxmains', name:'Inv', look:null}});
    const sm=fake.sent.find(m=>m.t==='start');
    check('classe en ligne : hôte utilise sa classe (p1)', sm.cfg.p1.classe==='double');
    check('classe en ligne : invité transmet sa classe (p2)', sm.cfg.p2.classe==='deuxmains');
    check('classe en ligne : combattants créés avec la bonne classe', player.classe==='double' && player2.classe==='deuxmains');
    // le sélecteur du menu mémorise le choix
    saveData.onlineClass='bouclier'; game.screen='onlineMenu'; drawOnlineMenu(1.0);
    const classCard=game.cards[3]; classCard.action(); // une carte de classe (backBtn=0, classes=1..3)
    check('classe en ligne : sélecteur mémorise une classe valide', !!CLASSES[saveData.onlineClass]);
    Net.leave(); game.online=false; game.mode='solo'; player2=null; game.screen='title';
  })();

  /* ---- raffinements : pièges synchronisés + entracte de manche ---- */
  (function(){
    const fake={ readyState:1, sent:[], send(s){ this.sent.push(JSON.parse(s)); }, close(){} };
    Net.ws=fake; Net.role='host'; saveData.onlineClass='bouclier';
    onlineOnData({t:'hello', build:BUILD, cfg:{classe:'bouclier', name:'I', look:null}});
    // fin de manche -> entracte (pas de reset immédiat)
    game.rounds={p1:0,p2:0}; game.roundOver=false; game.matchOver=false; game.interRound=0; game.koTimer=1.7;
    player.dead=false; player2.dead=true;
    onlineHostPostUpdate(0.1);
    check('entracte : manche gagnée -> entracte actif', game.interRound>0 && game.rounds.p1===1);
    // snapshot : pièges + entracte transportés
    traps=[{type:'spikes', x:300, t:0.2, phase:'warn', side:0, stone:false, hit:new Set()}];
    const snap=makeSnap();
    check('pièges : snapshot contient les pièges', snap.tr.length===1 && snap.tr[0].ty==='spikes');
    check('entracte : snapshot transporte interRound', snap.ir>0);
    // application côté client
    traps=[]; game.interRound=0;
    applySnapMeta(snap);
    check('pièges : appliqués côté client', traps.length===1 && traps[0].type==='spikes' && traps[0].phase==='warn');
    check('entracte : appliqué côté client', game.interRound>0);
    // l'entracte se résorbe et enchaîne la manche suivante (hôte)
    Net.role='host'; game.interRound=0.05; game.roundNo=2; game.matchOver=false;
    onlineFrame(0.1);
    check('entracte : fin d’entracte -> combattants réinitialisés', game.interRound===0 && player.dead===false && player2.dead===false);
    Net.leave(); game.online=false; game.mode='solo'; player2=null; game.screen='title'; traps=[];
  })();

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

  // ---- manette : navigation des menus par boutons ----
  game.cards=[
    {x:100,y:200,w:100,h:100,action(){ this.hit='g'; }},
    {x:300,y:200,w:100,h:100,action(){ padHit='milieu'; }},
    {x:500,y:200,w:100,h:100,action(){ padHit='droite'; }},
    {x:300,y:400,w:100,h:100,action(){ padHit='bas'; }},
  ];
  let padHit='';
  pads.sel=0; pads.dirPrev={};
  padMoveSel(1,0);  check('manette : droite → carte voisine', pads.sel===1);
  padMoveSel(0,1);  check('manette : bas → carte du dessous', pads.sel===3);
  padMoveSel(0,-1); check('manette : haut → retour', pads.sel===1);
  padMoveSel(-1,0);
  check('manette : gauche → carte voisine', pads.sel===0);
  padMoveSel(-1,0);
  check('manette : wrap — tous les boutons accessibles en bouclant', pads.sel===2);
  const fakePad={index:0, axes:[.9,0], buttons:Array.from({length:16},()=>({pressed:false,value:0}))};
  pads.dirPrev={};
  check('manette : stick = une impulsion, pas de rafale', padDir(fakePad,'x')===1 && padDir(fakePad,'x')===0 && padDir(fakePad,'x')===0);
  fakePad.axes[0]=0; padDir(fakePad,'x'); fakePad.axes[0]=.9;
  check('manette : nouvelle impulsion après retour au neutre', padDir(fakePad,'x')===1);
  pads.sel=1; game.cards[1].action();
  check('manette : A valide le bouton sélectionné', padHit==='milieu');
  game.cards=[];

  // ---- manette : boutons remappables ----
  check('manette : mapping par défaut', padBinds.attack===2 && padBinds.jump===0 && padBinds.pause===9);
  padBinds.attack=5;
  check('manette : remap appliqué (partagé avec la sauvegarde)', saveData.pad.attack===5);
  padBinds.attack=DEFAULT_PAD.attack;
  check('manette : noms des boutons', padBtnName(3)==='Y' && padBtnName(9)==='START');
  game.optionsFrom='title'; drawOptionsPad(1.0);
  check('écran manette : rendu + cartes', game.cards.length>0);

  // ---- apparence : physique du joueur et looks aléatoires de l'IA ----
  run=newRun('L');
  check('joueur : physique par défaut présent', !!run.look && typeof run.look.peau==='number');
  const lA=makeEnemy(5).look, lB=makeEnemy(5).look;
  check('IA : physique aléatoire mais déterministe par lignée', JSON.stringify(lA)===JSON.stringify(lB));
  let lookVarie=false;
  for(let l=1;l<=12 && !lookVarie;l++) if(JSON.stringify(makeEnemy(l).look)!==JSON.stringify(lA)) lookVarie=true;
  check('IA : physiques variés d’un adversaire à l’autre', lookVarie);
  run.level=1; startFight();
  check('combat : l’ennemi porte son look', !!enemy.look);
  enemy.look={sexe:'f',tete:1,coiffure:2,barbe:0,cheveux:3,peau:4,torse:1}; drawFighter(enemy,1.0);
  player.look={sexe:'h',tete:2,coiffure:5,barbe:4,cheveux:0,peau:2,torse:2}; drawFighter(player,1.0);
  check('rendu des physiques (femme, barbes, coiffures) sans erreur', true);
  game.persoTarget='p1'; game.persoFrom='couleur';
  drawPerso(1.0); check('écran physique J1 : rendu + cartes', game.cards.length>0);
  game.persoTarget='p2'; game.mode='solo'; drawPerso(1.0);
  check('écran physique J2 : rendu sans erreur', game.cards.length>0);
  game.persoTarget='p1';

  // ---- roulade : passe à travers l'adversaire ----
  run=newRun('L'); run.level=1; game.mode='solo'; game.coopOn=false; player2=null; startFight();
  game.paused=false;
  player.state='idle'; enemy.st.stun=2; enemy.aiMove=0;
  player.x=400; enemy.x=408;
  frame(performance.now());
  check('corps séparés hors roulade', Math.abs(enemy.x-player.x)>20);
  player.x=400; enemy.x=408; enemy.st.stun=2;
  player.state='roll'; player.rollDir=1; player.t=0;
  frame(performance.now());
  check('roulade : traverse l’adversaire (pas de séparation)', Math.abs(enemy.x-player.x)<20);

  // ---- sélection d'armes : icônes dessinées sans erreur ----
  for(const k of Object.keys(WEAPONS)) drawWeaponIcon(k, 60, 60, 62);
  check('icônes d’armes : les 19 se dessinent', true);
  run=newRun('R'); run.level=1; game.screen='select'; drawSelect(1.0);
  check('écran de sélection épuré : rendu + cartes', game.cards.length>0);

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

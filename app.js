/* ==========================================================================
   Neon Claw - Main Game Logic & Matter.js Physics Engine
   描画ベースアーム + Constraint固定方式
   ========================================================================== */

// Matter.js モジュールエイリアス
const {
  Engine,
  Render,
  Runner,
  Bodies,
  Body,
  Composite,
  Constraint,
  Events,
  Vector
} = Matter;

// ゲーム状態定義
const STATES = {
  IDLE: 'IDLE',
  READY: 'READY',
  MOVE_RIGHT: 'MOVE_RIGHT',
  STOP_RIGHT: 'STOP_RIGHT',
  DESCENDING: 'DESCENDING',
  GRABBING: 'GRABBING',
  ASCENDING: 'ASCENDING',
  RETURNING: 'RETURNING',
  RELEASING: 'RELEASING',
  RESETTING: 'RESETTING'
};

// ゲームの設定パラメータ
const CONFIG = {
  canvasWidth: 600,
  canvasHeight: 750,
  initialClawX: 180,
  initialClawY: 120,
  maxClawX: 540,
  maxClawY: 580,
  speedX: 3.5,
  speedY: 3.0,
  grabDuration: 800,           // 爪が閉じるアニメーション時間 (ms)
  releaseDuration: 1500,
  clawArmLength: 65,           // 爪の腕の長さ (px)
  clawTipLength: 28,           // 爪の先端フック長さ (px)
  clawOpenAngle: 0.85,         // 爪が開いた時の角度 (rad) ≈49°
  clawCloseAngle: 0.0,         // 爪が閉じた時の角度 (rad) 完全に閉じる
  grabSearchRadius: 70,        // 掴み判定の探索半径 (px)
  prizeImages: ['1.png', '2.png', '3.png'],
  prizeNames: {
    '1.png': '博多水無月抹茶',
    '2.png': '博多水無月小豆',
    '3.png': '博多水無月甘夏'
  }
};

// グローバルゲーム変数
let engine;
let render;
let runner;
let clawHead;                    // 位置参照用の静的ボディ（非表示）
let sensor;
let grabbedConstraints = [];
let grabbedBodies = [];
let isAudioInitialized = false;
let audioCtx = null;

// 爪のビジュアル状態
let clawAngle = CONFIG.clawOpenAngle;       // 現在の爪の開き角度
let clawTargetAngle = CONFIG.clawOpenAngle;  // 目標の角度

// ゲーム進行管理
let currentState = STATES.IDLE;
let credits = 3;
let score = 0;
let collection = { '1.png': 0, '2.png': 0, '3.png': 0 };
let currentClawPos = { x: CONFIG.initialClawX, y: CONFIG.initialClawY };

// DOM要素のキャッシュ
const elCredits = document.getElementById('credit-count');
const elScore = document.getElementById('get-count');
const elBtnInsertCoin = document.getElementById('btn-insert-coin');
const elBtnRefill = document.getElementById('btn-refill');
const elBtnMoveRight = document.getElementById('btn-move-right');
const elBtnMoveDown = document.getElementById('btn-move-down');
const elInstructions = document.getElementById('action-instructions');
const elModal = document.getElementById('prize-modal');
const elModalPrizeImg = document.getElementById('modal-prize-img');
const elModalPrizeName = document.getElementById('modal-prize-name');
const elBtnCloseModal = document.getElementById('btn-close-modal');
const elLoadingOverlay = document.getElementById('loading-overlay');

// ==========================================================================
// 1. Web Audio API 音響システム
// ==========================================================================

function initAudio() {
  if (isAudioInitialized) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  isAudioInitialized = true;
}

function playSynthSound(type) {
  if (!isAudioInitialized || !audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const now = audioCtx.currentTime;

  switch (type) {
    case 'coin': {
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc1.type = 'square';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      osc1.frequency.setValueAtTime(880.00, now + 0.08);
      osc2.frequency.setValueAtTime(880.00, now + 0.08);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc1.connect(gain); osc2.connect(gain); gain.connect(audioCtx.destination);
      osc1.start(now); osc2.start(now + 0.08);
      osc1.stop(now + 0.4); osc2.stop(now + 0.4);
      break;
    }
    case 'move': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.linearRampToValueAtTime(130, now + 0.1);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.linearRampToValueAtTime(0.04, now + 0.08);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.1);
      break;
    }
    case 'grab': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(450, now + 0.6);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.6);
      break;
    }
    case 'release': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(450, now);
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.6);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.6);
      break;
    }
    case 'win': {
      const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
      const duration = 0.08;
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, now + idx * duration);
        gain.gain.setValueAtTime(0.06, now + idx * duration);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * duration + 0.3);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(now + idx * duration); osc.stop(now + idx * duration + 0.35);
      });
      break;
    }
  }
}

// ==========================================================================
// 2. セーブデータ管理
// ==========================================================================

function loadGameData() {
  const savedCollection = localStorage.getItem('neon_claw_collection');
  const savedScore = localStorage.getItem('neon_claw_score');
  const savedCredits = localStorage.getItem('neon_claw_credits');

  if (savedCollection) {
    collection = JSON.parse(savedCollection);
  }

  if (savedScore) {
    score = parseInt(savedScore, 10);
    elScore.textContent = score;
  }

  if (savedCredits) {
    credits = parseInt(savedCredits, 10);
    elCredits.textContent = credits;
  }
}

function saveGameData() {
  localStorage.setItem('neon_claw_collection', JSON.stringify(collection));
  localStorage.setItem('neon_claw_score', score.toString());
  localStorage.setItem('neon_claw_credits', credits.toString());
}

// ==========================================================================
// 3. 物理エンジン & ゲームワールド構築
// ==========================================================================

function initPhysics() {
  const container = document.getElementById('game-canvas-container');

  engine = Engine.create({
    gravity: { y: 1.2 }
  });

  render = Render.create({
    element: container,
    engine: engine,
    options: {
      width: CONFIG.canvasWidth,
      height: CONFIG.canvasHeight,
      wireframes: false,
      background: 'transparent',
      showVelocity: false,
      showAngleIndicator: false
    }
  });

  Render.run(render);

  runner = Runner.create();
  Runner.run(runner, engine);

  // 外壁・筐体パーツの配置
  const wallOptions = {
    isStatic: true,
    render: { fillStyle: '#18183a' }
  };

  const partition = Bodies.rectangle(130, CONFIG.canvasHeight - 110, 14, 220, {
    isStatic: true,
    render: {
      fillStyle: '#3a3a78',
      strokeStyle: varColor('--neon-blue'),
      lineWidth: 2
    }
  });

  const bottomFloor = Bodies.rectangle(
    (CONFIG.canvasWidth + 137) / 2,
    CONFIG.canvasHeight - 10,
    CONFIG.canvasWidth - 137,
    20,
    wallOptions
  );

  const chuteFloor = Bodies.rectangle(65, CONFIG.canvasHeight - 10, 130, 20, {
    isStatic: true,
    render: { fillStyle: '#0d0d21' }
  });

  const slide = Bodies.rectangle(30, CONFIG.canvasHeight - 50, 120, 10, {
    isStatic: true,
    angle: Math.PI / 6,
    render: { fillStyle: '#18183a' }
  });

  sensor = Bodies.rectangle(65, CONFIG.canvasHeight - 40, 110, 20, {
    isSensor: true,
    isStatic: true,
    render: { visible: false }
  });

  const leftWall = Bodies.rectangle(5, CONFIG.canvasHeight / 2, 10, CONFIG.canvasHeight, wallOptions);
  const rightWall = Bodies.rectangle(CONFIG.canvasWidth - 5, CONFIG.canvasHeight / 2, 10, CONFIG.canvasHeight, wallOptions);
  const ceiling = Bodies.rectangle(CONFIG.canvasWidth / 2, 5, CONFIG.canvasWidth, 10, wallOptions);

  Composite.add(engine.world, [
    partition, bottomFloor, chuteFloor, slide, sensor,
    leftWall, rightWall, ceiling
  ]);

  // アームシステムの構築（描画ベース）
  createClawAssembly();

  // 景品の配置
  spawnPrizes(15);

  // コリジョンイベント
  Events.on(engine, 'collisionStart', handleCollisions);

  // カスタム描画（ワイヤー＋爪）
  Events.on(render, 'afterRender', drawClawSystem);

  // ローディング画面を隠す
  elLoadingOverlay.style.opacity = '0';
  setTimeout(() => { elLoadingOverlay.style.display = 'none'; }, 500);
}

function varColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ==========================================================================
// 4. クレーンアーム（描画ベース方式）
// ==========================================================================

function createClawAssembly() {
  const x = CONFIG.initialClawX;
  const y = CONFIG.initialClawY;

  // clawHeadは位置参照用の非表示静的ボディ
  // 物理的な衝突はしない（isSensor）
  clawHead = Bodies.rectangle(x, y, 10, 10, {
    isStatic: true,
    isSensor: true,
    render: { visible: false }
  });

  Composite.add(engine.world, [clawHead]);
}

// 爪の開閉をビジュアルアニメーションで制御
function setClawState(openState) {
  if (openState) {
    clawTargetAngle = CONFIG.clawOpenAngle;
    playSynthSound('release');
  } else {
    clawTargetAngle = CONFIG.clawCloseAngle;
    playSynthSound('grab');
  }
}

// 爪の近くにある景品を探索してConstraintで固定する
function attachNearbyPrizes() {
  const headPos = clawHead.position;
  // 爪の先端位置を計算
  const tipY = headPos.y + CONFIG.clawArmLength + 5;
  const searchCenter = { x: headPos.x, y: tipY };
  const allBodies = Composite.allBodies(engine.world);

  let closestPrize = null;
  let closestDist = Infinity;

  for (const body of allBodies) {
    if (body.label !== 'prize' || body.isPendingRemoval) continue;

    const dx = body.position.x - searchCenter.x;
    const dy = body.position.y - searchCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < CONFIG.grabSearchRadius && dist < closestDist) {
      closestDist = dist;
      closestPrize = body;
    }
  }

  if (closestPrize) {
    // 景品をclawHeadにConstraintで拘束
    const offsetX = closestPrize.position.x - headPos.x;
    const offsetY = closestPrize.position.y - headPos.y;

    const grabConstraint = Constraint.create({
      bodyA: clawHead,
      pointA: { x: offsetX, y: offsetY },
      bodyB: closestPrize,
      pointB: { x: 0, y: 0 },
      stiffness: 1.0,    // 完全に固定
      damping: 0.3,
      length: 0,
      render: { visible: false }
    });

    Composite.add(engine.world, grabConstraint);
    grabbedConstraints.push(grabConstraint);
    grabbedBodies.push(closestPrize);

    console.log('[Grab] Prize attached to claw!');
  } else {
    console.log('[Grab] No prize found within grab radius.');
  }
}

// 掴んだ景品を解放する
function detachAllPrizes() {
  for (const c of grabbedConstraints) {
    Composite.remove(engine.world, c);
  }
  grabbedConstraints = [];
  grabbedBodies = [];
  console.log('[Grab] All prizes released.');
}

// ==========================================================================
// 5. 毎フレームのアーム制御 & 爪アニメーション
// ==========================================================================

function updateClawPhysics() {
  // 爪の角度をターゲットに向けて滑らかにアニメーション
  const angleSpeed = 0.05;
  if (clawAngle < clawTargetAngle) {
    clawAngle = Math.min(clawAngle + angleSpeed, clawTargetAngle);
  } else if (clawAngle > clawTargetAngle) {
    clawAngle = Math.max(clawAngle - angleSpeed, clawTargetAngle);
  }

  // 状態に合わせてアーム位置を制御
  switch (currentState) {
    case STATES.READY:
      currentClawPos.x = CONFIG.initialClawX;
      currentClawPos.y = CONFIG.initialClawY;
      break;

    case STATES.MOVE_RIGHT:
      currentClawPos.x += CONFIG.speedX;
      if (currentClawPos.x >= CONFIG.maxClawX) {
        currentClawPos.x = CONFIG.maxClawX;
        transitionTo(STATES.STOP_RIGHT);
      }
      playSynthSound('move');
      break;

    case STATES.DESCENDING:
      currentClawPos.y += CONFIG.speedY;
      if (currentClawPos.y >= CONFIG.maxClawY) {
        currentClawPos.y = CONFIG.maxClawY;
        performGrab();
      }
      playSynthSound('move');
      break;

    case STATES.ASCENDING:
      currentClawPos.y -= CONFIG.speedY;
      if (currentClawPos.y <= CONFIG.initialClawY) {
        currentClawPos.y = CONFIG.initialClawY;
        transitionTo(STATES.RETURNING);
      }
      playSynthSound('move');
      break;

    case STATES.RETURNING:
      currentClawPos.x -= CONFIG.speedX;
      if (currentClawPos.x <= 70) {
        currentClawPos.x = 70;
        performRelease();
      }
      playSynthSound('move');
      break;

    case STATES.RESETTING:
      let reached = true;
      if (currentClawPos.x < CONFIG.initialClawX) {
        currentClawPos.x += CONFIG.speedX;
        if (currentClawPos.x >= CONFIG.initialClawX) currentClawPos.x = CONFIG.initialClawX;
        reached = false;
      }
      if (currentClawPos.y > CONFIG.initialClawY) {
        currentClawPos.y -= CONFIG.speedY;
        if (currentClawPos.y <= CONFIG.initialClawY) currentClawPos.y = CONFIG.initialClawY;
        reached = false;
      }

      if (reached) {
        if (credits > 0) {
          credits -= 1;
          elCredits.textContent = credits;
          saveGameData();
          transitionTo(STATES.READY);
        } else {
          transitionTo(STATES.IDLE);
        }
      }
      break;
  }

  // clawHeadの位置を同期
  Body.setPosition(clawHead, currentClawPos);
}

// 掴みアクション
function performGrab() {
  transitionTo(STATES.GRABBING);
  setClawState(false); // 爪を閉じるアニメーション開始

  // 爪が閉じきったタイミングで景品をConstraintで固定
  setTimeout(() => {
    if (currentState === STATES.GRABBING) {
      attachNearbyPrizes();
    }
  }, 500);

  // 上昇に転じる
  setTimeout(() => {
    if (currentState === STATES.GRABBING) {
      transitionTo(STATES.ASCENDING);
    }
  }, CONFIG.grabDuration);
}

// 離しアクション
function performRelease() {
  transitionTo(STATES.RELEASING);
  setClawState(true);    // 爪を開くアニメーション開始
  detachAllPrizes();     // Constraintを解除 → 景品が落下

  setTimeout(() => {
    if (currentState === STATES.RELEASING) {
      transitionTo(STATES.RESETTING);
    }
  }, CONFIG.releaseDuration);
}

// ==========================================================================
// 6. カスタム描画（天井レール + ワイヤー + 爪）
// ==========================================================================

function drawClawSystem(event) {
  const ctx = render.context;
  const headPos = clawHead.position;

  ctx.save();

  // --- 天井レール ---
  ctx.strokeStyle = '#22224d';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(5, CONFIG.initialClawY - 40);
  ctx.lineTo(CONFIG.canvasWidth - 5, CONFIG.initialClawY - 40);
  ctx.stroke();

  // レール上のキャリッジ
  ctx.fillStyle = '#1e1e3f';
  ctx.strokeStyle = varColor('--neon-blue');
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(headPos.x - 30, CONFIG.initialClawY - 48, 60, 16);
  ctx.fill();
  ctx.stroke();

  // --- 縦ワイヤー ---
  ctx.strokeStyle = '#8c8cab';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(headPos.x, CONFIG.initialClawY - 32);
  ctx.lineTo(headPos.x, headPos.y - 8);
  ctx.stroke();

  // ネオンワイヤー効果
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
  ctx.lineWidth = 5;
  ctx.shadowBlur = 8;
  ctx.shadowColor = varColor('--neon-blue');
  ctx.beginPath();
  ctx.moveTo(headPos.x, CONFIG.initialClawY - 32);
  ctx.lineTo(headPos.x, headPos.y - 8);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // --- クローヘッド（本体ブロック）---
  const headW = 50;
  const headH = 14;
  ctx.fillStyle = '#3e3e66';
  ctx.strokeStyle = varColor('--neon-pink');
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(headPos.x - headW / 2, headPos.y - headH / 2, headW, headH);
  ctx.fill();
  ctx.stroke();

  // --- 爪の描画（2本の腕）---
  const armLen = CONFIG.clawArmLength;
  const tipLen = CONFIG.clawTipLength;
  const pivotY = headPos.y + headH / 2;

  // 左爪
  drawClawArm(ctx, headPos.x - 18, pivotY, -clawAngle, armLen, tipLen, true);
  // 右爪
  drawClawArm(ctx, headPos.x + 18, pivotY, clawAngle, armLen, tipLen, false);

  ctx.restore();
}

function drawClawArm(ctx, pivotX, pivotY, angle, armLen, tipLen, isLeft) {
  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(angle);

  // 上部アーム
  ctx.strokeStyle = '#c0c0dd';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, armLen);

  // 先端フック（内側に曲がる）
  const hookDir = isLeft ? 1 : -1;
  ctx.lineTo(hookDir * tipLen, armLen + tipLen * 0.4);
  ctx.stroke();

  // ネオン発光効果
  ctx.strokeStyle = 'rgba(255, 0, 200, 0.35)';
  ctx.lineWidth = 12;
  ctx.shadowBlur = 10;
  ctx.shadowColor = varColor('--neon-pink');
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, armLen);
  ctx.lineTo(hookDir * tipLen, armLen + tipLen * 0.4);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 関節のジョイント（ヒンジ部分の丸）
  ctx.fillStyle = '#6e6e9e';
  ctx.strokeStyle = varColor('--neon-pink');
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

// ==========================================================================
// 7. 景品 (Prizes) の生成と管理
// ==========================================================================

function spawnPrizes(count) {
  const startX = 170;
  const endX = CONFIG.canvasWidth - 50;

  for (let i = 0; i < count; i++) {
    const rx = startX + Math.random() * (endX - startX);
    const ry = CONFIG.canvasHeight - 150 - (i * 30);
    const imgFile = CONFIG.prizeImages[Math.floor(Math.random() * CONFIG.prizeImages.length)];

    const radius = 36;
    const prize = Bodies.circle(rx, ry, radius, {
      restitution: 0.1,
      friction: 0.95,
      density: 0.0003,
      frictionAir: 0.02,
      label: 'prize',
      plugin: { imageFile: imgFile },
      render: {
        sprite: {
          texture: imgFile,
          xScale: 0.25,
          yScale: 0.25
        }
      }
    });

    Composite.add(engine.world, prize);
  }
}

function refillPrizes() {
  const allBodies = Composite.allBodies(engine.world);
  const prizeBodies = allBodies.filter(body => body.label === 'prize');
  prizeBodies.forEach(body => { Composite.remove(engine.world, body); });

  spawnPrizes(15);
  playSynthSound('coin');
}

// ==========================================================================
// 8. コリジョン & 景品獲得処理
// ==========================================================================

function handleCollisions(event) {
  const pairs = event.pairs;

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];

    if ((pair.bodyA === sensor && pair.bodyB.label === 'prize') ||
        (pair.bodyB === sensor && pair.bodyA.label === 'prize')) {

      const prizeBody = pair.bodyA === sensor ? pair.bodyB : pair.bodyA;
      if (prizeBody.isPendingRemoval) continue;
      prizeBody.isPendingRemoval = true;

      const imageFile = prizeBody.plugin.imageFile;
      handlePrizeGet(imageFile, prizeBody);
    }
  }
}

function handlePrizeGet(imageFile, body) {
  setTimeout(() => { Composite.remove(engine.world, body); }, 100);

  score += 1;
  elScore.textContent = score;

  if (collection[imageFile] !== undefined) {
    collection[imageFile] += 1;
  } else {
    collection[imageFile] = 1;
  }

  saveGameData();
  playSynthSound('win');
  showPrizeModal(imageFile);
}

// 獲得ポップアップモーダル
function showPrizeModal(imageFile) {
  elModalPrizeImg.src = imageFile;
  elModalPrizeName.textContent = CONFIG.prizeNames[imageFile] || 'ぬいぐるみ';
  elModal.classList.add('active');
  document.body.classList.add('no-scroll');
}

function hidePrizeModal() {
  elModal.classList.remove('active');
  document.body.classList.remove('no-scroll');
  initAudio();
}

// ==========================================================================
// 9. ゲーム状態遷移 & UIボタン制御
// ==========================================================================

function transitionTo(newState) {
  currentState = newState;
  console.log(`State: ${newState}`);

  switch (newState) {
    case STATES.IDLE:
      elInstructions.textContent = 'コインを入れてスタート！';
      elBtnInsertCoin.disabled = false;
      elBtnRefill.disabled = false;
      elBtnMoveRight.disabled = true;
      elBtnMoveDown.disabled = true;
      break;

    case STATES.READY:
      elInstructions.textContent = '1ボタン「みぎ」を押してね！';
      elBtnInsertCoin.disabled = (credits >= 99);
      elBtnRefill.disabled = false;
      elBtnMoveRight.disabled = false;
      elBtnMoveDown.disabled = true;
      setClawState(true);
      break;

    case STATES.MOVE_RIGHT:
      elInstructions.textContent = 'みぎに移動中... ボタンを離すと止まります';
      elBtnInsertCoin.disabled = true;
      elBtnRefill.disabled = true;
      elBtnMoveRight.disabled = false;
      elBtnMoveDown.disabled = true;
      break;

    case STATES.STOP_RIGHT:
      elInstructions.textContent = '2ボタン「キャッチ」を押してね！';
      elBtnInsertCoin.disabled = true;
      elBtnRefill.disabled = true;
      elBtnMoveRight.disabled = true;
      elBtnMoveDown.disabled = false;
      break;

    case STATES.DESCENDING:
      elInstructions.textContent = 'アーム下降中...';
      elBtnInsertCoin.disabled = true;
      elBtnRefill.disabled = true;
      elBtnMoveRight.disabled = true;
      elBtnMoveDown.disabled = true;
      break;

    case STATES.GRABBING:
      elInstructions.textContent = 'キャッチ！';
      break;

    case STATES.ASCENDING:
      elInstructions.textContent = 'もちあげ中...';
      break;

    case STATES.RETURNING:
      elInstructions.textContent = 'もどり中...';
      break;

    case STATES.RELEASING:
      elInstructions.textContent = 'オープン！';
      break;

    case STATES.RESETTING:
      elInstructions.textContent = 'アームリセット中...';
      break;
  }
}

// コイン投入
function insertCoin() {
  initAudio();
  if (credits < 99) {
    credits += 1;
    elCredits.textContent = credits;
    playSynthSound('coin');
    saveGameData();

    if (currentState === STATES.IDLE) {
      credits -= 1;
      elCredits.textContent = credits;
      saveGameData();
      transitionTo(STATES.READY);
    }
  }
}

// ==========================================================================
// 10. イベントリスナーと初期化
// ==========================================================================

function setupEvents() {
  elBtnInsertCoin.addEventListener('click', insertCoin);

  elBtnRefill.addEventListener('click', () => {
    initAudio();
    refillPrizes();
  });

  elBtnCloseModal.addEventListener('click', hidePrizeModal);

  // 1ボタン (右移動)
  const startMoveRight = (e) => {
    e.preventDefault();
    initAudio();
    if (currentState === STATES.READY) {
      transitionTo(STATES.MOVE_RIGHT);
      elBtnMoveRight.classList.add('active');
    }
  };

  const endMoveRight = (e) => {
    e.preventDefault();
    if (currentState === STATES.MOVE_RIGHT) {
      transitionTo(STATES.STOP_RIGHT);
      elBtnMoveRight.classList.remove('active');
    }
  };

  elBtnMoveRight.addEventListener('mousedown', startMoveRight);
  elBtnMoveRight.addEventListener('mouseup', endMoveRight);
  elBtnMoveRight.addEventListener('mouseleave', endMoveRight);
  elBtnMoveRight.addEventListener('touchstart', startMoveRight, { passive: false });
  elBtnMoveRight.addEventListener('touchend', endMoveRight, { passive: false });

  // 2ボタン (下降)
  const startMoveDown = (e) => {
    e.preventDefault();
    initAudio();
    if (currentState === STATES.STOP_RIGHT) {
      transitionTo(STATES.DESCENDING);
      elBtnMoveDown.classList.add('active');
    }
  };

  const endMoveDown = (e) => {
    e.preventDefault();
    elBtnMoveDown.classList.remove('active');
  };

  elBtnMoveDown.addEventListener('mousedown', startMoveDown);
  elBtnMoveDown.addEventListener('mouseup', endMoveDown);
  elBtnMoveDown.addEventListener('touchstart', startMoveDown, { passive: false });
  elBtnMoveDown.addEventListener('touchend', endMoveDown, { passive: false });

  // キーボード操作（PC用）
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    initAudio();
    if (e.key === '1' || e.key === 'ArrowRight' || e.key === 'd') {
      if (currentState === STATES.READY) {
        transitionTo(STATES.MOVE_RIGHT);
        elBtnMoveRight.classList.add('active');
      }
    } else if (e.key === '2' || e.key === 'ArrowDown' || e.key === 's') {
      if (currentState === STATES.STOP_RIGHT) {
        transitionTo(STATES.DESCENDING);
        elBtnMoveDown.classList.add('active');
      }
    } else if (e.key === 'c') {
      insertCoin();
    } else if (e.key === 'r') {
      refillPrizes();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === '1' || e.key === 'ArrowRight' || e.key === 'd') {
      if (currentState === STATES.MOVE_RIGHT) {
        transitionTo(STATES.STOP_RIGHT);
        elBtnMoveRight.classList.remove('active');
      }
    } else if (e.key === '2' || e.key === 'ArrowDown' || e.key === 's') {
      elBtnMoveDown.classList.remove('active');
    }
  });

  // 物理エンジンの毎フレーム更新
  Events.on(engine, 'beforeUpdate', updateClawPhysics);
}

// ページ読み込み完了時にゲーム開始
window.addEventListener('DOMContentLoaded', () => {
  loadGameData();
  initPhysics();
  setupEvents();

  if (credits > 0) {
    transitionTo(STATES.IDLE);
    elInstructions.textContent = 'クレジットがあります。コインボタンをタップしてスタート！';
  } else {
    transitionTo(STATES.IDLE);
  }
});

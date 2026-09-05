import './style.css';
import QRCode from 'qrcode';
import { Simulation } from './game/simulation';
import { BattleRenderer } from './game/renderer';
import { CAMERA } from './game/camera';
import { Controls } from './controls';
import { Rooms } from './network';
import { BASE, COLORS, groundHeight, POWER_LABELS, WAVES, type Power, type State } from './game/types';

const icons: Record<string, string> = {
  tank: '<rect x="3" y="9" width="4" height="11" rx="1"/><rect x="17" y="9" width="4" height="11" rx="1"/><rect x="7" y="11" width="10" height="7" rx="2"/><circle cx="12" cy="10" r="4"/><path d="M12 2v8"/>',
  arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m3 9v-2a6 6 0 0 0-3-5"/>',
  join: '<path d="M14 4h6v16h-6M3 12h12m-4-4 4 4-4 4"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  sound: '<path d="M11 5 6 9H3v6h3l5 4V5m4 4a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/>',
  fullscreen: '<path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  target: '<circle cx="12" cy="12" r="6"/><path d="M12 2v6m0 8v6M2 12h6m8 0h6"/>',
  camera: '<path d="M3 8h4l2-3h6l2 3h4v12H3V8"/><circle cx="12" cy="13" r="3"/>',
};
const icon = (name: string) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const read = (key: string, fallback: string) => { try { return localStorage.getItem('tb-' + key) ?? fallback; } catch { return fallback; } };
const write = (key: string, value: string) => { try { localStorage.setItem('tb-' + key, value); } catch { /* 隐私模式下保留本次会话设置。 */ } };

get('app').innerHTML = '<main id="menu" class="menu-screen">' +
  '<header class="topbar"><div class="brand"><div class="brand-mark">' + icon('tank') + '</div><div><b>山谷守卫</b><small>TANK BATTLE</small></div></div><div class="utilities"><button class="icon-button" id="soundButton" aria-label="切换音效">' + icon('sound') + '</button><button class="icon-button" id="settingsButton" aria-label="设置">' + icon('settings') + '</button><button class="icon-button fullscreen-button" aria-label="全屏">' + icon('fullscreen') + '</button></div></header>' +
  '<section class="hero"><div class="eyebrow">A LITTLE VALLEY. A BIG ADVENTURE.</div><h1><span>山谷</span><span>守卫</span></h1><p class="hero-description">穿过山林，击破险阻。<br>驾驶你的坦克，守住这一方小小天地。</p><label class="player-name">呼号<input id="playerName" maxlength="16" autocomplete="nickname" aria-label="玩家昵称"></label><button id="soloButton" class="primary solo-button"><span>开始单人战役</span>' + icon('arrow') + '</button><div class="button-row"><button id="hostButton" class="secondary">' + icon('team') + '创建房间</button><button id="joinButton" class="secondary">' + icon('join') + '加入房间</button></div><div class="menu-meta"><span>第三人称 · 自由视角</span><i></i><span>1—4 人合作</span></div></section>' +
  '<div class="scene-label"><span>CAMPAIGN / 01</span><b>薄雾山谷</b><p>山林之间，营地长明。</p></div><footer class="menu-footer"><button id="helpButton" class="help-link">操作手册 ↗</button><span>为每一位童年的坦克手</span><a href="https://github.com/ZhaoYunxiong/TankBattle" target="_blank" rel="noreferrer">GITHUB ↗</a></footer></main>' +
  '<section id="hud" class="hud" hidden><div class="hud-top"><div class="camp-card glass"><div class="hud-caption"><span>⌂ 营地核心</span><b id="baseHp">600 / 600</b></div><div class="bar"><i id="baseBar"></i></div></div><div class="wave"><span>守卫薄雾山谷</span><b id="wave">01 / 05</b><small id="enemyCount">准备出击</small></div><div class="hud-tools"><button id="pauseButton" class="icon-button" aria-label="暂停">' + icon('pause') + '</button><button class="icon-button fullscreen-button" aria-label="全屏">' + icon('fullscreen') + '</button></div></div>' +
  '<div class="radar glass"><canvas id="radar" width="160" height="160" aria-label="战场小地图"></canvas><span id="roomBadge">单人战役 · N ↑</span></div><div class="player-card glass"><div class="hud-caption"><span id="tankName">守卫者</span><b id="tankHp">120 / 120</b></div><div class="bar"><i id="tankBar"></i></div><div class="player-detail"><span id="damageStatus">装甲完好</span><strong id="lives">备用 × 2</strong></div><div class="player-detail"><span>战役得分</span><strong id="score">0000</strong></div></div>' +
  '<div id="buffs" class="buffs"></div><div class="keyboard-help">W A S D / 方向键移动 · 鼠标瞄准 · 按住左键开火<br>单击战场锁定鼠标 · Alt 自由观察 · C 镜头归位 · Esc 暂停</div><div class="weapon-card glass"><b id="weaponStatus">炮弹就绪</b><small>标准炮 · 按住连续射击</small><div class="bar"><i id="reloadBar"></i></div></div><div id="crosshair" class="crosshair"></div><div id="enemyLabels"></div><div id="objective" class="objective" hidden></div><div id="connectionStatus" class="connection-status" hidden></div>' +
  '<div class="touch-controls"><div id="joystick" role="group" aria-label="驾驶摇杆"><span></span></div><button id="fireButton" aria-label="按住开火并拖动瞄准">' + icon('target') + '<small id="touchReload">开火</small></button><div class="camera-buttons"><button id="zoomIn" class="icon-button" aria-label="拉近镜头">＋</button><button id="zoomOut" class="icon-button" aria-label="拉远镜头">−</button><button id="freeLook" class="icon-button" aria-label="切换自由观察">' + icon('camera') + '</button></div></div></section>' +
  '<div id="toast" role="status" aria-live="polite" hidden></div>' +
  '<dialog id="joinDialog"><div class="dialog-content"><div class="dialog-header"><h2>加入小队</h2><button class="icon-button" data-close="joinDialog" aria-label="关闭">' + icon('close') + '</button></div><p>输入朋友分享的房间号。所有人都可以用手机开房或加入，房主需保持游戏在前台。</p><label for="roomInput">六位房间号</label><input id="roomInput" class="room-input" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC234"><button id="connectButton" class="primary">加入房间</button><p id="joinStatus" role="status">同一 Wi-Fi 更容易直连。跨网络连接取决于网络环境。</p></div></dialog>' +
  '<dialog id="lobbyDialog"><div class="dialog-content"><div class="dialog-header"><h2>山谷小队</h2><button id="leaveLobby" class="icon-button" aria-label="离开房间">' + icon('close') + '</button></div><div class="room-code"><div><small>邀请朋友，一起守卫</small><strong id="roomCode"></strong></div><img id="roomQr" alt="扫码加入房间"></div><button id="copyRoom" class="text-button">复制邀请链接 ↗</button><div id="players" class="players"></div><button id="startRoom" class="primary">开始守卫</button><button id="readyButton" class="primary" hidden>我准备好了</button><p id="lobbyStatus">正在等待队友。最多 4 人，房主也可以独自出发。</p><p>房主切到后台会暂停战场；离开房间会结束本次联机。开房使用公共配对服务，战场通过设备直连同步。</p></div></dialog>' +
  '<dialog id="settingsDialog"><div class="dialog-content"><div class="dialog-header"><h2>游戏设置</h2><button id="closeSettings" class="icon-button" aria-label="关闭设置">' + icon('close') + '</button></div><label class="setting"><span>画面质量</span><select id="quality"><option value="auto">自动平衡</option><option value="low">省电流畅</option><option value="high">细腻画面</option></select></label><label class="setting"><span>炮击与爆炸震动</span><input id="shake" type="checkbox"></label><label class="setting"><span>战场音效</span><input id="sound" type="checkbox"></label><p>手机发热或画面卡顿时，可选择省电流畅。横屏拥有更宽的战场视野，竖屏同样可以游玩。</p><button id="settingsDone" class="primary">完成</button></div></dialog>' +
  '<dialog id="pauseDialog"><div class="dialog-content"><div class="dialog-header"><h2>稍作休整</h2></div><p id="pauseText">战场已暂停，准备好后继续出发。</p><button id="resumeButton" class="primary">继续战斗</button><button id="pauseSettings" class="secondary">游戏设置</button><button id="backMenu" class="text-button">返回大厅</button></div></dialog>' +
  '<dialog id="resultDialog"><div class="dialog-content result"><div class="result-emblem" id="resultEmblem">◇</div><h2 id="resultTitle">山谷依旧长明</h2><p id="resultDescription"></p><div class="result-stats"><div><b id="resultScore">0</b><small>小队得分</small></div><div><b id="resultWave">0</b><small>抵达波次</small></div><div><b id="resultTime">0:00</b><small>守卫时间</small></div></div><button id="retryButton" class="primary">再次出征</button><button id="resultMenu" class="text-button">返回大厅</button></div></dialog>' +
  '<dialog id="helpDialog"><div class="dialog-content"><div class="dialog-header"><h2>坦克手册</h2><button class="icon-button" data-close="helpDialog" aria-label="关闭手册">' + icon('close') + '</button></div><p>守住营地，击退五波来袭敌军。坦克被击毁后可使用两辆备用坦克，营地核心被毁则战役结束。</p><table class="help-table"><tr><td>电脑驾驶</td><td>WASD / 方向键按镜头方向移动，车身自动转向</td></tr><tr><td>电脑瞄准</td><td>单击战场锁定鼠标；拖动/鼠标移动瞄准，左键或空格开火</td></tr><tr><td>自由镜头</td><td>滚轮缩放，Alt 只观察，C 归位</td></tr><tr><td>手机操作</td><td>左摇杆推向哪里就往哪里走，右侧拖动瞄准；按住开火按钮也能拖动</td></tr><tr><td>受损坦克</td><td>低于 60% 开始冒烟、减速、散布增加；维修后恢复</td></tr><tr><td>战术破坏</td><td>炸开树木和岩壁开辟捷径，敌军也能利用缺口</td></tr><tr><td>战场补给</td><td>绿：回血；黄：快装；橙：连发；蓝：减伤</td></tr></table><p>合作模式没有队友伤害，也不会误伤营地围墙。跨网络直连可能受运营商限制；同一可互访 Wi-Fi 下更适合一起游玩。</p></div></dialog>';

let renderer: BattleRenderer;
try {
  renderer = new BattleRenderer(get<HTMLCanvasElement>('battlefield'));
} catch (error) {
  get('boot')?.remove();
  get('app').innerHTML = '<div class="fatal"><h2>暂时无法启动三维画面</h2><p>请使用支持 WebGL 的新版 Safari、Chrome 或 Edge，开启浏览器硬件加速后重试。</p><button onclick="location.reload()">重新加载</button></div>';
  throw error;
}
const controls = new Controls(renderer, get('battlefield'), get('joystick'), get('fireButton'));
const rooms = new Rooms();
let simulation = new Simulation(73419);
let state: State = simulation.state;
let localId = 'preview';
simulation.addPlayer(localId, '守卫者');
simulation.addPlayer('preview-two', '队友');
state.tanks[0].x = 2;
state.tanks[0].z = 8;
state.tanks[1].x = -3;
state.tanks[1].z = 11;
let screen: 'menu' | 'lobby' | 'game' = 'menu';
let networkBusy = false;
let resultShown = false;
let previousLobby = '';
let inviteLink = '';
let toastTimer = 0;
let previousBaseHp = 600;
let damageToastAt = 0;
let previousDropEvent = 0;
let previousFrame = performance.now();
let accumulator = 0;
let netClock = 0;
let hudClock = 0;
let fps = 0;

const nameInput = get<HTMLInputElement>('playerName');
nameInput.value = read('name', '守卫者');
const nickname = () => { const value = nameInput.value.trim().slice(0, 16) || '守卫者'; write('name', value); return value; };
get<HTMLSelectElement>('quality').value = read('quality', 'auto');
get<HTMLInputElement>('shake').checked = read('shake', matchMedia('(prefers-reduced-motion: reduce)').matches ? 'false' : 'true') === 'true';
get<HTMLInputElement>('sound').checked = read('sound', 'true') === 'true';
function settings() {
  renderer.setQuality(get<HTMLSelectElement>('quality').value);
  renderer.shakeEnabled = get<HTMLInputElement>('shake').checked;
  renderer.audio.enabled = get<HTMLInputElement>('sound').checked;
  write('quality', get<HTMLSelectElement>('quality').value);
  write('shake', String(renderer.shakeEnabled));
  write('sound', String(renderer.audio.enabled));
  get('soundButton').style.opacity = renderer.audio.enabled ? '1' : '0.45';
  get('soundButton').setAttribute('aria-pressed', String(renderer.audio.enabled));
}
settings();

function toast(message: string, duration = 4000) {
  get('toast').textContent = message;
  get('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { get('toast').hidden = true; }, duration);
}

function closeDialogs() {
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(d => d.close());
}

function showDialog(id: string) {
  document.exitPointerLock?.();
  closeDialogs();
  get<HTMLDialogElement>(id).showModal();
}

function enterGame() {
  screen = 'game';
  controls.reset();
  controls.enabled = true;
  controls.freeLook = false;
  get('freeLook').classList.remove('active');
  renderer.yaw = state.tanks.find(t => t.id === localId)?.turret ?? Math.PI;
  renderer.zoom = CAMERA.zoom;
  renderer.pitch = CAMERA.pitch;
  closeDialogs();
  get('menu').hidden = true;
  get('hud').hidden = false;
  resultShown = false;
  previousBaseHp = state.baseHp;
  previousDropEvent = state.events.at(-1)?.id ?? 0;
  renderer.audio.unlock();
  toast(matchMedia('(pointer: coarse)').matches ? '左摇杆推向哪里就往哪里走，右侧拖动瞄准。按住开火可同时拖动。' : '单击战场控制镜头，WASD 按镜头方向移动，车身自动转向。守住营地！', 5500);
}

function newSolo() {
  rooms.close();
  simulation = new Simulation();
  localId = rooms.playerId;
  simulation.addPlayer(localId, nickname());
  state = simulation.state;
  simulation.start();
  accumulator = 0;
  enterGame();
}

function menu() {
  rooms.close();
  controls.enabled = false;
  controls.reset();
  screen = 'menu';
  closeDialogs();
  document.exitPointerLock?.();
  get('menu').hidden = false;
  get('hud').hidden = true;
  simulation = new Simulation(73419);
  simulation.addPlayer('preview', nickname());
  localId = 'preview';
  state = simulation.state;
  state.tanks[0].z = 8;
  previousLobby = '';
}

function pause(show = true) {
  if (screen !== 'game' || resultShown) return;
  controls.enabled = false;
  controls.reset();
  if (rooms.role !== 'guest') { state.paused = true; rooms.broadcast(state); }
  if (show) {
    get('pauseText').textContent = rooms.role === 'guest' ? '你已停止操作，队友的战斗仍在继续。' : rooms.role === 'host' ? '小队战场已暂停，队友会等待你继续。' : '战场已暂停，准备好后继续出发。';
    showDialog('pauseDialog');
  }
}

function resume() {
  closeDialogs();
  if (screen !== 'game' || resultShown) return;
  if (rooms.role !== 'guest') state.paused = false;
  controls.enabled = true;
  previousFrame = performance.now();
  accumulator = 0;
  renderer.audio.unlock();
}

function renderLobby() {
  const players = state.tanks.filter(t => t.team === 'player');
  const signature = players.map(t => t.id + t.name + t.ready + t.connected).join('|') + rooms.role;
  if (signature === previousLobby) return;
  previousLobby = signature;
  get('players').innerHTML = players.map((t, i) => '<div class="player-slot"><i style="background:' + COLORS[t.color % 4] + '"></i><span>' + escape(t.name) + (t.id === localId ? ' · 你' : '') + '</span><small>' + (i === 0 ? '房主' : t.ready ? '已准备' : '准备中') + '</small></div>').join('') +
    Array.from({ length: Math.max(0, 4 - players.length) }, () => '<div class="player-slot empty"><i style="background:#cbd0bb"></i><span>等待一位坦克手…</span><small>空位</small></div>').join('');
  get('startRoom').hidden = rooms.role !== 'host';
  get('readyButton').hidden = rooms.role !== 'guest';
  get<HTMLButtonElement>('startRoom').disabled = players.some(t => !t.ready);
  get('readyButton').textContent = players.find(t => t.id === localId)?.ready ? '取消准备' : '我准备好了';
  get('lobbyStatus').textContent = rooms.role === 'host' ? players.some(t => !t.ready) ? '等待队友准备完成。' : '小队已就绪，可以开始守卫。' : '准备好后，等待房主开始战役。';
}

async function lobby() {
  screen = 'lobby';
  controls.enabled = false;
  get('menu').hidden = false;
  get('hud').hidden = true;
  get('roomCode').textContent = rooms.code;
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', rooms.code);
  inviteLink = url.href;
  get<HTMLImageElement>('roomQr').src = await QRCode.toDataURL(inviteLink, { width: 200, margin: 1, color: { dark: '#344d40', light: '#ffffff' } });
  previousLobby = '';
  renderLobby();
  showDialog('lobbyDialog');
}

async function connect(host: boolean) {
  if (networkBusy) return;
  networkBusy = true;
  for (const id of ['hostButton', 'connectButton']) get<HTMLButtonElement>(id).disabled = true;
  get('joinStatus').textContent = '正在连接房间，请稍候…';
  if (host) toast('正在创建房间…', 18000);
  try {
    localId = rooms.playerId;
    if (host) {
      simulation = new Simulation();
      simulation.addPlayer(localId, nickname());
      state = simulation.state;
      await rooms.create();
      await lobby();
    } else {
      await rooms.join(get<HTMLInputElement>('roomInput').value, nickname());
      if (state.phase === 'lobby') await lobby();
      else enterGame();
    }
    get('toast').hidden = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : '连接失败，请重试。';
    get('joinStatus').textContent = message;
    toast(message, 8000);
  } finally {
    networkBusy = false;
    for (const id of ['hostButton', 'connectButton']) get<HTMLButtonElement>(id).disabled = false;
  }
}

rooms.onState = incoming => {
  state = incoming;
  if (state.phase !== 'lobby' && screen !== 'game') enterGame();
  if (screen === 'lobby') renderLobby();
};
rooms.onJoin = (id, name) => {
  const existing = state.tanks.find(t => t.id === id);
  if (!existing && state.phase !== 'lobby') return false;
  const result = simulation.addPlayer(id, name);
  if (result) { previousLobby = ''; return true; }
  return false;
};
rooms.onLeave = id => { simulation.disconnect(id); previousLobby = ''; toast('一位队友离开了房间。'); };
rooms.onInput = (id, input) => simulation.input(id, input);
rooms.onReady = (id, ready) => {
  const tank = state.tanks.find(t => t.id === id);
  if (tank && state.phase === 'lobby') tank.ready = ready;
};
rooms.onError = message => {
  toast(message, 10000);
  get('joinStatus').textContent = message;
  get('lobbyStatus').textContent = message;
};
rooms.onStatus = message => toast(message, 6500);

get('soloButton').onclick = newSolo;
get('hostButton').onclick = () => void connect(true);
get('joinButton').onclick = () => showDialog('joinDialog');
get('connectButton').onclick = () => void connect(false);
get('roomInput').addEventListener('keydown', e => { if (e.key === 'Enter') void connect(false); });
get('leaveLobby').onclick = menu;
get('startRoom').onclick = () => { simulation.start(); enterGame(); rooms.broadcast(state); };
get('readyButton').onclick = () => rooms.ready(!state.tanks.find(t => t.id === localId)?.ready);
get('copyRoom').onclick = async () => {
  try { await navigator.clipboard.writeText(inviteLink); toast('邀请链接已复制，发给朋友即可加入。'); }
  catch { toast('房间号：' + rooms.code + '。也可以让朋友扫描二维码。'); }
};
get('pauseButton').onclick = () => pause();
controls.onPause = () => pause();
controls.onRecenter = () => {
  renderer.yaw = state.tanks.find(t => t.id === localId)?.angle ?? Math.PI;
  renderer.pitch = CAMERA.pitch;
  renderer.zoom = CAMERA.zoom;
};
get('resumeButton').onclick = resume;
get('backMenu').onclick = menu;
get('resultMenu').onclick = menu;
get('retryButton').onclick = () => {
  if (rooms.role === 'solo') newSolo();
  else { menu(); toast('请重新创建或加入房间，开始下一次合作战役。'); }
};
get('settingsButton').onclick = () => showDialog('settingsDialog');
get('pauseSettings').onclick = () => showDialog('settingsDialog');
get('closeSettings').onclick = resume;
get('settingsDone').onclick = resume;
for (const id of ['quality', 'shake', 'sound']) get(id).addEventListener('change', settings);
get('soundButton').onclick = () => {
  get<HTMLInputElement>('sound').checked = !get<HTMLInputElement>('sound').checked;
  renderer.audio.unlock();
  settings();
};
get('helpButton').onclick = () => showDialog('helpDialog');
get('freeLook').onclick = () => {
  controls.freeLook = !controls.freeLook;
  get('freeLook').classList.toggle('active', controls.freeLook);
  toast(controls.freeLook ? '自由观察：炮塔保持方向。再次点击相机恢复瞄准。' : '已恢复炮塔跟随镜头。', 2500);
};
get('zoomIn').onclick = () => { renderer.zoom = Math.max(CAMERA.minZoom, renderer.zoom - 2); };
get('zoomOut').onclick = () => { renderer.zoom = Math.min(CAMERA.maxZoom, renderer.zoom + 2); };
document.querySelectorAll<HTMLElement>('[data-close]').forEach(b => b.onclick = () => get<HTMLDialogElement>(b.dataset.close!).close());
document.querySelectorAll<HTMLDialogElement>('dialog').forEach(d => d.addEventListener('cancel', e => {
  if (['lobbyDialog', 'resultDialog'].includes(d.id)) { e.preventDefault(); return; }
  if (['pauseDialog', 'settingsDialog'].includes(d.id)) { e.preventDefault(); resume(); }
}));
document.querySelectorAll<HTMLElement>('.fullscreen-button').forEach(b => b.onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else toast('当前浏览器不支持全屏，可直接横屏游玩。');
  } catch { toast('浏览器未允许全屏，可以继续正常游玩。'); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'game' && !resultShown) pause();
});

function drawRadar() {
  const ctx = get<HTMLCanvasElement>('radar').getContext('2d')!;
  ctx.clearRect(0, 0, 160, 160);
  const position = (x: number, z: number) => [80 + x * 2.5, 80 + z * 2.2];
  ctx.strokeStyle = '#e8e2bc33';
  ctx.lineWidth = 1;
  ctx.strokeRect(10, 8, 140, 144);
  for (const o of state.obstacles) {
    if (o.hp <= 0) continue;
    const [x, y] = position(o.x, o.z);
    ctx.fillStyle = o.kind === 'wall' ? '#dacead' : o.kind === 'rock' ? '#adb49690' : '#8ea98f75';
    ctx.fillRect(x - o.radius, y - o.radius, o.radius * 2, o.radius * 2);
  }
  const [bx, by] = position(BASE.x, BASE.z);
  ctx.fillStyle = state.baseHp / state.baseMaxHp < 0.3 ? '#e9a380' : '#e3d0a0';
  ctx.fillRect(bx - 5, by - 5, 10, 10);
  for (const drop of state.drops) {
    const [x, y] = position(drop.x, drop.z);
    ctx.fillStyle = '#cce7b8';
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  for (const t of state.tanks) {
    if (t.hp <= 0 || !t.connected) continue;
    const [x, y] = position(t.x, t.z);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-t.angle);
    ctx.beginPath();
    ctx.moveTo(0, 5);
    ctx.lineTo(-3, -3);
    ctx.lineTo(3, -3);
    ctx.closePath();
    ctx.fillStyle = t.id === localId ? '#fff9db' : t.team === 'enemy' ? '#e7a087' : '#99cbb5';
    ctx.fill();
    ctx.restore();
  }
}

function updateHud() {
  const player = state.tanks.find(t => t.id === localId);
  if (!player) return;
  const enemies = state.tanks.filter(t => t.team === 'enemy' && t.hp > 0);
  get('baseHp').textContent = Math.ceil(state.baseHp) + ' / ' + state.baseMaxHp;
  get('baseBar').style.width = Math.max(0, state.baseHp / state.baseMaxHp * 100) + '%';
  get('baseBar').style.background = state.baseHp < 200 ? '#e7a184' : '#c1d4a5';
  get('wave').textContent = String(Math.max(1, state.wave)).padStart(2, '0') + ' / 0' + WAVES;
  get('enemyCount').textContent = state.phase === 'battle' ? '敌军 ' + enemies.length + ' · 后续 ' + state.remaining : '下一波前的休整';
  get('tankName').textContent = player.name;
  get('tankHp').textContent = Math.ceil(player.hp) + ' / ' + player.maxHp;
  get('tankBar').style.width = player.hp / player.maxHp * 100 + '%';
  get('tankBar').style.background = player.hp < 36 ? '#e9a185' : '#c1d4a5';
  get('damageStatus').textContent = player.hp <= 0 ? '坦克已被击毁' : player.hp < 36 ? '严重受损 · 减速 / 散布' : player.hp < 72 ? '装甲受损 · 轻度减速' : player.shield > 0 ? '出战保护' : '装甲完好';
  get('lives').textContent = '备用 × ' + player.lives;
  get('score').textContent = String(player.score).padStart(4, '0');
  get('weaponStatus').textContent = player.cooldown > 0 ? '装填 ' + player.cooldown.toFixed(1) + 's' : '炮弹就绪';
  get('touchReload').textContent = player.cooldown > 0 ? player.cooldown.toFixed(1) + 's' : '开火';
  get('reloadBar').style.width = (1 - player.cooldown / (player.buffs.rapid > 0 ? 0.7 : 1)) * 100 + '%';
  get('roomBadge').textContent = rooms.role === 'solo' ? '单人战役 · N ↑' : rooms.code + ' · N ↑';
  get('buffs').innerHTML = (Object.entries(player.buffs) as [Power, number][]).filter(([, time]) => time > 0).map(([key, time]) => '<div class="buff">' + POWER_LABELS[key] + '<b>' + Math.ceil(time) + 's</b></div>').join('');
  let objective = '';
  if (state.paused) objective = '<b>战场已暂停</b><small>' + (rooms.role === 'guest' ? '等待房主继续战斗' : '休整片刻，再次出发') + '</small>';
  else if (player.hp <= 0) objective = player.respawn > 0 ? '<b>备用坦克出动</b><small>' + Math.ceil(player.respawn) + ' 秒后重返战场</small>' : '<b>备用坦克耗尽</b><small>队友仍在战斗，为他们守候。</small>';
  else if (state.phase === 'intermission') objective = '<b>' + (state.wave === 0 ? '守住这片山谷' : '营地修复中') + '</b><small>' + Math.ceil(state.countdown) + ' 秒后，' + (state.wave === 0 ? '第一波敌军来袭' : '下一波敌军来袭 · 寻找绿色维修补给') + '</small>';
  get('objective').hidden = !objective;
  get('objective').innerHTML = objective;
  const stale = rooms.role === 'guest' && performance.now() - rooms.lastStateAt > 3000;
  get('connectionStatus').hidden = !stale;
  get('connectionStatus').textContent = stale ? '正在等待房主连接恢复…' : '';
  if (state.baseHp < previousBaseHp && state.time - damageToastAt > 4) {
    damageToastAt = state.time;
    toast('营地正在遭受攻击！查看小地图，及时回防。', 2800);
  }
  previousBaseHp = state.baseHp;
  for (const event of state.events) if (event.id > previousDropEvent && event.kind === 'pickup' && event.owner === localId) toast('已拾取战场补给', 1600);
  previousDropEvent = state.events.at(-1)?.id ?? 0;
  drawRadar();
  if ((state.phase === 'won' || state.phase === 'lost') && !resultShown) {
    resultShown = true;
    controls.enabled = false;
    controls.reset();
    get('resultTitle').textContent = state.phase === 'won' ? '山谷依旧长明' : '下次，一定守住';
    get('resultDescription').textContent = state.phase === 'won' ? '五波敌军已被击退。谢谢你，坦克手。' : state.baseHp <= 0 ? '营地核心被摧毁了。利用掩体和维修补给，再来一次。' : '小队的备用坦克已耗尽。调整路线，再次出发。';
    get('resultScore').textContent = String(state.tanks.filter(t => t.team === 'player').reduce((n, t) => n + t.score, 0));
    get('resultWave').textContent = state.wave + ' / ' + WAVES;
    get('resultTime').textContent = Math.floor(state.time / 60) + ':' + String(Math.floor(state.time % 60)).padStart(2, '0');
    showDialog('resultDialog');
  }
}

renderer.engine.runRenderLoop(() => {
  const now = performance.now();
  // 固定步长保持碰撞稳定；低帧率允许有限补帧，后台长时间停顿仍不会一次推进整局。
  const dt = Math.min(0.25, (now - previousFrame) / 1000);
  previousFrame = now;
  fps = dt > 0 ? fps * 0.95 + (1 / dt) * 0.05 : fps;
  if (screen === 'game') {
    const input = controls.read();
    if (rooms.role !== 'guest') {
      simulation.input(localId, input);
      accumulator += dt;
      while (accumulator >= 1 / 30) { simulation.step(1 / 30); accumulator -= 1 / 30; }
      state = simulation.state;
    }
    netClock += dt;
    if (netClock >= 1 / 15) {
      netClock = 0;
      if (rooms.role === 'guest') rooms.sendInput(input);
      else rooms.broadcast(state);
    }
  } else if (screen === 'lobby') {
    netClock += dt;
    if (netClock >= 0.2) { netClock = 0; rooms.broadcast(state); renderLobby(); }
  }
  renderer.render(state, localId, dt, screen !== 'game');
  get('boot')?.remove();
  if (screen === 'game') {
    const player = state.tanks.find(t => t.id === localId);
    if (player && player.hp > 0) {
      const p = renderer.reticle(state, player);
      get('crosshair').hidden = !p.visible;
      get('crosshair').style.left = p.x + 'px';
      get('crosshair').style.top = p.y + 'px';
      const size = 24 + Math.max(0, 0.6 - player.hp / player.maxHp) * 38;
      get('crosshair').style.width = size + 'px';
      get('crosshair').style.height = size + 'px';
    } else get('crosshair').hidden = true;
    const labels: string[] = [];
    for (const t of state.tanks) {
      if (t.id === localId || t.hp <= 0 || !t.connected) continue;
      const p = renderer.project(t.x, groundHeight(t.x, t.z) + 2.4, t.z);
      if (!p.visible) continue;
      labels.push('<div class="enemy-label" style="left:' + p.x + 'px;top:' + p.y + 'px">' + (t.team === 'player' ? escape(t.name) : '') + '<div class="bar"><i style="width:' + t.hp / t.maxHp * 100 + '%;' + (t.team === 'player' ? 'background:#bbdcc4' : '') + '"></i></div></div>');
    }
    get('enemyLabels').innerHTML = labels.join('');
    hudClock += dt;
    if (hudClock > 0.1) { hudClock = 0; updateHud(); }
  }
});

const invited = new URLSearchParams(location.search).get('room');
if (invited && /^[A-Z2-9]{6}$/i.test(invited)) {
  get<HTMLInputElement>('roomInput').value = invited.toUpperCase();
  showDialog('joinDialog');
}
// 开发环境仅提供只读诊断入口，用于验证真实渲染与网络状态；生产构建会移除。
if (import.meta.env.DEV) Object.defineProperty(window, '__tankBattle', { get: () => ({
  state: JSON.parse(JSON.stringify(state)), localId, role: rooms.role, fps,
  camera: { yaw: renderer.yaw, pitch: renderer.pitch, zoom: renderer.zoom, position: { x: renderer.camera.position.x, y: renderer.camera.position.y, z: renderer.camera.position.z } }, screen,
}) });

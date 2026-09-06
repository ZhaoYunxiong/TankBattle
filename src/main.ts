import { SITE, SITE_COLORS, siteName } from './game/sites';
import { Career } from './profile-ui';
import { BOOST, CHARGE, chargePower } from './game/abilities';
import { coverLabel, terrainCover } from './game/cover';
import { standings } from './profile';
import { MAPS, mapFor, inRegion, waterAt, type MapSize } from './game/maps';
import { concealed, exploredCell, EXPLORE_STEP } from './game/visibility';
import './style.css';
import QRCode from 'qrcode';
import { Simulation } from './game/simulation';
import { DIFFICULTIES } from './game/balance';
import { BattleRenderer } from './game/renderer';
import { CAMERA } from './game/camera';
import { groundHeight, groundSlope } from './game/terrain';
import { Controls } from './controls';
import { enableHudTouchButtons } from './touch-buttons';
import { preventBrowserZoom } from './viewport';
import { Rooms } from './network';
import { COLORS, distance, MODES, pickupHint, POWER_LABELS, WAVES, type Difficulty, type GameMode, type Power, type State } from './game/types';

preventBrowserZoom();

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
  boost: '<path d="m4 7 5 5-5 5m8-10 5 5-5 5"/>',
  charge: '<path d="m14 2-9 12h6l-1 8 9-12h-6l1-8Z"/>',
  camera: '<path d="M3 8h4l2-3h6l2 3h4v12H3V8"/><circle cx="12" cy="13" r="3"/>',
};
const icon = (name: string) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const read = (key: string, fallback: string) => { try { return localStorage.getItem('tb-' + key) ?? fallback; } catch { return fallback; } };
const write = (key: string, value: string) => { try { localStorage.setItem('tb-' + key, value); } catch { /* 隐私模式下保留本次会话设置。 */ } };

get('app').innerHTML = '<main id="menu" class="menu-screen">' +
  '<header class="topbar"><div class="brand"><div class="brand-mark">' + icon('tank') + '</div><div><b>山谷守卫</b><small>TANK BATTLE</small></div></div><div class="utilities"><button class="icon-button" id="soundButton" aria-label="切换音效">' + icon('sound') + '</button><button class="icon-button" id="settingsButton" aria-label="设置">' + icon('settings') + '</button><button class="icon-button fullscreen-button" aria-label="全屏">' + icon('fullscreen') + '</button></div></header>' +
  '<section class="hero"><div class="eyebrow">A LITTLE VALLEY. A BIG ADVENTURE.</div><h1><span>山谷</span><span>守卫</span></h1><p class="hero-description">穿过山林，击破险阻。<br>驾驶你的坦克，守住这一方小小天地。</p><fieldset class="mode-picker"><legend>选择游戏模式</legend><div class="mode-options"><button id="modeClassic" type="button" data-mode="classic" aria-pressed="true"><span><b>经典模式</b><i>默认</i></span><small>双方阵地 · 进攻与回防</small></button><button id="modeDefense" type="button" data-mode="defense" aria-pressed="false"><span><b>防守模式</b></span><small>守护营地 · 抵御五波敌军</small></button></div></fieldset><div class="difficulty-picker"><label for="difficulty">战役难度</label><select id="difficulty" aria-describedby="difficultyDescription"><option value="casual">休闲</option><option value="normal" selected>普通</option><option value="challenge">挑战</option></select><small id="difficultyDescription"></small></div><div class="map-picker"><label for="mapSize">战场规模</label><select id="mapSize"><option value="small">小型 · 薄雾山谷</option><option value="medium">中型 · 白桦河湾</option><option value="large">大型 · 双桥远山</option></select><small id="mapDescription">96 × 120 · 双桥贯通山谷</small></div><label class="player-name">呼号<input id="playerName" maxlength="16" autocomplete="nickname" aria-label="玩家昵称"></label><button id="soloButton" class="primary solo-button"><span>开始单人战役</span>' + icon('arrow') + '</button><div class="button-row"><button id="hostButton" class="secondary">' + icon('team') + '创建房间</button><button id="joinButton" class="secondary">' + icon('join') + '加入房间</button></div><div class="menu-meta"><span>第三人称 · 自由视角</span><i></i><span>1—4 人合作</span></div></section>' +
  '<div class="scene-label"><span>EXPLORE / DEFEND</span><b id="mapTitle">薄雾山谷</b><p>循路探营，穿林伏击。</p></div><footer class="menu-footer"><button id="helpButton" class="help-link">操作手册 ↗</button><button id="careerButton" class="help-link">工厂与档案 ↗</button><a href="https://github.com/ZhaoYunxiong/TankBattle" target="_blank" rel="noreferrer">GITHUB ↗</a></footer></main>' +
  '<section id="hud" class="hud" hidden><div class="hud-top"><button id="pauseButton" class="icon-button" aria-label="暂停">' + icon('pause') + '</button><div class="camp-card"><div class="hud-caption"><span>⌂ 己方营地</span><b id="baseHp">600 / 600</b></div><div class="bar"><i id="baseBar"></i></div></div></div>' +
  '<div id="radarPanel" class="radar"><button id="mapToggle" aria-label="展开战术地图" aria-expanded="false">地图 ↗</button><canvas id="radar" width="480" height="480" aria-label="战场小地图"></canvas><span id="roomBadge">单人战役 · N ↑</span><small class="map-instructions">点击地图标记 · M 收起 · N ↑</small></div><div id="localTankStatus" class="local-tank-status" hidden><span id="tankHp">120 / 120</span><div id="tankHealth" class="bar" role="meter" aria-label="我方坦克血量" aria-valuemin="0" aria-valuemax="120" aria-valuenow="120"><i id="tankBar"></i></div><small id="damageStatus" hidden></small><small id="concealmentStatus" hidden></small><small id="coverStatus" hidden></small></div>' +
  '<div id="buffs" class="buffs"></div><div id="threatArrow" class="threat-arrow" hidden><i>▲</i><span></span></div><div class="keyboard-help">W A S D / 方向键移动 · 鼠标瞄准 · 按住左键开火<br>单击战场锁定鼠标 · Alt 自由观察 · C 镜头归位 · B 加速 · Q 蓄力 · M 地图 · Esc 暂停</div><div class="weapon-card"><b id="weaponStatus">炮弹就绪</b><small id="weaponDescription">标准炮 · 按住连续射击</small><div class="bar"><i id="reloadBar"></i></div></div><div id="crosshair" class="crosshair"><span id="chargeProgress" hidden></span></div><div id="staminaMeter" class="stamina-meter" role="meter" aria-label="加速耐力" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><i id="staminaBar"></i></div><div id="enemyBaseCard" class="enemy-camp-label" hidden><span>敌军营地 <b id="enemyBaseHp"></b></span><div class="bar"><i id="enemyBaseBar"></i></div></div><div id="siteLabels"></div><div id="enemyLabels"></div><div id="pickupLabels"></div><div id="objective" class="objective" hidden></div><div id="connectionStatus" class="connection-status" hidden></div>' +
  '<div class="touch-controls"><div id="joystick" role="group" aria-label="驾驶摇杆"><span></span></div><button id="fireButton" aria-label="按住开火并拖动瞄准">' + icon('target') + '<small id="touchReload">开火</small></button></div><div class="camera-buttons"><button id="zoomIn" class="icon-button" aria-label="拉近镜头">＋</button><button id="zoomOut" class="icon-button" aria-label="拉远镜头">−</button><button id="freeLook" class="icon-button" aria-label="切换自由观察">' + icon('camera') + '</button><button id="boostToggle" class="icon-button ability-toggle" aria-label="切换加速模式" aria-pressed="false" title="加速模式（B）">' + icon('boost') + '<small>加速</small></button><button id="chargeToggle" class="icon-button ability-toggle" aria-label="切换蓄力模式" aria-pressed="false" title="蓄力模式（Q）">' + icon('charge') + '<small>蓄力</small></button></div></section>' +
  '<div id="toast" role="status" aria-live="polite" hidden></div>' +
  '<dialog id="joinDialog"><div class="dialog-content"><div class="dialog-header"><h2>加入小队</h2><button class="icon-button" data-close="joinDialog" aria-label="关闭">' + icon('close') + '</button></div><p>输入朋友分享的房间号。所有人都可以用手机开房或加入，房主需保持游戏在前台。</p><label for="roomInput">六位房间号</label><input id="roomInput" class="room-input" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC234"><button id="connectButton" class="primary">加入房间</button><p id="joinStatus" role="status">同一 Wi-Fi 更容易直连。跨网络连接取决于网络环境。</p></div></dialog>' +
  '<dialog id="lobbyDialog"><div class="dialog-content"><div class="dialog-header"><h2>山谷小队</h2><button id="leaveLobby" class="icon-button" aria-label="离开房间">' + icon('close') + '</button></div><div class="room-code"><div><small>邀请朋友，一起守卫</small><strong id="roomCode"></strong></div><img id="roomQr" alt="扫码加入房间"></div><button id="copyRoom" class="text-button">复制邀请链接 ↗</button><div id="lobbyMode" class="lobby-mode"><b></b><span></span><small>模式、难度和地图由房主在开房前选择</small></div><div id="players" class="players"></div><button id="startRoom" class="primary">开始守卫</button><button id="readyButton" class="primary" hidden>我准备好了</button><p id="lobbyStatus">正在等待队友。最多 4 人，房主也可以独自出发。</p><p>房主切到后台会暂停战场；离开房间会结束本次联机。开房使用公共配对服务，战场通过设备直连同步。</p></div></dialog>' +
  '<dialog id="settingsDialog"><div class="dialog-content"><div class="dialog-header"><h2>游戏设置</h2><button id="closeSettings" class="icon-button" aria-label="关闭设置">' + icon('close') + '</button></div><label class="setting"><span>画面质量</span><select id="quality"><option value="auto">自动平衡</option><option value="low">省电流畅</option><option value="high">细腻画面</option></select></label><label class="setting"><span>炮击与爆炸震动</span><select id="shake"><option value="0">关闭</option><option value="0.4">轻度</option><option value="1">标准</option><option value="1.4">强烈</option></select></label><label class="setting"><span>战场音效</span><input id="sound" type="checkbox"></label><p>手机发热或画面卡顿时，可选择省电流畅。横屏拥有更宽的战场视野，竖屏同样可以游玩。</p><button id="settingsDone" class="primary">完成</button></div></dialog>' +
  '<dialog id="pauseDialog"><div class="dialog-content"><div class="dialog-header"><h2>稍作休整</h2></div><div class="pause-player-stats"><span id="lives">备用 × 2</span><span>得分 <b id="score">0000</b></span></div><div class="wave"><span id="modeName">经典模式</span><span id="difficultyBadge" class="difficulty-badge">普通</span><b id="wave">01 / 05</b><small id="enemyCount">准备出击</small></div><p id="pauseText">战场已暂停，准备好后继续出发。</p><button id="resumeButton" class="primary">继续战斗</button><button id="pauseSettings" class="secondary">游戏设置</button><button id="backMenu" class="text-button">返回大厅</button></div></dialog>' +
  '<dialog id="resultDialog"><div class="dialog-content result"><div class="result-emblem" id="resultEmblem">◇</div><h2 id="resultTitle">山谷依旧长明</h2><p id="resultDescription"></p><div class="result-stats"><div><b id="resultScore">0</b><small>小队得分</small></div><div><b id="resultWave">0</b><small id="resultProgressLabel">战役进度</small></div><div><b id="resultTime">0:00</b><small>守卫时间</small></div></div><div id="resultRanking" class="result-ranking"></div><p id="resultReward" role="status"></p><button id="retryButton" class="primary">再次出征</button><button id="resultMenu" class="text-button">返回大厅</button></div></dialog>' +
  '<dialog id="helpDialog"><div class="dialog-content"><div class="dialog-header"><h2>坦克手册</h2><button class="icon-button" data-close="helpDialog" aria-label="关闭手册">' + icon('close') + '</button></div><p>经典模式：守住己方营地，摧毁敌军营地获胜；防守模式：击退五波来袭敌军。两种模式均可单人或合作，坦克被击毁后可使用两辆备用坦克，己方营地被毁则战役结束。</p><table class="help-table"><tr><td>电脑驾驶</td><td>WASD / 方向键按镜头方向移动，车身自动转向</td></tr><tr><td>电脑瞄准</td><td>单击战场锁定鼠标；拖动/鼠标移动瞄准，左键或空格开火</td></tr><tr><td>自由镜头</td><td>滚轮缩放，Alt 只观察，C 归位</td></tr><tr><td>手机操作</td><td>左摇杆推向哪里就往哪里走，右侧拖动瞄准；按住开火按钮也能拖动</td></tr><tr><td>加速模式</td><td>点击双箭头按钮或按 B 切换。速度提高 60%，满耐力约可持续 8 秒；停止加速 1 秒后恢复，耗尽后自动关闭</td></tr><tr><td>蓄力模式</td><td>点击闪电按钮或按 Q 切换。按住发射键蓄力，松开发射；1.6 秒蓄满，威力为标准炮的 2.8 倍，保留连发道具次数。暂停、失焦和取消触控会取消蓄力</td></tr><tr><td>防御塔与占领</td><td>经典模式小 / 中 / 大地图双方各 1 / 2 / 3 座塔，另有 1 / 2 / 3 座中立塔；防守模式保留我方塔和中立塔。驶入圈内停留 6 秒即可占领；敌我争夺时暂停，占领后自动防守，也可被敌军夺回。毁塔永久失效，营地可直接攻击</td></tr><tr><td>补给点</td><td>占领后为圈内受伤友军恢复 35% 血量，共享 30 秒冷却。满血不消耗维修，争夺期间暂停补给；小地图 1 个、中地图 2 个、大地图 3 个</td></tr><tr><td>受损坦克</td><td>低于 60% 开始冒烟、散布增加，受损减速最多 15%；维修后恢复</td></tr><tr><td>山谷地形</td><td>中央谷道与两侧高地由缓坡连通；上坡略慢，山坡可挡炮。瞄准目标时炮管自动适配高低差</td></tr><tr><td>高草伏击</td><td>完全进入高草即可隐蔽；开炮后暴露 5 秒，离开再进入也不会提前隐蔽。草丛外敌军全局可见；发现敌营后，全队立即开全图。</td></tr><tr><td>河流与桥梁</td><td>浅河可涉水，速度为平地的 60%，车身深入浅水后减伤 20%；桥面无减伤，深河只能从桥上通过。</td></tr><tr><td>战术破坏</td><td>炸开树木和岩壁开辟捷径；倒木与弹坑整局保留且可碾过。树倒稳后，进入倒木范围减伤 25%；与浅水不叠加，双方遵守相同规则</td></tr><tr><td>战场补给</td><td>绿：回血（满血时保留）；黄：快装 60 / 90 / 120 秒；橙：24 次三连发；蓝：90 点护盾。重复拾取可补充，上限为两份。靠近箱子可查看效果，驶过即可拾取</td></tr></table><p>难度可选休闲、普通、挑战。普通单人经典模式最多同时 3 辆敌军（2 进攻、1 驻守），总计 18 辆；清掉进攻部队后有 20 秒反攻窗口。增援耗尽后仍需摧毁敌营才能获胜。</p><p>敌军炮口闪光表示即将开火，利用山坡和掩体脱离视线。小队每击毁 3 辆敌军，会在击杀者身旁补充一个维修包；普通单人防守模式每波 4～8 辆，波间休整 15 秒。</p><p>合作模式没有队友伤害，也不会误伤本方围墙；经典模式可以摧毁敌军围墙。跨网络直连可能受运营商限制；同一可互访 Wi-Fi 下更适合一起游玩。</p></div></dialog>';

let renderer: BattleRenderer;
try {
  renderer = new BattleRenderer(get<HTMLCanvasElement>('battlefield'));
} catch (error) {
  get('boot')?.remove();
  get('app').innerHTML = '<div class="fatal"><h2>暂时无法启动三维画面</h2><p>请使用支持 WebGL 的新版 Safari、Chrome 或 Edge，开启浏览器硬件加速后重试。</p><button onclick="location.reload()">重新加载</button></div>';
  throw error;
}
const controls = new Controls(renderer, get('battlefield'), get('joystick'), get('fireButton'));
enableHudTouchButtons(get('hud'));
const rooms = new Rooms();
let selectedMode: GameMode = 'classic';
const savedDifficulty = read('difficulty', 'normal');
let selectedDifficulty: Difficulty = savedDifficulty === 'casual' || savedDifficulty === 'challenge' ? savedDifficulty : 'normal';
get<HTMLSelectElement>('difficulty').value = selectedDifficulty;
get('difficultyDescription').textContent = DIFFICULTIES[selectedDifficulty].description;
const savedMap = read('map', 'small');
let selectedMap: MapSize = savedMap === 'medium' || savedMap === 'large' ? savedMap : 'small';
get<HTMLSelectElement>('mapSize').value = selectedMap;
get('mapTitle').textContent = MAPS[selectedMap].name;
get('mapDescription').textContent = MAPS[selectedMap].label;
let simulation = new Simulation(73419, selectedMode, selectedDifficulty, selectedMap);
let state: State = simulation.state;
let localId = 'preview';
simulation.addPlayer(localId, '守卫者');
simulation.addPlayer('preview-two', '队友');
state.tanks[0].x = mapFor(state.mapSize).spawn.x + 2;
state.tanks[0].z = mapFor(state.mapSize).base.z - 15;
state.tanks[1].x = mapFor(state.mapSize).spawn.x - 3;
state.tanks[1].z = mapFor(state.mapSize).base.z - 12;
let screen: 'menu' | 'lobby' | 'game' = 'menu';
let networkBusy = false;
let resultShown = false;
let previousLobby = '';
let inviteLink = '';
let toastTimer = 0;
let previousBaseHp = 600;
let damageToastAt = 0;
let lastHitDirection = { x: 0, z: 0, until: 0 };
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
const savedShake = read('shake-strength', read('shake', 'true') === 'false' ? '0' : '1.4');
// 旧版自动保存的标准档迁移一次；之后用户主动选择标准或关闭都会继续保留。
get<HTMLSelectElement>('shake').value = !read('shake-default-v2', '') && savedShake === '1' ? '1.4' : ['0', '0.4', '1', '1.4'].includes(savedShake) ? savedShake : '1.4';
write('shake-default-v2', 'true');
get<HTMLInputElement>('sound').checked = read('sound', 'true') === 'true';
function settings() {
  renderer.setQuality(get<HTMLSelectElement>('quality').value);
  renderer.shakeStrength = Number(get<HTMLSelectElement>('shake').value) || 0;
  renderer.shakeEnabled = renderer.shakeStrength > 0;
  write('shake-strength', String(renderer.shakeStrength));
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

const career = new Career(message => toast(message, 6500));

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
  radarExpanded = false; get('radarPanel').classList.remove('expanded');
  get('mapToggle').setAttribute('aria-expanded', 'false'); get('mapToggle').textContent = '地图 ↗';
  controls.boost = false; controls.chargeMode = false;
  controls.reset();
  controls.enabled = !state.paused;
  syncModes();
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
  damageToastAt = 0; lastHitDirection.until = 0;
  discoveredBefore = state.enemyBaseDiscovered;
  previousDropEvent = state.events.at(-1)?.id ?? 0;
  // 开局立即刷新模式、目标和血条，不等待下一次 HUD 定时更新。
  get('enemyLabels').innerHTML = '';
  get('pickupLabels').innerHTML = '';
  get('crosshair').hidden = true;
  updateHud();
  renderer.audio.unlock();
  toast(matchMedia('(pointer: coarse)').matches ? '左摇杆移动，右侧拖动瞄准；按住开火可连射。' : 'WASD 移动，鼠标瞄准，左键开火。C 可归位镜头。', 3000);
}

function newSolo() {
  rooms.close();
  simulation = new Simulation(undefined, selectedMode, selectedDifficulty, selectedMap);
  localId = rooms.playerId;
  career.refresh();
  simulation.addPlayer(localId, nickname(), career.profile.upgrades);
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
  simulation = new Simulation(73419, selectedMode, selectedDifficulty, selectedMap);
  simulation.addPlayer('preview', nickname());
  localId = 'preview';
  state = simulation.state;
  state.tanks[0].z = mapFor(state.mapSize).base.z - 15;
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
  controls.enabled = !state.paused;
  previousFrame = performance.now();
  accumulator = 0;
  renderer.audio.unlock();
}

function renderLobby() {
  const players = state.tanks.filter(t => t.team === 'player');
  const signature = players.map(t => t.id + t.name + t.ready + t.connected).join('|') + rooms.role + state.mode + state.difficulty + state.mapSize + state.baseMaxHp + state.campUpgrades.repair;
  if (signature === previousLobby) return;
  previousLobby = signature;
  get('players').innerHTML = players.map((t, i) => '<div class="player-slot"><i style="background:' + COLORS[t.color % 4] + '"></i><span>' + escape(t.name) + (t.id === localId ? ' · 你' : '') + '</span><small>' + (i === 0 ? '房主' : t.ready ? '已准备' : '准备中') + '</small></div>').join('') +
    Array.from({ length: Math.max(0, 4 - players.length) }, () => '<div class="player-slot empty"><i style="background:#cbd0bb"></i><span>等待一位坦克手…</span><small>空位</small></div>').join('');
  get('lobbyMode').querySelector('b')!.textContent = MODES[state.mode].name + ' · ' + DIFFICULTIES[state.difficulty].name + ' · ' + MAPS[state.mapSize].name;
  get('lobbyMode').querySelector('span')!.textContent = MODES[state.mode].description + ' · 营地耐久 ' + state.baseMaxHp + ' · 维修工坊 ' + state.campUpgrades.repair + ' 级（小队最高，不叠加）';
  get('startRoom').textContent = state.mode === 'classic' ? '开始攻防战' : '开始守卫';
  get('startRoom').hidden = rooms.role !== 'host';
  get('readyButton').hidden = rooms.role !== 'guest';
  get<HTMLButtonElement>('startRoom').disabled = players.some(t => !t.ready);
  get('readyButton').textContent = players.find(t => t.id === localId)?.ready ? '取消准备' : '我准备好了';
  get('lobbyStatus').textContent = rooms.role === 'host' ? players.some(t => !t.ready) ? '等待队友准备完成。' : '小队已就绪，可以开始战役。' : '准备好后，等待房主开始战役。';
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
      simulation = new Simulation(undefined, selectedMode, selectedDifficulty, selectedMap);
      career.refresh();
  simulation.addPlayer(localId, nickname(), career.profile.upgrades);
      state = simulation.state;
      await rooms.create();
      await lobby();
    } else {
      career.refresh();
      await rooms.join(get<HTMLInputElement>('roomInput').value, nickname(), career.profile.upgrades);
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
  const wasPaused = state.paused;
  state = incoming;
  // 房主暂停也松开客机的驾驶和蓄力输入，继续战斗时需要重新按下。
  if (screen === 'game' && state.paused && !wasPaused) { controls.enabled = false; controls.reset(); }
  else if (screen === 'game' && !state.paused && wasPaused && !radarExpanded && !document.querySelector('dialog[open]') && !resultShown) controls.enabled = true;
  if (state.phase !== 'lobby' && screen !== 'game') enterGame();
  if (screen === 'lobby') renderLobby();
};
rooms.onJoin = (id, name, upgrades) => {
  const existing = state.tanks.find(t => t.id === id);
  if (!existing && state.phase !== 'lobby') return false;
  const result = simulation.addPlayer(id, name, upgrades);
  if (result) { previousLobby = ''; return true; }
  return false;
};
rooms.onLeave = id => { simulation.disconnect(id); previousLobby = ''; toast('一位队友离开了房间。'); };
rooms.onPing = (id, point) => simulation.ping(id, point);
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

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
  button.onclick = () => {
    if (screen !== 'menu' || networkBusy) return;
    selectedMode = button.dataset.mode === 'defense' ? 'defense' : 'classic';
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(option => option.setAttribute('aria-pressed', String(option.dataset.mode === selectedMode)));
    menu();
  };
});
get<HTMLSelectElement>('difficulty').onchange = () => {
  if (screen !== 'menu' || networkBusy) return;
  selectedDifficulty = get<HTMLSelectElement>('difficulty').value as Difficulty;
  write('difficulty', selectedDifficulty);
  get('difficultyDescription').textContent = DIFFICULTIES[selectedDifficulty].description;
  menu();
};
get<HTMLSelectElement>('mapSize').onchange = () => {
  if (screen !== 'menu' || networkBusy) return;
  selectedMap = get<HTMLSelectElement>('mapSize').value as MapSize;
  write('map', selectedMap);
  get('mapTitle').textContent = MAPS[selectedMap].name;
  get('mapDescription').textContent = MAPS[selectedMap].label;
  menu();
};
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
function syncModes() {
  for (const [id, active] of [['boostToggle', controls.boost], ['chargeToggle', controls.chargeMode]] as const) {
    get(id).classList.toggle('active', active); get(id).setAttribute('aria-pressed', String(active));
  }
  get('fireButton').setAttribute('aria-label', controls.chargeMode ? '按住蓄力并拖动瞄准，松开发射' : '按住开火并拖动瞄准');
}
controls.onChange = () => {
  if (screen !== 'game') return;
  syncModes();
  if (rooms.role === 'guest') rooms.sendInput(controls.read());
  else simulation.input(localId, controls.read());
};
get('boostToggle').onclick = () => { if (controls.enabled) { controls.boost = !controls.boost; controls.onChange(); } };
get('chargeToggle').onclick = () => { if (controls.enabled) controls.setChargeMode(!controls.chargeMode); };

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
get('careerButton').onclick = () => { closeDialogs(); career.open(); };
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
window.addEventListener('pagehide', event => {
  // 真正离开页面时主动释放 GPU 和音频资源，避免刷新后旧场景仍占用浏览器图形上下文。
  if (event.persisted) return;
  rooms.close(); renderer.scene.dispose(); renderer.engine.dispose();
});

let radarExpanded = false;
let radarTerrain: HTMLCanvasElement | undefined;
let radarMap = '';
let discoveredBefore = false;

function toggleMap() {
  if (screen !== 'game' || resultShown || document.querySelector('dialog[open]')) return;
  radarExpanded = !radarExpanded;
  controls.reset(); controls.enabled = !radarExpanded && !state.paused;
  if (radarExpanded) document.exitPointerLock?.();
  get('radarPanel').classList.toggle('expanded', radarExpanded);
  get('mapToggle').setAttribute('aria-expanded', String(radarExpanded));
  get('mapToggle').setAttribute('aria-label', radarExpanded ? '收起战术地图' : '展开战术地图');
  get('mapToggle').textContent = radarExpanded ? '收起地图 ×' : '地图 ↗';
}
get('mapToggle').onclick = toggleMap;
window.addEventListener('keydown', event => {
  if (screen !== 'game' || resultShown || document.querySelector('dialog[open]')) return;
  if ((event.code === 'KeyM' || radarExpanded && event.code === 'Escape') && !event.repeat) { toggleMap(); event.preventDefault(); }
});
get('radar').addEventListener('click', event => {
  if (!radarExpanded) { toggleMap(); return; }
  const rect = get('radar').getBoundingClientRect(), map = mapFor(state.mapSize);
  const scale = Math.min(140 / (map.arena.x * 2), 144 / (map.arena.z * 2));
  const point = { x: (((event.clientX - rect.left) / rect.width) * 160 - 80) / scale, z: (((event.clientY - rect.top) / rect.height) * 160 - 80) / scale };
  if (Math.abs(point.x) > map.arena.x || Math.abs(point.z) > map.arena.z) return;
  if (rooms.role === 'guest') rooms.ping(point); else simulation.ping(localId, point);
  toast('已标记路线，小队共享 12 秒。', 1200);
});

function updateThreat() {
  const player = state.tanks.find(t => t.id === localId), element = get('threatArrow');
  if (!player || player.hp <= 0 || state.paused || radarExpanded || resultShown) { element.hidden = true; return; }
  const shell = state.shells.find(s => {
    if (s.team === 'player') return false;
    const dx = player.x - s.x, dz = player.z - s.z, speed = Math.hypot(s.vx, s.vz);
    const ahead = (dx * s.vx + dz * s.vz) / Math.max(1, speed);
    return ahead > 0 && ahead < 23 && Math.abs(dx * s.vz - dz * s.vx) / Math.max(1, speed) < 4;
  });
  const warning = state.sites.find(s => s.team === 'enemy' && s.warning > 0 && s.target === localId) ?? state.tanks.find(t => t.team === 'enemy' && t.warning > 0 && state.visibleEnemies.includes(t.id) && distance(t, player) < 26);
  const baseAttack = state.time - damageToastAt < 3 && damageToastAt > 0;
  const recentHit = state.time < lastHitDirection.until;
  const target = shell ?? warning ?? (recentHit ? lastHitDirection : baseAttack ? mapFor(state.mapSize).base : undefined);
  element.hidden = !target;
  if (!target) return;
  const angle = Math.atan2(target.x - player.x, target.z - player.z) - renderer.yaw;
  const radius = Math.min(innerWidth, innerHeight) * 0.24;
  element.style.left = innerWidth / 2 + Math.sin(angle) * radius + 'px';
  element.style.top = innerHeight / 2 - Math.cos(angle) * radius + 'px';
  element.querySelector('i')!.style.transform = `rotate(${angle}rad)`;
  element.querySelector('span')!.textContent = shell ? '来弹' : warning ? '敌军瞄准' : recentHit ? '受击方向' : '营地受袭';
}

function drawRadar() {
  const ctx = get<HTMLCanvasElement>('radar').getContext('2d')!;
  ctx.setTransform(3, 0, 0, 3, 0, 0);
  ctx.clearRect(0, 0, 160, 160);
  const scale = Math.min(140 / (mapFor(state.mapSize).arena.x * 2), 144 / (mapFor(state.mapSize).arena.z * 2));
  const position = (x: number, z: number) => [80 + x * scale, 80 + z * scale];
  if (!radarTerrain || radarMap !== state.mapSize) {
    radarMap = state.mapSize;
    radarTerrain = document.createElement('canvas');
    radarTerrain.width = radarTerrain.height = 160;
    const land = radarTerrain.getContext('2d')!;
    for (let z = -mapFor(state.mapSize).arena.z; z < mapFor(state.mapSize).arena.z; z += 2) for (let x = -mapFor(state.mapSize).arena.x; x < mapFor(state.mapSize).arena.x; x += 2) {
      const height = groundHeight(x + 1, z + 1, mapFor(state.mapSize));
      land.fillStyle = waterAt({ x, z }, mapFor(state.mapSize)) ? '#6caab14a' : height > 5 ? '#c6d6a82b' : height > 1 ? '#cabe9420' : '#dce8be16';
      const p = position(x, z);
      land.fillRect(p[0], p[1], 2 * scale + 0.2, 2 * scale + 0.2);
    }
  }
  ctx.drawImage(radarTerrain, 0, 0);
  const explored = new Set(state.explored);
  const known = (x: number, z: number) => explored.has(exploredCell(x, z, state));
  for (const b of mapFor(state.mapSize).bridges) {
    const p = position(b.x - b.width / 2, b.z - b.depth / 2);
    ctx.fillStyle = '#d9c5a3'; ctx.fillRect(p[0], p[1], b.width * scale, b.depth * scale);
  }
  for (let z = -mapFor(state.mapSize).arena.z; z < mapFor(state.mapSize).arena.z; z += EXPLORE_STEP) for (let x = -mapFor(state.mapSize).arena.x; x < mapFor(state.mapSize).arena.x; x += EXPLORE_STEP) {
    if (known(x + 1, z + 1)) continue;
    const p = position(x, z), cell = EXPLORE_STEP * scale; ctx.strokeStyle = '#edf4d83d'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(p[0], p[1] + cell); ctx.lineTo(p[0] + cell, p[1]); ctx.stroke();
  }
  ctx.strokeStyle = '#e8e2bc33';
  ctx.lineWidth = 1;
  ctx.strokeRect(80 - mapFor(state.mapSize).arena.x * scale, 80 - mapFor(state.mapSize).arena.z * scale, mapFor(state.mapSize).arena.x * 2 * scale, mapFor(state.mapSize).arena.z * 2 * scale);
  for (const o of state.obstacles) {
    if (o.hp <= 0 || !known(o.x, o.z) || o.team === 'enemy' && !state.enemyBaseDiscovered) continue;
    const [x, y] = position(o.x, o.z);
    ctx.fillStyle = o.kind === 'wall' ? o.team === 'enemy' ? '#da9b80' : '#dacead' : o.kind === 'rock' ? '#adb49690' : '#8ea98f75';
    ctx.fillRect(x - o.radius * scale, y - o.radius * scale, o.radius * 2 * scale, o.radius * 2 * scale);
  }
  const [bx, by] = position(mapFor(state.mapSize).base.x, mapFor(state.mapSize).base.z);
  ctx.fillStyle = state.baseHp / state.baseMaxHp < 0.3 ? '#e9a380' : '#e3d0a0';
  ctx.fillRect(bx - 5, by - 5, 10, 10);
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#344b40';
  ctx.fillText('我', bx, by + 3);
  if (state.mode === 'classic' && state.enemyBaseDiscovered) {
    const [ex, ey] = position(mapFor(state.mapSize).enemyBase.x, mapFor(state.mapSize).enemyBase.z);
    ctx.fillStyle = '#e5a085';
    ctx.fillRect(ex - 5, ey - 5, 10, 10);
    ctx.fillStyle = '#543b32';
    ctx.fillText('敌', ex, ey + 3);
  }
  for (const site of state.sites) {
    const [x, y] = position(site.x, site.z);
    ctx.strokeStyle = site.hp > 0 ? SITE_COLORS[site.team] : '#9f9c89'; ctx.lineWidth = 1.4;
    if (site.kind === 'tower') { ctx.strokeRect(x - 2.8, y - 2.8, 5.6, 5.6); ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(x - 1, y - 1, 2, 2); }
    else { ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); ctx.stroke(); }
  }
  for (const drop of state.drops) {
    if (!known(drop.x, drop.z)) continue;
    const [x, y] = position(drop.x, drop.z);
    ctx.fillStyle = '#cce7b8';
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  for (const ping of state.pings) {
    const [x, y] = position(ping.x, ping.z); const owner = state.tanks.find(t => t.id === ping.owner);
    ctx.strokeStyle = COLORS[owner?.color ?? 0]; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 3.5 + Math.sin(state.time * 5), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff7cf'; ctx.fillText('!', x, y + 3);
  }
  for (const t of state.tanks) {
    if (t.hp <= 0 || !t.connected || t.team === 'enemy' && !state.visibleEnemies.includes(t.id)) continue;
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
  get('modeName').textContent = MODES[state.mode].name;
  get('difficultyBadge').textContent = DIFFICULTIES[state.difficulty].name;
  get('enemyBaseHp').textContent = Math.ceil(state.enemyBaseHp) + ' / ' + state.enemyBaseMaxHp;
  get('enemyBaseBar').style.width = (state.enemyBaseMaxHp > 0 ? Math.max(0, state.enemyBaseHp / state.enemyBaseMaxHp * 100) : 0) + '%';
  get('wave').textContent = state.mode === 'classic' ? state.enemyBaseDiscovered ? '敌营 ' + Math.round(distance(player, mapFor(state.mapSize).enemyBase)) + 'm' : '循路侦察敌营' : String(Math.max(1, state.wave)).padStart(2, '0') + ' / 0' + WAVES;
  get('enemyCount').textContent = state.phase === 'battle' ? '敌军 ' + enemies.length + (state.mode === 'classic' ? state.reinforcementCountdown > 0 ? ' · 反攻 ' + Math.ceil(state.reinforcementCountdown) + 's' : state.remaining > 0 ? ' · 后备 ' + state.remaining : ' · 增援耗尽' : ' · 后续 ' + state.remaining) : state.mode === 'classic' ? '准备出征' : '下一波前的休整';
  get('tankHp').textContent = Math.ceil(player.hp) + ' / ' + player.maxHp;
  get('tankBar').style.width = player.hp / player.maxHp * 100 + '%';
  get('tankBar').style.background = player.hp / player.maxHp < 0.3 ? '#e9a185' : '#c1d4a5';
  get('damageStatus').hidden = player.hp / player.maxHp >= 0.6 || player.hp <= 0;
  get('concealmentStatus').hidden = !mapFor(state.mapSize).grass.some(g => inRegion(player, g)) || player.hp <= 0;
  get('concealmentStatus').textContent = concealed(player, state) ? '隐蔽' : player.exposedUntil > state.time ? '暴露 ' + Math.ceil(player.exposedUntil - state.time) + 's' : '深入高草可隐蔽';
  const cover = terrainCover(player, state);
  get('coverStatus').hidden = !cover || player.hp <= 0;
  get('coverStatus').textContent = coverLabel(cover);
  get('coverStatus').dataset.cover = cover ?? '';
  get('damageStatus').textContent = player.hp / player.maxHp < 0.3 ? '重损 · 减速 / 散布' : '受损 · 减速';
  get('localTankStatus').classList.toggle('damaged', player.hp / player.maxHp < 0.6);
  get('tankHealth').setAttribute('aria-valuenow', String(Math.ceil(player.hp)));
  get('tankHealth').setAttribute('aria-valuemax', String(player.maxHp));
  get('lives').textContent = '备用 × ' + player.lives;
  get('score').textContent = String(player.score).padStart(4, '0');
  if (player.boostLocked && controls.boost) { controls.boost = false; controls.onChange(); }
  get('staminaBar').style.height = player.stamina / BOOST.capacity * 100 + '%';
  get('staminaMeter').setAttribute('aria-valuenow', String(Math.round(player.stamina)));
  get('staminaMeter').classList.toggle('boosting', player.boosting);
  get('staminaMeter').classList.toggle('low', player.stamina < BOOST.restart);
  const charging = player.charging && player.hp > 0, percent = Math.round(chargePower(player.charge) * 100);
  get('weaponStatus').textContent = charging ? percent === 100 ? '蓄满 · 松开发射' : '蓄力 ' + percent + '%' : player.cooldown > 0 ? '装填 ' + player.cooldown.toFixed(1) + 's' : controls.chargeMode ? '按住蓄力 · 松开发射' : '炮弹就绪';
  get('weaponDescription').textContent = controls.chargeMode ? '蓄满威力 2.8 倍 · 松开发射' : '标准炮 · 按住连续射击';
  get('touchReload').textContent = charging ? percent === 100 ? '松开发射' : percent + '%' : player.cooldown > 0 ? player.cooldown.toFixed(1) + 's' : controls.chargeMode ? '蓄力' : '开火';
  get('fireButton').classList.toggle('charging', charging); get('crosshair').classList.toggle('charging', charging);
  get('chargeProgress').hidden = !charging; get('chargeProgress').textContent = percent === 100 ? '蓄满' : percent + '%';
  get('fireButton').style.setProperty('--charge', String(percent / 100));
  get('reloadBar').style.width = charging ? percent + '%' : Math.max(0, 1 - player.cooldown / ((controls.chargeMode ? CHARGE.cooldown : 1) * (player.buffs.rapid > 0 ? 0.7 : 1) * (1 - player.upgrades.reload * 0.04))) * 100 + '%';
  get('roomBadge').textContent = rooms.role === 'solo' ? '单人战役 · N ↑' : rooms.code + ' · N ↑';
  get('buffs').innerHTML = (Object.entries(player.buffs) as [Power, number][]).filter(([, time]) => time > 0).map(([key, time]) => '<div class="buff' + ((key === 'rapid' && time < 10 || key === 'burst' && time <= 3 || key === 'armor' && time <= 20) ? ' expiring' : '') + '">' + POWER_LABELS[key] + '<b>' + Math.ceil(time) + (key === 'burst' ? '次' : key === 'armor' ? '盾' : 's') + '</b></div>').join('');
  let objective = '';
  if (state.paused) objective = '<b>战场已暂停</b><small>' + (rooms.role === 'guest' ? '等待房主继续战斗' : '休整片刻，再次出发') + '</small>';
  else if (player.hp <= 0) objective = player.respawn > 0 ? '<b>备用坦克出动</b><small>' + Math.ceil(player.respawn) + ' 秒后重返战场</small>' : '<b>备用坦克耗尽</b><small>队友仍在战斗，为他们守候。</small>';
  else if (state.phase === 'intermission' && state.mode === 'classic') objective = '<b>攻破敌军阵地</b><small>' + Math.ceil(state.countdown) + ' 秒后出征 · 留意小地图，兼顾进攻与回防</small>';
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
  if (state.enemyBaseDiscovered && !discoveredBefore) toast('发现敌军营地！小队全图已解锁。', 2500);
  discoveredBefore = state.enemyBaseDiscovered;
  previousBaseHp = state.baseHp;
  for (const event of state.events) if (event.id > previousDropEvent) {
    if (event.kind === 'capture') toast((event.team === 'player' ? '我方占领了' : '敌军夺取了') + (event.target === 'tower' ? '中立防御塔' : '补给点'), 2200);
    if (event.kind === 'pickup' && event.owner === localId) toast(event.power ? '已拾取：' + POWER_LABELS[event.power] : '已拾取战场补给', 1600);
    if (event.kind === 'hit' && event.sourceX !== undefined && event.sourceZ !== undefined && distance(event, player) < 1.8) lastHitDirection = { x: event.sourceX, z: event.sourceZ, until: state.time + 1.2 };
  }
  previousDropEvent = state.events.at(-1)?.id ?? 0;
  drawRadar();
  updateThreat();
  if ((state.phase === 'won' || state.phase === 'lost') && !resultShown) {
    resultShown = true;
    controls.enabled = false;
    controls.reset();
    get('resultTitle').textContent = state.phase === 'won' ? state.mode === 'classic' ? '敌军阵地已攻破' : '山谷依旧长明' : '下次，一定守住';
    get('resultDescription').textContent = state.phase === 'won' ? state.mode === 'classic' ? '敌军营地已被摧毁，己方营地依然屹立。小队凯旋！' : '五波敌军已被击退。谢谢你，坦克手。' : state.baseHp <= 0 ? '营地核心被摧毁了。利用掩体和维修补给，再来一次。' : '小队的备用坦克已耗尽。调整路线，再次出发。';
    get('resultScore').textContent = String(state.tanks.filter(t => t.team === 'player').reduce((n, t) => n + t.score, 0));
    get('resultProgressLabel').textContent = state.mode === 'classic' ? '敌营摧毁进度' : '抵达波次';
    get('resultWave').textContent = state.mode === 'classic' ? Math.round((1 - state.enemyBaseHp / state.enemyBaseMaxHp) * 100) + '%' : state.wave + ' / ' + WAVES;
    get('resultTime').textContent = Math.floor(state.time / 60) + ':' + String(Math.floor(state.time % 60)).padStart(2, '0');
    get('resultRanking').innerHTML = standings(state).map(t => '<div><span>第 ' + (1 + state.tanks.filter(o => o.team === 'player' && o.score > t.score).length) + ' 名 · ' + escape(t.name) + (t.id === localId ? '（你）' : '') + '<small>击毁 ' + t.stats.kills + ' · 助攻 ' + t.stats.assists + ' · 防守 ' + t.stats.defenses + ' · 据点贡献 ' + t.stats.objectives + ' · 团队奖励 ' + t.stats.teamBonus + '</small></span><b>' + t.score + '</b></div>').join('');
    get('resultReward').textContent = '正在保存本局荣誉与金币…';
    const finishedId = state.matchId;
    void career.finish(state, player).then(record => {
      if (state.matchId !== finishedId) return;
      get('resultReward').textContent = record ? '本局荣誉 +' + record.honor + ' · 金币 +' + record.coins + ' · 累计荣誉 ' + career.profile.honor : '本局已经结算，荣誉与金币不会重复领取。';
    }).catch(() => { get('resultReward').textContent = '结算暂未保存，请返回档案导出备份。'; });
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
    const health = player && player.hp > 0 ? renderer.project(player.x, groundHeight(player.x, player.z, mapFor(state.mapSize)) + 2.5, player.z) : null;
    get('localTankStatus').hidden = !health?.visible;
    if (health?.visible) {
      get('localTankStatus').style.left = Math.max(44, Math.min(innerWidth - 44, health.x)) + 'px';
      get('localTankStatus').style.top = health.y + 'px';
    }
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
      if (t.id === localId || t.hp <= 0 || !t.connected || t.team === 'enemy' && !state.visibleEnemies.includes(t.id)) continue;
      const p = renderer.project(t.x, groundHeight(t.x, t.z, mapFor(state.mapSize)) + 2.4, t.z);
      if (!p.visible || t.team === 'enemy' && player && distance(player, t) > 48) continue;
      const cover = terrainCover(t, state);
      labels.push('<div class="enemy-label" style="left:' + p.x + 'px;top:' + p.y + 'px">' + (t.team === 'player' ? escape(t.name) : '') + (cover ? '<small class="cover-tag" title="' + coverLabel(cover) + '">掩护</small>' : '') + '<div class="bar"><i style="width:' + t.hp / t.maxHp * 100 + '%;' + (t.team === 'player' ? 'background:#bbdcc4' : '') + '"></i></div></div>');
    }
    const camp = mapFor(state.mapSize).enemyBase;
    const campPosition = state.mode === 'classic' && state.enemyBaseDiscovered && state.enemyBaseHp > 0 ? renderer.project(camp.x, groundHeight(camp.x, camp.z, mapFor(state.mapSize)) + 4.2, camp.z) : null;
    get('enemyBaseCard').hidden = !campPosition?.visible;
    if (campPosition?.visible) {
      get('enemyBaseCard').style.left = campPosition.x + 'px'; get('enemyBaseCard').style.top = campPosition.y + 'px';
    }
    get('enemyLabels').innerHTML = labels.join('');
    const sites: string[] = [];
    if (player && player.hp > 0) for (const site of state.sites) {
      if (site.hp <= 0 || distance(site, player) > 35) continue;
      const p = renderer.project(site.x, groundHeight(site.x, site.z, mapFor(state.mapSize)) + (site.kind === 'tower' ? 4.6 : 3.1), site.z);
      if (!p.visible) continue;
      const nearby = distance(site, player) < 12;
      const owner = { player: '我方', enemy: '敌方', neutral: '中立' }[site.team];
      const detail = site.contested ? '争夺中 · 占领暂停' : site.capture > 0 ? ({ player: '我方', enemy: '敌方', neutral: '' }[site.captureTeam] + '占领 ' + Math.floor(site.capture / SITE.captureSeconds * 100) + '%') : site.capturable && site.team !== 'player' ? '圈内停留 6 秒占领' : site.kind === 'supply' ? site.cooldown > 0 ? '维修冷却 ' + Math.ceil(site.cooldown) + 's' : '维修就绪 · 恢复 35%' : site.warning > 0 ? '即将开炮' : '';
      sites.push('<div class="site-label" data-site="' + site.id + '" data-team="' + site.team + '" style="left:' + Math.max(67, Math.min(innerWidth - 67, p.x)) + 'px;top:' + p.y + 'px;--site-color:' + SITE_COLORS[site.team] + '"><b>' + owner + ' ' + (site.kind === 'tower' ? '防御塔' : siteName(site)) + '</b>' +
        (site.kind === 'tower' ? '<div class="bar"><i style="width:' + site.hp / site.maxHp * 100 + '%"></i></div>' : '') +
        (nearby || site.warning > 0 ? '<small>' + detail + '</small>' : '') + (site.capture > 0 ? '<div class="bar capture-bar"><i style="width:' + site.capture / SITE.captureSeconds * 100 + '%"></i></div>' : '') + '</div>');
    }
    get('siteLabels').innerHTML = sites.join('');
    const supplies: string[] = [];
    if (player && player.hp > 0) for (const drop of state.drops) {
      if (distance(player, drop) > 11) continue;
      const p = renderer.project(drop.x, groundHeight(drop.x, drop.z, mapFor(state.mapSize)) + 1.9, drop.z);
      if (!p.visible) continue;
      const x = Math.max(80, Math.min(innerWidth - 80, p.x));
      const y = health?.visible && Math.abs(x - health.x) < 120 && Math.abs(p.y - health.y) < 70 ? Math.min(p.y, health.y - 45) : p.y;
      const full = drop.kind === 'heal' && player.hp >= player.maxHp;
      supplies.push('<div class="pickup-label' + (full ? ' unavailable' : '') + '" data-power="' + drop.kind + '" style="left:' + x + 'px;top:' + y + 'px"><b>' + POWER_LABELS[drop.kind] + '</b><small>' + pickupHint(drop.kind, player, state.mapSize) + '</small></div>');
    }
    get('pickupLabels').innerHTML = supplies.join('');
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
  rendering: { craters: renderer.scene.meshes.filter(m => m.name === 'persistent-crater').length, fallen: renderer.scene.transformNodes.filter(n => n.name === 'fallen-tree-body').length, meshes: renderer.scene.meshes.length, active: renderer.scene.getActiveMeshes().length, tracks: renderer.scene.meshes.filter(m => m.name === 'track-print').length },
  vehicle: (() => {
    const root = renderer.scene.getTransformNodeByName(localId);
    const chassis = root?.getChildTransformNodes(true).find(n => n.name === 'suspension');
    return root && chassis ? { position: { x: root.position.x, y: root.position.y, z: root.position.z }, pitch: chassis.rotation.x, roll: chassis.rotation.z } : null;
  })(),
  terrain: { size: { x: mapFor(state.mapSize).arena.x * 2, z: mapFor(state.mapSize).arena.z * 2 }, tanks: state.tanks.map(t => ({ id: t.id, height: groundHeight(t.x, t.z, mapFor(state.mapSize)), slope: groundSlope(t.x, t.z, mapFor(state.mapSize)) })), cameraGround: groundHeight(renderer.camera.position.x, renderer.camera.position.z, mapFor(state.mapSize)) },
  camera: { yaw: renderer.yaw, pitch: renderer.pitch, zoom: renderer.zoom, position: { x: renderer.camera.position.x, y: renderer.camera.position.y, z: renderer.camera.position.z } }, screen,
}) });

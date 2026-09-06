import { COSTS, loadoutTier, MAX_LEVEL, UPGRADES, upgradeKeys, type Upgrade } from './game/factory';
import { MAPS } from './game/maps';
import { DIFFICULTIES } from './game/balance';
import { MODES, type State, type Tank } from './game/types';
import { boardKey, buyUpgrade, unlockVehicle, selectVehicle, loadProfile, newProfile, parseProfile, PROFILE_KEY, rankName, resetFactory, saveProfile, settle, type MatchRecord, type Profile } from './profile';

import { VEHICLES, vehicleKinds, type TankKind } from './game/vehicles';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const safe = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class Career {
  profile: Profile;

  onChange: () => void = () => {};

  onVehicles: () => void = () => {};

  private dirty = false;

  private blocked = false;

  private imported?: Profile;

  private warning = '';

  constructor(private notify: (message: string) => void) {
    let loaded;
    try { loaded = loadProfile(localStorage); } catch { loaded = { profile: newProfile(), warning: '浏览器禁止本地存储，请用导出备份保留进度。' }; }
    this.profile = loaded.profile; this.warning = loaded.warning; this.blocked = this.warning.includes('原档案无法读取');
    document.body.insertAdjacentHTML('beforeend', `<dialog id="careerDialog"><div class="dialog-content">
      <div class="dialog-header"><h2>守卫者档案</h2><button id="closeCareer" class="icon-button" aria-label="关闭档案">×</button></div>
      <div class="career-tabs"><button type="button" data-career-tab="record" aria-pressed="true">战绩与荣誉</button><button type="button" data-career-tab="factory" aria-pressed="false">坦克工厂</button></div>
      <div id="careerSummary" class="career-summary"></div><p id="saveNotice" role="status"></p>
      <section id="recordPanel"><label for="recordGroup">本机通关排行榜</label><select id="recordGroup"></select><div id="recordBoard"></div><p>按模式、难度、地图、人数、车型及整队装备分榜。同分时用时较短者靠前。这里是本机记录，不是联网全球榜。</p><b class="minor-title">最近战役</b><div id="recordHistory"></div>
      <div class="button-row"><button id="exportProfile" class="secondary">导出存档备份</button><button id="importProfile" class="secondary">导入备份</button></div><input id="profileFile" type="file" accept="application/json,.json" hidden>
      <div id="importPreview" class="import-preview" hidden><p id="importDescription"></p><button id="confirmImport" class="primary">恢复这份档案</button><button id="cancelImport" class="text-button">取消</button></div><p>累计荣誉与升级跨局保存，战绩保留最近 200 条。清理网站数据或更换设备前请导出备份；无痕窗口不适合长期存档。</p></section>
      <section id="factoryPanel" hidden><p>金币用于升级，累计荣誉不会减少。装备在下一局出发时生效，每项最多三级；初始装备也能完成普通战役。</p><div id="factoryItems" class="factory-items"></div><b class="minor-title">车型解锁</b><p>车型永久解锁，装甲、履带与装填升级适用于所有车型。金币消费不会减少累计荣誉。</p><div id="vehicleFactory" class="factory-items"></div><button id="factoryGarage" class="secondary">查看车型与三维预览</button><p>合作阵地按小队中每项最高等级生效一次，不按人数叠加；开房后可在小队面板查看。</p><button id="resetFactory" class="text-button">重置数值升级 · 全额返还升级金币</button></section>
    </div></dialog>`);
    el('closeCareer').onclick = () => el<HTMLDialogElement>('careerDialog').close();
    document.querySelectorAll<HTMLButtonElement>('[data-career-tab]').forEach(button => button.onclick = () => {
      const factory = button.dataset.careerTab === 'factory';
      el('recordPanel').hidden = factory; el('factoryPanel').hidden = !factory;
      document.querySelectorAll<HTMLButtonElement>('[data-career-tab]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    });
    el('recordGroup').onchange = () => this.renderBoard();
    el('factoryItems').onclick = event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-upgrade]');
      if (button) void this.change(p => buyUpgrade(p, button.dataset.upgrade as Upgrade));
    };
    el('vehicleFactory').onclick = event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-vehicle-unlock]');
      if (button) void this.unlock(button.dataset.vehicleUnlock as TankKind);
    };
    el('factoryGarage').onclick = () => this.onVehicles();
    el('resetFactory').onclick = () => void this.change(p => { resetFactory(p); return true; });
    el('exportProfile').onclick = () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(this.profile, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `山谷守卫存档-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    el('importProfile').onclick = () => el<HTMLInputElement>('profileFile').click();
    el<HTMLInputElement>('profileFile').onchange = async () => {
      const file = el<HTMLInputElement>('profileFile').files?.[0]; if (!file) return;
      try {
        if (file.size > 4_000_000) throw new Error('存档文件过大。');
        this.imported = parseProfile(await file.text());
        el('importDescription').textContent = `恢复 ${rankName(this.imported.honor)} 档案：荣誉 ${this.imported.honor}，金币 ${this.imported.coins}，${this.imported.battles} 场战役。恢复会替换当前档案，请先导出当前进度留作备份。`;
        el('importPreview').hidden = false;
      } catch (error) { this.notify(error instanceof Error ? error.message : '无法读取存档。'); }
      el<HTMLInputElement>('profileFile').value = '';
    };
    el('cancelImport').onclick = () => { this.imported = undefined; el('importPreview').hidden = true; };
    el('confirmImport').onclick = () => {
      if (!this.imported) return;
      this.profile = this.imported; this.imported = undefined; this.blocked = false; this.dirty = true;
      this.persist(); this.render(); el('importPreview').hidden = true;
    };
    window.addEventListener('storage', event => { if (event.key === PROFILE_KEY && !this.dirty) { this.refresh(); this.render(); } });
    this.render();
  }

  refresh() {
    if (this.dirty || this.blocked) return;
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (raw) this.profile = parseProfile(raw);
    } catch { /* 当前会话仍可游玩、导出。 */ }
  }

  open() { this.refresh(); this.render(); el<HTMLDialogElement>('careerDialog').showModal(); }

  async unlock(kind: TankKind): Promise<boolean> {
    const result = await this.change(p => unlockVehicle(p, kind));
    if (result) this.notify(VEHICLES[kind].name + '已解锁，可以在出征前选择。');
    return !!result;
  }

  async select(kind: TankKind): Promise<boolean> {
    return !!await this.change(p => selectVehicle(p, kind));
  }

  private persist() {
    try {
      if (this.blocked) throw new Error('请先导入有效备份恢复原档案。');
      saveProfile(localStorage, this.profile); this.dirty = false;
      this.warning = '档案已保存在本机。建议定期导出备份。';
    } catch {
      this.dirty = true; this.warning = '本次进度尚未写入浏览器，请立即导出备份保留。'; this.notify(this.warning);
    }
  }

  private async change(action: (p: Profile) => unknown) {
    const run = () => { this.refresh(); const result = action(this.profile); this.dirty = true; this.persist(); this.render(); return result; };
    return navigator.locks ? navigator.locks.request('tank-battle-profile', run) : run();
  }

  async finish(state: State, player: Tank): Promise<MatchRecord | null> {
    return await this.change(p => settle(p, state, player)) as MatchRecord | null;
  }

  private renderBoard() {
    const key = el<HTMLSelectElement>('recordGroup').value;
    const records = this.profile.records.filter(r => r.won && boardKey(r) === key).sort((a, b) => b.score - a.score || a.seconds - b.seconds).slice(0, 10);
    el('recordBoard').innerHTML = records.length ? '<ol class="record-list">' + records.map(r => `<li><span>${new Date(r.at).toLocaleDateString('zh-CN')}</span><b>${r.score} 分</b><small>${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')}</small></li>`).join('') + '</ol>' : '<p class="empty-record">首次通关后，这里会留下你的纪录。</p>';
  }

  render() {
    const p = this.profile;
    el('careerSummary').innerHTML = `<div><small>累计荣誉 · ${rankName(p.honor)}</small><b>${p.honor}</b></div><div><small>工厂金币</small><b>${p.coins}</b></div><div><small>胜利 / 战役</small><b>${p.wins} / ${p.battles}</b></div>`;
    el('saveNotice').textContent = this.warning || '进度保存在当前浏览器，下一局继续累计。';
    const button = document.getElementById('careerButton'); if (button) button.textContent = `工厂与档案 · ${p.coins} 金币 ↗`;
    el('factoryItems').innerHTML = upgradeKeys.map(key => `<article class="factory-item"><div><b>${UPGRADES[key].name}<small> ${p.upgrades[key]} / ${MAX_LEVEL}</small></b><p>${UPGRADES[key].description}</p></div><button type="button" data-upgrade="${key}" ${p.upgrades[key] >= MAX_LEVEL || p.coins < COSTS[p.upgrades[key]] ? 'disabled' : ''}>${p.upgrades[key] >= MAX_LEVEL ? '已满级' : COSTS[p.upgrades[key]] + ' 金币升级'}</button></article>`).join('');
    el('vehicleFactory').innerHTML = vehicleKinds.map(kind => `<article class="factory-item"><div><b>${VEHICLES[kind].name}</b><p>${VEHICLES[kind].role} · ${VEHICLES[kind].trait}</p></div><button type="button" data-vehicle-unlock="${kind}" ${p.unlockedVehicles.includes(kind) || p.coins < VEHICLES[kind].cost ? 'disabled' : ''}>${p.unlockedVehicles.includes(kind) ? '已解锁' : VEHICLES[kind].cost + ' 金币解锁'}</button></article>`).join('');
    el<HTMLButtonElement>('resetFactory').disabled = loadoutTier(p.upgrades) === 0;
    const select = el<HTMLSelectElement>('recordGroup'), selected = select.value;
    const groups = [...new Map(p.records.map(r => [boardKey(r), r])).entries()];
    select.innerHTML = groups.map(([key, r], i) => `<option value="${safe(key)}">${MODES[r.mode].name} · ${DIFFICULTIES[r.difficulty].name} · ${MAPS[r.mapSize].name} · ${r.players} 人 · ${VEHICLES[r.vehicle].name} · 装备组 ${i + 1}</option>`).join('');
    if (groups.some(([key]) => key === selected)) select.value = selected;
    select.disabled = groups.length === 0; this.renderBoard();
    el('recordHistory').innerHTML = p.records.slice(0, 6).map(r => `<div class="history-row"><span>${r.won ? '胜利' : '再战'} · ${MAPS[r.mapSize].name}<small>${DIFFICULTIES[r.difficulty].name} · ${VEHICLES[r.vehicle].name} · 个人第 ${r.rank} / ${r.players} 名</small></span><b>+${r.honor}<small>荣誉</small></b><b>+${r.coins}<small>金币</small></b></div>`).join('') || '<p class="empty-record">出发吧，第一场战役正在等你。</p>';
    this.onChange();
  }
}

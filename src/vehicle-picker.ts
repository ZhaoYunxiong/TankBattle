import { Career } from './profile-ui';
import { ENGINEER, VEHICLES, vehicleKinds, vehicleStats, type TankKind } from './game/vehicles';
import { VehiclePreview } from './vehicle-preview';
import './vehicles.css';
import { enableDialogTouchButtons } from './touch-buttons';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class VehiclePicker {
  private kind: TankKind = 'standard';

  private preview?: VehiclePreview;

  private busy = false;

  constructor(private career: Career, private apply: (kind: TankKind) => Promise<boolean>, private canSelect: () => boolean) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="vehicleDialog" aria-labelledby="vehicleHeading"><div class="garage-content">
      <div class="dialog-header"><div><small class="garage-eyebrow">准备出征 / 车库</small><h2 id="vehicleHeading">选择你的坦克</h2></div><button id="closeGarage" class="icon-button" aria-label="关闭选车">×</button></div>
      <div id="vehicleOptions" class="vehicle-options" aria-label="四种坦克"></div>
      <div class="garage-detail"><div class="vehicle-stage"><canvas id="vehiclePreview" aria-label="坦克三维预览，可拖动旋转"></canvas><span>拖动旋转 · 战场同款模型</span><small id="previewFallback" hidden>三维预览暂未加载，仍可查看车型参数。</small></div>
      <div class="vehicle-info"><div class="vehicle-title"><h3 id="vehicleName"></h3><span id="vehicleRole"></span></div><p id="vehicleDescription"></p><div id="vehicleTrait" class="vehicle-trait"></div><dl id="vehicleStats" class="vehicle-stats"></dl><p id="vehicleDetail" class="vehicle-detail-note"></p></div></div>
      <div class="garage-footer"><p id="vehicleWallet" role="status"></p><button id="selectVehicle" class="primary">选用这辆坦克</button><small>四种车型均可加速、蓄力 · 开战后固定本局车型</small></div>
    </div></dialog>`);
    enableDialogTouchButtons(el<HTMLDialogElement>('vehicleDialog'));
    el('closeGarage').onclick = () => el<HTMLDialogElement>('vehicleDialog').close();
    el('vehicleOptions').onclick = event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-vehicle]');
      if (!button || this.busy) return;
      this.kind = button.dataset.vehicle as TankKind; this.render();
    };
    el<HTMLDialogElement>('vehicleDialog').addEventListener('close', () => { this.preview?.dispose(); this.preview = undefined; });
    el('selectVehicle').onclick = async () => {
      if (this.busy || !this.canSelect()) return;
      this.busy = true; this.render();
      try {
        this.career.refresh();
        if (!this.career.profile.unlockedVehicles.includes(this.kind) && !await this.career.unlock(this.kind)) return;
        if (await this.apply(this.kind)) el<HTMLDialogElement>('vehicleDialog').close();
      } finally { this.busy = false; this.render(); }
    };
  }

  open(selected?: TankKind) {
    if (!this.canSelect()) return;
    this.career.refresh(); this.kind = selected ?? this.career.profile.selectedVehicle;
    const dialog = el<HTMLDialogElement>('vehicleDialog');
    if (!dialog.open) dialog.showModal();
    try { this.preview ??= new VehiclePreview(el<HTMLCanvasElement>('vehiclePreview')); el('previewFallback').hidden = true; }
    catch { el('previewFallback').hidden = false; }
    this.render();
  }

  render() {
    if (!el<HTMLDialogElement>('vehicleDialog').open) return;
    const p = this.career.profile, v = vehicleStats(this.kind, p.upgrades), owned = p.unlockedVehicles.includes(this.kind);
    el('vehicleOptions').innerHTML = vehicleKinds.map(kind => `<button type="button" data-vehicle="${kind}" aria-pressed="${kind === this.kind}" ${this.busy ? 'disabled' : ''}><b>${VEHICLES[kind].name}</b><small>${VEHICLES[kind].role} · ${p.unlockedVehicles.includes(kind) ? kind === p.selectedVehicle ? '已选用' : '已解锁' : VEHICLES[kind].cost + ' 金币'}</small></button>`).join('');
    el('vehicleName').textContent = v.name; el('vehicleRole').textContent = v.role;
    el('vehicleDescription').textContent = v.description; el('vehicleTrait').textContent = v.trait;
    const stats = [['耐久', v.hp], ['普通炮', v.damage + ' 伤害'], ['装填', v.reload.toFixed(2) + ' 秒'], ['移速', v.speed.toFixed(1) + ' 米/秒'], ['满蓄力', v.chargeDamage + ' / ' + v.chargeSeconds + ' 秒'], ['加速续航', (100 / v.boostDrain).toFixed(1) + ' 秒']];
    el('vehicleStats').innerHTML = stats.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('');
    el('vehicleDetail').textContent = this.kind === 'engineer' ? `脱战 ${ENGINEER.peace} 秒后，${ENGINEER.range} 米内每 ${ENGINEER.cooldown} 秒自修 ${ENGINEER.self}，维修友军或友塔 ${ENGINEER.ally}。双方须脱战且无遮挡，多车维修不叠加。` : this.kind === 'heavy' ? '正面防护按车身朝向判定。装填较慢，利用掩体准备下一炮。' : this.kind === 'scout' ? '轻型更容易穿过狭窄空隙，适合灵活游走，注意较低的耐久。' : '沿用原有驾驶手感。数值已计入工厂升级；地形、受损和道具会影响战斗表现。';
    el('vehicleDetail').textContent += ' 车身后方 120° 为弱点，受到额外 25% 伤害。';
    el('vehicleWallet').textContent = `工厂金币 ${p.coins} · ${owned ? '已永久解锁' : '解锁后所有对局可用'}`;
    const button = el<HTMLButtonElement>('selectVehicle');
    button.textContent = this.busy ? '正在准备…' : owned ? '选用这辆坦克' : p.coins < v.cost ? `还差 ${v.cost - p.coins} 金币` : `解锁并选用 · ${v.cost} 金币`;
    button.disabled = this.busy || !this.canSelect() || !owned && p.coins < v.cost;
    this.preview?.show(this.kind);
  }
}

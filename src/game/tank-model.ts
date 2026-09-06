import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { COLORS, type Tank } from './types';
import { VEHICLES } from './vehicles';

export type TankVisual = { kind: Tank['kind']; color: number; root: TransformNode; chassis: TransformNode; gun: TransformNode; turret: TransformNode; barrel: Mesh; body: Mesh; shield: Mesh; warning: Mesh; glow: Mesh; wheels: Mesh[]; speed: number; slopePitch: number; slopeRoll: number; trailAt: number };

export interface ModelKit {
  scene: Scene;
  material(color: string, emissive?: boolean): StandardMaterial;
  box(name: string, width: number, height: number, depth: number, color: string, parent?: TransformNode): Mesh;
  cylinder(name: string, top: number, bottom: number, height: number, color: string, parent?: TransformNode, sides?: number): Mesh;
}

// 车库预览与战场使用同一个模型，避免选车时看到的外观与实际驾驶不一致。
export function buildTankModel(t: Pick<Tank, 'id' | 'team' | 'kind' | 'color'>, kit: ModelKit): TankVisual {
    const root = new TransformNode(t.id, kit.scene);
    const chassis = new TransformNode('suspension', kit.scene);
    chassis.parent = root;
    const color = t.team === 'player' ? COLORS[t.color % 4] : t.kind === 'heavy' ? '#ad6e5d' : t.kind === 'scout' ? '#bf8964' : '#bd7967';
    const body = kit.box('hull', 1.65, 0.52, 2.15, color, chassis);
    body.position.y = 0.56;
    const deck = kit.box('deck', 1.4, 0.2, 1.8, color, chassis);
    deck.position.y = 0.86;
    const wheels: Mesh[] = [];
    for (const side of [-1, 1]) {
      const tread = kit.box('track', 0.42, 0.52, 2.35, '#50594e', chassis);
      tread.position.set(side * 0.91, 0.36, 0);
      for (let i = -1; i <= 1; i++) {
        const wheel = kit.cylinder('wheel', 0.4, 0.4, 0.45, '#76806b', chassis, 8);
        wheel.rotation.z = Math.PI / 2;
        wheels.push(wheel);
        wheel.position.set(side * 0.92, 0.35, i * 0.7);
      }
      const strip = kit.box('track-guard', 0.5, 0.12, 2.25, color, chassis);
      strip.position.set(side * 0.91, 0.71, 0);
      const light = kit.box('headlight', 0.18, 0.14, 0.08, '#f2dda9', chassis);
      light.material = kit.material('#f3d9a5', true);
      light.position.set(side * 0.61, 0.65, 1.1);
    }
    const turret = new TransformNode('turret', kit.scene);
    turret.parent = root;
    turret.position.y = 0.91;
    const top = kit.cylinder('turret-armor', 0.9, 1.35, 0.52, color, turret, 6);
    top.position.y = 0.2;
    const hatch = kit.cylinder('hatch', 0.5, 0.5, 0.09, '#d3cfaf', turret);
    hatch.position.set(-0.08, 0.51, -0.12);
    const gun = new TransformNode('gun-elevation', kit.scene);
    gun.parent = turret;
    gun.position.y = 0.22;
    const barrel = kit.cylinder('barrel', 0.18, 0.26, 1.65, color, gun);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, 1.13);
    const muzzle = kit.cylinder('muzzle', 0.28, 0.28, 0.25, '#465a4e', gun);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0, 1.94);
    const warning = MeshBuilder.CreateSphere('aim-warning', { diameter: 0.42, segments: 4 }, kit.scene);
    warning.parent = gun;
    warning.position.set(0, 0, 2.12);
    warning.material = kit.material('#ffe6a0', true);
    warning.setEnabled(false);
    const stripe = kit.box('stripe', 0.13, 0.018, 0.6, '#f2e5c8', chassis);
    stripe.position.set(0.45, 0.973, -0.55);
    const antenna = kit.cylinder('antenna', 0.025, 0.035, 0.75, '#4b594c', turret);
    antenna.position.set(0.4, 0.85, -0.4);
    const shield = MeshBuilder.CreateTorus('shield', { diameter: 2.75, thickness: 0.07, tessellation: 24 }, kit.scene);
    shield.material = kit.material('#b1e5d4', true);
    shield.parent = root;
    shield.position.y = 0.11;
    root.scaling.setAll(t.team === 'player' ? VEHICLES[t.kind].scale : t.kind === 'heavy' ? 1.12 : 1);
    if (t.team === 'player' && t.kind === 'scout') {
      body.scaling.y = 0.85;
      top.scaling.set(0.85, 0.8, 0.9);
      const rack = kit.box('scout-stowage', 0.7, 0.25, 0.45, '#b8bba0', chassis);
      rack.position.set(0, 0.99, -0.9);
      const aerial = kit.cylinder('scout-aerial', 0.02, 0.025, 1.1, '#4b594c', turret);
      aerial.position.set(-0.45, 1, -0.35);
    }
    if (t.team === 'player' && t.kind === 'heavy') {
      const armor = kit.box('heavy-front-armor', 1.7, 0.48, 0.32, '#466a62', chassis);
      armor.position.set(0, 0.61, 1.01); armor.rotation.x = -0.22;
      top.scaling.set(1.08, 1.2, 1.05);
      barrel.scaling.x = barrel.scaling.z = 1.4;
      muzzle.scaling.x = muzzle.scaling.z = 1.3;
      for (const side of [-1, 1]) {
        const plate = kit.box('heavy-track-armor', 0.15, 0.44, 1.9, color, chassis);
        plate.position.set(side * 1.16, 0.52, 0);
        const hatch = kit.box('heavy-spare-track', 0.35, 0.15, 0.8, '#626e5d', chassis);
        hatch.position.set(side * 0.5, 1.01, -0.7);
      }
    }
    if (t.team === 'player' && t.kind === 'engineer') {
      top.scaling.set(0.84, 0.9, 0.9);
      for (const side of [-1, 1]) {
        const toolbox = kit.box('engineer-toolbox', 0.38, 0.38, 0.85, '#c6b580', chassis);
        toolbox.position.set(side * 0.7, 1.04, -0.63);
      }
      const crane = kit.box('engineer-crane', 0.13, 1.3, 0.13, '#e1ca91', chassis);
      crane.position.set(-0.48, 1.33, -0.95); crane.rotation.x = -0.35;
      const beam = kit.box('engineer-boom', 0.13, 0.13, 0.85, '#e1ca91', chassis);
      beam.position.set(-0.48, 1.94, -0.69);
      const cross = kit.box('engineer-repair-mark', 0.5, 0.035, 0.13, '#edf0d8', turret);
      cross.position.set(0, 0.57, 0.05);
      const stem = kit.box('engineer-repair-mark', 0.13, 0.035, 0.5, '#edf0d8', turret);
      stem.position.copyFrom(cross.position);
    }
    const glow = MeshBuilder.CreateIcoSphere('charge-glow', { radius: 0.32, subdivisions: 1, flat: true }, kit.scene);
    glow.parent = gun; glow.position.z = 2.05; glow.material = kit.material('#ffe8ab', true); glow.setEnabled(false);
    return { kind: t.kind, color: t.color, root, chassis, gun, turret, barrel, body, shield, warning, glow, wheels, speed: 0, slopePitch: 0, slopeRoll: 0, trailAt: 0 };
}

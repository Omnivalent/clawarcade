import Phaser from 'phaser';
import decorConfig from '../config/decor.json';
import nodesConfig from '../config/nodes.json';
import { gameEvents, inventory } from '../core/GameState';
import * as SaveManager from '../core/SaveManager';
import { effectiveUIMode, getUIModeSetting, setUIModeSetting, type UIMode } from '../core/device';
import { shareSnapshot } from '../core/share';
import type { BuildItem, DailyBoost, DecorDef, EvolutionEvent, NodeTypeDef } from '../types';

/**
 * UIScene — the HUD, layered on top of WorldScene (Build Pass 2).
 *
 * Responsive: the whole HUD is built by `rebuild()` using a scale factor `s`
 * (1.0 desktop, 1.5 phone — bigger tap targets), on top of Phaser's Scale.FIT
 * canvas. Switching modes in ⚙ settings rebuilds instantly.
 *
 * New in this pass:
 *  - Guide panel: the big tutorial prompt during the 90-second onboarding.
 *  - Daily banner: "Today's Resonance: X evolves faster."
 *  - Evolution celebration modal: before → after, COMMON/✨RARE✨ tag, and a
 *    Share button (canvas screenshot → native share sheet or download).
 *    The modal is drawn INSIDE the canvas so the screenshot captures it.
 *  - Selected-creature panel now shows the creature's TWO branch affinity
 *    bars — the player-steering readout of the fused system.
 */

const W = 1280;
const H = 720;

/** Snapshot of the selected creature, as sent by WorldScene. */
interface SelectionInfo {
  name: string;
  speciesName: string;
  flavor: string;
  stage: number;
  state: string;
  formName: string | null;
  formRare: boolean;
  branches: {
    id: string;
    name: string;
    color: string;
    value: number;
    threshold: number;
    boosted: boolean;
  }[];
}

export class UIScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private s = 1;

  private resourceTexts: Record<string, Phaser.GameObjects.Text> = {};
  private buildPanel: Phaser.GameObjects.Container | null = null;
  private settingsPanel: Phaser.GameObjects.Container | null = null;
  private infoPanel: Phaser.GameObjects.Container | null = null;
  private infoTitle!: Phaser.GameObjects.Text;
  private infoState!: Phaser.GameObjects.Text;
  private counterBars!: Phaser.GameObjects.Graphics;
  private barLabels: Phaser.GameObjects.Text[] = [];
  private lastSelection: SelectionInfo | null = null;
  private buildItems: BuildItem[] = [];
  private activeBuildId: string | null = null;
  private toastText!: Phaser.GameObjects.Text;
  private toastTimer: Phaser.Time.TimerEvent | null = null;
  private guidePanel: Phaser.GameObjects.Container | null = null;
  private guideText: string | null = null;
  private modal: Phaser.GameObjects.Container | null = null;
  private resetArmed = false;

  constructor() {
    super('UIScene');
  }

  create(): void {
    this.collectBuildItems();
    // The WorldScene is created first — pick up any guide prompt (onboarding
    // step 1) that fired before our listeners existed.
    this.guideText = (this.registry.get('wk-guide-text') as string | null) ?? null;
    this.rebuild();

    // --- Event bus wiring (cleaned up on shutdown) ---
    const onInventory = () => this.refreshResources();
    const onSelected = (info: SelectionInfo | null) => this.showSelection(info);
    const onSelectedUpdate = (info: SelectionInfo) => this.showSelection(info);
    const onToast = (msg: string) => this.toast(msg);
    const onGuide = (msg: string | null) => this.showGuide(msg);
    const onModal = (ev: EvolutionEvent) => this.showEvolutionModal(ev);
    const onOnboardingChanged = () => this.rebuild();

    gameEvents.on('wk-inventory', onInventory);
    gameEvents.on('wk-selected', onSelected);
    gameEvents.on('wk-selected-update', onSelectedUpdate);
    gameEvents.on('wk-toast', onToast);
    gameEvents.on('wk-guide', onGuide);
    gameEvents.on('wk-evolution-modal', onModal);
    gameEvents.on('wk-onboarding-changed', onOnboardingChanged);

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameEvents.off('wk-inventory', onInventory);
      gameEvents.off('wk-selected', onSelected);
      gameEvents.off('wk-selected-update', onSelectedUpdate);
      gameEvents.off('wk-toast', onToast);
      gameEvents.off('wk-guide', onGuide);
      gameEvents.off('wk-evolution-modal', onModal);
      gameEvents.off('wk-onboarding-changed', onOnboardingChanged);
    });
  }

  private onboardingActive(): boolean {
    return !!this.registry.get('wk-onboarding');
  }

  // ==========================================================================
  // Build the whole HUD for the current UI mode
  // ==========================================================================

  private rebuild(): void {
    if (this.root) this.root.destroy(true);
    this.s = effectiveUIMode() === 'phone' ? 1.5 : 1;
    this.root = this.add.container(0, 0);
    this.buildPanel = null;
    this.settingsPanel = null;
    this.guidePanel = null;
    this.barLabels = [];
    this.activeBuildId = null;

    this.buildResourceBar();
    this.buildDailyBanner();
    if (!this.onboardingActive()) this.buildTopRightButtons();
    this.buildInfoPanel();
    this.buildToast();
    this.buildHelpHint();

    this.refreshResources();
    this.showSelection(this.lastSelection);
    this.showGuide(this.guideText);
  }

  // --- Top-left: live resource counters --------------------------------------
  private buildResourceBar(): void {
    const s = this.s;
    const pad = 10 * s;
    const itemW = 108 * s;
    const barW = nodesConfig.resources.length * itemW + pad;
    const barH = 44 * s;

    this.panelBg(12, 12, barW, barH);
    this.resourceTexts = {};
    nodesConfig.resources.forEach((res, i) => {
      const x = 12 + pad + i * itemW;
      const icon = this.add
        .text(x, 12 + barH / 2, res.icon, { fontSize: `${20 * s}px` })
        .setOrigin(0, 0.5);
      const count = this.add
        .text(x + 30 * s, 12 + barH / 2, '0', {
          fontSize: `${19 * s}px`,
          fontFamily: 'Segoe UI, sans-serif',
          fontStyle: 'bold',
          color: res.color,
        })
        .setOrigin(0, 0.5);
      this.root.add([icon, count]);
      this.resourceTexts[res.id] = count;
    });
  }

  private refreshResources(): void {
    for (const res of nodesConfig.resources) {
      this.resourceTexts[res.id]?.setText(String(Math.floor(inventory[res.id] ?? 0)));
    }
  }

  // --- Daily banner: today's boosted branch -----------------------------------
  private buildDailyBanner(): void {
    const daily = this.registry.get('wk-daily') as DailyBoost | undefined;
    if (!daily) return;
    const s = this.s;
    const banner = this.add
      .text(12, 12 + 44 * s + 8, daily.bannerText, {
        fontSize: `${12 * s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        color: '#ffd166',
        backgroundColor: '#13242bee',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0, 0);
    this.root.add(banner);
  }

  // --- Guide panel: the onboarding's big prompt --------------------------------
  private showGuide(msg: string | null): void {
    this.guideText = msg;
    this.guidePanel?.destroy(true);
    this.guidePanel = null;
    if (!msg) return;

    const s = this.s;
    this.guidePanel = this.add.container(0, 0);
    this.root.add(this.guidePanel);

    const text = this.add
      .text(W / 2, 96 * s, msg, {
        fontSize: `${20 * s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        fontStyle: 'bold',
        color: '#0a1418',
        backgroundColor: '#9fd8c8',
        padding: { x: 20, y: 12 },
        align: 'center',
        wordWrap: { width: 640 * s },
      })
      .setOrigin(0.5, 0);
    this.guidePanel.add(text);
    // Gentle pulse so the prompt reads as "do this now".
    this.tweens.add({
      targets: text,
      scale: { from: 1, to: 1.04 },
      duration: 650,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // --- Top-right: Build + Settings buttons (hidden during onboarding) ----------
  private buildTopRightButtons(): void {
    const s = this.s;
    const bw = 110 * s;
    const bh = 44 * s;
    this.makeButton(W - 12 - bw - 10 * s - bh, 12, bw, bh, '🔨 Build', () => this.toggleBuildPanel());
    this.makeButton(W - 12 - bh, 12, bh, bh, '⚙', () => this.toggleSettingsPanel());
  }

  // --- Build menu ----------------------------------------------------------------
  private collectBuildItems(): void {
    this.buildItems = [];
    for (const [id, def] of Object.entries(decorConfig.items as Record<string, DecorDef>)) {
      this.buildItems.push({ kind: 'decor', id, name: def.name, cost: def.cost, color: def.color });
    }
    for (const [id, def] of Object.entries(nodesConfig.nodeTypes as Record<string, NodeTypeDef>)) {
      if (def.buildable) {
        this.buildItems.push({ kind: 'node', id, name: def.name, cost: def.cost, color: def.color });
      }
    }
  }

  private costLabel(cost: Record<string, number>): string {
    const parts = Object.entries(cost).map(([id, amt]) => {
      const res = nodesConfig.resources.find((r) => r.id === id);
      return `${amt}${res?.icon ?? id}`;
    });
    return parts.length ? parts.join('  ') : 'free';
  }

  /** Which branch a decor steers, e.g. "→ Magmaton" — shown in the build menu so steering is legible. */
  private decorBranchLabel(id: string): string {
    const def = (decorConfig.items as Record<string, DecorDef>)[id];
    return def?.branchId ? `→ steers ${def.branchId.charAt(0).toUpperCase()}${def.branchId.slice(1)}` : '';
  }

  private toggleBuildPanel(): void {
    this.closeSettingsPanel();
    if (this.buildPanel) {
      this.closeBuildPanel();
      return;
    }
    const s = this.s;
    const rowH = 50 * s;
    const panelW = 320 * s;
    const panelH = rowH * this.buildItems.length + 58 * s;
    const px = W - 12 - panelW;
    const py = 12 + 44 * s + 8;

    this.buildPanel = this.add.container(0, 0);
    this.root.add(this.buildPanel);
    this.panelBg(px, py, panelW, panelH, this.buildPanel);

    const title = this.add.text(px + 14 * s, py + 10 * s, 'Place in your sanctuary', {
      fontSize: `${15 * s}px`,
      fontFamily: 'Segoe UI, sans-serif',
      color: '#9fd8c8',
    });
    this.buildPanel.add(title);

    this.buildItems.forEach((item, i) => {
      const ry = py + 38 * s + i * rowH;
      const zone = this.add
        .zone(px + 6, ry, panelW - 12, rowH - 4)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });
      this.stopThrough(zone);
      zone.on('pointerup', (_p: unknown, _x: unknown, _y: unknown, ev: { stopPropagation(): void }) => {
        ev.stopPropagation();
        this.selectBuildItem(item);
      });

      const swatch = this.add
        .rectangle(px + 22 * s, ry + rowH / 2 - 2, 22 * s, 22 * s, Phaser.Display.Color.HexStringToColor(item.color).color)
        .setStrokeStyle(1.5, 0xffffff, 0.6);
      const name = this.add.text(px + 42 * s, ry + 6 * s, item.name, {
        fontSize: `${15 * s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        color: '#e8f6f0',
      });
      const sub =
        item.kind === 'decor'
          ? `${this.costLabel(item.cost)}   ${this.decorBranchLabel(item.id)}`
          : this.costLabel(item.cost);
      const cost = this.add.text(px + 42 * s, ry + 25 * s, sub, {
        fontSize: `${11.5 * s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        color: '#9ab8ae',
      });
      const hl = this.add
        .rectangle(px + 6, ry, panelW - 12, rowH - 4, 0x4fd8c4, 0.15)
        .setOrigin(0, 0)
        .setStrokeStyle(1.5, 0x4fd8c4, item.id === this.activeBuildId ? 0.9 : 0)
        .setFillStyle(0x4fd8c4, item.id === this.activeBuildId ? 0.15 : 0);
      hl.setData('buildId', item.id);
      this.buildPanel!.add([hl, zone, swatch, name, cost]);
    });

    this.makeButton(px + 14 * s, py + panelH - 46 * s, panelW - 28 * s, 36 * s, '✕ Close build mode', () => {
      this.closeBuildPanel();
    }, this.buildPanel);
  }

  private selectBuildItem(item: BuildItem): void {
    this.activeBuildId = this.activeBuildId === item.id ? null : item.id;
    gameEvents.emit('wk-build-changed', this.activeBuildId ? item : null);
    this.buildPanel?.each((obj: Phaser.GameObjects.GameObject) => {
      if (obj instanceof Phaser.GameObjects.Rectangle && obj.getData('buildId')) {
        const on = obj.getData('buildId') === this.activeBuildId;
        obj.setStrokeStyle(1.5, 0x4fd8c4, on ? 0.9 : 0);
        obj.setFillStyle(0x4fd8c4, on ? 0.15 : 0);
      }
    });
    if (this.activeBuildId) {
      this.toast(`Tap open ground to place ${item.name} (${this.costLabel(item.cost)})`);
    }
  }

  private closeBuildPanel(): void {
    this.buildPanel?.destroy(true);
    this.buildPanel = null;
    this.activeBuildId = null;
    gameEvents.emit('wk-build-changed', null);
  }

  // --- Settings ------------------------------------------------------------------
  private toggleSettingsPanel(): void {
    this.closeBuildPanel();
    if (this.settingsPanel) {
      this.closeSettingsPanel();
      return;
    }
    const s = this.s;
    const pw = 340 * s;
    const ph = 250 * s;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;

    this.settingsPanel = this.add.container(0, 0);
    this.root.add(this.settingsPanel);
    this.panelBg(px, py, pw, ph, this.settingsPanel);

    const title = this.add.text(px + 16 * s, py + 12 * s, 'Settings', {
      fontSize: `${18 * s}px`,
      fontFamily: 'Segoe UI, sans-serif',
      fontStyle: 'bold',
      color: '#e8f6f0',
    });
    const world = this.registry.get('wk-world') as { name: string; seed: number } | undefined;
    const landLine = this.add.text(
      px + 16 * s,
      py + 36 * s,
      world ? `Land: ${world.name} · seed ${world.seed}` : '',
      {
        fontSize: `${11.5 * s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        color: '#7fa89b',
      },
    );
    const label = this.add.text(px + 16 * s, py + 56 * s, 'Interface mode', {
      fontSize: `${13 * s}px`,
      fontFamily: 'Segoe UI, sans-serif',
      color: '#9ab8ae',
    });
    this.settingsPanel.add([title, landLine, label]);

    const modes: { key: UIMode; label: string }[] = [
      { key: 'auto', label: 'Auto' },
      { key: 'desktop', label: 'Desktop' },
      { key: 'phone', label: 'Phone' },
    ];
    const bw = (pw - 32 * s - 16 * s) / 3;
    modes.forEach((m, i) => {
      const active = getUIModeSetting() === m.key;
      this.makeButton(
        px + 16 * s + i * (bw + 8 * s),
        py + 80 * s,
        bw,
        40 * s,
        m.label,
        () => {
          setUIModeSetting(m.key);
          gameEvents.emit('wk-ui-mode-changed', m.key);
          this.rebuild();
        },
        this.settingsPanel!,
        active,
      );
    });

    this.resetArmed = false;
    this.makeButton(px + 16 * s, py + 136 * s, pw - 32 * s, 40 * s, '🗑 Reset — start a new land', () => {
      if (!this.resetArmed) {
        this.resetArmed = true;
        this.toast('Tap again to erase this sanctuary and travel to a new land');
        return;
      }
      SaveManager.clear(); // note: the onboarding flag survives on purpose
      window.location.href = window.location.pathname;
    }, this.settingsPanel);

    this.makeButton(px + 16 * s, py + ph - 52 * s, pw - 32 * s, 38 * s, 'Close', () =>
      this.closeSettingsPanel(),
    this.settingsPanel);
  }

  private closeSettingsPanel(): void {
    this.settingsPanel?.destroy(true);
    this.settingsPanel = null;
  }

  // --- Bottom-left: selected creature + its two branch affinity bars ------------
  private buildInfoPanel(): void {
    const s = this.s;
    const pw = 340 * s;
    const ph = 150 * s;
    const px = 12;
    const py = H - 12 - ph;

    this.infoPanel = this.add.container(0, 0).setVisible(false);
    this.root.add(this.infoPanel);
    this.panelBg(px, py, pw, ph, this.infoPanel);

    this.infoTitle = this.add.text(px + 14 * s, py + 10 * s, '', {
      fontSize: `${16 * s}px`,
      fontFamily: 'Segoe UI, sans-serif',
      fontStyle: 'bold',
      color: '#e8f6f0',
    });
    this.infoState = this.add.text(px + 14 * s, py + 32 * s, '', {
      fontSize: `${12 * s}px`,
      fontFamily: 'Segoe UI, sans-serif',
      color: '#9ab8ae',
    });
    this.counterBars = this.add.graphics();
    const hint = this.add.text(
      px + 14 * s,
      py + ph - 24 * s,
      'Work near a decor to fill its branch — decor placement decides the evolution',
      {
        fontSize: `${10 * s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        color: '#6f8d83',
      },
    );
    this.infoPanel.add([this.infoTitle, this.infoState, this.counterBars, hint]);
  }

  private showSelection(info: SelectionInfo | null): void {
    this.lastSelection = info;
    if (!this.infoPanel) return;
    if (!info) {
      this.infoPanel.setVisible(false);
      return;
    }
    this.infoPanel.setVisible(true);

    const stateLabels: Record<string, string> = {
      idle: 'resting',
      wandering: 'wandering',
      toJob: 'walking to work',
      toTile: 'walking',
      working: 'working hard',
    };

    const s = this.s;
    const px = 12 + 14 * s;
    const py = H - 12 - 150 * s + 56 * s;
    const barW = 326 * s - 130 * s;

    this.counterBars.clear();

    if (info.stage >= 2) {
      // Evolved: show the form instead of progress bars.
      this.infoTitle.setText(`${info.name} — ${info.formName}${info.formRare ? ' ✨' : ''}`);
      this.infoState.setText(
        `${info.formRare ? 'RARE form · ' : ''}evolved from ${info.speciesName} · ${stateLabels[info.state] ?? info.state}`,
      );
      this.getBarLabel(0).setPosition(px, py + 6 * s).setText(info.formRare ? '✨ A rare variant — one in seven!' : 'Fully evolved');
      this.getBarLabel(1).setText('');
      return;
    }

    this.infoTitle.setText(`${info.name} — ${info.speciesName}`);
    this.infoState.setText(stateLabels[info.state] ?? info.state);

    // The two branch bars: affinity progress toward each possible evolution.
    info.branches.forEach((br, i) => {
      const y = py + i * 28 * s;
      const frac = Math.min(1, br.value / br.threshold);
      const color = Phaser.Display.Color.HexStringToColor(br.color).color;
      this.counterBars.fillStyle(0x0a1418, 0.8);
      this.counterBars.fillRoundedRect(px + 118 * s, y + 3 * s, barW, 12 * s, 4 * s);
      if (frac > 0) {
        this.counterBars.fillStyle(color, 1);
        this.counterBars.fillRoundedRect(px + 118 * s, y + 3 * s, Math.max(8, barW * frac), 12 * s, 4 * s);
      }
      const boostTag = br.boosted ? ' ⚡' : '';
      this.getBarLabel(i)
        .setPosition(px, y)
        .setText(`${br.name}${boostTag} ${Math.floor(br.value)}/${br.threshold}`);
    });
  }

  private getBarLabel(i: number): Phaser.GameObjects.Text {
    if (!this.barLabels[i] || !this.barLabels[i].active) {
      this.barLabels[i] = this.add.text(0, 0, '', {
        fontSize: `${11 * this.s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        color: '#cdeee2',
      });
      this.infoPanel?.add(this.barLabels[i]);
    }
    return this.barLabels[i];
  }

  // --- Evolution celebration modal ------------------------------------------------
  private showEvolutionModal(ev: EvolutionEvent): void {
    this.modal?.destroy(true);
    const s = this.s;
    this.modal = this.add.container(0, 0).setDepth(1000);
    this.root.add(this.modal);

    // Full-screen dim + input blocker.
    const dim = this.add.rectangle(0, 0, W, H, 0x05080a, 0.72).setOrigin(0, 0);
    const blocker = this.add.zone(0, 0, W, H).setOrigin(0, 0).setInteractive();
    this.stopThrough(blocker);
    this.modal.add([dim, blocker]);

    const pw = 520 * s;
    const ph = 330 * s;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;

    // Panel — gold-framed for rares.
    const g = this.add.graphics();
    g.fillStyle(0x13242b, 0.97);
    g.lineStyle(ev.isRare ? 4 : 2, ev.isRare ? 0xffd166 : 0x3f7a68, 1);
    g.fillRoundedRect(px, py, pw, ph, 14);
    g.strokeRoundedRect(px, py, pw, ph, 14);
    this.modal.add(g);

    const title = this.add
      .text(W / 2, py + 22 * s, 'EVOLUTION!', {
        fontSize: `${26 * s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        fontStyle: 'bold',
        color: '#e8f6f0',
      })
      .setOrigin(0.5, 0);
    // COMMON / ✨RARE✨ tag.
    const tag = this.add
      .text(W / 2, py + 56 * s, ev.isRare ? '✨ RARE ✨' : 'COMMON', {
        fontSize: `${15 * s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        fontStyle: 'bold',
        color: ev.isRare ? '#ffd166' : '#9ab8ae',
      })
      .setOrigin(0.5, 0);
    this.modal.add([title, tag]);

    // Before → after, side by side.
    const cy = py + 160 * s;
    const before = this.add.image(W / 2 - 130 * s, cy, `cr-${ev.baseSpeciesId}`).setScale(2 * s * 0.9);
    const arrow = this.add
      .text(W / 2, cy, '→', { fontSize: `${34 * s}px`, color: '#9fd8c8' })
      .setOrigin(0.5);
    const after = this.add.image(W / 2 + 130 * s, cy, `cr-form-${ev.form.id}`).setScale(2 * s);
    this.tweens.add({
      targets: after,
      scale: { from: 2 * s * 0.7, to: 2 * s },
      duration: 700,
      ease: 'Back.easeOut',
    });
    const beforeName = this.add
      .text(W / 2 - 130 * s, cy + 52 * s, ev.baseSpeciesName, {
        fontSize: `${12 * s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        color: '#9ab8ae',
      })
      .setOrigin(0.5, 0);
    const afterName = this.add
      .text(W / 2 + 130 * s, cy + 52 * s, ev.form.name, {
        fontSize: `${14 * s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        fontStyle: 'bold',
        color: ev.isRare ? '#ffd166' : '#e8f6f0',
      })
      .setOrigin(0.5, 0);
    const line = this.add
      .text(W / 2, py + 232 * s, `${ev.creatureName} evolved into ${ev.form.name}!`, {
        fontSize: `${14 * s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        color: '#cdeee2',
      })
      .setOrigin(0.5, 0);
    this.modal.add([before, arrow, after, beforeName, afterName, line]);

    // Buttons: Share (canvas screenshot) + Continue.
    const bw = (pw - 48 * s) / 2;
    this.makeButton(px + 16 * s, py + ph - 56 * s, bw, 42 * s, '📸 Share', () => {
      shareSnapshot(this.game, `wildkin-${ev.form.id}.png`);
      this.toast('Snapshot captured!');
    }, this.modal);
    this.makeButton(px + 32 * s + bw, py + ph - 56 * s, bw, 42 * s, 'Continue', () => {
      this.modal?.destroy(true);
      this.modal = null;
      gameEvents.emit('wk-modal-closed');
    }, this.modal);
  }

  // --- Toast ---------------------------------------------------------------------
  private buildToast(): void {
    this.toastText = this.add
      .text(W / 2, 52 * this.s, '', {
        fontSize: `${14 * this.s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        color: '#e8f6f0',
        backgroundColor: '#132b26ee',
        padding: { x: 14, y: 8 },
        align: 'center',
        wordWrap: { width: 560 * this.s },
      })
      .setOrigin(0.5, 0)
      .setVisible(false);
    this.root.add(this.toastText);
  }

  private toast(msg: string): void {
    this.toastText.setText(msg).setVisible(true).setAlpha(1);
    this.toastTimer?.remove();
    this.toastTimer = this.time.delayedCall(2800, () => {
      this.tweens.add({ targets: this.toastText, alpha: 0, duration: 400 });
    });
  }

  // --- Bottom-right controls hint ---------------------------------------------------
  private buildHelpHint(): void {
    const phone = effectiveUIMode() === 'phone';
    const msg = phone
      ? 'Drag to pan · Pinch to zoom · Tap to select'
      : 'Drag to pan · Scroll to zoom · Click to select';
    const hint = this.add
      .text(W - 12, H - 10, msg, {
        fontSize: `${11 * this.s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        color: '#5e7d73',
      })
      .setOrigin(1, 1);
    this.root.add(hint);
  }

  // ==========================================================================
  // Small UI helpers
  // ==========================================================================

  private panelBg(
    x: number,
    y: number,
    w: number,
    h: number,
    parent?: Phaser.GameObjects.Container,
  ): void {
    const g = this.add.graphics();
    g.fillStyle(0x13242b, 0.92);
    g.lineStyle(1.5, 0x3f7a68, 0.8);
    g.fillRoundedRect(x, y, w, h, 10);
    g.strokeRoundedRect(x, y, w, h, 10);
    const blocker = this.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive();
    this.stopThrough(blocker);
    (parent ?? this.root).add([g, blocker]);
  }

  private makeButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    onClick: () => void,
    parent?: Phaser.GameObjects.Container,
    active = false,
  ): void {
    const g = this.add.graphics();
    g.fillStyle(active ? 0x2e5c50 : 0x1d3a33, 1);
    g.lineStyle(1.5, active ? 0x7fe3c8 : 0x3f7a68, 1);
    g.fillRoundedRect(x, y, w, h, 8);
    g.strokeRoundedRect(x, y, w, h, 8);
    const t = this.add
      .text(x + w / 2, y + h / 2, label, {
        fontSize: `${15 * this.s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        color: active ? '#d9fff3' : '#cdeee2',
      })
      .setOrigin(0.5);
    const zone = this.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    this.stopThrough(zone);
    zone.on('pointerup', (_p: unknown, _x: unknown, _y: unknown, ev: { stopPropagation(): void }) => {
      ev.stopPropagation();
      onClick();
    });
    (parent ?? this.root).add([g, t, zone]);
  }

  /** Stop pointer events on a UI element from reaching the WorldScene below. */
  private stopThrough(zone: Phaser.GameObjects.Zone): void {
    zone.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: { stopPropagation(): void }) => {
      ev.stopPropagation();
    });
    zone.on('pointermove', (_p: unknown, _x: unknown, _y: unknown, ev: { stopPropagation(): void }) => {
      ev.stopPropagation();
    });
  }
}

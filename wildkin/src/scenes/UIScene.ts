import Phaser from 'phaser';
import decorConfig from '../config/decor.json';
import evolutionConfig from '../config/evolution.json';
import nodesConfig from '../config/nodes.json';
import { gameEvents, inventory } from '../core/GameState';
import * as SaveManager from '../core/SaveManager';
import { effectiveUIMode, getUIModeSetting, setUIModeSetting, type UIMode } from '../core/device';
import type { ActivityCounters, BuildItem, DecorDef, EvolutionBranchDef, NodeTypeDef } from '../types';

/**
 * UIScene — the HUD, layered on top of WorldScene.
 *
 * Responsive design: the whole HUD is built by `rebuild()` using a scale
 * factor `s` — 1.0 in desktop mode, 1.5 in phone mode (bigger tap targets).
 * The canvas itself is scaled by Phaser's Scale.FIT, so on a phone the HUD
 * ends up both physically reachable and readable. Switching modes in the ⚙
 * settings panel tears the HUD down and rebuilds it instantly.
 *
 * The HUD never reaches into WorldScene. Everything flows over the
 * `gameEvents` bus: inventory updates, selection info, toasts. The only thing
 * the HUD "sends" is the current Build-menu selection ('wk-build-changed').
 */

const W = 1280; // logical canvas size (see main.ts scale config)
const H = 720;

/** Snapshot of the selected creature, as sent by WorldScene. */
interface SelectionInfo {
  name: string;
  speciesName: string;
  flavor: string;
  stage: number;
  branchName: string | null;
  state: string;
  counters: ActivityCounters;
  threshold: number;
}

export class UIScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private s = 1; // UI scale factor for the current mode

  // Live-updating pieces
  private resourceTexts: Record<string, Phaser.GameObjects.Text> = {};
  private buildPanel: Phaser.GameObjects.Container | null = null;
  private settingsPanel: Phaser.GameObjects.Container | null = null;
  private infoPanel: Phaser.GameObjects.Container | null = null;
  private infoTitle!: Phaser.GameObjects.Text;
  private infoState!: Phaser.GameObjects.Text;
  private counterBars!: Phaser.GameObjects.Graphics;
  private lastSelection: SelectionInfo | null = null;
  private buildItems: BuildItem[] = [];
  private activeBuildId: string | null = null;
  private toastText!: Phaser.GameObjects.Text;
  private toastTimer: Phaser.Time.TimerEvent | null = null;
  private resetArmed = false;

  constructor() {
    super('UIScene');
  }

  create(): void {
    this.collectBuildItems();
    this.rebuild();

    // --- Event bus wiring (and cleanup on shutdown) ---
    const onInventory = () => this.refreshResources();
    const onSelected = (info: SelectionInfo | null) => this.showSelection(info);
    const onSelectedUpdate = (info: SelectionInfo) => this.showSelection(info);
    const onToast = (msg: string) => this.toast(msg);
    const onEvolved = (e: { name: string; formName: string; description: string }) =>
      this.toast(`✨ ${e.name} evolved into ${e.formName}! ${e.description}`);

    gameEvents.on('wk-inventory', onInventory);
    gameEvents.on('wk-selected', onSelected);
    gameEvents.on('wk-selected-update', onSelectedUpdate);
    gameEvents.on('wk-toast', onToast);
    gameEvents.on('wk-evolved', onEvolved);

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameEvents.off('wk-inventory', onInventory);
      gameEvents.off('wk-selected', onSelected);
      gameEvents.off('wk-selected-update', onSelectedUpdate);
      gameEvents.off('wk-toast', onToast);
      gameEvents.off('wk-evolved', onEvolved);
    });
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
    this.activeBuildId = null;
    gameEvents.emit('wk-build-changed', null);

    this.buildResourceBar();
    this.buildTopRightButtons();
    this.buildInfoPanel();
    this.buildToast();
    this.buildHelpHint();

    this.refreshResources();
    this.showSelection(this.lastSelection);
  }

  // --- Top-left: live resource counters (wood / stone / herbs) --------------
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

  // --- Top-right: Build + Settings buttons ----------------------------------
  private buildTopRightButtons(): void {
    const s = this.s;
    const bw = 110 * s;
    const bh = 44 * s;
    this.makeButton(W - 12 - bw - 10 * s - bh, 12, bw, bh, '🔨 Build', () => this.toggleBuildPanel());
    this.makeButton(W - 12 - bh, 12, bh, bh, '⚙', () => this.toggleSettingsPanel());
  }

  // --- Build menu: pick decor / nodes to place ------------------------------
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

  /** Turn a cost record into a compact icon string, e.g. "5🪨 2🌿". */
  private costLabel(cost: Record<string, number>): string {
    return Object.entries(cost)
      .map(([id, amt]) => {
        const res = nodesConfig.resources.find((r) => r.id === id);
        return `${amt}${res?.icon ?? id}`;
      })
      .join('  ');
  }

  private toggleBuildPanel(): void {
    this.closeSettingsPanel();
    if (this.buildPanel) {
      this.closeBuildPanel();
      return;
    }
    const s = this.s;
    const rowH = 50 * s;
    const panelW = 300 * s;
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
      const cost = this.add.text(px + 42 * s, ry + 25 * s, this.costLabel(item.cost), {
        fontSize: `${12 * s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        color: '#9ab8ae',
      });
      // Highlight rectangle shown when this item is the active pick.
      const hl = this.add
        .rectangle(px + 6, ry, panelW - 12, rowH - 4, 0x4fd8c4, 0.15)
        .setOrigin(0, 0)
        .setStrokeStyle(1.5, 0x4fd8c4, item.id === this.activeBuildId ? 0.9 : 0)
        .setFillStyle(0x4fd8c4, item.id === this.activeBuildId ? 0.15 : 0);
      hl.setData('buildId', item.id);
      this.buildPanel!.add([hl, zone, swatch, name, cost]);
    });

    // ✕ exits build mode entirely.
    this.makeButton(px + 14 * s, py + panelH - 46 * s, panelW - 28 * s, 36 * s, '✕ Close build mode', () => {
      this.closeBuildPanel();
    }, this.buildPanel);
  }

  private selectBuildItem(item: BuildItem): void {
    this.activeBuildId = this.activeBuildId === item.id ? null : item.id;
    gameEvents.emit('wk-build-changed', this.activeBuildId ? item : null);
    // Update highlight rectangles in place.
    this.buildPanel?.each((obj: Phaser.GameObjects.GameObject) => {
      if (obj instanceof Phaser.GameObjects.Rectangle && obj.getData('buildId')) {
        const on = obj.getData('buildId') === this.activeBuildId;
        obj.setStrokeStyle(1.5, 0x4fd8c4, on ? 0.9 : 0);
        obj.setFillStyle(0x4fd8c4, on ? 0.15 : 0);
      }
    });
    if (this.activeBuildId) {
      this.toast(`Tap a grass or dirt tile to place ${item.name} (${this.costLabel(item.cost)})`);
    }
  }

  private closeBuildPanel(): void {
    this.buildPanel?.destroy(true);
    this.buildPanel = null;
    this.activeBuildId = null;
    gameEvents.emit('wk-build-changed', null);
  }

  // --- Settings: UI mode toggle + reset -------------------------------------
  private toggleSettingsPanel(): void {
    this.closeBuildPanel();
    if (this.settingsPanel) {
      this.closeSettingsPanel();
      return;
    }
    const s = this.s;
    const pw = 340 * s;
    const ph = 240 * s;
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
    const label = this.add.text(px + 16 * s, py + 46 * s, 'Interface mode', {
      fontSize: `${13 * s}px`,
      fontFamily: 'Segoe UI, sans-serif',
      color: '#9ab8ae',
    });
    this.settingsPanel.add([title, label]);

    // Auto / Desktop / Phone selector. Rebuilds the HUD immediately.
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
        py + 70 * s,
        bw,
        40 * s,
        m.label,
        () => {
          setUIModeSetting(m.key);
          gameEvents.emit('wk-ui-mode-changed', m.key);
          this.rebuild(); // apply new scale instantly
        },
        this.settingsPanel!,
        active,
      );
    });

    // Reset needs two taps so nobody wipes their sanctuary by accident.
    this.resetArmed = false;
    this.makeButton(px + 16 * s, py + 128 * s, pw - 32 * s, 40 * s, '🗑 Reset sanctuary', () => {
      if (!this.resetArmed) {
        this.resetArmed = true;
        this.toast('Tap "Reset sanctuary" again to erase your save');
        return;
      }
      SaveManager.clear();
      window.location.reload();
    }, this.settingsPanel);

    this.makeButton(px + 16 * s, py + ph - 52 * s, pw - 32 * s, 38 * s, 'Close', () =>
      this.closeSettingsPanel(),
    this.settingsPanel);
  }

  private closeSettingsPanel(): void {
    this.settingsPanel?.destroy(true);
    this.settingsPanel = null;
  }

  // --- Bottom-left: selected creature info + evolution progress -------------
  private buildInfoPanel(): void {
    const s = this.s;
    const pw = 330 * s;
    const ph = 168 * s;
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
    const hint = this.add.text(px + 14 * s, py + ph - 24 * s, 'Tap a tree/rock/flower to assign work · tap ground to move', {
      fontSize: `${10.5 * s}px`,
      fontFamily: 'Segoe UI, sans-serif',
      color: '#6f8d83',
    });
    this.infoPanel.add([this.infoTitle, this.infoState, this.counterBars, hint]);
  }

  /** Fill the info panel from a selection snapshot (or hide it). */
  private showSelection(info: SelectionInfo | null): void {
    this.lastSelection = info;
    if (!this.infoPanel) return;
    if (!info) {
      this.infoPanel.setVisible(false);
      return;
    }
    this.infoPanel.setVisible(true);

    const form = info.branchName ? ` · ${info.branchName}` : '';
    this.infoTitle.setText(`${info.name} — ${info.speciesName} (stage ${info.stage}${form})`);
    const stateLabels: Record<string, string> = {
      idle: 'resting',
      wandering: 'wandering',
      toJob: 'walking to work',
      toTile: 'walking',
      working: 'working hard',
    };
    this.infoState.setText(stateLabels[info.state] ?? info.state);

    // Three progress bars toward evolution, colored to match the branch each
    // counter leads to (colors come straight from evolution.json).
    const s = this.s;
    const px = 12 + 14 * s;
    const py = H - 12 - 168 * s + 54 * s;
    const barW = 300 * s - 90 * s;
    const branches = evolutionConfig.branches as Record<string, EvolutionBranchDef>;
    const rows: { key: keyof ActivityCounters; label: string }[] = [
      { key: 'mining', label: 'Working' },
      { key: 'exploring', label: 'Exploring' },
      { key: 'sanctuary', label: 'Resting' },
    ];

    this.counterBars.clear();
    rows.forEach((row, i) => {
      const y = py + i * 26 * s;
      const val = info.counters[row.key];
      const frac = Math.min(1, val / info.threshold);
      const color = Phaser.Display.Color.HexStringToColor(branches[row.key].color).color;
      this.counterBars.fillStyle(0x0a1418, 0.8);
      this.counterBars.fillRoundedRect(px + 78 * s, y + 3 * s, barW, 12 * s, 4 * s);
      if (frac > 0) {
        this.counterBars.fillStyle(color, 1);
        this.counterBars.fillRoundedRect(px + 78 * s, y + 3 * s, Math.max(8, barW * frac), 12 * s, 4 * s);
      }
      // Labels are re-drawn as part of the graphics pass? No — text objects
      // can't live in Graphics, so we draw the label with bitmap-ish trick:
      // simplest is dedicated Text objects, but they'd need re-creating per
      // rebuild. We keep persistent ones instead:
      // Counters can be fractional (exploring gains 0.5/tile) — show whole numbers.
      this.getBarLabel(i).setPosition(px, y).setText(`${row.label} ${Math.floor(val)}/${info.threshold}`);
    });
  }

  /** Lazily-created, persistent labels for the three counter bars. */
  private barLabels: Phaser.GameObjects.Text[] = [];
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

  // --- Toast messages (top center) ------------------------------------------
  private buildToast(): void {
    this.toastText = this.add
      .text(W / 2, 68 * this.s, '', {
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

  // --- Bottom-right controls hint --------------------------------------------
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

  /** Rounded panel background + an input blocker so taps on panels never leak through to the world underneath. */
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

  /** A tap/click button with generous hit area. `active` renders it highlighted. */
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

  /**
   * Stop pointer events on a UI element from reaching the WorldScene below
   * (otherwise a tap on a button would also pan the camera / select tiles).
   */
  private stopThrough(zone: Phaser.GameObjects.Zone): void {
    zone.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: { stopPropagation(): void }) => {
      ev.stopPropagation();
    });
    zone.on('pointermove', (_p: unknown, _x: unknown, _y: unknown, ev: { stopPropagation(): void }) => {
      ev.stopPropagation();
    });
  }
}

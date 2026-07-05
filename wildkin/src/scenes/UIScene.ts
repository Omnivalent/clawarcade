import Phaser from 'phaser';
import creaturesConfig from '../config/creatures.json';
import decorConfig from '../config/decor.json';
import nodesConfig from '../config/nodes.json';
import { gameEvents, inventory } from '../core/GameState';
import * as SaveManager from '../core/SaveManager';
import * as Dex from '../core/dex';
import { effectiveUIMode, getUIModeSetting, setUIModeSetting, type UIMode } from '../core/device';
import { shareSnapshot } from '../core/share';
import type { BuildItem, DailyBoost, DecorDef, EvolutionEvent, NodeTypeDef, SpeciesDef } from '../types';

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
  cooldownSeconds: number;
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
  private dexPanel: Phaser.GameObjects.Container | null = null;
  private dexBtnLabel: Phaser.GameObjects.Text | null = null;
  private buildCapsLabel: Phaser.GameObjects.Text | null = null;
  private removeActive = false;
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
    const onDexChanged = () => this.refreshDexButton();
    const onCapsChanged = () => this.refreshCapsLabel();

    gameEvents.on('wk-dex-changed', onDexChanged);
    gameEvents.on('wk-caps-changed', onCapsChanged);
    gameEvents.on('wk-inventory', onInventory);
    gameEvents.on('wk-selected', onSelected);
    gameEvents.on('wk-selected-update', onSelectedUpdate);
    gameEvents.on('wk-toast', onToast);
    gameEvents.on('wk-guide', onGuide);
    gameEvents.on('wk-evolution-modal', onModal);
    gameEvents.on('wk-onboarding-changed', onOnboardingChanged);

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameEvents.off('wk-dex-changed', onDexChanged);
      gameEvents.off('wk-caps-changed', onCapsChanged);
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
    this.dexPanel = null;
    this.dexBtnLabel = null;
    this.buildCapsLabel = null;
    this.barLabels = [];
    this.activeBuildId = null;
    if (this.removeActive) {
      this.removeActive = false;
      gameEvents.emit('wk-remove-toggled', false);
    }

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

  // --- Top-right: Auras · Dex · Build · Settings (hidden during onboarding) ----
  private buildTopRightButtons(): void {
    const s = this.s;
    const bh = 44 * s;
    const gap = 8 * s;
    // Laid out right-to-left: ⚙, Build, Dex, 👁(aura toggle).
    let x = W - 12 - bh;
    this.makeButton(x, 12, bh, bh, '⚙', () => this.toggleSettingsPanel());
    x -= 110 * s + gap;
    this.makeButton(x, 12, 110 * s, bh, '🔨 Build', () => this.toggleBuildPanel());
    x -= 118 * s + gap;
    this.dexBtnLabel = this.makeButton(x, 12, 118 * s, bh, this.dexButtonText(), () => this.toggleDexPanel());
    x -= bh + gap;
    const aurasOn = this.registry.get('wk-show-auras') !== false;
    this.makeButton(x, 12, bh, bh, aurasOn ? '👁' : '🚫', () => {
      const on = this.registry.get('wk-show-auras') !== false;
      gameEvents.emit('wk-auras-toggled', !on);
      this.toast(!on ? 'Influence auras shown' : 'Influence auras hidden');
      this.rebuild(); // refresh the button glyph
    });
  }

  private dexButtonText(): string {
    return `📖 ${Dex.discoveredCount()}/${Dex.totalForms()}`;
  }

  private refreshDexButton(): void {
    this.dexBtnLabel?.setText(this.dexButtonText());
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
    // PASS 3 — summon a new wildkin (needed to chase the full dex).
    for (const [id, def] of Object.entries(creaturesConfig.species as Record<string, SpeciesDef>)) {
      this.buildItems.push({
        kind: 'creature',
        id,
        name: `Summon ${def.name}`,
        cost: def.summonCost,
        color: def.color,
      });
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
    this.closeDexPanel();
    if (this.buildPanel) {
      this.closeBuildPanel();
      return;
    }
    const s = this.s;
    // 2-column grid so 12 items + summons fit on a phone-scaled canvas too.
    const cols = 2;
    const rows = Math.ceil(this.buildItems.length / cols);
    const cellH = 46 * s;
    const cellW = 236 * s;
    const panelW = cols * cellW + 24 * s;
    const panelH = rows * cellH + 108 * s;
    const px = W - 12 - panelW;
    const py = 12 + 44 * s + 8;

    this.buildPanel = this.add.container(0, 0);
    this.root.add(this.buildPanel);
    this.panelBg(px, py, panelW, panelH, this.buildPanel);

    const title = this.add.text(px + 14 * s, py + 8 * s, 'Place in your sanctuary', {
      fontSize: `${15 * s}px`,
      fontFamily: 'Segoe UI, sans-serif',
      color: '#9fd8c8',
    });
    // Live cap counters — scarcity is always visible (PASS 3).
    this.buildCapsLabel = this.add.text(px + 14 * s, py + 28 * s, '', {
      fontSize: `${11 * s}px`,
      fontFamily: 'Segoe UI, sans-serif',
      color: '#9ab8ae',
    });
    this.buildPanel.add([title, this.buildCapsLabel]);
    this.refreshCapsLabel();

    this.buildItems.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const rx = px + 12 * s + col * cellW;
      const ry = py + 46 * s + row * cellH;

      const zone = this.add
        .zone(rx, ry, cellW - 6 * s, cellH - 4)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });
      this.stopThrough(zone);
      zone.on('pointerup', (_p: unknown, _x: unknown, _y: unknown, ev: { stopPropagation(): void }) => {
        ev.stopPropagation();
        this.selectBuildItem(item);
      });

      const swatch = this.add
        .rectangle(rx + 14 * s, ry + cellH / 2 - 2, 18 * s, 18 * s, Phaser.Display.Color.HexStringToColor(item.color).color)
        .setStrokeStyle(1.5, 0xffffff, 0.6);
      const name = this.add.text(rx + 28 * s, ry + 4 * s, item.name, {
        fontSize: `${13 * s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        color: '#e8f6f0',
      });
      const sub =
        item.kind === 'decor'
          ? `${this.costLabel(item.cost)}  ${this.decorBranchLabel(item.id)}`
          : this.costLabel(item.cost);
      const cost = this.add.text(rx + 28 * s, ry + 22 * s, sub, {
        fontSize: `${10 * s}px`,
        fontFamily: 'Segoe UI, sans-serif',
        color: '#9ab8ae',
      });
      const hl = this.add
        .rectangle(rx, ry, cellW - 6 * s, cellH - 4, 0x4fd8c4, 0.15)
        .setOrigin(0, 0)
        .setStrokeStyle(1.5, 0x4fd8c4, item.id === this.activeBuildId ? 0.9 : 0)
        .setFillStyle(0x4fd8c4, item.id === this.activeBuildId ? 0.15 : 0);
      hl.setData('buildId', item.id);
      this.buildPanel!.add([hl, zone, swatch, name, cost]);
    });

    // Footer: remove-decor toggle + close.
    const fy = py + panelH - 48 * s;
    const half = (panelW - 40 * s) / 2;
    this.makeButton(px + 14 * s, fy, half, 38 * s, '🗑 Remove decor', () => {
      this.removeActive = !this.removeActive;
      // Removing and placing are mutually exclusive modes.
      this.activeBuildId = null;
      gameEvents.emit('wk-build-changed', null);
      gameEvents.emit('wk-remove-toggled', this.removeActive);
      this.toast(this.removeActive
        ? 'Remove mode: tap a decor to demolish it (50% refund). Toggle again to stop.'
        : 'Remove mode off');
      this.closeBuildPanel(true);
    }, this.buildPanel, this.removeActive);
    this.makeButton(px + 26 * s + half, fy, half, 38 * s, '✕ Close', () => {
      this.closeBuildPanel();
    }, this.buildPanel);
  }

  private refreshCapsLabel(): void {
    const caps = this.registry.get('wk-caps') as
      | { creatures: number; maxCreatures: number; decor: number; maxDecor: number }
      | undefined;
    if (caps && this.buildCapsLabel?.active) {
      this.buildCapsLabel.setText(
        `Decor ${caps.decor}/${caps.maxDecor} · Wildkin ${caps.creatures}/${caps.maxCreatures} — space is limited, choose well`,
      );
    }
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

  private closeBuildPanel(keepRemoveMode = false): void {
    this.buildPanel?.destroy(true);
    this.buildPanel = null;
    this.buildCapsLabel = null;
    this.activeBuildId = null;
    gameEvents.emit('wk-build-changed', null);
    if (!keepRemoveMode && this.removeActive) {
      this.removeActive = false;
      gameEvents.emit('wk-remove-toggled', false);
    }
  }

  // --- Settings ------------------------------------------------------------------
  private toggleSettingsPanel(): void {
    this.closeBuildPanel();
    this.closeDexPanel();
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
    this.makeButton(px + 16 * s, py + 136 * s, pw - 32 * s, 40 * s, '🗑 Reset — new land + intro', () => {
      if (!this.resetArmed) {
        this.resetArmed = true;
        this.toast('Tap again to erase this sanctuary. Your Form Dex is kept forever.');
        return;
      }
      // BUGFIX PASS — order matters: (1) tell the WorldScene to stop saving
      // (its beforeunload autosave used to write the old sanctuary right
      // back after the wipe — THE reset bug), (2) wipe the save AND the
      // onboarding flag so the intro replays, (3) reload clean. The Form
      // Dex lives in its own storage and is deliberately untouched.
      gameEvents.emit('wk-reset');
      SaveManager.clear();
      SaveManager.clearOnboarded();
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

    // PASS 3 — the move cooldown is always visible while active.
    const cd = info.cooldownSeconds > 0 ? ` · ⏳ ${info.cooldownSeconds}s to redirect` : '';

    if (info.stage >= 2) {
      // Evolved: show the form instead of progress bars.
      this.infoTitle.setText(`${info.name} — ${info.formName}${info.formRare ? ' ✨' : ''}`);
      this.infoState.setText(
        `${info.formRare ? 'RARE form · ' : ''}evolved from ${info.speciesName} · ${stateLabels[info.state] ?? info.state}${cd}`,
      );
      this.getBarLabel(0).setPosition(px, py + 6 * s).setText(info.formRare ? '✨ A rare variant — one in seven!' : 'Fully evolved');
      this.getBarLabel(1).setText('');
      return;
    }

    this.infoTitle.setText(`${info.name} — ${info.speciesName}`);
    this.infoState.setText((stateLabels[info.state] ?? info.state) + cd);

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

  // --- Form Dex (PASS 3): the collection screen / long-term goal ---------------
  private toggleDexPanel(): void {
    this.closeBuildPanel();
    this.closeSettingsPanel();
    if (this.dexPanel) {
      this.closeDexPanel();
      return;
    }
    const s = this.s;
    // Clamp so the panel fits the canvas even at phone scale (1.5x).
    const pw = Math.min(1256, 860 * s);
    const ph = Math.min(656, 560 * s);
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;

    this.dexPanel = this.add.container(0, 0).setDepth(900);
    this.root.add(this.dexPanel);
    this.panelBg(px, py, pw, ph, this.dexPanel);

    const entries = Dex.allEntries();
    const title = this.add
      .text(
        px + 18 * s,
        py + 12 * s,
        `📖 Form Dex — ${Dex.discoveredCount()}/${Dex.totalForms()} discovered`,
        {
          fontSize: `${18 * s}px`,
          fontFamily: 'Segoe UI, sans-serif',
          fontStyle: 'bold',
          color: '#e8f6f0',
        },
      );
    this.dexPanel.add(title);

    // 4 columns x 3 rows: each base creature reads as one row of its 4 forms.
    const cols = 4;
    const gridTop = py + 46 * s;
    const gridH = ph - 46 * s - 58 * s;
    const cellW = (pw - 24 * s) / cols;
    const cellH = gridH / Math.ceil(entries.length / cols);

    entries.forEach((e, i) => {
      const cx = px + 12 * s + (i % cols) * cellW;
      const cy = gridTop + Math.floor(i / cols) * cellH;

      // Cell background — branch-colored border once discovered.
      const g = this.add.graphics();
      g.fillStyle(0x0d1a20, 0.9);
      g.lineStyle(
        e.rare && e.discovered ? 2.5 : 1.5,
        e.discovered ? Phaser.Display.Color.HexStringToColor(e.rare ? '#ffd166' : e.color).color : 0x27424d,
        e.discovered ? 0.95 : 0.6,
      );
      g.fillRoundedRect(cx + 3, cy + 3, cellW - 6, cellH - 6, 8);
      g.strokeRoundedRect(cx + 3, cy + 3, cellW - 6, cellH - 6, 8);
      this.dexPanel!.add(g);

      // The form sprite — full color when discovered, dark silhouette when not.
      const img = this.add.image(cx + cellW / 2, cy + cellH * 0.42, `cr-form-${e.formId}`);
      img.setScale(Math.min(1.6, (cellH * 0.55) / img.height));
      if (!e.discovered) img.setTintFill(0x1c2f38); // locked = silhouette
      this.dexPanel!.add(img);

      const nameText = this.add
        .text(cx + cellW / 2, cy + cellH - 34 * s, e.discovered ? e.formName : '???', {
          fontSize: `${12 * s}px`,
          fontFamily: 'Segoe UI, sans-serif',
          fontStyle: e.discovered ? 'bold' : 'normal',
          color: e.discovered ? '#e8f6f0' : '#5e7d73',
        })
        .setOrigin(0.5, 0);
      const tagText = this.add
        .text(cx + cellW / 2, cy + cellH - 18 * s, e.rare ? '✨ RARE ✨' : 'COMMON', {
          fontSize: `${9.5 * s}px`,
          fontFamily: 'Segoe UI, sans-serif',
          color: e.rare ? '#ffd166' : '#7fa89b',
        })
        .setOrigin(0.5, 0);
      this.dexPanel!.add([nameText, tagText]);

      // Freshly-discovered flourish: NEW! badge + a little pulse.
      if (e.isNew) {
        const badge = this.add
          .text(cx + cellW - 12 * s, cy + 10 * s, 'NEW!', {
            fontSize: `${10 * s}px`,
            fontFamily: 'Segoe UI, sans-serif',
            fontStyle: 'bold',
            color: '#0a1418',
            backgroundColor: '#ffd166',
            padding: { x: 5, y: 2 },
          })
          .setOrigin(1, 0);
        this.dexPanel!.add(badge);
        this.tweens.add({
          targets: [img, badge],
          scale: '*=1.12',
          duration: 380,
          yoyo: true,
          repeat: 3,
          ease: 'Sine.easeInOut',
        });
      }
    });

    this.makeButton(px + pw / 2 - 90 * s, py + ph - 50 * s, 180 * s, 38 * s, 'Close', () =>
      this.closeDexPanel(),
    this.dexPanel);
  }

  private closeDexPanel(): void {
    if (!this.dexPanel) return;
    this.dexPanel.destroy(true);
    this.dexPanel = null;
    Dex.markAllSeen(); // NEW! badges shown once, then cleared
    this.refreshDexButton();
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
    // Fit both portraits by display height — art PNGs and placeholder shapes
    // have wildly different native sizes, so absolute scales would break.
    const before = this.add.image(W / 2 - 130 * s, cy, `cr-${ev.baseSpeciesId}`);
    before.setScale((92 * s) / before.height);
    const arrow = this.add
      .text(W / 2, cy, '→', { fontSize: `${34 * s}px`, color: '#9fd8c8' })
      .setOrigin(0.5);
    const after = this.add.image(W / 2 + 130 * s, cy, `cr-form-${ev.form.id}`);
    const afterScale = (116 * s) / after.height;
    after.setScale(afterScale);
    this.tweens.add({
      targets: after,
      scale: { from: afterScale * 0.7, to: afterScale },
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
  ): Phaser.GameObjects.Text {
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
    return t;
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

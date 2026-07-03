import Phaser from 'phaser';
import nodesConfig from '../config/nodes.json';

/**
 * Global game state + event bus.
 *
 * This module is a singleton: the WorldScene (gameplay) and UIScene (HUD)
 * both import it. The scenes never call each other directly — they talk
 * through `gameEvents`, which keeps them cleanly separated.
 *
 * Events used across the game (all prefixed 'wk-'):
 *   'wk-inventory'        -> inventory changed; payload: the inventory record
 *   'wk-selected'         -> creature selected/deselected; payload: info | null
 *   'wk-selected-update'  -> live refresh of the selected creature's counters
 *   'wk-toast'            -> show a short message; payload: string
 *   'wk-evolved'          -> a creature evolved; payload: {name, formName}
 *   'wk-build-changed'    -> build-mode selection changed; payload: BuildItem | null
 *   'wk-ui-mode-changed'  -> player switched desktop/phone mode
 */
export const gameEvents = new Phaser.Events.EventEmitter();

/** Live inventory. Keys come from nodes.json `resources`, so adding a new resource there automatically adds a HUD counter. */
export const inventory: Record<string, number> = {};

/** A fresh sanctuary starts with a small stockpile so the player can place decor right away and see resonance working. */
const STARTING_AMOUNT = 10;

/** (Re)initialize the inventory, optionally from saved values. */
export function initInventory(saved?: Record<string, number>): void {
  for (const res of nodesConfig.resources) {
    inventory[res.id] = saved?.[res.id] ?? STARTING_AMOUNT;
  }
  gameEvents.emit('wk-inventory', inventory);
}

/** Add resources (from creatures working). */
export function addResource(id: string, amount: number): void {
  inventory[id] = (inventory[id] ?? 0) + amount;
  gameEvents.emit('wk-inventory', inventory);
}

/** Can the player afford this cost? (cost = {wood: 5, stone: 2, ...}) */
export function canAfford(cost: Record<string, number>): boolean {
  return Object.entries(cost).every(([id, amt]) => (inventory[id] ?? 0) >= amt);
}

/** Spend resources. Returns false (and spends nothing) if unaffordable. */
export function spend(cost: Record<string, number>): boolean {
  if (!canAfford(cost)) return false;
  for (const [id, amt] of Object.entries(cost)) inventory[id] -= amt;
  gameEvents.emit('wk-inventory', inventory);
  return true;
}

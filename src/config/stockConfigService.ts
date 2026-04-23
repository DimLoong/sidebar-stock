import * as vscode from "vscode";
import { StockConfigItem } from "../models/stock";
import { normalizeStockConfig, toConfigId } from "../utils/stockCode";

const CONFIG_KEY = "stockCodeList";
const CONFIG_SECTION = "sidebarStock";
const LEGACY_CONFIG_SECTION = "stockInvestment";
const DEFAULT_ITEM: StockConfigItem = { type: "stock", market: "sh", code: "000001", name: "上证指数" };

export class StockConfigService {
  async load(): Promise<{ items: StockConfigItem[]; migrated: boolean }> {
    const primaryRawList = this.getConfig().get<unknown[]>(CONFIG_KEY, []);
    const legacyRawList = this.getLegacyConfig().get<unknown[]>(CONFIG_KEY, []);
    const shouldUseLegacy = primaryRawList.length === 0 && legacyRawList.length > 0;
    const rawList = shouldUseLegacy ? legacyRawList : primaryRawList;
    const normalized: StockConfigItem[] = [];
    let shouldMigrate = shouldUseLegacy;

    for (const raw of rawList) {
      if (typeof raw === "string") {
        shouldMigrate = true;
      }
      if (
        raw &&
        typeof raw === "object" &&
        Object.prototype.hasOwnProperty.call(raw as Record<string, unknown>, "order")
      ) {
        // Legacy compatibility: read order but migrate away from explicit order field.
        shouldMigrate = true;
      }
      const item = normalizeStockConfig(raw);
      if (item) {
        normalized.push(item);
      }
    }

    let finalItems = this.deduplicate(normalized);
    const shouldInitializeDefaults = rawList.length === 0 && finalItems.length === 0;
    if (shouldInitializeDefaults) {
      const defaults = this.loadDefaultItems();
      finalItems = defaults.length > 0 ? defaults : [DEFAULT_ITEM];
      shouldMigrate = true;
    } else if (finalItems.length === 0) {
      finalItems = [DEFAULT_ITEM];
    }

    if (shouldMigrate) {
      await this.persist(finalItems);
    }

    return { items: finalItems, migrated: shouldMigrate };
  }

  async add(item: StockConfigItem): Promise<void> {
    const { added } = await this.addMany([item]);
    if (added === 0) {
      throw new Error(`${toConfigId(item)} 已存在`);
    }
  }

  async addMany(itemsToAdd: StockConfigItem[]): Promise<{ added: number; skipped: number }> {
    const { items } = await this.load();
    const existing = new Set(items.map((it) => toConfigId(it)));
    const incomingSeen = new Set<string>();
    const append: StockConfigItem[] = [];

    for (const item of itemsToAdd) {
      const id = toConfigId(item);
      if (existing.has(id) || incomingSeen.has(id)) {
        continue;
      }
      incomingSeen.add(id);
      append.push(item);
    }

    if (append.length > 0) {
      await this.persist([...items, ...append]);
    }

    return { added: append.length, skipped: itemsToAdd.length - append.length };
  }

  async remove(configId: string): Promise<void> {
    const { items } = await this.load();
    await this.persist(items.filter((it) => toConfigId(it) !== configId));
  }

  async updateHolding(configId: string, shares: number, costPrice?: number, costDate?: string): Promise<void> {
    const { items } = await this.load();
    const updated = items.map((it) => {
      if (toConfigId(it) !== configId || it.type !== "stock") {
        return it;
      }
      const next: StockConfigItem = {
        type: "stock",
        market: it.market,
        code: it.code,
        name: it.name,
        isPinned: it.isPinned,
        pinnedAt: it.pinnedAt,
      };
      if (shares > 0) {
        next.shares = shares;
      }
      if (costPrice !== undefined && costPrice > 0) {
        next.costPrice = costPrice;
      }
      if (costDate) {
        next.costDate = costDate;
      }
      return next;
    });
    await this.persist(updated);
  }

  async pin(configId: string): Promise<void> {
    const { items } = await this.load();
    const index = items.findIndex((item) => toConfigId(item) === configId);
    if (index < 0) {
      return;
    }

    const current = items[index];
    const next: StockConfigItem = {
      ...current,
      isPinned: true,
      pinnedAt: Date.now(),
    };

    const remaining = [...items.slice(0, index), ...items.slice(index + 1)];
    const firstNormalIndex = remaining.findIndex((item) => !item.isPinned);
    const insertIndex = firstNormalIndex >= 0 ? firstNormalIndex : remaining.length;
    const updated = [...remaining.slice(0, insertIndex), next, ...remaining.slice(insertIndex)];
    await this.persist(updated);
  }

  async unpin(configId: string): Promise<void> {
    const { items } = await this.load();
    const index = items.findIndex((item) => toConfigId(item) === configId);
    if (index < 0) {
      return;
    }

    const current = items[index];
    const next: StockConfigItem = { ...current };
    delete next.isPinned;
    delete next.pinnedAt;

    const remaining = [...items.slice(0, index), ...items.slice(index + 1)];
    const firstNormalIndex = remaining.findIndex((item) => !item.isPinned);
    const insertIndex = firstNormalIndex >= 0 ? firstNormalIndex : remaining.length;
    const updated = [...remaining.slice(0, insertIndex), next, ...remaining.slice(insertIndex)];
    await this.persist(updated);
  }

  async reorder(configIds: string[]): Promise<void> {
    const { items } = await this.load();
    const pinnedItems = items.filter((item) => item.isPinned);
    const normalItems = items.filter((item) => !item.isPinned);
    const byId = new Map(normalItems.map((item) => [toConfigId(item), item] as const));
    const ordered: StockConfigItem[] = [];
    const seen = new Set<string>();

    for (const id of configIds) {
      const item = byId.get(id);
      if (!item || seen.has(id)) {
        continue;
      }
      seen.add(id);
      ordered.push(item);
    }

    for (const item of normalItems) {
      const id = toConfigId(item);
      if (seen.has(id)) {
        continue;
      }
      ordered.push(item);
    }

    await this.persist([...pinnedItems, ...ordered]);
  }

  private async persist(items: StockConfigItem[]): Promise<void> {
    await this.getConfig().update(
      CONFIG_KEY,
      this.normalizePersistedItems(this.deduplicate(items)),
      vscode.ConfigurationTarget.Global
    );
  }

  private getConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIG_SECTION);
  }

  private getLegacyConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(LEGACY_CONFIG_SECTION);
  }

  private deduplicate(items: StockConfigItem[]): StockConfigItem[] {
    const seen = new Set<string>();
    const result: StockConfigItem[] = [];

    for (const item of items) {
      const id = toConfigId(item);
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      result.push(item);
    }

    return result;
  }

  private normalizePersistedItems(items: StockConfigItem[]): StockConfigItem[] {
    return items.map((item) => {
      if (item.isPinned) {
        const pinnedAt = Number(item.pinnedAt);
        return {
          ...item,
          pinnedAt: Number.isFinite(pinnedAt) && pinnedAt > 0 ? Math.floor(pinnedAt) : Date.now(),
        };
      }

      const next: StockConfigItem = { ...item };
      delete next.isPinned;
      delete next.pinnedAt;
      return next;
    });
  }

  private loadDefaultItems(): StockConfigItem[] {
    try {
      // Keep defaults in a standalone JSON file for maintainability.
      const raw = require("../data/defaultWatchlist.json") as unknown;
      if (!Array.isArray(raw)) {
        return [];
      }
      const normalized = raw
        .map((item) => normalizeStockConfig(item))
        .filter((item): item is StockConfigItem => Boolean(item));

      return this.deduplicate(normalized);
    } catch (error) {
      console.error("加载默认观察列表失败:", error);
      return [];
    }
  }
}

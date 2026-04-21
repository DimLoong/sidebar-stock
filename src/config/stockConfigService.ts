import * as vscode from "vscode";
import { StockConfigItem } from "../models/stock";
import { normalizeStockConfig, toSecId } from "../utils/stockCode";

const CONFIG_KEY = "stockCodeList";
const DEFAULT_STOCK: StockConfigItem = { market: "1", code: "000001" };

export class StockConfigService {
  private readonly config = vscode.workspace.getConfiguration("stockInvestment");

  async load(): Promise<{ items: StockConfigItem[]; migrated: boolean }> {
    const rawList = this.config.get<unknown[]>(CONFIG_KEY, []);
    const normalized: StockConfigItem[] = [];
    let hasLegacyString = false;

    for (const raw of rawList) {
      if (typeof raw === "string") {
        hasLegacyString = true;
      }
      const item = normalizeStockConfig(raw);
      if (item) {
        normalized.push(item);
      }
    }

    const deduped = this.deduplicate(normalized);
    const finalItems = deduped.length > 0 ? deduped : [DEFAULT_STOCK];

    if (hasLegacyString) {
      await this.persist(finalItems);
      return { items: finalItems, migrated: true };
    }

    return { items: finalItems, migrated: false };
  }

  async add(item: StockConfigItem): Promise<void> {
    const { items } = await this.load();
    const secId = toSecId(item);
    if (items.some((it) => toSecId(it) === secId)) {
      throw new Error(`股票 ${secId} 已存在`);
    }
    await this.persist([...items, item]);
  }

  async remove(secId: string): Promise<void> {
    const { items } = await this.load();
    await this.persist(items.filter((it) => toSecId(it) !== secId));
  }

  async updateHolding(secId: string, shares: number, costPrice?: number): Promise<void> {
    const { items } = await this.load();
    const updated = items.map((it) => {
      if (toSecId(it) !== secId) {
        return it;
      }
      const next: StockConfigItem = { market: it.market, code: it.code };
      if (shares > 0) {
        next.shares = shares;
      }
      if (costPrice !== undefined && costPrice > 0) {
        next.costPrice = costPrice;
      }
      return next;
    });
    await this.persist(updated);
  }

  async findBySecId(secId: string): Promise<StockConfigItem | undefined> {
    const { items } = await this.load();
    return items.find((it) => toSecId(it) === secId);
  }

  private async persist(items: StockConfigItem[]): Promise<void> {
    const deduped = this.deduplicate(items);
    await this.config.update(CONFIG_KEY, deduped, vscode.ConfigurationTarget.Global);
  }

  private deduplicate(items: StockConfigItem[]): StockConfigItem[] {
    const seen = new Set<string>();
    const result: StockConfigItem[] = [];

    for (const item of items) {
      const secId = toSecId(item);
      if (seen.has(secId)) {
        continue;
      }
      seen.add(secId);
      result.push(item);
    }

    return result;
  }
}

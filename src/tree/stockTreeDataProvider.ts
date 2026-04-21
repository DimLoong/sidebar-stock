import * as vscode from "vscode";
import { StockApiService } from "../api/stockApiService";
import { StockConfigService } from "../config/stockConfigService";
import { HoldingInfo, StockConfigItem, StockData } from "../models/stock";
import { marketTag, toHoldingMap, toSecId } from "../utils/stockCode";
import { StockItem } from "./stockItem";

export class StockTreeDataProvider implements vscode.TreeDataProvider<StockItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    StockItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private stocksData = new Map<string, StockData>();
  private stockItems: StockConfigItem[] = [];
  private holdings = new Map<string, HoldingInfo>();
  private isLoading = true;
  private lastUpdateTime = "";

  constructor(
    private readonly configService: StockConfigService,
    private readonly apiService: StockApiService
  ) {}

  async initialize(): Promise<void> {
    await this.loadStockCodes();
    await this.fetchAllStockData();
  }

  getTreeItem(element: StockItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: StockItem): Thenable<StockItem[]> {
    if (!element) {
      return Promise.resolve(this.getRootItems());
    }
    if (element.isRoot && element.stockCode) {
      return Promise.resolve(this.getDetailItems(element.stockCode));
    }
    return Promise.resolve([]);
  }

  async refresh(): Promise<void> {
    await this.loadStockCodes();
    await this.fetchAllStockData();
  }

  getConfiguredStock(secId: string): StockConfigItem | undefined {
    return this.stockItems.find((item) => toSecId(item) === secId);
  }

  async addStock(item: StockConfigItem): Promise<void> {
    await this.configService.add(item);
    await this.refresh();
  }

  async deleteStock(secId: string): Promise<void> {
    await this.configService.remove(secId);
    await this.refresh();
  }

  async updateHolding(secId: string, shares: number, costPrice?: number): Promise<void> {
    await this.configService.updateHolding(secId, shares, costPrice);
    await this.refresh();
  }

  private async loadStockCodes(): Promise<void> {
    const { items, migrated } = await this.configService.load();
    this.stockItems = items;
    this.holdings = toHoldingMap(items);
    if (migrated) {
      vscode.window.showInformationMessage("已自动将旧版股票配置迁移为 JSON 结构");
    }
  }

  private async fetchAllStockData(): Promise<void> {
    const stockCodeList = this.stockItems.map((item) => toSecId(item));
    if (stockCodeList.length === 0) {
      this.isLoading = false;
      this._onDidChangeTreeData.fire();
      return;
    }

    this.lastUpdateTime = new Date().toLocaleTimeString("zh-CN");
    this.stocksData = await this.apiService.fetchBatchStocks(stockCodeList, this.lastUpdateTime);
    this.isLoading = false;
    this._onDidChangeTreeData.fire();
  }

  private getRootItems(): StockItem[] {
    if (this.isLoading) {
      return [
        new StockItem(
          "上证指数",
          vscode.TreeItemCollapsibleState.Collapsed,
          "加载中...",
          new vscode.ThemeIcon("loading~spin"),
          "1.000001",
          true
        ),
      ];
    }

    const items: StockItem[] = [];
    for (const stock of this.stockItems) {
      const secId = toSecId(stock);
      const stockData = this.stocksData.get(secId);
      if (!stockData) {
        items.push(
          new StockItem(
            secId,
            vscode.TreeItemCollapsibleState.Collapsed,
            "加载失败",
            new vscode.ThemeIcon("error"),
            secId,
            true
          )
        );
        continue;
      }

      const changeNum = Number.parseFloat(stockData.change);
      const arrow = changeNum >= 0 ? "↑" : "↓";
      const color =
        changeNum > 0
          ? new vscode.ThemeColor("charts.red")
          : changeNum < 0
            ? new vscode.ThemeColor("charts.green")
            : new vscode.ThemeColor("disabledForeground");

      items.push(
        new StockItem(
          stockData.name,
          vscode.TreeItemCollapsibleState.Collapsed,
          `${stockData.current} ${arrow} ${stockData.changePercent}%${marketTag(secId)}`,
          new vscode.ThemeIcon("circle-filled", color),
          secId,
          true
        )
      );
    }

    this.appendHoldingSummary(items);

    if (this.lastUpdateTime) {
      items.push(
        new StockItem(
          "更新时间",
          vscode.TreeItemCollapsibleState.None,
          this.lastUpdateTime,
          new vscode.ThemeIcon("clock")
        )
      );
    }

    return items;
  }

  private appendHoldingSummary(items: StockItem[]): void {
    let totalMarketValue = 0;
    let totalProfitLoss = 0;
    let hasHoldings = false;

    for (const [secId, holding] of this.holdings.entries()) {
      const stockData = this.stocksData.get(secId);
      if (!stockData || holding.shares <= 0) {
        continue;
      }

      hasHoldings = true;
      const currentPrice = Number.parseFloat(stockData.current);
      const changeNum = Number.parseFloat(stockData.change);
      totalMarketValue += currentPrice * holding.shares;
      totalProfitLoss += changeNum * holding.shares;
    }

    if (!hasHoldings) {
      return;
    }

    items.push(
      new StockItem(
        "持仓市值",
        vscode.TreeItemCollapsibleState.None,
        totalMarketValue.toFixed(2),
        new vscode.ThemeIcon("graph", new vscode.ThemeColor("charts.blue"))
      )
    );

    const totalProfitLossStr =
      totalProfitLoss >= 0 ? `+${totalProfitLoss.toFixed(2)}` : totalProfitLoss.toFixed(2);

    items.push(
      new StockItem(
        "今日盈亏",
        vscode.TreeItemCollapsibleState.None,
        totalProfitLossStr,
        new vscode.ThemeIcon(
          totalProfitLoss >= 0 ? "arrow-up" : "arrow-down",
          new vscode.ThemeColor(totalProfitLoss >= 0 ? "charts.red" : "charts.green")
        )
      )
    );
  }

  private getDetailItems(secId: string): StockItem[] {
    const stockData = this.stocksData.get(secId);
    if (!stockData) {
      return [];
    }

    const changeNum = Number.parseFloat(stockData.change);
    const isUp = changeNum >= 0;
    const holding = this.holdings.get(secId);

    const items: StockItem[] = [
      new StockItem(
        "昨日收盘",
        vscode.TreeItemCollapsibleState.None,
        stockData.previousClose,
        new vscode.ThemeIcon("symbol-number", new vscode.ThemeColor("charts.blue"))
      ),
      new StockItem(
        "涨跌点数",
        vscode.TreeItemCollapsibleState.None,
        `${isUp ? "↑" : "↓"} ${stockData.change}`,
        new vscode.ThemeIcon(
          isUp ? "arrow-up" : "arrow-down",
          new vscode.ThemeColor(isUp ? "charts.red" : "charts.green")
        )
      ),
    ];

    if (holding?.shares && holding.shares > 0) {
      items.push(
        new StockItem(
          "持有股数",
          vscode.TreeItemCollapsibleState.None,
          `${holding.shares}`,
          new vscode.ThemeIcon("database", new vscode.ThemeColor("charts.purple"))
        )
      );

      if (holding.costPrice && holding.costPrice > 0) {
        items.push(
          new StockItem(
            "成本价",
            vscode.TreeItemCollapsibleState.None,
            holding.costPrice.toFixed(2),
            new vscode.ThemeIcon("symbol-numeric", new vscode.ThemeColor("charts.yellow"))
          )
        );

        const floatingPnL =
          (Number.parseFloat(stockData.current) - holding.costPrice) * holding.shares;
        items.push(
          new StockItem(
            "持仓盈亏",
            vscode.TreeItemCollapsibleState.None,
            floatingPnL >= 0 ? `+${floatingPnL.toFixed(2)}` : floatingPnL.toFixed(2),
            new vscode.ThemeIcon(
              floatingPnL >= 0 ? "arrow-up" : "arrow-down",
              new vscode.ThemeColor(floatingPnL >= 0 ? "charts.red" : "charts.green")
            )
          )
        );
      }

      const dailyPnL = changeNum * holding.shares;
      items.push(
        new StockItem(
          "今日盈亏",
          vscode.TreeItemCollapsibleState.None,
          dailyPnL >= 0 ? `+${dailyPnL.toFixed(2)}` : dailyPnL.toFixed(2),
          new vscode.ThemeIcon(
            dailyPnL >= 0 ? "arrow-up" : "arrow-down",
            new vscode.ThemeColor(dailyPnL >= 0 ? "charts.red" : "charts.green")
          )
        )
      );
    }

    return items;
  }
}

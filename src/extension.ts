import * as vscode from "vscode";
import { StockApiService } from "./api/stockApiService";
import { registerCommands } from "./commands/registerCommands";
import { StockConfigService } from "./config/stockConfigService";
import { AutoRefreshService } from "./services/autoRefreshService";
import { StockTreeDataProvider } from "./tree/stockTreeDataProvider";

const REFRESH_INTERVAL = 3000;
const STOCK_CONFIG_SECTION = "sidebarStock";
const STOCK_CONFIG_KEY = "sidebarStock.stockCodeList";
const LEGACY_STOCK_CONFIG_KEY = "stockInvestment.stockCodeList";
const LEGACY_ALERTS_SECTION = "stockInvestment.alerts";
const TAB_NAME_KEY = "sidebarStock.tabName";

let autoRefreshService: AutoRefreshService | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const configService = new StockConfigService();
  const apiService = new StockApiService();
  const stockDataProvider = new StockTreeDataProvider(configService, apiService);
  autoRefreshService = new AutoRefreshService();

  await stockDataProvider.initialize();

  const stockView = vscode.window.createTreeView("stockView", {
    treeDataProvider: stockDataProvider,
    showCollapseAll: false,
    dragAndDropController: stockDataProvider,
  });
  applyStockViewStatus(stockView, stockDataProvider);

  autoRefreshService.start(() => {
    stockDataProvider.refresh().then(() => {
      applyStockViewStatus(stockView, stockDataProvider);
    });
  }, REFRESH_INTERVAL);

  const configChangeListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
    const affectsSidebarStock = e.affectsConfiguration(STOCK_CONFIG_SECTION);
    if (
      affectsSidebarStock ||
      e.affectsConfiguration(STOCK_CONFIG_KEY) ||
      e.affectsConfiguration(LEGACY_STOCK_CONFIG_KEY) ||
      e.affectsConfiguration(LEGACY_ALERTS_SECTION)
    ) {
      await stockDataProvider.refresh();
    }
    if (affectsSidebarStock || e.affectsConfiguration(TAB_NAME_KEY)) {
      applyStockViewStatus(stockView, stockDataProvider);
    }
  });
  const alertChangeListener = stockDataProvider.onDidChangeAlerts(() => {
    applyStockViewStatus(stockView, stockDataProvider);
  });

  registerCommands(context, stockDataProvider);
  context.subscriptions.push(stockView, configChangeListener, alertChangeListener);
}

export function deactivate() {
  autoRefreshService?.stop();
  autoRefreshService = undefined;
}

function applyStockViewStatus(stockView: vscode.TreeView<unknown>, provider: StockTreeDataProvider): void {
  const tabName = vscode.workspace.getConfiguration("sidebarStock").get<string>("tabName", "Stock").trim();
  const baseTitle = tabName || "Stock";
  const overview = provider.getAlertOverview();
  const suffix =
    overview.dominant === "surgeUp" ? " ⇧⇧" : overview.dominant === "surgeDown" ? " ⇩⇩" : "";
  stockView.title = `${baseTitle}${suffix}`;

  const total = overview.upCount + overview.downCount;
  stockView.badge =
    total > 0
      ? {
          value: total,
          tooltip: `异动提醒：上涨 ${overview.upCount}，下跌 ${overview.downCount}`,
        }
      : undefined;
}

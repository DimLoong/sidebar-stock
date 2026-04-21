import * as vscode from "vscode";
import { StockTreeDataProvider } from "../tree/stockTreeDataProvider";
import { StockItem } from "../tree/stockItem";
import { isValidMarket } from "../utils/stockCode";

export function registerCommands(
  context: vscode.ExtensionContext,
  stockDataProvider: StockTreeDataProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("stockView.refresh", async () => {
      await stockDataProvider.refresh();
    }),
    vscode.commands.registerCommand("stockView.openWebsite", () => {
      vscode.env.openExternal(vscode.Uri.parse("https://www.eastmoney.com/"));
    }),
    vscode.commands.registerCommand("extension.showStockPanel", async () => {
      await vscode.commands.executeCommand("workbench.view.explorer");
      await vscode.commands.executeCommand("stockView.focus");
    }),
    vscode.commands.registerCommand("stockView.editHoldingShares", async (item: StockItem) => {
      await handleEditHolding(stockDataProvider, item);
    }),
    vscode.commands.registerCommand("stockView.deleteStock", async (item: StockItem) => {
      await handleDeleteStock(stockDataProvider, item);
    }),
    vscode.commands.registerCommand("stockView.addStock", async () => {
      await handleAddStock(stockDataProvider);
    })
  );
}

async function handleEditHolding(
  stockDataProvider: StockTreeDataProvider,
  item: StockItem | undefined
): Promise<void> {
  if (!item?.stockCode) {
    vscode.window.showErrorMessage("无法获取股票代码");
    return;
  }

  const currentConfig = stockDataProvider.getConfiguredStock(item.stockCode);
  const currentShares = currentConfig?.shares ?? 0;
  const currentCost = currentConfig?.costPrice;

  const sharesInput = await vscode.window.showInputBox({
    prompt: `请输入 ${item.label} (${item.stockCode}) 的持有股数`,
    placeHolder: "输入大于等于0的整数，输入0或留空表示清除持仓",
    value: currentShares > 0 ? String(currentShares) : "",
    validateInput: (value) => {
      if (!value.trim()) {
        return null;
      }
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return "请输入有效数字";
      }
      if (num < 0 || !Number.isInteger(num)) {
        return "持有股数必须是大于等于0的整数";
      }
      return null;
    },
  });

  if (sharesInput === undefined) {
    return;
  }

  const shares = sharesInput.trim() ? parseInt(sharesInput.trim(), 10) : 0;

  const costInput = await vscode.window.showInputBox({
    prompt: `请输入 ${item.label} (${item.stockCode}) 的成本价（可选）`,
    placeHolder: "输入大于0的数字，留空表示不设置成本价",
    value: currentCost && currentCost > 0 ? String(currentCost) : "",
    validateInput: (value) => {
      if (!value.trim()) {
        return null;
      }
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) {
        return "成本价必须是大于0的数字";
      }
      return null;
    },
  });

  if (costInput === undefined) {
    return;
  }

  const costPrice = costInput.trim() ? Number(costInput.trim()) : undefined;
  await stockDataProvider.updateHolding(item.stockCode, shares, costPrice);

  if (shares > 0) {
    const costText = costPrice ? `，成本价 ${costPrice}` : "";
    vscode.window.showInformationMessage(`已更新 ${item.label} 持仓：${shares} 股${costText}`);
  } else {
    vscode.window.showInformationMessage(`已清除 ${item.label} 的持仓配置`);
  }
}

async function handleDeleteStock(
  stockDataProvider: StockTreeDataProvider,
  item: StockItem | undefined
): Promise<void> {
  if (!item?.stockCode) {
    vscode.window.showErrorMessage("无法获取股票代码");
    return;
  }

  const answer = await vscode.window.showWarningMessage(
    `确定要删除 ${item.label} (${item.stockCode}) 吗？`,
    { modal: true },
    "确定",
    "取消"
  );

  if (answer !== "确定") {
    return;
  }

  await stockDataProvider.deleteStock(item.stockCode);
  vscode.window.showInformationMessage(`已删除 ${item.label}`);
}

async function handleAddStock(stockDataProvider: StockTreeDataProvider): Promise<void> {
  const secIdInput = await vscode.window.showInputBox({
    prompt: "请输入股票代码",
    placeHolder: "格式：市场.代码（如：1.600519、116.00700、105.AAPL）",
    validateInput: (value) => {
      const trimmed = value.trim();
      const match = trimmed.match(/^(\d+)\.([A-Za-z0-9]+)$/);
      if (!match) {
        return "格式错误，请输入：市场.代码";
      }
      if (!isValidMarket(match[1])) {
        return "市场代码无效，支持：0、1、105、106、107、116";
      }
      return null;
    },
  });

  if (secIdInput === undefined) {
    return;
  }

  const [market, code] = secIdInput.trim().split(".");

  const sharesInput = await vscode.window.showInputBox({
    prompt: "请输入持有股数（可选）",
    placeHolder: "输入正整数，留空表示仅看行情",
    validateInput: (value) => {
      if (!value.trim()) {
        return null;
      }
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0 || !Number.isInteger(num)) {
        return "持有股数必须是大于0的整数";
      }
      return null;
    },
  });

  if (sharesInput === undefined) {
    return;
  }

  const costInput = await vscode.window.showInputBox({
    prompt: "请输入成本价（可选）",
    placeHolder: "输入大于0的数字，留空表示不设置",
    validateInput: (value) => {
      if (!value.trim()) {
        return null;
      }
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) {
        return "成本价必须是大于0的数字";
      }
      return null;
    },
  });

  if (costInput === undefined) {
    return;
  }

  try {
    await stockDataProvider.addStock({
      market,
      code,
      shares: sharesInput.trim() ? Number(sharesInput.trim()) : undefined,
      costPrice: costInput.trim() ? Number(costInput.trim()) : undefined,
    });
    vscode.window.showInformationMessage(`已添加股票 ${market}.${code}`);
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(error.message);
      return;
    }
    vscode.window.showErrorMessage("添加股票失败");
  }
}

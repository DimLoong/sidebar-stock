import * as vscode from "vscode";
import { StockItemType } from "../models/stock";

export class StockItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly description?: string,
    public readonly iconPath?: vscode.ThemeIcon,
    public readonly configId?: string,
    public readonly itemType?: StockItemType,
    public readonly isRoot: boolean = false,
    contextValue?: string
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.iconPath = iconPath;
    this.tooltip = "";

    if (contextValue) {
      this.contextValue = contextValue;
      return;
    }

    if (isRoot && configId) {
      if (itemType === "sector") {
        this.contextValue = "sectorRoot";
      } else if (itemType === "index") {
        this.contextValue = "indexRoot";
      } else if (itemType === "future") {
        this.contextValue = "futureRoot";
      } else {
        this.contextValue = "stockRoot";
      }
    }
  }
}

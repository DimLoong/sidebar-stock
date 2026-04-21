import * as vscode from "vscode";

export class StockItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly description?: string,
    public readonly iconPath?: vscode.ThemeIcon,
    public readonly stockCode?: string,
    public readonly isRoot: boolean = false
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.iconPath = iconPath;
    this.tooltip = "";

    if (isRoot && stockCode) {
      this.contextValue = "stockRoot";
    }
  }
}

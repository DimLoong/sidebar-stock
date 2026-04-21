export interface StockData {
  code: string;
  name: string;
  current: string;
  change: string;
  changePercent: string;
  previousClose: string;
  updateTime: string;
}

export interface StockConfigItem {
  market: string;
  code: string;
  shares?: number;
  costPrice?: number;
}

export interface HoldingInfo {
  shares: number;
  costPrice?: number;
}

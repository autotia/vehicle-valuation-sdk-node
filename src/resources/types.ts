export interface ValuationRequest {
  mark?: string | undefined;
  model?: string | undefined;
  year: number;
  version?: string | undefined;
  odometerKm: number;
}

export interface ValuationAcceptance {
  valuationId: string;
  status: "PENDING" | "RUNNING";
  pollAfterMs: number;
}

export interface ValuationFailure {
  code: string;
  description: string;
}

export interface ValuationResultVehicle {
  mark: string;
  model: string;
  year: number;
  version: string;
  canonicalVersion?: string | undefined;
  versionResolution: string;
  versionApplied: boolean;
}

export interface ValuationMarketContext {
  region: string;
  purchaseSellerType: string;
  saleSellerType: string;
  odometerKm: number;
}

export interface ValuationPriceOption {
  percentile: number;
  priceCLP: number;
}

export interface ValuationPriceSide {
  sellerType: string;
  qualityScore: number;
  options: ValuationPriceOption[];
}

export interface ValuationMarginRange {
  purchasePercentile: number;
  salePercentile: number;
  purchasePriceCLP: number;
  salePriceCLP: number;
  marginCLP: number;
  marginPercent: number;
}

export interface ValuationGrossMarginEstimate {
  qualityScore: number;
  disclaimer: string;
  maxMargin: ValuationMarginRange;
  minMargin: ValuationMarginRange;
}

export interface ValuationFreshness {
  lastValidLogicalDay: string;
  ageDays: number;
  status: string;
}

export interface ValuationMethodology {
  qualityVersion: string;
  smoothingVersion: string;
  algorithmVersion: string;
}

export interface ValuationResultData {
  vehicle: ValuationResultVehicle;
  marketContext: ValuationMarketContext;
  purchase: ValuationPriceSide;
  sale: ValuationPriceSide;
  grossMarginEstimate: ValuationGrossMarginEstimate;
  freshness: ValuationFreshness;
  methodology: ValuationMethodology;
  [key: string]: unknown;
}

export interface ValuationResult {
  schemaVersion: "general-price-result-v1" | string;
  data: ValuationResultData | Record<string, unknown>;
}

export interface ValuationStatus {
  valuationId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  result?: ValuationResult | undefined;
  failure?: ValuationFailure | undefined;
}

export interface CatalogRef {
  key: string;
  text: string;
}

export interface CatalogMarks {
  catalogVersion: string;
  marks: CatalogRef[];
}

export interface CatalogModel extends CatalogRef {
  years: number[];
}

export interface CatalogModels {
  catalogVersion: string;
  mark: CatalogRef;
  models: CatalogModel[];
}

export interface CatalogYears {
  catalogVersion: string;
  mark: CatalogRef;
  model: CatalogRef;
  years: number[];
}

export interface CatalogTrims {
  catalogVersion: string;
  mark: CatalogRef;
  model: CatalogRef;
  year: number;
  trims: CatalogRef[];
}

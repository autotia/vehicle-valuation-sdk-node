import { type RequestConfig, requestData } from "../core/request.js";
import type { CallOptions } from "../core/types.js";
import type {
  CatalogMarks,
  CatalogModels,
  CatalogTrims,
  CatalogYears,
  MarkInferenceRequest,
  MarkInferenceResult,
  ModelInferenceRequest,
  ModelInferenceResult,
  TrimInferenceRequest,
  TrimInferenceResult,
  VehicleResolutionRequest,
  VehicleResolutionResult,
} from "./types.js";

export class CatalogResource {
  readonly #config: RequestConfig;

  public constructor(config: RequestConfig) {
    this.#config = config;
  }

  public listMarks(options: CallOptions = {}): Promise<CatalogMarks | null> {
    return requestData<CatalogMarks | null>(
      this.#config,
      "GET",
      "/v1/catalog",
      undefined,
      options,
    );
  }

  public listModels(
    mark: string,
    options: CallOptions = {},
  ): Promise<CatalogModels | null> {
    return requestData<CatalogModels | null>(
      this.#config,
      "GET",
      `/v1/catalog/${encodeURIComponent(mark)}`,
      undefined,
      options,
    );
  }

  public listYears(
    mark: string,
    model: string,
    options: CallOptions = {},
  ): Promise<CatalogYears | null> {
    return requestData<CatalogYears | null>(
      this.#config,
      "GET",
      `/v1/catalog/${encodeURIComponent(mark)}/${encodeURIComponent(model)}`,
      undefined,
      options,
    );
  }

  public listTrims(
    mark: string,
    model: string,
    year: number,
    options: CallOptions = {},
  ): Promise<CatalogTrims | null> {
    return requestData<CatalogTrims | null>(
      this.#config,
      "GET",
      `/v1/catalog/${encodeURIComponent(mark)}/${encodeURIComponent(model)}/${encodeURIComponent(String(year))}`,
      undefined,
      options,
    );
  }

  public inferTrim(
    input: TrimInferenceRequest,
    options: CallOptions = {},
  ): Promise<TrimInferenceResult> {
    const body: Record<string, unknown> = {
      mark: input.mark,
      model: input.model,
      year: input.year,
      text: input.text,
    };
    if (input.limit !== undefined) {
      body.limit = input.limit;
    }
    return requestData<TrimInferenceResult>(
      this.#config,
      "POST",
      "/v1/version-inference",
      body,
      options,
    );
  }

  public resolveVehicle(
    input: VehicleResolutionRequest,
    options: CallOptions = {},
  ): Promise<VehicleResolutionResult> {
    return requestData<VehicleResolutionResult>(
      this.#config,
      "POST",
      "/v1/vehicle-resolution",
      input,
      options,
    );
  }

  public inferMark(
    input: MarkInferenceRequest,
    options: CallOptions = {},
  ): Promise<MarkInferenceResult> {
    return requestData<MarkInferenceResult>(
      this.#config,
      "POST",
      "/v1/mark-inference",
      input,
      options,
    );
  }

  public inferModel(
    input: ModelInferenceRequest,
    options: CallOptions = {},
  ): Promise<ModelInferenceResult> {
    return requestData<ModelInferenceResult>(
      this.#config,
      "POST",
      "/v1/model-inference",
      input,
      options,
    );
  }
}

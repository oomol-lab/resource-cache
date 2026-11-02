import type { AppCatalogResponse, AppMarketingResponse } from "./oomol";

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid public app response");
  return value as Record<string, unknown>;
}

function text(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new Error("Invalid public app text");
}

function dimension(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new Error("Invalid sprite dimensions");
  return value;
}

function decodeSprite(value: unknown) {
  if (value == null) return null;
  const sprite = record(value);
  const dimensions = {
    width: dimension(sprite.width),
    height: dimension(sprite.height),
    iconSize: dimension(sprite.iconSize),
  };
  for (const key of ["lightUrl", "darkUrl"]) {
    text(sprite[key]);
    if (new URL(sprite[key]).protocol !== "https:") throw new Error("Invalid sprite URL");
  }
  return dimensions;
}

/** Validate public catalog display fields and sprite coordinates, preserving the complete upstream response. */
export function decodeAppCatalogResponse(value: unknown): AppCatalogResponse {
  const response = record(value);
  if (response.success !== true || !Array.isArray(response.data)) throw new Error("Invalid app catalog");
  const sprite = decodeSprite(record(response.meta).iconSprite);
  for (const item of response.data) {
    const app = record(item);
    text(app.service);
    text(app.displayName);
    if (!Array.isArray(app.categories)) throw new Error("Invalid app categories");
    for (const category of app.categories) {
      const item = record(category);
      text(item.id);
      text(item.displayName);
    }
    if (!Array.isArray(app.searchAliases) || !app.searchAliases.every((alias) => typeof alias === "string"))
      throw new Error("Invalid app aliases");
    if (app.iconSpritePosition != null) {
      if (!sprite) throw new Error("Sprite position requires sprite metadata");
      const position = record(app.iconSpritePosition);
      for (const [coordinate, size] of [
        [position.x, sprite.width],
        [position.y, sprite.height],
      ] as const) {
        if (
          typeof coordinate !== "number" ||
          !Number.isSafeInteger(coordinate) ||
          coordinate < 0 ||
          coordinate + sprite.iconSize > size
        )
          throw new Error("Invalid sprite position");
      }
    }
  }
  return value as AppCatalogResponse;
}

/** Validate public app identity and action display fields, preserving marketing content and metadata. */
export function decodeAppMarketingResponse(value: unknown): AppMarketingResponse {
  const response = record(value);
  const data = record(response.data);
  if (response.success !== true || !Array.isArray(data.actions)) throw new Error("Invalid app marketing");
  text(data.service);
  for (const item of data.actions) {
    const action = record(item);
    text(action.id);
    text(action.displayName);
    text(action.description);
  }
  return value as AppMarketingResponse;
}

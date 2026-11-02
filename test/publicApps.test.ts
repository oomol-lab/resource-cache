import { expect, it } from "vitest";
import { decodeAppCatalogResponse, decodeAppMarketingResponse } from "../src/oomol";

const sprite = {
  width: 96,
  height: 64,
  iconSize: 32,
  lightUrl: "https://example.com/light.png",
  darkUrl: "https://example.com/dark.png",
};
const app = {
  service: "example",
  displayName: "Example",
  categories: [{ id: "tools", displayName: "Tools" }],
  searchAliases: ["sample"],
  iconSpritePosition: { x: 32, y: 0 },
  extra: "preserved",
};
const catalog = { success: true, data: [app], meta: { iconSprite: sprite, extra: "preserved" } };

it("preserves complete catalog responses and accepts artwork-free providers", () => {
  expect(decodeAppCatalogResponse(catalog)).toBe(catalog);
  const withoutArtwork = { ...catalog, data: [{ ...app, iconSpritePosition: null }], meta: { iconSprite: null } };
  expect(decodeAppCatalogResponse(withoutArtwork)).toBe(withoutArtwork);
});

it("accepts sprite positions whose icons reach the right and bottom edges", () => {
  const edge = { ...catalog, data: [{ ...app, iconSpritePosition: { x: 64, y: 32 } }] };
  expect(decodeAppCatalogResponse(edge)).toBe(edge);
});

it.each([
  null,
  "invalid",
  { ...catalog, success: false },
  { ...catalog, data: null },
  { ...catalog, meta: null },
  { ...catalog, data: [], meta: [] },
  { ...catalog, meta: { iconSprite: "invalid" } },
  { ...catalog, meta: { iconSprite: { ...sprite, width: 0 } } },
  { ...catalog, meta: { iconSprite: { ...sprite, width: "96" } } },
  { ...catalog, meta: { iconSprite: { ...sprite, height: 1.5 } } },
  { ...catalog, meta: { iconSprite: { ...sprite, iconSize: 0 } } },
  { ...catalog, meta: { iconSprite: { ...sprite, lightUrl: null } } },
  { ...catalog, meta: { iconSprite: { ...sprite, darkUrl: "http://example.com/dark.png" } } },
  { ...catalog, meta: { iconSprite: { ...sprite, darkUrl: "invalid" } } },
  { ...catalog, data: [null] },
  { ...catalog, data: [{ ...app, service: null }] },
  { ...catalog, data: [{ ...app, displayName: 1 }] },
  { ...catalog, data: [{ ...app, categories: null }] },
  { ...catalog, data: [{ ...app, categories: [null] }] },
  { ...catalog, data: [{ ...app, categories: [{ id: null, displayName: "Tools" }] }] },
  { ...catalog, data: [{ ...app, categories: [{ id: "tools", displayName: null }] }] },
  { ...catalog, data: [{ ...app, searchAliases: null }] },
  { ...catalog, data: [{ ...app, searchAliases: [1] }] },
  { ...catalog, data: [{ ...app, iconSpritePosition: "invalid" }] },
  { ...catalog, data: [{ ...app, iconSpritePosition: { x: 0.5, y: 0 } }] },
  { ...catalog, data: [{ ...app, iconSpritePosition: { x: -1, y: 0 } }] },
  { ...catalog, data: [{ ...app, iconSpritePosition: { x: 1000, y: 0 } }] },
  { ...catalog, data: [{ ...app, iconSpritePosition: { x: 0, y: 1000 } }] },
  { ...catalog, data: [{ ...app, iconSpritePosition: { x: 65, y: 0 } }] },
  { ...catalog, data: [{ ...app, iconSpritePosition: { x: 0, y: 33 } }] },
  { ...catalog, data: [{ ...app, iconSpritePosition: { x: "32", y: 0 } }] },
  { ...catalog, meta: { iconSprite: null } },
])("rejects invalid public catalog metadata %#", (value) => {
  expect(() => decodeAppCatalogResponse(value)).toThrow();
});

const marketing = {
  success: true,
  data: {
    service: "example",
    actions: [{ id: "example.send", displayName: "Send", description: "Send a message" }],
    content: { title: "Preserve full marketing content" },
    extra: "preserved",
  },
  meta: { locale: "en", contentLocale: "en", availableContentLocales: ["en"] },
};

it("preserves complete public marketing responses, including unknown fields", () => {
  expect(decodeAppMarketingResponse(marketing)).toBe(marketing);
});

it.each([
  null,
  { ...marketing, success: false },
  { ...marketing, data: null },
  { ...marketing, data: { ...marketing.data, service: null } },
  { ...marketing, data: { ...marketing.data, actions: null } },
  { ...marketing, data: { ...marketing.data, actions: [null] } },
  ...["id", "displayName", "description"].map((key) => ({
    ...marketing,
    data: { ...marketing.data, actions: [{ ...marketing.data.actions[0], [key]: null }] },
  })),
])("rejects unusable public marketing data %#", (value) => {
  expect(() => decodeAppMarketingResponse(value)).toThrow();
});

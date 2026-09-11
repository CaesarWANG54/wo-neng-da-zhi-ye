import { describe, expect, it } from "vitest";
import { publicAssetPath } from "../asset-path";

describe("public asset paths", () => {
  it("keeps public files inside the configured Vite base", () => {
    const expected = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}assets/example.png`;
    expect(publicAssetPath("assets/example.png")).toBe(expected);
    expect(publicAssetPath("/assets/example.png")).toBe(expected);
  });
});

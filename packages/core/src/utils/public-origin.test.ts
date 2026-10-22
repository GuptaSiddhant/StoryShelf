import { describe, expect, it } from "vitest";
import { detectPublicBaseUrl, normalizeOrigin } from "./public-origin.ts";

describe("normalizeOrigin", () => {
  it("keeps the origin of a URL and reads a bare host as https", () => {
    expect(normalizeOrigin("https://shelf.example.com/some/path?x=1")).toBe(
      "https://shelf.example.com",
    );
    expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeOrigin("shelf.example.com")).toBe("https://shelf.example.com");
    expect(normalizeOrigin("  app.example.com:8443 ")).toBe("https://app.example.com:8443");
  });

  it("refuses anything that is not a plain http(s) origin", () => {
    expect(normalizeOrigin()).toBeUndefined();
    expect(normalizeOrigin("")).toBeUndefined();
    expect(normalizeOrigin("javascript:alert(1)")).toBeUndefined();
    expect(normalizeOrigin("ftp://example.com")).toBeUndefined();
    expect(normalizeOrigin("https://user:pass@example.com")).toBeUndefined();
    expect(normalizeOrigin("https://")).toBeUndefined();
  });
});

describe("detectPublicBaseUrl", () => {
  const cases: [string, Record<string, string>, string][] = [
    [
      "Heroku",
      { HEROKU_APP_DEFAULT_DOMAIN_NAME: "shelf-1.herokuapp.com" },
      "https://shelf-1.herokuapp.com",
    ],
    ["Railway", { RAILWAY_PUBLIC_DOMAIN: "shelf.up.railway.app" }, "https://shelf.up.railway.app"],
    [
      "Vercel production alias",
      {
        VERCEL: "1",
        VERCEL_PROJECT_PRODUCTION_URL: "shelf.vercel.app",
        VERCEL_URL: "shelf-abc.vercel.app",
      },
      "https://shelf.vercel.app",
    ],
    [
      "Vercel deployment",
      { VERCEL: "1", VERCEL_URL: "shelf-abc.vercel.app" },
      "https://shelf-abc.vercel.app",
    ],
    ["Netlify", { NETLIFY: "true", URL: "https://shelf.netlify.app" }, "https://shelf.netlify.app"],
    [
      "Render URL",
      { RENDER_EXTERNAL_URL: "https://shelf.onrender.com" },
      "https://shelf.onrender.com",
    ],
    [
      "Render host",
      { RENDER_EXTERNAL_HOSTNAME: "shelf.onrender.com" },
      "https://shelf.onrender.com",
    ],
    ["Fly.io", { FLY_APP_NAME: "shelf" }, "https://shelf.fly.dev"],
    [
      "Azure App Service",
      { WEBSITE_HOSTNAME: "shelf.azurewebsites.net" },
      "https://shelf.azurewebsites.net",
    ],
    [
      "Azure Container Apps",
      {
        CONTAINER_APP_NAME: "shelf",
        CONTAINER_APP_ENV_DNS_SUFFIX: "kindocean-1.westeurope.azurecontainerapps.io",
      },
      "https://shelf.kindocean-1.westeurope.azurecontainerapps.io",
    ],
    [
      "DigitalOcean App Platform",
      { DIGITALOCEAN_APP_ID: "abc", APP_URL: "https://shelf-xyz.ondigitalocean.app" },
      "https://shelf-xyz.ondigitalocean.app",
    ],
  ];

  it.each(cases)("reads the address on %s", (_name, env, expected) => {
    expect(detectPublicBaseUrl(env)).toBe(expected);
  });

  it("returns nothing off a platform, and ignores generic names without their marker", () => {
    expect(detectPublicBaseUrl({})).toBeUndefined();
    expect(
      detectPublicBaseUrl({ URL: "https://example.com", APP_URL: "https://example.com" }),
    ).toBeUndefined();
    expect(detectPublicBaseUrl({ NETLIFY: "false", URL: "https://example.com" })).toBeUndefined();
    expect(detectPublicBaseUrl({ RAILWAY_PUBLIC_DOMAIN: "" })).toBeUndefined();
  });

  it("ignores a value that is not an address", () => {
    expect(
      detectPublicBaseUrl({ RENDER_EXTERNAL_URL: "javascript:alert(1)", FLY_APP_NAME: "shelf" }),
    ).toBe("https://shelf.fly.dev");
  });
});

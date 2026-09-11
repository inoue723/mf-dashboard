import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn<(url: URL) => string>(() => "jwks"),
  jwtVerify:
    vi.fn<
      (
        token: string,
        jwks: string,
        options: { audience: string; issuer: string },
      ) => Promise<{ payload: Record<string, never> }>
    >(),
}));

vi.mock("jose", () => mocks);

const { hasValidCloudflareAccess } = await import("./cloudflare-access");

function request(token?: string, url = "https://dashboard.example.com/api/chat"): Request {
  return new Request(url, {
    headers: token ? { "cf-access-jwt-assertion": token } : {},
  });
}

describe("hasValidCloudflareAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("AUTH_MODE", "");
    vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", "team.cloudflareaccess.com");
    vi.stubEnv("CLOUDFLARE_ACCESS_AUD", "application-audience");
    mocks.jwtVerify.mockResolvedValue({ payload: {} });
  });

  it("verifies the Access JWT signature, issuer, audience, and expiry", async () => {
    await expect(hasValidCloudflareAccess(request("access-token"))).resolves.toBe(true);

    expect(mocks.createRemoteJWKSet).toHaveBeenCalledWith(
      new URL("https://team.cloudflareaccess.com/cdn-cgi/access/certs"),
    );
    expect(mocks.jwtVerify).toHaveBeenCalledWith("access-token", "jwks", {
      audience: "application-audience",
      issuer: "https://team.cloudflareaccess.com",
    });
  });

  it("fails closed when configuration or the assertion is missing", async () => {
    await expect(hasValidCloudflareAccess(request())).resolves.toBe(false);
    vi.stubEnv("CLOUDFLARE_ACCESS_AUD", "");
    await expect(hasValidCloudflareAccess(request("access-token"))).resolves.toBe(false);
    expect(mocks.jwtVerify).not.toHaveBeenCalled();
  });

  it("rejects an invalid Access JWT", async () => {
    mocks.jwtVerify.mockRejectedValue(new Error("expired"));

    await expect(hasValidCloudflareAccess(request("access-token"))).resolves.toBe(false);
  });

  it("allows the explicit demo-data mode without Access", async () => {
    vi.stubEnv("DEMO_MODE", "true");

    await expect(hasValidCloudflareAccess(request())).resolves.toBe(true);
  });

  it.each(["http://localhost:3000/api/chat", "http://127.0.0.1:3000/api/chat"])(
    "allows an explicit loopback-only development session at %s",
    async (url) => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("ALLOW_LOCAL_AUTH_BYPASS", "true");

      await expect(hasValidCloudflareAccess(request(undefined, url))).resolves.toBe(true);
      expect(mocks.jwtVerify).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["production mode", "production", "true", "http://127.0.0.1:3000/api/chat"],
    ["a missing opt-in", "development", "", "http://127.0.0.1:3000/api/chat"],
    ["a non-loopback host", "development", "true", "http://192.0.2.10:3000/api/chat"],
  ])("does not bypass Access for %s", async (_case, nodeEnv, bypass, url) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("ALLOW_LOCAL_AUTH_BYPASS", bypass);

    await expect(hasValidCloudflareAccess(request(undefined, url))).resolves.toBe(false);
    expect(mocks.jwtVerify).not.toHaveBeenCalled();
  });
});

// Decision table: local opt-in and loopback URL are both required in production.
describe("local Docker access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", "");
    vi.stubEnv("CLOUDFLARE_ACCESS_AUD", "");
  });

  it.each([
    ["local", "http://127.0.0.1:8765/api/chat", true],
    ["local", "http://localhost:8765/api/chat", true],
    ["local", "http://[::1]:8765/api/chat", true],
    ["local", "http://192.0.2.10:8765/api/chat", false],
    ["local", "https://dashboard.example.com/api/chat", false],
    ["local", "http://localhost.attacker.example/api/chat", false],
    ["", "http://127.0.0.1:8765/api/chat", false],
    ["unknown", "http://127.0.0.1:8765/api/chat", false],
  ])("mode=%s url=%s allows=%s", async (mode, url, expected) => {
    vi.stubEnv("AUTH_MODE", mode);
    await expect(hasValidCloudflareAccess(request(undefined, url))).resolves.toBe(expected);
    expect(mocks.jwtVerify).not.toHaveBeenCalled();
  });
});

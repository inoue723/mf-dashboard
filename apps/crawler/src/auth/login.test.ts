import { mfUrls } from "@mf-dashboard/meta/urls";
import { errors, type Page } from "playwright";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { debug, getCredentials, getOTP, log } = vi.hoisted(() => ({
  getOTP: vi.fn<() => Promise<string>>(),
  debug: vi.fn<(...args: unknown[]) => void>(),
  getCredentials: vi.fn<() => Promise<{ password: string; username: string }>>(),
  log: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock("../logger.js", () => ({ debug, log }));
vi.mock("./credentials.js", () => ({
  getCredentials,
  getOTP,
}));

import { login } from "./login.js";

function createPage(
  finalUrl: string,
  { abortAccountsOnce = false, viaPassword = false } = {},
): Page {
  let currentUrl: string = mfUrls.auth.signIn;
  let accountsNavigationAborted = false;
  const locator = {
    click: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    fill: vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined),
    first: vi.fn<() => unknown>(),
    waitFor: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  locator.first.mockReturnValue(locator);

  const otpLocator = {
    ...locator,
    first: vi.fn<() => unknown>(),
    waitFor: vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new errors.TimeoutError("OTP input is not visible")),
  };
  otpLocator.first.mockReturnValue(otpLocator);

  return {
    goto: vi.fn<(url: string) => Promise<null>>().mockImplementation(async (url) => {
      if (url === mfUrls.signIn) {
        currentUrl = viaPassword ? mfUrls.auth.password : finalUrl;
      } else if (url === mfUrls.accounts) {
        if (abortAccountsOnce && !accountsNavigationAborted) {
          accountsNavigationAborted = true;
          throw new Error("page.goto: net::ERR_ABORTED");
        }
        currentUrl = finalUrl;
      }
      return null;
    }),
    isClosed: vi.fn<() => boolean>(() => false),
    locator: vi.fn<(selector: string) => unknown>((selector) =>
      selector.includes("one-time-code") ? otpLocator : locator,
    ),
    url: vi.fn<() => string>(() => currentUrl),
    waitForLoadState: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    waitForTimeout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    waitForURL: vi.fn<(matcher: unknown) => Promise<void>>((matcher) => {
      if (typeof matcher === "function") {
        return Promise.reject(new Error("URL did not change"));
      }
      if (typeof matcher === "string") {
        currentUrl = finalUrl;
      }
      return Promise.resolve();
    }),
  } as unknown as Page;
}

describe("login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCredentials.mockResolvedValue({
      username: "user-a@example.com",
      password: "test-password",
    });
  });

  test("rejects when the browser remains on the MFID sign-in page", async () => {
    const page = createPage("https://id.moneyforward.com/sign_in");

    await expect(login(page)).rejects.toThrow("Login failed");
    expect(log).not.toHaveBeenCalledWith("Login successful!");
  });

  test("resolves when the browser reaches Money Forward ME", async () => {
    const page = createPage(mfUrls.accounts, { viaPassword: true });

    await expect(login(page)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("Login successful!");
  });

  test("rejects the public Money Forward home page", async () => {
    const page = createPage(mfUrls.home);

    await expect(login(page)).rejects.toThrow("Login failed");
    expect(log).not.toHaveBeenCalledWith("Login successful!");
  });

  test("retries the authenticated-page probe after aborted navigation", async () => {
    const page = createPage(mfUrls.accounts, {
      abortAccountsOnce: true,
      viaPassword: true,
    });

    await expect(login(page)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("Login successful!");
  });

  test("rejects a lookalike Money Forward origin", async () => {
    const page = createPage("https://moneyforward.com.attacker.example/");

    await expect(login(page)).rejects.toThrow("Login failed");
    expect(log).not.toHaveBeenCalledWith("Login successful!");
  });
});

// These tests exercise error propagation with locator mocks, without HTML fixtures
// or real-service login attempts.
describe("OTP failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCredentials.mockResolvedValue({ username: "user-a@example.com", password: "test-password" });
    getOTP.mockResolvedValue("123456");
  });

  function otpInput(page: Page) {
    return page.locator('input[autocomplete="one-time-code"]').first() as unknown as {
      waitFor: ReturnType<typeof vi.fn<() => Promise<void>>>;
      fill: ReturnType<typeof vi.fn<(value: string) => Promise<void>>>;
    };
  }

  test("OTP取得失敗を握りつぶさず、MEへの移動を開始しない", async () => {
    const page = createPage(mfUrls.accounts);
    vi.mocked(otpInput(page).waitFor).mockResolvedValue(undefined);
    getOTP.mockRejectedValueOnce(new Error("OP_TOTP_FIELD が設定されていません"));
    await expect(login(page)).rejects.toThrow("OP_TOTP_FIELD が設定されていません");
    expect(log).not.toHaveBeenCalledWith("Login successful!");
    expect(debug).not.toHaveBeenCalledWith("MFID OTP not required");
  });

  test("OTP入力中のエラーを不要扱いしない", async () => {
    const page = createPage(mfUrls.accounts);
    const input = otpInput(page);
    vi.mocked(input.waitFor).mockResolvedValue(undefined);
    // Keep the password/email locators independent of the OTP fill failure.
    input.fill = vi.fn<typeof input.fill>().mockRejectedValue(new Error("OTP input failed"));
    await expect(login(page)).rejects.toThrow("OTP input failed");
    expect(debug).not.toHaveBeenCalledWith("MFID OTP not required");
  });

  test("画面検出時のブラウザーエラーを伝播する", async () => {
    const page = createPage(mfUrls.accounts);
    vi.mocked(otpInput(page).waitFor).mockRejectedValue(new Error("Page closed"));
    await expect(login(page)).rejects.toThrow("Page closed");
    expect(getOTP).not.toHaveBeenCalled();
  });

  test("OTP入力成功後は認証を続行する", async () => {
    const page = createPage(mfUrls.accounts, { viaPassword: true });
    vi.mocked(otpInput(page).waitFor).mockResolvedValue(undefined);
    await expect(login(page)).resolves.toBeUndefined();
    expect(otpInput(page).fill).toHaveBeenCalledWith("123456");
    expect(log).toHaveBeenCalledWith("Login successful!");
  });
});

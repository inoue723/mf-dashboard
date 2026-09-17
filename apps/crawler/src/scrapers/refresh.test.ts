import type { Page } from "playwright";
import { describe, expect, test, vi } from "vitest";
import {
  clickBulkRefreshControl,
  BULK_REFRESH_SELECTOR,
  ADVERTISEMENT_CLOSE_SELECTOR,
  getMaxWaitMinutes,
  getRefreshStatus,
  navigateToAccountsPage,
  summarizeRefreshRows,
  type RefreshStatusRow,
} from "./refresh.js";

describe("getMaxWaitMinutes", () => {
  test.each([undefined, "", "0", "-1", "Infinity", "NaN"])(
    "invalid MAX_WAIT_MINUTES=%s は default 値を返す",
    (value) => {
      expect(getMaxWaitMinutes({ MAX_WAIT_MINUTES: value })).toBe(20);
    },
  );

  test("有限の正数を返す", () => {
    expect(getMaxWaitMinutes({ MAX_WAIT_MINUTES: "12.5" })).toBe(12.5);
  });
});

describe("summarizeRefreshRows", () => {
  test.each<{
    expected: { incompleteAccounts: string[]; remainingCount: number };
    name: string;
    rows: RefreshStatusRow[];
  }>([
    {
      name: "更新中のアカウント名と件数を返す",
      rows: [
        { name: "Institution A", statuses: ["更新中"] },
        { name: "Institution B", statuses: ["正常"] },
        { name: "Institution C", statuses: ["更新中"] },
      ],
      expected: {
        incompleteAccounts: ["Institution A", "Institution C"],
        remainingCount: 2,
      },
    },
    {
      name: "複数の状態セルに更新中があれば1件として数える",
      rows: [{ name: "Institution A", statuses: ["更新中", "正常"] }],
      expected: { incompleteAccounts: ["Institution A"], remainingCount: 1 },
    },
    {
      name: "完全一致しない状態は更新中として数えない",
      rows: [
        { name: "Institution A", statuses: ["更新中 → 一時停止中"] },
        { name: "Institution B", statuses: ["再更新中"] },
      ],
      expected: { incompleteAccounts: [], remainingCount: 0 },
    },
    {
      name: "空の行一覧は0件を返す",
      rows: [],
      expected: { incompleteAccounts: [], remainingCount: 0 },
    },
    {
      name: "名称がない更新中行も件数には含める",
      rows: [{ name: null, statuses: [" 更新中 "] }],
      expected: { incompleteAccounts: [], remainingCount: 1 },
    },
    {
      name: "空白のみの名称は除外し更新中行を件数には含める",
      rows: [{ name: " \t ", statuses: ["更新中"] }],
      expected: { incompleteAccounts: [], remainingCount: 1 },
    },
  ])("$name", ({ rows, expected }) => {
    expect(summarizeRefreshRows(rows)).toEqual(expected);
  });
});

describe("getRefreshStatus", () => {
  test("service linkがない更新中行は先頭セルの名称を使う", async () => {
    const statusCells = {
      allTextContents: vi.fn<() => Promise<string[]>>().mockResolvedValue(["更新中"]),
    };
    const nameLink = {
      count: vi.fn<() => Promise<number>>().mockResolvedValue(0),
    };
    const firstCell = {
      textContent: vi.fn<() => Promise<string | null>>().mockResolvedValue(" Institution A "),
    };
    const allCells = {
      first: vi.fn<() => typeof firstCell>().mockReturnValue(firstCell),
    };
    const nameLinkLocator = {
      first: vi.fn<() => typeof nameLink>().mockReturnValue(nameLink),
    };
    const row = {
      locator: vi.fn<
        (selector: string) => typeof statusCells | typeof nameLinkLocator | typeof allCells
      >((selector) => {
        if (selector === "td.account-status") return statusCells;
        if (selector === "td.service a") return nameLinkLocator;
        return allCells;
      }),
    };
    const rows = {
      count: vi.fn<() => Promise<number>>().mockResolvedValue(1),
      nth: vi.fn<() => typeof row>().mockReturnValue(row),
    };
    const page = {
      locator: vi.fn<() => typeof rows>().mockReturnValue(rows),
    } as unknown as Page;

    await expect(getRefreshStatus(page)).resolves.toEqual({
      incompleteAccounts: ["Institution A"],
      remainingCount: 1,
    });
    expect(firstCell.textContent).toHaveBeenCalledOnce();
  });
});

describe("navigateToAccountsPage", () => {
  test.each([
    "page.goto: net::ERR_ABORTED at https://moneyforward.com/accounts",
    "page.goto: Timeout 30000ms exceeded.",
  ])("一時的な遷移エラーを1回だけ再試行する: %s", async (message) => {
    const goto = vi
      .fn<(...args: any[]) => any>()
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValueOnce(null);
    const isClosed = vi.fn<(...args: any[]) => any>().mockReturnValue(false);
    const retryPage = { goto, isClosed } as unknown as Page;

    await navigateToAccountsPage(retryPage, { retryDelayMs: 0 });

    expect(goto).toHaveBeenCalledTimes(2);
    expect(goto).toHaveBeenCalledWith(
      "https://moneyforward.com/accounts",
      expect.objectContaining({ timeout: 60000, waitUntil: "domcontentloaded" }),
    );
  });

  test("Page crashedは再試行せず元のエラーを返す", async () => {
    const error = new Error("page.goto: Page crashed");
    const goto = vi.fn<(...args: any[]) => any>().mockRejectedValue(error);
    const page = {
      goto,
      isClosed: vi.fn<(...args: any[]) => any>().mockReturnValue(false),
    } as unknown as Page;

    await expect(navigateToAccountsPage(page, { retryDelayMs: 0 })).rejects.toBe(error);
    expect(goto).toHaveBeenCalledOnce();
  });
});

describe("clickBulkRefreshControl", () => {
  function createRefreshPage({ advertisement = false } = {}) {
    const close = {
      click: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      first: vi.fn<() => unknown>(),
    };
    close.first.mockReturnValue(close);
    let handler: (locator: import("playwright").Locator) => Promise<void>;
    const refresh = {
      waitFor: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      click: vi.fn<() => Promise<void>>().mockImplementation(async () => {
        if (advertisement) await handler(close as unknown as import("playwright").Locator);
      }),
    };
    const goto = vi.fn<() => Promise<null>>().mockResolvedValue(null);
    const remove = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const page = {
      goto,
      locator: vi.fn<(selector: string) => unknown>((selector) => {
        if (selector === ADVERTISEMENT_CLOSE_SELECTOR) return close;
        if (selector === BULK_REFRESH_SELECTOR) return refresh;
        throw new Error("Unexpected selector");
      }),
      addLocatorHandler: vi
        .fn<(locator: unknown, callback: typeof handler) => Promise<void>>()
        .mockImplementation(async (_locator, callback) => {
          handler = callback;
        }),
      removeLocatorHandler: remove,
    } as unknown as Page;
    return { page, goto, close, refresh, remove };
  }

  test("広告がなくても通信の停止を待たず、表示された一括更新リンクを押す", async () => {
    const { page, goto, refresh, close, remove } = createRefreshPage();
    await clickBulkRefreshControl(page);
    expect(goto).toHaveBeenCalledWith("https://moneyforward.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    expect(refresh.waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 15000 });
    expect(refresh.click).toHaveBeenCalledWith({ timeout: 15000 });
    expect(close.click).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
  });

  test("操作直前に広告が表示されたら閉じてから更新を続行する", async () => {
    const { page, close, refresh, remove } = createRefreshPage({ advertisement: true });
    await clickBulkRefreshControl(page);
    expect(close.click).toHaveBeenCalledWith({ timeout: 5000 });
    expect(refresh.click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  test("広告を閉じられない場合は失敗を伝え、ハンドラーを解除する", async () => {
    const { page, close, remove } = createRefreshPage({ advertisement: true });
    close.click.mockRejectedValueOnce(new Error("Advertisement could not be closed"));
    await expect(clickBulkRefreshControl(page)).rejects.toThrow(
      "Advertisement could not be closed",
    );
    expect(remove).toHaveBeenCalledOnce();
  });

  test("更新ボタンが見つからない場合も失敗を伝え、ハンドラーを解除する", async () => {
    const { page, refresh, remove } = createRefreshPage();
    refresh.waitFor.mockRejectedValueOnce(new Error("Refresh link missing"));
    await expect(clickBulkRefreshControl(page)).rejects.toThrow("Refresh link missing");
    expect(refresh.click).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
  });
});

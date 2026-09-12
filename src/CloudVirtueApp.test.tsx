import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CloudVirtueApp } from "./CloudVirtueApp";

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }

describe("CloudVirtueApp", () => {
  it("logs in with a recovery code and hydrates the cloud records after refresh", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/virtue/auth/recovery/login")) return response({ accountId: "alice", token: "session-token", session: { id: "s1" } });
      if (url.endsWith("/api/virtue/records")) return response([]);
      return response({}, 204);
    });
    const storage = window.localStorage;
    storage.clear();
    render(<CloudVirtueApp baseUrl="http://localhost:8787" storage={storage} />);
    fireEvent.change(screen.getByLabelText("账户标识"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("一次性恢复码"), { target: { value: "1234567890" } });
    fireEvent.click(screen.getByRole("button", { name: "使用恢复码登录" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "退出云端账户" })).toBeInTheDocument());
    expect(storage.getItem("virtue-session-token")).toBe("session-token");
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("http://localhost:8787/api/virtue/records", expect.anything()));
    fetcher.mockRestore();
  });
});

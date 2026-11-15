import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the drop zone", () => {
    render(<App />);
    expect(screen.getByText(/Drop a dead form here/i)).toBeTruthy();
  });
});

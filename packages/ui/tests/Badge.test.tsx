import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Badge } from "../src/Badge";

afterEach(() => {
  cleanup();
});

describe("Badge", () => {
  it("renders safe tier with default label", () => {
    const { container } = render(<Badge tier="safe" />);
    const span = container.querySelector("span");
    expect(screen.getByText("Safe")).toBeDefined();
    expect(span?.className).toContain("bg-green-100");
  });

  it("renders mutating tier with default label", () => {
    const { container } = render(<Badge tier="mutating" />);
    const span = container.querySelector("span");
    expect(screen.getByText("Mutating")).toBeDefined();
    expect(span?.className).toContain("bg-yellow-100");
  });

  it("renders dangerous tier with default label", () => {
    const { container } = render(<Badge tier="dangerous" />);
    const span = container.querySelector("span");
    expect(screen.getByText("Dangerous")).toBeDefined();
    expect(span?.className).toContain("bg-red-100");
  });

  it("renders custom label when provided", () => {
    render(<Badge tier="safe" label="Custom Label" />);
    expect(screen.getByText("Custom Label")).toBeDefined();
  });

  it("applies custom className", () => {
    const { container } = render(<Badge tier="safe" className="custom-class" />);
    const span = container.querySelector("span");
    expect(span?.className).toContain("custom-class");
  });

  it("has correct border colors per tier", () => {
    const { container: safeContainer } = render(<Badge tier="safe" />);
    expect(safeContainer.querySelector("span")?.className).toContain(
      "border-green-200"
    );

    const { container: mutatingContainer } = render(
      <Badge tier="mutating" />
    );
    expect(mutatingContainer.querySelector("span")?.className).toContain(
      "border-yellow-200"
    );

    const { container: dangerousContainer } = render(
      <Badge tier="dangerous" />
    );
    expect(dangerousContainer.querySelector("span")?.className).toContain(
      "border-red-200"
    );
  });
});
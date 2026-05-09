import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Card } from "../src/Card";

describe("Card", () => {
  it("renders children correctly", () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText("Card content")).toBeDefined();
  });

  it("renders title when provided", () => {
    render(<Card title="Test Title">Content</Card>);
    expect(screen.getByText("Test Title")).toBeDefined();
  });

  it("does not render title when not provided", () => {
    const { container } = render(<Card>No title</Card>);
    const heading = container.querySelector("h3");
    expect(heading).toBeNull();
  });

  it("applies custom className", () => {
    const { container } = render(
      <Card className="custom-class">Custom</Card>
    );
    const div = container.querySelector("div");
    expect(div?.className).toContain("custom-class");
  });

  it("has clickable styles when onClick provided", () => {
    const { container } = render(
      <Card onClick={() => {}}>Clickable</Card>
    );
    const div = container.querySelector("div");
    expect(div?.className).toContain("cursor-pointer");
  });

  it("calls onClick when clicked", () => {
    const handleClick = vi.fn();
    render(<Card onClick={handleClick}>Click me</Card>);
    fireEvent.click(screen.getByText("Click me"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("does not have clickable styles when onClick not provided", () => {
    const { container } = render(<Card>Not clickable</Card>);
    const div = container.querySelector("div");
    expect(div?.className).not.toContain("cursor-pointer");
  });

  it("renders with border and shadow styles", () => {
    const { container } = render(<Card>Styled</Card>);
    const div = container.querySelector("div");
    expect(div?.className).toContain("border-gray-200");
    expect(div?.className).toContain("shadow-sm");
  });
});
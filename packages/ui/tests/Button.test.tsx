import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Button } from "../src/Button";

afterEach(() => {
  cleanup();
});

describe("Button", () => {
  it("renders children correctly", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: /click me/i })).toBeDefined();
  });

  it("applies primary variant by default", () => {
    const { container } = render(<Button>Primary</Button>);
    const button = container.querySelector("button");
    expect(button?.className).toContain("bg-blue-600");
  });

  it("applies secondary variant styles", () => {
    const { container } = render(<Button variant="secondary">Secondary</Button>);
    const button = container.querySelector("button");
    expect(button?.className).toContain("bg-gray-200");
  });

  it("applies danger variant styles", () => {
    const { container } = render(<Button variant="danger">Danger</Button>);
    const button = container.querySelector("button");
    expect(button?.className).toContain("bg-red-600");
  });

  it("calls onClick when clicked", () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick when disabled", () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick} disabled>Click me</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("has disabled attribute when disabled", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button").disabled).toBe(true);
  });

  it("applies custom className", () => {
    const { container } = render(<Button className="custom-class">Custom</Button>);
    const button = container.querySelector("button");
    expect(button?.className).toContain("custom-class");
  });

  it("defaults to type button", () => {
    const { container } = render(<Button>Type Button</Button>);
    const button = container.querySelector("button");
    expect(button?.getAttribute("type")).toBe("button");
  });

  it("accepts type prop", () => {
    const { container } = render(<Button type="submit">Submit</Button>);
    const button = container.querySelector("button");
    expect(button?.getAttribute("type")).toBe("submit");
  });
});
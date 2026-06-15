import { afterEach, describe, expect, it, vi } from "vitest";
import { dragEndInsideSelector, isPointerInsideElement } from "./dragHitTesting";

class FakeElement {
  classList = {
    add: vi.fn(),
    remove: vi.fn()
  };
  parent: FakeElement | undefined;
  private rect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  private selectors = new Set<string>();

  constructor(selectors: string[] = []) {
    selectors.forEach((selector) => this.selectors.add(selector));
  }

  appendChild(child: FakeElement) {
    child.parent = this;
  }

  closest(selector: string): FakeElement | null {
    if (this.selectors.has(selector)) {
      return this;
    }
    return this.parent?.closest(selector) ?? null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  setRect(rect: Partial<DOMRect>) {
    this.rect = {
      left: rect.left ?? 0,
      right: rect.right ?? 0,
      top: rect.top ?? 0,
      bottom: rect.bottom ?? 0,
      width: rect.width ?? (rect.right ?? 0) - (rect.left ?? 0),
      height: rect.height ?? (rect.bottom ?? 0) - (rect.top ?? 0)
    };
  }
}

const dragEndEvent = (
  translated: DOMRect | undefined,
  initial: DOMRect | undefined = undefined
) =>
  ({
    active: {
      rect: {
        current: {
          translated,
          initial
        }
      }
    }
  }) as unknown as Parameters<typeof dragEndInsideSelector>[0];

const stubDom = ({
  pointedElement,
  target
}: {
  pointedElement?: FakeElement;
  target?: FakeElement;
}) => {
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("document", {
    elementFromPoint: vi.fn(() => pointedElement),
    querySelector: vi.fn(() => target)
  });
};

describe("dragHitTesting", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("checks whether a pointer is inside an element rect", () => {
    const element = new FakeElement();
    element.setRect({ left: 10, right: 50, top: 20, bottom: 80 });

    expect(isPointerInsideElement(element as unknown as HTMLElement, { x: 30, y: 40 })).toBe(true);
    expect(isPointerInsideElement(element as unknown as HTMLElement, { x: 60, y: 40 })).toBe(false);
    expect(isPointerInsideElement(null, { x: 30, y: 40 })).toBe(false);
  });

  it("treats a pointer over a matching selector descendant as inside", () => {
    const target = new FakeElement([".parking-shelf.is-open"]);
    const child = new FakeElement();
    target.appendChild(child);
    target.setRect({ left: 100, right: 200, top: 100, bottom: 200 });
    stubDom({ pointedElement: child, target });

    expect(
      dragEndInsideSelector(
        dragEndEvent(undefined),
        ".parking-shelf.is-open",
        { x: 20, y: 20 }
      )
    ).toBe(true);
  });

  it("treats an intersecting active drag rect as inside the selector", () => {
    const target = new FakeElement([".parking-shelf.is-open"]);
    target.setRect({ left: 100, right: 200, top: 100, bottom: 200 });
    stubDom({ target });

    expect(
      dragEndInsideSelector(
        dragEndEvent({
          left: 80,
          right: 120,
          top: 120,
          bottom: 160,
          width: 40,
          height: 40
        } as DOMRect),
        ".parking-shelf.is-open"
      )
    ).toBe(true);
  });

  it("returns false when no target selector exists", () => {
    stubDom({});

    expect(
      dragEndInsideSelector(
        dragEndEvent({
          left: 80,
          right: 120,
          top: 120,
          bottom: 160,
          width: 40,
          height: 40
        } as DOMRect),
        ".missing"
      )
    ).toBe(false);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { Camera } from "../camera";

// A `.tsx` file with no JSX in it, deliberately: the two Vitest projects are split by extension,
// and these cases need a real `window`, `document` and event dispatch — `camera.test.ts` next door
// stays in the node project for the pure pan/zoom maths, which needs none of that.
//
// What is under test is the WINDOW-level keydown listener `Camera.attach` installs. It sees every
// keypress in the app, after the element-level handlers have had it, so the question each case
// asks is: whose press was this, and does the map move on it.

let camera: Camera | null = null;
let canvas: HTMLCanvasElement | null = null;

function attachCamera(): Camera {
  const created = new Camera();
  const element = document.createElement("canvas");
  document.body.appendChild(element);
  created.attach(element);
  created.setScreenSize(1000, 800);
  camera = created;
  canvas = element;
  return created;
}

afterEach(() => {
  if (camera && canvas) camera.detach(canvas);
  camera = null;
  canvas = null;
  document.body.innerHTML = "";
});

/** Dispatches a real bubbling keydown from `target`, exactly as a keypress on that element does —
 *  the window listener is the last stop on the bubble path, which is the whole point. */
function pressDown(target: HTMLElement, code = "ArrowDown") {
  target.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));
}

/** How far the camera moved over one 1s frame — a pan is a held-key integration, not an instant
 *  jump, so a direction that was registered shows up only once the ticker runs. */
function panDistance(subject: Camera): number {
  const before = { x: subject.x, y: subject.y };
  subject.update(1000);
  return Math.hypot(subject.x - before.x, subject.y - before.y);
}

describe("Camera keyboard pan — whose keypress was it", () => {
  it("pans on an ArrowDown nothing else claimed (the baseline the guards below stand against)", () => {
    const subject = attachCamera();
    const plain = document.createElement("div");
    document.body.appendChild(plain);

    pressDown(plain);

    expect(panDistance(subject)).toBeGreaterThan(0);
  });

  it("does not pan on an ArrowDown a handler nearer the user already consumed", () => {
    const subject = attachCamera();
    // A Tracker row: an ordinary `<button>`, so no typing-target guard applies to it, whose own
    // ArrowDown handler enters its rich card and calls `preventDefault()`. Before this was
    // honoured the same press entered the card AND started a pan that ran until keyup.
    const row = document.createElement("button");
    row.addEventListener("keydown", (event) => event.preventDefault());
    document.body.appendChild(row);

    pressDown(row);

    expect(panDistance(subject)).toBe(0);
  });

  it("does not pan on a key pressed inside an open card, popover or dialog", () => {
    const subject = attachCamera();
    // The press the case above does not cover: once ArrowDown has entered a card, the user is
    // INSIDE it, and a repeat of the held key is not marked consumed by anything. The map behind
    // the card must still stay put.
    const card = document.createElement("div");
    card.setAttribute("role", "dialog");
    const control = document.createElement("button");
    card.appendChild(control);
    document.body.appendChild(card);

    pressDown(control);

    expect(panDistance(subject)).toBe(0);
  });

  it("releases a held direction on keyup even when the keyup is marked consumed", () => {
    const subject = attachCamera();
    const plain = document.createElement("div");
    document.body.appendChild(plain);

    pressDown(plain);
    expect(panDistance(subject)).toBeGreaterThan(0);

    // The release is deliberately unguarded where the press is guarded: a keyup skipped for any
    // reason leaves the direction held forever and the map panning with no key down anywhere.
    const release = new KeyboardEvent("keyup", { code: "ArrowDown", bubbles: true, cancelable: true });
    plain.addEventListener("keyup", (event) => event.preventDefault(), { once: true });
    plain.dispatchEvent(release);

    expect(panDistance(subject)).toBe(0);
  });
});

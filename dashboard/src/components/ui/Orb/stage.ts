import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";
import type { OrbLook } from "./hooks/useOrbLook.js";
import {
  BLINK_SECONDS,
  blinkOpen,
  CROUCH,
  CROUCH_SECONDS,
  GLANCE_BACK,
  GLANCE_BACK_SECONDS,
  stepSpring,
  type Spring,
} from "./motion.js";
import { fragmentShader, vertexShader } from "./shader.js";

const MAX_PIXEL_RATIO = 2;
const MAX_STEP_SECONDS = 1 / 30;
// The pointer counts as resting once it has been still this long.
const REST_SECONDS = 0.7;

const between = (low: number, high: number): number =>
  low + Math.random() * (high - low);

// Draws the orb on `canvas` and keeps it alive. The ring drifts; the
// eyes follow the pointer, look around when it rests, and blink; now
// and then, and when pressed, the orb hops. Every move starts with a
// small one the other way and settles past its end. With `motion`
// "still" it is drawn once. Returns what stops it and frees the canvas.
// Undefined when the browser cannot draw it.
export const startOrb = (
  canvas: HTMLCanvasElement,
  look: OrbLook,
  motion: "moving" | "still",
): (() => void) | undefined => {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
  } catch {
    return undefined;
  }
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO),
  );
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  const gaze = new Vector2(0, 0);
  const uniforms = {
    uTime: { value: 0 },
    uHue: { value: look.hue },
    uTurn: { value: look.turn },
    uGaze: { value: gaze },
    uOpen: { value: 1 },
    uPupil: { value: 1 },
    uStretch: { value: 1 },
    uLift: { value: 0 },
    uPulse: { value: 0 },
    uEye: { value: new Vector2(look.eyeWidth, look.eyeHeight) },
    uGap: { value: look.eyeGap },
  };
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    uniforms,
  });
  const geometry = new PlaneGeometry(2, 2);
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // Where the eyes are asked to look, and the glance that takes them
  // there: it pulls back from `from` before `goAt`, then goes.
  const wanted = new Vector2(0, 0);
  const glance = { from: new Vector2(0, 0), goAt: 0 };
  let gazeX: Spring = { at: 0, speed: 0 };
  let gazeY: Spring = { at: 0, speed: 0 };
  let stretch: Spring = { at: 1, speed: 0 };
  let lift: Spring = { at: 0, speed: 0 };
  let pupil: Spring = { at: 1, speed: 0 };
  let pupilWanted = 1;

  let now = 0;
  let movedAt = -REST_SECONDS;
  let blinkAt = between(1.5, 4);
  let wanderAt = between(2, 4);
  let hopAt = between(4, 8);
  let jumpAt = Number.POSITIVE_INFINITY;

  const lookAt = (x: number, y: number): void => {
    glance.from.set(gazeX.at, gazeY.at);
    glance.goAt = now + GLANCE_BACK_SECONDS;
    wanted.set(x, y);
  };

  const follow = (event: PointerEvent): void => {
    const box = canvas.getBoundingClientRect();
    const x = event.clientX - (box.left + box.width / 2);
    const y = -(event.clientY - (box.top + box.height / 2));
    const reach = Math.max(box.width, 1) * 2;
    const to = new Vector2(x, y).divideScalar(reach).clampLength(0, 1);
    // A pointer that starts moving again is glanced at; one already
    // being followed is just followed.
    if (now - movedAt > REST_SECONDS) lookAt(to.x, to.y);
    else wanted.copy(to);
    movedAt = now;
  };
  const hop = (): void => {
    if (jumpAt !== Number.POSITIVE_INFINITY) return;
    jumpAt = now + CROUCH_SECONDS;
  };
  const widen = (): void => {
    pupilWanted = 1.22;
  };
  const narrow = (): void => {
    pupilWanted = 1;
  };

  let frame = 0;
  let last = performance.now();
  const draw = (): void => {
    const time = performance.now();
    const step = Math.min((time - last) / 1000, MAX_STEP_SECONDS);
    last = time;
    now += step;
    uniforms.uTime.value = now;

    // With the pointer at rest, the eyes look around on their own.
    if (now - movedAt > REST_SECONDS && now > wanderAt) {
      const far = Math.random() < 0.3 ? 0 : between(0.35, 0.9);
      const way = between(0, Math.PI * 2);
      lookAt(Math.cos(way) * far, Math.sin(way) * far * 0.6);
      wanderAt = now + between(1.2, 3.5);
    }
    const back = now < glance.goAt;
    const toX = back
      ? glance.from.x - (wanted.x - glance.from.x) * GLANCE_BACK
      : wanted.x;
    const toY = back
      ? glance.from.y - (wanted.y - glance.from.y) * GLANCE_BACK
      : wanted.y;
    gazeX = stepSpring(gazeX, toX, step, 170, 13);
    gazeY = stepSpring(gazeY, toY, step, 170, 13);
    gaze.set(gazeX.at, gazeY.at);

    const sinceBlink = now - blinkAt;
    if (sinceBlink > BLINK_SECONDS) blinkAt = now + between(2.2, 6);
    uniforms.uOpen.value = blinkOpen(sinceBlink);

    // A hop crouches first, then springs up and lands past its rest.
    if (now > hopAt) {
      hop();
      hopAt = now + between(5, 11);
    }
    const crouching =
      now < jumpAt && jumpAt !== Number.POSITIVE_INFINITY;
    if (!crouching && jumpAt !== Number.POSITIVE_INFINITY) {
      stretch.speed += 3.4;
      lift.speed += 1.5;
      jumpAt = Number.POSITIVE_INFINITY;
    }
    stretch = stepSpring(
      stretch,
      crouching ? CROUCH : 1,
      step,
      210,
      11,
    );
    lift = stepSpring(lift, crouching ? -0.05 : 0, step, 150, 10);
    uniforms.uStretch.value = Math.min(Math.max(stretch.at, 0.8), 1.16);
    uniforms.uLift.value = Math.min(Math.max(lift.at, -0.08), 0.14);
    uniforms.uPulse.value = Math.max(stretch.at - 1, 0) * 6;

    pupil = stepSpring(pupil, pupilWanted, step, 200, 14);
    uniforms.uPupil.value = pupil.at;

    renderer.render(scene, camera);
    if (motion === "moving") frame = requestAnimationFrame(draw);
  };

  if (motion === "moving") {
    window.addEventListener("pointermove", follow);
    canvas.addEventListener("pointerenter", widen);
    canvas.addEventListener("pointerleave", narrow);
    canvas.addEventListener("pointerdown", hop);
  }
  draw();

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", follow);
    canvas.removeEventListener("pointerenter", widen);
    canvas.removeEventListener("pointerleave", narrow);
    canvas.removeEventListener("pointerdown", hop);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
};

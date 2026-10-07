export const vertexShader = /* glsl */ `
varying vec2 vPoint;

void main() {
  vPoint = uv * 2.0 - 1.0;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Draws the whole orb on one flat sheet: a dark ball, a ring of light
// around it, and two cartoon eyes. Lengths are fractions of the sheet's
// half.
export const fragmentShader = /* glsl */ `
precision highp float;

varying vec2 vPoint;

uniform float uTime;
uniform float uHue;
uniform float uTurn;
uniform vec2 uGaze;
uniform float uOpen;
uniform float uPupil;
uniform float uStretch;
uniform float uLift;
uniform float uPulse;
uniform vec2 uEye;
uniform float uGap;

const float TAU = 6.28318530718;
const float RING = 0.72;

vec3 tint(float at) {
  return 0.56 + 0.44 * cos(TAU * (at + vec3(0.0, 0.33, 0.67)));
}

float roundedBox(vec2 point, vec2 half_, float corner) {
  vec2 outside = abs(point) - half_ + corner;
  return length(max(outside, 0.0)) + min(max(outside.x, outside.y), 0.0)
    - corner;
}

float segment(vec2 point, vec2 from, vec2 to) {
  vec2 along = to - from;
  float part = clamp(dot(point - from, along) / dot(along, along), 0.0, 1.0);
  return length(point - from - along * part);
}

// One eye around point, drawn the way a cartoon draws it: a white
// with a tall coloured iris, a thick lash line over it that ends in
// two lashes at the outer corner, and a brow above. side is -1 for
// the left eye and 1 for the right, so the outer corners face away
// from each other. A shut eye is its lash line alone, curved like a
// bowl. Returns the eye's colour, and how much of it covers.
vec4 eye(vec2 point, float side, vec3 light) {
  float shut = clamp(1.0 - uOpen, 0.0, 1.0);
  vec2 size = vec2(uEye.x * (1.0 + shut * 0.16), uEye.y * max(uOpen, 0.02));
  // Outward is +x for both eyes from here on.
  vec2 at = vec2(point.x * side, point.y);
  at.y += shut * uEye.y * 0.34 * (pow(at.x / size.x, 2.0) - 0.5);

  float edge = 0.012;
  float white = smoothstep(edge, -0.004, length(at / size) - 1.0);

  // The lash line: the same shape lifted a little, thicker outward.
  float thick = uEye.y * mix(0.12, 0.34, smoothstep(-size.x, size.x, at.x));
  vec2 lifted = (at - vec2(size.x * 0.06, thick)) / (size * vec2(1.08, 1.0));
  float lash = smoothstep(edge, -0.004, length(lifted) - 1.0)
    * (1.0 - white);
  vec2 corner = vec2(size.x * 0.98, size.y * 0.42 + thick * 0.6);
  float ticks = min(
    segment(at, corner, corner + uEye.x * vec2(0.42, 0.3)),
    segment(
      at,
      corner - vec2(0.0, size.y * 0.3),
      corner + uEye.x * vec2(0.46, -0.06)
    )
  );
  lash = max(lash, smoothstep(0.02, 0.008, ticks));

  float browAt = uEye.y * 1.62 + (uOpen - 1.0) * uEye.y * 0.7
    - 0.9 * uEye.y * pow(at.x / uEye.x - 0.1, 2.0) * 0.32;
  float brow = smoothstep(0.016, 0.006, abs(at.y - browAt))
    * smoothstep(uEye.x * 1.05, uEye.x * 0.8, abs(at.x - uEye.x * 0.1));

  // The iris slides toward where the orb looks.
  vec2 irisSize = vec2(uEye.x * 0.62, uEye.y * 0.9) * uPupil;
  vec2 irisAt = point - uGaze * (uEye - irisSize * 0.8);
  float irisEdge = length(irisAt / irisSize);
  float iris = smoothstep(1.0, 0.94, irisEdge);
  vec3 irisColour = light * 0.62;

  vec2 glintAt = (irisAt - irisSize * vec2(0.36, 0.42)) / irisSize;
  float glint = smoothstep(0.3, 0.24, length(glintAt * vec2(1.25, 1.0)));
  vec2 sparkAt = (irisAt - irisSize * vec2(-0.3, -0.52)) / irisSize;
  float spark = max(
    smoothstep(0.2, 0.15, length(sparkAt)),
    smoothstep(0.1, 0.06, length(sparkAt - vec2(0.3, -0.16)))
  );

  vec3 colour = mix(vec3(1.0), irisColour, iris);
  colour = mix(colour, vec3(1.0), max(glint, spark * 0.85) * iris);
  vec3 line = mix(light, vec3(1.0), 0.72);
  float lines = max(lash, brow * (1.0 - white));
  return vec4(mix(colour, line, lines), max(white, lines));
}

void main() {
  // The whole orb squashes and stretches around its middle, keeping its
  // volume, and lifts off its resting place.
  vec2 body = (vPoint - vec2(0.0, uLift))
    / vec2(inversesqrt(uStretch), uStretch);
  float radius = length(body);
  float angle = atan(body.y, body.x);

  // The ring's colours drift a little around the orb's own hue.
  float drift = 0.1 * sin(angle * 2.0 + uTurn + uTime * 0.35)
    + 0.04 * sin(angle * 5.0 - uTime * 0.5);
  vec3 light = tint(uHue + drift);

  // The ring breathes: thicker and brighter on the side it leans to.
  float lean = 0.5 + 0.5 * cos(angle - uTurn - uTime * 0.25);
  float away = abs(radius - RING);
  float line = smoothstep(mix(0.014, 0.05, lean), 0.0, away);
  float glow = exp(-away * mix(16.0, 6.0, lean));
  float flare = pow(lean, 10.0) * exp(-away * 5.0);

  vec3 colour = vec3(0.018, 0.018, 0.028);
  // A faint light on the ball, just inside the ring.
  float inside = smoothstep(RING, RING - 0.02, radius);
  colour += inside * light * pow(radius / RING, 7.0) * 0.22;
  colour += light * glow * (0.8 + uPulse * 0.5);
  colour += tint(uHue + 0.42) * flare * 0.55;
  colour += mix(light, vec3(1.0), 0.55) * line;

  vec2 face = body - uGaze * 0.06 + vec2(0.0, 0.04);
  vec3 iris = tint(uHue);
  vec4 left = eye(face - vec2(-uGap, 0.0), -1.0, iris);
  vec4 right = eye(face - vec2(uGap, 0.0), 1.0, iris);
  colour = mix(colour, left.rgb, left.a * inside);
  colour = mix(colour, right.rgb, right.a * inside);

  float disc = smoothstep(1.0, 0.985, length(vPoint));
  gl_FragColor = vec4(colour * disc, disc);
}
`;

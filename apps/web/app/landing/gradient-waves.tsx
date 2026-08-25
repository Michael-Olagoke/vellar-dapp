"use client";

import { useEffect, useRef } from "react";

// Ambient hero background — a raymarched wave-plasma shader (ogl/WebGL2),
// adapted from React Bits' GradientWaves for the paper & signals system:
// tuned down from its dark/cinematic default into a quiet mint→lime→sun
// bloom that reads as ink lifting off white paper, not a glow. This is a
// deliberate, scoped exception to "no blur, no glow" — confined to this one
// hero moment, sitting behind the copy at low opacity.
//
// Loaded dynamically (see HeroWaves below) and fully gated on
// prefers-reduced-motion — under reduced motion nothing mounts, the hero's
// static paper ground is complete on its own.

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [1, 1, 1];
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
};

type Detail = "low" | "medium" | "high";

const detailToSteps = (detail: Detail) => (detail === "low" ? 40 : detail === "high" ? 110 : 70);

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaveScale;
uniform float uWaveRatio;
uniform float uSwell;
uniform float uTurbulence;
uniform float uTilt;
uniform float uZoom;
uniform float uHeight;
uniform float uFogDepth;
uniform float uSteps;
uniform float uBrightness;
uniform float uOpacity;
uniform float uGrain;
uniform float uGrainIntensity;
uniform vec2 uMouse;
uniform float uParallax;
uniform bool uEnableMouse;
uniform vec3 uHorizonColor;
uniform vec3 uWaveColor;
uniform vec3 uCrestColor;
out vec4 fragColor;

const float MAX_DIST = 20000.0;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float plasma(vec3 r, vec2 freq, vec4 tc) {
  float mx = r.x + tc.x;
  mx += uSwell * sin((r.y + mx) / 20.0 + tc.y);
  float my = r.y - tc.z;
  my += uTurbulence * cos(r.x / 23.0 + tc.w);
  return r.z - (sin(mx * freq.x) * uAmplitude + sin(my * freq.y) * uAmplitude + uHeight);
}

float raymarch(vec3 pos, vec3 dir, vec2 freq, vec4 tc) {
  float dist = 0.0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps) break;
    float dscene = plasma(pos + dist * dir, freq, tc);
    if (abs(dscene) < 0.1) break;
    dist += 0.9 * dscene;
    if (!(abs(dist) < MAX_DIST)) return MAX_DIST;
  }
  return dist;
}

void main() {
  float T = iTime * uSpeed;
  vec2 freq = vec2(uWaveScale / 7.0, (uWaveScale * uWaveRatio) / 3.0);
  vec4 tc = vec4(T / 0.130, T / 0.810, T / 0.200, T / 0.710);
  float c, s;
  float vfov = (3.14159 / 2.3) / max(uZoom, 0.05);
  vec3 cam = vec3(0.0, 0.0, 30.0);
  vec2 uv = (gl_FragCoord.xy / iResolution.xy) - 0.5;
  uv.x *= iResolution.x / iResolution.y;
  uv.y *= -1.0;

  vec3 dir = vec3(0.0, 0.0, -1.0);
  float ulen = length(uv);
  float xrot = vfov * ulen;
  c = cos(xrot); s = sin(xrot);
  dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  vec2 nuv = ulen > 1e-5 ? uv / ulen : vec2(1.0, 0.0);
  c = nuv.x; s = nuv.y;
  dir = mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0) * dir;
  c = cos(uTilt); s = sin(uTilt);
  dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;

  if (uEnableMouse) {
    float yaw = (uMouse.x - 0.5) * uParallax * 0.4;
    float pitch = (uMouse.y - 0.5) * uParallax * 0.4;
    c = cos(yaw); s = sin(yaw);
    dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;
    c = cos(pitch); s = sin(pitch);
    dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  }

  float dist = raymarch(cam, dir, freq, tc);
  vec3 pos = cam + dist * dir;

  float t = clamp(uFogDepth / max(dist, 0.001), 0.0, 1.0);
  vec3 body = mix(uWaveColor, uCrestColor, clamp(pos.z * 0.08 + 0.5, 0.0, 1.0));
  vec3 col = mix(uHorizonColor, body, t);
  col *= uBrightness;
  col = clamp(col, 0.0, 1.0);

  float alpha = clamp(t, 0.0, 1.0) * uOpacity;
  if (uGrain > 0.5) {
    float g = hash21(gl_FragCoord.xy + mod(iTime, 64.0) * 11.0);
    alpha += (g - 0.5) * uGrainIntensity;
  }
  alpha = clamp(alpha, 0.0, 1.0);
  fragColor = vec4(col * alpha, alpha);
}
`;

export interface GradientWavesProps {
  horizonColor?: string;
  waveColor?: string;
  crestColor?: string;
  speed?: number;
  amplitude?: number;
  waveScale?: number;
  waveRatio?: number;
  swell?: number;
  turbulence?: number;
  tilt?: number;
  zoom?: number;
  height?: number;
  fogDepth?: number;
  detail?: Detail;
  brightness?: number;
  opacity?: number;
  mouseInteraction?: boolean;
  parallaxStrength?: number;
  grain?: boolean;
  grainIntensity?: number;
  className?: string;
}

interface Ctx {
  program: import("ogl").Program;
}

const ctxMap = new WeakMap<HTMLDivElement, Ctx>();

export function GradientWaves({
  horizonColor = "#f5f9f6",
  waveColor = "#3ee6ad",
  crestColor = "#ffc94a",
  speed = 0.4,
  amplitude = 2.5,
  waveScale = 0.6,
  waveRatio = 0.9,
  swell = 35,
  turbulence = 20,
  tilt = 1.11,
  zoom = 1.0,
  height = 5.5,
  fogDepth = 15,
  detail = "medium",
  brightness = 1.0,
  opacity = 1.0,
  mouseInteraction = true,
  parallaxStrength = 0.5,
  grain = true,
  grainIntensity = 0.05,
  className = "",
}: GradientWavesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const enableMouseRef = useRef(mouseInteraction);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const { Renderer, Program, Mesh, Triangle } = await import("ogl");
      if (cancelled || !container) return;

      const renderer = new Renderer({
        webgl: 2,
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      });

      const gl = renderer.gl;
      gl.clearColor(0, 0, 0, 0);
      const canvas = gl.canvas;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      container.appendChild(canvas);

      const geometry = new Triangle(gl);
      const program = new Program(gl, {
        vertex,
        fragment,
        uniforms: {
          iTime: { value: 0 },
          iResolution: { value: new Float32Array([1, 1]) },
          uSpeed: { value: speed },
          uAmplitude: { value: amplitude },
          uWaveScale: { value: waveScale },
          uWaveRatio: { value: waveRatio },
          uSwell: { value: swell },
          uTurbulence: { value: turbulence },
          uTilt: { value: tilt },
          uZoom: { value: zoom },
          uHeight: { value: height },
          uFogDepth: { value: fogDepth },
          uSteps: { value: detailToSteps(detail) },
          uBrightness: { value: brightness },
          uOpacity: { value: opacity },
          uGrain: { value: grain ? 1 : 0 },
          uGrainIntensity: { value: grainIntensity },
          uMouse: { value: new Float32Array([0.5, 0.5]) },
          uParallax: { value: parallaxStrength },
          uEnableMouse: { value: mouseInteraction },
          uHorizonColor: { value: new Float32Array(hexToRgb(horizonColor)) },
          uWaveColor: { value: new Float32Array(hexToRgb(waveColor)) },
          uCrestColor: { value: new Float32Array(hexToRgb(crestColor)) },
        },
      });

      const mesh = new Mesh(gl, { geometry, program });
      ctxMap.set(container, { program });

      const setSize = () => {
        const rect = container.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width));
        const h = Math.max(1, Math.floor(rect.height));
        renderer.setSize(w, h);
        const res = program.uniforms.iResolution!.value as Float32Array;
        res[0] = gl.drawingBufferWidth;
        res[1] = gl.drawingBufferHeight;
        renderer.render({ scene: mesh });
      };

      const ro = new ResizeObserver(setSize);
      ro.observe(container);
      setSize();

      const currentMouse = [0.5, 0.5];
      const targetMouse = [0.5, 0.5];

      const onPointerMove = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        targetMouse[0] = (e.clientX - rect.left) / rect.width;
        targetMouse[1] = 1.0 - (e.clientY - rect.top) / rect.height;
      };
      const onPointerLeave = () => {
        targetMouse[0] = 0.5;
        targetMouse[1] = 0.5;
      };
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", onPointerLeave);

      let raf = 0;
      let isVisible = true;
      let isPageVisible = !document.hidden;
      const t0 = performance.now();

      const loop = (t: number) => {
        (program.uniforms.iTime!.value as number) = (t - t0) * 0.001;
        const tx = enableMouseRef.current ? targetMouse[0]! : 0.5;
        const ty = enableMouseRef.current ? targetMouse[1]! : 0.5;
        currentMouse[0] = currentMouse[0]! + 0.05 * (tx - currentMouse[0]!);
        currentMouse[1] = currentMouse[1]! + 0.05 * (ty - currentMouse[1]!);
        const mouseVal = program.uniforms.uMouse!.value as Float32Array;
        mouseVal[0] = currentMouse[0]!;
        mouseVal[1] = currentMouse[1]!;
        renderer.render({ scene: mesh });
        raf = requestAnimationFrame(loop);
      };

      const tryStart = () => {
        if (isVisible && isPageVisible && raf === 0) raf = requestAnimationFrame(loop);
      };
      const tryStop = () => {
        if (raf !== 0) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      };

      const io = new IntersectionObserver(
        ([entry]) => {
          isVisible = entry?.isIntersecting ?? true;
          isVisible ? tryStart() : tryStop();
        },
        { threshold: 0 },
      );
      io.observe(container);

      const onVisibility = () => {
        isPageVisible = !document.hidden;
        isPageVisible ? tryStart() : tryStop();
      };
      document.addEventListener("visibilitychange", onVisibility);

      tryStart();

      cleanup = () => {
        tryStop();
        ro.disconnect();
        io.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerleave", onPointerLeave);
        ctxMap.delete(container);
        try {
          container.removeChild(canvas);
        } catch {
          /* already removed */
        }
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once; prop updates handled below
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ctx = ctxMap.get(container);
    if (!ctx) return;
    const u = ctx.program.uniforms;

    enableMouseRef.current = mouseInteraction;

    (u.uSpeed!.value as number) = speed;
    (u.uAmplitude!.value as number) = amplitude;
    (u.uWaveScale!.value as number) = waveScale;
    (u.uWaveRatio!.value as number) = waveRatio;
    (u.uSwell!.value as number) = swell;
    (u.uTurbulence!.value as number) = turbulence;
    (u.uTilt!.value as number) = tilt;
    (u.uZoom!.value as number) = zoom;
    (u.uHeight!.value as number) = height;
    (u.uFogDepth!.value as number) = fogDepth;
    (u.uSteps!.value as number) = detailToSteps(detail);
    (u.uBrightness!.value as number) = brightness;
    (u.uOpacity!.value as number) = opacity;
    (u.uGrain!.value as number) = grain ? 1 : 0;
    (u.uGrainIntensity!.value as number) = grainIntensity;
    (u.uParallax!.value as number) = parallaxStrength;
    (u.uEnableMouse!.value as boolean) = mouseInteraction;
    const [hr, hg, hb] = hexToRgb(horizonColor);
    const [wr, wg, wb] = hexToRgb(waveColor);
    const [cr, cg, cb] = hexToRgb(crestColor);
    const hc = u.uHorizonColor!.value as Float32Array;
    const wc = u.uWaveColor!.value as Float32Array;
    const cc = u.uCrestColor!.value as Float32Array;
    hc[0] = hr;
    hc[1] = hg;
    hc[2] = hb;
    wc[0] = wr;
    wc[1] = wg;
    wc[2] = wb;
    cc[0] = cr;
    cc[1] = cg;
    cc[2] = cb;
  }, [
    horizonColor,
    waveColor,
    crestColor,
    speed,
    amplitude,
    waveScale,
    waveRatio,
    swell,
    turbulence,
    tilt,
    zoom,
    height,
    fogDepth,
    detail,
    brightness,
    opacity,
    grain,
    grainIntensity,
    mouseInteraction,
    parallaxStrength,
  ]);

  return <div ref={containerRef} className={`lp-gradient-waves ${className}`.trim()} />;
}

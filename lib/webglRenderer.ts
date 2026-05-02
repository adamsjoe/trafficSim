/**
 * WebGL point-sprite renderer for TrafficSim.
 *
 * All cars are batched into a single Float32Array and drawn with one
 * gl.drawArrays call — handles 100k+ cars at 60fps comfortably.
 *
 * Layout: [x, y, r, g, b]  ×  N  (5 floats per car)
 */

const VERT = `
  attribute vec2  a_pos;
  attribute vec3  a_col;

  uniform vec2    u_res;
  uniform float   u_size;

  varying vec3    v_col;

  void main() {
    // Flip Y: canvas origin is top-left, clip space is bottom-left
    vec2 clip = vec2(
      (a_pos.x / u_res.x) * 2.0 - 1.0,
     -(a_pos.y / u_res.y) * 2.0 + 1.0
    );
    gl_Position  = vec4(clip, 0.0, 1.0);
    gl_PointSize = u_size * 2.2;
    v_col = a_col;
  }
`;

const FRAG = `
  precision mediump float;
  varying vec3 v_col;
  uniform float u_glow;

  void main() {
    // gl_PointCoord is 0..1 across the point sprite
    vec2  pc = gl_PointCoord - 0.5;  // -0.5..0.5
    float d  = length(pc) * 2.0;      // 0 = centre, 1 = edge

    if (d > 1.0) discard;

    // Hard core + soft glow falloff
    float core = 1.0 - smoothstep(0.0, 0.45, d);
    float glow = (1.0 - d) * u_glow * 0.35;
    float alpha = clamp(core + glow, 0.0, 1.0);

    gl_FragColor = vec4(v_col, alpha);
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile error: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

export interface WebGLRenderer {
  canvas: HTMLCanvasElement;
  resize(w: number, h: number): void;
  draw(data: Float32Array, count: number, pointSize: number, glowRadius: number): void;
  clear(): void;
  destroy(): void;
}

export function createWebGLRenderer(container: HTMLElement): WebGLRenderer {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = [
    'position:absolute',
    'top:0',
    'left:0',
    'pointer-events:none',
    'z-index:601',
  ].join(';');
  container.appendChild(canvas);

  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    stencil: false,
  });

  if (!gl) throw new Error('WebGL not available');

  // ── Compile program ──────────────────────────────────────────────────────────
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER,   VERT));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  // ── Uniforms ────────────────────────────────────────────────────────────────
  const uRes  = gl.getUniformLocation(prog, 'u_res')!;
  const uSize = gl.getUniformLocation(prog, 'u_size')!;
  const uGlow = gl.getUniformLocation(prog, 'u_glow')!;

  // ── Attributes ──────────────────────────────────────────────────────────────
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  const aCol = gl.getAttribLocation(prog, 'a_col');

  // ── Buffer ──────────────────────────────────────────────────────────────────
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);

  const STRIDE = 5 * 4; // 5 floats × 4 bytes

  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, STRIDE, 0);

  gl.enableVertexAttribArray(aCol);
  gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, STRIDE, 2 * 4);

  // ── Blend ────────────────────────────────────────────────────────────────────
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  let currentW = 0;
  let currentH = 0;

  return {
    canvas,

    resize(w: number, h: number) {
      if (w === currentW && h === currentH) return;
      currentW = w; currentH = h;
      canvas.width  = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog);
      gl.uniform2f(uRes, w, h);
    },

    draw(data: Float32Array, count: number, pointSize: number, glowRadius: number) {
      if (count === 0) return;
      gl.useProgram(prog);
      gl.uniform1f(uSize, pointSize);
      gl.uniform1f(uGlow, glowRadius);

      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);

      // Re-bind attrib pointers after bufferData
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, STRIDE, 0);
      gl.enableVertexAttribArray(aCol);
      gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, STRIDE, 2 * 4);

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, count);
    },

    clear() {
      gl.clear(gl.COLOR_BUFFER_BIT);
    },

    destroy() {
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      canvas.remove();
    },
  };
}

// ── Hex colour → [r, g, b] floats 0..1 ────────────────────────────────────────
const hexCache = new Map<string, [number, number, number]>();

export function hexToRgb(hex: string): [number, number, number] {
  const cached = hexCache.get(hex);
  if (cached) return cached;
  const n = parseInt(hex.slice(1), 16);
  const v: [number, number, number] = [
    ((n >> 16) & 0xff) / 255,
    ((n >>  8) & 0xff) / 255,
    ( n        & 0xff) / 255,
  ];
  hexCache.set(hex, v);
  return v;
}

// Ground mist: fog that lies on the floor, thickest at ankle height and thinning out upward,
// gathering in drifting patches and pouring down into the chasm round the arena.
//
// It's worked into three.js's own fog (on top of the distance fog the scene already has), so
// every surface gets it from where it really is in the world: no flat sheets, no edges. For
// each pixel it adds up how much mist lies along the line from the camera to that point
// (lots when the line skims the floor, little when it's up in the air), and how thick the
// drifting patches are there. The arena gets the full amount, the rest of the level a thinner
// version.
import * as THREE from 'three';

export const GROUND_FOG = {
  density: 0.16, // per meter, at floor level, at the thickest
  height: 0.9, // meters: every this much higher, the mist thins out to about a third
  lowest: -1.6, // meters: below this (down in the chasm) it stops getting any thicker
  elsewhere: 0.35, // share of the arena's mist outside the arena
  colour: [0.1, 0.115, 0.155], // moonlit: lighter and bluer than the night haze (linear RGB)
  drift: [0.25, 0.09], // m/s the patches drift
};

// `arena`: { x, z, radius } where the full-strength mist is (it fades out over 8 m beyond).
export function installGroundFog(arena) {
  const time = { value: 0 };
  const f = (n) => n.toFixed(4);

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
    #ifdef USE_FOG
      varying float vFogDepth;
      varying vec3 vFogWorld;
    #endif
  `;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
    #ifdef USE_FOG
      vFogDepth = - mvPosition.z;
      // The point in the world (the view matrix only turns and moves, so its transpose undoes the turn).
      vFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
    #endif
  `;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying float vFogDepth;
      varying vec3 vFogWorld;
      uniform float groundFogTime;
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
      float groundFogHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float groundFogNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(groundFogHash(i), groundFogHash(i + vec2(1, 0)), u.x),
                   mix(groundFogHash(i + vec2(0, 1)), groundFogHash(i + vec2(1, 1)), u.x), u.y);
      }
      // How much ground mist lies between the camera and this point (0..1). "shade" is how
      // brightly the mist there catches the moonlight: thick billows lighter, thin parts darker.
      float groundFog(out float shade) {
        const float k = 1.0 / ${f(GROUND_FOG.height)};
        vec3 ray = vFogWorld - cameraPosition;
        float h0 = max(cameraPosition.y, ${f(GROUND_FOG.lowest)});
        float h1 = max(vFogWorld.y, ${f(GROUND_FOG.lowest)});
        // Average thickness along the line: the mist thins as e^(-k * height).
        float dh = h1 - h0;
        float along = abs(dh) > 0.001 ? (exp(-k * h0) - exp(-k * h1)) / (k * dh) : exp(-k * h0);
        // Drifting patches, thick and thin.
        vec2 p = vFogWorld.xz * 0.09;
        vec2 drift = vec2(${f(GROUND_FOG.drift[0])}, ${f(GROUND_FOG.drift[1])}) * 0.09 * groundFogTime;
        float n = groundFogNoise(p - drift) * 0.65 + groundFogNoise(p * 2.7 + drift.yx * 1.7) * 0.35;
        float billows = groundFogNoise(p * 0.35 + drift * 0.6); // big slow swells
        n = n * (0.6 + 0.8 * billows);
        float patches = 0.08 + 1.9 * n * n;
        shade = mix(0.45, 1.3, smoothstep(0.15, 0.75, n));
        // Full strength in the arena (out past its walls), thinner elsewhere.
        float inArena = 1.0 - smoothstep(${f(arena.radius)}, ${f(arena.radius + 8)}, distance(vFogWorld.xz, vec2(${f(arena.x)}, ${f(arena.z)})));
        float density = ${f(GROUND_FOG.density)} * mix(${f(GROUND_FOG.elsewhere)}, 1.0, inArena);
        return 1.0 - exp(-density * length(ray) * along * patches);
      }
    #endif
  `;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
      #else
        float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
      #endif
      gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
      float mistShade;
      float mist = groundFog(mistShade);
      gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3(${GROUND_FOG.colour.map(f).join(', ')}) * mistShade, mist );
    #endif
  `;

  // Every material that has fog gets the shared clock (a material with its own onBeforeCompile
  // that doesn't pass it on just gets mist that holds still).
  const original = THREE.Material.prototype.onBeforeCompile;
  THREE.Material.prototype.onBeforeCompile = function (shader, renderer) {
    if (shader.fragmentShader.includes('fog_pars_fragment')) shader.uniforms.groundFogTime = time;
    original.call(this, shader, renderer);
  };

  return {
    update(seconds) {
      time.value = seconds;
    },
  };
}

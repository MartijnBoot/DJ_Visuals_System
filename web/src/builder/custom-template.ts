// What "Add an effect → Custom" starts from (B-03 spec AC15, SD9, SD14). It follows the custom
// effect contract in `docs/custom-effects.md`: the body of a function that returns a `vec3`,
// reading the picture before it through `source(uv)` and its one parameter through `param[0]`.
// With the parameter at 0 it passes the picture through unchanged, so adding it changes nothing
// until it is edited.

export const CUSTOM_TEMPLATE = {
  label: "Custom",
  params: [{ name: "amount", value: 0 }],
  code: `// The picture before this effect, at this pixel.
vec3 colour = source(uv);
// Toward its negative by the "amount" parameter: at 0 the picture passes through.
return mix(colour, vec3(1.0) - colour, param[0]);`,
} as const;

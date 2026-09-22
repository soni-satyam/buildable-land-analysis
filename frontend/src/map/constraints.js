/**
 * Single list of constraint layers. Everything on the frontend (map layers,
 * legend colours, layer toggles, setback sliders, request payload) is built
 * from this. To add a constraint, add one entry here and a matching block
 * under `constraints:` in config/setbacks.yaml - `id` must be identical.
 *
 *   id       key used by the backend (breakdown rows, request overrides, layers)
 *   label    name in the layer list, legend and breakdown
 *   color    map / legend colour          opacity  map fill opacity
 *   slider   (optional) buffer slider in the left panel: { label, min, max, step, default }
 *   toggle   (optional) on/off checkbox:               { label, default }
 */
export const CONSTRAINTS = [
    // { 
    //     id: "pipelines", label: "Pipelines", color: "#c2185b", opacity: 0.4,
    //     slider: { label: "Pipeline buffer", min: 0, max: 200, step: 5, default: 25 } 
    // },
  {
    id: "wetlands", label: "Wetlands", color: "#2b8fb3", opacity: 0.40,
    slider: { label: "Wetland buffer", min: 0, max: 300, step: 5, default: 50 },
  },
  {
    id: "fema_flood", label: "FEMA flood zones", color: "#5b6fd6", opacity: 0.30,
    toggle: { label: "Exclude FEMA flood zones", default: true },
  },
  {
    id: "buildings", label: "Building footprints/buffers", color: "#8a6d3b", opacity: 0.50,
    slider: { label: "Building setback", min: 0, max: 300, step: 5, default: 50 },
  },
  {
    id: "transmission", label: "Transmission lines", color: "#d98a1e", opacity: 0.40,
    slider: { label: "Transmission buffer", min: 0, max: 400, step: 10, default: 100 },
  },
];

export const CONSTRAINT_IDS = CONSTRAINTS.map((c) => c.id);

/** Default values in the same shape the backend expects as `constraint_settings`. */
export function defaultConstraintSettings() {
  return Object.fromEntries(
    CONSTRAINTS.map((c) => {
      const s = {};
      if (c.slider) s.buffer_ft = c.slider.default;
      if (c.toggle) s.enabled = c.toggle.default;
      return [c.id, s];
    }),
  );
}

/** Merge saved settings over the defaults, so a newly added constraint still gets its default. */
export function mergeConstraintSettings(saved) {
  const out = defaultConstraintSettings();
  for (const id of Object.keys(out)) out[id] = { ...out[id], ...(saved?.[id] || {}) };
  return out;
}
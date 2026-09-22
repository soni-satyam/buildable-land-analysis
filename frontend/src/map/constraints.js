export const CONSTRAINTS = [
  {
    id: "hgac_buildable",
    label: "H-GAC Buildable Land",
    color: "#7cb342",
    opacity: 0.25,
    toggle: {
      label: "Apply H-GAC eligibility layer",
      default: true,
    },
  },

  {
    id: "wetlands",
    label: "Wetlands",
    color: "#2b8fb3",
    opacity: 0.40,
    slider: {
      label: "Wetland buffer",
      min: 0,
      max: 300,
      step: 5,
      default: 50,
    },
  },

  {
    id: "fema_flood",
    label: "FEMA flood zones",
    color: "#5b6fd6",
    opacity: 0.30,
    toggle: {
      label: "Exclude FEMA flood zones",
      default: true,
    },
  },

  {
    id: "buildings",
    label: "Building footprints/buffers",
    color: "#8a6d3b",
    opacity: 0.50,
    slider: {
      label: "Building setback",
      min: 0,
      max: 300,
      step: 5,
      default: 50,
    },
  },

  {
    id: "transmission",
    label: "Transmission lines",
    color: "#d98a1e",
    opacity: 0.40,
    slider: {
      label: "Transmission buffer",
      min: 0,
      max: 400,
      step: 10,
      default: 100,
    },
  },

  {
    id: "highway",
    label: "Highway buffer",
    color: "#e53935",
    opacity: 0.40,
    slider: {
      label: "Highway buffer",
      min: 0,
      max: 300,
      step: 5,
      default: 50,
    },
  },

  {
    id: "easement",
    label: "Easements",
    color: "#8e24aa",
    opacity: 0.35,
    slider: {
      label: "Easement buffer",
      min: 0,
      max: 200,
      step: 5,
      default: 0,
    },
  },

  {
    id: "row_line",
    label: "Right-of-way",
    color: "#fb8c00",
    opacity: 0.35,
    slider: {
      label: "ROW buffer",
      min: 0,
      max: 200,
      step: 5,
      default: 0,
    },
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
import { BASEMAPS } from "../../map/constants.js";

export default function BasemapSwitcher({ basemap, onChange }) {
  return (
    <div className="basemap-selector">
      {Object.entries(BASEMAPS).map(([key, def]) => (
        <button key={key} className={basemap === key ? "active" : ""}
        onClick={(e) => { onChange(key); e.currentTarget.blur(); }} type="button">
          {def.label}
        </button>
      ))}
    </div>
  );
}
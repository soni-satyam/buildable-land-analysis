# Buildable Land Analysis

A GIS-based web application that helps estimate the **potentially buildable area of a land parcel** by identifying mapped constraints and applying configurable setback distances.

The goal is to provide a quick, visual first-pass assessment of a parcel rather than a final development or regulatory decision.

## How It Works

The analysis follows a simple workflow:

1. Select a land parcel.
2. Load relevant constraint layers around the parcel.
3. Reproject the data to a common projected CRS for accurate distance and area calculations.
4. Apply screening setbacks to selected constraints.
5. Clip the constraints to the parcel.
6. Union overlapping exclusion areas to avoid double-counting.
7. Subtract the resulting exclusion area from the parcel.
8. Display the remaining potentially buildable area on the map.

The application also allows users to manually add or restore areas when the mapped data does not fully represent site conditions.

## Constraints & Setbacks

| Layer              | Treatment           |         Default |
| ------------------ | ------------------- | --------------: |
| Land Parcel        | Analysis boundary   |               — |
| Wetlands           | Buffer              |           50 ft |
| Flood Areas (SFHA) | Exclude mapped area | 0 ft additional |
| Buildings          | Buffer              |           50 ft |
| Transmission Lines | Buffer              |          100 ft |

These are **screening assumptions**, not universal legal setbacks.

The values were chosen as reasonable defaults for an initial feasibility screen. Wetland buffers can vary significantly by jurisdiction and wetland type, while transmission-line restrictions depend on the utility, voltage, and actual right-of-way. Flood requirements also depend on the specific flood zone and local regulations.

The setback values are configurable in:

```text
config/setbacks.yaml
```

## Data Sources

The application uses publicly available GIS data for:

* Land Parcels
* Wetlands
* Flood Hazard Areas
* Building Footprints
* Transmission Lines

### Original Sources

The original public sources are provided below for attribution and future updates.

* **Land Parcels:** [SOURCE LINK]
* **Wetlands:** [SOURCE LINK]
* **Flood Areas:** [SOURCE LINK]
* **Buildings:** [SOURCE LINK]
* **Transmission Lines:** [SOURCE LINK]

### Project Data

The exact GIS files used for this implementation are available here:

**[Google Drive – Project GIS Data](GOOGLE_DRIVE_LINK)**

The Google Drive copy is provided for reproducibility; the original public sources remain the authoritative source for updated data.

## Key Tradeoffs

The application intentionally focuses on a small number of spatial constraints so that the analysis remains simple, fast, and easy to understand.

The main tradeoff is that **"buildable area" does not mean legally developable area**. The current model does not account for factors such as zoning, access, utilities, easements, topography, soil conditions, or all local development regulations.

## Limitations & Next Steps

The results depend on the accuracy and date of the underlying GIS datasets. Public datasets may also contain missing or outdated information.

For a production version, I would add:

* Zoning and land-use rules
* Jurisdiction-specific setbacks
* Utility easements
* Road/access constraints
* Topography and slope
* Dataset versioning and data-age indicators

This would make the analysis more suitable for detailed land due diligence.

## Tech Stack

**Backend:** Python, FastAPI, GeoPandas, Shapely
**Frontend:** React, MapLibre
**Spatial Analysis:** EPSG:2278 for analysis, EPSG:4326 for map display

## Disclaimer

This tool is intended for **preliminary GIS screening and visualization**. The results should not be treated as a legal survey, zoning determination, floodplain certification, or development approval.

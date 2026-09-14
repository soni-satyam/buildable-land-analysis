# Buildable Land Analysis

Given a parcel and a set of constraint layers (wetlands, flood zones, etc.),
compute the buildable area, show it on an interactive map, and let a user
carve out or restore area by hand.

## Structure

```
buildable-land-analysis/
├── backend/                # FastAPI service
│   ├── app/
│   │   ├── main.py         # API routes
│   │   ├── config.py       # loads setback config
│   │   ├── geometry.py     # buffer/subtract/area logic
│   │   ├── models.py       # pydantic request/response schemas
│   │   └── data_loader.py  # loads parcels + constraint layers
│   ├── data/                # (gitignored) downloaded GIS data goes here
│   └── requirements.txt
├── frontend/                # React + MapLibre app
│   ├── src/
│   │   ├── App.jsx
│   │   └── components/Map.jsx
│   ├── index.html
│   └── package.json
├── config/
│   └── setbacks.yaml        # configurable buffer distances, with sources
└── README.md
```

## Quickstart

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Data

Download and place raw data under `backend/data/`:
- Parcels: a Texas county from TNRIS (https://data.tnris.org)
- Wetlands: USFWS National Wetlands Inventory
- (Add a third layer of your choice — flood zones, transmission lines, etc.)

## Notes on area calculation

Areas are computed by reprojecting geometries to an appropriate **equal-area
or state-plane CRS** (e.g. Texas Centric Albers Equal Area, EPSG:6579, or the
relevant UTM zone) before measuring — never directly in EPSG:3857 (Web
Mercator), which distorts area significantly and gets worse away from the
equator. This project intentionally does the correct, defensible thing here.

## Writeup

See `WRITEUP.md` (to be filled in) for approach, tradeoffs, data/setback
sourcing, and known limitations.

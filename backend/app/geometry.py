"""
Core buildable-area logic.

All analytical geometry operations are performed in a projected CRS
appropriate for Harris County (EPSG:2278 by default).

Important:
- Source datasets may use different CRSs.
- The caller is responsible for supplying manual geometries already
  transformed into area_crs.
- Map-facing output is reprojected to EPSG:4326 in main.py.
- Total excluded area is based on the union of all exclusions, so
  overlapping constraints are not double-counted.
"""

from dataclasses import dataclass

import geopandas as gpd
from shapely.geometry import base
from shapely.ops import unary_union


SQ_FT_PER_ACRE = 43560.0
SQ_M_PER_ACRE = 4046.8564224

def _explode_segments(geom):
    """
    Split a Polygon/MultiPolygon/GeometryCollection into a list of
    individual, disjoint Polygon pieces - e.g. two separate wetland
    ponds within a parcel become two separate segments instead of one
    merged shape. Lets the frontend offer each piece as its own
    independently clickable/overridable object, the way an image
    segmentation tool offers each detected object separately.

    Sorted by centroid so segment ordering (and therefore the ids
    assigned to them) is deterministic given the same input geometry.
    """
    if geom is None or geom.is_empty:
        return []

    if geom.geom_type == "Polygon":
        parts = [geom]
    elif geom.geom_type == "MultiPolygon":
        parts = list(geom.geoms)
    elif geom.geom_type == "GeometryCollection":
        parts = []
        for g in geom.geoms:
            if g.geom_type == "Polygon":
                parts.append(g)
            elif g.geom_type == "MultiPolygon":
                parts.extend(list(g.geoms))
    else:
        return []

    parts = [p for p in parts if p is not None and not p.is_empty and p.area > 0]
    parts.sort(key=lambda p: (round(p.centroid.x, 1), round(p.centroid.y, 1)))
    return parts

@dataclass
class LayerResult:
    layer: str
    acres_removed: float
    buffer_ft: float
    reason: str
    geometry: base.BaseGeometry | None = None


def _area_acres(geom, crs_units_are_feet: bool) -> float:
    """Return planar geometry area in acres."""
    if geom is None or geom.is_empty:
        return 0.0

    divisor = SQ_FT_PER_ACRE if crs_units_are_feet else SQ_M_PER_ACRE
    return geom.area / divisor


def _make_valid_geom(geom):
    """Repair a geometry when possible."""
    if geom is None or geom.is_empty:
        return geom

    if not geom.is_valid:
        geom = geom.make_valid()

    return geom


def _to_area_crs(
    gdf: gpd.GeoDataFrame,
    area_crs: str,
) -> gpd.GeoDataFrame:
    """Reproject a GeoDataFrame into the analytical CRS."""
    if gdf.empty:
        return gdf

    if gdf.crs is None:
        raise ValueError("Constraint/parcel layer has no CRS.")

    out = gdf.to_crs(area_crs).copy()

    out["geometry"] = out.geometry.apply(_make_valid_geom)

    return out


def _buffer_ft(
    gdf: gpd.GeoDataFrame,
    buffer_ft: float,
) -> gpd.GeoDataFrame:
    """
    Buffer an already projected, feet-based GeoDataFrame.

    EPSG:2278 uses US survey feet, so buffer_ft can be applied directly.
    """
    if gdf.empty or buffer_ft <= 0:
        return gdf

    out = gdf.copy()
    out["geometry"] = out.geometry.buffer(float(buffer_ft))

    return out


def _safe_union(geometries):
    """Union non-empty geometries safely."""
    valid = [
        _make_valid_geom(g)
        for g in geometries
        if g is not None and not g.is_empty
    ]

    valid = [g for g in valid if g is not None and not g.is_empty]

    if not valid:
        return None

    return unary_union(valid)


def compute_buildable_area(
    parcel_gdf: gpd.GeoDataFrame,
    constraint_layers: dict[str, gpd.GeoDataFrame],
    setback_cfg: dict,
    area_crs: str,
    manual_excludes: list[base.BaseGeometry] | None = None,
    manual_restores: list[base.BaseGeometry] | None = None,
):
    """
    Calculate buildable area.

    Parameters
    ----------
    parcel_gdf:
        Parcel GeoDataFrame in its source CRS.

    constraint_layers:
        Constraint GeoDataFrames in their source CRSs.

    setback_cfg:
        Configurable buffer/setback settings.

    area_crs:
        Projected CRS used for all analytical operations.

    manual_excludes:
        Shapely geometries already transformed into area_crs.

    manual_restores:
        Shapely geometries already transformed into area_crs.

    Returns
    -------
    parcel_acres
    buildable_acres_raw
    breakdown
    excluded_acres
    buildable_geom
    excluded_geom
    """

    # EPSG:2278 is feet-based. For a more general implementation,
    # inspect CRS units rather than relying only on the EPSG number.
    crs_units_are_feet = "2278" in area_crs or "ftUS" in area_crs

    # ---------------------------------------------------------
    # Parcel
    # ---------------------------------------------------------

    parcel_proj = _to_area_crs(parcel_gdf, area_crs)

    parcel_geom = _safe_union(parcel_proj.geometry)

    if parcel_geom is None or parcel_geom.is_empty:
        raise ValueError("Parcel geometry is empty after projection.")

    parcel_geom = _make_valid_geom(parcel_geom)

    parcel_acres = _area_acres(
        parcel_geom,
        crs_units_are_feet,
    )

    breakdown: list[LayerResult] = []
    per_layer_exclusions: list[base.BaseGeometry] = []
    segments: dict[str, list] = {}

    # ---------------------------------------------------------
    # Wetlands
    # ---------------------------------------------------------

    if "wetlands" in constraint_layers:

        cfg = setback_cfg.get("wetlands", {})
        buffer_ft = float(cfg.get("buffer_ft", 0) or 0)

        layer = _to_area_crs(
            constraint_layers["wetlands"],
            area_crs,
        )

        layer = _buffer_ft(
            layer,
            buffer_ft,
        )

        union_geom = _safe_union(layer.geometry)

        clipped = (
            union_geom.intersection(parcel_geom)
            if union_geom is not None
            else None
        )

        acres = _area_acres(
            clipped,
            crs_units_are_feet,
        )

        breakdown.append(
            LayerResult(
                layer="wetlands",
                acres_removed=round(acres, 2),
                buffer_ft=buffer_ft,
                reason="Wetland buffer",
                geometry=clipped
            )
        )

        if clipped is not None and not clipped.is_empty:
            per_layer_exclusions.append(clipped)
        
        segments["wetlands"] = _explode_segments(clipped) 

    # ---------------------------------------------------------
    # FEMA
    # ---------------------------------------------------------

    if "fema" in constraint_layers:

        cfg = setback_cfg.get("fema", {})

        if cfg.get("exclude_sfha", True):

            fema_gdf = _to_area_crs(
                constraint_layers["fema"],
                area_crs,
            )

            if "SFHA_TF" in fema_gdf.columns:
                fema_gdf = fema_gdf[
                    fema_gdf["SFHA_TF"].astype(str).str.upper() == "T"
                ]

            union_geom = _safe_union(fema_gdf.geometry)

            clipped = (
                union_geom.intersection(parcel_geom)
                if union_geom is not None
                else None
            )

            acres = _area_acres(
                clipped,
                crs_units_are_feet,
            )

            breakdown.append(
                LayerResult(
                    layer="fema_flood",
                    acres_removed=round(acres, 2),
                    buffer_ft=0,
                    reason= "Flood zone",
                    geometry=clipped
                )
            )

            if clipped is not None and not clipped.is_empty:
                per_layer_exclusions.append(clipped)

            segments["fema_flood"] = _explode_segments(clipped) 
    # ---------------------------------------------------------
    # Buildings
    # ---------------------------------------------------------

    if "buildings" in constraint_layers:

        cfg = setback_cfg.get("buildings", {})
        buffer_ft = float(cfg.get("buffer_ft", 0) or 0)

        layer = _to_area_crs(
            constraint_layers["buildings"],
            area_crs,
        )

        layer = _buffer_ft(
            layer,
            buffer_ft,
        )

        union_geom = _safe_union(layer.geometry)

        clipped = (
            union_geom.intersection(parcel_geom)
            if union_geom is not None
            else None
        )

        acres = _area_acres(
            clipped,
            crs_units_are_feet,
        )

        breakdown.append(
            LayerResult(
                layer="buildings",
                acres_removed=round(acres, 2),
                buffer_ft=buffer_ft,
                reason="Building setback",
                geometry=clipped
            )
        )

        if clipped is not None and not clipped.is_empty:
            per_layer_exclusions.append(clipped)
        
        segments["buildings"] = _explode_segments(clipped)

    # ---------------------------------------------------------
    # Transmission
    # ---------------------------------------------------------

    if "transmission" in constraint_layers:

        cfg = setback_cfg.get("transmission", {})
        buffer_ft = float(cfg.get("buffer_ft", 0) or 0)

        layer = _to_area_crs(
            constraint_layers["transmission"],
            area_crs,
        )

        layer = _buffer_ft(
            layer,
            buffer_ft,
        )

        union_geom = _safe_union(layer.geometry)

        clipped = (
            union_geom.intersection(parcel_geom)
            if union_geom is not None
            else None
        )

        acres = _area_acres(
            clipped,
            crs_units_are_feet,
        )

        breakdown.append(
            LayerResult(
                layer="transmission",
                acres_removed=round(acres, 2),
                buffer_ft=buffer_ft,
                reason="Power line buffer",
                geometry=clipped
            )
        )

        if clipped is not None and not clipped.is_empty:
            per_layer_exclusions.append(clipped)
        
        segments["transmission"] = _explode_segments(clipped)

    # ---------------------------------------------------------
    # Manual exclusions
    # ---------------------------------------------------------
    natural_excluded_geom = _safe_union(per_layer_exclusions)
    natural_buildable_geom = (
        parcel_geom.difference(natural_excluded_geom)
        if natural_excluded_geom is not None
        else parcel_geom
    )
    natural_buildable_geom = _make_valid_geom(natural_buildable_geom)
    segments["buildable"] = _explode_segments(natural_buildable_geom)
    
    manual_exclude_geoms = []

    for geom in manual_excludes or []:

        geom = _make_valid_geom(geom)

        if geom is None or geom.is_empty:
            continue

        clipped = geom.intersection(parcel_geom)

        if clipped is None or clipped.is_empty:
            continue

        manual_exclude_geoms.append(clipped)

        acres = _area_acres(
            clipped,
            crs_units_are_feet,
        )

        breakdown.append(
            LayerResult(
                layer="manual_exclude",
                acres_removed=round(acres, 2),
                buffer_ft=0,
                reason="Manually excluded",
                geometry=clipped
            )
        )

    # ---------------------------------------------------------
    # Union all exclusions
    # ---------------------------------------------------------

    all_exclusion_parts = [
        g
        for g in (
            per_layer_exclusions +
            manual_exclude_geoms
        )
        if g is not None and not g.is_empty
    ]

    excluded_geom = _safe_union(
        all_exclusion_parts
    )

    excluded_acres_before_restore = _area_acres(
        excluded_geom,
        crs_units_are_feet,
    )
    # ---------------------------------------------------------
    # Manual restores
    # ---------------------------------------------------------

    if excluded_geom is not None:

        for geom in manual_restores or []:

            geom = _make_valid_geom(geom)

            if geom is None or geom.is_empty:
                continue

            restore_clipped = geom.intersection(
                parcel_geom
            )

            if restore_clipped is None or restore_clipped.is_empty:
                continue

            excluded_geom = excluded_geom.difference(
                restore_clipped
            )

            excluded_geom = _make_valid_geom(
                excluded_geom
            )

            if excluded_geom is None or excluded_geom.is_empty:
                excluded_geom = None
                break

    # ---------------------------------------------------------
    # Final buildable geometry
    # ---------------------------------------------------------

    if excluded_geom is None:
        buildable_geom = parcel_geom
    else:
        buildable_geom = parcel_geom.difference(
            excluded_geom
        )

        buildable_geom = _make_valid_geom(
            buildable_geom
        )

    buildable_acres_raw = _area_acres(
        buildable_geom,
        crs_units_are_feet,
    )

    excluded_acres = _area_acres(
        excluded_geom,
        crs_units_are_feet,
    )

    # Guard against tiny floating-point artifacts.
    buildable_acres_raw = max(
        0.0,
        buildable_acres_raw,
    )

    excluded_acres = max(
        0.0,
        excluded_acres,
    )

    # How much area the user's manual restores actually clawed back from
    # the data-driven + manual exclusions. Surfaced separately so the UI
    # can flag it as an override the user should double check, rather than
    # quietly folding it into "buildable" with no distinction.
    restored_acres = max(
        0.0,
        excluded_acres_before_restore - excluded_acres,
    )

    return (
        parcel_acres,
        buildable_acres_raw,
        breakdown,
        excluded_acres,
        buildable_geom,
        excluded_geom,
        restored_acres,
        segments
    )
    
    
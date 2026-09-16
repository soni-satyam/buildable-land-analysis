from pydantic import BaseModel, Field
from typing import Literal, Optional


class GeoJSONGeometry(BaseModel):
    type: str
    coordinates: list


class ConstraintOverride(BaseModel):
    """Optional per-request override of a configured buffer distance."""
    layer: str
    buffer_ft: float


class ManualAdjustment(BaseModel):
    """A user-drawn carve-out (exclude) or add-back (restore) shape."""
    kind: Literal["exclude", "restore"]
    geometry: GeoJSONGeometry


class BuildableAreaRequest(BaseModel):
    parcel_id: Optional[str] = None
    parcel_geometry: Optional[GeoJSONGeometry] = None
    overrides: list[ConstraintOverride] = []
    manual_adjustments: list[ManualAdjustment] = []


class RemovalBreakdownItem(BaseModel):
    layer: str
    acres_removed: float
    buffer_ft: float
    reason: str


class BuildableAreaResponse(BaseModel):
    parcel_acres: float
    buildable_acres: float
    breakdown: list[RemovalBreakdownItem]
    buildable_geometry: GeoJSONGeometry
    excluded_geometry: GeoJSONGeometry

class AnalyzeRequest(BaseModel):
    parcel_id: str

    wetland_buffer_ft: Optional[float] = None
    building_setback_ft: Optional[float] = None
    transmission_buffer_ft: Optional[float] = None

    exclude_sfha: Optional[bool] = None

    user_exclusions: list[ManualAdjustment] = Field(
        default_factory=list
    )

    user_restores: list[ManualAdjustment] = Field(
        default_factory=list
    )
    
class BreakdownItem(BaseModel):
    layer: str
    acres_removed: float
    buffer_ft: float
    reason: str


class AnalyzeResponse(BaseModel):
    parcel_id: str

    parcel_acres: float
    excluded_acres: float
    buildable_acres_raw: float
    buildable_acres: float

    breakdown: list[BreakdownItem]
    note: str

    geometry: dict
    # Per-constraint union geometries (wetlands/fema_flood/buildings/
    # transmission), in EPSG:4326, keyed by the same layer names used in
    # `breakdown`. Only present for layers that had data and a nonzero
    # exclusion. Lets the frontend render each as an independent,
    # toggleable overlay instead of only the combined "excluded" shape.
    layers: dict = Field(default_factory=dict)


class ParcelFeature(BaseModel):
    parcel_id: str
    geometry: GeoJSONGeometry


class ParcelsInBboxResponse(BaseModel):
    parcels: list[ParcelFeature]
    count: int
    truncated: bool
    note: str
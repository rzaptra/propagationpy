from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import numpy as np
import math
import requests
from concurrent.futures import ThreadPoolExecutor
from fastapi.middleware.cors import CORSMiddleware
from scipy.spatial import KDTree
import time
import os

app = FastAPI()
#
# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
    
# Google Elevation API Key
#GOOGLE_API_KEY = "AIzaSyDkAWnE66-S2rVK8XBXPp2LLGVePFEw0x0"  # Replace with your valid Google API key
GOOGLE_API_KEY = "AIzaSyBCaypdlA0GR70B5kVb7EoNeXDsTHQClew"  # Replace with your valid Google API key
ELEVATION_URL = "https://maps.googleapis.com/maps/api/elevation/json"

# Cache for elevation data
elevation_cache = {}

class PropagationRequest(BaseModel):
    site: dict
    model: dict
    resolution: int
    radius: float

def fetch_elevation(points, batch_size=300, max_retries=2, retry_delay=2):
    """
    Fetch elevation data for points using Google Elevation API.
    """
    elevations = []
    uncached_points = []

    unique_points = list({(round(lat, 5), round(lng, 5)) for lat, lng in points})
    for lat, lng in unique_points:
        if (lat, lng) in elevation_cache:
            elevations.append(elevation_cache[(lat, lng)])
        else:
            uncached_points.append((lat, lng))

    retries = 0
    while uncached_points and retries < max_retries:
        retries += 1
        print(f"Fetching elevation for {len(uncached_points)} points (Retry {retries})")

        for i in range(0, len(uncached_points), batch_size):
            batch = uncached_points[i:i + batch_size]
            locations = "|".join([f"{lat},{lng}" for lat, lng in batch])
            params = {"locations": locations, "key": GOOGLE_API_KEY}

            try:
                response = requests.get(ELEVATION_URL, params=params)
                response.raise_for_status()
                data = response.json()

                if "results" in data and len(data["results"]) == len(batch):
                    for point, result in zip(batch, data["results"]):
                        elevation = result.get("elevation", 0)
                        elevation_cache[point] = elevation
                        elevations.append(elevation)
                else:
                    print(f"Incomplete elevation data for batch: {batch}. Using default elevation of 0.")
                    elevations.extend([0] * len(batch))
            except requests.exceptions.RequestException as e:
                print(f"Error fetching elevation for batch: {batch}: {e}. Using default elevation of 0.")
                elevations.extend([0] * len(batch))

        uncached_points = [point for point in uncached_points if point not in elevation_cache]

        if uncached_points:
            print(f"Retrying missing points after {retry_delay} seconds...")
            time.sleep(retry_delay)

    elevation_lookup = {(lat, lng): elevation for (lat, lng), elevation in zip(unique_points, elevations)}
    return [elevation_lookup.get((round(lat, 5), round(lng, 5)), 0) for lat, lng in points]

def fresnel_zone_loss(distance_km, height_diff, frequency_mhz):
    """
    Calculate Fresnel zone loss using knife-edge diffraction.
    """
    if distance_km <= 0 or frequency_mhz <= 0:
        return -140  # Extreme loss for invalid cases

    wavelength_m = 300 / frequency_mhz  # Wavelength in meters
    fresnel_radius = np.sqrt(wavelength_m * distance_km * 1000 / 2)  # First Fresnel zone radius
    if fresnel_radius <= 0:
        return -140  # Extreme loss if Fresnel radius is zero

    if height_diff > fresnel_radius:
        # Fully blocked: severe diffraction loss
        return -20 * np.log10(height_diff / fresnel_radius)
    elif height_diff > 0:
        # Partially blocked: minor diffraction loss
        return -6 * (height_diff / fresnel_radius) ** 2
    else:
        # No obstruction
        return 0

def detailed_los_with_diffraction(site_lat, site_lng, point_lat, point_lng, site_height, point_height, frequency):
    """
    Perform detailed LOS check with diffraction modeling.
    """
    distance_km = np.sqrt((site_lat - point_lat) ** 2 + (site_lng - point_lng) ** 2) * 111
    if distance_km <= 0:
        return False, 20  # Assume blocked LOS for invalid distances

    max_segments = 200
    num_segments = max(10, min(max_segments, int(distance_km * 100)))  # Minimum 10 segments
    lat_step = (point_lat - site_lat) / num_segments
    lng_step = (point_lng - site_lng) / num_segments

    obstruction_loss = 0
    los_clear = True

    for i in range(1, num_segments):
        intermediate_lat = site_lat + i * lat_step
        intermediate_lng = site_lng + i * lng_step
        intermediate_key = (round(intermediate_lat, 5), round(intermediate_lng, 5))

        intermediate_elevation = elevation_cache.get(intermediate_key, 0)
        distance_ratio = i / num_segments
        expected_height = site_height + (point_height - site_height) * distance_ratio

        height_diff = intermediate_elevation - expected_height
        if height_diff > 0:
            los_clear = False
            diffraction_loss = fresnel_zone_loss(distance_km, height_diff, frequency)
            obstruction_loss += diffraction_loss

    normalized_loss = min(20, -obstruction_loss / num_segments)
    return los_clear, normalized_loss

def calculate_rsrp_with_enhanced_los(
    site_lat, site_lng, point_lat, point_lng, frequency, base_height, tx_power, downtilt, environment
):
    """
    Calculate RSRP with enhanced LOS and terrain obstruction modeling.
    """
    mobile_height = 1.5
    distance_km = np.sqrt((site_lat - point_lat) ** 2 + (site_lng - point_lng) ** 2) * 111
    if distance_km <= 0:
        return -140  # Invalid distance, extreme loss

    site_key = (round(site_lat, 5), round(site_lng, 5))
    point_key = (round(point_lat, 5), round(point_lng, 5))

    site_elevation = elevation_cache.get(site_key, 0)
    point_elevation = elevation_cache.get(point_key, 0)

    site_total_height = max(1, base_height + site_elevation)  # Ensure positive height
    point_total_height = mobile_height + point_elevation

    # Perform enhanced LOS check with diffraction
    los_clear, obstruction_penalty = detailed_los_with_diffraction(
        site_lat, site_lng, point_lat, point_lng, site_total_height, point_total_height, frequency
    )

    if not los_clear:
        return -140 + obstruction_penalty  # Apply penalty for blocked paths

    # Calculate vertical alignment
    elevation_angle = math.degrees(math.atan2(site_total_height - point_total_height, distance_km * 1000))
    angle_diff = abs(elevation_angle - downtilt)
    vertical_gain = -6 * ((angle_diff - 3) / 2) ** 2 if angle_diff > 3 else 0

    # Path loss (COST-231 Hata)
    if base_height <= 0 or distance_km <= 0:
        return -140  # Invalid configuration

    path_loss = (
        46.3
        + 33.9 * math.log10(frequency)
        - 13.82 * math.log10(site_total_height)
        + (44.9 - 6.55 * math.log10(site_total_height)) * math.log10(distance_km)
    )

    # Apply environmental shadowing
    shadowing = {"urban": 2, "suburban": 1.5, "rural": 1}.get(environment, 0)

    # RSRP Calculation
    rsrp = tx_power - path_loss + vertical_gain - shadowing
    return max(-140, min(rsrp, -30))

@app.post("/propagation")
def compute_coverage(request: PropagationRequest):
    """
    Compute coverage with enhanced LOS and terrain profiling.
    """
    elevation_cache.clear()
    site = request.site
    model = request.model
    resolution = request.resolution
    radius = request.radius

    # Site and model parameters
    site_lat = site["lat"]
    site_lng = site["lng"]
    frequency = model["frequency"]
    base_height = model["antenna_height"]
    tx_power = 43  # Transmit power in dBm
    downtilt = model["downtilt"]
    environment = model["environment"]
    azimuth = model["azimuth"]
    beamwidth = model["beamwidth"]

    azimuth_rad = math.radians(azimuth)
    half_beamwidth_rad = math.radians(beamwidth / 2)

    # Generate grid points
    grid_points = [
        (site_lat + (r / 111) * math.cos(angle), site_lng + (r / 111) * math.sin(angle))
        for r in np.linspace(0.01, radius, resolution)
        for angle in np.linspace(azimuth_rad - half_beamwidth_rad, azimuth_rad + half_beamwidth_rad, resolution)
    ]

    # Fetch elevations
    elevations = fetch_elevation([(site_lat, site_lng)] + grid_points)
    site_elevation = elevations[0]
    point_elevations = elevations[1:]

    # Cache elevations
    for (lat, lng), elevation in zip(grid_points, point_elevations):
        elevation_cache[(round(lat, 5), round(lng, 5))] = elevation

    # Calculate RSRP
    coverage_data = []
    for (lat, lng), elevation in zip(grid_points, point_elevations):
        rsrp = calculate_rsrp_with_enhanced_los(
            site_lat=site_lat,
            site_lng=site_lng,
            point_lat=lat,
            point_lng=lng,
            frequency=frequency,
            base_height=base_height,
            tx_power=tx_power,
            downtilt=downtilt,
            environment=environment,
        )
        coverage_data.append({"lat": lat, "lng": lng, "rsrp": rsrp})

    return coverage_data


@app.get("/")
def root():
    return {"message": "Propagation Model with Enhanced Terrain and LOS Logic is running"}